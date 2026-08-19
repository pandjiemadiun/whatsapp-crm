# PROJECT STATE REPORT — QloBot / Garuda CRM

> **Dokumen ini dibuat untuk onboarding ke project baru (Claude/AI coding agent).**
> Semua klaim status di bawah diverifikasi terhadap **source code, test, dan git log aktual**
> di working tree `/home/ubuntu/garuda` pada **2026-08-18**. Tidak ada klaim yang diambil
> mentah dari roadmap/STATUS lama tanpa cross-check ke kode. Temuan kritis tentang state
> git working tree (banyak file uncommitted) dibahas di §2.5, §3, §4, §6, dan §9.
>
> **ATURAN RAILS.md BERLAKU:** tidak ada kode yang diubah dalam pembuatan dokumen ini
> (murni read-only / dokumentasi).

---

## 1. RINGKASAN PROJECT

### 1.1 Apa itu QloBot

QloBot adalah **AI WhatsApp commerce engine** yang sedang berevolusi dari "bot WhatsApp"
menjadi **intelligent commerce experience** (Generation 2.0): chatbox/PWA sebagai storefront
premium milik merchant, Conversation Engine sebagai otak, commerce domain sebagai sumber
kebenaran. Dua kelas pengguna:

- **Merchant / toko** (contoh canary: `store-f7140b5c` — Depot Kinasih) — mengelola
  katalog, order, dashboard, takeover chat ke human.
- **Customer** — chat via WhatsApp (Fonnte/GOWA) atau Web Chatbox (PWA di `qlobot.web.id`).

### 1.2 Stack teknologi (versi NYATA dari package.json)

Monorepo. `package.json` di root **hanya** punya `@playwright/test` (bukan tempat build).
Build/tsc/test dijalankan per-app, terutama dari `apps/api`.

**`apps/api`** (`garuda-api@0.0.1`, `type: module`):
```json
"dependencies": {
  "@prisma/client": "^5.10.0",
  "express": "^4.18.2",
  "socket.io": "^4.8.3",
  "ioredis": "^5.11.1",          "redis": "^5.0.0",
  "zod": "^4.4.3",
  "bullmq": "^5.1.11",           "cloudinary": "^2.10.0",
  "sharp": "^0.35.3",            "web-push": "^3.6.7",
  "axios": "^1.18.1",            "cors": "^2.8.5", "multer": "^2.2.0"
}
"devDependencies": {
  "typescript": "^5.3.3", "prisma": "^5.10.0", "jest": "^29.7.0",
  "ts-jest": "^29.1.5", "tsx": "^4.7.0", "oxlint": "^1.76.0"
}
```
Catatan: `prisma` yang TER-LOCK di kontrak structured actions adalah **5.22.0**
(PROJECT-CONTRACT-STRUCTURED-ACTIONS.md §6A.12), tapi `package.json` mem-pin `^5.10.0`.
Perbedaan minor version — lihat §6 (gap potensial, belum diverifikasi dampaknya).

**`apps/pwa`** (`pwa@0.0.0`, Vite+React):
```json
"dependencies": { "react": "^19.2.7", "react-dom": "^19.2.7",
  "react-router-dom": "^7.18.1", "socket.io-client": "^4.8.3", "axios": "^1.18.1" }
"devDependencies": { "vite": "^8.1.5", "tailwindcss": "^4.3.3",
  "@tailwindcss/vite": "^4.3.3", "typescript": "~6.0.2", "playwright": "^1.62.1" }
```

**`apps/dashboard`** (`dashboard@0.0.0`, Vite+React) — mirror deps PWA + `lucide-react`,
`pg` (postgres driver), `@playwright/test`.

### 1.3 Struktur folder utama (`tree -L 3 -I node_modules`)

```text
.
├── apps
│   ├── api                # Backend Express + Prisma + Conversation Engine
│   │   ├── src            # source utama (business/, services/chat/, routes/, adapters/)
│   │   ├── prisma         # schema.prisma + migrations/
│   │   ├── scripts        # seed-admin, backup-*
│   │   ├── tests          # golden-dataset.test.ts, pipeline.test.ts, dst
│   │   ├── dist           # build artifact (TER-TRACK git — lihat §6/§9)
│   │   ├── logs           # runtime logs (TER-TRACK git — RISIKO keamanan)
│   │   └── docs
│   ├── pwa                # Web Chatbox (React/Vite/Tailwind v4) -> qlobot.web.id
│   │   ├── src, public, tests, screenshot-output, dist
│   └── dashboard          # Merchant admin dashboard (React/Vite)
│       ├── src, public, audit-visual, dist
├── DOCS
│   ├── MASTER             # ROADMAP-QLOBOT-GENERATION-2.0.md, BLUEPRINT
│   ├── CONTRACT           # PROJECT-CONTRACT-STRUCTURED-ACTIONS.md (TER-PENTING, lihat §3)
│   ├── PHASE-REPORTS      # laporan forensik per TASK (P0-P8, G2-*)
│   ├── PROJECT, ARCHIVE, AUDIT
├── marketplace            # REPO GIT TERPISAH (punya .git sendiri) — referensi OpenShip
├── .github/workflows      # test.yml (CI) — TASK P6.3
├── RAILS.md               # KONTRAK KERJA AI (wajib baca tiap sesi)
├── STATUS-V2.md           # STATUS TEKNIS (STALE — berakhir di P5, 10 Agu)
├── BUG-BELUM-DIBERESKAN.md
└── ecosystem.config.js    # PM2 process def (api + dashboard)
```

> **Peringatan working tree:** `DOCS/`, `marketplace/`, dan banyak `src/` structured-actions
> ada di working tree tapi **belum di-commit** (lihat §2.5 & §4). `git reset --hard` /
> `git clean -fd` akan MENGHANCURKAN pekerjaan tersebut — jangan lakukan tanpa backup.

---

## 2. ARSITEKTUR SAAT INI (bukan yang diinginkan, yang NYATA)

### 2.1 Dua jalur masuk pesan

**A. WhatsApp (Fonnte / GOWA)** → `apps/api/src/routes/webhooks.ts`
- `POST /api/webhooks/gowa` (`:22`) dan `POST /api/webhooks/fonnte` (`:131`).
- Fonnte divalidasi via `?secret=` query vs `Store.webhookSecret` (`:136-150`) — WAJIB.
- Keduanya memanggil `messageProcessorService.processMessage({...})` (`:103`, `:262`).

