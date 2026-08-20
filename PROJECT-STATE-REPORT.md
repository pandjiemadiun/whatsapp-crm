# PROJECT STATE REPORT — QloBot / Garuda CRM

> **Dokumen ini dibuat untuk onboarding ke project baru (Claude/AI coding agent).**
> Semua klaim status di bawah diverifikasi terhadap **source code, test, dan git log aktual**
> di working tree `/home/ubuntu/garuda` pada **2026-08-20** (HEAD `e293040`). Tidak ada klaim
> yang diambil mentah dari roadmap/STATUS lama tanpa cross-check ke kode.
>
> **ATURAN RAILS.md BERLAKU:** tidak ada kode yang diubah dalam pembuatan dokumen ini
> (murni read-only / dokumentasi).
>
> **⚠️ INSIDEN PROSES (baca §10):** cluster besar (P6-1/P6-2/P6-3, P4-2/P4-3, P8-1/P8-2,
> P6.4/P6.5, III-1-B hook, III-2-A/B purge, P8-CI-FIX) sudah di-kerjakan & di-push di sesi
> SEBELUMNYA TANPA dilaporkan real-time dengan bukti RAILS §1.2. Dokumen ini menutup gap
> tersebut pasca TASK VERIFY-CLUSTER + DOCS-SYNC 19 Agu 2026. Working tree saat ini BERSIH
> (semua ter-commit & ter-push ke `origin/main`).

---

## 1. RINGKASAN PROJECT

### 1.1 Apa itu QloBot

QloBot adalah **AI WhatsApp commerce engine** yang berevolusi dari "bot WhatsApp" menjadi
**intelligent commerce experience** (Generation 2.0): chatbox/PWA sebagai storefront premium
milik merchant, Conversation Engine sebagai otak, commerce domain sebagai sumber kebenaran.
Dua kelas pengguna:

- **Merchant / toko** (canary: `store-f7140b5c` — Depot Kinasih) — mengelola katalog, order, dashboard, takeover chat ke human.
- **Customer** — chat via WhatsApp (Fonnte/GOWA) atau Web Chatbox (PWA di `qlobot.web.id`).

### 1.2 Stack teknologi (versi NYATA dari package.json)

Monorepo. Build/tsc/test dijalankan per-app, terutama dari `apps/api`.

**`apps/api`** (`garuda-api@0.0.1`, `type: module`):
```
dependencies: @prisma/client ^5.10.0, express ^4.18.2, socket.io ^4.8.3,
  ioredis ^5.11.1, redis ^5.0.0, zod ^4.4.3, bullmq ^5.1.11, cloudinary, sharp,
  web-push, axios, cors, multer
devDependencies: typescript ^5.3.3, prisma ^5.10.0, jest ^29.7.0, ts-jest, tsx ^4.7.0, oxlint
```
Catatan: kontrak structured actions mengunci **Prisma 5.22.0** (§6A.12); `package.json` `^5.10.0`
hanya pin kosmetik — resolved version (package-lock.json) = **5.22.0 persis** (lihat §6.8, ✅ AUDITED).

**`apps/pwa`** (`pwa@0.0.0`, Vite+React) — chatbox web storefront.
**`apps/dashboard`** (`dashboard@0.0.0`, Vite+React) — merchant admin dashboard.

### 1.3 Struktur folder utama

```
apps/api                # Backend Express + Prisma + Conversation Engine
  src/business/         # action-registry.ts, cart-authority.ts, order.service.ts, conversation.service.ts
  src/services/chat/    # interpreter.ts (v1), reasoning.ts (v2)
  src/routes/           # webhooks.ts (WA), pwa.ts (web), actions.ts (/action typed)
  prisma/               # schema.prisma + migrations/ (ActionIdempotency SUDAH di schema+committed)
  tests/                # golden-dataset.test.ts, structured-actions*.test.ts, dst
  dist/                 # build artifact (TER-TRACK git — lihat §6.6/§9)
.github/workflows/test.yml   # CI gate: test:chat + test:golden + test:structured
RAILS.md                # KONTRAK KERJA AI (TER-TRACK, committed)
BUG-BELUM-DIBERESKAN.md
DOCS/CONTRACT/PROJECT-CONTRACT-STRUCTURED-ACTIONS.md  # kontrak (TER-TRACK, committed)
DOCS/ARCHIVE/CONSOLIDATED-HISTORY.md
ecosystem.config.js     # PM2 (api + dashboard)
```

