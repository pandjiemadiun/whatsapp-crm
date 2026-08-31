# BUG TERBUKA — indeks temuan belum dibereskan (update 31 Agu 2026)

> Daftar **temuan / bug / risiko yang belum dibereskan** sepanjang sesi
> (P0–P4). Semua referensi ke `STATUS-V2.md`, `RAILS.md`, atau file:src:line
> di commit HEAD.

---

## 📋 RINGKASAN OPEN ITEMS

| ID | Deskripsi | Severity |
|---|---|---|
| VII-A | Rotate seluruh secret (ditunda sampai sebelum go-live) | High (ditunda) |
| IX-D | CARTAUTHORITY-VARIANT-GUARD-DUPLICATION refactor | Low |
| I-2 | Reply resolved terpotong ("adari?") | Low (kosmetik) |
| III-3 | Tidak ada pre-commit hook / checklist otomatis | Medium |
| III-6 | Golden dataset invarian I8–I15: masih test unit parsial | Medium |
| II-4 | Test-data gap golden-dataset Case 1 (seed `woltel`/`brambang`) | Low |
| II-5 | Test DB shared isolation lemah (row `store-f7140b5c` bocor) | Low (hygiene) |
| VI-2 | Monitoring single-instance (tidak akurat multi-instance) | Low–Med |
| III-1 | `dist/` ter-commit + deploy tanpa build otomatis | MITIGASI |
| GITHUB_PAT | Env var unused (pm2 env audit 31 Agu) | Low (cleanup) |
| WEBHOOK_SECRET | Env var unused (pm2 env audit 31 Agu) | Low (cleanup) |

---

## 🔴 OPEN / IN PROGRESS

### High

- **VII-A — Rotate seluruh secret (DITUNDA sampai sebelum GO-LIVE)**
  - Semua secret yang pernah ada di `.env` `a417632` (ter-expose ke GitHub history lama) WAJIB di-rotate: `DATABASE_URL`, `REDIS_URL`, `GEMINI_API_KEY`, `GROQ_API_KEYS`, `GOWA_BASIC_AUTH_*`, `CLOUDINARY_*`, `BACKUP_ENCRYPTION_KEY`, `WEBHOOK_SECRET`, `STORAGE_PROVIDER`/`R2_*`, `FIELD_ENCRYPTION_KEY`, `CLOUDFLARE_WORKER_*`, `PUBLIC_API_URL`.
  - **Kecuali:** `RAJAONGKIR_API_KEY` — TIDAK PERNAH ter-expose (baru ditambahkan owner SETELAH purge). Tidak perlu di-rotate.
  - Status: 🟡 **OPEN / DITUNDA** — per keputusan owner, rotate ditunda sampai SEBELUM GO-LIVE (website belum rilis, belum ada trafik nyata). BUKAN diabaikan — wajib sebelum produksi bener-bener live. Risk: secret masih valid di GitHub history lama (sudah di-purge dari working tree & remote SEKARANG, tapi snapshot lama sudah pernah keluar).

### Medium

- **III-3 — Tidak ada pre-commit hook / checklist otomatis (tsc, build, test)**
  - Lokasi: RAILS §1.164.
  - Status: Medium. Manual tiap kali. Mitigasi utama sekarang adalah post-merge hook (III-1-B) + kebiasaan `git status` menyeluruh + `npm run build` sebelum klaim selesai.

- **III-6 — Golden dataset invarian I8–I15: masih test unit parsial, bukan 50-case permanen**
  - Lokasi: STATUS-V2:44; RAILS "golden dataset + test invarian permanen I8-I15 — baru test unit parsial".
  - Status: Medium (regression coverage). Next yang direncakan sejak 9/8.

- **III-1 — `dist/` ter-commit + deploy tanpa build otomatis** (MITIGASI, bukan open)
  - Root cause: pm2 jalan `dist/index.js`, deploy produksi bergantung `dist/` ter-commit tanpa build otomatis.
  - Status: **MITIGASI** (III-1-B, commit `bcddfcd`, 19 Agu 2026): git hook `post-merge` auto-build terpasang. `dist/` MASIH ter-track di git (belum di-untrack) karena untrack ditunda sampai hook terbukti handal di deploy nyata. Pre-commit checklist (§1.164) tetap belum ada; mitigasi utama sekarang adalah post-merge hook + kebiasaan `git status` menyeluruh + `npm run build` sebelum klaim selesai.

### Low