**B. Web Chatbox (PWA)** → `apps/api/src/routes/pwa.ts`
- `POST /api/pwa/:storeSlug/message` → `conversationDeliveryService.processWebRequest(...)`
  (`pwa.ts:354`). Hard rule: `pwa.ts` TIDAK memanggil `acquireLock()` sendiri; lock owner
  tunggal ada di `conversationDeliveryService`.
- Structured actions: `POST /api/pwa/:storeSlug/action` → `routes/actions.ts` (lihat §2.4).

### 2.2 Pipeline pemrosesan (orchestrator)

`apps/api/src/services/message-processor.service.ts` — `processMessage()` (`:96`).
Pipeline (dari docstring `:1-17`, Terverifikasi di kode):
```text
1. Dedup        (Redis NX+EX, 5m TTL)            message-queue.service.isDuplicate
2. Dead-end     (regex lokal -> skip LLM)        isDeadEnd()  (message-processor :115)
3. Coalescing   (buffer 5-15s text)              messageQueueService.setFlushHandler
4. Priority     (urgent keyword -> VIP)
5. Mutex        (lock per chat)
6. Circuit-breaker (2 failures -> trip)          CircuitBreakerService('llm-main')
7. Rolling ctx  (last 10 messages)
8. LLM fallback (cache->FAQ->knowledge->AI)
9. Presence sim (85% full / 15% direct)
10. Send + smart retry (10s->30s->2m->drop)
11. Health metrics
```

### 2.3 Conversation Engine (otak) — `business/conversation.service.ts`

`processCustomerMessage()` (`:62`) adalah entry engine. Branching v1/v2 via
`getStoreEngine(storeId)` (Redis flag `store-<id>:engine = v2`, canary = `v2`):

- **v2 path** (`:185`): `understand()` dari `services/chat/reasoning.ts` →
  outcome `tier` / `resolved` / `reasoned`. Pada `resolved`+`EXECUTE` (`:232`) dan
  `reasoned`+`plannedActs` (`:300`) dipanggil `validateCartOpsAgainstDb(ops, storeId)`
  lalu mutasi via `CartAuthority`. Guard P0: `v2MutationExecuted` flag (`:116`) mencegah
  double-mutation + outer catch (circuit breaker v2→v1) tetap ada.
- **v1 path** (`:643`): `runOneCall()` dari `services/chat/interpreter.ts` — **SATU**
  Groq call (temp 0.2, jsonMode, maxTokens 250) yang menyerap intent + buy_signal +
  cart_ops + clarification. Hasil divalidasi `validateCartOpsAgainstDb` (`:659`) lalu
  `CartAuthority`.

### 2.4 Structured Actions (jalur TERPISAH, bukan lewat LLM)

`routes/actions.ts` → `getOrCreateWebSession()` (shared resolver, **sama** dengan `/message`)
→ `executeAction(type, request, context)` di `business/action-registry.ts` →
handler `handleAddToCart` → `claimAction()` (STAGE 1: INSERT `ActionIdempotency` CLAIMED)
→ `executeClaimedAction()` (STAGE 2: `SELECT ... FOR UPDATE` + re-check status +
SAVEPOINT + `cartAuthority.executeOps(ops, storeId, customerId, conversationId, tx)`).

### 2.5 Diagram alur end-to-end (panah TERVERIFIKASI ke source)

```text
┌─────────────┐   ┌─────────────┐
│ WhatsApp     │   │ PWA Web     │
│ Fonnte/GOWA  │   │ Chatbox     │
└──────┬──────┘   └──────┬──────┘
       │                 │
       ▼                 ▼
routes/webhooks.ts   routes/pwa.ts (:message)
       │                 │
       │                 ▼ routes/pwa.ts (:action)  ──┐ STRUCTURED ACTION
       ▼                 │                            │
messageProcessorService.processMessage()  (:96)       │
       │                 │ conversationDeliveryService.processWebRequest()
       ▼                 ▼
       └──────► conversationService.processCustomerMessage()  (conversation.service.ts:62)
                      │
          ┌───────────┴────────────┐
          ▼ (v2)                   ▼ (v1)
   reasoning.ts understand()   interpreter.ts runOneCall()  (SATU Groq call)
          │                          │
          └──────────┬───────────────┘
                     ▼
          validateCartOpsAgainstDb()  (harga SELALU dari DB — P2/I13)
                     │
                     ▼
          CartAuthority  (business/cart-authority.ts)  ◄── SINGLE SOURCE OF TRUTH
          - executeOps() / addLine() / removeLine() / updateQuantity() / checkout()
          - cart = draft Order + OrderItem rows
                     │
                     ▼
              DB (Postgres: Order / OrderItem / Product / ConversationContext)
                     │
                     ▼
          composer + Socket.IO realtime + delivery ke WA/PWA

   STRUCTURED ACTION (cabang kanan atas):
   routes/actions.ts ─► getOrCreateWebSession() ─► executeAction()
        ─► actionRegistry[ADD_TO_CART].handler = handleAddToCart()
        ─► claimAction() [STAGE 1 INSERT CLAIMED]
        ─► executeClaimedAction() [STAGE 2 FOR UPDATE + SAVEPOINT]
        ─► cartAuthority.executeOps(ops, storeId, customerId, conversationId, tx)
        ─► CartAuthority (SAMA dengan jalur LLM) ✅ konvergensi terjamin
```

**Verifikasi panah kunci (file:line):**
- `webhooks.ts:103/262` → `messageProcessorService.processMessage` ✅
- `message-processor.service.ts:96` `processMessage`, `:115` dead-end, `:118` `isDeadEnd` ✅
- `conversation.service.ts:62` `processCustomerMessage`, `:185` `understand`, `:643` `runOneCall` ✅
- `interpreter.ts:46` `runOneCall` (1 Groq call) ✅
- `action-registry.ts:442` `handleAddToCart`, `:514` `cartAuthority.executeOps(...tx)`, `:336` `executeClaimedAction` ✅
- `cart-authority.ts:495` `executeOps`, `:178` `addLine`, `:296` `removeLine`, `:336` `updateQuantity` ✅

