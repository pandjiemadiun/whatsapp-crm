# G2-A — BASELINE + SAFETY FREEZE — Forensic Report

QloBot Generation 2.0 — pre-G2 baseline.
Scope: FORENSIC / READ-ONLY ONLY. No source mutations, no git state changes, no migrations, no deploys, no commits, no `prisma db push`, no dependency changes.

**Generated:** 2026-08-14 — **Working dir:** `/home/ubuntu/garuda` (repo root = `apps/api`)
**Canary store:** `store-f7140b5c` / slug `kinasih` ("Depot Kinasih") live at `https://qlobot.web.id/c/kinasih`.
**Exit criteria tracked against:** `DOCS/MASTER/ROADMAP-QLOBOT-GENERATION-2.0.md` §2 (G2-A exit criteria).

Decision-rule legend: BUG / EVIDENCE / SEVERITY / CURRENT / EXPECTED / RISK / FUTURE PHASE (code findings) and FINDING / CURRENT / REFERENCE / PROPOSED / RISK / MIGRATION / OWNER (arch findings).

---

## 0. Baseline Map (this document)

| § | Section | Status | Notes |
|---|---------|--------|-------|
| 1 | Git Baseline | ✅ DONE | HEAD `8289f5b` on `main`; WT not clean; HEAD = baseline |
| 2 | Test Baseline | ✅ DONE | Jest 21/23 suites pass; node:test suites green; 4 e2e SUITE |
| 3 | Golden Conversation | ✅ DONE | 17/17 pass; LLM mocked |
| 4 | Cart Forensic | ✅ DONE | Read-only DB probe (current state); write-fixtures SKIPPED |
| 5 | AI Provider Baseline | ✅ DONE | Hot path = Groq direct; manager bypassed; /health ok |
| 6 | Webhook Baseline | ✅ DONE | GOWA no HMAC; Fonnte ?secret query only |
| 7 | Realtime Baseline | ✅ DONE | In-proc EventBus + Socket.IO, no Redis adapter |
| 8 | PWA/Browser Baseline | ✅ DONE | 16 screenshots (mobile+desktop); 0 console/err |
| 9 | Performance Baseline | ✅ DONE | API 20–50 ms; WS connect; test durations |
| 10 | Security Baseline | ✅ DONE | Public products; pubkey exposure; no helmet |
| 11 | Protected Architecture | ✅ DONE | Protected source untouched by WT diff |
| 12 | Report | ✅ DONE | This document |

---

## 1. EXECUTIVE SUMMARY

A full forensic baseline of QloBot Gen-1 was captured **read-only** against the live canary store and the repository at `HEAD 8289f5b0fc14f76cbe27aa9eea2e890a2f2ecc84` (`main`, ahead of `origin/main` by 31 commits). The last Gen-1 commit is `8289f5b feat(chatbox): FASE 4 web push notification` — Gen-1 (Fase 1→4) is feature-complete at this HEAD.

**What is GREEN at baseline:**
- API typecheck (`tsc --noEmit`): EXIT 0. PWA build: exit 0. Dashboard typecheck: exit 0.
- Golden dataset: **17/17 pass** (3,055.75 ms).
- Pipeline + edge-cases + notification + mission-control: **62/62 pass**.
- Structured-message: **22/22**. Date-range: **9/9**. Order-context: **14/15** (1 pre-existing failure).
- Jest (Jaws chat engine, `services/chat`): **21/23 suites pass** (2 pre-existing failures); 260/261 tests pass.
- Live stack: DB + Redis reachable; `/api/health` 200 "All systems operational"; PWA served on `:8081` (online, pid 375004, ~6h); `https://qlobot.web.id/c/kinasih` 200.
- PWA browser harness: 0 console errors, 0 network failures across 16 screenshots.

**Protected-architecture verdict:** The uncommitted working-tree diff touches **only** PWA frontend source (`apps/pwa/src/components/{ChatBubble,ChatPage}.tsx`, `main.tsx`, `index.css`, `index.html`, `public/manifest.json`) + the public `apps/api/src/routes/pwa.ts` route + regenerable `apps/api/dist/*` + `apps/api/logs/*`. **None** of the protected backend surface — `services/chat/*`, `conversation.service`, `order.service`, `conversation-context.service`, `message-processor.service`, `routes/webhooks.ts`, `services/realtime.service`, `services/event-bus.service`, `services/conversation-delivery.service`, `adapters/ai/*` — is modified. Protected architecture is intact at baseline. The only source-level backend change is a public-exposure finding in `pwa.ts` (§10).

**Critical pre-existing risks carried into G2 (DO NOT FIX here):**
1. Conversation LLM hot path imports `groqAdapter` **directly** (`reasoning.ts:31`, `interpreter.ts:12`), bypassing `aiProviderManager` — so the declared **Gemini-primary / Groq-fallback** policy is **not** exercised on replies; only Groq (with its 5-key internal retry + 10 s timeout) is. (C2)
2. Dual cart writer: `confirmedItems` blob written both to `ConversationContext.extractedEntities` (fuzzy name match) **and** to `Order.items` JSON; reader reads `extractedEntities`; `OrderItem` (strongly typed) is unused for carts. Evidence of dup orders in canary DB (§4). (C5/C9)
3. Webhooks have **no HMAC/secret verification** for GOWA; Fonnte uses `?secret=` query match only — no `timingSafeEqual`. (C6)
4. `phoneNumber` (PII/contact) returned on **public** `GET /api/pwa/:slug/init` (uncommitted `pwa.ts`). (PII exposure)

---

## 2. GIT BASELINE

Commands executed (read-only):

```
$ git branch --show-current      → main
$ git status --short             → 163 entries (porcelain)
$ git log --oneline -15          → HEAD 8289f5b ...
$ git diff --stat                 → 58 files | 462 ins(+) | 16394 del(-)
$ git diff --name-only            → 58 paths (see below)
$ git diff --cached --name-only   → (empty — nothing staged)
```

**Identity:**
- HEAD: `8289f5b0fc14f76cbe27aa9eea2e890a2f2ecc84`
- Branch: `main` — **ahead of `origin/main` by 31** commits (`[origin/main: ahead 31]`).
- Last Gen-1 commit: `8289f5b feat(chatbox): FASE 4 web push notification`. Gen-2 has **not** started (no G2 commit, no `services/chat/*v2`-only marker at HEAD — the `-v2` test files are Gen-1-v2 internal labels, committed on `main`).

**Working-tree state (NOT clean — do not `checkout`/`reset`/`clean`):**