---

## 2. ARSITEKTUR SAAT INI (yang NYATA, terverifikasi source)

### 2.1 Dua jalur masuk pesan
- **A. WhatsApp (Fonnte/GOWA)** → `routes/webhooks.ts` → `messageProcessorService.processMessage()` (`:103`,`:262`). Fonnte divalidasi via `?secret=` vs `Store.webhookSecret`.
- **B. Web Chatbox (PWA)** → `routes/pwa.ts` (`:message`) → `conversationDeliveryService.processWebRequest()`. Structured actions: `routes/actions.ts` (`POST /api/pwa/:storeSlug/action`).

### 2.2 Pipeline pemrosesan
`services/message-processor.service.ts` `processMessage()` (`:96`): Dedup → Dead-end →
Coalescing → Priority → Mutex → Circuit-breaker → Rolling ctx → LLM fallback → Presence sim
→ Send+retry → Health metrics.

### 2.3 Conversation Engine
`business/conversation.service.ts` `processCustomerMessage()` (`:62`). v2 (`reasoning.ts`
`understand()`) / v1 (`interpreter.ts` `runOneCall()`, 1 Groq call). Keduanya konvergen di
**CartAuthority** (harga SELALU dari DB via `validateCartOpsAgainstDb`, P2/I13).

### 2.4 Structured Actions (jalur TERPISAH, bukan lewat LLM)
`routes/actions.ts` → `getOrCreateWebSession()` (shared resolver) → `executeAction(type,
request, context)` di `business/action-registry.ts` → handler → `claimAction()` (STAGE 1:
INSERT `ActionIdempotency` CLAIMED) → `executeClaimedAction()` (STAGE 2: `SELECT ... FOR
UPDATE` + re-check + SAVEPOINT + mutasi via `CartAuthority`/`orderService`).
Registry typed: `ADD_TO_CART`, `REMOVE_FROM_CART`, `UPDATE_CART_QUANTITY`, `CANCEL_ORDER`,
`CONTACT_ADMIN`, `SHOW_RELATED_PRODUCTS`, `OPEN_CATALOG`, `OPEN_CART`, `OPEN_ORDER_HISTORY`.

### 2.5 Diagram alur (panah TERVERIFIKASI)
```
WA/Fonnte  ─► webhooks.ts ─► messageProcessorService.processMessage()
PWA /message ─► pwa.ts ─► conversationDeliveryService.processWebRequest()
        └────► conversationService.processCustomerMessage() ─► v1/v2 reasoner ─► validateCartOpsAgainstDb ─► CartAuthority (SINGLE SOURCE OF TRUTH)
PWA /action ─► actions.ts ─► getOrCreateWebSession() ─► executeAction() ─► claimAction() ─► executeClaimedAction() [FOR UPDATE + SAVEPOINT] ─► CartAuthority / orderService
```
Verifikasi file:line: `webhooks.ts:103/262`, `conversation.service.ts:62`, `action-registry.ts`
`handleAddToCart`/`executeClaimedAction`, `cart-authority.ts:executeOps/removeLine/updateQuantity`.

### 2.6 Authority Layer
`getOrCreateWebSession()` (`routes/pwa.ts`) = satu-satunya resolver identity Web
(`storeId`+`customerId`+`conversationId`, `channel='web'`), dipakai `/message` & `/action`.

---

## 3. KONTRAK YANG TERKUNCI

### 3.1 `RAILS.md` (root repo) — KONTRAK KERJA AI
- **Status git:** TER-TRACK / committed (tidak lagi uncommitted).
- §1: bukti mentah wajib, scope terkunci, mulai sesi dengan `git status`, dilarang klaim
  selesai tanpa acceptance dicek + bukti RAILS §5.
- §5: "SELESAI" = 6 bukti (tsc 0, `npm run build`, test suite, `git diff --stat`, `pm2
  restart`, bukti manual). `npm run build` wajib (pm2 jalan `dist/index.js`).
- §4.1: git hook `post-merge` auto-build (III-1-B) — mitigasi stale dist.