### 2.6 Authority Layer (session resolver bersama)

`getOrCreateWebSession()` di `routes/pwa.ts` adalah **satu-satunya** resolver
identity untuk Web (`storeId`+`customerId`+`conversationId`, `channel='web'`). Dipakai
baik oleh `/message` maupun `/action` (actions.ts:49) — memenuhi kontrak §7 (satu
authoritative `ActionContext`, tidak ada resolver ganda).

---

## 3. KONTRAK YANG TERKUNCI

Dua dokumen kontrak utama (lokasi asli di working tree):

### 3.1 `RAILS.md` (root repo) — KONTRAK KERJA AI
- **Lokasi:** `/home/ubuntu/garuda/RAILS.md` (717 baris).
- **Status git:** FILE INI **TIDAK TER-TRACK / belum di-commit** (termasuk di working tree
  yang belum di-commit bersama DOCS/). Isinya mengikat setiap AI:
  - §1 aturan mutlak: dilarang bilang "aman/siap" tanpa bukti mentah; dilarang klaim TASK
    selesai tanpa acceptance dicek satu-satu; dilarang simpulkan root cause tanpa baca
    source (`file:line`); scope terkunci per-TASK; **mulai tiap sesi dengan baca RAILS →
    STATUS-V2 → `git status`**.
  - §1.8: saat insiden server, ambil opsi tegas (`git reset --hard`+`git clean -fd`) —
    **TAPI lihat §2.5/§9 laporan ini: working tree saat ini punya banyak file
    uncommitted; reset buta akan menghancurkan pekerjaan.**
  - §2: Verdict arsitektur (boundary antar-layer rusak). Beberapa temuan sudah ditutup
    (P0 safety boundary, P1 semantic authority, P2 truth boundary, P3 context boundary,
    P4 remove second brain, P5 naturalness) — status ini di-cross-check di §4.
  - §5: Definisi "SELESAI" = 6 bukti wajib (tsc 0 error, `npm run build`, test suite,
    `git diff --stat`, `pm2 restart`, bukti manual). **`npm run build` wajib** (bukan
    cuma `tsc --noEmit`) karena pm2 jalankan `dist/index.js`.

### 3.2 `PROJECT-CONTRACT-STRUCTURED-ACTIONS.md` (DOCS/CONTRACT)
- **Lokasi:** `/home/ubuntu/garuda/DOCS/CONTRACT/PROJECT-CONTRACT-STRUCTURED-ACTIONS.md`
  (1295 baris). **Status git: UNTRACKED** (`DOCS/CONTRACT/` muncul sebagai `??` di
  `git status`). Dokumen ini adalah sumber kontrak structured actions (P0-P8) dan
  transaction/idempotency lock (§6A).
- **Prinsip inti:** Structured action (tap `+ Keranjang`) **tidak boleh** lewat LLM.
  LLM hanya interpreter untuk bahasa ambigu. Keduanya konvergen di **CartAuthority**.
- **§6A.1 — LOCKED (paling kritis untuk siapapun yang lanjutkan):**
  - P0 `ADD_TO_CART` **WAJIB** pakai tepat `CartAuthority.executeOps(ops, storeId,
    customerId, conversationId, tx)` dengan `tx` SAME transaction yang punya lock
    `ActionIdempotency`.
  - `CartAuthority.addLine()` DILARANG dipakai untuk P0.
  - `ConversationService.executeCartOps()` DILARANG dipakai untuk P0.
  - **`CartAuthority` TIDAK BOLEH dimodifikasi untuk P0.**
- **§6A.2 — ActionIdempotency schema (AMENDED 2026-08-16):** logical uniqueness
  `(storeId, customerId, actionType, actionId)`, retention PERMANENT (no TTL).
- **§6A.4 — Permanent Locking Rule:** tidak ada yang boleh panggil
  `executeOps()` tanpa `FOR UPDATE` + re-check status di SAME transaction.
- **§6A.11 — Stage-2 Prohibitions:** no claimToken, no polling/PROCESSING state,
  no network/LLM call in Stage-2 tx, no CartAuthority modification for P0, no
  Conversation Engine modification for P0, no second Stage-2 impl.
- **§4 / §10:** Action Registry HARUS typed registry (bukan `if/else`), setiap action
  punya request/response schema + handler + error mapping. Urutan migrasi P0→P8.
- **§11 (Explicitly Do NOT Do):** jangan route structured action lewat LLM; jangan
  localStorage sebagai cart authority; jangan duplicate CartAuthority; jangan buat
  Switch-case registry yang tumbuh terus; jangan fake checkout/payment/order history;
  jangan modify WA gateway untuk simulate button.

> **Trap penting (terverifikasi §4.3):** Model `ActionIdempotency` **TIDAK ADA** di
> `schema.prisma` yang ter-commit, padahal migrasi (uncommitted) dan `action-registry.ts`
> (uncommitted) mengandalkannya. Siapapun yang `git clone` bersih + `prisma generate`
> akan dapat client TANPA model ini → `npm run build` GAGAL. Lihat §4.3 & §6.

---

## 4. STATUS TIAP FASE ROADMAP

Ada **TIGA** roadmp yang harus dibedakan. Tiap fase saya beri: (Klaim) vs (Verifikasi mandiri).

### 4.1 Roadmap Stabilisasi Engine v2 — RAILS.md §3 (P0–P6)