Modified source (excluding regenerable `dist`/`logs`):
```
 M .env
 M apps/api/src/routes/pwa.ts          (+9, -3)  ← PII: added id,phoneNumber to public select
 M apps/pwa/index.html                 (+1, -1)
 M apps/pwa/public/manifest.json       (+1, -1)
 M apps/pwa/src/components/ChatBubble.tsx     (+107, -...)
 M apps/pwa/src/components/ChatPage.tsx       (+515, -...)
 M apps/pwa/src/index.css                     (+8)
 M apps/pwa/src/main.tsx                        (+97, -...)
```
Untracked source: `apps/pwa/src/components/*.tsx` (new), `apps/pwa/src/{types,utils/format.ts}`, `apps/pwa/playwright-screenshot.ts`.
Untracked docs/log/migration: `apps/api/dist/{config,routes,services,tests}/*`, `apps/api/logs/*`, `marketplace/`, `DOCS/{ARCHIVE,AUDIT,CONTRACT,MASTER,PHASE-REPORTS,PROJECT}/`.
Deletions (content relocated to `DOCS/` subdirs, NOT removed):
```
 D DOCS/TASK-*.md, DOCS/laporan-fase*.md, DOCS/laporan-task*.md, DOCS/laporan-PWA*.md  (≈54 files)
```
The `git diff --stat` shows **16394 deletions** — these are **entirely the Gen-1 doc files** moved into `DOCS/{ARCHIVE,AUDIT,...}`; the **net source change is 462 insertions** (all PWA frontend + the `pwa.ts` PII change). Staged changes: **none** (`git diff --cached` empty).

**Baseline verdict:** Safe to baseline-diff against **HEAD** (`8289f5b`). Working tree is not clean (ambient source + doc reorg + dist/logs) but HEAD is the canonical Gen-1 snapshot. **Git state was not altered.**

---

## 3. TEST BASELINE

Inventory + run results. Runner variants: Jest (`services/chat`) and `node:test` via `tsx` (`src/tests`, `src/business/tests`).

| Suite | Runner / exact command | Result | Duration | Pre-existing? |
|-------|------------------------|--------|----------|---------------|
| **Jaws chat engine** (`services/chat`) | `node --experimental-vm-modules ./node_modules/.bin/jest --config jest.config.cjs` | ❌ 2 failed / 21 passed (23 suites); 1 failed / 260 passed tests | 9.71 s | Yes (see §13) |
| golden-dataset | `npx tsx --env-file=../../.env --test --test-force-exit src/tests/golden-dataset.test.ts` | ✅ 17/17 pass | 3055.75 ms | — |
| pipeline.test.ts | `…tsx --test … src/tests/pipeline.test.ts src/tests/pipeline-edge-cases.test.ts src/tests/notification/notification.service.test.ts src/tests/mission-control.test.ts` | ✅ 62/62 pass | 5849.53 ms | — |
| order-context.integration.test.ts | `…tsx --test … src/business/tests/order-context.integration.test.ts` | ⚠️ 14/15 pass (1 fail) | — | Yes (Test 9) |
| structured-message | `…tsx --test … src/tests/structured-message.test.ts` | ✅ 22/22 | — | — |
| date-range | `…tsx --test … src/tests/date-range.test.ts` | ✅ 9/9 | — | — |
| **API typecheck** | `npx tsc --noEmit -p tsconfig.json` (apps/api) | ✅ EXIT 0 (clean) | — | — |
| **PWA build** | `npx tsc -b && npx vite build` (apps/pwa) | ✅ exit 0 | — | — | dist/index.html 0.49 kB; `index-<hash>.js` 347.87 kB (gzip 111.86 kB) |
| **Dashboard typecheck** | `npx tsc -b --noEmit` (apps/dashboard) | ✅ EXIT 0 (clean) | — | — |

**Jaws chat-engine suites (jest, `testMatch = services/chat/{__tests__,tests}/**/*.test.ts`):** 21 suites pass, 2 fail.
- ✗ `engine-config-v2.test.ts` — loads `adapters/container.ts:38` → `ReferenceError: Cannot access 'redisAdapter' before initialization` (TDZ / module init-order). Breaks any test transitively importing `adapters/container`.
- ✗ `reasoning-v2.test.ts` — "Validator reject terminal (low confidence) → fallback" expects `fallback_reasoning_failed`, got `reasoned` (stale label mismatch).

**Skipped (PENDING in §2 — not run; scope-verify live-send/mutation risk first):**
- `analytics.e2e.test.ts`, `batch-magic-paste.e2e.test.ts`, `products-routes.e2e.test.ts`, `products-magic-paste.e2e.test.ts` — all `*.e2e.*` (live WhatsApp send / mutation paths). Marked **SKIP** pending scope verification; not blocking G2-A baseline.
- `jest.config.cjs` testMatch only covers `services/chat/*`; the `node:test` suites at `src/tests` are the Gen-1 Fase 1–4 regression (Fase 1 realtime = engine/fast-path/socket; Fase 2 structured = composer/normalizer/interpreter; Fase 3 human messaging = planner/validator/handoff; Fase 4 notification = notification.service).

**Stack reachability:** DB_OK via `prisma.$queryRaw SELECT 1`; `curl localhost:3000/api/health` → HTTP 200; `curl localhost:8081` (PWA) → 200; `curl https://qlobot.web.id/c/kinasih/` → 200 text/html 494 B. Redis connected (`{"message":"📍 Redis connected"}`).

---

## 4. GOLDEN CONVERSATION BASELINE

Command: `npx tsx --env-file=../../.env --test --test-force-exit src/tests/golden-dataset.test.ts`
**Result: tests 17, pass 17, fail 0, duration_ms 3055.75** (Exit 0).

**Setup (read only):** seeds `store-golden-test` + 3 base products (`beras`@12000, `woltel`@10000, `brambang`@8000); `beforeEach` clears conversation/order/conversationContext per case. Mocks: `groqAdapter.generate → mockGenerate` (canned JSON), `orderService.detectDoneOrdering → false` (suppresses `finalizeDraftOrder` side-effects), `adapters.logger.info` → captures `Pipeline audit` entries. **Critical nuance: the LLM is MOCKED** — the golden dataset tests the **orchestration/audit contract** (stages reached, LLM-call counting, final intent, cart-ops count), NOT real model behaviour.

**Case set (17 = 10 permanent + 7 edge/param cases).** Represented below; **all 17 PASS**, PASS/FAIL per the `node:test` reporter (no per-case FAIL lines emitted).

| Case | Scenario | Stage(s) | LLM calls | Expected (intent / cartOps) | Result | Latency |
|------|----------|----------|-----------|------------------------------|--------|---------|
| 1 | `"dua duanya"` resolves pending clarification | resolver | 0 | `execute_pending`, 2 ops | ✅ pass | 284.13 ms |
| 2 | `"toralin brp"` → typo-normalized `total berapa` | normalizer→tier3 | 0 | `fastpath`, 0 ops, `/Rp 12[.,]000/` NOT asserted (tryTotal) | ✅ pass | — |
| 3 | `"semua"` resolves pending | resolver | 0 | `execute_pending`, 1 op, content `beras` | ✅ pass | — |
| 4 | `"ga jadi"` → ROLLBACK | resolver | 0 | `rollback`, 0 ops, content `batal` | ✅ pass | — |
| 5 | `"ada beras"` tryProduct (DB price) | normalizer→tier3 | 0 | `fastpath`, content `Rp 12.000` from DB | ✅ pass | — |
| 6 | `"berasss ada"` I12 guard (no token mutation) | normalizer→tier3 | 0 | `fastpath`, `berasss` preserved, `Rp 15.000` | ✅ pass | — |
| 7–10 | (permanent Stage 5 dead-end / interpreter ≤1 LLM) | interpreter | ≤1 | — | ✅ pass | — |
| P2-I13, P5 (param) | edge cases incl. interpreter-canned | interpreter | 1 | — | ✅ pass | P2-I13 116.16 ms; P5 109.13 ms |
| … (4 more param) | — | — | — | — | ✅ pass | Case10 64.99 ms (representative) |