### 3.2 `PROJECT-CONTRACT-STRUCTURED-ACTIONS.md` (DOCS/CONTRACT)
- **Status git:** TER-TRACK / committed (tidak lagi UNTRACKED).
- §6A.1: P0 `ADD_TO_CART` WAJIB pakai `CartAuthority.executeOps(ops, storeId, customerId,
  conversationId, tx)` dengan `tx` SAME transaction ber-lock. `addLine()` / `executeCartOps()`
  DILARANG untuk P0.
- §6A.2: `ActionIdempotency` uniqueness `(storeId, customerId, actionType, actionId)`, retention permanen.
- §6A.4: Permanent Locking — tidak ada yang panggil mutasi tanpa `FOR UPDATE` + re-check di SAME tx.
- §6A.11: Stage-2 prohibitions (no claimToken, no network/LLM in tx, no CartAuthority modif for P0, no 2nd Stage-2 impl).
- §4/§10: typed registry (bukan if/else), setiap action punya schema+handler+error mapping.

> **Trap lama SUDAH TERTUTUP:** `ActionIdempotency` SEKARANG ada di `schema.prisma` (committed)
> + migrasi `20260816000000_*` + `20260816000100_*` (rantai prerequisite, keduanya applied).
> Clean-clone + `prisma generate` + `tsc` + `build` SUDAH hijau (diverifikasi di UPDATE-SINCE
> + TASK VERIFY-CLUSTER). Tidak ada lagi build trap.

---

## 4. STATUS TIAP FASE ROADMAP

### 4.1 Roadmap Stabilisasi Engine v2 — RAILS.md §3 (P0–P6)

| Fase | Scope | Implementasi | Status (19 Agu 2026) |
|------|-------|--------------|----------------------|
| **P0** | Safety boundary (v2 tak fallback ke v1 setelah mutate) | `conversation.service.ts:116` `v2MutationExecuted` | **SELESAI (verified)** |
| **P1** | Semantic authority (5 tier) | `fallback.service.ts`, `tier-match.ts` | **SELESAI (verified)** |
| **P2** | Truth boundary (harga dari DB) | `validateCartOpsAgainstDb` di semua titik | **SELESAI (verified)** |
| **P3** | Context boundary (workspace_v2) | kolom `workspace_v2` + migrasi | **SELESAI (verified)** |
| **P4** | Remove second brain | `extractAndSaveOrder` dihapus (`0db56bf`) | **SELESAI (verified)** |
| **P5** | Response naturalness | composer fixes | **SELESAI (verified)** |
| **P6** | Golden dataset sebagai architecture gate | `test:golden` + CI (P6.3) + coverage P3/P4/P5 (P6.4/5) | **SELESAI (verified)** — test:golden 23/23 |

### 4.2 Roadmap Structured Actions — P0–P8 (PROJEK-CONTRACT §10)

| Fase | Aksi | Commit | Status (19 Agu 2026) |
|------|------|--------|----------------------|
| **P0** | ADD_TO_CART | `25d0f43` (foundation) + `4224331` (P6-1 productId envelope) | **SUDAH ADA, TER-PUSH, VERIFIED** |
| **P1** | SHOW_RELATED_PRODUCTS | `25d0f43` | **SUDAH ADA, TER-PUSH, VERIFIED** |
| **P2** | OPEN_CATALOG | `25d0f43` | **SUDAH ADA, TER-PUSH, VERIFIED** |
| **P3** | OPEN_CART | `25d0f43` | **SUDAH ADA, TER-PUSH, VERIFIED** |
| **P4** | Quick Action Contract | `73f607b` (wire 5 PWA quick actions) + `b610e69` (CONTACT_ADMIN) | **SUDAH ADA, TER-PUSH, VERIFIED** |
| **P5** | OPEN_ORDER_HISTORY | `25d0f43` | **SUDAH ADA, TER-PUSH, VERIFIED** |
| **P6** | NL → Validated Actions | `4224331`/`8dc22a3`/`2c604cc` | **SUDAH ADA, TER-PUSH, VERIFIED** |
| **P7** | WA convergence ke idempotency lock (reuse FOR UPDATE structured-actions) | `0e6a5fa`..`22caa82` (5 unit commit + 2 doc) | **SELESAI, TER-PUSH, VERIFIED** |
| **P8** | Regression / release gate | `c6be2d8` (CI lengkap: test:chat+test:golden+test:structured) | **SELESAI, TER-PUSH, VERIFIED** |

