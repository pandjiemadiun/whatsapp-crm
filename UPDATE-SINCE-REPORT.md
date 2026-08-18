# UPDATE-SINCE-REPORT

Dokumen ini mencatat update/perubahan yang terjadi SETELAH PROJECT-STATE-REPORT.md
dibuat, agar laporan utama tidak perlu ditulis ulang setiap ada progres.

## Update Pasca P6-1 / P6-2 / Cleanup (2026-08-18)

1. **P6-1 SELESAI** — `ADD_TO_CART` end-to-end menggunakan `productId`
   (skip name round-trip). `cart-authority.ts`: `CartOp` diperluas
   (`productId?` optional), `executeOps` punya branch resolve-by-id vs
   resolve-by-name (path LLM tidak berubah). Commit `2f834a5`.

2. **P6-2 SELESAI** — `REMOVE_FROM_CART` + `UPDATE_CART_QUANTITY` sudah
   typed action. Signature `removeLine`/`updateQuantity` diperluas dengan
   `tx?` optional (reuse lock idempotensi Stage-1/Stage-2, tidak ada
   implementasi kedua). Commit `3cb91c9`.

3. **§6.2** (round-trip `productId -> name -> productId`) dari
   PROJECT-STATE-REPORT.md — **RESOLVED** oleh P6-1.

4. **§6.3** (`REMOVE`/`UPDATE` belum typed action) dari
   PROJECT-STATE-REPORT.md — **RESOLVED** oleh P6-2.

5. **Working tree hygiene** — `node_modules` / `.jest-cache` /
   `screenshot-output` / file scratch dibersihkan + `.gitignore`
   diperluas; runtime logs di-untrack dari git (fisik tetap ada, pm2 tidak
   terganggu). Commit `a1f69f7` + `1d0db36`.

6. **Test baseline saat ini** — `test:chat` 267/267, `test:golden` 18/18.

7. **Next open items**:
   - `CANCEL_ORDER` belum typed action (kandidat P6-3).
   - §6.4 golden dataset coverage P3/P4/P5 masih belum.
   - §6.6 `dist/` masih tracked (logs sudah di-untrack, `dist` belum).