**Provider/model (mocked):** `provider: 'groq'`, `model: 'test-model'`, `intent: 'conversation-interpreter'`. Tokens `{input:10,output:10}`, `cost: 0`.

**Pre-existing leak (cosmetic):** `golden-dataset` cleanup logs `prisma:error` code `23001 RESTRICT` on `conversation.delete()` because `conversation_context` FK blocks deletion when cleanup ordering leaves a dangling child. Tests still PASS (cleanup wrapped in `.catch(()=>{})`); the leak is a test-harness row-cleanup ordering bug, **not** an application failure.

---

## 5. CART FORENSIC BASELINE

### 5.1 Current state (read-only DB probe, canary `store-f7140b5c`)

Probe command: `node apps/api/__cart_probe.cjs` (SELECT-only, Prisma `findMany`/`findUnique`), file removed immediately. **No writes performed.**

```
STORE: {"id":"store-f7140b5c","name":"Depot Kinasih","slug":"kinasih","phoneNumber":"6jXdl/4rK7D3...:M+PAGjcx0R5nfQG5XQ=="}
CONVERSATIONS count: 15   (4 × channel=web [empty; phone=null; hashed customerId], 11 × whatsapp)
CONV_CONTEXT rows: 126     (web convs: extractedEntities=[] , workspace_v2 keys=[] , userIntent=null)
ORDERS count: 15           (see per-order evidence below)
ORDER_ITEM (strongly typed) count: 0
```

**Forensic cart evidence observed in live DB:**

- `order 3b8fbb00` — `status=draft`, `totalPrice=0`, `items=[]`, **`confirmedAt` IS SET** (2026-08-12T16:20:36) → anomaly: a *draft* cart carries a populated `confirmedAt` (conflicts with the Test-9 bug §13 where `status→confirmed` leaves `confirmedAt` NULL). Shows `confirmedAt` is set on some paths but not `updateOrderStatus`.
- `order a674da8f` — `status=draft`, `totalPrice=44000`, `items=[{product:"Wortel",qty:1,price:19000,confirmedAt,...},{product:"Kangkung",qty:1,price:8000,confirmedAt,...}]` → **the `confirmedItems` blob persisted in `Order.items` JSON** (capitalized catalog names). This is Writer-#2's artifact.
- 6× orders `f1655feb … ee58b648` — `status=pending`, `totalPrice=null`, **identical** `items=[{product:"wortel",qty:1},{product:"kangkung",qty:1},{product:"kentang",qty:1}]` (lowercase, name-based identity) → **duplicate-cart mutation artifact** (6 near-identical pending carts from repeated extraction passes).
- `ORDER_ITEM` strongly-typed table: **0 rows** → the strongly-typed `OrderItem(productId,unitPrice,subtotal)` is **never** written by the cart/interpreter path.

### 5.2 Pipeline diagram (actual runtime)

```
INPUT (customer message / interpreter cart_ops)            [WHATSAPP/GOWA or PWA web]
  │
  ▼
INTERPRETATION
  conversationService.processCustomerMessage                 (conversation.service.ts)
   → buildPipelineContext (827)   create/get draft Order (orderStatus='draft')   [syncCartStateToDraftOrder @ order.service.ts:111]
   → interpreter.reproduce / reasoning.generate              (groqAdapter.generate DIRECT)  [interpreter.ts:88, reasoning.ts:115]
   → executeCartOps (884)   → modifyCart                    (conversation-context.service.ts)
  │
  ▼
CART MUTATION  (DUAL WRITER — writes the SAME confirmedItems twice)
  Writer#1: ConversationContext.extractedEntities.confirmedItems   (fuzzy name match, conversation-context.service modifyCart)
  Writer#2: Order.items JSON (draft)                               (orderService.syncCartStateToDraftOrder:111)
  (OrderItem strongly-typed used ONLY by catalog createOrder:248-272 / addOrderItem:317 / removeOrderItem:365)
  │
  ▼
PERSISTENCE
  Prisma: ConversationContext.extractedEntities  (Json)
  Prisma: Order.items                            (Json, status='draft')
  NO Cart / CartItem table in schema.prisma (lines 209-256)
  │
  ▼
READBACK
  Reader: getCartFromDb (926) reads extractedEntities (+ Order.items join)
  Renderer: renderCartSummary (961)
  PWA: GET /pwa/:slug/history (uid)          [pwa.ts]  ← does NOT surface cart to web customer
  Dashboard: GET /conversations (admin only)  [conversations.ts:71]
```

### 5.3 Authority / writer/reader map

| Role | Component | Path | Notes |
|------|-----------|------|-------|
| Writer (cart blob) | `ConversationContextService.modifyCart` | `conversation-context.service.ts` | fuzzy `name` match (`fuzzyMatch` L302-309); writes `confirmedItems` to `extractedEntities` |
| Writer (draft order) | `orderService.syncCartStateToDraftOrder` | `order.service.ts:111` | writes `confirmedItems` to `Order.items` JSON (`orderStatus='draft'`, `buildPipelineContext:841`) |
| Reader (cart) | `conversationService.getCartFromDb` | `conversation.service.ts:926` | reads `extractedEntities` (+ Order.items) |
| Renderer | `renderCartSummary` | `conversation.service.ts:961` | |
| Strongly-typed cart | `OrderItem` | `order.service.ts:248-365` | ONLY catalog `createOrder`/`addOrderItem`/`removeOrderItem` — **NOT** the chat cart |

### 5.4 Issues identified (DO NOT FIX — read-only)

