# LAPORAN TASK B4.2 — Perketat trySop retur category gate vs 'ganti X ke Y'

## 1. PRASYARAT

TASK B4.1 SUDAH commit bersih:

```
$ git log --oneline -3
373cb37 fix(chat): tighten trySop retur category gate vs 'ganti X ke Y' order-mod (TASK B4.2)
fca533f fix(chat): tighten tryOrderStatus intent gate (TASK B4.1, stok vs status order overlap)
5f502d1 chore: restore f314326 clean state + remove orphaned dist/ files ...
```

--- fca533f (TASK B4.1) sudah ada di HEAD~1 predates. Git status bersih sebelum mulai
(setelah `git checkout` file log runtime `apps/api/logs/combined.log`).

## 2. RINGKASAN

**Bug (laporan-taskB2.md):** Kata `'ganti'` termasuk retur-keywords di `categoryMap`
(`fallback.service.ts:697`), menyerobot permintaan ganti item pesanan. Contoh:
`"ganti kangkung ke wortel"` (maksud: tukar item di order) → salah jawab SOP retur
(`"Barang bisa diretur dalam 24 jam..."`).

**Fix:** Tambahkan fungsi pure `isSopRetourIntent()` di `tier-match.ts`, pasangkan
`'ganti'` ke categoryMap retur keywords, dan gate kategori `'retur'` lewat fungsi
ini di `trySop`. Kategori SOP lain (komplain, garansi, dll.) TIDAK diubah.

## 3. PERUBAHAN KODE (3 file)

### 3.1 `apps/api/src/services/chat/tier-match.ts` — penambahan fungsi

```typescript
// ── trySop: aksenat klasifikasi kategori 'retur' ───────────────────────────
// TASK B4.2: 'ganti' termasuk keyword retur (sinyal lemah). 'ganti' SENDIRIAN
// bukan sinyal retur kuat — tapi 'ganti' SENDIRIAN bukan sinyal retur kuat.
// isSopRetourIntent() menentukan apakah benar-benar intent retur.
//
// Bug (laporan-taskB2.md): "ganti kangkung ke wortel" (maksud: tukar item di
// order) salah jawab SOP retur ("Barang bisa diretur dalam 24 jam...").

/** Kata kunci kategori 'retur' — termasuk 'ganti' (sinyal lemah). */
export const SOP_RETUR_KEYWORDS: readonly string[] = [
  'retur',
  'kembalikan barang',
  'tukar barang',
  'barang rusak',
  'rusak',
  'pengembalian',
  'refund',
  'ganti',
];

// Kata eksplisit (selain 'ganti') yang memperkuat sinyal retur → trigger normal.
// 'kecewa' dan 'komplain' juga termasuk karena mengindikasikan keluhan nyata.
const SOP_RETUR_EXPLICIT_SIGNALS: readonly string[] = [
  'rusak',
  'barang rusak',
  'kembalikan barang',
  'tukar barang',
  'pengembalian',
  'refund',
  'retur',
  'kecewa',
  'komplain',
];

/**
 * TASK B4.2 — Gate cerdas untuk kategori SOP 'retur' di trySop.
 *
 * Aturan:
 * - Kata retur non-'ganti' (rusak, refund, retur, dll.) → true (trigger normal).
 * - 'ganti' + kata eksplisit → true.
 * - Pola "ganti X ke Y" di mana X & Y keduanya nama produk katalog → false
 *   (itu order-modification, bukan retur).
 * - 'ganti' sendirian / 'ganti' dengan <1 produk → false (bukan sinyal kuat).
 */
export function isSopRetourIntent(lower: string, catalogNames: readonly string[]): boolean {
  // Strong retur word (bukan 'ganti') → trigger normal
  if (SOP_RETUR_EXPLICIT_SIGNALS.some((kw) => lower.includes(kw))) return true;

  // 'ganti' tidak ada → tidak ada intent retur dari kata 'ganti'
  if (!lower.includes('ganti')) return false;

  // 'ganti' ada tapi tidak ada kata eksplisit:
  // Pola "ganti X ke Y" di mana X & Y keduanya nama produk katalog →
  // ini order-modification (tukar item), BUKAN retur → false.
  const mentionedProducts = catalogNames.filter(
    (p) => p.trim().length > 1 && lower.includes(p.trim())
  );
  if (mentionedProducts.length >= 2) return false;

  // 'ganti' sendirian / 'ganti' dengan <1 produk → bukan sinyal retur kuat
  return false;
}
```

