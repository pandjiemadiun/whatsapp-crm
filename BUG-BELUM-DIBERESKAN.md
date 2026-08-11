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
| I-1 | **Qty 0 tampil di receipt** ("Brambang (0x)") | STATUS-V2:20; composer/Receipt | Medium | §2 rencana: `filter qty<=0 di receipt`; belum dilakukan. |
| I-2 | **Reply resolved terpotong** ("adari?") | STATUS-V2:21 (composer-v2) | Low (kosmetik) | Balasan terpotong di akhir; tidak memblok proses. |
| I-3 | **`activeOrder`/`tryTotal` tidak diskriminatif `draft` vs `pending`** — dapat memilih baris `pending` (dari `createOrder`, harga dari LLM/ops) jadi order aktif, mirip pola phantom yang sama seperti `extractAndSaveOrder`. | conversation.service.ts:829 (activeOrder: `orderBy createdAt desc, notIn shipped/delivered/cancelled`); fallback.service.ts:649-661 (`tryTotal`/`lastOrder` fallback) | High (bisa double-count / pick stale) | **Satu-satunya temuan P4 yang masih relekan** setelah `extractAndSaveOrder` dihapus — sebab `createOrder` (:393) masih menulis `orderStatus:'pending'` (`items` price bisa null/lepas DB pada jalu LLM). Perlu: `activeOrder`/`tryTotal` eksklusif ambil `draft` (atau filter `draft` eksplisit). | ✅ **RESOLVED (P4.2, 11 Agu 2026)** — `activeOrder` dan `tryTotal`/`lastOrder` fallback sekarang query `draft` eksklusif dulu, fallback ke `pending`+lain HANYA bila tidak ada draft. Verifikasi: createOrder hanya dipanggil dari test, harganya valid DB (bukan phantom). Plus perbaiki bug pre-existing `JSON.parse(lastOrder.items as string)` (Prisma Json → JS array). Manual test: draft@36000 + pending@24000 → "total belanja" jawab Rp 36.000 (draft). |

---

## II. TEST / CI (gagal, blocker kualitas)

| ID | Bug | Lokasi | Severity | Note |
|----|-----|--------|----------|------|
| II-1 | **reasoning-v2 test outdated** — kasus "Validator reject terminal (low confidence) → fallback, llmCalls=1, JANGAN retry" ekspektasi `fallback_reasoning_failed` tapi dapat `reasoned`. | reasoning-v2.test.ts:316 | High (1 failed test, part of baseline) | STATUS-V2:22. Harusnya expect `reasoned`. |
| II-2 | **engine-config-v2 suite gagal load** — `ReferenceError: Cannot access 'redisAdapter' before initialization` di `container.ts:38` (`const cache = redisAdapter`). | container.ts:38; engine-config-v2.test.ts | High (1 failed suite, blocks seluruh suite itu) | STATUS-V2:137-139 / RAILS §1.37-139. Masalah urutan inisialisasi modul di test env (bukan bug runtime prod). |
| II-3 | **Test bug golden-dataset Case B3-b** — `assert.equal` (strict `===`) pada array `audit.stagesReached`, selalu gagal (reference inequality). | golden-dataset.test.ts:726 | Low | PRE-EXISTING (commit HEAD 2ab32ef). Owner: "skip (b), jangan fix". |
| II-4 | **Test-data gap golden-dataset Case 1** — seed `store-golden-test` tidak punya `woltel`/`brambang`, hanya `beras`. Di bawah validasi DB (P2) produk tak ada diskipping → case "pass" lama jadi "fail". | golden-dataset.test.ts:303; BASE_PRODUCTS | Low (test-data, bukan logic) | Owner-flagged 10 Agu: "pemilikputuskan" — butuh `woltel`/`brambang` ditambah ke seed atau BASE_PRODUCTS. |

---

## III. INFRA / KEANDALAN / HYGIENE (bukan bug user langsung, tapi risk)

| ID | Risiko / Bug | Lokasi | Severity | Note |
|----|--------------|--------|----------|------|
| III-1 | **`dist/` ter-commit + deploy tanpa build otomatis** — stale `dist` bisa jalan di produksi. | RAILS §1.158; ecosystem.config.js:6 (`script:'dist/index.js'`); commit 5f502d1 (cleanup orphan dist) | High (infra) | "Jangan `git rm --cached` sembarangan sebelum pastikan deploy tidak bergantung pada dist committed." Perlu: pre-commit hook / CI build otomatis. §1.164: belum ada hook. |
| III-2 | **`logs/*.log` ter-track di git** — berisiko data WA customer/nomor terlibat commit. | apps/api/logs/*.log; RAILS §1.160 | High (keamanan) | Harus di-exclude. |
| III-3 | **Tidak ada pre-commit hook / checklist otomatis** (tsc, build, test). | RAILS §1.164 | Medium | Manual tiap kali. |
| III-4 | **P3 T5: fallback tier overlap** (v1↔v2↔shadow) belum diklasifikasi sepenuhnya. | STATUS-V2:199-200 | Low | "RENDAH". |
| III-5 | **Race lastWrite-wins `appendMessage` lastMessages** belum diklasifikasi. | STATUS-V2:200 | ? (belum diklasifikasi) | Potensi concurrency; perlu analisis dampak. |
| III-6 | **Golden dataset invarian I8–I15: masih test unit parsial**, bukan 50-case permanen. | STATUS-V2:44; RAILS "golden dataset + test invarian permanen I8-I15 — baru test unit parsial" | Medium (regression coverage) | Next yang direncakan sejak 9/8. |
| III-7 | **I11: kamus slang normalizer** (e.g. `toralin`→`total`) typo masih lolos ke tier total. | STATUS-V2:42 (normalizer.ts) | Low | Typo normalizer. |
| III-8 | **I12: guard nama produk di normalizer** belum diverifikasi. | STATUS-V2:43 | Low | Perlu verifikasi. |

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

> Catatan: daftar ini **tidak** memasukkan `extractAndSaveOrder` (sudah dibereskan
> P4.1) ataupun T1–T4 P3 / eskalasi C1 / multi-add FLAGSHIP / truth-boundary P2
> (semua sudah resolved & ter-commit, lihat STATUS-V2.md).
