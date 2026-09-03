# DEFERRED WORK TRACKER

> **Tujuan file ini:** satu sumber kebenaran untuk SEMUA keputusan defer/
> penundaan scope yang disengaja di seluruh project — beda dari
> `BUG-BELUM-DIBERESKAN.md` (yang mencampur bug + defer + resolved).
> File ini KHUSUS untuk hal yang SENGAJA ditunda dengan alasan eksplisit,
> supaya tidak ada lagi kasus seperti PV-P3 (magic-paste variant
> extraction) — kontrak induknya ditandai "LOCKED/mostly done" padahal
> satu sub-scope di dalamnya belum mulai sama sekali dan tidak
> ter-track di mana pun.
>
> **Aturan wajib:** setiap TASK yang sengaja men-defer sebagian scope
> HARUS menambah baris di sini pada sesi yang sama — bukan disebut sekali
> di laporan lalu hilang. Setiap baris WAJIB punya kolom "Trigger" — kondisi
> konkret kapan item ini harus ditagih kembali, bukan "nanti" yang kabur.
>
> **Update terakhir:** 3 Sep 2026.

---

## 🔴 Prioritas tinggi — blocking sebelum go-live atau berdampak signifikan

| # | Item | Dari task/kontrak | Kenapa di-defer | Trigger untuk ditagih |
|---|------|-------------------|------------------|------------------------|
| 2 | Billing / pricing model — TIDAK ADA sama sekali di codebase | `GO-LIVE-BUSINESS-READINESS.md` #1 | Keputusan bisnis, bukan teknis — belum diputuskan free/paid/trial/per-message | Sebelum onboarding merchant riil pertama yang bukan test/canary |
| 3 | Terms of Service / Privacy Policy — TIDAK ADA, padahal platform simpan PII terenkripsi (UU PDP applicable) | `GO-LIVE-BUSINESS-READINESS.md` #3 | Legal requirement, tapi butuh keputusan/draft di luar kode | Sebelum onboarding merchant riil pertama (legal blocker, bukan opsional) |

## 🟡 Prioritas menengah — perlu ditagih tapi tidak blocking