- **IX-D — CARTAUTHORITY-VARIANT-GUARD-DUPLICATION (refactor kapan saja)**
  - Guard `hasVariants && !variantId` ada di 2 tempat: (1) `cart-authority.ts` `resolvePriceAndStock` (single domain authority, commit `0425f8d`) dan (2) `action-registry.ts` `handleAddToCart` (~line 712, handler-layer defense-in-depth). Kedua guard KONSISTEN — sama-sama throw `ErrorCodes.VARIANT_REQUIRED` dengan `name: 'CartInvariantError'`. Tidak ada kontradiksi. Belum di-DRY jadi 1 helper function.
  - Status: OPEN — refactor kapan saja kalau ada siklus maintenance CartAuthority. Tidak blocking.

- **I-2 — Reply resolved terpotong ("adari?")**
  - Lokasi: STATUS-V2:21 (composer-v2).
  - Status: Low (kosmetik). Balasan terpotong di akhir; tidak memblok proses.

- **II-4 — Test-data gap golden-dataset Case 1**
  - Seed `store-golden-test` tidak punya `woltel`/`brambang`, hanya `beras`. Di bawah validasi DB (P2) produk tak ada diskipping → case "pass" lama jadi "fail".
  - Lokasi: golden-dataset.test.ts:303; BASE_PRODUCTS.
  - Status: Low (test-data, bukan logic). Owner-flagged 10 Agu: "pemilik putuskan" — butuh `woltel`/`brambang` ditambah ke seed atau BASE_PRODUCTS.

- **II-5 — Test DB shared isolation lemah (row `ActionIdempotency` bocor lintas file)**
  - Kasus nyata: `structured-actions.test.ts:1039` (P6.3.2) query `findMany({ where: { actionType: 'CANCEL_ORDER' } })` TANPA filter `storeId` → ketemu row asing `storeId='store-f7140b5c'` → false negative. Diselesaikan di P8-2 dengan scope assertion ke `storeId` file sendiri (commit `dd7e7f2`), TAPI ini cuma penambal sempit.
  - Status: 🟡 **AUDITED — 0 assertion rawan ditemukan** (full-scan `src/tests/`, 19 Agu 2026). Root cause asli (cleanup per-prefix, row lintas-file survive) TETAP ADA secara teknis, TAPI currently harmless karena SELURUH assertion sekarang ter-scope `storeId`/`conversationId`/composite-unique. Downgrade ke **hygiene debt**: re-audit kalau ada file test BARU. JANGAN hapus row `store-f7140b5c` manual — itu milik test flow lain / canary.

- **VI-2 — Monitoring single-instance**
  - `/api/admin/metrics/system` in-memory → TIDAK akurat di multi-instance pm2.
  - Status: Low–Med. Gap diketahui; aman untuk single-instance saat ini.

- **GITHUB_PAT — Env var unused**
  - Env var `GITHUB_PAT` ada di .env dan pm2 env, TIDAK PERNAH dibaca oleh code (pm2 env audit 31 Agu 2026).
  - Status: Low (cleanup candidate). Tidak menyebabkan bug.

- **WEBHOOK_SECRET — Env var unused**
  - Env var `WEBHOOK_SECRET` ada di .env dan pm2 env, TIDAK PERNAH dibaca oleh code. Webhook secrets sekarang per-store di DB (pm2 env audit 31 Agu 2026).
  - Status: Low (cleanup candidate). Tidak menyebabkan bug.

---

## ⏸️ DEFERRED (deliberate, not a bug)

- **VII-A — Rotate seluruh secret** — ditunda sampai sebelum go-live (keputusan owner, lihat High section).
- **WA convergence ke Action Registry** — DITUTUP, TIDAK DIPERLUKAN (22 Agu 2026). Keputusan owner: WA TIDAK akan dikonvergensi ke Action Registry/typed action contract. Action Registry didesain untuk aksi yang SUDAH diketahui tanpa interpretasi (tap tombol UI) — WA SELALU free-text dan SELALU butuh LLM. Proteksi yang WA butuhkan SUDAH ADA (idempotency lock P7 + truth boundary P2/I13). Lihat RAILS.md §6.9.
- **VI-3 — RajaOngkir/Komerce dependency risk** — caching hasil cost (Redis 7d) + quota guard. Risiko ban disengaja diterima owner; interface swap-able. Low (owner-accepted).

---

## ✅ RESOLVED (archive)

### Sesi 30–31 Agu 2026

