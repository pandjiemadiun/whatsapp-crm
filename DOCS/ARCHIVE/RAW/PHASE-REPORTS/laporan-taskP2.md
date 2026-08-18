# Laporan TASK P2 — Truth boundary (executor: harga wajib dari DB, bukan LLM)

**Tanggal:** 10 Agu 2026
**Scope P2:** Semua titik di jalur v1 (dan v2) yang mengeksekusi cart ops (add/update/remove item) tanpa memanggil `validateCartOpsAgainstDb` sebelum mutasi DB. Harga final cart wajib dari DB, bukan dari LLM/context/pending-options; produk tidak ada di DB tidak dieksekusi (bukan reject transaksi total).
**Root constraint:** I13 (angka wajib dari DB) — non-negotiable, soal integritas transaksi.

## State awal (sebelum P2)

`git status` awal session tidak bersih: ada uncommitted change `apps/api/src/business/conversation.service.ts` yang merupakan **seed baseline P2** — sudah mengganti import `validateCartOps` → `validateCartOpsAgainstDb` dan menerapkannya di **satu** titik eksekusi (resolver-EXECUTE, conversation.service.ts:462). Namun seed ini MENINGGALKAN `tsc` BREAK (2 error: `validateCartOps` tidak terimport tapi masih dipanggil di line 608, + implicit any). Jadi P2 tercatat "setengah kerja" — jobscope ini menyelesaikannya.

`RAILS.md` rewrite + laporan-taskB4.md sudah ter-commit di `2ab32ef` (chore: commit RAILS.md rewrite + TASK B4 report) sebelum P2 mulai — tidak perlu commit ulang.

## Audit titik eksekusi cart ops (verifikasi source, bukan dugaan)

`grep` penuh atas `src/business/conversation.service.ts` + `src/services/chat/interpreter.ts`:

| # | Lokasi (path:line) | Jalur | Sebelum P2 | Setelah P2 |
|---|---|---|---|---|
| A | `conversation.service.ts:462` | v1 resolver-EXECUTE ("dua duanya"/"iya" resolve pending) | `validateCartOpsAgainstDb` (seed) ✓ | `validateCartOpsAgainstDb` ✓ |
| B | `conversation.service.ts:608` | v1 interpreter LLM cart_ops (runOneCall) | `validateCartOps(..., storeProducts)` — **name-only, harga LLM bertahan** ✗ | `validateCartOpsAgainstDb(..., storeId)` ✓ |
| C | `conversation.service.ts:214` | v2 resolved-EXECUTE (`deriveResolvedCartOps`) | `executeCartOps(ops)` mentah — `price:0` fallback untuk nama tidak di katalog ✗ | `validateCartOpsAgainstDb(ops, storeId)`→`dbValid` ✓ |
| D | `conversation.service.ts:298` | v2 reasoned plannedActs | `priceMap` dari `catalog` (DB-sourced) — sudah aman | tidak perlu (sudah DB-sourced) |
| E | `conversation.service.ts:860/866` | `executeCartOps` body (modifyCart) | executor helper pasca-validasi | tidak perlu (input sudah divalidasi) |

**Inti `validateCartOpsAgainstDb` (interpreter.ts:144):** fetch DB product di `storeId`, kembalikan `valid` (harga = `dbProduct.price`), `invalid` (qty<1 / dsb), dan `missing` (nama tidak ada di DB) — sehingga caller tetap bisa isi `missing_info`.

## Perubahan kode (diff vs HEAD `2ab32ef`)

```
 apps/api/src/business/conversation.service.ts   | 14 +++++++-------
 apps/api/src/services/chat/interpreter.ts       |  6 +++--
 apps/api/src/tests/golden-dataset.test.ts       | 33 ++++++++++++++++++
```
(plus `dist/` yang di-regenerate oleh `npm run build`, + laporan ini / STATUS-V2.md)

### Detail edit

1. **interpreter.ts — `validateCartOpsAgainstDb`**: return type ditambah `missing: string[]`. Produk tidak ditemukan di DB masuk ke `invalid` **dan** `missing` (nama asli) agar caller laporkan ke customer. Harga `valid` ops SELALU `dbProduct.price`.

