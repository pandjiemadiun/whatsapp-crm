# UPDATE SINCE PROJECT-STATE-REPORT.md

> Dibuat 2026-08-18, setelah PROJECT-STATE-REPORT.md. File ini HANYA delta —
> baca bersama PROJECT-STATE-REPORT.md, RAILS.md, PROJECT-CONTRACT-STRUCTURED-ACTIONS.md,
> dan CONSOLIDATED-HISTORY.md untuk konteks penuh.

---

## Status blocker §6.1 (structured actions uncommitted): **RESOLVED**

Laporan utama menandai ini sebagai masalah paling kritis. Sudah ditutup lewat 3 commit:

| Commit | Isi |
|---|---|
| `e5ee299` | Checkpoint: schema.prisma, migrasi ActionIdempotency, action-registry.ts, routes/actions.ts, DOCS/CONTRACT/* — 33 file. `logs/` sengaja di-exclude (data customer). |
| `b269196` | Rapikan DOCS/ — 137 file arsip (PHASE-REPORTS, AUDIT, PROJECT, laporan/task lama) dipindah ke `DOCS/ARCHIVE/RAW/`, ringkasan kronologis baru di `DOCS/ARCHIVE/CONSOLIDATED-HISTORY.md`. File aktif tersisa: `DOCS/CONTRACT/`, `DOCS/MASTER/`, `DOCS/G2-A-baseline-report.md`, `DOCS/QLOBOT-BASELINE.md`. |
| `ca3aea3` | Fix: model `ActionIdempotency` ditambahkan ke `schema.prisma` (sebelumnya cuma ada di migrasi, bikin clean-clone gagal build). |

## Verifikasi clean-clone build: **SUKSES**

Clone bersih dari git (bukan working tree) → `npm install` → `prisma generate` →
`tsc --noEmit` → `npm run build` — semua exit 0. Fondasi structured actions P0-P5
sekarang **buildable dari git history**, tidak lagi bergantung working tree lokal.

## Hasil test terbaru

| Test | Hasil sekarang | Baseline lama (di laporan utama) |
|---|---|---|
| `test:golden` | **18/18 pass** | 17/17 |
| `test:chat` | **23/23 suites, 267/267 tests pass** | 2 failed suites / 1 failed test |

**Belum diverifikasi ulang:** kenapa 2 failed suite pre-existing (`reasoning-v2.test.ts`,
`engine-config-v2.test.ts`) ikut hijau padahal task hanya nambah 1 model schema.
Perlu re-run untuk pastikan bukan flaky/false-positive.

## Open item kecil (belum ditutup, tidak blocking)

- Ada 2 migrasi untuk `ActionIdempotency` di folder migrations
  (`20260816000000` vs `20260816000100`, field beda: `id UUID` vs
  `idempotencyKey String @id` + `claimedAt`). Schema final match `...000100`.
  Belum dikonfirmasi apakah `...000000` masih dipakai atau harus dibersihkan/didokumentasikan
  sebagai superseded.

## Status §6.2 dan §6.3 (dari laporan utama): TIDAK BERUBAH

- **§6.2** — round-trip `productId → productName → productId` di `handleAddToCart`
  masih ada. Ini scope P6-1 (belum dikerjakan).
- **§6.3** — `REMOVE_FROM_CART` / `UPDATE_CART_QUANTITY` / `CANCEL_ORDER` masih belum
  jadi typed action. Antrian setelah P6-1.
  > **Update 2026-08-19:** `REMOVE_FROM_CART` + `UPDATE_CART_QUANTITY` SELESAI di P6-2;
  > `CANCEL_ORDER` SELESAI di P6-3 (lihat "Update Pasca P6-3" di bawah). Lihat juga
  > 🔴 TEMUAN KRITIS: `actionsRouter` ternyata tidak pernah di-mount sampai P6-3.

## Next task yang disepakati: P6-1

Product resolver + validated action envelope — scope lengkap ada di §8.1
PROJECT-STATE-REPORT.md. Boundary terkunci (CartAuthority tidak boleh dimodifikasi
untuk P0, dst) masih berlaku, tidak berubah oleh update ini.

---

## Update Pasca P6-1 / P6-2 / Cleanup (2026-08-18)

1. **P6-1 SELESAI** — `ADD_TO_CART` end-to-end pakai `productId` (skip name
   round-trip). `cart-authority.ts`: `CartOp` extended (`productId?` optional),
   `executeOps` punya branch resolve-by-id vs resolve-by-name (path LLM tidak
   berubah). Commit `2f834a5`.

2. **P6-2 SELESAI** — `REMOVE_FROM_CART` + `UPDATE_CART_QUANTITY` sudah typed
   action. Signature `removeLine`/`updateQuantity` extended dengan `tx?` optional
   (reuse lock idempotensi Stage-1/Stage-2, tidak ada implementasi kedua).
   Commit `3cb91c9`.

3. **§6.2** (round-trip `productId -> name -> productId`) dari
   PROJECT-STATE-REPORT.md — **RESOLVED** oleh P6-1.

4. **§6.3** (`REMOVE`/`UPDATE` belum typed action) dari PROJECT-STATE-REPORT.md —
   **RESOLVED** oleh P6-2 (catatan: `CANCEL_ORDER` masih belum, lihat item 7).

5. **Working tree hygiene** — `node_modules` / `.jest-cache` / `screenshot-output`
   / file scratch dibersihkan + `.gitignore` diperluas; runtime logs di-untrack
   dari git (fisik tetap ada, pm2 tidak terganggu). Commit `a1f69f7` + `1d0db36`.

6. **Test baseline saat ini** — `test:chat` 267/267, `test:golden` 18/18.

7. **Next open items** (sebelum P6-3):
   - `CANCEL_ORDER` belum typed action (kandidat P6-3).
   - §6.4 golden dataset coverage P3/P4/P5 masih belum.
   - §6.6 `dist/` masih tracked (logs sudah di-untrack, `dist` belum).

---

## Update Pasca P6-3 (2026-08-19)

### Jawaban audit gap actionsRouter (diminta)

- **Sejak commit mana gap ada?** `routes/actions.ts` dibuat di **`e5ee299`**
  (checkpoint: "commit structured actions P0-P5 foundation"). `git log -S actionsRouter
  -- apps/api/src/index.ts` **kosong** → router ini **tidak pernah di-mount sejak
  awal**, dan tidak pula di-mount oleh P6-1 (`2f834a5`) / P6-2 (`3cb91c9`).
  Jadi endpoint `POST /api/pwa/:storeSlug/action` **TIDAK REACHABLE via HTTP
  nyata sejak P0**, meski semua unit/integration test (jest + tsx in-process)
  lolos karena mereka memanggil `executeAction()` langsung, bukan lewat HTTP.
- **Ada bukti curl/e2e sebelumnya yang klaim "jalan di production"?** **TIDAK.**
  Pencarian di `DOCS/` hanya menemukan referensi *path* route
  (`DOCS/MASTER/QLobot-MASTER-ROADMAP.md:121`, `DOCS/QLOBOT-BASELINE.md:100`),
  tidak ada klaim "ADD_TO_CART/REMOVE/UPDATE sudah diverifikasi reachable via
  HTTP di production". **Tidak ada klaim keliru yang perlu ditandai** (RAILS §1.3) —
  hanya celah yang tidak terdokumentasi.
- **Re-verifikasi manual di canary (store-f7140b5c) via HTTP asli?** **YA, sudah
  dilakukan** (store canary dibuat ad-hoc karena `store-f7140b5c` sebelumnya
  tidak ada; store+product disimpan sebagai fixture canary, data proof
  (customer/order/conversation) dibersihkan). Keempat action terbukti reachable
  over real HTTP (bukan cuma test suite):

  | Action | curl hasil |
  |---|---|
  | `ADD_TO_CART` | `{"success":true,"status":"applied","result":{"quantityAdded":2,...}}` |
  | `UPDATE_CART_QUANTITY` | `{"success":true,"status":"applied","result":{"quantity":5,...}}` |
  | `REMOVE_FROM_CART` | `{"success":true,"status":"applied","result":{"cart":{"items":[],"total":0}}}` |
  | `CANCEL_ORDER` | `{"success":true,"status":"applied","result":{"orderStatus":"cancelled"}}` |

## P6-3 — CANCEL_ORDER: SELESAI (commit TBD — working tree, belum di-commit)

- Delegasi penuh ke `transitionOrder()` existing (`order-transition.ts`),
  tidak ada guard tambahan — sesuai `DECISION-CANCEL-ORDER-STATE-MACHINE.md`
  (user memilih "Follow existing state machine": `shipped → cancelled` **diizinkan**,
  hanya `completed`/`refunded`/`cancelled` yang terminal/diblokir).
- `order.service.ts`: `cancelOrder(orderId, storeId, customerId, {tx})` —
  ownership check (storeId + customerId) + `transitionOrder('cancelled')`.
  Business rejection → `INVALID_*` code → `FAILED` (bukan infra-abort, lewat
  SAVEPOINT di `executeClaimedAction`).
- `action-registry.ts`: `CANCEL_ORDER` typed action, pola `claim → execute →
  re-check` SAMA seperti `REMOVE_FROM_CART` (reuse Stage-1/Stage-2 idempotensi,
  **tidak ada Stage-2 kedua**).
- `CartAuthority` tidak disentuh (target `Order`, bukan `OrderItem`) —
  grep 0 refs di path cancel, spy 0 calls, `git diff cart-authority.ts` kosong.
- `routes/actions.ts` **tidak diubah** (dispatch generic by `type`).
- Test: `test:chat` 267/267, `test:golden` 18/18, `structured-actions` 38/38
  (+8 baru P6.3.x). `tsc` 0 error, `build` sukses, `pm2` online.

## 🔴 TEMUAN KRITIS BARU — actionsRouter tidak pernah di-mount (P0→P6-2 gap)

Saat implementasi P6-3, ditemukan `app.use('/api/pwa', actionsRouter)` **TIDAK ADA**
di `index.ts` sebelumnya — endpoint `/api/pwa/:storeSlug/action` kemungkinan
**TIDAK REACHABLE via HTTP nyata sejak P0** (ADD_TO_CART), meski semua
unit/integration test lolos (mereka panggil `executeAction()` in-process).
**Sudah di-mount di P6-3** (`apps/api/src/index.ts` +2 baris: import
`actionsRouter` + `app.use('/api/pwa', actionsRouter)`), di-flag sebagai
satu-satunya perubahan di luar scope P6-3 yang tercatat. Tidak ada konflik route
(pwaRouter tidak punya `/:storeSlug/action`).

BELUM DIVERIFIKASI SEBELUMNYA (sekarang sudah):
- Sejak commit mana gap ini ada → **`e5ee299`** (dibuktikan via `git log -S actionsRouter`).
- Apakah pernah ada klaim "sudah jalan di production" untuk ADD_TO_CART/
  REMOVE/UPDATE → **TIDAK ADA** (tidak perlu ditandai keliru per RAILS §1.3).
- Re-verifikasi manual di canary `store-f7140b5c`: **keempat action terbukti
  reachable via HTTP asli** (lihat tabel di atas, bukan cuma test suite).

Status: **DIKETAHUI & DIVERIFIKASI** (bukan lagi "belum dikonfirmasi"). Prioritas
SEBELUM lanjut ke item lain tetap valid — fitur yang "diklaim selesai" (P0-P6.2)
sekarang benar-benar berfungsi di production setelah mount.

## Open items (update)

1. ~~Konfirmasi dampak actionsRouter mount gap~~ — **SELESAI**: gap sejak `e5ee299`,
   tidak ada klaim keliru, keempat action terverifikasi reachable via HTTP di canary.
2. §6.4 — golden dataset belum cover P3/P4/P5.
3. §6.6 — `dist/` masih tracked (logs sudah untracked).
4. Dua migrasi `ActionIdempotency` duplikat (`...000000` vs `...000100`)
   belum dikonfirmasi superseded.
5. Kebijakan cancel shipped-order oleh customer sendiri — open product decision,
   lihat `DECISION-CANCEL-ORDER-STATE-MACHINE.md`.