**Registry terdaftar (action-registry.ts):** `ADD_TO_CART`, `REMOVE_FROM_CART`,
`UPDATE_CART_QUANTITY`, `CANCEL_ORDER`, `CONTACT_ADMIN`, `SHOW_RELATED_PRODUCTS`,
`OPEN_CATALOG`, `OPEN_CART`, `OPEN_ORDER_HISTORY`.

### 4.3 🟢 TEMUAN LAMA (UNCOMMITTED + schema drift) — **RESOLVED & ARSIP**
Dulu (laporan 18 Agu) structured actions + migrasi + kontrak + `ActionIdempotency` di
`schema.prisma` berstatus **UNCOMMITTED** (build trap untuk clean-clone). **Status sekarang:
RESOLVED** — seluruh cluster di-commit & di-push (`25d0f43..c6be2d8`), `ActionIdempotency`
SUDAH di `schema.prisma`, clean-clone build hijau. Diarsipkan sebagai catatan resolved agar
pelajaran (jangan biarkan pekerjaan besar menggantung uncommitted) tidak hilang. Bukti:
`git ls-files apps/api/prisma/schema.prisma` + `grep -n Idempotency apps/api/prisma/schema.prisma`
(>0 match), `git log --oneline 25d0f43..c6be2d8`.

### 4.4 Roadmap Generation 2.0 — G2-A → G2-H

| Fase | Scope | Status terverifikasi |
|------|-------|----------------------|
| **G2-A** | Baseline + Safety Freeze | Dokumen ada (`DOCS/G2-A-baseline-report.md`) |
| **G2-B** | Core Architecture Hardening | webhook secret ✅, dead code cleanup ✅, retry/circuit ✅ |
| **G2-C** | Commerce Domain Refactor | CartAuthority single cart authority ✅ |
| **G2-D** | Conversation State Refactor | `workspace_v2` ✅ (P3) |
| **G2-E** | Storefront UI/UX | banyak done (PWA deploy `qlobot.web.id`, realtime+push FASE 1-4) |
| **G2-F** | Checkout/Order/Payment | **SELESAI (F1–F5)** — F1 (schema+bugfix) SELESAI, F2 (payment-report/verify) SELESAI, F3 (PWA checkout) SELESAI, F4 (dashboard payment verification UI + `GET /orders/:id/valid-next-states`) SELESAI, F5 (CI coverage audit + golden dataset checkout/payment, mutation-tested) SELESAI (commit `e293040`). Provider = manual transfer/QRIS only, COD settlement DEFERRED (lihat DECISION-COD-SETTLEMENT-DEFERRED.md) |
| **G2-G** | Realtime + Scale Hardening | socket.io + presence ✅; multi-instance BELUM |
| **G2-H** | Release Readiness | **BELUM** — gate terakhir |

---

## 5. MASALAH YANG SUDAH DIPERBAIKI (histori — jangan diulang)

### 5.1 `dist/` stale build artifacts (berulang, III-1)
Root cause: pm2 jalan `dist/index.js`, deploy produksi bergantung `dist/` ter-commit tanpa
build otomatis. Insiden: TASK B1 unit 11/11 pass tapi produksi salah karena `dist/` tidak
rebuild. **Mitigasi (III-1-B, `bcddfcd`):** git hook `post-merge` auto-build terpasang.
Status: **MITIGASI** (dist MASIH ter-track; untrack ditunda sampai hook terbukti di deploy nyata).

### 5.2 Dead-end fallback LLM (owner-flagged 18 Agu)
Mekanisme skip-LLM ada di `message-processor.service.ts:115` `isDeadEnd()`. Belum ada laporan
forensik tertulis; disarankan test case di `test:golden`.

### 5.3 P4 — `extractAndSaveOrder` dihapus (10 Agu)
`grep -c extractAndSaveOrder` di source = 0 ✅. **SELESAI**.

### 5.4 P0 — Safety boundary (double mutation)
`v2MutationExecuted` flag ✅. **SELESAI**.

