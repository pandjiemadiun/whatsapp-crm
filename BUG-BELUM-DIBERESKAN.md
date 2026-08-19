# BUG TERBUKA — indeks temuan belum dibereskan (update 10 Agu 2026 16:45 UTC)

> Daftar **temuan / bug / risiko yang belum dibereskan** sepanjang sesi
> (P0–P4). Semua referensi ke `STATUS-V2.md`, `RAILS.md`, atau file:src:line
> di commit HEAD `29b7297`.
>
> **Kongsi (1) sudah ditutup oleh kerja P2/P3/P4** — tidak masuk daftar ini
> agar tidak dobel:
> - P4.1: `extractAndSaveOrder` (I13 violation, provider drift, I8 gap, no-test)
>   → **RESOLVED** (fungsi+hapus). Lihat `laporan-taskP4-fix.md`.
> - P3: T1–T4 (workspace persist NO-OP, shape extractedEntities, legacy migrasi,
>   last-write-wins RMW) → **RESOLVED** (commit c164729/3780453/eb74929/099967a/fd08ba3).
> - P2: truth boundary `validateCartOpsAgainstDb` di semua titik eksekusi → **RESOLVED**.
> - P2: eskalasi ke pemilik toko (TASK C1) → **RESOLVED** (commit 718c375).
> - 9/8 10:45: FLAGSHIP multi-add → **RESOLVED** (fast-path guard).
> - T1 workspace NO-OP → bagian dari P3 (RESOLVED).

---

## I. BUG PRODUKSI (nyata, user terdampak)

| ID | Bug | Lokasi | Severity | Note |
|----|-----|--------|----------|------|
| I-1 | **Qty 0 tampil di receipt** ("Brambang (0x)") | STATUS-V2:20; composer/Receipt | ~~Medium~~ ✅ **RESOLVED (STALE DOC, 19 Agu 2026)** | Verifikasi ulang source: SEMUA titik render cart/order ke customer SUDAH filter `qty<=0` — bukan bug lagi. (1) `fallback.service.ts:702` (`FIX B`, commit `f4ab025`) filter sebelum render `Rincian` `(qx)` di :730. (2) `conversation.service.ts:257` (`visibleCart`) + `renderCartSummary` filter `:1006` (commit `daa0d43` = P5.1 I-1a). (3) `composer-v2.ts:81` `displayQty = qty>0?qty:1` (P5.1 I-1a, commit `daa0d43`). Tidak ada perubahan kode — murni display-layer sudah beres; dokumen stale. |
| I-2 | **Reply resolved terpotong** ("adari?") | STATUS-V2:21 (composer-v2) | Low (kosmetik) | Balasan terpotong di akhir; tidak memblok proses. |
| I-3 | **`activeOrder`/`tryTotal` tidak diskriminatif `draft` vs `pending`** — dapat memilih baris `pending` (dari `createOrder`, harga dari LLM/ops) jadi order aktif, mirip pola phantom yang sama seperti `extractAndSaveOrder`. | conversation.service.ts:829 (activeOrder: `orderBy createdAt desc, notIn shipped/delivered/cancelled`); fallback.service.ts:649-661 (`tryTotal`/`lastOrder` fallback) | High (bisa double-count / pick stale) | **Satu-satunya temuan P4 yang masih relekan** setelah `extractAndSaveOrder` dihapus — sebab `createOrder` (:393) masih menulis `orderStatus:'pending'` (`items` price bisa null/lepas DB pada jalu LLM). Perlu: `activeOrder`/`tryTotal` eksklusif ambil `draft` (atau filter `draft` eksplisit). | ✅ **RESOLVED (P4.2, 11 Agu 2026)** — `activeOrder` dan `tryTotal`/`lastOrder` fallback sekarang query `draft` eksklusif dulu, fallback ke `pending`+lain HANYA bila tidak ada draft. Verifikasi: createOrder hanya dipanggil dari test, harganya valid DB (bukan phantom). Plus perbaiki bug pre-existing `JSON.parse(lastOrder.items as string)` (Prisma Json → JS array). Manual test: draft@36000 + pending@24000 → "total belanja" jawab Rp 36.000 (draft). |