### 3.2 `apps/api/src/business/fallback.service.ts` — wiring trySop

**Import (baris 26), ditambah `isSopRetourIntent` + `SOP_RETUR_KEYWORDS`:**

```typescript
import { isTotalTrigger, isTotalIntent, isPaymentIntent, isOrderStatusIntent, ORDER_STATUS_KEYWORDS, isSopRetourIntent, SOP_RETUR_KEYWORDS } from '../services/chat/tier-match.js';
```

**categoryMap (trySop, baris 695-704) — `'ganti'` ditambahkan via `SOP_RETUR_KEYWORDS`:**

```typescript
const categoryMap: Array<[readonly string[], string]> = [
  [['komplain', 'keluhan', 'kecewa'], 'komplain'],
  // TASK B4.2: 'ganti' termasuk keyword retur (lemah) — ditolak oleh
  // isSopRetourIntent bila bukan sinyal retur kuat atau pola "ganti X ke Y".
  [SOP_RETUR_KEYWORDS, 'retur'],
  [['garansi', 'warranty'], 'garansi'],
  [['stok habis', 'kosong', 'ready ga', 'ready kapan'], 'stok_habis'],
  [['cara order', 'cara pesan', 'gimana belinya'], 'order'],
  [['sudah dikirim', 'kapan dikirim', 'status pesanan', 'status order', 'sampai mana', 'udah sampai', 'pesanan saya'], 'order_status'],
];
```

**Gate di try-block (baris 715-725) — hanya kategori `'retur'`, kategori lain tidak disentuh:**

```typescript
    try {
      // TASK B4.2 — gate khusus kategori 'retur': 'ganti' sendirian bukan
      // sinyal retur kuat. Butuh kata eksplisit ('rusak', 'refund', dsb.)
      // atau pola "ganti X ke Y" dengan dua nama produk katalog → false
      // (itu order-modification, bukan retur). Lihat tier-match.ts.
      if (category === 'retur') {
        const catalogNames = (await productService.listActiveProducts(context.storeId)).map((p) =>
          p.name.toLowerCase()
        );
        if (!isSopRetourIntent(lower, catalogNames)) return null;
      }
```

### 3.3 `apps/api/src/services/chat/tests/tier-match.test.ts` — 11 kasus baru

```typescript
describe('TASK B4.2 — isSopRetourIntent gate (ganti X ke Y vs retur)', () => {
  it('(1) "barang saya rusak, mau retu" → true (regresi)', () => {
    assert.equal(isSopRetourIntent('barang saya rusak, mau retu', CATALOG), true);
  });
  it('(2) "ganti kangkung ke wortel" (dua nama produk katalog) → false (bug lama)', () => {
    assert.equal(isSopRetourIntent('ganti kangkung ke wortel', CATALOG), false);
  });
  it('(2-b) "ganti wortel ke kangkung" (urutan terbalik) → false', () => {
    assert.equal(isSopRetourIntent('ganti wortel ke kangkung', CATALOG), false);
  });
  it('(3) "ganti" saja tanpa konteks lain → false', () => {
    assert.equal(isSopRetourIntent('ganti', CATALOG), false);
  });
  it('(3-b) "ganti kangkung" (ganti + satu produk) → false', () => {
    assert.equal(isSopRetourIntent('ganti kangkung', CATALOG), false);
  });
  it('(4) "mau komplain, kecewa sama pelayanan" → true', () => {
    assert.equal(isSopRetourIntent('mau komplain, kecewa sama pelayanan', CATALOG), true);
  });
  it('(regresi) "barang rusak banget" → true', () => {
    assert.equal(isSopRetourIntent('barang rusak banget', CATALOG), true);
  });
  it('(regresi) "mau refund" → true', () => {
    assert.equal(isSopRetourIntent('mau refund', CATALOG), true);
  });
  it('(regresi) "barang rusak mau retur" → true', () => {
    assert.equal(isSopRetourIntent('barang rusak mau retur', CATALOG), true);
  });
  it('(regresi) "pengembalian barang rusak" → true', () => {
    assert.equal(isSopRetourIntent('pengembalian barang rusak', CATALOG), true);
  });
  it('sanity: SOP_RETUR_KEYWORDS termasuk ganti + semua kata eksplisit', () => {
    assert.equal(SOP_RETUR_KEYWORDS.includes('ganti'), true);
    assert.equal(SOP_RETUR_KEYWORDS.includes('rusak'), true);
    assert.equal(SOP_RETUR_KEYWORDS.includes('refund'), true);
  });
});
```

