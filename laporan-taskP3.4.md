# Laporan TASK P3.4 — Transaksi/lock untuk read-modify-write (T4 fix)

**Tanggal:** 10 Agu 2026
**Prasyarat:** P3.1 (`c164729`), P3.2 (`3780453`), P3.3 (`eb74929`) sudah commit —
kolom `workspace_v2` sudah jadi sumber kebenaran v2, shape kolom
`extractedEntities` sudah konsisten OBJECT (T2 fix). Sehingga fokus P3.4 adalah
**atomisitas read-modify-write**, bukan shape.
**Scope:** `conversation-context.service.ts` — titik RMW yang diidentifikasi di
laporan-taskP3-audit.md §2/§6 T4, plus kolom `workspace_v2`:

- `modifyCart` (audit §2:1397) — RMW `confirmedItems`
- `setPendingClarification` (audit §2:318) — RMW `pendingClarification`
- `updateExtractedEntities` (audit §2:116) — RMW `trackedEntities`
- `updateWorkspaceV2` (P3.1 baru) — RMW `workspace_v2`

(Serpih 4 titik ini, `updateShippingInfo`/`clearPendingClarification`/
`incrementClarificationRetry`/`restoreCart` — yang sama-sama RMW ke kolom
`extractedEntities` dan tercantum di audit §2 — *juga* dilindungi helper yang
sama karena satu kelas bug; lihat §2.)

## 0. Akar masalah (T4 — SEDANG)

Semua titik di atas pola lama:

```ts
const raw = await prisma.conversationContext.findUnique({ where: { conversationId } });
// ... compute new entities object from raw ...
await prisma.conversationContext.update({ where: { conversationId },
  data: { extractedEntities: entities } });   // overwrite SELURUH object JSON
```

`findUnique` → `update` **bukan satu transaksi**. Dua pesan WA hampir bersamaan untuk
`conversationId` yang sama → kedua writer baca state yang sama → masing-masing
menghitung perubahan (field beda) → kedua `update` menulis **seluruh object**
`extractedEntities`; writer yang commit paling akhir **menimpa** writer
sebelumnya → **last-write-wins** → `confirmedItems` *atau* `pendingClarification`
hilang. (Audit §5.5 memastikan hal yang sama; RAILS §2 mencatat `modifyCart`
non-transaksional.)

## 1. Pendekatan yang dipilih: optimistic locking (bukan `prisma.$transaction`)

Duantara dua opsi di scope:

| opsi | mekanisme | keputusan |
|---|---|---|
| A | `prisma.$transaction([findUnique, update])` | **Ditolak** — `$transaction` dengan `findUnique`+`update` memerlukan `prisma.conversationContext.update` (WhereUniqueInput), tapi kita butuh guard `updatedAt` (non-unique) pada `where`. `update` tidak boleh filter non-unique. |
| B | Optimistic lock: baca `updatedAt` → `updateMany({ where:{conversationId, updatedAt} })` → retry bila `count===0` | **DIPILH** |

**Alasan pilih B:**
1. `updateMany` boleh memfilter kolom non-unique `updatedAt` — ini *compare-and-set*
   PostgreSQL yang atomik (row-level lock saat UPDATE).
2. `@updatedAt` di Prisma 5.22 **memang naik tiap commit via `updateMany`** —
   diverifikasi empiris (lihat §4). Jadi optimistic clock valid.
3. **Tidak blocking / tidak `SELECT … FOR UPDATE`** — hot conversation tidak
   terjebak pada lock contention; writer kalah cukup *retry* dengan state segar.
4. Tetap *atomic* per-statement; tidak perlu transaksi 2-fasa.

> Pilihan ini konsisten dengan rekomendasi audit §7 #4 yang menyebut kedua opsi
> ("`$transaction` … **atau** optimistic locking (`updatedAt` compare)").

## 2. Implementasi — helper `atomicCas()`

`conversation-context.service.ts` (baru):

```ts
/** Maksimal percobaan optimistic lock sebelum memberi up (T4 fix P3.4). */
const ATOMIC_MAX_ATTEMPTS = 5;
const ATOMIC_BACKOFF_MS = [0, 25, 50, 100, 200];

private async atomicCas<T>(
  conversationId: string,
  operation: string,
  writer: (row: { extractedEntities: unknown; updatedAt: Date })
    => Promise<{ count: number | null; value: T }>,
): Promise<T | null> {
  for (let attempt = 0; attempt <= ATOMIC_MAX_ATTEMPTS; attempt++) {
    const row = await prisma.conversationContext.findUnique({
      where: { conversationId },
      select: { extractedEntities: true, updatedAt: true },
    });
    if (!row) return null;                                  // tidak ada context
    const outcome = await writer(row);
    if (outcome.count === null) return outcome.value;      // writer: tidak perlu tulis
    if (outcome.count > 0) return outcome.value;           // committed
    // count === 0 → writer lain naikkan updatedAt → stale → retry
    if (attempt < ATOMIC_MAX_ATTEMPTS) {
      await new Promise(r => setTimeout(r, ATOMIC_BACKOFF_MS[attempt] ?? 200));
    }
  }
  return null;                                            // exhausted
}
```

Setiap metode RMW dipanggulung ke dalam `atomicCas`:

| metode | writer melakukan | field |
|---|---|---|
| `updateExtractedEntities` | parse → `mergeTrackedEntities` → `updateMany` | `extractedEntities` (object) |
| `updateWorkspaceV2` | `updateMany` | `workspace_v2` |
| `updateShippingInfo` | parse → set recipient/shipping → `updateMany` | `extractedEntities` |
| `modifyCart` | parse → fuzzy cart ops → `updateMany` | `extractedEntities.confirmedItems` |
| `setPendingClarification` | parse → set pending → `updateMany` | `extractedEntities.pendingClarification` |
| `clearPendingClarification` | parse → null-kan pending → `updateMany` | `extractedEntities` |
| `incrementClarificationRetry` | parse → bump retry → `updateMany` | `extractedEntities` |
| `restoreCart` | parse → set confirmedItems = snapshot → `updateMany` | `extractedEntities` |

Setiap writer mengembalikan `{ count: result.count, value: … }` dari
`updateMany`; `atomicCas` menafsirkan `count` (0 = stale → retry, >0 = committed,
null = skip-write terminal).

**Catatan resilience (tetap):** bila context tidak ada / konflik tak selesai /
error DB → log & kembalikan `null` (tidak throw), **sama seperti kontrak lama**
yang memakai try/catch swallow. `modifyCart`/`restoreCart` kembalikan `[]` pada
`null` dengan `?? []`.

## 3. ACCEPTANCE

1. `npx tsc --noEmit -p apps/api` → **EXIT 0** (0 error).
2. `npx oxlint src/business/conversation-context.service.ts` → **0 error, 0 warning**.
3. Audit §7 #4 (T4) status → **SELESAI**, `laporan-taskP3-audit.md` §6 T4 + §9 diupdate.
4. RAILS.md §3 → **P3 centang `[x]`** (lihat §5).
5. Race test before/after (lihat §4) → both writes preserved pada AFTER, data loss pada BEFORE.

## 4. Race test — before/after

Script: `apps/api/scripts/race-test-p34.ts`. Skema: untuk satu `conversationId`,
kirim 2 request nyaris bersamaan via `Promise.all`:

- **A** = `conversationContextService.modifyCart(convId, 'add', { addedProduct:'TestProduct', qty:1, price:1000 })` → menulis `confirmedItems`
- **B** = `conversationContextService.setPendingClarification(convId, { question:'q', options:[…], expected_type:'yes_no' })` → menulis `pendingClarification`

Kedua field di kolom JSON `extractedEntities` yang SAMA (row yang sama).
10 iterasi, masing-masing conversation yang fresh. Readback kolom mentah lalu
`parseExtractedEntities`, cek `hasCart` (confirmedItems mengandung 'TestProduct')
dan `hasPending`.

### BEFORE (stash P3.4 → kode lama `findUnique`→`update`, non-atomik)

```
$ git stash push -- src/business/conversation-context.service.ts
$ npx tsx scripts/race-test-p34.ts "BEFORE (findUnique->update, non-atomik)"
[BEFORE (findUnique->update, non-atomik)] iterations=10 bothSaved=0 cartLost=10 pendingLost=0 bothLost=0 → FAIL (data lost → race)
```

`setPendingClarification` (compute ringan) commit lebih dulu; `modifyCart` commit
setelahnya dari *stale read* → menimpa, `confirmedItems` hilang. **10/10 iterasi
kehilangan cart.** Bukti last-write-wins.

### AFTER (working tree = `atomicCas` aktif)

```
$ npx tsx scripts/race-test-p34.ts "AFTER (atomicCas aktif)"
[AFTER (atomicCas aktif)] iterations=10 bothSaved=10 cartLost=0 pendingLost=0 bothLost=0 → PASS (both writes preserved, no last-write-wins)
```

Thread A `modifyCart` commit dulu (`updatedAt` naik); thread B `setPending` melihat
`updateMany` `count===0` → retry → baca state segar (termasuk `confirmedItems` A) →
apply `pendingClarification` di atasnya → commit. **10/10 iterasi KEDUA field
tersimpan, 0 kehilangan.** Log juga menampilkan *"Optimistic lock conflict,
retrying"* pada attempt 0 → committed.

## 5. Verifikasi pendukung: `updateMany` memang bump `@updatedAt`

Optimis lock `atomicCas` bergantung pada asumsi `updatedAt` naik tiap commit via
`updateMany` (bukan hanya `update`). Di Prisma 5.22.0 + PostgreSQL ini **valid** —
teks skrip verifikasi (`check-updatedat.mjs`, dijalankan sekali, tidak dikommit):

```
updateMany count: 1
before updatedAt: 2026-08-10T15:04:31.000Z
after  updatedAt: 2026-08-10T15:04:32.110Z
BUMPED: true
```

Artinya optimistic clock naik tiap commit; writer kalah pasti detect `count===0`.

## 6. Catatan ruang lingkup (TIDAK dikerjakan di P3.4)

- **`appendMessage`** (kolom `lastMessages`, bukan `extractedEntities`) masih `findUnique`→`update`
  tanpa lock — potensi lost-update pada array `lastMessages`. **Secara eksplisit di luar
  scope T4** (audit §2/§5 T4 mensukseskan `extractedEntities` + `workspace_v2` saja).
  Diserahkan ke task berikutnya agar scope P3.4 tetap terpencil.
- Fallback tier (`fallback.service.ts:997/1003`, T5) — klasifikasi RENDAH, diluar
  scope kolom `extractedEntities` RMW utama; tidak disentuh.

## 7. Ringkasan deliverable

- `apps/api/src/business/conversation-context.service.ts` — helper `atomicCas()` +
  semua metode RMW `extractedEntities`/`workspace_v2` lewat atomicCas.
- `apps/api/scripts/race-test-p34.ts` — skrip race test manual (before/after).
- `laporan-taskP3-audit.md` §6 T4 (SELESAI) + §9 (race test) + §7 #4 (done).
- `RAILS.md` §3 → P3 `[x]` (dengan sub-item P3.1–P3.4).
- `laporan-taskP3.4.md` (ini).
