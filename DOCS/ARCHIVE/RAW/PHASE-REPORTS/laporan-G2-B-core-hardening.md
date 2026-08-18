# G2-B — Core Hardening Phase Report

**Date:** 2026-08-14  
**Phase:** G2-B (Core Hardening)  
**Status:** COMPLETE ✅  
**Working Directory:** `/home/ubuntu/garuda`  
**Git Branch:** `main` (ahead of `origin/main` by 31 commits, HEAD `8289f5b`)  

---

## 1. Summary

G2-B core hardening implemented across 8 sub-tasks. All existing test suites
maintain or exceed baseline pass counts. New tests added for each sub-task.
No production PM2 restarted. No commit performed (per task constraints).

### Final Verification Results

| Check | Result |
|-------|--------|
| `tsc --noEmit` (API) | ✅ 0 errors |
| `tsc --noEmit` (PWA) | ✅ 0 errors |
| `tsc --noEmit` (Dashboard) | ✅ 0 errors |
| API build (`tsc -p tsconfig.json`) | ✅ 0 errors |
| PWA build (`vite build`) | ✅ 347.81 kB |
| Dashboard `tsc --noEmit` | ✅ 0 errors |
| `git diff --check` | ✅ Clean |
| node:test suites | ✅ 162/162 pass (19 suites) |
| Jest suites | ✅ 267/267 pass (23 suites) |

---

## 2. Owner Decisions Applied

| Decision | Status |
|----------|--------|
| D1 AI provider boundary | ✅ APPROVED — implemented via `LLMGateway` |
| D2 LLM gateway mock seam | ✅ APPROVED — updated golden + interpreter + reasoning-v2 test mocks |
| D3 device_id as secret | ✅ REJECTED — not used for auth |
| D3 GOWA HMAC/secret | ✅ HOLD — NOT implemented (documented) |
| D3 Redis dedup | ✅ APPROVED — implemented |
| D4 Fonnte timing-safe | ✅ APPROVED — `crypto.timingSafeEqual` |
| D5 public PWA contact | ✅ APPROVED — `phoneNumber` removed, `contact` object added |
| D6 order transition invariant | ✅ APPROVED — authoritative state machine |
| D7 CartAuthority | DEFERRED TO G2-C (not touched) |
| D8 tiered rate limiting | ✅ APPROVED — Redis-backed per-surface limiters |
| D8 Redis rate-limit storage | ✅ APPROVED — `RedisRateLimitStore` |
| TRUST_PROXY explicit | ✅ APPROVED — from env var |

---

## 3. Sub-Task Results

### G2-B.1 — AI Provider Boundary ✅

**Created:** `src/adapters/ai/llm-gateway.ts` (`LLMGateway` class + `llmGateway` singleton + `CircuitOpenError`)  
**Slimed:** `groq.adapter.ts` (single attempt, 10s timeout, `retryable: true`)  
**Swapped:** `interpreter.ts`, `reasoning.ts`, `container.ts`, `admin/config.ts`, `learning.service.ts`, `scheduleFollowUps.ts` — all now call `llmGateway.generate` instead of `groqAdapter.generate`  
**Shifted mock seam:** `golden-dataset.test.ts` — mocks `llmGateway.generate`  
**Created:** `src/tests/ai-gateway.test.ts` (7 tests)  

**Gateway constants:** `TURN_DEADLINE_MS=12000`, `MAX_ATTEMPTS=3`,
`GATEWAY_BREAKER_THRESHOLD=5`, `GATEWAY_BREAKER_RESET_MS=60000`.

**Test results:** 7/7 gateway tests pass, 17/17 golden tests pass, 62/62 pipeline tests pass.

**Fix applied:** Updated `interpreter.test.ts` and `reasoning-v2.test.ts` to mock
`llmGateway.generate` instead of `groqAdapter.generate` (G2-B.1 mock seam). Fixed
stale label in `reasoning-v2.test.ts` (F-2: `fallback_reasoning_failed` → `reasoned`
for I-V2-6 clarification trigger path).

### G2-B.2 — GOWA Network Trust ✅

**Created:** `src/middleware/gowa-trust.ts`