## 4. HASIL UNIT TEST

Runner: `node --experimental-vm-modules ./node_modules/.bin/jest --config jest.config.cjs`

**Target file saja (`tier-match.test.ts`):**

```
Test Suites: 1 passed, 1 total
Tests:       31 passed, 31 total
```

**Ringkasan per file (setelah B4.2):**

| File | Suite | Test count | Status |
|------|-------|-----------|--------|
| tier-match.test.ts | B3-total, B3-payment, B4.1-orderStatus, B4.2-sopRetour | 31 | ✅ all pass |
| reasoning-v2.test.ts | reasoning engine | — | ❌ pre-existing (I-V2 validators) |
| engine-config-v2.test.ts | engine config | — | ❌ pre-existing (stub/no-assertion) |
| **Total** | **23 suites** | **230** | **229 pass / 1 fail (pre-existing)** |

Baseline sebelum B4.2: 219 total, 1 fail → setelah B4.2: 230 total, 1 fail.
11 test baru ditambahkan, **semua pass**. **0 failure baru.**

## 5. BUILD & TYPE CHECK

```
$ npx tsc --noEmit
(exit 0 — 0 error)

$ npm run build
(exit 0 — success)
```

Verifikasi file baru masuk tsconfig scope:

```
$ npx tsc --noEmit --listFiles | grep tier-match
.../apps/api/src/services/chat/tier-match.ts
```

## 6. GIT DIFF SCOPE

```
$ git diff --stat HEAD~1 HEAD

 apps/api/dist/business/fallback.service.d.ts.map   |  2 +-
 apps/api/dist/business/fallback.service.js         | 15 +-
 apps/api/dist/business/fallback.service.js.map     |  2 +-
 apps/api/dist/services/chat/tests/tier-match.test.js  | 45 ++-
 apps/api/dist/services/chat/tests/tier-match.test.js.map | 2 +-
 apps/api/dist/services/chat/tier-match.d.ts        | 16 +
 apps/api/dist/services/chat/tier-match.d.ts.map    |  2 +-
 apps/api/dist/services/chat/tier-match.js          | 61 +++
 apps/api/dist/services/chat/tier-match.js.map     |  2 +-
 apps/api/src/business/fallback.service.ts          | 19 +-
 apps/api/src/services/chat/tests/tier-match.test.ts | 56 +++
 apps/api/src/services/chat/tier-match.ts           | 67 ++++

 3 SOURCE files (scope ketat) + dist build artifacts
```

**Scope hanya 3 file sumber:**
1. `apps/api/src/services/chat/tier-match.ts`
2. `apps/api/src/services/chat/tests/tier-match.test.ts`
3. `apps/api/src/business/fallback.service.ts` (HANYA bagian trySop kategori retur)

## 7. PM2 RESTART

```
$ pm2 restart api
$ pm2 list
│ 0  │ api │ ... │ pid 200272 │ online │ ... │
```

Service online, tidak ada crash loop.

## 8. E2E CURL VERIFICATION (production webhook)