- **C1 — Cross-tenant message injection (IDOR)** — RESOLVED
  - Route: `POST /api/messages/handle` (merchant-facing, authMiddleware).
  - Root cause: `processCustomerMessage` (`conversation.service.ts:73`) used `prisma.conversation.upsert({ where: { id: conversationId } })` keyed by PK alone. If a conversation already existed under a DIFFERENT storeId, the upsert matched by PK and silently processed the message in the wrong tenant's context.
  - Impact: Any merchant could inject messages into any other merchant's WhatsApp conversation by supplying the victim's `conversationId`. Verified: injected message appeared in victim's conversation history and triggered AI reply to victim's customer.
  - Fix: Ownership check BEFORE upsert (throw `ApiError(403)`). Added `storeId` to WHERE clause of all internal conversation update/findUnique calls. Applied same pattern to cross-cutting services. Added `ApiError` handling in `/api/messages/handle` route.
  - Status: ✅ RESOLVED — commit `9852477`. Verified: cross-tenant injection returns 403; same-store messages still work; 480 regression tests pass.

- **C2 — GOWA webhook completely unprotected** — RESOLVED
  - Route: `POST /api/webhooks/gowa` (non-session, highest-risk path).
  - Root cause (a): `gowaTrustMiddleware` (`src/middleware/gowa-trust.ts`) existed but was never mounted. Root cause (b): Store lookup compared plaintext against encrypted `phoneNumber` (AES-256-GCM, random IV) — lookup always failed.
  - Fix: (a) Mounted `gowaTrustMiddleware` on `/api/webhooks/gowa` (loopback-only). (b) Added `phoneNumberHash` column (HMAC-SHA256) for indexed lookup. Updated all store write paths.
  - Status: ✅ RESOLVED — commit `e0715f8`. Verified: external requests rejected; legitimate loopback requests find correct store.

- **Merchant-side push notifications** — RESOLVED
  - New `StorePushSubscription` table (multi-device per store, FK-scoped). `push.service.ts` (shared sendPush + ensureVapidConfigured). `merchant-push.service.ts`: listeners for `order.created`, `order.payment_verification_pending`, `message.created` (customer→admin). Dedupes against admin socket presence. Explicit storeId assertion before each send.
  - Dashboard: manifest.json, sw.js, MerchantNotificationPrompt component.
  - Status: ✅ RESOLVED — commits `55216e0`, `1f0c215`. Verified on real device (Android, FCM 201 response).

- **Duplicate phone registration validation** — RESOLVED
  - Pre-check: compute `phoneNumberHash` before insert, reject with 409 "Nomor HP sudah terdaftar" if already registered. Catch-block distinguishes phone vs slug vs email conflicts.
  - Status: ✅ RESOLVED — commit `0c7beb7`.

- **message.handler.ts dead code removal** — RESOLVED
  - File `apps/api/src/business/message.handler.ts` (committed 52976b4, 18 Aug) was confirmed dead code via two independent audits (Qwen external + internal verification). Zero importers across src + tests. Structurally dangerous if ever wired in (calls `adapters.llm.chat()` directly, bypasses entire pipeline). Removed rather than deprecated-in-place.
  - Status: ✅ RESOLVED — commit `fc2e6cf`.

- **pm2 env audit** — clean, 2 minor findings flagged (GITHUB_PAT, WEBHOOK_SECRET unused).

- **Qwen external audit cross-check** — 13/14 claims false (gitingest silently dropped cart-authority.ts, action-registry.ts, conversation.service.ts from digest with no warning). 1 claim valid (message.handler.ts dead code, now removed). Lesson: verify third-party audit tool inputs contain critical files before trusting/dismissing findings.

- **Qwen external audit — A1/A2/A3/A4 verification** — all STALE CLAIMS:
  - A1 (BUG-12 finalizeDraftOrder missing storeId): `cart-authority.ts:466` includes `storeId` in WHERE.
  - A2 (BUG-13 raw status bypass): all status changes go through `transitionOrder()` (`order-transition.ts:8-10` single source of truth).
  - A3 (RACE-03 stock race): atomic CAS `updateMany({ where: { stock: { gte: qty } }, decrement })` confirmed at `cart-authority.ts:507-510` and `521-524`.
  - A4 (BUG-11 no stock validation): stock validated BEFORE finalization at `cart-authority.ts:479-496`.