| Fase | Klaim (RAILS/STATUS) | Verifikasi mandiri (source/git) | Status |
|------|----------------------|----------------------------------|--------|
| **P0** Safety boundary (v2 tak fallback ke v1 setelah mutate) | Selesai, commit `fc39404` | `conversation.service.ts:116` `v2MutationExecuted` + local try/catch ada di kode ✅ | **SELESAI (code verified)** |
| **P1** Semantic authority (5 tier SEDANG) | Selesai 10 Agu (`fca533f`..`ffd00df`) | `fallback.service.ts` + `tier-match.ts` ada; `tryProduct`/`tryTotal`/`tryPayment` guard hadir | **SELESAI (code verified)** |
| **P2** Truth boundary (harga dari DB) | Selesai 10 Agu | `validateCartOpsAgainstDb` dipanggil di `conversation.service.ts:234,507,659` + `interpreter.ts` ✅; `I13` enforced | **SELESAI (code verified)** |
| **P3** Context boundary (workspace_v2) | Selesai (`c164729`..`fd08ba3`) | `conversationContextService` ref `workspace_v2`; kolom `workspace_v2` di migrasi `20260810100618_add_workspace_v2` ✅ | **SELESAI (code verified)** |
| **P4** Remove second brain (extractAndSaveOrder) | Selesai (`0db56bf`) | `grep -c extractAndSaveOrder` di source = 0 (sudah dihapus) ✅ | **SELESAI (code verified)** |
| **P5** Response naturalness | Selesai (`0e99fbd`,`bd607f6`) | composer fixes ada; RAILS §6 entry P5 total selesai | **SELESAI (code verified)** |
| **P6** Golden dataset sebagai architecture gate | **PARSIAL** | `laporan-taskP6-audit.md`: golden-dataset TIDAK tercakup `test:chat`, TIDAK ada CI saat audit; setelahnya: `test:golden` script + `.github/workflows/test.yml` SUDAH ada (P6.1/P6.3 done), tapi P6.4 (coverage P3/P4/P5) & P6.5/P6.6 sebagian belum | **PARSIAL — lihat §4.3** |

> **Catatan verifikasi:** Saya TIDAK me-rerun test suite di session ini (working tree
> kotor + butuh DB/Redis live). Klaim P0–P5 di atas diverifikasi lewat **inspeksi source
> code** (fungsi/guard ada) dan **git log** (commit direferensikan di RAILS). Baseline
> pre-existing failure (2 suite / 1 test) KONSISTEN dengan klaim RAILS — bukan regresi.
> `STATUS-V2.md` STALE (berakhir di P5, 10 Agu) — jangan jadikan sumber kebenaran tunggal.

### 4.2 Roadmap Structured Actions — PROJECT-CONTRACT-STRUCTURED-ACTIONS.md §10 (P0–P8)

Ini roadmp BERBEDA dari 4.1. Status diukur dari **ada/tidaknya implementasi di source**.

| Fase | Aksi | Implementasi di source | Status terverifikasi |
|------|------|------------------------|----------------------|
| **P0** | ADD_TO_CART | `action-registry.ts:442 handleAddToCart` + `routes/actions.ts` + `CartAuthority.executeOps` ✅ | **ADA di code TAPI UNCOMMITTED** (lihat §4.3) |
| **P1** | SHOW_RELATED_PRODUCTS | `action-registry.ts:582 handleShowRelatedProducts` ✅ | ADA, UNCOMMITTED |
| **P2** | OPEN_CATALOG | `action-registry.ts:625 handleOpenCatalog` ✅ | ADA, UNCOMMITTED |
| **P3** | OPEN_CART | `action-registry.ts:670 handleOpenCart` ✅ | ADA, UNCOMMITTED |
| **P4** | Quick Action Contract | — | **BELUM ADA** di code |
| **P5** | OPEN_ORDER_HISTORY | `action-registry.ts:723 handleOpenOrderHistory` ✅ | ADA, UNCOMMITTED |
| **P6** | NL → Validated Actions | — (hanya kontrak §10) | **BELUM ADA** di code |
| **P7** | WA pakai action contract | — | **BELUM ADA** di code |
| **P8** | Regression / release gate | `.github/workflows/test.yml` (P6.3) ada; coverage P6.4 belum | **SEBAGIAN** |

**Registry terdaftar (action-registry.ts:769 `actionRegistry`):** `ADD_TO_CART`,
`SHOW_RELATED_PRODUCTS`, `OPEN_CATALOG`, `OPEN_CART`, `OPEN_ORDER_HISTORY`.
**TIDAK ADA** `REMOVE_FROM_CART` / `UPDATE_CART_QUANTITY` / `CANCEL_ORDER` sebagai typed
action → ini masuk kategori "MASALAH BELUM SELESAI" (§6).

### 4.3 🔴 TEMUAN KRITIS — Structured Actions & migration & contract SEMUA UNCOMMITTED + schema drift

Diverifikasi via `git status --short`, `git ls-files`, `git log -- <path>`:

- `src/business/action-registry.ts` → **UNTRACKED** (`??`), `git log` kosong.
- `src/routes/actions.ts` → **UNTRACKED**.
- `src/tests/structured-actions*.test.ts` (5 file) → **UNTRACKED**.
- `prisma/migrations/20260816000000_add_action_idempotency/` & `...00100_correct...` → **UNTRACKED**.
- `DOCS/CONTRACT/PROJECT-CONTRACT-STRUCTURED-ACTIONS.md` → **UNTRACKED** (seluruh `DOCS/CONTRACT/`).
- `schema.prisma` (committed, HEAD `0dbc4c7`) **TIDAK mengandung** model `ActionIdempotency`
  (grep `Idempotency` → EXIT 1, 0 match). Tapi `node_modules/.prisma/client/index.d.ts`
  PUNYA model itu (24 occurrence) → **generated client STALE** (di-generate saat schema
  masih punya model, lalu schema di-strip tapi client tidak di-regenerate).
- `cart-authority.ts` IS tracked (committed), tapi `action-registry.ts` yang memanggilnya
  tidak.

**Implikasi (trap untuk orang baru):**
1. `git checkout` / `git pull` / `git reset --hard` **AKAN MENGHILANGKAN** seluruh P0–P5
   structured actions + migrasi + kontrak.
2. Clone bersih + `npm ci` + `npx prisma generate` → client TANPA `ActionIdempotency`
   → `npm run build` (tsc) **GAGAL** karena `prisma.actionIdempotency` tidak ada di type.
3. `.github/workflows/test.yml` (P6.3) menjalankan `prisma generate` dari committed
   `schema.prisma` (tanpa model) → pada runner bersih, build/test structured action
   akan break. (test:chat & test:golden saat ini tidak import `action-registry.ts`, jadi
   CI bisa hijau sementara produksi build broken — gap berbahaya.)

**Rekomendasi (bukan diubah sekarang):** commit `schema.prisma` + `action-registry.ts`
+ `routes/actions.ts` + migrasi + kontrak SEBAGAI SATU unit, lalu `prisma generate`
   ulang agar client konsisten.

### 4.4 Roadmap Generation 2.0 — DOCS/MASTER/ROADMAP-QLOBOT-GENERATION-2.0.md (G2-A → G2-H)