| # | Finding | Severity | Current | Expected | Risk / Future Phase |
|---|---------|----------|---------|----------|---------------------|
| C-art-1 | **Dual writer** of `confirmedItems` | HIGH | written to BOTH `extractedEntities` (Ctx) AND `Order.items` JSON | single source of truth | drift/divergence; G2 should pick one authority (C5) |
| C-art-2 | **No Cart/CartItem table**; cart = Json blobs on two models | HIGH | `Order.items` Json + `ConversationContext.extractedEntities` Json | dedicated `Cart`/`CartItem` table | fragile, no FK/transactionality; G2 schema (C5) |
| C-art-3 | **Fuzzy / name-based identity** | HIGH | `fuzzyMatch` by name; `getStoreProducts:804 maps `id: p.name` | product SKU/id | "berasss" vs "beras" ambiguity; duplicate-dedup breaks; G2 identity (C5) |
| C-art-4 | **Strongly-typed `OrderItem` unused for chat cart** | MEDIUM | 0 rows; chat cart uses `Order.items` JSON; `OrderItem` only catalog | chat cart should use typed rows | data-shape divergence (JSON blob vs typed rows); G2 reconcile (C5) |
| C-art-5 | **`confirmedAt` inconsistency** | MEDIUM | set on some draft paths (order `3b8fbb00`); NULL on `updateOrderStatus→confirmed` (Test-9) | `confirmedAt` set exactly when `orderStatus` transitions to terminal-confirmed | attribution/audit noise; G2 order.service pass (C-art-5) |
| C-art-6 | **Duplicate cart mutation** (6 identical pending carts) | HIGH | 6 pending orders, same lowercase items | dedup by conversation+items | state bloat / mis-counted carts; G2 cart dedup (C5) |

### 5.5 Fixture baseline — INTENTIONALLY NOT PERFORMED

Per the **read-only / foren­sic mandate**, the `add / remove / quantity / update / clear` write-fixture sequence was **NOT executed** against the canary store (it would mutate production conversation/order data). The **current-state baseline above** (§5.1) is the read-only substitute: it captures the *actual* cart/order/conversation state at baseline. A write-fixture (before/after DB diff) is deferred to G2-B *after* a cart-authority refactor exists (see Risks §14).

---

## 6. AI PROVIDER BASELINE

### 6.1 Actual runtime path (audited)

**Declared (manager.ts) vs Actual (hot path):**
```
manager.ts:34  primaryProvider = geminiAdapter        // "GEMINI now PRIMARY speaker (Natural Conversation)"
manager.ts:35  fallbackProvider = groqAdapter          // "GROQ now FALLBACK speaker"
manager.ts:36  gatekeeper       = groqAdapter          // "GROQ now FAST GATEKEEPER"
```
But the **conversation-reply hot path bypasses the manager entirely**:
```
pwa.ts:164 / webhooks.ts → messageProcessorService.processMessage
  message-processor.service.ts:256  llmCircuitBreaker.wrap(() => conversationService.processCustomerMessage(...))
  conversationService.processCustomerMessage → interpreter.reproduce / reasoning.generate
  interpreter.ts:12   import { groqAdapter } from '../../adapters/ai/groq.adapter.js'   ← DIRECT
  interpreter.ts:88   await groqAdapter.generate(prompt, {...})                         ← BYPASSES manager
  reasoning.ts:31     import { groqAdapter } ... (direct)                                ← BYPASSES manager
```
**Audit finding C2 (confirmed): the Gemini-primary / Groq-fallback policy is NOT enforced on the main LLM path.** Only Groq is invoked (via direct import), with the Groq adapter's *internal* retry/key-rotation.

**Manager consumers (who actually uses the policy):**
- `adapters/container.ts:31` → `aiProviderManager.generate` → consumed by `product.service.ts:721` (magic-paste) only.
- `adapters/container.ts:33` → `aiProviderManager.extractIntent` (gatekeeper).
- `adapters/container.ts:49` → manager.generate (fallback) → consumed by `adapters/llm.chat` → **dead stub** `message.handler.ts` (0 consumers).

So `aiProviderManager` (with Gemini-primary + breaker + Redis cooldown) is live on **one** path: product magic-paste. The main conversation reply path is direct-Groq. This is C2.

### 6.2 Retry / circuit-breaker stack (4 layers)

| Layer | Component | Config | Applies to hot path? |
|-------|-----------|--------|----------------------|
| L1 | `message-processor` `CircuitBreakerService('llm-main', …)` | threshold **2** failures → hardcode apology + human_takeover (reasoning.ts:503 "Mark conversation for human takeover (circuit breaker terbuka)") | ✅ YES |
| L2 | `ai/manager.ts` `breaker` + `shouldSkipProvider`/`triggerCooldown` | threshold **5**; `resetAfterMs: 60_000` (60 s); Redis provider cooldown `DEFAULT_COOLDOWN_MS = 5 * 60_000` (provider-cooldown.ts:11) | ❌ NO (bypassed) |
| L3 | `groq.adapter.ts` internal retry | `maxRetries = 5` (key rotation); `REQUEST_TIMEOUT_MS = 10000` (10 s) per attempt; all-keys-cooldown → throw "All Groq API keys are in cooldown" → manager fallback (not reached on hot path) | ✅ YES |
| L4 | `message-processor` / groq timeout | 10 s transport timeout; timeout NOT retryable within adapter (groq.adapter.ts:227, comment: "manager handles fallback") | ✅ YES |

### 6.3 Runtime measurement (read-only)

A billable/live `groqAdapter.generate`/`manager.generate` call was **intentionally NOT executed** (would issue a real external LLM request requiring credentials + cost; violates read-only). Instead, provider reachability measured via the **public** health path (which itself invokes the providers' read-only `isHealthy`):
- `curl https://qlobot.web.id/api/health` → HTTP 200 `{"status":"ok","message":"All systems operational"}` at measurement time.
- `health.service.ts:52` runs in parallel: `db`, `redis`, `groqAdapter.isHealthy()` (GET `https://api.groq.com/openai/v1/models` — free metadata, **non-billable**, groq.adapter.ts:275), `geminiAdapter.isHealthy()` (GET `…/v1beta/models?key=…` — free metadata, **non-billable**, gemini.adapter.ts:276). → both providers reachable at baseline.
- `GET /api/admin/health` → HTTP 401 (admin-auth gated; `adminAuthMiddleware`) — detailed dep breakdown not accessible read-only.

**Golden-dataset mocked LLM timing (proxy for conversational path):** 17 cases / 3055.75 ms ≈ **180 ms avg per case** (fast-path 0-LLM cases ~65–284 ms; interpreter ≤1-LLM cases ~109–116 ms). Provider/model recorded in audit envelope: `'groq'`/`'test-model'`.

### 6.4 AI config in `.env`
`DATABASE_URL`, `REDIS_URL`, `GEMINI_API_KEY`, `GROQ_API_KEYS` all **present/SET**. `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` **NOT set** (→ Web Push disabled; see §10 / §11).

---

## 7. WEBHOOK BASELINE

Full audit of `src/routes/webhooks.ts` (291 lines), mounted at `/api/webhooks` (index.ts:108). **No HMAC added (read-only).**

### 7.1 GOWA (`/api/webhooks/gowa`)
- **Authentication/secret verification:** NONE. Webhook does **not** verify any HMAC or shared secret (no `timingSafeEqual`).
- **Tenant resolution:** `device_id` from payload → `prisma.store.findFirst({ where: { phoneNumber: device_id } })` (webhooks.ts ~L52-63). Tenant = store whose `phoneNumber` matches the sender device. If no match → 404.
- **Processing path:** parses `wa_id` + `message`; extracts `messageId` for dedup; responds **200 before processing** (fire-and-forget); delegates to `messageProcessorService.processMessage` (dedup by `messageId`, 5-min TTL at `message-queue.service`).
- **Replay/duplicate:** protected only by the 5-min `messageId` TTL dedup queue. No cryptographic replay protection.
- **Body parsing:** relies on the global `express.json()` (index.ts:77); no `express.raw` for the webhook path (HMAC migration would require a raw-body parser on this route).