| # | Item | Dari task/kontrak | Kenapa di-defer | Trigger untuk ditagih |
|---|------|-------------------|------------------|------------------------|
| 5 | Multi-key rotation dalam SATU role provider (`chat_primary`/`chat_fallback`) — resolver cuma ambil provider top-1 per role, tidak rotasi antar-key kalau limit | LLM-PROVIDER-ABSTRACTION Unit 3b/4 | Owner memilih pindah ke OpenRouter (rotasi provider bawaan) sebagai solusi, bukan dibangun sendiri | Kalau OpenRouter free-tier (50 req/hari tanpa topup) ternyata tidak cukup dan builtin rotation dibutuhkan lagi |
| 7 | Track B — Wizard UI (P2) + LLM generation service (P3) belum mulai, baru P1 (schema) selesai | `PROJECT-CONTRACT-ONBOARDING-WIZARD.md` §6 | Sengaja dipisah per-unit dari P1; Track A (LLM provider abstraction) diprioritaskan duluan supaya wizard generation langsung pakai sistem provider dinamis | Setelah Track A settle (flag ON atau OpenRouter terpasang) — TIDAK ada alasan lain untuk menunda lebih lama |
| 8 | Chat gatekeeper (`extractIntent`) tetap pinned ke `groqAdapter` singleton, TIDAK ikut resolver dinamis — `chat_gatekeeper` role di dashboard kosmetik | LLM-PROVIDER-ABSTRACTION Unit 5 Part 1 (Option B) | `extractIntent` bukan bagian interface `AIProvider`; Option A (bikin optional method) berisiko silent-degradation | Kalau ada kebutuhan konkret ganti gatekeeper dari Groq (bukan sekadar "biar konsisten") |
| 11 | IX-D — Guard `hasVariants && !variantId` duplikat di 2 tempat (`cart-authority.ts` + `action-registry.ts`), belum di-DRY | `BUG-BELUM-DIBERESKAN.md` §IX-D | Konsisten, tidak ada kontradiksi — refactor kosmetik | Siklus maintenance CartAuthority berikutnya |
| 12 | Merchant onboarding wizard (guided setup UX untuk connect WA/tambah produk) — beda dari Track B wizard di atas (yang itu TOS/SOP/FAQ) | `GO-LIVE-BUSINESS-READINESS.md` #2 | Registrasi teknis sudah jalan, tapi UX guided untuk merchant non-teknis minimal | Kalau ada keluhan merchant riil kesulitan onboarding sendiri |
| 16 | N-provider rotation dalam 1 role (misal 20 Groq key bergantian otomatis) — owner explicitly requested redesign (merge primary/fallback into single role with N providers cycling), deferred until flag-ON runs stable so issues can be isolated one variable at a time | Owner request, 2 Sep 2026 session | Explicit sequencing decision — don't change flag-ON status and architecture simultaneously | Setelah flag ON terbukti stabil beberapa waktu, DAN owner siap prioritaskan redesign ini |
| 17 | Cost accuracy per-provider (`TokenUsageLog.costUsd` pakai default $0.05/$0.15 generik, bukan tarif asli Mistral/SambaNova/provider baru lainnya) | TOKEN-USAGE-UNIT1-PERSISTENCE | Owner eksplisit bilang tidak perlu sekarang — requests/tokens sudah akurat, cost cuma perkiraan kasar | Kalau owner butuh laporan biaya aktual yang akurat (mis. untuk billing decision di GO-LIVE-BUSINESS-READINESS.md item #1) |
| 19 | `batch-magic-paste.e2e.test.ts` tests #7/#8 fail — send no-weight items ("Rendang 50000"/"Sate 20000") expecting creation, but the weight gate correctly blocks them. Confirmed PRE-EXISTING via `git stash` (not caused by today's PV-P3/weight-gate-visibility fix) | DEBUG-MAGIC-PASTE-VARIANT-NOT-SHOWING-AND-EMPTY-LIST, 2 Sep 2026 | Test expectations are stale — written before/without accounting for the weight gate's blocking behavior; not a product bug | Kapan saja — update the 2 test cases to either include weight in the input text, or explicitly assert needsWeightInput:true instead of expecting creation |
| 20 | Dashboard frontend anti-pattern: beberapa halaman mengecek `res.data.success` secara kasar tanpa membaca field detail lain (mis. `needsWeightInput`, `variants`) — sudah ketemu 3x hari ini (AI Providers error display, magic-paste false-success). Belum diaudit menyeluruh apakah ada halaman lain dengan pola sama | Ditemukan berulang selama sesi 2 Sep 2026 | Perbaikan spesifik sudah dilakukan tiap kali ditemukan; audit MENYELURUH ke semua halaman dashboard belum dilakukan | Kalau ketemu lagi kasus serupa di halaman lain, atau saat ada waktu luang buat audit preventif |
| 22 | Product delete tidak cascade-delete ProductVariant rows — varian menjadi orphaned setelah product di-soft-delete. Sudah diperbaiki dengan hard-delete varian dalam transaction yang sama | VARIANT-LIFECYCLE-FULL-AUDIT-AND-FIX, 3 Sep 2026 | Bug ditemukan saat audit, perbaikan sudah diterapkan dan ditest | Tidak ada — sudah diperbaiki |

## 🟢 Prioritas rendah — hygiene/cosmetic, aman ditunda lama

| # | Item | Dari task/kontrak | Kenapa di-defer | Trigger untuk ditagih |
|---|------|-------------------|------------------|------------------------|
| 13 | III-6 — Golden dataset invarian I8-I15 masih test unit parsial, bukan 50-case permanen | `BUG-BELUM-DIBERESKAN.md` §III-6 | Regression coverage belum lengkap, tidak blocking | Kapan saja, prioritas rendah |
| 14 | II-5 — Test DB shared isolation lemah (row lintas file test) | `BUG-BELUM-DIBERESKAN.md` §II-5 | Sudah di-audit "0 assertion rawan", downgrade ke hygiene debt | Kalau ada file test baru — re-audit saat itu |
| 19 | Magic-paste kadang gabungkan huruf varian pertama ke nama produk (mis. "Baju polos S" bukan "Baju polos") pada input 1-baris 2-varian — keterbatasan LLM, bukan bug kode, dimitigasi oleh preview-sebelum-simpan | DEBUG-CATALOG-EMPTY-AFTER-CREATE, 2 Sep 2026 | LLM variance pada kalimat ambiguous, preview UX sudah jadi jaring pengaman | Kalau owner sering ketemu ini dan preview-edit terasa merepotkan |

---

## Cara pakai file ini

- **Setiap TASK baru yang sengaja skip sebagian scope** → tambah baris di
  tabel yang sesuai prioritas, WAJIB isi kolom Trigger dengan kondisi
  konkret (bukan "nanti"/"someday").
- **Sebelum mulai kontrak/fitur besar baru** → scan file ini dulu, cek
  apakah ada defer lama yang triggernya sudah terpenuhi tapi belum ditagih.
- **Item yang sudah selesai** → pindahkan ke bagian bawah sebagai
  "✅ RESOLVED" dengan tanggal + commit, JANGAN dihapus (audit trail).
- **Push discipline:** jangan biarkan commits menumpuk local-only selama
  berjam-jam. Hari ini 8 commits duduk local-only ~8 jam sebelum di-push
  (akibat task demi task tanpa push intermediate). Rekomendasi: push
  segera setelah acceptance criteria satu unit terpenuhi — jangan tunggu
  akhir sesi. Ini mencegah gap local-vs-origin yang berbahaya kalau
  session terputus (lihat kasus AI-Providers 404 hari ini: code ada di
  local tapi production masih jalan versi lama).

## ✅ RESOLVED

| # | Item | Resolved | Commit(s) |
|---|------|----------|-----------|
| 4 | VII-A — Rotate seluruh secret (DATABASE_URL, REDIS_URL, GEMINI_API_KEY, GROQ_API_KEYS, GOWA_BASIC_AUTH_*, CLOUDINARY_*, BACKUP_ENCRYPTION_KEY, WEBHOOK_SECRET, STORAGE_PROVIDER/R2_*, FIELD_ENCRYPTION_KEY, CLOUDFLARE_WORKER_*, PUBLIC_API_KEY). RAJAONGKIR_API_KEY confirmed NOT rotated (never exposed, added post-purge). All keys confirmed changed from exposed pre-purge values, app healthy on new credentials (pm2 online, /api/health 200). | 3 Sep 2026 | Owner-completed outside session; verified 3 Sep 2026 |
| 15 | `GITHUB_PAT`, `WEBHOOK_SECRET` — removed from `.env.example` and confirmed 0 code references. Live `.env` untouched (not relied upon silently). | 3 Sep 2026 | `3 Sep 2026 session` |
| 9 | `adapters.llm.chat` — removed from `container.ts`. Confirmed zero non-test production references (only a comment in `manager-dynamic.test.ts`). Distinct from `adapters.ai.generate` (the active magic-paste path via `product.service.ts:1089`). Unrelated to N-provider rotation (#16), which targets resolver/gateway layer. | 3 Sep 2026 | `3 Sep 2026 session` |
| 10 | Live-refresh `lastTestedAt`/`lastTestResult` di dashboard AI Providers — `handleTestRow` kini update state lokal provider row (lastTestedAt + lastTestResult='ok'/'failed') langsung setelah test selesai, tanpa perlu reload halaman. Draft test flow (`handleTestDraft`) tidak terpengaruh (tidak ada row di table). | 3 Sep 2026 | `3 Sep 2026 session` |
| 18 | `adapters.knowledge`, `adapters.storage`, AND `adapters.llm` stub properties removed from `container.ts` exports (dead code, 0 non-test references). N-provider rotation (#16) is unrelated — it extends resolver/gateway, not the container property. | 3 Sep 2026 | `3 Sep 2026 session` |
| 24 | `products-routes.e2e.test.ts` tests #9/#11/#13 — added `weight: 1` to request bodies (stale expectations, not product bug). All 15 tests now pass. | 3 Sep 2026 | `3 Sep 2026 session` |
| 25 | `ProductFormModal.tsx` — deleted (0 references anywhere, superseded by shared `ProductForm.tsx`). | 3 Sep 2026 | `3 Sep 2026 session` |
| 1 | PV-P3 — Magic-paste variant extraction. Best-effort LLM parsing (variants[] with attributes/price/stock per option, threshold: ≥2 distinct prices or distinct stock+shared price), preview+edit step before save (ConfirmCreateModal), transactional create (atomic Product+ProductVariant write, P2002→clean 409, no partial rows), merchant variantOverrides take precedence over raw LLM output. No hard gate (unlike needsWeightInput) — always produces an editable preview, never blocks creation. | 2 Sep 2026 | `adba501` (Unit 1 — parsing), `7950533` (Unit 2 — transactional create + dashboard preview/edit + e2e a-g, regression 271/37/118/46/8) |
| 26 | Dual-UI magic-paste drift (ConfirmCreateModal vs ProductsPage) — merchant UI kini punya full variant editing (preview + create + post-edit), menyamakan fitur yang sebelumnya hanya ada di admin UI. Root cause bug varian sesi 2-3 Sep 2026. | 3 Sep 2026 | `2800f54` (variant lifecycle audit + merchant variant editing) |
| 27 | Product CRUD dual-UI consolidation — AdminProductsPage, ProductsPage, dan ProductDetailPage kini semuanya pakai shared `ProductForm` component. VariantManagementPanel routing bug lama (double-prefix `/api/admin/variants/stores/...`) ditemukan+diperbaiki. ProductDetailPage variant editing di-dedup ke 1 sumber kebenaran (`VariantManagementPanel` saja, ProductForm modal di page itu diset `showVariantSection=false`). | 3 Sep 2026 | `cd5a8d1` (Unit 1 — shared ProductForm), `7505974` (ProductDetailPage wire), `483bbbc` (routing fix + dedup) |
| 6 | `llm.useDynamicProviders` flag — sekarang ON di production. Dikonfigurasi Mistral (chat_primary) + SambaNova (chat_fallback), diverifikasi via real smoke test: Mistral melayani chat message nyata (token counts 619 in / 85 out cocok dengan interpreter logs). Token usage sekarang di-persist ke DB (TokenUsageLog) + dashboard UI (TokenUsage.tsx) untuk query range fleksibel. | 2 Sep 2026 | Working tree (uncommitted) — flip-flag + TOKEN-USAGE-Unit1 (schema migration + persistence + query endpoint + 9 tests) + TOKEN-USAGE-Unit2 (dashboard UI) + ORPHAN-AUDIT. Base: `bc53d0e` (Unit 4 — flag-gated cutover), `cced1ce` (U5 FINAL) |