---

## II. TEST / CI (gagal, blocker kualitas)

| ID | Bug | Lokasi | Severity | Note |
|----|-----|--------|----------|------|
| II-1 | **reasoning-v2 test outdated** — kasus "Validator reject terminal (low confidence) → fallback, llmCalls=1, JANGAN retry" ekspektasi `fallback_reasoning_failed` tapi dapat `reasoned`. | reasoning-v2.test.ts:316 | High (1 failed test, part of baseline) | STATUS-V2:22. Harusnya expect `reasoned`. |
| II-2 | **engine-config-v2 suite gagal load** (STALE) — dulu laporkan `ReferenceError: Cannot access 'redisAdapter' before initialization` di `container.ts:38`. | container.ts:38; engine-config-v2.test.ts | ~~High~~ ✅ **RESOLVED (STALE DOC, 19 Agu 2026)** | Audit read-only: `engine-config-v2.test.ts` LULUS **6/6** konsisten (di-run 6x, full `test:chat` **267/267** tiap kali). TDZ `container.ts:38` **TIDAK direproduksi ulang**. Root cause dulu tidak bisa dikonfirmasi ulang; cycle import `container.ts`↔`cloudinary/r2/gowa.adapter.ts` tetap ada di source tapi benign (semua akses `adapters.` di dalam method, bukan top-level → tidak TDZ). Lihat III-10. |
| II-3 | **Test bug golden-dataset Case B3-b** — `assert.equal` (strict `===`) pada array `audit.stagesReached`, selalu gagal (reference inequality). | golden-dataset.test.ts:726 | Low | PRE-EXISTING (commit HEAD 2ab32ef). Owner: "skip (b), jangan fix". |
| II-4 | **Test-data gap golden-dataset Case 1** — seed `store-golden-test` tidak punya `woltel`/`brambang`, hanya `beras`. Di bawah validasi DB (P2) produk tak ada diskipping → case "pass" lama jadi "fail". | golden-dataset.test.ts:303; BASE_PRODUCTS | Low (test-data, bukan logic) | Owner-flagged 10 Agu: "pemilikputuskan" — butuh `woltel`/`brambang` ditambah ke seed atau BASE_PRODUCTS. |
| II-5 | **Test DB shared / weak isolation — row `ActionIdempotency` dari auth.ts registration flow bocor ke assertion test lain** (P8-2). Kasus nyata: `structured-actions.test.ts:1039` (P6.3.2) query `findMany({ where: { actionType: 'CANCEL_ORDER' } })` TANPA filter `storeId` → ketemu row asing `storeId='store-f7140b5c'` (pattern `store-${crypto.randomUUID().slice(0,8)}` dari `src/routes/auth.ts:31`) → false negative (dianggap handler bikin record padahal handler benar: `executeAction` sudah `safeParse` sebelum handler/claim). Diselesaikan di P8-2 dengan scope assertion ke `storeId` file sendiri (commit `dd7e7f2`), TAPI ini cuma penambal sempit. | structured-actions.test.ts:1038-1039 (sebelum fix); src/routes/auth.ts:31; BUG-BELUM-DIBERESKAN II-5 | 🟡 **AUDITED — 0 assertion rawan ditemukan** (full-scan `src/tests/`, 19 Agu 2026). Root cause asli (cleanup per-prefix, row lintas-file `store-f7140b5c` survive) **TETAP ADA** secara teknis, TAPI currently harmless karena SELURUH assertion `actionIdempotency`/`order`/`orderItem` sekarang ter-scope `storeId` / `conversationId` / composite-unique (`storeId_customerId_actionType_actionId`). Downgrade dari "follow-up task terpisah" → **hygiene debt**: re-audit kalau ada file test BARU yang query `actionIdempotency`/`order` tanpa scope eksplisit. JANGAN hapus row `store-f7140b5c` manual — itu milik test flow lain / canary. |
| II-6 | **P8 CI gate tidak men-cover structured-actions suite** — `.github/workflows/test.yml` cuma jalankan `test:chat` + `test:golden`; `structured-actions*.test.ts` (ADD/REMOVE/UPDATE/CANCEL/CONTACT_ADMIN + P0-P5 foundation, 115 test) TIDAK ter-cover CI → regresi cluster bisa lolos tidak terdeteksi (pola masalah P6 lama: golden dataset dulu juga begini sebelum P6.3). | `.github/workflows/test.yml`; task STATUS-SYNC 19 Agu 2026 | High (CI gap) | ✅ **RESOLVED (P8-CI-FIX, commit `c6be2d8`, 19 Agu 2026)** — `apps/api/package.json` tambah script `test:structured` (glob `src/tests/structured-actions*.test.ts`); `.github/workflows/test.yml` tambah step `Run test:structured` SETELAH `test:golden` (MUST pass, 0 failure). Verifikasi lokal: `npm run test:structured` → 115 tests / 7 suites pass. CI sekarang gate penuh: test:chat (baseline-tolerant) + test:golden + test:structured. |

