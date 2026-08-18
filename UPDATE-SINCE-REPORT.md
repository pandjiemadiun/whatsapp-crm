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

7. **Next open items**:
   - `CANCEL_ORDER` belum typed action (kandidat P6-3).
   - §6.4 golden dataset coverage P3/P4/P5 masih belum.
   - §6.6 `dist/` masih tracked (logs sudah di-untrack, `dist` belum).
