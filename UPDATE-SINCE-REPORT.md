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

- **Migrasi `ActionIdempotency` — RESOLVED (diklarifikasi, tidak ada file dihapus):**
  ada 2 migrasi di folder (`20260816000000_add_action_idempotency` vs
  `20260816000100_correct_action_idempotency_schema`), field beda:
  `...000000` = CREATE TABLE (`id` UUID PK), `...000100` = ALTER TABLE
  (RENAME `id` → `idempotencyKey`, ubah PK + tambah `claimedAt`).
  **RANTAI prerequisite, BUKAN duplikat.** Bukti: query `_prisma_migrations`
  → keduanya `finished = t` (applied di DB dev). Keputusan: **kedua folder
  migrasi TETAP ADA, tidak dihapus** (menghapus `...000000` akan rusak
  `prisma migrate deploy` di environment fresh karena `...000100` mengubah
  tabel yang dibuat `...000000`).

## Status §6.2 dan §6.3 (dari laporan utama): **RESOLVED**

- **§6.2** — round-trip `productId → productName → productId` di `handleAddToCart`
  **SUDAH DIHILANGKAN** di P6-1 (commit `2f834a5`): structured `ADD_TO_CART` sekarang
  mengirim `productId` langsung ke `CartAuthority.executeOps`, yang pakai
  `resolveProductById` (skip `resolveProductByName`). Terverifikasi di P6-6/P6-7
  (diff `git show 2f834a5` + `npm run build` exit 0 di HEAD).
- **§6.3** — `REMOVE_FROM_CART` + `UPDATE_CART_QUANTITY` sudah typed action di P6-2
  (commit `3cb91c9`); `CANCEL_ORDER` di P6-3 (commit `ced2fc9`).
- **🔴 TEMUAN KRITIS (P6-3): `actionsRouter` tidak pernah di-mount sejak `e5ee299`** —
  `app.use('/api/pwa', actionsRouter)` tidak ada di `index.ts` sampai `ced2fc9`, sehingga
  `POST /api/pwa/:storeSlug/action` **404 / tidak reachable via HTTP nyata** untuk
  ADD/REMOVE/UPDATE/CANCEL sejak P0. Ketahuan lewat **curl HTTP asli ke canary**
  (bukan test suite — test lolos karena panggil `executeAction()` in-process). Fix:
  router di-mount di `ced2fc9`; keempat action terverifikasi reachable via HTTP nyata.

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
2. ~~§6.4 — golden dataset belum cover P3/P4/P5.~~ — **RESOLVED (P6-5, `dba92b8`)**,
   lihat "Update Pasca P6-5" di bawah.
3. §6.6 — `dist/` masih tracked (logs sudah untracked).
4. ~~Dua migrasi `ActionIdempotency` duplikat (`...000000` vs `...000100`)
   belum dikonfirmasi superseded~~ — **RESOLVED (diklarifikasi): BUKAN
   duplikat, melainkan rantai prerequisite (create → alter) yang keduanya
   applied di DB; kedua folder migrasi tetap ada, tidak dihapus.**
5. Kebijakan cancel shipped-order oleh customer sendiri — open product decision,
   lihat `DECISION-CANCEL-ORDER-STATE-MACHINE.md`.

---

## Update Pasca P6-5 (2026-08-19) — §6.4 golden coverage P3/P4/P5: **RESOLVED**

Commit: `dba92b8` (`test(golden): tambah coverage P3/P4/P5 ...`). **Hanya 1 file test
berubah** (`apps/api/src/tests/golden-dataset.test.ts`, +432 baris) — tidak ada source
logic (`conversation.service.ts` / `order.service.ts` / `composer-v2.ts` /
`cart-authority.ts` / `action-registry.ts`) yang disentuh.

### Koreksi klaim lama (RAILS §1.3)