### 5.5 P2 — Truth boundary (harga dari DB)
`validateCartOpsAgainstDb` di semua titik ✅. **SELESAI**.

### 5.6 P6-1 — Round-trip productId→name→productId dihilangkan (`4224331`)
`handleAddToCart` kirim `productId` langsung; `executeOps` branch `resolveProductById` (skip
`resolveProductByName`). NL path tidak berubah. **SELESAI**.

### 5.7 P6-2/P6-3 — REMOVE/UPDATE/CANCEL typed (`8dc22a3`/`2c604cc`)
Ketiga mutation + `CANCEL_ORDER` typed, delegate ke `CartAuthority`/`orderService`, reuse
Stage-1/Stage-2 idempotensi. **SELESAI**. Plus fix gap `actionsRouter` tidak di-mount sejak
foundation (`2c604cc`).

### 5.8 P7 — WA cart mutation convergence ke idempotency lock (`0e6a5fa..22caa82`)
4 situs mutasi WA — v1 LLM `:673`, v1 resolver EXECUTE `:511`, v2 resolved EXECUTE `:238`, v2 plannedActs `:321` — di-converge ke 1 adapter `executeWaCartMutation` (`action-registry.ts`) yang **reuse** `claimAction`/`executeClaimedAction` (FOR UPDATE + re-check + SAVEPOINT, identik dengan PWA). `actionType` baru `WA_CART_MUTATION`; `actionId` deterministik `wa:${conversationId}:${messageId}` (idempotensi level PESAN). `CartAuthority`/`interpreter`/`reasoning` TIDAK disentuh; ROLLBACK `:548` tetap legacy. Bukti: test idempotensi WA baru 6/6, test:chat 267/267, test:golden 26/26, test:structured 115/115. **SELESAI** (RAILS.md §3).

---

## 6. MASALAH YANG DIKETAHUI BELUM SELESAI

### 6.1 🟢 Structured Actions UNCOMMITTED + schema drift — **RESOLVED** (`25d0f43..c6be2d8`)
Lihat §4.3. Tidak lagi blocker.

### 6.2 🟢 Round-trip productId→name→productId — **RESOLVED** (`4224331`)
Lihat §5.6.

### 6.3 🟢 REMOVE/UPDATE/CANCEL belum typed — **RESOLVED** (`8dc22a3`/`2c604cc`)
Ketiga action + CANCEL_ORDER sudah typed & terverifikasi reachable via HTTP.

### 6.4 🟢 Golden dataset BUKAN CI gate lengkap — **RESOLVED** (P6.4/5 + P8-CI-FIX)
Coverage P3/P4/P5 ada (`e2d391e`/`55c66c5`), mutation-tested. `test:golden` 23/23.
P8-CI-FIX (`c6be2d8`) masukkan `test:structured` (115 test) ke CI → gate lengkap.

### 6.5 🟡 Pre-existing test failures (baseline) — **MASIH OPEN (tidak blocking)**
`test:chat` baseline = **1 failed test** (reasoning-v2; full suite **267/267** otherwise hijau, terverifikasi 19 Agu 2026):
- `reasoning-v2.test.ts` — "terminal→fallback" outdated (II-1).
- ~~`engine-config-v2.test.ts` — `ReferenceError: redisAdapter before initialization` (II-2)~~ ✅ **RESOLVED (STALE DOC, 19 Agu 2026)** — audit read-only konfirmasi `engine-config-v2.test.ts` LULUS **6/6** (di-run 6x, full `test:chat` 267/267 tiap kali). TDZ TIDAK direproduksi ulang. Cycle import `container.ts`↔3 adapter tetap ada tapi benign (semua `adapters.` di dalam method) — lihat BUG-BELUM-DIBERESKAN II-2 + III-10.

### 6.6 🟡 Hygiene: `dist/` ter-track + `logs/` (III-1 / III-2)
- `logs/*.log`: **RESOLVED** (III-2-A/B, `bcddfcd`) — di-exclude + di-purge dari history
  (backup bundle `garuda-backup-20260819.bundle`).
- `dist/`: **MITIGASI** (III-1-B) — post-merge auto-build hook terpasang; dist MASIH ter-track,
  untrack ditunda sampai hook terbukti di deploy nyata.