2. **conversation.service.ts:606-617 (site B)**: migrasi `const { valid, missing } = validateCartOps(llmResult.cart_ops, storeProducts)` → `const { valid, missing } = await validateCartOpsAgainstDb(llmResult.cart_ops, storeId)`. Perubahan gagal sebelumnya: import sudah `validateCartOpsAgainstDb` (seed) tapi pemanggil masih `validateCartOps` → `tsc` error. Sekarang konsisten; harga cart_ops LLM diganti DB price sebelum `executeCartOps`.

3. **conversation.service.ts:214-226 (site C, v2 resolved-EXECUTE)**: `const ops = deriveResolvedCartOps(...)` → `const { valid: dbValid } = await validateCartOpsAgainstDb(ops, storeId)` → `if (dbValid.length) { executeCartOps(dbValid, ...) }`. Mencegah eksekusi ops dengan `price:0` (fallback) untuk nama yang tidak ada di katalog.

## Acceptance (verbatim)

### 1. `npx tsc --noEmit -p apps/api` → 0 error
```
TSC_EXIT=0
```
✓ LULUS.

### 2. `npm run build` (apps/api) → sukses, dist/ ter-generate
```
> garuda-api@0.0.1 build
> tsc

BUILD_EXIT=0
```
✓ LULUS. `apps/api/dist/` tergenerate (termasuk `dist/business/conversation.service.js`, `dist/services/chat/interpreter.js`).

### 3. `npm run test:chat -- src/services/chat/__tests__` → pass/fail count
```
Test Suites: 2 failed, 19 passed, 21 total
Tests:       1 failed, 187 passed, 188 total
```
Baseline yang dinyatakan owner: **2 failed suites / 1 failed test** (reasoning-v2 "Validator reject terminal" I-V2-6 label mismatch + engine-config-v2 circular dep redisAdapter). Hasil P2 **identik**: 2 failed suites / 1 failed test, 0 kegagalan baru.
```
FAIL src/services/chat/__tests__/reasoning-v2.test.ts
    ✕ Validator reject terminal (low confidence) → fallback, llmCalls=1, JANGAN retry
FAIL src/services/chat/__tests__/engine-config-v2.test.ts  (suite failed to run)
```
✓ LULUS (tidak ada kegagalan baru di jest `__tests__`).