Endpoint: `POST http://localhost:3000/api/webhooks/fonnte?secret=<SECRET>`
Device: `6289658888008`

### Skenario (a) — BUG FIX: "ganti kangkung ke wortel"

```
$ curl -s -X POST "..." -d '{"sender":"6289999999944","message":"ganti kangkung ke wortel",...}'
{"status":"ok"}
```

Engine trace: `outcome=tier, llmCalls=0`

DB conversation_history (store-f7140b5c:6289999999944):

| role | source | content |
|------|--------|---------|
| user | — | ganti kangkung ke wortel |
| assistant | ai | Boleh dibantu dipastikan Kak, produk mana yang dimaksud? • *Wortel* — Rp 19.000 (stok: 100) • *Kangkung* — Rp 8.000 (stok: 100) Kakak mau pilih yang mana nih? |

✅ **HARUS TIDAK jawab SOP retur** — balasan adalah product disambiguation (tryProduct),
bukan SOP retur. Bug terperangkap oleh isSopRetourIntent → false (pattern "ganti X ke Y"
 dengan 2 produk katalog).

### Skenario (b) — REGRESI: "barang rusak, boleh retur?"

(sender baru, tidak ada 'mau' → melewati order-intent guard)

```
$ curl -s -X POST "..." -d '{"sender":"6289999999922","message":"barang rusak, boleh retur?",...}'
{"status":"ok"}
```

Engine trace: `outcome=tier, llmCalls=0`

DB conversation_history (store-f7140b5c:6289999999922):

| role | source | content |
|------|--------|---------|
| user | — | barang rusak, boleh retur? |
| assistant | ai | **Barang bisa diretur dalam 24 jam setelah diterima. Hubungi admin via WhatsApp untuk proses retur.** |

✅ **SOP retur TETAP dijawab** — 'rusak' adalah kata eksplisit, isSopRetourIntent → true.

### Skenario (c) — REGRESI tambahan: "rusak, retur dong"

```
$ curl -s -X POST "..." -d '{"sender":"6289999999911","message":"rusak, retur dong",...}'
{"status":"ok"}
```

Engine trace: `outcome=tier, llmCalls=0`

DB response: **"Barang bisa diretur dalam 24 jam setelah diterima. Hubungi admin via WhatsApp untuk proses retur."**

✅ SOP retur tetap dikembalikan.

### Skenario (d) — REGRESI task word-for-word: "barang rusak mau retur"

```
$ curl -s -X POST "..." -d '{"sender":"6289999999933","message":"barang rusak mau retur",...}'
{"status":"ok"}
```

Engine trace: `outcome=reasoned, llmCalls=1`

DB response: "Maaf atas ketidaknyamanan yang Anda alami. Untuk proses retur, bisa Anda menjelaskan lebih lanjut tentang barang yang rusak?" (LLM-generated)

❌ **Tidak kembali SOP retur** — tapi ini **BUKAN karena perubahan B4.2**. Lihat
bagian 10 (Logic Gap) untuk analisis lengkap.

### SOP retur di DB (store-f7140b5c, verifikasi):

```
$ psql -c "SELECT category, substr(content,1,80) FROM sops WHERE \"storeId\"='store-f7140b5c';"
  category |                    content
-----------|------------------------------------------------------------------------
 retur     | Barang bisa diretur dalam 24 jam setelah diterima. Hubungi admin via W...
```

## 9. COMMIT

```
commit 373cb3773a69a71d7b66a42d818bf9462c101483 (HEAD -> main)
Author: pandjiemadiun <dwiputroagung2773@gmail.com>
Date:   2026-08-10

    fix(chat): tighten trySop retur category gate vs 'ganti X ke Y' order-mod (TASK B4.2)

    Co-authored-by: CommandCodeBot <noreply@commandcode.ai>
```

```
$ git status
On branch main
nothing to commit, working tree clean
```

## 10. ANALISIS GAP LOGIKA (Logic Gap)

### Masalah: kata `'mau'` dalam `ORDER_INTENT_KEYWORDS` (fast-path.ts:52-63)