### 6.7 🟡 Lainnya (dari BUG-BELUM-DIBERESKAN.md)
- **I-1** Qty 0 di receipt ("Brambang (0x)") — Medium, kosmetik.
- **II-5** Test DB shared isolation lemah (row `store-f7140b5c` bocor lintas file) — 🟡 **AUDITED (19 Agu 2026): 0 assertion rawan ditemukan** di full-scan `src/tests/`; root cause (cleanup per-prefix) tetap ada tapi harmless karena semua query sudah scope `storeId`/`conversationId`/composite-unique. Hygiene debt, bukan follow-up task.
- **III-4/III-5** T5 fallback overlap + `appendMessage` race — belum diklasifikasi.
- **III-7/III-8** I11/I12 normalizer — typo lolos / guard belum diverifikasi.
- **Kata `'mau'` di `ORDER_INTENT_KEYWORDS`** (`fast-path.ts`) bisa short-circuit sebelum `trySop`.

### 6.8 ✅ Prisma version — AUDITED (resolved = 5.22.0, match kontrak §6A.12)
Kontrak §6A.12 mengunci **Prisma 5.22.0**; `package.json` `^5.10.0`. Audit read-only
(2026-08-19) konfirmasi resolved version (`@prisma/client`, `prisma`, `@prisma/engines`)
= **5.22.0 persis** via lockfile — SAMA dengan kontrak. Pin `^5.10.0` murni kosmetik,
sudah resolve benar ke 5.22.0. `FOR UPDATE` via `$queryRaw` (action-registry) berjalan di
versi ini. **Tidak ada tindakan diperlukan** (LOW, closed).

### 6.9 🔴 P7 — WA convergence ke action contract — **OPEN (BELUM DIPUTUSKAN SCOPE)**
`routes/webhooks.ts` (WA) memanggil `messageProcessorService.processMessage()` — **TIDAK**
pakai `actionRegistry`/`executeAction`. WA masih text-only lewat Conversation Engine (interpreter
→ acts → `CartAuthority.executeOps` via nama). PWA/web sudah konvergen ke typed action contract;
WA belum. **Kandidat next task** (lihat §8). Scope belum diputuskan (apakah WA juga kirim
typed action payload, atau tetap natural-language).

---

## 7. DATABASE & CONFIG

### 7.1 Skema tabel penting

| Tabel | Kolom kunci | Catatan |
|-------|-------------|---------|
| `Store` | id, phoneNumber, fonnteToken, webhookSecret, slug | |
| `Conversation` | id, customerId, channel, status (`open`/`human_takeover`) | |
| `ConversationContext` | conversationId, extractedEntities, **workspace_v2** (P3) | dual-writer legacy vs v2 sudah ditutup |
| `Order` | id, orderStatus (`draft`=cart, `waiting_*`, `paid`, `confirmed`, `shipped`, `completed`, `cancelled`), totalPrice | Cart = draft Order + OrderItem |
| `OrderItem` | id, orderId, productId, productName, quantity, unitPrice, subtotal | baris cart |
| `Product` | id, storeId, name, price, stock, isActive, deletedAt | identity cart = productId |
| `Customer` | id, storeId, webUid?, pushSubscription | |
| `SystemSetting` | key (@unique), value, category, isSecret | encryption key di `FIELD_ENCRYPTION_KEY` |
| `ActionIdempotency` | **SUDAH di schema.prisma (committed)** — idempotencyKey (PK), actionId, actionType, storeId, customerId, status (CLAIMED/COMPLETED/FAILED), leaseUntil, result, error; `@@unique([storeId,customerId,actionType,actionId])` | §4.3 |

### 7.2 Environment variables (tanpa nilai rahasia)
`DATABASE_URL`, `REDIS_URL`, `FIELD_ENCRYPTION_KEY`, `GROQ_API_KEYS`, `GEMINI_API_KEY`,
`FONNTE_TOKEN`/`Store.fonnteToken`, `VAPID_PUBLIC/PRIVATE_KEY`, `PORT`, `NODE_ENV`.
> Rahasia TIDAK boleh di-expose di log/doc.

---

## 8. NEXT TASK YANG DISEPAKATI