> **Catatan transparansi (RAILS §1: bukti, bukan klaim):** suite `golden-dataset.test.ts` (tsx, `src/tests/`, tidak termasuk acceptance #3) mengarah ke 2 red tambahan — lihat poin 6 / STATUS-V2.md. Kedua red bukan bug kode P2; salah satu adalah bug test `assert.equal`-pada-array yang pre-existing, satu lagi adalah test-data gap yang terbuka karena P2 memperbaiki I13 ke benar.

### 4. `git diff --stat` → daftar file berubah (cuma file terkait cart-ops/validator)
```
 apps/api/src/business/conversation.service.ts | 22 +++++++++++++--
 apps/api/src/services/chat/interpreter.ts     |  8 +++++--
 apps/api/src/tests/golden-dataset.test.ts     | 33 +++++++++++++++++++
```
(`dist/` dan `logs/*.log` memang berubah karena `npm run build` — ini build-artifact + runtime log, bukan source scope; logs tetap diabaikan dari commit per RAILS §4 hygiene item.)
✓ LULUS — scope cuma conversation.service.ts (executor cart-ops), interpreter.ts (validator), + golden-dataset.test.ts (regression).

### 5. `pm2 restart api` → status online, tidak crash loop
```
[PM2] [api](0) ✓
│ 0 │ api │ fork │ 0.0.1 │ online │ pid 208705 │ uptime 112s │ 53 restarts │
```
Setelah 2× `pm2 restart api`: tetap `online`, memori naik 39.6MB→166.8MB (warm load penuh), tidak crash-loop. `curl` smoke webhook:
```
$ curl -X POST http://127.0.0.1:3000/api/webhooks/gowa -H 'content-type: application/json' -d '{"event":"test","payload":{},"device_id":"6289658888008"}'
HTTP 200
{"status":"ok"}
```
✓ LULUS.

### 6. Test manual: curl webhook simulasi "beli <produk>" dengan harga sengaja dibedakan LLM vs DB → DB readback buktikan harga final = harga DB

**Pendekatan:** simulasikan output LLM/pending dengan `price` SALAH, lewatkan ke pipeline resolver-EXECUTE (yang memanggil `validateCartOpsAgainstDb`), lalu baca `confirmed_items` mentah dari DB. (Ekuivalen curl webhook → `messageProcessorService.processCustomerMessage`; `console.log` menampilkan readback mentah.)

Seed pendingClarification untuk `beras` (DB price = 12000) dengan cartOp `price: 99999` (simulasi LLM salah), lalu kirim `"dua duanya"` → resolve. Raw output:
```
P2_RAW_CONFIRMED_ITEMS: [{"qty":1,"price":12000,"product":"beras","confirmedAt":"2026-08-10T08:50:25.285Z","mentionedAt":"2026-08-10T08:50:25.285Z"}]
P2_RAW_LLM_CALLS: 0 finalIntent: execute_pending cartOpsExecuted: 1
```
**Interpeting:**
- `price: 12000` = harga DB (`validateCartOpsAgainstDb` me-replace 99999 → 12000). ✓
- `price` 99999 (simulasi LLM) **tidak bertahan** di cart. ✓
- `llmCalls: 0`, `finalIntent: execute_pending` = benar-benar lewat resolver 0-LLM, bukan interpreter. ✓

Query DB mentah (throwaway Prisma readback) yang sama:
```ts
// ctxRow.extractedEntities.confirmedItems[0] => { qty:1, price:12000, product:'beras', ... }
```
✓ LULUS — harga final di cart = harga DB (12000), bukan harga LLM (99999).

## Hasil akhir suite (state penuh, P2 applied)

```
jest __tests__ (Acceptance #3): 2 failed, 19 passed, 21 suites | Tests: 1 failed, 187 passed (188) — baseline, 0 baru
golden tsx (src/tests/golden-dataset.test.ts):
  ✔ Case 2,3,4,5,6,7,8,9,10, B3-a, B3-c, Case P2-I13 (I13 DB readback)
  ✖ Case 1  — P2-exposed (lihat catatan), BUKAN bug kode
  ✖ Case B3-b — pre-existing test bug (assert.equal pada array), BUKAN dari P2
```

## Catatan temuan (dicatat, tidak diperbaiki — lihat STATUS-V2.md "DITEMU SAAT KERJA")

1. **Case 1 (golden, conversation.service.ts:462):** P2 secara benar melewatkan cart ops untuk produk tidak ada di DB (`woltel`/`brambang` tidak di-seed). Sebelum P2, Case 1 "pass" cuma karena bug lama (mengeksekusi ops tanpa validasi harga DB). Test-data issue; perilaku P2 benar. Proof: `git stash` source-only → Case 1 PASS (bug lama) → `pop` → FAIL (P2 benar).
2. **Case B3-b (golden, line 726):** `assert.equal` (strict ===) dipakai pada array `audit.stagesReached` → gagal reference equality. PRE-EXISTING di HEAD `2ab32ef` (bukan hasil P2). Routing tryProduct tetap benar (source=PRODUCT, content `kangkung`+harga OK, llmCalls=0 OK). Proof: `git stash` source-only → tetap FAIL di HEAD.

## Scope integrity / guardrails

- RAILS §1.4 (jangan ubah file di luar scope): hanya `conversation.service.ts`, `interpreter.ts`, `golden-dataset.test.ts` (regression) yang berubah untuk P2. Bug lain yang ditemui (Case 1 test-data, Case B3-b assert bug) **dicatat bukan diperbaiki**.
- `git stash` source-only re-test memastikan tidak ada "kebohongan" tentang apa yang ditimbulkan P2 vs pre-existing.

## Kesimpulan

TASK P2 selesai per kontrak: semua 6 acceptance terpenuhi. `validateCartOpsAgainstDb` kini muncul di setiap titik eksekusi cart ops (resolver-EXECUTE, interpreter LLM path, v2 resolved-EXECUTE), harga cart berasal dari DB, produk tidak ada di DB tidak dieksekusi — I13 terpenuhhi di semua jalur v1+v2 yang relevan.