**Topology:** Single VPS. GOWA runs on `localhost:3001`. Express API listens on
`:3000` behind Cloudflare Tunnel (single hop). GOWA webhook calls arrive via
loopback (NOT through the tunnel).

**Boundary mechanism:**
- Checks `req.socket.remoteAddress` (TCP-level source, NOT spoofable via
  `X-Forwarded-For`)
- Trusted sources: `127.0.0.1`, `::1`, `::ffff:127.0.0.1`, `127.0.0.0/8`
- Non-loopback sources → 403 Forbidden
- `device_id` used ONLY for tenant identification (store lookup by phone number),
  NOT authentication
- NO HMAC/secret implemented (per owner decision HOLD — GOWA does not sign
  webhooks, support UNVERIFIED)

**Mounted:** `router.post('/gowa', gowaTrustMiddleware, ...)` in `webhooks.ts`

### G2-B.3 — GOWA Replay/Dedup ✅

**Modified:** `src/adapters/cache/redis.adapter.ts` — added `setIfNotExists(key, value, ttlSeconds)` (atomic SET with EX + NX), added `getTtl(key)`  
**Modified:** `src/services/message-queue.service.ts` — `isDuplicate` is now `async isDuplicate(storeId, messageId)`, uses Redis `SET key '1' EX 300 NX` (atomic, multi-instance safe), key format `<storeId>:msg:<messageId>`, TTL 300s  
**Modified:** `src/services/message-processor.service.ts` — `await isDuplicate(raw.storeId, raw.id)`  
**Modified:** `src/tests/pipeline.test.ts` — async `isDuplicate` calls  
**Created:** `src/tests/webhook-dedup.test.ts` (9 tests)  

**Breakthrough fix:** The circular dependency between `redis.adapter.ts` ↔
`container.ts` (F-1) was RESOLVED by making `redis.adapter.ts` import the logger
directly from `utils/logger.js` instead of going through the `adapters` container.
This fixed the engine-config-v2.test.ts TDZ crash as a side effect.

**Test results:** 9/9 new dedup tests pass. All 62 pipeline tests pass (dedup test
now async + Redis-backed).

### G2-B.4 — Tiered Rate Limiting ✅

**Created:** `src/middleware/redis-rate-limit-store.ts` — `RedisRateLimitStore`
class implementing the express-rate-limit v8 Store interface
(`increment`/`decrement`/`resetKey`/`resetAll`) using Redis atomic INCR + PEXPIRE,
fail-open on Redis failure

**Modified:** `src/middleware/rate-limiters.ts` — added per-surface Redis-backed
limiters:
| Limiter | Window | Max | Surface |
|---------|--------|-----|---------|
| `generalLimiter` (safety net) | 15m | 1000 | Non-webhook routes |
| `conversationLimiter` | 15m | 100 | Chat endpoint |
| `pwaInitLimiter` | 1h | 20 | PWA /init |
| `pwaProductsLimiter` | 1h | 120 | PWA product catalog |
| `webhookLimiter` | 15m | 300 | Webhook endpoints |
| `orderMutationLimiter` | 15m | 30 | Order status mutations |

**Modified:** `src/index.ts`:
- `TRUST_PROXY` now from `process.env.TRUST_PROXY ?? 1` (explicit, documented)
- `generalLimiter` mounted on ALL non-webhook routes (webhooks excluded, have
  own `webhookLimiter`)
- `express.raw({ type: 'application/json' })` added before webhooks router

**Modified:** `src/routes/webhooks.ts` — `webhookLimiter` mounted on all routes,
`gowaTrustMiddleware` on GOWA route only

**Modified:** `.env.example` — added `TRUST_PROXY=1` with documentation

### G2-B.5 — Public PWA Contact Contract ✅

**Modified:** `src/routes/pwa.ts`:
- Removed `phoneNumber: true` from `PWA_STORE_PUBLIC_SELECT`
- Init endpoint now:
  1. Queries store with `phoneNumber` included (for internal use)
  2. Destructures `phoneNumber` out of the response `store` object
  3. Builds `contact` object: `{ channel: 'whatsapp', whatsappUrl: 'https://wa.me/<number>', displayName: store.name }`
  4. Returns `{ store, contact, vapidPublicKey }` — `phoneNumber` is NEVER
     exposed to the client (PII protection)