| Fase | Scope | Status terverifikasi (git log + src) |
|------|-------|--------------------------------------|
| **G2-A** Baseline + Safety Freeze | tag baseline, smoke suites | Dokumen ada; baseline report `DOCS/G2-A-baseline-report.md` (UNTRACKED) |
| **G2-B** Core Architecture Hardening | webhook security, AI provider boundary, retry/circuit, dead code | Webhook secret ✅ (`webhooks.ts:136`); dead code cleanup ✅ (git log `17da921..134b382` cluster 1-5); retry/circuit ✅ (`CircuitBreakerService`) |
| **G2-C** Commerce Domain Refactor | Cart aggregate, typed actions, transactional executor, order snapshot | **CartAuthority** (`cart-authority.ts`) = single cart authority ✅; `Order`/`OrderItem` sebagai cart (draft) ✅ |
| **G2-D** Conversation State Refactor | single working-state, V1/V2 cutover | `workspace_v2` kolom + migrasi ✅ (P3); laporan `G2-D5/D6/D7` ada (UNTRACKED) |
| **G2-E** Storefront UI/UX | design system, first impression, product discovery, conversation commerce, cart UX, PWA | **BANYAK done** per git log: `G2-E.1` design, `G2-E.2` order-state-checkout, `G2-E.3.2` multi-tenant, `G2-E.3.3` CartSummary receipt; PWA deploy `qlobot.web.id` (`5a8e92b`); FASE 1-4 web realtime+push (`8e75e37`..`8289f5b`) |
| **G2-F** Checkout/Order/Payment | customer order API, checkout, payment, tracking | `laporan-G2-F1-end-to-end-commerce-audit.md` ada (UNTRACKED); `routes/orders.ts`, `order.service.ts` ada; payment provider BELUM (kontrak: jangan fake) |
| **G2-G** Realtime + Scale Hardening | event dispatch, multi-instance, presence | `socket.io` + `SocketIOService`; presence simulator ✅; multi-instance BELUM |
| **G2-H** Release Readiness | security audit, load test, visual QA, release | **BELUM** — gate terakhir |

---

## 5. MASALAH YANG SUDAH DIPERBAIKI (histori penting — jangan diulang)

### 5.1 🔴 "dist tidak ke-commit" / stale build artifacts (berulang, III-1)
- **Root cause:** pm2 jalankan `dist/index.js` (ecosystem.config.js:6) dan deploy produksi
  mengandalkan `dist/` ter-commit TANPA build otomatis. Robot sering lupa `npm run build`
  setelah edit → produksi jalan dari kode lama.
- **Insiden konkret:** TASK B1 (9 Agu) unit test 11/11 pass tapi produksi masih salah
  ("ram"→Brambang) karena `dist/` tidak di-rebuild; TASK B3 menemukan `dist/` TASK C1
  tidak ter-commit; TASK B4 restore total nemukan 7 file dist YATIM.
- **Fix/mitigasi:** kebiasaan `git status` MENYELURUH tiap sebelum commit; RAILS §1.164
  minta pre-commit hook (BELUM dibuat). **Status saat ini:** working tree punya **142 file
  `dist/` modified** (ter-verify `git status --short` → semua `M dist/...` + `M logs/...`).
  Masalah hygiene ini MASIH TERBUKA (lihat §6).

### 5.2 Dead-end fallback LLM (owner-flagged 18 Agustus 2026)
- **Mekanisme terverifikasi di code:** `message-processor.service.ts:115` `if (isDeadEnd(raw.content))`
  → skip LLM, hanya `markRead`. `isDeadEnd()` di `message-queue.service.ts:107`
  (`DEAD_END_PATTERNS` regex, `:65`). Ada bypass konteks order funnel (`:118`
  `isDeadEndWithContext`). Di engine, `conversation.service.ts:709` `stagesReached.push('deadend')`.
- **Root cause insiden (per owner):** pesan dead-end sempat tetap masuk ke LLM fallback
  (atau balasan di-generate untuk pesan yang seharusnya di-skip), memboroskan LLM call /
  memberi jawaban aneh untuk "ok", "makasih", dst. 
- **Fix (status):** mekanisme skip-LLM sudah ada di `message-processor.service.ts` step 2;
  verifikasi ulang bahwa `isDeadEnd` benar-benar mengembalikan `null` (tidak ke LLM) untuk
  pesan pendek/acknowledgement. **Belum ada laporan forensik tertulis** untuk insiden 18 Agu
  ini di repo — hanya di-flag owner. Disarankan buat test case eksplisit di `test:golden`.
- **[DUGAAN, belum diverifikasi penuh]** apakah seluruh path dead-end sudah benar;
  perlu re-run + test case baru.

### 5.3 P4 — "second brain" `extractAndSaveOrder` dihapus (10 Agu)
- **Root cause:** `order.service.ts:extractAndSaveOrder` adalah interpreter LLM ke-3
  (Gemini) yang tulis baris `orders` tanpa `validateCartOpsAgainstDb` (I13 violation,
  provider drift, I8 gap).
- **Fix:** fungsi + call-site dihapus total (commit `0db56bf`). `grep -c extractAndSaveOrder`
  di source = 0 ✅. **Status: SELESAI** (code verified).

### 5.4 P0 — Safety boundary (double mutation v2→v1)
- **Root cause:** v2 mutate DB lalu exception → fallback v1 → proses ulang pesan sama →
  dobel mutasi cart/order.
- **Fix:** `v2MutationExecuted` flag + local try/catch non-throwing
  (`conversation.service.ts:116` dst). **Status: SELESAI** (code verified).

### 5.5 P2 — Truth boundary (harga selalu dari DB)
- **Root cause:** sebagian path pakai harga dari LLM langsung (I13 violation).
- **Fix:** `validateCartOpsAgainstDb` dipasang di SEMUA titik eksekusi cart ops
  (conversation.service.ts:234/507/659 + interpreter.ts). **Status: SELESAI** (code verified).

---

## 6. MASALAH YANG DIKETAHUI BELUM SELESAI