Klaim di `laporan-taskP6-audit.md` / §6.4 PROJECT-STATE-REPORT "golden dataset TIDAK punya
test case untuk P3/P4/P5" **sudah kedaluwarsa**: case P6.4a/b/c sudah masuk sejak
`dcf35c8` (P3), `d2e99ff` (P4), `f9a8cdf` (P5) — itulah kenapa baseline sudah 18/18.
Pekerjaan P6-5 karena itu difokuskan ke pertanyaan yang lebih tajam: **apakah case-case itu
benar-benar GAGAL kalau fix-nya di-revert?** Diukur dengan mutation test (revert 1 baris
fix di working tree, jalankan `test:golden`, lalu `git checkout --` restore).

### Hasil mutation test (bukti case lama vs case baru)

| Mutation (revert 1 baris fix) | Case lama | Case baru P6-5 |
|---|---|---|
| P3: `saveWorkspaceV2()` (conversation.service.ts:360) dimatikan | `Case P3` + `G2-D.8` **MERAH** | `P6-5/P3` **MERAH** |
| P4.1: writer phantom ala `extractAndSaveOrder` dihidupkan lagi (baris Order `pending` kedua) | `Case P4` **HIJAU — celah** | `P6-5/P4` **MERAH** |
| P4.2: draft-first di `tryTotal` (fallback.service.ts:666) di-revert | `Case P4` **MERAH** | — (tidak diduplikasi) |
| P5 I-1a: `filter(qty>0)` → `Number(i.qty \|\| 1)` (conversation.service.ts:261) | `Case P5` **HIJAU — celah** | `P6-5/P5a` **MERAH** (Rp 20.000 vs Rp 12.000) |
| P5 I-2 L1: truncate di composer-v2.ts:68 dihapus | `Case 8` + `Case P5` **HIJAU — celah** | `P6-5/P5b` **MERAH** |
| P5 I-2 L2: safety-net `truncateTo2Sentences` (conversation.service.ts:373) dihapus | `Case 8` + `Case P5` **HIJAU — celah** | `P6-5/P5b` **MERAH** |
| P5.2: simbol qty `x` ASCII → `×` (conversation.service.ts:1012) | tidak ada case | `P6-5/P5c` **MERAH** |

Semua mutation di-restore (`git checkout -- <file>`), tidak ada perubahan source permanen;
setelah restore `test:golden` hijau kembali 23/23.

### 5 case baru

1. **`Case P6-5/P3`** — engine v2, turn 1 clarification → turn 2 "iya". Assert RAW kolom
   `workspace_v2` memuat pending turn-1, RAW `extractedEntities` TIDAK memuatnya (bukan
   dual-writer legacy), dan turn 2 resolve **0 LLM** (state terbaca kembali).
2. **`Case P6-5/P4`** — 2 turn belanja di jalur V1 (tempat call-site
   `extractAndSaveOrder` dulu berada). Assert **tepat 1 baris Order** (`draft`) untuk
   1 percakapan, `id` sama antar-turn (draft di-reuse), **0 baris `pending`**, plus guard
   statis `orderService.extractAndSaveOrder === undefined`.
3. **`Case P6-5/P5a`** — I-1a: keranjang punya sisa item qty=0; jalur V2 resolved wajib
   melaporkan `Total belanja Kakak: *Rp 12.000*` (bukan Rp 20.000).
4. **`Case P6-5/P5b`** — I-2 dua lapis: (L1) `composeReply()` dipanggil langsung (pola sama
   Case 2/6 yang memanggil `normalize()`) → reply_draft 4 kalimat jadi 2; (L2) skenario
   `info_answer` + `topic_switch` di mana composer tidak bisa truncate sendiri → safety-net
   di conversation.service.ts yang memotong.
5. **`Case P6-5/P5c`** — P5.2: ringkasan keranjang pakai `beras x1` (ASCII), dan `×`
   (U+00D7) tidak boleh muncul.

### Test baseline baru

- `test:golden`: **23/23 pass** (naik dari 18/18).
- `test:chat`: **23 suites / 267 tests pass** (tidak ada regresi).
- `npx tsc --noEmit` exit 0, `npm run build` exit 0 (`src/tests` di-exclude tsconfig →
  `dist/` tidak berubah).