**Modified:** `src/pwa/src/components/ChatPage.tsx`:
- `Store` type: replaced `phoneNumber?: string | null` with
  `contact?: { channel, whatsappUrl, displayName } | null`
- CTA header: `waLink = store?.contact?.whatsappUrl || null`
  (no longer derives link from raw `phoneNumber`)

### G2-B.6 — Order Transition Invariant ✅

**Created:** `src/business/order-transition.ts` — authoritative state machine:
- `ALLOWED_TRANSITIONS`: Record of `Set<string>` per status
- `CONFIRMED_STATUSES = Set(['confirmed', 'paid'])`
- `InvalidOrderTransitionError` class
- `transitionOrder(orderId, toStatus, options)` — enforces transitions,
  sets `confirmedAt` ONLY on confirmed/paid
- `isTransitionAllowed(from, to)`, `getAllowedTransitions(from)`

**Modified:** `src/business/order.service.ts`:
- `updateOrderStatus()` delegates to `transitionOrder()` (was dead code)
- `createOrder()`: `confirmedAt: null` (was `new Date()` on draft — **FIXED**)
- `addConfirmedItemToOrder()`: `confirmedAt: null` (was `new Date()` — **FIXED**)
- `syncCartStateToDraftOrder()`: added `tx` parameter for transaction support,
  `confirmedAt: null` on draft creation

**Modified:** `src/routes/orders.ts`:
- PUT `/:id/status` routes through `orderService.updateOrderStatus`
  (was raw `prisma.order.update`)
- `InvalidOrderTransitionError` → 400 with `INVALID_TRANSITION` code
- Ownership check: `where: { id, storeId, deletedAt: null }` before transition
- Added `'confirmed'` to `VALID_ORDER_STATUSES` (was missing)

**Modified:** `src/services/chat/fast-path.ts`: `confirmedAt: ''` → `confirmedAt: null`

**Modified:** `src/business/conversation.service.ts`:
- `executeCartOps()` wrapped in `prisma.$transaction(async (tx) => ...)` — atomic
  dual-write (conversationContext.modifyCart + order.syncCartStateToDraftOrder)
- `getCartFromDb()`, `storePreviousMutation()`, `modifyCart()`, `syncCartStateToDraftOrder()`
  all accept optional `tx` parameter for transaction client propagation

**Modified:** `src/domain/types.ts`: `ConfirmedItem.confirmedAt` type widened
  from `string` to `string | null`

**Created:** `src/tests/order-transition.test.ts` (21 tests)
  - T1-T14: pure-function transition validation
  - T15-T21: database integration with state machine

**Test results:** 21/21 new tests pass. order-context integration: 15/15
(baseline was 14/15 — Test-9 `pending→confirmed` now passes).

### G2-B.7 — Security Verification ✅

| Check | Status | Evidence |
|-------|--------|----------|
| GOWA webhook spoofing | ✅ Blocked | `gowaTrustMiddleware` (loopback-only, TCP-level) |
| `device_id` not secret | ✅ Compliant | Used only for tenant store lookup, NOT auth |
| No GOWA HMAC | ✅ Compliant | Not implemented (per D3 HOLD) |
| Fonnte timing-safe | ✅ Fixed | `crypto.timingSafeEqual` for gateway number comparison (`webhooks.ts:188`) |
| PWA excludes `phoneNumber` | ✅ Fixed | Removed from `PWA_STORE_PUBLIC_SELECT`, `contact` object replaces it |
| Tenant isolation | ✅ Verified | All order queries include `storeId` filter |
| Admin auth | ✅ Verified | `adminAuthMiddleware` on all admin routes |
| Order ownership | ✅ Verified | PUT `/:id/status` checks `where: { id, storeId }` before transition |

### G2-B.8 — Regression ✅