**Fakta:** E2E regression dengan kalimat task word-for-word (`"barang rusak mau retur"`)
mengembalikan response LLM, bukan SOP retur. Investigation menunjukkan hal ini
**bukan akibat perubahan B4.2** — terjadi karena guard berikut di `fast-path.ts`:

```typescript
// fast-path.ts:52-63
const ORDER_INTENT_KEYWORDS: readonly string[] = [
  'mau', 'beli', 'pesan', 'tambah', 'kurang', 'hapus',
  'ga jadi', 'gak jadi', 'batal', 'cancel',
];

// fast-path.ts:436-441
if (isOrderIntent(normalizedMsg, catalog)) {
  return { hit: false, pendingParked: false, topicSwitch: false };
}

// isOrderIntent (fast-path.ts:140-149)
function isOrderIntent(message: string, catalog: CatalogItem[]): boolean {
  if (CATALOG_INTENT_KEYWORDS.some((kw) => message.includes(kw))) return false;
  if (ORDER_INTENT_KEYWORDS.some((kw) => message.includes(kw))) return true;  // 'mau' match!
  ...
}
```

`"barang rusak mau retur"` mengandung `'mau'` → `isOrderIntent` = true → `tryFastPath`
mengembalikan `{ hit: false }` **tanpa pernah memanggil `getResponse`** (dan sekaligus
`trySop`). Message langsung masuk ke LLM interpreter (Stage 4).

**Bukti:** Unit test `isSopRetourIntent('barang rusak mau retur', CATALOG)` → **true** ✅
(dapat diverifikasi di tier-match.test.ts). Jadi fungsi B4.2 bekerja benar — hanya
saja message dengan `'mau'` tidak pernah mencapai trySop.

**Dampak:** Kalimat seperti "barang rusak mau retur" atau "mau retur barang rusak"
yang meng mengandung kata `'mau'` akan selalu melewati semua tier (termasuk trySop)
karena guard ini. Ini adalah **gap logika yang sudah ada sebelum B4.2**.

### Rekomendasi follow-up (BUKAN bagian dari B4.2 scope)

Untuk membuat E2E regression `"barang rusak mau retur"` → SOP retur benar-benar
berfungsi, perlunasan guard di `fast-path.ts`:

- **Opsi A (ringan):** Tambahkan eksklusi — jika `isOrderIntent` match via `'mau'`
  TAPI juga mengandung kata retur eksplisit (`rusak`, `retur`, `refund`, dll.),
  biarkan lanjut ke tier (don't short-circuit).
- **Opsi B (lebih aman):** Pindah `isOrderIntent` check ke AFTER tier deterministik,
  bukan sebelum — biarkan trySop/tryOrderStatus menilai terlebih dahulu.

Kedua opsi meluau `fast-path.ts` yang berada **di luar SCOPE KETAT B4.2** (3 file).

### Ringkasan DoD check

| No | Check | Status | Notes |
|----|-------|--------|-------|
| 1 | `npx tsc --noEmit` | ✅ exit 0 | 0 error |
| 2 | `npm run build` | ✅ exit 0 | success |
| 3 | Test suite | ✅ baseline preserved | 1 pre-existing fail (reasoning-v2), 0 new fail |
| 4 | `git diff --stat` | ✅ 3 source files | scope hanya tier-match.ts, tier-match.test.ts, fallback.service.ts |
| 5 | `pm2 restart api` | ✅ online | pid 200272, no crash |
| 6a | E2E "ganti kangkung ke wortel" | ✅ NOT SOP retur | tryProduct disambiguation |
| 6b | E2E "barang rusak, boleh retur?" | ✅ SOP retur | regression via trySop |
| 6c | E2E "rusak, retur dong" | ✅ SOP retur | regression via trySop |
| 6d | E2E "barang rusak mau retur" | ⚠️ LLM (not SOP) | pre-existing 'mau' guard in fast-path.ts, out of scope |
| 7 | git commit | ✅ committed | 373cb37, Co-authored-by trailer |
| 8 | git status clean | ✅ clean | working tree clean |