---

## III. INFRA / KEANDALAN / HYGIENE (bukan bug user langsung, tapi risk)

| ID | Risiko / Bug | Lokasi | Severity | Note |
|----|--------------|--------|----------|------|
| III-1 | **`dist/` ter-commit + deploy tanpa build otomatis** — stale `dist` bisa jalan di produksi. | RAILS §1.158; ecosystem.config.js:6 (`script:'dist/index.js'`); commit 5f502d1 (cleanup orphan dist) | High (infra) → **MITIGASI** | ✅ **MITIGASI (III-1-B, commit `bcddfcd`, 19 Agu 2026):** git hook `post-merge` auto-build terpasang (jalankan `npm run build` setelah merge/pull sehingga `dist/` selalu sync dengan source — lihat `RAILS.md` §4.1). `dist/` MASIH ter-track di git (belum di-untrack) karena untrack ditunda sampai hook terbukti handal di deploy nyata (VPS `vps3541799`) — jangan `git rm --cached` sembarangan sebelum yakin. Pre-commit checklist (§1.164) tetap belum ada; mitigasi utama sekarang adalah post-merge hook + kebiasaan `git status` menyeluruh + `npm run build` sebelum klaim selesai. |
| III-2 | **`logs/*.log` ter-track di git** — berisiko data WA customer/nomor terlibat commit. | apps/api/logs/*.log; RAILS §1.160 | ~~High (keamanan)~~ ✅ Fase A + Fase B SELESAI (SHA `469804a`→`73f607b`; backup `/home/ubuntu/backups/garuda-backup-20260819.bundle`) | Sudah di-exclude + di-purge dari history. |
| III-3 | **Tidak ada pre-commit hook / checklist otomatis** (tsc, build, test). | RAILS §1.164 | Medium | Manual tiap kali. |
| III-4 | **P3 T5: fallback tier overlap** (v1↔v2↔shadow). | STATUS-V2:199-200 | 🟡 **PARTIALLY STALE — audited 19 Agu 2026** | T5 asli (overlap `extractedEntities`) sudah bukan masalah; intent-tier overlap V1 sudah ditutup B3/B4 (`fallback.service.ts:418/495/567/643`). Sisa NYATA: `saveDiscussedItems` (`fallback.service.ts:935` findUnique → `:964` upsert) **TANPA atomicCas** meski docstring `:908` klaim pakai — docstring stale. Risiko LOW–MEDIUM, butuh 2 pesan konkuren 1 conversation. NEW FINDING terpisah: `trySop` kategori `order_status` (`fallback.service.ts:762`) duplikat `ORDER_STATUS_KEYWORDS` tanpa gate (hanya `'retur'` di-gate `:779`) → bisa jawab SOP untuk query yang sengaja di-MISS-kan B4.1. Lihat §V (a) — perlu audit terpisah, BUKAN scope III-4 lama. |
| III-5 | **Race lastWrite-wins `appendMessage` lastMessages**. | STATUS-V2:200 | 🟢 **LOW (bukan Medium)** — audited 19 Agu 2026 | `appendMessage` (`conversation-context.service.ts:159-170`) RMW polos di `lastMessages` — kolom BEDA dari yang di-lock P3.4 (`extractedEntities`/`workspace_v2`). History durabel aman (`conversation.service.ts:1246`). Dampak max: 1 entry hilang di context window 10 pesan + urutan, butuh 2 turn konkuren. Kualitas konteks LLM, BUKAN data loss. |
| III-6 | **Golden dataset invarian I8–I15: masih test unit parsial**, bukan 50-case permanen. | STATUS-V2:44; RAILS "golden dataset + test invarian permanen I8-I15 — baru test unit parsial" | Medium (regression coverage) | Next yang direncakan sejak 9/8. |
| III-7 | **I11: kamus slang normalizer** (`toralin`→`total`) typo lolos ke tier total. | STATUS-V2:42 (normalizer.ts) | ✅ **RESOLVED (FIX-1, 19 Agu 2026, commit `e6c7157` — lihat git log)** | Klaim literal STALE (sudah di dict+test). Edge case case-sensitivity DITUTUP: lookup typo sekarang lowercase (`normalizer.ts:153`), test baru `"Toralin brp"`→`"total berapa"` (`normalizer.test.ts`). RISK LOW, tertutup. |
| III-8 | **I12: guard nama produk di normalizer**. | STATUS-V2:43 | ✅ **RESOLVED (FIX-1, 19 Agu 2026, commit `e6c7157` — lihat git log)** | Guard `fuzzyMatchProduct` + lookup typo sekarang case-insensitive; TAMBAH multi-word product guard (frasa utuh di-guard, tidak dimutasi). Test baru `normalize('ada Ready Pack',['Ready Pack'])`→`'ada Ready Pack'`. Caller `conversation.service.ts:616` aman. RISK LOW–MED, tertutup. |
| III-9 | **`LEASE_FINAL_MS = 750` (action-registry.ts:22) adalah 750 MILIDETIK, bukan 750 detik** — kontrak PROJECT-CONTRACT-STRUCTURED-ACTIONS.md §6A.5 menargetkan lease 30–60 detik. Mismatch kemungkinan warisan implementasi P0 lama; ditemukan saat baca line untuk audit idempotency P7. Dampak: lease recovery claim macet terlalu singkat (750ms) → concurrency tinggi bisa claim ganda dalam jendela sempit, atau recovery CLAIMED terlalu agresif. **DI LUAR SCOPE P7** (RAILS §1.4) — jangan diperbaiki di P7. | apps/api/src/business/action-registry.ts:22; DOCS/CONTRACT/PROJECT-CONTRACT-STRUCTURED-ACTIONS.md §6A.5 | Low–Medium (idempotency edge) | ✅ **RESOLVED** — `LEASE_FINAL_MS` 750ms→30000ms (30s), owner-decided interim value sesuai batas bawah kontrak §6A.5 (III-9, 19 Agu 2026). Belum berbasis pengukuran nyata (tidak ada benchmark p99 `executeOps()` di repo) — kalau nanti ada data production, boleh dikoreksi berbasis bukti, bukan sekarang. |
| III-10 | **Cycle import `container.ts` ↔ 3 adapter** (latent, currently benign) — `cloudinary.adapter.ts:2`, `r2.adapter.ts:4`, `gowa.adapter.ts:2` masing-masing `import { adapters } from '../container.js'`, sementara `container.ts:5-7` static-import balik ke-3 adapter itu. | container.ts:5-7; cloudinary.adapter.ts:2; r2.adapter.ts:4; gowa.adapter.ts:2 | Low (latent, currently benign) | Cycle NYATA di source (production-adjacent). **TIDAK memicu TDZ saat ini** karena SELURUH akses `adapters.` ada DI DALAM method (cloudinary:74, r2:99+, gowa:47+), bukan top-level → re-entran eval aman. Rawan kalau kelak ada refactor yang akses `adapters` di top-level (bisa TDZ saat cold-start / race import — persis kelas error yang dulu dilaporkan di II-2). Rekomendasi: pecah cycle pakai **lazy / dynamic-import** (pola yang SUDAH ada di `engine-config.ts` via `getRedis()`), TANPA ubah behavior `container.ts`. Task kecil terpisah — bukan blocker, dan TIDAK dikerjakan tanpa approval owner (audit II-2 konfirmasi tidak reproducible saat ini). |

---

## IV. STATUS ringkasan (temuan P4.0 yang dicatat di §4 laporan-audit)

| # | Temuan P4.0 | Status @ 29b7297 |
|---|-------------|------------------|
| 1 | I13 violation di `extractAndSaveOrder` (price null, items tak tervalidasi DB) | ✅ **RESOLVED** — fungsi dihapus (P4.1). |
| 2 | Provider/config drift (Gemini vs Groq, tanpa jsonMode) | ✅ **RESOLVED** — fungsi dihapus. |
| 3 | I8 accounting gap (LLM ke-3 tak increment counter) | ✅ **RESOLVED** — fungsi dihapus. |
| 4 | `activeOrder`/`tryTotal` tidak diskriminatif `draft` vs `pending` | ⏳ **TERBUKA** → masuk I-3 di atas. |
| 5 | Tidak ada test real untuk `extractAndSaveOrder` (hanya no-op mock) | ✅ **RESOLVED** — fungsi+mock dihapus; golden tetap pass. |

---

## V. Rekomendasi urutan (prioritas)

1. **I-3 (draft-vs-pending discrimination)** — ditutupkan *sebenarnya* oleh penghapusan
   `extractAndSaveOrder`, tapi **tetap terbuka lewat `createOrder`**. Prioritas tinggi:
   buat `activeOrder`/`tryTotal` eksklusif pilih `draft`, atau tag order `pending`
   yang pernah punya harga-DB-only. Tanpa ini, pola phantom **bisa kembali** lewat
   jalur LLM lain.
2. **II-2 (engine-config-v2 suite)** — urut inisialisasi `redisAdapter` di
   `container.ts:38`; blokir 1 suite test.
3. **III-1 / III-2 (dist + logs di-track)** — paling penting untuk *keandalan &
   keamanan* jangka panjang; butuh pre-commit hook (§1.164).
4. **I-1 (qty 0 receipt)** — cepat (filter), visible ke customer.
5. Sisa kosmetik / test-data (I-2, II-1, II-3, II-4, III-4/5/6/7/8).

### V-a/b. NEW FINDING — audit lanjutan (bukan dikerjakan sekarang)

- **(a) `trySop` order_status gate gap** (dari III-4): ✅ **RESOLVED (FIX-2, 19 Agu 2026, commit `e50de65`)** — kategori `'order_status'` DIHAPUS dari `trySop` (`fallback.service.ts`) karena redundant; `tryOrderStatus` (jalur dengan gate `isOrderStatusIntent`) sudah jalan LEBIH AWAL di chain dan menangani kasus itu. Tidak ada test yang bergantung pada `trySop` menjawab `order_status`. Regresi ditambah di `tier-match.test.ts` (keyword eks- trySop tetap true via `isOrderStatusIntent`).
- **(b) normalizer case-sensitivity** (gabung III-7 edge + III-8 multi-word): ✅ **RESOLVED di `84ad070`** — lihat III-7/III-8 (sudah RESOLVED). Tidak ada sisa follow-up.

> Catatan: daftar ini **tidak** memasukkan `extractAndSaveOrder` (sudah dibereskan
> P4.1) ataupun T1–T4 P3 / eskalasi C1 / multi-add FLAGSHIP / truth-boundary P2
> (semua sudah resolved & ter-commit, lihat STATUS-V2.md).