- **Qwen external audit — B1-B10 verification** — all PASS (confirmed fixed):
  - B1 (BUG-01 V2 memory): `updateExtractedEntities` uses `atomicCas` + takes `ExtractedEntity[]` (not WorkspaceV2 shape).
  - B2 (BUG-02 extractAndSaveOrder): removed (0 results).
  - B3 (BUG-03/04 qty<=0): `fallback.service.ts:717` filters before subtotal.
  - B4 (BUG-06/07/08/09 fallback fixes): all present.
  - B5 (BUG-14 cart dual representation): CartAuthority single source.
  - B6 (RACE-01/02 atomicCas + V2→V1 guard): atomicCas + canonical mirror pattern.
  - B7 (RACE-04 fallback tier writes): `atomicCasExtractedEntities` (canonical writer only).
  - B8 (AMB-02 engine.ts auth): `adminAuthMiddleware` + `requireAdminRole`.
  - B9 (UNFINISHED-04 dist tracked): deliberate, logs clean.
  - B10 (UNFINISHED-09 test failures): reasoning-v2 13/13 pass, engine-config-v2 6/6 pass.

- **Qwen external audit — C1-C4 verification**:
  - C1 (ORPHANS): modifyCart/syncCartStateToDraftOrder ACTIVE; api_new.ts/adminApi_new.ts don't exist; AIProviderManager ACTIVE; message.handler.ts was dead code (now removed).
  - C2 (ORPHAN-06 dashboard): handleExport/ConfirmDialog/confirmDelete don't exist in AuditLogViewer.tsx/PlatformConfig.tsx.
  - C3 (AMB-05 GOWA protection): only `gowaTrustMiddleware` (IP restriction) active. HMAC explicitly NOT implemented (owner decision D3 HOLD).
  - C4 (UNFINISHED-02/03/05/06): all still open as expected.

### Sesi 29 Agu 2026

- **I-3 — activeOrder/tryTotal tidak diskriminatif draft vs pending** — RESOLVED (P4.2, 11 Agu 2026)
  - `activeOrder` dan `tryTotal`/`lastOrder` fallback sekarang query `draft` eksklusif dulu, fallback ke `pending`+lain HANYA bila tidak ada draft. Plus perbaiki bug pre-existing `JSON.parse(lastOrder.items as string)`.

- **PV-P2c full stack — WA variant support** — RESOLVED
  - TEXT (`71ba429`): inquiry `hasVariants` redirect ke storefront. LLM-A (`a454ec1`): skema LLM `variant` = deskriptif teks. LLM-B (`ba2acf5`): `CartAuthority.resolveVariantByLabel` (DB-driven). E2E live-proven.

- **Stock Integrity Fix (PV-P1-08)** — RESOLVED
  - `cart-authority.checkout()`: atomic decrement via `updateMany` CAS (`stock >= qty`), `autoCancelAt` timestamped. `order.service.cancelOrder()`: stock restore. `scheduleAutoCancel.ts`: 15-min cron.

- **Tenant Isolation Fix** — RESOLVED
  - GET `/api/products/:productId` dihapus (unscoped). Penggunaan: 0 caller, diganti `/api/pwa/:storeSlug/products/:productId`.

- **SSL/HTTPS** — VERIFIED (certbot, expiry 5 Nov 2026, auto-renew aktif).

### Sesi 28 Agu 2026

- **Admin security cluster** — RESOLVED
  - IX-A: public registration exposure (`b64babf`) + engine.ts unauthenticated routes (`ae40461`). Bootstrap-once gating + `adminAuthMiddleware` + `requireAdminRole`.
  - IX-B: admin password reset mechanism (interim operator-only) — `POST /api/admin/auth/reset-password-operator` + `scripts/reset-admin-password.ts`.
  - IX-C: no internal caller for engine.ts routes (verified).

### Sesi 27 Agu 2026

- **PV-P2 variant support** — RESOLVED
  - VIII-A: `executeOps` price bug + `resolvePriceAndStock` tx-consistency (`4c2e4f2`).

### Sesi 22 Agu 2026

- **Insiden `.env` ter-track di git history** — RESOLVED
  - Purge via `git filter-repo` + force-push. `.env` recovered from `/proc/<pid>/environ`. Detail di RAILS.md §6.
  - VII-B: RAJAONGKIR_* hilang dari pm2 env → SUDAH diatasi manual (owner tambahkan ke .env).

