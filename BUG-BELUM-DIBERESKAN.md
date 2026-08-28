# BUG TERBUKA — indeks temuan belum dibereskan (update 10 Agu 2026 16:45 UTC; REVISI 21 Agu 2026: +§VI shipping/Store NOT NULL/monitoring)

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

## 0. BUG TERATASI (ditemukan saat testing G2-F3, 20 Agu 2026) — interpreter maxTokens truncation

- **Gejala:** SETIAP pesan chat balas `"Maaf kak, saya kurang paham. Bisa diulang?"`
  (dead-end fallback `conversation.service.ts:711`) — chat praktis mati.
- **Root cause:** model Gemini primary (`gemini-3.6-flash`) memancarkan ~140 "thinking"
  tokens yang dihitung DALAM kuota `maxOutputTokens`. `interpreter.ts` (`runOneCall`)
  memakai `maxTokens: 250` → JSON `InterpreterResultV2` ter-potong di tengah objek →
  `JSON.parse` gagal → `runOneCall` return `null` → Stage 5 dead-end. Gemini tetap
  HTTP 200 sehingga gateway TIDAK fallback ke Groq.
- **Fix:** `interpreter.ts` `maxTokens: 250 -> 1024` (selaras `GPT_OSS_MAX_TOKENS_FLOOR`
  di `groq.adapter.ts`) + `extractJson()` hardening (toleransi markdown fence).
- **Status:** ✅ RESOLVED — commit `81ea8a6` (`fix(chat): interpreter maxTokens 250->1024
  + extractJson hardening`). Verifikasi E2E via PWA `/message` (balasan normal, bukan
  dead-end) + 40/40 test pass (interpreter/reasoning-v2/pwa-checkout).