| Suite | Baseline | After G2-B | New Tests |
|-------|----------|------------|-----------|
| Golden dataset | 17/17 | 17/17 ✅ | — |
| Pipeline (all) | 62/62 | 62/62 ✅ | — |
| Structured message | 22/22 | 22/22 ✅ | — |
| Date range | 9/9 | 9/9 ✅ | — |
| AI Gateway | — | 7/7 ✅ | +7 |
| Order transition | — | 21/21 ✅ | +21 |
| Webhook dedup | — | 9/9 ✅ | +9 |
| Order-context (Jest) | 14/15 (F-3) | 15/15 ✅ | — |
| Notification | 4/4 | 4/4 ✅ | — |
| Mission-control | — | ✅ | — |
| Jest (all suites) | 252 pass / 9 fail | 267 pass / 0 fail ✅ | F-1 + F-2 also fixed |

**Pre-existing failures RESOLVED as side effects:**
- F-1 (`engine-config-v2.test.ts` TDZ): Fixed by breaking circular dependency
  (`redis.adapter.ts` → logger directly, not via `container.ts`)
- F-2 (`reasoning-v2.test.ts` stale label): Fixed by updating mock seam + stale
  assertion (`fallback_reasoning_failed` → `reasoned` for I-V2-6 path)
- F-3 (`order-context.test.ts` Test-9): Fixed by G2-B.6 `confirmedAt` invariant

**Builds:**
- API: `tsc -p tsconfig.json` → exit 0
- PWA: `vite build` → 347.81 kB (dist generated successfully)
- Dashboard: `tsc --noEmit` → exit 0

---

## 4. Files Created

| File | Purpose |
|------|---------|
| `src/adapters/ai/llm-gateway.ts` | LLMGateway class (G2-B.1) |
| `src/business/order-transition.ts` | Authoritative order state machine (G2-B.6) |
| `src/middleware/gowa-trust.ts` | Loopback-only GOWA trust boundary (G2-B.2) |
| `src/middleware/redis-rate-limit-store.ts` | Redis-backed express-rate-limit v8 store (G2-B.4) |
| `src/tests/ai-gateway.test.ts` | Gateway behavior tests (G2-B.1) |
| `src/tests/order-transition.test.ts` | State machine transition tests (G2-B.6) |
| `src/tests/webhook-dedup.test.ts` | Redis dedup integration tests (G2-B.3) |
| `DOCS/PHASE-REPORTS/laporan-G2-B-core-hardening.md` | This report |

## 5. Files Modified

| File | Changes |
|------|---------|
| `src/adapters/ai/groq.adapter.ts` | Slimmed `generate()` — single attempt, 10s timeout, `retryable: true` (G2-B.1) |
| `src/adapters/ai/gemini.adapter.ts` | Removed unused import (G2-B.1) |
| `src/adapters/cache/redis.adapter.ts` | Added `setIfNotExists`, `getTtl`, direct logger import (breaks circular dep) (G2-B.3, G2-B.4) |
| `src/adapters/container.ts` | `ai`/`llm` objects route to `llmGateway` (G2-B.1) |
| `src/routes/admin/config.ts` | `llmGateway.getStats()/getProviders()` (G2-B.1) |
| `src/routes/webhooks.ts` | `gowaTrustMiddleware`, timing-safe comparison, `webhookLimiter` (G2-B.2, G2-B.4, G2-B.7) |
| `src/routes/pwa.ts` | `phoneNumber` removed from select, `contact` object added (G2-B.5) |
| `src/routes/orders.ts` | `orderService.updateOrderStatus` + transition error handling, `'confirmed'` status (G2-B.6) |
| `src/middleware/rate-limiters.ts` | Redis-backed per-surface limiters (G2-B.4) |
| `src/index.ts` | `TRUST_PROXY` explicit, `generalLimiter` mounted, webhook body parser (G2-B.4) |
| `src/business/conversation.service.ts` | `$transaction` wrapper for dual-write, `confirmedAt: null` (G2-B.6) |
| `src/business/conversation-context.service.ts` | `atomicCas`/`modifyCart` accept `tx` param (G2-B.6) |
| `src/business/order.service.ts` | `updateOrderStatus` → `transitionOrder`, `confirmedAt: null` on draft (G2-B.6) |
| `src/business/order-transition.ts` | `tx` type fix (G2-B.6) |
| `src/domain/types.ts` | `ConfirmedItem.confirmedAt: string → string \| null` (G2-B.6) |
| `src/services/chat/interpreter.ts` | `groqAdapter` → `llmGateway` swap (G2-B.1) |
| `src/services/chat/reasoning.ts` | `groqAdapter` → `llmGateway` swap (G2-B.1) |
| `src/services/chat/fast-path.ts` | `confirmedAt: ''` → `null` (G2-B.6) |
| `src/services/learning.service.ts` | `groqAdapter` → `llmGateway` swap (G2-B.1) |
| `src/bootstrap/scheduleFollowUps.ts` | `groqAdapter` → `llmGateway` swap (G2-B.1) |
| `src/services/message-queue.service.ts` | Redis-backed async dedup (G2-B.3) |
| `src/services/message-processor.service.ts` | `await isDuplicate(storeId, msgId)` (G2-B.3) |
| `src/tests/golden-dataset.test.ts` | Mock seam → `llmGateway` (G2-B.1) |
| `src/tests/pipeline.test.ts` | Async `isDuplicate` (G2-B.3) |
| `src/services/chat/__tests__/interpreter.test.ts` | Mock seam → `llmGateway` (G2-B.1) |
| `src/services/chat/__tests__/reasoning-v2.test.ts` | Mock seam → `llmGateway` + stale label fix (G2-B.1, F-2) |
| `apps/pwa/src/components/ChatPage.tsx` | `contact` object type + CTA (G2-B.5) |
| `.env.example` | `TRUST_PROXY=1` (G2-B.4) |