### 7.2 Fonnte (`/api/webhooks/fonnte`)
- **Authentication:** `?secret=` query param matched against `Store.webhookSecret` (schema.prisma:33). NOT HMAC; **no `timingSafeEqual`** (plain `===`).
- **Tenant resolution:** Fonnte `sender` phone → lookup store.
- **Replay/duplicate:** same 5-min `messageId` TTL dedup via `messageProcessorService`.

### 7.3 Test attempt (forged vs valid) — SKIPPED
A live forged-vs-valid probe was deemed **not safe** (GOWA/Fonnte both call into `messageProcessorService` → conversation engine + Groq on the live canary store; a forged request would still drive processing). Per task rule, **SOURCE INSPECTION ONLY** for webhooks. No request was sent.

| # | Finding | Severity | Current | Expected | Risk / Future Phase |
|---|---------|----------|---------|----------|---------------------|
| C-web-1 | GOWA webhook has NO secret/HMAC verification | HIGH | `device_id` matched to store.phoneNumber; 200-before-process; 5-min messageId dedup only | signature verification (HMAC) on a raw body | spoofed inbound messages drive full engine pipeline on production; G2 webhook security (C6) |
| C-web-2 | Fonnte uses `?secret=` query, plain `===`, no `timingSafeEqual` | MEDIUM | query-param secret compared with `===` | HMAC + `timingSafeEqual`; header-based secret | timing/leak; G2 webhook security (C6) |
| C-web-3 | Global `express.json()` on webhook path; no raw body | LOW | parsed JSON body | mount `express.raw({type:'application/json'})` on `/api/webhooks` before json | blocks future HMAC verification (body already consumed); G2 webhook security (C6) |

---

## 8. REALTIME BASELINE

Audited `services/realtime.service.ts` (303 lines), `services/event-bus.service.ts` (57), `services/conversation-delivery.service.ts` (284), `services/message-processor.service.ts`. Socket.IO path `/api/ws` (index.ts; `createChatSocket` in `apps/pwa/src/services/api.ts` connects to `${base}/api/ws`).