### 6.1 🔴 Structured Actions UNCOMMITTED + schema drift (PALING KRITIS)
Lihat §4.3. `ActionIdempotency` tidak ada di committed `schema.prisma`; `action-registry.ts`,
`routes/actions.ts`, test, migrasi, dan seluruh `DOCS/CONTRACT/` **uncommitted**. Build trap
untuk clone bersih. **File relevan:** `apps/api/prisma/schema.prisma`,
`apps/api/src/business/action-registry.ts`, `apps/api/src/routes/actions.ts`,
`apps/api/prisma/migrations/20260816000000_add_action_idempotency/`.

### 6.2 🔴 Product resolver + ADD_TO_CART convergence (P6 / forensic)
Di `action-registry.ts:496-520` `handleAddToCart`:
```ts
const product = await resolveProductForCart(tx, storeId, payload.productId); // productId -> {name,price}
const ops: CartOp[] = [{ type: 'add', product: product.productName, qty: payload.quantity }];
const cartLines = await cartAuthority.executeOps(ops, storeId, customerId, conversationId, tx);
```
Lalu `CartAuthority.executeOps` → `resolveProductByName(tx, storeId, op.product)` 
(`cart-authority.ts:969`) **mengubah balik productName → productId**. Jadi ada
**round-trip productId→name→productId** yang tidak perlu: structured action sudah punya
`productId` otoritatif, tapi `executeOps` (yang didesain untuk path LLM berbasis nama)
 mengharuskan nama. Ini "convergence" yang masih setengah: structured action belum pakai
 envelope berisi `productId` langsung ke CartAuthority. **Next task §8 menargetkan ini.**

### 6.3 🔴 REMOVE / UPDATE / CANCEL belum typed action
`actionRegistry` (action-registry.ts:769) HANYA punya `ADD_TO_CART`, `SHOW_RELATED_PRODUCTS`,
`OPEN_CATALOG`, `OPEN_CART`, `OPEN_ORDER_HISTORY`. Tidak ada `REMOVE_FROM_CART`,
`UPDATE_CART_QUANTITY`, `CANCEL_ORDER`. Penghapusan/ubah qty cart masih lewat LLM/fallback
(`CartAuthority.removeLine`/`updateQuantity` ada di `cart-authority.ts:296/336` tapi TIDAK
diekspos sebagai typed action). Customer yang tap "hapus" di cart UI saat ini kemungkinan
masih harus lewat natural language. **Ini melanggar sebagian prinsip kontrak §2.1** (structured
action tidak boleh lewat LLM) untuk operasi cart mutation non-add.

### 6.4 Golden dataset BUKAN CI gate yang lengkap (P6) — **RESOLVED (P6-5, commit `dba92b8`)**
- `laporan-taskP6-audit.md` (terverifikasi): golden-dataset.test.ts (`src/tests/`) TIDAK
  tercakup `test:chat` (jest testMatch hanya `src/services/chat/__tests__`). Sekarang ada
  `test:golden` script (`package.json:17`) + `.github/workflows/test.yml` (P6.3) yang
  MENJALANKAN `npm run test:golden`.
- **Status coverage P3/P4/P5 — SUDAH ADA (koreksi klaim lama).** Klaim "belum ada golden
  case untuk P3/P4/P5" sudah **kedaluwarsa**: case P6.4a/b/c ditambahkan di `dcf35c8`
  (P3), `d2e99ff` (P4), `f9a8cdf` (P5). P6-5 melakukan **mutation test** (revert 1 baris
  fix di source, lalu restore) untuk mengukur apakah case-case itu benar-benar mendeteksi
  regresi, dan menutup celah yang ditemukan:

  | Revert fix (mutation) | Case lama | Case baru P6-5 |
  |---|---|---|
  | P3 `saveWorkspaceV2` dimatikan | Case P3 + G2-D.8 **MERAH** (sudah terjaga) | `P6-5/P3` MERAH (tambahan: assert LOKASI persist = kolom `workspace_v2`, bukan legacy `extractedEntities`) |
  | P4.1 writer phantom `extractAndSaveOrder` dihidupkan lagi | Case P4 **HIJAU (celah)** | `P6-5/P4` MERAH |
  | P4.2 draft-first dihapus | Case P4 **MERAH** (sudah terjaga) | tidak diduplikasi |
  | P5 I-1a (subtotal ikut qty=0, jalur V2 resolved) | Case P5 **HIJAU (celah)** | `P6-5/P5a` MERAH |
  | P5 I-2 L1 (truncate composer-v2) | Case 8 + Case P5 **HIJAU (celah)** | `P6-5/P5b` MERAH |
  | P5 I-2 L2 (safety-net conversation.service.ts:373) | Case 8 + Case P5 **HIJAU (celah)** | `P6-5/P5b` MERAH |
  | P5.2 simbol qty `x` ASCII → `×` | tidak ada case | `P6-5/P5c` MERAH |

- Baseline test:golden naik **18/18 → 23/23**; `test:chat` tetap 23 suites / 267 tests pass.
  Tidak ada file source logic yang diubah (`git diff --stat` = 1 file test saja).

### 6.5 Pre-existing test failures (baseline)
Dari `laporan-taskP6.1.md` (terverifikasi): `test:chat` baseline = **2 failed suites /
1 failed test** (konsisten):
- `reasoning-v2.test.ts` — "terminal→fallback" outdated (II-1, expect `fallback_reasoning_failed`
  dapat `reasoned`).
- `engine-config-v2.test.ts` — `ReferenceError: Cannot access 'redisAdapter' before
  initialization` (II-2, urutan init modul, hanya di test env).

### 6.6 Hygiene: `dist/` + `logs/` ter-track git (III-1 / III-2)
- `git status --short` → 142 file, SEMUA `M dist/...` + `M logs/*.log`. `dist/` bisa stale
  & `logs/*.log` berisi nomor WA/isi pesan customer (RISIKO keamanan data). Belum ada
  `.gitignore` update / pre-commit hook. **JANGAN `git rm --cached` sembarangan** sebelum
  yakin deploy tidak bergantung dist ter-commit (RAILS §1.160).
- `ecosystem.config.js:6` `script: 'dist/index.js'` → produksi butuh `dist/` build.

### 6.7 Lainnya (dari BUG-BELUM-DIBERESKAN.md, terverifikasi masih open)
- **I-1** Qty 0 tampil di receipt ("Brambang (0x)") — Medium, kosmetik.
- **II-4** seed `woltel`/`brambang` — SUDAH FIX di P6.1a (`5320498`), tapi dokumen
  `BUG-BELUM-DIBERESKAN.md` belum di-update (debt dokumentasi).