### 8.1 P7 — WA convergence ke action contract (kandidat berikutnya, **BELUM DIPUTUSKAN SCOPE**)
Saat ini hanya PWA/web yang pakai typed action contract (`/action`). WA (`webhooks.ts`) masih
natural-language via Conversation Engine. Opsi belum diputuskan:
- (a) WA tetap NL, tapi hasil interpreter diarahkan ke action contract yang sama (konvergensi
  di executor, bukan di gateway), atau
- (b) WA juga kirim typed action payload (butuh client WA/button).
**Scope belum disepakati** — jangan mulai tanpa keputusan owner (batasi scope, jangan modifik
  CartAuthority core / transaction invariant §6A).

### 8.2 Antrian (open)
- **P7 WA convergence** — BELUM diputuskan scope (§8.1).
- **II-5 test-isolation** — audit assertion `actionType`/`store`-wide lintas file test.
- **6.5** pre-existing test failures (II-1/II-2) — perbaiki di test env (tidak blocking).
 - **6.7** sisa kosmetik / normalizer (I-1, III-4/5/7/8).


---

## 9. CARA VERIFIKASI (untuk siapapun yang lanjutkan)

> Working tree BERSIH (semua ter-commit & ter-push ke `origin/main`, HEAD `e293040`).
> Tidak ada lagi peringatan "jangan git reset --hard" karena file menggantung uncommitted.

### 9.1 Build & typecheck (dari `apps/api`)
```bash
cd /home/ubuntu/garuda/apps/api
npx tsc --noEmit          # 0 error (terverifikasi 19 Agu)
npm run build             # WAJIB — generate dist/
```

### 9.2 Test
```bash
cd /home/ubuntu/garuda/apps/api
npm run test:chat         # Jest: 270/270 hijau (baseline 0 failed, reasoning-v2 + engine-config-v2)
npm run test:golden       # node:test golden-dataset: 26/26 pass
npm run test:structured   # node:test structured-actions*: 115 tests / 7 suites pass (P8-CI-FIX)
npm run test:payment      # node:test G2-F suites: 30 tests / 4 files pass (G2-F5, commit `e293040`)
#   - payment.test.ts (F2, 10) + pwa-checkout.test.ts (F3, 8) + payment-verify-routes.e2e.test.ts (F1/F4, 7)
#     + golden-payment.e2e.test.ts (G2-F5 golden checkout/payment, 5, mutation-tested)
```

### 9.3 Restart & log (produksi VPS `root@vps3541799`, repo `/home/ubuntu/garuda`)
```bash
pm2 restart api           # restart API (dist/index.js)
pm2 status                # cek online / crash loop
pm2 logs api --lines 100
```

### 9.4 Database & Prisma
```bash
cd /home/ubuntu/garuda/apps/api
npx prisma migrate status
npx prisma studio
# SELECT count(*) FROM action_idempotency;  -- SEKARANG ada (schema committed)
```

### 9.5 Git state
```bash
git status --short | head   # diharapkan KOSONG (clean)
git log --oneline -3        # HEAD: c6be2d8
```

### 9.6 Verifikasi klaim
- `grep -n Idempotency apps/api/prisma/schema.prisma` → >0 (model ada).
- `grep -n "ADD_TO_CART\|REMOVE_FROM_CART\|UPDATE_CART_QUANTITY\|CANCEL_ORDER\|CONTACT_ADMIN" apps/api/src/business/action-registry.ts` → 5 entri mutation + CONTACT_ADMIN.
- `grep -n "executeClaimedAction\|FOR UPDATE" apps/api/src/business/action-registry.ts` → ADD/REMOVE/UPDATE/CANCEL pakai pola sama (CONTACT_ADMIN via status-guard, by design).

---

## 10. Known unreported-work gap (19 Agu 2026) — INSIDEN PROSES

**Apa yang terjadi:** cluster besar di-kerjakan & di-push di sesi SEBELUMNYA TANPA dilaporkan
real-time dengan bukti RAILS §1.2:
`25d0f43` (foundation), `4224331` (P6-1), `8dc22a3` (P6-2), `2c604cc` (P6-3),
`b610e69` (P4-2), `73f607b` (P4-3), `d114526`/`dd7e7f2` (P8-1/P8-2), `e2d391e`/`55c66c5`/
`58d6de0` (P6.4/5), `bcddfcd` (III-1-B + III-2-A/B), `c6be2d8` (P8-CI-FIX).