- **Dampak:** TIDAK ADA customer terdampak — website belum rilis (konteks severity, bukan
  alasan skip proses). Ditemukan opportunistically saat testing G2-F3; di luar scope
  TASK G2-F3 asli, tapi genuinely blocking sehingga langsung diperbaiki & diverifikasi
  lengkap sebelum dilaporkan (exception RAILS §1.4).

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
| II-1 | **reasoning-v2 test outdated** — kasus "Validator reject terminal (low confidence) → fallback, llmCalls=1, JANGAN retry" ekspektasi `fallback_reasoning_failed` tapi dapat `reasoned`. | reasoning-v2.test.ts:316; reasoning.ts:328-338 | High (1 failed test, part of baseline) | STATUS-V2:22. Awalnya test ekspektasi `fallback_reasoning_failed` tapi code return `reasoned` — ini **stale test assertion, BUKAN code bug**. ✅ **RESOLVED** — code `reasoning.ts:328-338` SUDAH return `reasoned` (outcome `reasoned`, `plannedActs=[]`, step `clarification_trigger`) untuk terminal I-V2-6 sejak commit `f4ab025` (8 Agu 2026, "feat(chat): engine v2 canary - storeId fix, resolved handler, few-shot multi-add, e2e tests + STATUS") yang MEMANG menambahkan blok `clarification_trigger` tersebut. Assertion test diperbaiki ke `reasoned` di commit `4fc6730` (15 Agu 2026, "fix(pwa): resolve 5 critical chat UI bugs") — commit itu HANYA mengubah assertion test + komentar doc, TIDAK ada perubahan logic code (`git show 4fc6730 -- reasoning.ts` hanya ubah komentar). Test deterministik PASS (bukan flaky): re-run `npx tsx --test reasoning-v2.test.ts` → "Validator reject terminal I-V2-6 (low selection confidence) → clarification_trigger ... ✔", 0 failure. Correction 20 Agu 2026 (G2-F2-DOCS-CORRECT): FIX-B SALAH simpulkan "FLAKY / TETAP OPEN" — saat FIX-B (20 Agu) test sudah assert `reasoned` (sudah di-fix di `4fc6730`, 15 Agu) sehingga deterministik PASS; tidak ada keterlibatan `container.ts:38` dan tidak ada flakiness. Penyebab awal = stale test assertion (sudah tertutup `4fc6730`), code tidak pernah rusak. |
| II-2 | **engine-config-v2 suite gagal load** (STALE) — dulu laporkan `ReferenceError: Cannot access 'redisAdapter' before initialization` di `container.ts:38`. | container.ts:38; engine-config-v2.test.ts | ~~High~~ ✅ **RESOLVED (STALE DOC, 19 Agu 2026)** | Audit read-only: `engine-config-v2.test.ts` LULUS **6/6** konsisten (di-run 6x, full `test:chat` **267/267** tiap kali). TDZ `container.ts:38` **TIDAK direproduksi ulang**. Root cause dulu tidak bisa dikonfirmasi ulang; cycle import `container.ts`↔`cloudinary/r2/gowa.adapter.ts` tetap ada di source tapi benign (semua akses `adapters.` di dalam method, bukan top-level → tidak TDZ). Lihat III-10. — ✅ **RESOLVED** — root cause sudah ditangani FIX-5 (commit `6385322`, III-10, cycle import `container.ts`↔adapter diputus). Correction 20 Agu 2026: FIX-B sempat salah simpulkan "flaky" karena grep scope tidak mencakup file adapter yang sebenarnya diubah. |
| II-3 | **Test bug golden-dataset Case B3-b** — `assert.equal` (strict `===`) pada array `audit.stagesReached`, selalu gagal (reference inequality). | golden-dataset.test.ts:726 | Low | PRE-EXISTING (commit HEAD 2ab32ef). Owner: "skip (b), jangan fix". |
| II-4 | **Test-data gap golden-dataset Case 1** — seed `store-golden-test` tidak punya `woltel`/`brambang`, hanya `beras`. Di bawah validasi DB (P2) produk tak ada diskipping → case "pass" lama jadi "fail". | golden-dataset.test.ts:303; BASE_PRODUCTS | Low (test-data, bukan logic) | Owner-flagged 10 Agu: "pemilikputuskan" — butuh `woltel`/`brambang` ditambah ke seed atau BASE_PRODUCTS. |
| II-5 | **Test DB shared / weak isolation — row `ActionIdempotency` dari auth.ts registration flow bocor ke assertion test lain** (P8-2). Kasus nyata: `structured-actions.test.ts:1039` (P6.3.2) query `findMany({ where: { actionType: 'CANCEL_ORDER' } })` TANPA filter `storeId` → ketemu row asing `storeId='store-f7140b5c'` (pattern `store-${crypto.randomUUID().slice(0,8)}` dari `src/routes/auth.ts:31`) → false negative (dianggap handler bikin record padahal handler benar: `executeAction` sudah `safeParse` sebelum handler/claim). Diselesaikan di P8-2 dengan scope assertion ke `storeId` file sendiri (commit `dd7e7f2`), TAPI ini cuma penambal sempit. | structured-actions.test.ts:1038-1039 (sebelum fix); src/routes/auth.ts:31; BUG-BELUM-DIBERESKAN II-5 | 🟡 **AUDITED — 0 assertion rawan ditemukan** (full-scan `src/tests/`, 19 Agu 2026). Root cause asli (cleanup per-prefix, row lintas-file `store-f7140b5c` survive) **TETAP ADA** secara teknis, TAPI currently harmless karena SELURUH assertion `actionIdempotency`/`order`/`orderItem` sekarang ter-scope `storeId` / `conversationId` / composite-unique (`storeId_customerId_actionType_actionId`). Downgrade dari "follow-up task terpisah" → **hygiene debt**: re-audit kalau ada file test BARU yang query `actionIdempotency`/`order` tanpa scope eksplisit. JANGAN hapus row `store-f7140b5c` manual — itu milik test flow lain / canary. |
| II-6 | **P8 CI gate tidak men-cover structured-actions suite** — `.github/workflows/test.yml` cuma jalankan `test:chat` + `test:golden`; `structured-actions*.test.ts` (ADD/REMOVE/UPDATE/CANCEL/CONTACT_ADMIN + P0-P5 foundation, 115 test) TIDAK ter-cover CI → regresi cluster bisa lolos tidak terdeteksi (pola masalah P6 lama: golden dataset dulu juga begini sebelum P6.3). | `.github/workflows/test.yml`; task STATUS-SYNC 19 Agu 2026 | High (CI gap) | ✅ **RESOLVED (P8-CI-FIX, commit `c6be2d8`, 19 Agu 2026)** — `apps/api/package.json` tambah script `test:structured` (glob `src/tests/structured-actions*.test.ts`); `.github/workflows/test.yml` tambah step `Run test:structured` SETELAH `test:golden` (MUST pass, 0 failure). Verifikasi lokal: `npm run test:structured` → 115 tests / 7 suites pass. CI sekarang gate penuh: test:chat (baseline-tolerant) + test:golden + test:structured. |
| II-7 | **G2-F test suites TIDAK ter-cover CI** — `payment.test.ts` (G2-F2, `src/business/tests/`), `pwa-checkout.test.ts` (G2-F3), `payment-verify-routes.e2e.test.ts` (G2-F4) TIDAK dijalankan CI sama sekali sejak dibuat: tidak masuk list explicit `test:golden`, tidak match glob `test:structured` (`structured-actions*`), dan `test:chat` (jest) hanya cover `src/services/chat/**`. Seluruh cluster fitur payment/checkout (F2+F3+F4) bisa regresi tanpa CI merah — pola sama persis II-6 / P8-CI-FIX. | `apps/api/package.json`; `.github/workflows/test.yml`; `src/business/tests/payment.test.ts`; `src/tests/pwa-checkout.test.ts`; `src/tests/payment-verify-routes.e2e.test.ts` | High (CI gap) | ✅ **RESOLVED (G2-F5, commit `e293040`, 20 Agu 2026)** — `apps/api/package.json` tambah script `test:payment` (list explicit 4 file: `payment.test.ts` + `pwa-checkout.test.ts` + `payment-verify-routes.e2e.test.ts` + `golden-payment.e2e.test.ts`); `.github/workflows/test.yml` tambah step `Run test:payment` SETELAH `Run test:structured` (MUST pass, 0 failure). Durasi gap: F2 ~4h28m (`ebc4637`, 01:46 UTC), F3 ~1h09m (`16a954b`, 05:05 UTC), F4 ~0h13m (`ed41e0c`, 06:02 UTC) — semua 20 Agu 2026. Verifikasi lokal full sequence: test:chat 270/270, test:golden 26/26, test:structured 115/115, test:payment 30/30 (exit 0 semua). |