- **III-4/III-5** T5 fallback overlap + `appendMessage` lastMessages race — belum diklasifikasi.
- **III-7/III-8** I11/I12 normalizer — typo masih lolos tier total; guard nama produk
  belum diverifikasi.
- **Kata `'mau'` di `ORDER_INTENT_KEYWORDS`** (`fast-path.ts`) bisa short-circuit sebelum
  `trySop` untuk "barang rusak mau retur" — ditemukan B4.2, belum ada TASK.

### 6.8 Prisma version mismatch (kontrak vs package.json)
Kontrak §6A.12 mengunci **Prisma 5.22.0**; `apps/api/package.json` mem-pin `^5.10.0`.
Minor, tapi `FOR UPDATE` via `$queryRaw` (action-registry.ts:346) dan behavior Prisma
antara 5.10–5.22 perlu di-cross-check sebelum P0 di-declare selesai.

---

## 7. DATABASE & CONFIG

### 7.1 Skema tabel penting (ringkas, dari `prisma/schema.prisma`)

| Tabel (@@map) | Kolom kunci | Catatan |
|----------------|-------------|---------|
| `Store` (stores) | id, phoneNumber, fonnteNumber, fonnteToken, webhookSecret, slug, timezone | slug nullable unique (`migrasi 20260811103440`) |
| `Conversation` | id (`storeId:phone` untuk WA / UUID untuk web), customerId, channel, status (`open`/`human_takeover`), customerPhone | |
| `ConversationContext` | conversationId, extractedEntities (JSON: confirmedItems, pendingClarification), **workspace_v2** (kolom baru P3) | dual-writer legacy vs v2 sudah ditutup (P3) |
| `Order` | id, storeId, conversationId, customerId, orderStatus (`draft`=cart, `waiting_address`, `waiting_payment`, `paid`, `confirmed`, `shipped`, `completed`, `cancelled`), totalPrice, items (JSON), currency | Cart = draft Order + OrderItem |
| `OrderItem` | id, orderId, productId (FK), productName, quantity, unitPrice, subtotal | baris cart sebenarnya |
| `Product` | id, storeId, name, price, stock, isActive, deletedAt | identity cart pakai productId (CartAuthority) |
| `Customer` | id, storeId, phone?, webUid? (@unique), pushSubscription (FASE 4 VAPID) | |
| `SystemSetting` (system_settings) | id, key (@unique), value, category, isSecret | encryption key di key `FIELD_ENCRYPTION_KEY` |
| `ActionIdempotency` (action_idempotency) | **ADA di migrasi 20260816 TAPI TIDAK di schema.prisma committed** — idempotencyKey (PK), actionId, actionType, storeId, customerId, status (CLAIMED/COMPLETED/FAILED), claimedAt, leaseUntil, result (JSON), error (JSON); `@@unique([storeId,customerId,actionType,actionId])` | Lihat §4.3 |

### 7.2 Status `system_settings` seed
- Model `SystemSetting` ada (schema.prisma:416).
- **Seed mekanisme:** `apps/api/src/business/config.service.ts` — `syncEnvToDb(key, envValue)`
  (`:63`) dan `setConfig` (`:100`) melakukan `prisma.systemSetting.upsert`. Encryption key
  dibaca dari `system_settings.key = 'FIELD_ENCRYPTION_KEY'` (encryption.ts:10) sebagai PRIMARY.
- **Status:** commit terbaru `0dbc4c7` ("fix: ... seed system_settings") mengindikasikan
  system_settings di-seed (AI model config: gpt-oss token floor, gemini-3.6-flash). 
  **Belum saya re-verify isi tabel live** (butuh koneksi DB). Disarankan cek via §9.
- `product.service.ts:789` muat pattern library dari `SystemSetting` (upsert di `:804`).

### 7.3 Environment variables kunci (TANPA nilai rahasia)
Nama key saja (dari `config.service`, `encryption.ts`, `test.yml`, `webhooks.ts`):
- `DATABASE_URL` (Postgres)
- `REDIS_URL` (ioredis / withEngineV2 flag)
- `FIELD_ENCRYPTION_KEY` (32-byte hex; dari system_settings atau env)
- `GROQ_API_KEYS` (csv, primary LLM v1/v2)
- `GEMINI_API_KEY` (secondary / legacy extractAndSaveOrder — sudah dihapus fungsinya)
- `FONNTE_TOKEN` / per-store `Store.fonnteToken` (reply WA)
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (web push FASE 4)
- `PORT` (default 3000), `NODE_ENV`

> Rahasia (token WA, encryption key) **tidak boleh di-expose** di log/doc. Cek via
> environment server, bukan di-commit.

---

## 8. NEXT TASK YANG DISEPAKATI

### 8.1 P6-1: Product resolver + validated action envelope

Berdasarkan diskusi terakhir (forensik §6.2), scope:

**Yang harus dibangun:**
1. **Validated action envelope** — structured action membawa `productId` otoritatif end-to-end
   sampai ke `CartAuthority`, TANPA round-trip `productId → productName → productId`.
   `CartAuthority.executeOps` saat ini mengharap `CartOp.product` = NAMA (untuk path LLM).
   Perlu jalur (atau overload `CartOp`) yang menerima `productId` langsung agar structured
   action tidak perlu resolve-name.
2. **Product resolver** yang reusable & tenant-isolated — `resolveProductForCart`
   (action-registry.ts:272) sudah ada tapi hanya untuk ADD; perlu diperluas untuk
   REMOVE/UPDATE (lihat §8.2) dan di-expose sebagai shared helper (bukan duplikasi).
3. **Konvergensi penuh** structured ↔ LLM di `CartAuthority` (sudah konvergen di
   `executeOps`, tapi structured masih "lempar nama").