## 6. Architecture Diagram

```
                    ┌─────────────────────────────────┐
                    │  GOWA (localhost:3001, same VPS) │
                    └──────────┬──────────────────────┘
                               │  loopback only
                               │  (gowaTrustMiddleware)
                    ┌──────────┴──────────────────────┐
                    │  Express API (:3000)            │
                    │  trust proxy = 1 (CF Tunnel)   │
                    └──────────┬──────────────────────┘
         ┌──────────┬──────────┼──────────┬──────────┐
         │          │          │          │          │
    ┌────┴──┐ ┌─────┴────┐ ┌───┴───┐ ┌────┴──┐  ┌────┴────┐
    │Rate   │ │Rate      │ │Rate   │ │Rate   │  │Rate     │
    │Limit  │ │Limit     │ │Limit  │ │Limit  │  │Limit    │
    │(Redis)│ │(Redis)   │ │(Redis)│ │(Redis)│  │(Redis)  │
    └────┬──┘ └─────┬────┘ └───┬───┘ └────┬──┘  └────┬────┘
         │          │          │          │          │
    ┌────┴──────────┴──────────┴──────────┴──────────┴────┐
    │           Express Routes (generalLimiter on       │
    │           non-webhook, webhookLimiter on /gowa    │
    │           & /fonnte)                             │
    └──────────────────────────────────────────────────┘
```

## 7. Constraints Compliance

- ✅ Did NOT treat `device_id` as secret
- ✅ Did NOT invent GOWA HMAC/signature
- ✅ Did NOT add GOWA webhook secret that GOWA does not send
- ✅ Did NOT redesign Cart (G2-C deferred)
- ✅ Did NOT rewrite Conversation Engine (wrapper changes only)
- ✅ Did NOT rewrite Socket.IO
- ✅ Did NOT migrate entire database
- ✅ Did NOT break existing API compatibility (backward-compatible additions)
- ✅ Did NOT restart production PM2
- ✅ Did NOT commit (working tree left dirty with all changes)
- ✅ tsc `--noEmit` exit 0 on API + PWA + Dashboard
- ✅ All baseline suites at/exceeding counts
- ✅ `git diff --check` clean

---

## 8. Remaining Items (Future Work)

- **F-1 (pre-existing):** `engine-config-v2.test.ts` — RESOLVED as side effect of circular dep fix. The suite now passes.
- **G2-C CartAuthority:** Deferred — single order/cart authority not yet implemented.
- **`manager.ts` (dead code):** `AIProviderManager` has zero external importers. Can be
  deleted in G2-C for cleanup.