---

## III. INFRA / KEANDALAN / HYGIENE (bukan bug user langsung, tapi risk)

| ID | Risiko / Bug | Lokasi | Severity | Note |
|----|--------------|--------|----------|------|
| III-1 | **`dist/` ter-commit + deploy tanpa build otomatis** — stale `dist` bisa jalan di produksi. | RAILS §1.158; ecosystem.config.js:6 (`script:'dist/index.js'`); commit 5f502d1 (cleanup orphan dist) | High (infra) → **MITIGASI** | ✅ **MITIGASI (III-1-B, commit `bcddfcd`, 19 Agu 2026):** git hook `post-merge` auto-build terpasang (jalankan `npm run build` setelah merge/pull sehingga `dist/` selalu sync dengan source — lihat `RAILS.md` §4.1). `dist/` MASIH ter-track di git (belum di-untrack) karena untrack ditunda sampai hook terbukti handal di deploy nyata (VPS `vps3541799`) — jangan `git rm --cached` sembarangan sebelum yakin. Pre-commit checklist (§1.164) tetap belum ada; mitigasi utama sekarang adalah post-merge hook + kebiasaan `git status` menyeluruh + `npm run build` sebelum klaim selesai. |
| III-2 | **`logs/*.log` ter-track di git** — berisiko data WA customer/nomor terlibat commit. | apps/api/logs/*.log; RAILS §1.160 | ~~High (keamanan)~~ ✅ Fase A + Fase B SELESAI (SHA `469804a`→`73f607b`; backup `/home/ubuntu/backups/garuda-backup-20260819.bundle`) | Sudah di-exclude + di-purge dari history. |
| III-3 | **Tidak ada pre-commit hook / checklist otomatis** (tsc, build, test). | RAILS §1.164 | Medium | Manual tiap kali. |
| III-4 | **P3 T5: fallback tier overlap** (v1↔v2↔shadow). | STATUS-V2:199-200 | ✅ **RESOLVED (FIX-3, 20 Agu 2026, commit `5e7ef42` — lihat git log)** | T5 asli (overlap `extractedEntities`) bukan masalah; intent-tier overlap V1 ditutup B3/B4. Sisa (`saveDiscussedItems` RMW polos) DITUTUP: sekarang pakai `atomicCasExtractedEntities` (P3.4 pola, CAS `updatedAt` + retry) — `fallback.service.ts` `saveDiscussedItems`. Race test 10/10 (bothSaved=10/10). §V (a) `trySop` `order_status` sudah dikerjakan di FIX-2 (RESOLVED). |
| III-5 | **Race lastWrite-wins `appendMessage` lastMessages**. | STATUS-V2:200 | ✅ **RESOLVED (FIX-4, 20 Agu 2026, commit `353e883` — lihat git log)** | `appendMessage` (`conversation-context.service.ts`) sekarang pakai `atomicCasMessages` (P3.4 pola, CAS `updatedAt` + retry) — race RMW `lastMessages` tertutup. History durabel tetap aman (`conversation.service.ts:1246`). Race test 10/10 (noLost=10/10). RISK LOW (kualitas konteks, bukan data loss), tertutup. |
| III-6 | **Golden dataset invarian I8–I15: masih test unit parsial**, bukan 50-case permanen. | STATUS-V2:44; RAILS "golden dataset + test invarian permanen I8-I15 — baru test unit parsial" | Medium (regression coverage) | Next yang direncakan sejak 9/8. |
| III-7 | **I11: kamus slang normalizer** (`toralin`→`total`) typo lolos ke tier total. | STATUS-V2:42 (normalizer.ts) | ✅ **RESOLVED (FIX-1, 19 Agu 2026, commit `e6c7157` — lihat git log)** | Klaim literal STALE (sudah di dict+test). Edge case case-sensitivity DITUTUP: lookup typo sekarang lowercase (`normalizer.ts:153`), test baru `"Toralin brp"`→`"total berapa"` (`normalizer.test.ts`). RISK LOW, tertutup. |
| III-8 | **I12: guard nama produk di normalizer**. | STATUS-V2:43 | ✅ **RESOLVED (FIX-1, 19 Agu 2026, commit `e6c7157` — lihat git log)** | Guard `fuzzyMatchProduct` + lookup typo sekarang case-insensitive; TAMBAH multi-word product guard (frasa utuh di-guard, tidak dimutasi). Test baru `normalize('ada Ready Pack',['Ready Pack'])`→`'ada Ready Pack'`. Caller `conversation.service.ts:616` aman. RISK LOW–MED, tertutup. |
| III-9 | **`LEASE_FINAL_MS = 750` (action-registry.ts:22) adalah 750 MILIDETIK, bukan 750 detik** — kontrak PROJECT-CONTRACT-STRUCTURED-ACTIONS.md §6A.5 menargetkan lease 30–60 detik. Mismatch kemungkinan warisan implementasi P0 lama; ditemukan saat baca line untuk audit idempotency P7. Dampak: lease recovery claim macet terlalu singkat (750ms) → concurrency tinggi bisa claim ganda dalam jendela sempit, atau recovery CLAIMED terlalu agresif. **DI LUAR SCOPE P7** (RAILS §1.4) — jangan diperbaiki di P7. | apps/api/src/business/action-registry.ts:22; DOCS/CONTRACT/PROJECT-CONTRACT-STRUCTURED-ACTIONS.md §6A.5 | Low–Medium (idempotency edge) | ✅ **RESOLVED** — `LEASE_FINAL_MS` 750ms→30000ms (30s), owner-decided interim value sesuai batas bawah kontrak §6A.5 (III-9, 19 Agu 2026). Belum berbasis pengukuran nyata (tidak ada benchmark p99 `executeOps()` di repo) — kalau nanti ada data production, boleh dikoreksi berbasis bukti, bukan sekarang. |
| III-10 | **Cycle import `container.ts` ↔ 3 adapter** (latent, currently benign). | container.ts:5-7; cloudinary.adapter.ts; r2.adapter.ts; gowa.adapter.ts | Low (latent) | ✅ **RESOLVED (FIX-5, 20 Agu 2026, commit `6385322` — lihat git log)** — cycle DIPUTUS dari sisi adapter: `import { adapters } from '../container.js'` di-ubah jadi dynamic `await import('../container.js')` di dalam method (`getAdapters()`), pola sama seperti `engine-config.ts:getRedis()`. `container.ts` tetap static (tidak diubah). `test:chat` 6x konsisten 270/270 — tak ada regresi load-order. Correction 20 Agu 2026 (G2-F2-DOCS-CORRECT): hash `60eb1f3` di entri lama adalah stale/dangling; hash benar di `main` adalah `6385322`. |

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

---

## VI. SESSION 21 AGU 2026 — shipping full-stack / Store NOT NULL / monitoring

> Cluster `2a93924..2e64c0a` dikerjakan & di-push TANPA laporan real-time (insiden
> DOCS-SYNC, lihat PROJECT-STATE-REPORT §10.2 + RAILS §6.x POST-HOC). Di bawah ini
> ringkasan bug/finding per kategori. Bukti RAILS §5 ada di pesan commit masing-masing.

### VI-A. RESOLVED (shipping-cost full-stack, RajaOngkir Komerce) — `490e853..2e64c0a`
- Origin store (`Store.originProvinceId/Name`, `originCityId/Name`, `originSubdistrictId/Name`) + dashboard cascading dropdown ✅.
- `RajaOngkirLocationAdapter` (province/city/subdistrict, 30d cache) + **PUBLIC** `GET /api/pwa-locations/*` + `pwaLocationsLimiter` (30 req/15m) ✅.
- `Product.weight` (gram, NOT NULL default 0) + magic-paste + dashboard form wajib Berat ✅.
- `Order` destination fields (nullable, backward-compatible) + PWA cascading dropdown ✅.
- UNIT1–UNIT6: `Order.shippingCost`/`shippingService` + `getOrderWeightGrams` + `GET /shipping-options` + `POST /select-shipping` (server-recomputed) + auto-reset ongkir + PWA checkout UI + receipt ✅.
- **Konteks COD:** ini yang memicu evaluasi RajaOngkir sbg kandidat Opsi (B) fulfillment → TERNYATA kalkulator ongkir, BUKAN tracking → Opsi (B) RESMI DITUTUP (`09b257a`, DECISION-COD-SETTLEMENT-DEFERRED.md).

### VI-B. RESOLVED (Store NOT NULL registration, pre-launch) — `03bce76..d3c7855`
- `Store.phoneNumber`/`address`/`origin*` NOT NULL (migration isi placeholder, prod baru 0 row) ✅.
- `storeRegisterSchema` wajib phone (format HP ID)/address/origin* (`.trim()` tolak whitespace → 400); `/login` auto-create dihapus ✅.
- Dashboard `RegisterSaaS.tsx` wajib No. HP + Alamat + 3 dropdown kaskade ✅.
- 13 file test `store.upsert` tambah dummy valid NOT NULL store ✅.
- **Null-write fix (`d3c7855`):** `PUT /api/auth/profile` + `PUT /api/profile` — field wajib DIKIRIM tapi kosong → 400 "tidak boleh dikosongkan"; tidak dikirim (undefined) → skip (bukan `|| null` crash). ✅ RESOLVED.

### VI-C. RESOLVED (monitoring dasar, G2-G) — `dd20696`/`b18b6d5`
- `AUDIT-BASELINE-G2-G.md` (realtime/scale baseline) ✅.
- `GET /api/admin/metrics/system` (admin-auth): memory/uptime/requests (in-memory rolling window), dipisah dari `/api/health` ✅.

### VI-D. OPEN / KNOWN (tidak blocking, task terpisah)
| ID | Item | Severity | Note |
|----|------|----------|------|
| VI-1 | **SHIPPING-CI-GAP**: test suite shipping TIDAK ter-cover CI — **RESOLVED** (`e16679d`): `test:shipping` script + step CI setelah `test:payment` (MUST pass 0 failure); plus fix hardcoded quota date pakai `wibDateKey()`. | Resolved | `npm run test:shipping` (8/8 pass). |
| VI-2 | **Monitoring single-instance**: `/api/admin/metrics/system` in-memory → TIDAK akurat di multi-instance pm2. | Low–Med | Gap diketahui; aman untuk single-instance saat ini. |
| VI-3 | **RajaOngkir/Komerce dependency risk**: caching hasil cost (Redis 7d) + quota guard — risiko ban disengaja diterima owner; interface swap-able. | Low (owner-accepted) | Tidak ada follow-up wajib. |
| VI-4 | **DIST dirty (III-1 berulang)**: source cluster `2a93924..2e64c0a` ter-commit tapi `dist/` belum di-rebuild → working tree berisi dist modified. | High (infra, MITIGASI) | Sebelum deploy: `cd apps/api && npm run build` lalu commit `dist/`. |
| VI-5 | **BACKUP_ALERT_EMAIL no sender**: env `BACKUP_ALERT_EMAIL` sudah terisi (pandjie@yahoo.com) tapi TIDAK ADA email sender terpasang di manapun di `src` (no SMTP/nodemailer/mail service). `backup.config.ts:50` membaca → `notificationEmail`, `notifyOnFailure:true`, tapi tidak ada konsumen yang mengirim email → alert kegagalan backup TIDAK terkirim. Gap baru temuan G2-H UNIT audit. | Medium (silent-failure risk) | Perlu implementasi sender + wiring ke failure path `backup.service.ts` (task terpisah, lihat PROJECT-STATE §6.10). |

### VI-E. RESOLVED (G2-H release readiness — 22 Agu 2026)
- **Shipping CI gap (VI-1) — `e16679d`**: `test:shipping` script + step CI setelah `test:payment` (pola II-6/II-7, MUST pass 0 failure); plus fix hardcoded quota date (`wibDateKey()` dipakai test agar seed key cocok WIB nyata). ✅ RESOLVED.
- **Backup restore rehearsal (`0d29aaf`) — DITEMUKAN via rehearsal NYATA, bukan cuma dry-run**: `restoreDatabase` pipa `pg_dump --format=custom` (binary) ke `psql` yang TIDAK bisa baca custom format → full restore SELALU gagal. Diganti `pg_restore --clean --if-exists` (idempoten); `pg_terminate_backend` kill-step tetap `psql`. Plus bookkeeping manifest pakai upsert (bukan update) + `backup:create` clean exit (`prisma.$disconnect()` + `process.exit(0)`). Bukti: full restore ke sandbox DB terpisah EXIT 0, row-count + id-checksum orders/order_items/stores/products/customers COCOK sumber, tanpa data loss. ✅ RESOLVED — ini bukti kenapa rehearsal restore penting: dry-run tidak menangkap format mismatch ini.
- **generalLimiter dead-code (`10be048`)**: `generalLimiter` (15m/1000/IP) sebelumnya didefinisikan tapi TIDAK PERNAH dipasang (dead code). Kini di-mount sebagai global safety net di `index.ts` (setelah body-parser/maintenance, sebelum route; `/api/health` + `/r` dikecualikan). ✅ RESOLVED.
- **Rate-limiter gaps 11 endpoint publik (`10be048`)**: 11 endpoint publik no-auth tanpa proteksi (`/checkout`, `/payment-proof-upload`, `/action`, `/payment-report`, `/subscribe`, `/unsubscribe`, `/handoff`, `/clear`, `/typing`, `/read`, `/history`) + redirect `/r/:storeId` kini dapat limiter (reuse existing: `orderMutationLimiter`, `conversationLimiter`, `pwaProductsLimiter`). ✅ RESOLVED.

---

## VII. INSIDEN KEAMANAN `.env` TER-TRACK DI GIT HISTORY (22 Agu 2026)

> Diverifikasi INDEPENDEN via `git` + filesystem (bukan narasi). Bukti:
> `git log --all --oneline -- .env` SEKARANG **KOSONG** (purge sukses);
> `git ls-files | grep -x .env` **KOSONG** (tidak tracked); `.gitignore` berisi `.env`;
> `git log origin/main -3` = `ea1f0c2` (merge) → `8ba77c9` → `da1b2e1`.
> History lama: `.env` pernah di-commit di `a417632` ("Webhook secret validation + migrasi
> VPS 7 Agustus"), yang ADALAH ancestor `origin/main` → secret TER-PUSH ke GitHub.
> Purge via `git filter-repo --path .env --invert-paths --force` + force-push
> (`6385322...3d86fe2 main -> main forced update`); remote clone-fresh verified BERSIH.
> `.env` asli di-recovery dari `/proc/<pid>/environ` proses `api` yang masih hidup, lalu
> backup ke `/home/ubuntu/backups/env-recovered-20260821.env` (chmod 600, LUAR git).
> Detail lengkap di RAILS.md §6 (entri 22 Agu 2026).

### VII-A. OPEN — Rotate seluruh secret (DITUNDA sampai sebelum GO-LIVE)
- **Item:** Semua secret yang pernah ada di `.env` `a417632` (ter-expose ke GitHub history
  lama) WAJIB di-rotate: `DATABASE_URL`, `REDIS_URL`, `GEMINI_API_KEY`, `GROQ_API_KEYS`,
  `GOWA_BASIC_AUTH_*`, `CLOUDINARY_*`, `BACKUP_ENCRYPTION_KEY`, `WEBHOOK_SECRET`,
  `STORAGE_PROVIDER`/`R2_*`, `FIELD_ENCRYPTION_KEY`, `CLOUDFLARE_WORKER_*`, `PUBLIC_API_URL`.
- **Kecuali:** `RAJAONGKIR_API_KEY` — **TIDAK PERNAH ter-expose** (tidak ada di `a417632`,
  dan tidak ada di env proses hidup saat recovery; baru ditambahkan owner ke `.env` SETELAH
  purge). Tidak perlu di-rotate karena tidak pernah masuk git history.
- **Status:** 🟡 **OPEN / DITUNDA** — per keputusan owner, rotate ditunda sampai SEBELUM
  GO-LIVE (website belum rilis, belum ada trafik nyata). BUKAN diabaikan — wajib sebelum
  produksi bener-bener live. Risk: secret masih valid di GitHub history lama (sudah di-purge
  dari working tree & remote SEKARANG, tapi snapshot lama sudah pernah keluar).

### VII-B. OPEN — RAJAONGKIR_* hilang dari pm2 env, perlu owner tambahkan manual
- **Item:** Saat recovery `.env` dari `/proc/<pid>/environ`, variabel `RAJAONGKIR_API_KEY`
  dan `RAJAONGKIR_DAILY_QUOTA` **TIDAK ADA** di env proses hidup (belum pernah di-inject ke
  pm2 env; modul ongkir belum pernah jalan di produksi).
- **Status:** ✅ **SUDAH diatasi manual** — owner menambahkan `RAJAONGKIR_API_KEY` ke
  `/home/ubuntu/garuda/.env` (dan `RAJAONGKIR_DAILY_QUOTA=100`), `.env` sekarang 27 baris
  lengkap. CATATAN: `pm2 restart` tanpa `--update-env` mempertahankan env lama di memory —
  kalau pm2 di-restart penuh / server reboot, pastikan `.env` (atau `ecosystem.config.js`)
  menyuplai `RAJAONGKIR_*` supaya modul ongkir produksi punya kredensial.

## VIII. SESSION 27 AGU 2026 — PV-P2 variant support (post-PV-P2 fix)

### VIII-A. RESOLVED (`4c2e4f2` + this fix commit) — executeOps price bug + resolvePriceAndStock tx-consistency
- **Item [PV-P2-FINDING-001]:** `executeOps` add/update branch di `cart-authority.ts:570-618` menulis `result.unitPrice` (parent product price dari `resolveProductById`) ke `OrderItem.unitPrice`, bukan harga varian. Untuk varian dengan harga berbeda dari parent, harga yang terpersist salah.
- **Item tambahan (ditemukan saat analisa):** `resolvePriceAndStock` (1) tidak filter `isActive/deletedAt` untuk produk non-varian — regresi terhadap §8 kontrak (byte-identical behavior untuk `hasVariants=false`); (2) baca via `prisma` global, bukan `tx` yang sedang jalan di `executeOps`/`addLine`/`checkout` — inkonsisten dengan pola `resolveProductById` yang menerima `tx`.
- **Konteks severity:** Tidak ada customer terdampak (fitur varian belum diluncurkan). Bug ini blocking PV-P2 karena varian dengan harga beda dari parent tidak bisa diuji tanpa perbaikan ini.
- **Status:** ✅ RESOLVED — commit `4c2e4f2` (PV-P2) memperbaiki executeOps pakai `resolvePriceAndStock` untuk authPrice. Commit ini (PV-P2-FIX) menambahkan parameter `tx` opsional ke `resolvePriceAndStock` (pakai `tx ?? prisma`), filter `isActive/deletedAt` untuk produk + parent product check untuk varian, dan update semua caller (`addLine`, `executeOps`, `checkout`) untuk meneruskan `tx`.

## IX. SESSION 28 AGU 2026 — Admin security cluster (public registration + engine.ts unauthenticated)

### IX-A. RESOLVED (`b64babf` + `ae40461`) — public registration exposure + engine.ts unauthenticated routes
- **Item 1 [ADMIN-REGISTRATION-EXPOSURE]:** POST /api/admin/auth/register terbuka ke publik internet tanpa gate — confirmed live via curl mengembalikan 201 untuk unauthenticated request. Kombinasi dengan temuan AUDIT-BASELINE (admin tidak punya store-ownership scoping — Finding 1-4) berarti siapapun di internet bisa self-register sebagai admin dan dapat akses global ke semua merchant stores. 3 baris `admin_users`Existing diaudit: `metrics-test@garuda.local`, `m2@garuda.local`, `exposure-check-DO-NOT-USE@example.invalid` — None belonged to owner, semua di-deactivate (`isActive=false`, tidak di-hard-delete, audit trail preserved). Owner kemudian registrasi akun super_admin baru (`pandjie@yahoo.com`).
  - **Konteks:** Terbongkar saat verifikasi live POST /register mengembalikan 201 untuk email test `exposure-check-DO-NOT-USE@example.invalid`.
  - **Status:** ✅ RESOLVED — commit `b64babf`. Bootstrap-once gating: route TERBUKA hanya ketika belum ada super_admin aktif (count=0), kemudian LOCKED permanen. Saat bootstrap mode, role WAJIB diset `super_admin` terlepas dari apa yang dikirim di request body. Setelah super_admin pertama ter-create, route memerlukan `adminAuthMiddleware` + `requireAdminRole(['super_admin'])`. Verified via live curl: 201 di bootstrap state dengan role forced, 401 di locked state.
- **Item 2 [ENGINE-TS-UNAUTH]:** `src/routes/admin/engine.ts` (4 route yang mengontrol versi AI engine yang memproses pesan customer — v1 vs v2, canary metrics) sama sekali TIDAK ada auth middleware-nya, masuknya langsung dari `app.use('/api/admin/engine', ...)` tanpa `adminAuthMiddleware`.
  - **Konteks:** Temuan dari ADMIN-TENANT-ISOLATION-AUDIT-BASELINE.md Finding 6. Tidak ada caller internal (cron/healthcheck/service-to-service) yang menggunakan route ini — verified via grep seluruh codebase.
  - **Status:** ✅ RESOLVED — commit `ae40461`. `adminAuthMiddleware` ditambahkan ke semua 4 route. GET routes (read-only metrics/config) cukup `adminAuthMiddleware` (any authenticated admin). POST `/:storeId` (mutates engine version untuk seluruh store) ditambahkan `requireAdminRole(['super_admin'])` — konsisten dengan pola `config.ts` PUT/DELETE + `backups.ts` restore/delete yang sama-sama memerlukan super_admin untuk aksi destruktif. Verified via live curl: 401 tanpa auth, 200/403 dengan auth sesuai role.

### IX-B. OPEN (non-blocking, explicitly deferred per owner decision)
- **Item [ADMIN-STORE-SCOPING]:** Admin tidak punya store-ownership scoping — setiap admin (termasuk super_admin) bisa akses/modifikasi data semua store tanpa filter. Reference: ADMIN-TENANT-ISOLATION-AUDIT-BASELINE.md Finding 1-4. **Status: DEFERRED, revisit if/when a second admin is added.** Admin panel saat ini internal-only (owner's own team, confirmed oleh owner) — membangun RBAC sekarang adalah solving for user yang belum ada. Owner separately setting up Cloudflare Access (infra-level, di luar repo ini) sebagai lapisan tambahan di depan /admin — ini adalah owner's own action, bukan bagian dari commit repo.
- **Item [ADMIN-PASSWORD-RESET-MISSING]:** Tidak ada forgot-password / reset-password flow untuk admin accounts. Satu-satunya route reset password yang ada adalah `POST /api/admin/stores/:storeId/reset-password` (`src/routes/admin/stores.ts:252`) yang hanya reset password STORE (PWA/customer-facing), bukan admin. Jika super_admin password hilang, tidak ada recovery path selalu membuat akun baru via bootstrap mode. **Severity: Medium (owner currently has no admin account recovery path).** Status: OPEN, perlu implementasi sendiri (task terpisah).

### IX-C. VERIFIED — no internal caller for engine.ts routes
- Exhaustive grep `engine/metrics`, `engine/`, `/api/admin/engine` across `src/` dan `apps/dashboard/` mengembalikan **0 result**. Tidak ada cron, healthcheck, atau service-to-service call yang menggunakan route ini. Aman untuk menambahkan auth tanpa breaking internal integration.