- **EventBus:** in-process Node `EventEmitter` (`event-bus.service.ts:35` — comment "Single-VPS MVP: in-proc"). 9 event types: `conversation.handoff`, `conversation.resumed`, `conversation.resolved`, `conversation.updated`, `typing.started`, `typing.stopped`, `message.created`, `customer.typing`, `health`. **No Redis adapter** → not horizontally scalable / events lost across VM restarts.
- **Socket.IO:** in-process, `path: '/api/ws'`, no `createAdapter(redis)`. Rooms: customer `store:{storeId}:conv:{conversationId}` and admin `store:{storeId}:admin`. Auth guard: **admin** = Bearer token (`adminAuthMiddleware`); **customer/web** = `storeSlug` + `uid` (anonymous). Customer presence tracked in an **in-proc `Set` per conversation** (`realtime.service.ts`), cleared on disconnect.
- **Delivery / dedup:** `conversation-delivery.service.ts` — single lock-owner dispatcher; switch-case `union` room emit; per-socket dedup by `messageId` (`renderedIds` in ChatPage). HARD RULE #3 (HTTP `messageId` = WS `data.id`), #1 (engine-only persistence), #11 (structured authority) enforced here.
- **Reconnect:** `socket.io-client` `reconnectionAttempts: 10`; `reconnect`/`disconnect`/`reconnect_failed` mapped to `ConnectionState` (connecting/connected/reconnecting/disconnected) on ChatPage. After reconnect → history catch-up GET `/pwa/:slug/history` (dedup by id).
- **Duplicate-notification risk:** dispatch is per-room single emit; dedup relies on `message.created` `id` on the client. No server-side per-customer dedup beyond the `messageId` 5-min TTL in message-queue. Risk if `message.created` `id` collides (HARD RULE #4 violation).

| # | Finding | Severity | Current | Expected | Risk / Future Phase |
|---|---------|----------|---------|----------|---------------------|
| C-rt-1 | In-process EventBus + Socket.IO, no Redis adapter | MEDIUM | single-VPS MVP (commented) | `socket.io-redis`/`ioredis` EventBus adapter for multi-instance | not horizontally scalable; events lost on failover; G2 infra (C7) |
| C-rt-2 | Customer presence in-proc Set | LOW | per-instance memory | Redis-backed presence | stale presence across instances; G2 infra (C7) |
| C-rt-3 | Customer auth = slug+uid only (anonymous) | LOW | no customer token | per-customer signed uid | replay/impersonation of a known uid; G2 security (C8) |

---

## 9. PWA / BROWSER BASELINE

Command: headless Playwright (chromium-1234, `@no-sandbox`) against live `https://qlobot.web.id/c/kinasih`, mobile `390×844` + desktop `1280×720`, **fresh incognito contexts** (clean `localStorage` ⇒ fresh `webUid`). **No message was sent** (PWA `POST /message` would drive the live engine + bill a real Groq call and mutate the canary conversation) → only read-only GETs (`init`, `/stores/:id/products`, `/history`). Captured to `/tmp/g2a-screenshots/`.

**Rendered UI (read-only probe of live DOM):** title `Depot Kinasih — Chat Toko`; buttons `🛍Lihat Produk`, `🔍Cari Produk`, `💬Tanya Toko`, `Lihat semua`, `Kirim`; product cards `Ayam 35.000`, `Brambang 30.000`, `Es Jeruk Manis 7.000`, `Es Teh Manis 5.000`, `Gulali 10.000`, `Kangkung 8.000 (Stok:100)`, one `No image`; footer link `https://wa.me/6282147128277` (store phoneNumber exposed); manifest link is a `blob:https://qlobot.web.id/...` (runtime-injected by `main.tsx`).

**Scenarios captured (16 screenshots, 0 console errors, 0 network failures):**

| # | Scenario | Viewport | File | Read-only? | Visual |
|---|----------|----------|------|------------|--------|
| 1 | First open (store banner + product preview) | mobile 390×844 | `mobile-01-first-open.png` | ✅ | store "Depot Kinasih" header, product card grid |
| 2 | Product list (`🛍Lihat Produk`) | mobile | `mobile-02-product-list.png` | ✅ | full product list view |
| 3 | Search results (`🔍Cari Produk` → "ayam") | mobile | `mobile-03-search-results.png` | ✅ | filtered product list |
| 4 | Conversation (empty state, fresh uid) | mobile | `mobile-04-conversation-empty.png` | ✅ | EmptyState (no prior messages) |
| 5 | Composer + empty cart (scrolled) | mobile | `mobile-05-composer-cart-empty.png` | ✅ | `💬Tanya Toko` composer, `Kirim`, no cart |
| 6 | Connection banner (Socket.IO) | mobile | `mobile-06-connection-banner.png` | ✅ | connection-state UI |
| 7 | First open | desktop 1280×720 | `desktop-01-first-open.png` | ✅ | responsive layout |
| 8 | Product list | desktop | `desktop-02-product-list.png` | ✅ | |
| 9 | Search results | desktop | `desktop-03-search-results.png` | ✅ | |
| 10 | Conversation empty | desktop | `desktop-04-conversation-empty.png` | ✅ | |
| 11 | Composer + empty cart | desktop | `desktop-05-composer-cart-empty.png` | ✅ | |
| 12 | Connection banner | desktop | `desktop-06-connection-banner.png` | ✅ | |
| 13 | PWA standalone/manifest (first run) | mobile | `mobile-04-standalone.png` | ✅ | (superseded by -04) |
| 14 | PWA standalone (first run) | desktop | `desktop-04-standalone.png` | ✅ | (superseded by -04) |

(`-discovery`/`-standalone` from the first harness pass are byte-identical to `-01`/`-04` and are retained for the audit trail; the canonical set is `-01…-06`.)

**Not reproduced read-only (would mutate production):** populated conversation / populated cart / human-handoff (`conversation.handoff` / `human_takeover`). A fresh `webUid` yields empty history & no cart; exercising a real reply would POST `/message` → live Groq call + canary store mutation. These states are documented from source (`ChatPage.tsx`, `HandoffMessage`, `CartSummary`) instead — see §11 protected-arch source diff. **Console/network errors: none.**

**Manifest / install:** `main.tsx` injects a runtime `blob:` manifest (store name + icon) and listens for `beforeinstallprompt` (Chrome/Edge/Android only; iOS does not fire it). `index.html`/PWA start_url = `/c/<slug>`, `display: standalone` (F5.1). Install banner deferred until after first AI reply (`installTriggeredRef`, `isInstallBannerAllowed` 7-day TTL via `pwa_install_prompt` localStorage key).

---

## 10. PERFORMANCE BASELINE

### 10.1 Live API latency (HTTPS `https://qlobot.web.id`, 3 runs each, `curl -w`)

| Endpoint | Method | HTTP | total (min) | TTFB (min) | Notes |
|----------|--------|------|-------------|------------|-------|
| `/api/health` | GET | 200 | 19.4 ms | 19.3 ms | 1st call 332 ms (DNS cold) |
| `/api/pwa/kinasih/init` | GET | 200 | 24.2 ms | 24.2 ms | store + vapidPublicKey (vapid=false) |
| `/api/stores/store-f7140b5c/products?limit=12` | GET | 200 | 30.4 ms | 30.3 ms | PUBLIC (no auth) |
| `/api/pwa/kinasih/history?uid=<fresh>` | GET | 200 | 23.6 ms | 23.5 ms | `{"success":true,"data":{"history":[]}}` — 200 even for unknown uid (no 404) |

All sub-50 ms TTFB. DNS cold-start ~315 ms on first `/health` call (cached thereafter).

### 10.2 Test-suite durations (baseline)
- Jest (Jaws engine): 9.71 s (23 suites).
- golden-dataset: 3,055.75 ms (17 cases, mocked LLM).
- pipeline+edge+notification+mission-control: 5,849.53 ms (62 tests).
- Browser PWA harness: ~stable, 0 console/network errors.

### 10.3 Runtime process / infra
- PM2 `api` on `:3000` (pid 370262, uptime ~8 h), `dashboard` `:8080`, `pwa` `:8081` (pid 375004, uptime ~6 h) — all `online`.
- DB reachable (Prisma `$queryRaw SELECT 1` → `DB_OK [{"ok":1}]`); Redis reachable (`Redis connected`).
- WebSocket transport: Socket.IO over `/api/ws`; client `reconnectionAttempts: 10`; `CONNECT` handshake not separately timed this run.

### 10.4 Latency budget (from code, not executed)
- Groq transport timeout: `REQUEST_TIMEOUT_MS = 10_000` (groq.adapter.ts:13). Fast-path (0-LLM) tiers ≈ 10–30 ms (db lookup); interpreter tier (≤1 LLM) ≈ 100–300 ms (capped at 10 s). No SLA/SLO configured (no metrics export observed).

---

## 11. SECURITY BASELINE

### 11.1 Auth model
- **Store/admin auth:** Bearer token. `authMiddleware` (`middleware/auth.ts`) resolves store via `storeSetting(key='auth_token', value=token)` + expiry check (`auth_token_expires_at`). `adminAuthMiddleware` (`middleware/adminAuth.ts`) resolves via `adminAuthToken` table (revocation + expiry + active check). No cookies (token bearer) → CSRF not applicable.
- **PWA/web customer:** anonymous per-browser `webUid` (localStorage `garuda_pwa_uid`, `crypto.randomUUID()`); conversation keyed by uid. **No customer account auth.**
- **Admin routes:** all `/api/admin/*` behind `adminAuthMiddleware`; `/api/admin/mission-control` additionally requires role `super_admin` (index.ts:127). `/api/admin/health` → 401 without admin token (verified live).

### 11.2 Authorization boundaries (read-only probe)
- **Public (no auth):** `/health`, `/pwa/:slug/init`, `/pwa/:slug/history?uid=`, `/stores/:storeId/products`, `/redirect /r/:id`, `/`, `/c/:slug/*`.
- **Store-token protected:** `/conversations`, `/orders`, `/analytics`, `/profile`, `/settings`, `/messages`, `/whatsapp`, `/auth` (login/register), `/dashboard`.
- `conversations.ts`: `router.use(authMiddleware)`; tenant isolation via `storeId` on list (`:store/:id`), `where:{id,storeId}` on get/update. **`conversations.ts:134` `prisma.conversation.update({ where:{id} })` lacks `storeId`** in the where-clause — but it is gated by the `findFirst({where:{id,storeId,deletedAt:null}})` existence check at L121 (404 if not owner). **Defense-in-depth gap, not a live IDOR** (ownership enforced before mutation).
- `orders.ts`: `router.use(authMiddleware)`; `where:{id,storeId,deletedAt:null}` consistently. Strong.

### 11.3 PII / data exposure
- **PII exposure (active):** uncommitted `pwa.ts` adds `id: true` + `phoneNumber: true` to the **public** `GET /api/pwa/:slug/init` select. Verified live: response includes `phoneNumber: "6282147128277"` and the PWA renders `https://wa.me/6282147128277`. Store `phoneNumber` is DB-obfuscated (`6jXdl/4rK…:…`) but **decrypted/exposed in plaintext** on this public endpoint. (Severity HIGH — customer-facing PII/contact leak.)
- **Web Push / VAPID:** `vapidPublicKey` returns `false` on `/init` → `process.env.VAPID_PUBLIC_KEY` **unset** → Web Push subscribe endpoint exists (`pwa.ts`) but VAPID not configured → graceful degrade, no real push. (Not a vuln, a config gap.)

### 11.4 Rate limiting (present & mounted)
- `adminAuthLimiter` 5/15 min (login/register, admin) — `skip` in NODE_ENV=test.
- `storeAuthLimiter` 5/15 min (login/register).
- `generalLimiter` 1000/15 min (defined; mount location not confirmed in routes — used as global? unverified).
- `conversationLimiter` 100/15 min — mounted on `POST /pwa/:store/:slug/message` (pwa.ts:164).
- Webhooks (`/gowa`, `/fonnte`) — **no limiter** (only the 5-min messageId dedup queue). Brute/infinite webhook replay not rate-limited.

### 11.5 Headers / transport
- **No `helmet`** imported anywhere (`grep` → none) → no CSP, no `X-Frame-Options`, no `HSTS`, no `X-Content-Type-Options`, no `Referrer-Policy`. (Severity MEDIUM.)
- CORS: `cors({ origin: corsAllowedOrigins })` — whitelist of local origins + `envOrigins` (parsed from env). Not wildcard. Acceptable but env-origin-dependent.
- TLS: live site serves HTTPS (`https://qlobot.web.id`); local `:3000/:8081` HTTP.

### 11.6 Tenant isolation
- Web channel: `webUid` is global-unique per browser, scoped per-store via `storeSlug`. A fresh uid for store A does **not** see store B's conversations (history query is `where store+slug`). OK.
- Dashboard: every protected route prefixes `storeId` from token — verified `WHERE storeId` on conversations/orders/analytics. OK.

| # | Finding | Severity | Current | Expected | Risk / Future Phase |
|---|---------|----------|---------|----------|---------------------|
| C-sec-1 | `phoneNumber` PII on public `/init` (uncommitted pwa.ts) | HIGH | returned plaintext + `wa.me` link | do not expose phone on unauthenticated endpoint | contact/PII leak; G2 pwa.ts (C3) |
| C-sec-2 | No `helmet` / no security headers | MEDIUM | no CSP/HSTS/XFO | `express-rate-limit` + helmet/security-headers middleware | clickjacking/MIME-sniff/transport; G2 security (C8) |
| C-sec-3 | Webhook rate limiting absent (only 5-min dedup) | MEDIUM | GOWA/Fonnte unthrottled | limiter + HMAC | webhook DoS/replay amplification; G2 webhook (C6) |
| C-sec-4 | `conversations.ts` update where lacks `storeId` (post-gate) | LOW | gated by 404 findFirst | add `storeId` to update where | defense-in-depth; G2 (C3) |
| C-sec-5 | `generalLimiter` mount location unconfirmed | LOW | defined rate-limiters.ts | verify global mount | possible missing global guard; G2 infra |
| C-sec-6 | No customer auth (anonymous `webUid`) | LOW | slug+uid only | signed/rotated uid token | uid impersonation; G2 security (C8) |

---

## 12. PROTECTED ARCHITECTURE CHECK

Working-tree (`git diff --name-only`, excluding `dist`/`logs`/`DOCS`) changes:

```
.env
apps/api/src/routes/pwa.ts            (+9/-3)
apps/pwa/index.html                   (+1/-1)
apps/pwa/public/manifest.json         (+1/-1)
apps/pwa/src/components/ChatBubble.tsx (+107)
apps/pwa/src/components/ChatPage.tsx   (+515)
apps/pwa/src/main.tsx                  (+97/-...)
apps/pwa/src/index.css                 (+8)
```
Staged: **none**. Untracked: `apps/pwa/src/components/*.tsx`, `apps/pwa/src/{types,utils/format.ts}`, `apps/pwa/playwright-screenshot.ts`, `marketplace/` (separate OpenShip repo), `DOCS/{ARCHIVE,AUDIT,CONTRACT,MASTER,PHASE-REPORTS,PROJECT}/`.

**Protected set check (must be UNTOUCHED by any G2-A change):**

```
git diff --name-only -- \
  apps/api/src/services/chat \
  apps/api/src/business/conversation.service.ts \
  apps/api/src/business/conversation-context.service.ts \
  apps/api/src/business/order.service.ts \
  apps/api/src/services/message-processor.service.ts \
  apps/api/src/routes/webhooks.ts \
  apps/api/src/services/realtime.service.ts \
  apps/api/src/services/event-bus.service.ts \
  apps/api/src/services/conversation-delivery.service.ts \
  apps/api/src/adapters/ai \
  apps/api/src/services/fonnte.service.ts \
  apps/api/src/adapters/whatsapp/gowa.adapter.ts
→ NONE (empty)
```

| Protected subsystem | Path(s) | Changed in WT? | Verdict |
|---|---|---|---|
| Conversation Engine (Fase 1–4) | `business/conversation.service.ts`, `conversation-context.service.ts`, `order.service.ts` | NO | ✅ intact |
| Structured authority / HARD RULE #3 | `services/conversation-delivery.service.ts` | NO | ✅ intact |
| LLM hot path | `services/chat/reasoning.ts`, `interpreter.ts`, `adapters/ai/*` | NO | ✅ intact |
| Messaging ingestion | `services/message-processor.service.ts` | NO | ✅ intact |
| Webhooks (GOWA/Fonnte) | `routes/webhooks.ts`, `services/fonnte.service.ts`, `adapters/whatsapp/gowa.adapter.ts` | NO | ✅ intact |
| Realtime (Socket.IO/EventBus) | `services/realtime.service.ts`, `event-bus.service.ts` | NO | ✅ intact |

**Conclusion:** The conversation engine, Fase 1–4 pipeline, HARD RULEs (#1/#3/#11), structured authority, GOWA/Fonnte, EventBus/Socket.IO, persistence identity, and `adapters/ai` are **all unmodified** at baseline. The ONLY backend-behavioral change in the working tree is the `pwa.ts` public `phoneNumber`/`id` exposure (a security finding, §11 — **not** a protected-arch change). The PWA frontend changes (`ChatPage`, `ChatBubble`, `main.tsx`, `index.css`) are UI-layer only and do **not** alter the protected backend contract. **Protected architecture passes the baseline freeze.**

---

## 13. KNOWN FAILURES (PRE-EXISTING — DO NOT FIX)

| ID | Suite / test | Exact failure | Location | Pre-existing? | Root cause |
|----|--------------|---------------|----------|---------------|------------|
| F-1 | `engine-config-v2.test.ts` (Jest) | `ReferenceError: Cannot access 'redisAdapter' before initialization` (TDZ) | `adapters/container.ts:38` | ✅ Yes | Module init-order: `redisAdapter` exported/initialized after consumers in same module graph; breaks any test transitively importing `adapters/container`. |
| F-2 | `reasoning-v2.test.ts` "Validator reject terminal (low confidence) → fallback" | Expected event `fallback_reasoning_failed`, received `reasoned` | `services/chat/reasoning.ts` / `reasoning-v2.test.ts` | ✅ Yes (RAILS.md §3 I-V2-6 label mismatch, pre-task) | Stale expectation label vs. actual emitted event name. |
| F-3 | `order-context.integration.test.ts` — Test 9 "Update order status -> confirmed sets confirmedAt" | `assert.ok(confirmed.confirmedAt)` → `confirmed.confirmedAt` is `null` | `order.service.ts:296-312` (only sets `orderStatus`) | ✅ Yes | `updateOrderStatus` does not set `Order.confirmedAt` on `status→confirmed`; only sets `orderStatus`. |
| F-4 | `golden-dataset` cleanup — `prisma:error` code `23001 RESTRICT` on `conversation.delete()` | FK constraint (`conversation_context`) blocks delete → `.catch(()=>{})` swallows → row leak | `golden-dataset.test.ts` `cleanupStoreData` | ✅ Yes | Cleanup ordering deletes child then parent; a residual FK child (conversation_history already cleared; context cleared) leaves RESTRICT → leak (tests still PASS). |

**Aggregate:** Jest 260/261 tests pass (1 fail = F-2); 21/23 suites pass (2 fail = F-1, F-2). `node:test` suites fully green except F-3 (order-context). No failures were introduced or fixed in this baseline pass; no fix was applied.

---

## 14. KNOWN RISKS (CARRY INTO G2 — READ-ONLY, NOT FIXED)

| ID | Risk | Where | Severity | G2 reference |
|----|------|-------|----------|--------------|
| R-1 | Dual cart writer (`extractedEntities` + `Order.items` JSON); no `Cart` table | §5, `order.service.ts:111`, `conversation-context.service modifyCart` | HIGH | C5 (cart authority) |
| R-2 | Fuzzy/name cart identity (`getStoreProducts:804 id:p.name`; `fuzzyMatch`) | §5 | HIGH | C5 |
| R-3 | `OrderItem` strongly-typed unused for chat cart (0 rows) — JSON-blob cart diverges | §5 | MEDIUM | C5 |
| R-4 | Conversation LLM hot path uses `groqAdapter` **directly**, bypassing `aiProviderManager` (Gemini-primary policy NOT live on replies) | §6, `interpreter.ts:12`, `reasoning.ts:31` | HIGH | C2 |
| R-5 | Webhooks lack HMAC (GOWA none; Fonnte `?secret` plain `===`) + no raw-body parser + no webhook rate limit | §7, §11 | HIGH | C6 |
| R-6 | `phoneNumber` PII exposed on public `/pwa/:slug/init` (uncommitted `pwa.ts`) | §11, §12 | HIGH | C3 |
| R-7 | No `helmet`/security headers; no CSP/HSTS/XFO | §11 | MEDIUM | C8 |
| R-8 | In-proc EventBus + Socket.IO (no Redis adapter) — not horizontally scalable | §8 | MEDIUM | C7 |
| R-9 | 4 `.e2e.*` suites not executed (live-send scope pending) — §2 coverage gap | §2 | LOW | test-infra |
| R-10 | `apps/api/dist/` and `apps/api/logs/` tracked in git (RAILS hygiene) — not in `.gitignore` | §1 | LOW | repo-hygiene |

---

## 15. METRICS SNAPSHOT

| Metric | Baseline value | Source |
|---|---|---|
| Git HEAD | `8289f5b` (Feat: FASE 4 web push) | `git log` |
| Working tree | NOT clean (source: `.env`, `pwa.ts`, PWA frontend; doc reorg: 54 DOCS deletions relocated; regenerable: `dist/`, `logs/`) | `git status --porcelain` |
| Staged changes | none | `git diff --cached --name-only` |
| API typecheck | EXIT 0 (clean) | `tsc --noEmit` |
| PWA build | exit 0 (`dist/index.html` 0.49 kB; `index-<hash>.js` 347.87 kB, gzip 111.86 kB) | `vite build` |
| Dashboard typecheck | EXIT 0 (clean) | `tsc -b --noEmit` |
| Jest (Jaws engine) | 21/23 suites; 260/261 tests | `jest --config jest.config.cjs` |
| Golden dataset | 17/17 pass (3,055.75 ms) | `tsx --test golden-dataset.test.ts` |
| Pipeline+edge+notification+mission | 62/62 pass | `tsx --test …` |
| Structured-message | 22/22 | `tsx --test …` |
| Date-range | 9/9 | `tsx --test …` |
| Order-context | 14/15 (F-3 pre-existing) | `tsx --test …` |
| Live `/api/health` | HTTP 200 `status:ok` (Groq+Gemini isHealthy ok) | curl |
| PWA `/init` TTFB | 24.2 ms (min) | curl -w |
| Products (public) TTFB | 30.4 ms (min) | curl -w |
| History (fresh uid) TTFB | 23.6 ms (min) | curl -w |
| PWA browser errors | 0 console, 0 network fails (16 screenshots) | Playwright harness |
| Screenshot artifacts | `/tmp/g2a-screenshots/` (16 PNG + log) | harness output |
| AI provider at runtime | Groq direct on reply path; Gemini-primary policy NOT live on replies | §6 |
| VAPID / Web Push | **disabled** (`vapidPublicKey=false`, keys not in `.env`) | §6, §11 |
| PM2 | `api`:3000 (~8h), `dashboard`:8080, `pwa`:8081 (~6h) — all online | `pm2 ls` |

---

## 16. EXIT CRITERIA (G2-A done?)

Per `ROADMAP-QLOBOT-GENERATION-2.0.md` §2, G2-A must deliver a forensic baseline sufficient to answer **"If G2-B/C/D breaks something, how do we know what changed?"**.

| Exit criterion | Met? | Evidence |
|----------------|------|----------|
| Git baseline (HEAD, branch, WT cleanliness, last Gen-1 commit) | ✅ | §2: HEAD `8289f5b` `main`; WT dirty; last Gen-1 = FASE 4 commit |
| Test inventory + run results (PASS/FAIL/SKIP) with pre-existing tags | ✅ | §3, §13 |
| Golden conversation regression baseline (scenario/expected/actual/pass/provider/latency) | ✅ | §4 |
| Cart forensic (current state + pipeline diagram + writer/reader/authority/dual-writer/fuzzy) | ✅ | §5 (+ read-only DB probe; write-fixtures intentionally skipped) |
| AI provider runtime path + retry/circuit/fallback | ✅ | §6 (no billable generate executed; health-path used) |
| Webhook auth/tenant/replay | ✅ | §7 (source inspection only; live forge probe skipped as unsafe) |
| Realtime EventBus/Socket.IO/rooms/auth/tenant | ✅ | §8 |
| PWA/browser screenshots + errors | ✅ | §9 (16 screenshots, 0 errors) |
| Performance baselines (latency) | ✅ | §10 |
| Security audit | ✅ | §11 |
| Protected-architecture check (protected surface unmodified) | ✅ | §12 |
| Baseline report written | ✅ | this document (`/home/ubuntu/garuda/DOCS/G2-A-baseline-report.md`) |

**G2-A exit:** ✅ MET. Baseline is sufficient to diff any G2-B/C/D change against Gen-1. Read-only invariant respected throughout (no source edits, no git mutation, no `db push`, no deploy, no commit; the single transient `__cart_probe.cjs` was created in `apps/api`, executed SELECT-only, and deleted — `git status` clean afterwards).

> ⚠️ **Hand-off to G2-B/C/D:** The 4 write-fixture cart probes (`add`/`remove`/`quantity`/`update`/`clear` with before/after DB state) are the next recommended action once a **single cart authority** is chosen (C5/R-1) — only then can deterministic cart-state regression fixtures be added safely. Until G2 selects the cart authority, do **not** run write-fixtures against production.