- **G2-H Release Readiness** — PRAKTIS SELESAI
  - Shipping CI gap (`e16679d`), backup restore rehearsal (`0d29aaf`), generalLimiter global safety net (`10be048`), rate-limiter gaps 11 endpoint (`10be048`), VAPID/web-push env (FASE4), `test:shipping` CI (`e16679d`).
  - VI-5: BACKUP_ALERT_EMAIL no sender → RESOLVED (interim: nodemailer SMTP sender `src/services/mailer.service.ts` + wiring ke `backup.service.ts`).

### Sesi 21 Agu 2026

- **Shipping-cost full-stack (RajaOngkir Komerce)** — RESOLVED (`490e853..2e64c0a`)
  - Origin store + destination customer + berat order → pilihan kurir via Komerce → `Order.shippingCost`/`shippingService`. RajaOngkir = kalkulator ongkir (BUKAN tracking) → Opsi (B) COD RESMI DITUTUP.

- **Store NOT NULL registration** — RESOLVED (`03bce76..d3c7855`)
  - `Store.phoneNumber`/`address`/`origin*` NOT NULL; register wajib phone/address/lokasi; null-write fix (`d3c7855`).

- **Monitoring dasar (G2-G)** — RESOLVED
  - `AUDIT-BASELINE-G2-G.md` (`dd20696`), `GET /api/admin/metrics/system` (`b18b6d5`).

### Sesi 19 Agu 2026

- **II-6 — P8 CI gate tidak men-cover structured-actions suite** — RESOLVED (commit `c6be2d8`)
  - `test:structured` script + step CI. 115 tests / 7 suites pass.

- **II-7 — G2-F test suites TIDAK ter-cover CI** — RESOLVED (commit `e293040`)
  - `test:payment` script + step CI. 30 tests pass.

- **III-4 — P3 T5 fallback tier overlap** — RESOLVED (FIX-3, commit `5e7ef42`)
  - `saveDiscussedItems` sekarang pakai `atomicCasExtractedEntities` (CAS `updatedAt` + retry).

- **III-5 — Race appendMessage lastMessages** — RESOLVED (FIX-4, commit `353e883`)
  - `appendMessage` pakai `atomicCasMessages` (CAS `updatedAt` + retry).

- **III-7 — I11 kamus slang normalizer** — RESOLVED (FIX-1, commit `e6c7157`)
  - Lookup typo sekarang lowercase (`normalizer.ts:153`).

- **III-8 — I12 guard nama produk di normalizer** — RESOLVED (FIX-1, commit `e6c7157`)
  - Guard `fuzzyMatchProduct` + multi-word product guard.

- **III-9 — LEASE_FINAL_MS = 750** — RESOLVED (19 Agu 2026)
  - `LEASE_FINAL_MS` 750ms→30000ms (30s), owner-decided interim value.

- **III-10 — Cycle import container.ts ↔ 3 adapter** — RESOLVED (FIX-5, commit `6385322`)
  - Cycle diputus dari sisi adapter (dynamic `await import`).

- **II-1 — reasoning-v2 test outdated** — RESOLVED (stale test assertion, commit `4fc6730`)
  - Code `reasoning.ts:328-338` SUDAH return `reasoned` sejak `f4ab025`. Assertion test diperbaiki ke `reasoned`.

- **II-2 — engine-config-v2 suite gagal load** — RESOLVED (STALE DOC, 19 Agu 2026)
  - `engine-config-v2.test.ts` LULUS 6/6. TDZ `container.ts:38` TIDAK direproduksi ulang. Root cause ditangani FIX-5 (cycle import diputus).

### Sesi 10–18 Agu 2026

- **P4.1 — extractAndSaveOrder** — RESOLVED (fungsi dihapus).
- **P3 T1–T4** — RESOLVED (commit c164729/3780453/eb74929/099967a/fd08ba3).
- **P2 truth boundary validateCartOpsAds** — RESOLVED.
- **P2 eskalasi ke pemilik toko (TASK C1)** — RESOLVED (commit 718c375).
- **FLAGSHIP multi-add** — RESOLVED (fast-path guard).
- **I-1 — Qty 0 di receipt** — RESOLVED (stale doc, already filtered).
- **III-2 — logs/*.log ter-track** — RESOLVED (di-exclude + di-purge dari history).

---

> Catatan: daftar ini **tidak** memasukkan `extractAndSaveOrder` (sudah dibereskan
> P4.1) ataupun T1–T4 P3 / eskalasi C1 / multi-add FLAGSHIP / truth-boundary P2
> (semua sudah resolved & ter-commit).