Ini **persis pola insiden P6 lama** (golden dataset dulu juga dikerjakan tanpa masuk CI sampai
P6.3). Ditemukan lewat audit read-only (TASK STATUS-SYNC) saat mengerjakan task lain, lalu
ditutup pasca **TASK VERIFY-CLUSTER** (bukti RAILS §5 untuk seluruh cluster) + **TASK DOCS-SYNC**
(dokumen ini).

**Mengapa berbahaya:** pekerjaan "selesai" di git tapi tidak terdokumentasi = tidak ada
cross-check acceptance, tidak ada bukti mentah, status project (PROJECT-STATE-REPORT,
BUG-BELUM-DIBERESKAN, RAILS §6) jadi kadaluarsa / kontradiktif. Audit jadi butuh waktu ekstra.

**Pelajaran (jangan diulang):**
1. Setiap TASK yang "selesai" HARUS lampirkan bukti RAILS §5 + laporan status di sesi yang SAMA.
2. Commit + push SEGERA setelah 1 unit kerja verified (jangan tahan doc/edit).
3. Jangan biarkan cluster besar menggantung sebagai "sudah di-push tapi lupa dilaporkan".
4. RAILS §6 RETROAKTIF entries (blok 6.x) menandai explisit tiap commit di atas sebagai
   post-hoc, bukan laporan tepat waktu — supaya tidak disamarkan.

---

## APPENDIX A — Daftar file kunci (`apps/api/src`)

| Peran | File |
|-------|------|
| Inbound WA | `routes/webhooks.ts` |
| Inbound Web + action | `routes/pwa.ts`, `routes/actions.ts` |
| Pipeline orchestrator | `services/message-processor.service.ts` |
| Engine entry | `business/conversation.service.ts` |
| LLM interpreter (v1) | `services/chat/interpreter.ts` (`runOneCall`) |
| LLM reasoner (v2) | `services/chat/reasoning.ts` (`understand`) |
| Fallback tiers | `business/fallback.service.ts` |
| **Cart authority (SINGLE)** | `business/cart-authority.ts` |
| **Structured action registry** | `business/action-registry.ts` (TER-TRACK, committed) |
| Product resolver | `business/product.service.ts` + `action-registry.ts:272` |
| Session/identity resolver | `routes/pwa.ts` (`getOrCreateWebSession`) |
| DB schema | `prisma/schema.prisma` (committed, **ADA ActionIdempotency**) |
| Migrasi ActionIdempotency | `prisma/migrations/20260816000000_*` + `...00100_*` (rantai prerequisite) |
| Order state machine | `business/order-transition.ts`, `business/order.service.ts` |
| Order payment verification | `routes/orders.ts` — `POST /:id/payment-verify` (G2-F2) + `GET /:id/valid-next-states` (read-only, reuse `getAllowedTransitions`, G2-F4) |
| CI | `.github/workflows/test.yml` (test:chat + test:golden + test:structured) |

## APPENDIX B — Kontrak terkunci (jangan dilanggar tanpa persetujuan owner)
1. `RAILS.md` §1 (bukti mentah wajib, scope terkunci, mulai sesi dengan git status).
2. `PROJECT-CONTRACT-STRUCTURED-ACTIONS.md` §6A.1 (executeOps + tx), §6A.4 (FOR UPDATE), §6A.11 (prohibitions), §11 (Do Not Do).
3. `CartAuthority` TIDAK boleh dimodifikasi untuk P0 (§6A.1).
4. `npm run build` wajib sebelum klaim "selesai".
5. ActionIdempotency: `FOR UPDATE` + re-check di SAME tx untuk semua mutation (ADD/REMOVE/UPDATE/CANCEL).

---

*Laporan dibuat read-only (tidak ada kode diubah). Semua klaim diverifikasi ke source/test/git
log working tree `/home/ubuntu/garuda` per 2026-08-20 (HEAD `e293040`). Klaim yang tidak bisa
diverifikasi mandiri ditandai [DUGAAN] atau "belum diverifikasi". INSIDEN unreported-work gap
ada di §10.*