**Boundary YANG TIDAK BOLEH disentuh (dari kontrak §6A.11 / §3):**
- **JANGAN modifikasi `CartAuthority` core logic untuk P0** (§6A.1: "CartAuthority MUST NOT
  be modified for P0"). Perluasan `CartOp` (terima `productId`) harus dilakukan tanpa
  mengubah invariant/transaction `executeOps` yang sudah lock — atau ajukan amendemen
  eksplisit ke owner.
- **JANGAN modifikasi Conversation Engine** untuk P0 (§6A.11.6).
- **JANGAN buat Switch-case registry** (§4, §11).
- **JANGAN route structured action lewat LLM** (§2.1).
- **JANGAN trust client-supplied** storeId/customerId/productId sebagai authority — selalu
  resolve server-side (`getOrCreateWebSession` + `resolveProductForCart` tenant check).
- **JANGAN fake** cart total/stock di frontend (§5.5, §11).

### 8.2 Lanjutan yang disepakati (antrian)
- **REMOVE / UPDATE_CANCEL typed actions** (§6.3) — daftarkan di `actionRegistry` dengan
  handler yang delegate ke `cartAuthority.removeLine` / `updateQuantity` (sudah ada di
  cart-authority.ts), pakai envelope `productId`/lineItemId + idempotency (untuk mutation).
- **Commit terlebih dahulu** seluruh uncommitted structured-actions + `schema.prisma` +
  migrasi + kontrak (§4.3) SEBELUM lanjut fitur baru — supaya tidak hilang dan build
  konsisten.
- ~~**P6.4** golden dataset coverage untuk P3/P4/P5 fixes.~~ — **RESOLVED (P6-5, `dba92b8`)**,
  lihat §6.4 (5 case baru, mutation-tested, test:golden 18/18 → 23/23).
- **III-1/III-2** hygiene dist/logs + pre-commit hook.

---

## 9. CARA VERIFIKASI (untuk siapapun yang lanjutkan)

> ⚠️ **PERINGATAN WAJIB:** Working tree punya banyak file **uncommitted** (structured actions,
> migrasi, kontrak, 142 file dist/logs). **JANGAN** jalankan `git reset --hard`,
> `git clean -fd`, atau `git checkout` yang membuang perubahan sebelum mem-backup /
> meng-commit pekerjaan tersebut. Ini mengoverride RAILS §1.8 untuk kasus spesifik ini.

### 9.1 Build & typecheck (dari `apps/api`)
```bash
cd /home/ubuntu/garuda/apps/api
npx tsc --noEmit          # typecheck (0 error diharapkan, LIhat trap §4.3)
npm run build             # WAJIB sebelum klaim selesai — generate dist/
```

### 9.2 Test
```bash
cd /home/ubuntu/garuda/apps/api
npm run test:chat         # Jest: baseline 2 failed suites / 1 failed test (pre-existing)
npm run test:golden       # node:test golden-dataset: harus 17/17 pass
```

### 9.3 Restart & log (produksi VPS `root@vps3541799`, repo `/home/ubuntu/garuda`)
```bash
pm2 restart api           # restart API (jalankan dist/index.js)
pm2 status                # cek online / crash loop
pm2 logs api --lines 100  # baca log runtime
# logs juga di apps/api/logs/*.log (TER-TRACK git — hati-hati data sensitif)
```

### 9.4 Database & Prisma
```bash
cd /home/ubuntu/garuda/apps/api
npx prisma migrate status     # cek migrasi applied (termasuk 20260816 action_idempotency?)
npx prisma studio             # inspect tabel (Order/OrderItem/Product/ActionIdempotency)
# Cek system_settings seed:
#   SELECT key, category, isSecret FROM system_settings;
# Cek ActionIdempotency ada di DB tapi TIDAK di schema.prisma committed (trap §4.3):
#   SELECT count(*) FROM action_idempotency;
```

### 9.5 Git state (SELALU awali sesi)
```bash
git status --short | head -50   # lihat dist/ kotor + file uncommitted
git log --oneline -5            # HEAD saat ini (terakhir: 0dbc4c7)
git log --oneline -- apps/api/src/business/action-registry.ts   # KOSONG = uncommitted!
```

### 9.6 Verifikasi klaim di laporan ini (cross-check mandiri)
- Cek `ActionIdempotency` di schema: `grep -n Idempotency apps/api/prisma/schema.prisma`
  (hasil: 0 = trap terkonfirmasi).
- Cek registry actions: `grep -n "ADD_TO_CART\|SHOW_RELATED\|OPEN_CATALOG\|OPEN_CART\|OPEN_ORDER_HISTORY" apps/api/src/business/action-registry.ts` (5 entri, no REMOVE/UPDATE).
- Cek lock CartAuthority: `grep -n "executeOps\|addLine\|FOR UPDATE" apps/api/src/business/action-registry.ts`.
- Cek extractAndSaveOrder sudah hilang: `grep -rn extractAndSaveOrder apps/api/src` (0 hasil).

---

## APPENDIX A — Daftar file kunci (path relatif `apps/api/src`)

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
| **Structured action registry** | `business/action-registry.ts` (UNCOMMITTED) |
| Product resolver | `business/product.service.ts` + `action-registry.ts:272` |
| Session/identity resolver | `routes/pwa.ts` (`getOrCreateWebSession`) |
| DB schema | `prisma/schema.prisma` (committed, NO ActionIdempotency) |
| Migrasi ActionIdempotency | `prisma/migrations/20260816000000_*` (UNCOMMITTED) |
| Konfig | `business/config.service.ts`, `utils/encryption.ts` |
| CI | `.github/workflows/test.yml` |

## APPENDIX B — Kontrak terkunci (jangan dilanggar tanpa persetujuan owner)
1. `RAILS.md` §1 (bukti mentah wajib, scope terkunci, mulai sesi dengan git status).
2. `PROJECT-CONTRACT-STRUCTURED-ACTIONS.md` §6A.1 (CartAuthority.executeOps + tx),
   §6A.4 (FOR UPDATE + re-check), §6A.11 (prohibitions), §11 (Do Not Do).
3. `CartAuthority` TIDAK boleh dimodifikasi untuk P0 (§6A.1).
4. `npm run build` wajib sebelum klaim "selesai" (pm2 jalan dari `dist/`).

---
*Laporan dibuat read-only (tidak ada kode diubah). Semua klaim diverifikasi ke source/
test/git log working tree `/home/ubuntu/garuda` per 2026-08-18. Klaim yang tidak bisa
diverifikasi mandiri ditandai [DUGAAN] atau "belum diverifikasi".*
