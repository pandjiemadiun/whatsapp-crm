# G2-B — Core Hardening Architecture Review

QloBot Generation 2.0 — architecture design (read-only audit + design only; **no implementation**).

**Mode:** FORENSIC + ARCHITECTURE DESIGN ONLY. No source edits, no schema edits, no migrations, no `prisma db push`, no dependency install/update, no PM2 restart, no deploy, no commit, no git reset/checkout/clean, no working-tree mutation.

**Source of truth (read in order):**
1. `DOCS/MASTER/BLUEPRINT-QLOBOT-GENERATION-2.0.md` (623 L)
2. `DOCS/MASTER/ROADMAP-QLOBOT-GENERATION-2.0.md` (458 L, §2 G2-A exit criteria)
3. `DOCS/G2-A-baseline-report.md` (this baseline)
4. `DOCS/AUDIT/laporan-audit-backend-improvement-qlobot-vs-openship.md`
5. `DOCS/CONTRACT/contract-chatbox.md`
6. `DOCS/PROJECT/Project Context Chat QloBot.md`
7. `/home/ubuntu/garuda/marketplace` (OpenShip reference — **not** a dependency; used only as architectural reference)

**Key constraints inherited from `Project Context`:** the Conversation Engine is **not to be rewritten** (prefer WRAPPER over MODIFY ENGINE; prefer ADD over REWRITE; prefer structured data over string parsing; prefer server state over frontend logic). Safe extension areas: `routes/pwa.ts`, `routes/conversations.ts`, `apps/pwa/src/components/`, new delivery service, new realtime service, new event bus, PWA service worker.

---

## 1. Executive Summary

G2-A surfaced four structural problems. This review audits the **actual** code paths and proposes a unified hardening design for each — selecting the single healthiest option when multiple are valid, with explicit trade-offs and migration/rollback impact. **No code is changed here.**

| Problem | Root cause (actual) | G2-B recommendation |
|--------|---------------------|---------------------|
| **C2 — AI provider boundary** | Reply hot path imports `groqAdapter` **directly** (`interpreter.ts:12`, `reasoning.ts:31`); `aiProviderManager` (Gemini-primary policy) is bypassed. 3 circuit-breakers (msg-processor L1, manager L2, groq L3) + 2 retry layers (manager, groq). Golden test mocks `groqAdapter.generate` → test coupled to adapter. | Introduce **one `LLMGateway`** as the sole decision point; slim adapters to pure transport; shift golden mock seam to the gateway. |
| **C6 — Webhook security** | GOWA: no secret/HMAC, tenant from `device_id`→phone. Fonnte: `?secret` plain `===`, no `timingSafeEqual`. Global `express.json()` (no raw body). No webhook rate limit. | Per-provider verification using **each provider's supported mechanism** (no forced HMAC), plus `timingSafeEqual`, rate limit, raw-body on `/api/webhooks`, dedup-before-ack. |
| **C3 — Public PWA/PII** | `GET /api/pwa/:slug/init` returns raw `phoneNumber` (plaintext) + `id` (uncommitted `pwa.ts`); used for `wa.me/<number>`. | Replace `phoneNumber`+`id` with a structured **`contact` object** carrying a server-built `whatsappUrl`; raw E.164 never exposed. |
| **C-art-5 — Order lifecycle** | `updateOrderStatus` (L296-312) sets **only** `orderStatus` (JSDoc L294 lies about `confirmedAt`); `confirmedAt` set inconsistently in 4+ places (incl. draft creation + `fast-path.ts:375` empty-string); no state machine; dual cart/order types (draft-json vs pending-typed); non-transactional cart writes. | Define a **deterministic, idempotent state machine** + centralized timestamp authority; **Cart authority** itself stays G2-C (out of scope for G2-B). |

**P0 before commerce/order refactor:** AI decision point (affects magic-paste path) + webhook security + order-lifecycle invariants + PWA PII (already in working tree). **CartAuthority table refactor = G2-C** (G2-B only hardens invariants + transactions).

---

## 2. CURRENT ARCHITECTURE SNAPSHOT

### 2.1 Request surface (from `src/index.ts`)
```
/api/health               public (healthRouter + duplicate app.get L140)
/r/:id                    public (redirectRouter)
/api/messages             auth  (messagesRouter)
/api/faq, /api/knowledge  auth
/api/webhooks             PUBLIC (webhooksRouter: /gowa, /fonnte)
/api/auth                 public+storeAuthLimiter (authRouter)
/api/dashboard            auth (metricsRouter)
/api/whatsapp             auth (whatsappRouter — GOWA outbound send)
/api/conversations        auth (conversationsRouter)
/api/orders               auth (ordersRouter)
/api/settings/profile/bank-accounts/sop   auth
/api/admin/*              adminAuth (+ super_admin for mission-control)
/api/products             auth (storeProductsRouter — owner CRUD)
/api/stores/:storeId/products  PUBLIC catalog (productsRouter mounted at /api) ← public products
/api/analytics            auth
/api/pwa/:slug/*          PUBLIC (pwaRouter)
```
Middleware order (`index.ts`): `express.json()` (L77, global) → `cors({origin: corsAllowedOrigins})` (L86) → `requestId` → `maintenanceMode` → route mounts. **No `helmet`** anywhere; **no `express.raw`** (raw body not preserved on webhook path); `generalLimiter` defined in `rate-limiters.ts` but **NOT mounted**.

### 2.2 Data surface (cart/order) — see G2-A §5
- `schema.prisma`: **no `Cart`/`CartItem` table**. Cart = `Order.items` JSON (draft) + `ConversationContext.extractedEntities` JSON. `OrderItem` (strongly typed) used only by catalog `createOrder`.
- **Dual writer:** `addConfirmedItemToOrder`/`syncCartStateToDraftOrder` (order.service.ts:39/111) write `confirmedItems` to `Order.items`; `modifyCart` (conversation-context.service.ts) writes to `extractedEntities`. Reader: `getCartFromDb` (conversation.service.ts:926).
- Live canary state: 15 orders (drafts + 6 duplicate `pending` carts with identical lowercase `[wortel,kangkung,kentang]` blobs); 0 `OrderItem` rows.

### 2.3 AI surface — see G2-A §6
- Hot path: `message-processor.processMessage` → `conversationService.processCustomerMessage` → `interpreter.reproduce`/`reasoning.generate` → **`groqAdapter.generate` directly** (`interpreter.ts:12,88`; `reasoning.ts:31,115`). Bypasses `aiProviderManager`.
- `aiProviderManager` (Gemini-primary/Groq-fallback; breaker thresh 5 / 60 s; Redis cooldown 5 min) used **only** by `adapters/container.ts ai.generate` → `product.service.ts:721` (magic-paste) + dead `message.handler.ts` stub.

---

## 3. AI PROVIDER REVIEW

### 3.1 Current

**INPUT** → `POST /pwa/:slug/message` (pwa.ts:164, `conversationLimiter`) / GOWA/Fonnte webhook → `messageProcessorService.processMessage`
→ `message-processor L218`: circuit breaker gate (`llmCircuitBreaker.isAvailable()`, thresh **2**) — if open → hardcoded apology + `human_takeover` (L250, L503).
→ `message-processor L256`: `llmCircuitBreaker.wrap(() => conversationService.processCustomerMessage(...))`
→ `conversationService.processCustomerMessage` → pipeline: normalizer → tier-match (fast-path, 0 LLM) → interpreter (≤1 LLM) → reasoning.
→ `interpreter.ts:88` / `reasoning.ts:115`: **`groqAdapter.generate(prompt)` DIRECT** (10 s timeout, maxRetries=5 key rotation inside adapter; "timeout not retryable within adapter — manager handles fallback" groq.adapter.ts:227).
→ **No hard engine turn-deadline is enforced.** `LLM_TIMEOUT_MS = 12_000` + `timeout()` helper (message-processor:32, :69) are **defined but unused (dead code)** — only groq's 10 s per-attempt timeout applies (groq.adapter.ts:13), and groq's internal `maxRetries=5` key-rotation could let a stuck provider consume up to ~50 s on the hot path.
→ response: `ResponseResult` (text + structured payload) → `conversation-delivery` (persist + emit `message.created`).

**Failure path today:** groq `generate` fails → `message-processor.recordFailure()` (L266) → after 2 fails breaker trips → apology + `human_takeover` (HARD RULE #5). The `aiProviderManager` retry/fallback (Gemini) is **never reached** on this path.

**Decision point TODAY = none** — each consumer calls an adapter directly. Three decision points exist in parallel and they disagree:
- `groq.adapter.ts` internal retry (key rotation, 5) — transport layer.
- `ai/manager.ts` breaker (5/60 s) + Gemini→Groq fallback — but bypassed by hot path.
- `message-processor` breaker (2) + apology-orchestration — wraps the engine call.

This is the "duplicate circuit breaker / duplicate retry / timeout layering / provider-specific assumptions / test coupling" the brief asks to find. Confirmed.

**Direct provider imports (all of them):**
- `interpreter.ts:12` import `groqAdapter`
- `reasoning.ts:31` import `groqAdapter`
- `adapters/container.ts:9` import `aiProviderManager`/`groqAdapter`? (container is the gateway facade for magic-paste)
- `services/chat/engine-config.ts`? (not a provider import)

**`aiProviderManager` consumers (all of them):**
- `adapters/container.ts:31` `aiProviderManager.generate` → `product.service.ts:721` (magic-paste)
- `adapters/container.ts:33` `aiProviderManager.extractIntent`
- `adapters/llm.chat` (dead stub) → `message.handler.ts` (0 consumers)
- `admin/config.ts:27/84` `getStats`/`getProviders` (read-only admin view)

**Test coupling:** `golden-dataset.test.ts:251` `(groqAdapter as any).generate = mockGenerate` — mocks the **concrete adapter**, because the engine imports it directly. Moving the engine to a gateway will shift this seam (see §3.4).

### 3.2 Problems

| # | Problem | Where | Impact |
|---|---------|-------|--------|
| A-1 | **No single decision point** — engine calls `groqAdapter` directly | interpreter.ts:88, reasoning.ts:115 | Gemini-primary policy is dead on the reply path; policy drift silently |
| A-2 | **Duplicate circuit breaker** — msg-processor(2) + manager(5) + groq-adapter none-but-retry | message-processor:77, manager:22 | conflicting trip thresholds; hard to reason / tune |
| A-3 | **Duplicate retry** — groq internal key-rotation(5) vs manager fallback | groq.adapter.ts:76, manager | retries not coordinated; "All Groq keys in cooldown" never triggers manager fallback on hot path |
| A-4 | **Timeout layering** — 10 s transport (groq `REQUEST_TIMEOUT_MS:13`) vs 12 s intended turn budget (`LLM_TIMEOUT_MS:32`, **UNUSED / dead code**) vs 10 s per-attempt `AbortSignal` | groq:13, message-processor:32 | no enforced turn deadline; 5×10 s = up to ~50 s possible on a stuck provider |
| A-5 | **Provider-specific assumption** — interpreter/reasoning assume a JSON schema from Groq; no adapter abstraction | interpreter.ts, reasoning.ts | swapping provider = code change in engine |
| A-6 | **Test coupling to concrete adapter** | golden-dataset:251, interpreter.test, reasoning-v2 | mock target = adapter, not an interface |
| A-7 | **Gatekeeper `extractIntent` vs reply `generate`** — both on groqAdapter, but only `generate` is on the hot path; intent path uses manager.extractIntent (container.ts:33) — inconsistent | manager.ts:53, container.ts:33 | two different code paths to the same provider |
| A-8 | **Dead code / no turn deadline** — `LLM_TIMEOUT_MS=12_000` + `timeout()` helper exist but are never wired (no `Promise.race`/`timeout(LLM_TIMEOUT_MS)` call); `aiProviderManager` breakers (L72-168) also never reached from hot path | message-processor:32, :69, manager:22 | silent unbounded retry budget; unmaintainable dead code |

### 3.3 Option A — Minimal safe fix (stepping-stone)
Redirect **only** the import: `interpreter.ts`/`reasoning.ts` call `aiProviderManager.generate` instead of `groqAdapter.generate`. One-line each.
- ✅ Instantly enforces Gemini-primary/Groq-fallback on replies; reuses existing breaker (5)/cooldown/rotation.
- ❌ Leaves **duplicate breaker** (manager 5 + message-processor 2); leaves **test-coupling** (golden mocks `groqAdapter.generate`, now behind the manager — the mock would no longer intercept unless it patches the manager's primary provider; could quietly make the golden dataset call the real provider).
- ❌ Adapters still embed retry/circuit (A-3/A-4) — the gateway can't fully own the layering.
- Best as a **diagnostic** before the real refactor; not the end state.

### 3.4 Option B — Proper Gen-2 `LLMGateway` (RECOMMENDED)

Introduce **one** new module `adapters/ai/llm-gateway.ts` (safe extension area: `adapters/ai`). It is the **sole** AI decision point and owns policy; the two adapters become **pure transport**.

```
LLMConsumer (interpreter/reasoning/magic-paste/message-processor)
   │  ONE call:  llmGateway.generate(prompt, opts)   /  .extractIntent(...)
   ▼
LLM Gateway  (NEW: single decision point — owns POLICY)
   │  provider selection  (primary=Gemini, fallback=Groq, gatekeeper=Groq intent)
   │  retry              (transport 429/rate-limit/timeout, N=3, exp backoff, key rotation)
   │  circuit-breaker    (ONE per provider, thresh 5, reset 60 s, Redis cooldown 5 min)
   │  timeout            (per-attempt 10 s via AbortSignal; overall 12 s turn-deadline via `LLM_TIMEOUT_MS` — enforced by the gateway, replacing the currently-dead message-processor timeout)
   │  fallback           (primary→fallback→gatekeeper-default-intent; then error)
   │  health/stats       (isHealthy, getProviders, getStats — reused by /admin/config + /api/health)
   ▼
GroqAdapter / GeminiAdapter   (SLIM: pure HTTP POST + 10 s AbortSignal; list-models isHealthy)
```

**Layer ownership (answer to "mana layer bertanggung jawab"):**
- **Provider selection** = `LLMGateway` (reads `GROQ_API_KEYS[]` list + rotation; `GEMINI_API_KEY`).
- **Retry** = `LLMGateway` (transport-level 429/timeout; N=3, jittered exp backoff) + adapters NO retry (return raw failure).
- **Timeout** = transport adapter (10 s per HTTP call via `AbortSignal`) + gateway (overall deadline). One rule: adapter = per-attempt 10 s; gateway = retry policy + total budget.
- **Circuit breaker** = **ONE**, in `LLMGateway`, shared per provider via `provider-cooldown.ts` (Redis, 5 min) and in-memory breaker (thresh 5, reset 60 s). The `message-processor`'s L1 breaker (thresh 2) is **removed**; its human-takeover orchestration stays but **delegates** the LLM call+circuit to the gateway (it just catches the gateway's `AIProviderError`/`CircuitOpenError` and converts to apology+handoff). This collapses 3 breakers → 1.
- **Fallback** = `LLMGateway` (primary→fallback); gateway then **throws**; `message-processor` catches **only** to escalate to human takeover (HARD RULE #5). The groq adapter no longer "decides" to fall back (the "All keys in cooldown → manager fallback" comment becomes redundant).

**Engine changes (WRAPPER, not MODIFY ENGINE):** interpreter.ts & reasoning.ts swap `import { groqAdapter }` → `import { llmGateway }` and call `llmGateway.generate(...)`. The interpreter/reasoning **logic** (prompts, JSON schema, validation, staging) is untouched — only the **seam** changes. This is explicitly the "WRAPPER > MODIFY ENGINE" principle from `Project Context`.

**OpenShip comparison:** marketplace has **no AI/LLM/provider abstraction** (grep for groq/gemini/llm/provider in marketplace found only `paymentProviders` unrelated). → **IGNORE** for AI. QloBot is the owner of its AI architecture; do not copy OpenShip here.

**Trade-off:** Larger than Option A (new file + 2 import swaps + slim 2 adapters + shift golden mock seam). But it removes **all 7** problems (single decision point, single breaker, single retry policy, clear timeout layering, adapter abstraction, decoupled tests). **Recommended** because C2 is a correctness problem (wrong provider on the reply path) and A-6 blocks future provider swaps and honest golden testing.

**Test-matrix impact (design only):** golden mock seam moves `groqAdapter.generate` → `(llmGateway as any).generate = mockGenerate` (or inject a fake gateway). The 17 scenarios/assertions are **unchanged**; only the seam. Regression: golden must remain 17/17. New tests (§13) cover provider selection/retry/circuit/timeout/fallback at the gateway, not via the adapter.

**Migration risk:** Low-medium. No DB. Risk = golden mock seam must be updated in lockstep with the import swap, else golden calls the real provider (cost). Mitigate: keep `LLMGateway` importing the same adapters; ship behind a feature flag (`AI_GATEWAY=true`) defaulting off, flip in deploy (no restart risk). Rollback = unset flag → adapters direct (revert).

**Answer — "Di satu titik mana keputusan provider seharusnya dibuat?"**
> Exactly one: `LLM Gateway.generate(prompt, opts)`. Every consumer (interpreter, reasoning, magic-paste, message-processor) calls the gateway by interface; the gateway alone chooses provider, retries, trips the circuit, and cascades fallback. Consumers only decide "I need an LLM" and "how to escalate if it fails" (human takeover). Adapters = dumb transport.

---

## 4. WEBHOOK SECURITY REVIEW

### 4.1 GOWA
| Aspect | Current | Supported security mechanism | Proposed |
|--------|---------|------------------------------|----------|
| Auth/secret | **none** — inbound webhook has no secret; tenant derived from `device_id` | GOWA gateway (outbound, `gowa.adapter.ts`) is **outbound-only** with Basic-Auth `GOWA_BASIC_AUTH_USER/PASS` for *sends*; the **inbound** GOWA flow provides **no signature/HMAC** (verified by code: webhooks.ts GOWA branch parses `device_id` + `message` only) | **Shared device secret (not HMAC).** Store each GOWA device with a per-store `deviceId`/token server-side (`storeSetting` or a `GowaDevice` registry); on inbound, resolve device → store, then `timingSafeEqual(device_id, registeredDeviceId)`. Reject unknown devices (401). Do **not** force HMAC — GOWA does not send one. |
| Tenant resolution | `device_id` → `store.phoneNumber` (webhooks.ts L52-63) | same | keep (now gate on verified device) |
| Replay | 5-min `messageId` dedup queue | `messageId` present in payload | move dedup to a **Redis SET `gowa:{messageId}` TTL 300s**, checked **before** 200-ack (see §4.3) |
| Rate limit | none | — | per `device_id`: 60 req/10 min |
| Ack | 200 **before** process | — | dedup synchronously then ack (still 200-before-process for GOWA's timeout, but dedup runs first) |

### 4.2 Fonnte
| Aspect | Current | Supported security mechanism | Proposed |
|--------|---------|------------------------------|----------|
| Auth/secret | `?secret=` query, plain `===`, matched to `Store.webhookSecret` (schema.prisma:33) | Fonnte webhook delivers the merchant's configured secret **in the registered callback URL** (`?secret=`) — no native HMAC header | Keep `?secret` (Fonnte's only mechanism) but verify with `crypto.timingSafeEqual` (constant-time). Move secret out of query when possible: support an **optional** `X-Fonnte-Signature` header if the platform forwards it, but **do not require** it (Fonnte doesn't send it). |
| Tenant resolution | `sender` phone → store | same | keep; resolve sender phone → store via `customerPhone`/`phoneNumber` index |
| Replay | 5-min `messageId` dedup | `messageId` present | Redis SET `fonnte:{messageId}` TTL 300s, dedup-before-ack |
| Rate limit | none | — | per `sender`: 60 req/10 min |
| Raw body | global `express.json()` consumes body | — | mount `express.raw({type:'application/json'})` on `/api/webhooks` only, **before** json, so future HMAC is possible without re-arch |

### 4.3 Proposed unified webhook pipeline
```
POST /api/webhooks/:provider        (express.raw — preserve raw body)
   │  1. parse JSON from raw (provider-specific shape)
   │  2. authenticate:  GOWA → device-secret (timingSafeEqual);  Fonnte → ?secret (timingSafeEqual)
   │     └─ reject 401 if unknown/missing
   │  3. tenant resolution:  secret→device→store  OR  secret→Store.webhookSecret
   │  4. replay:  messageId ∈ Redis SET(key) → 409 dup; else SADD+TTL(300s)   (dedup BEFORE ack)
   │  5. rate-limit:  per-device/sender token bucket 60/10min
   │  6. acknowledge 200 to provider (before processing)            ← keeps GOWA's timeout contract
   │  7. enqueue processMessage (idempotent) for async processing
```
**Failure behavior:** auth failures → 401/403 (no processing); replay → 409 (no processing); rate-limit → 429; processing failure → 500 (provider retries per its contract) but **dedup already committed** so the retry is deduped to a no-op.

**Why not force HMAC on both:** GOWA has no inbound signature mechanism (adapter is outbound-only; inbound shape carries no signature field). Fonnte's only secret transport is the callback URL query. Forcing a header HMAC would **silently drop all real webhooks**. The brief explicitly forbids forcing HMAC where the provider doesn't support it. Shared-secret + constant-time compare + timestamp/nonce replay window + raw-body readiness is the correct, provider-honest hardening.

**OpenShip:** marketplace has **no webhook signature/HMAC/secret** pattern (grep empty). → **IGNORE** for webhooks. QloBot owner of its webhook security.

---

## 5. PUBLIC PWA/API CONTRACT REVIEW

### 5.1 Current
`GET /api/pwa/:slug/init` (pwa.ts, public, no auth) — uncommitted working-tree change adds `id: true` and `phoneNumber: true` to the select. Verified live: response includes `phoneNumber: "6282147128277"` (plaintext) and the PWA renders `<a href="https://wa.me/6282147128277">`. `vapidPublicKey` returns `false` (no VAPID keys in `.env` → Web Push disabled, graceful degrade). `GET /stores/:storeId/products` is **public** (catalog). `GET /pwa/:slug/history?uid=` is public and returns `200 {history:[]}` even for unknown uids (no 404) — acceptable for anonymous web.

### 5.2 PII risk
`phoneNumber` is the merchant's **WhatsApp business number** — inherently contactable (WhatsApp is the primary channel, per Project Context). But exposing the **raw E.164** on an unauthenticated public endpoint enables enumeration/scraping, and returning the internal `id` (PK) aids store enumeration. Risk: MEDIUM-high (contact/info disclosure + enumeration). The number is not the customer's PII; it is the *merchant's* public contact — so "leak" = "easy scrape of merchant phone list", not a customer-data breach. Still, the public init should not hand out raw phone numbers.

### 5.3 Options
| Opt | Shape | Verdict |
|-----|-------|---------|
| A `public whatsappUrl` | replace `phoneNumber` with `whatsappUrl: "https://wa.me/<num>"` | Hides raw E.164; cacheable per slug; trivial href. But number still derivable from the URL. |
| B `public contact object` | `contact: { channel:'whatsapp', whatsappUrl, displayName?, type:'business' }` | Future-proof (more channels later); clean; single surface. |
| C `public phoneNumber` (current) | raw E.164 | ❌ PII-ish exposure, enumeration |
| D backend redirect/action | `GET /api/pwa/:slug/whatsapp` → 302 to wa.me (or JSON `{whatsappUrl}`); server resolves number from slug | Enables click analytics + TTL/rotation + rate-limit + audit log |
| E combo | `contact` object **on init** + **redirect endpoint** for clicks | Strongest |

### 5.4 Recommended contract
**Option E (combo) — recommended.** Two changes, both no schema:

1. **`/api/pwa/:slug/init`** response:
   ```diff
   - id: string
   - phoneNumber: string        // raw E.164 — REMOVED
   + contact: {
   +   channel: 'whatsapp',
   +   whatsappUrl: string,     // server-built https://wa.me/<num>  (NOT raw number)
   +   displayName?: string,    // store name
   + }
   ```
   The raw `phoneNumber` and internal `id` are **never** returned on the public endpoint. The frontend uses `contact.whatsappUrl` for the `wa.me` button (button preserved — WhatsApp stays the primary channel). Store id is resolved **server-side** by slug.
2. **New optional redirect:** `GET /api/pwa/:slug/whatsapp/contact` (public, rate-limited) → `302` to `wa.me/...` (or JSON `{whatsappUrl}`). Frontend links the **button** to this endpoint (not the raw URL). Benefits: click analytics (count), abuse rate-limit, future TTL/rotation, audit trail.

**Evaluation against criteria:**
- *Privacy:* raw E.164 removed from init; link still resolves (merchant chose WhatsApp as primary channel) but surface reduced + auditable. ✅
- *API cleanliness:* one `contact` object; no leaked PK. ✅
- *Caching:* `contact` is per-slug, immutable per store → easily cached (CDN/edge). ✅
- *Frontend simplicity:* `href={data.contact.whatsappUrl}` (or the redirect endpoint). ✅
- *Merchant identity:* display name preserved in `displayName`. ✅
- *Future analytics:* redirect endpoint gives click metrics; channels can extend later. ✅
- *Abuse risk:* rate-limited redirect; number not scrapable from bulk init. ✅

---

## 6. ORDER LIFECYCLE REVIEW

### 6.1 Current state machine (observed writers)
States present in schema comment (`schema.prisma` `orderStatus` default/pseudo-enum) and in code:
`draft | waiting_address | waiting_payment | paid | packing | shipped | pending | cancelled | completed | refunded` (note: `pending` listed mid-stream and `confirmed` absent from the comment though Test-9 uses `confirmed` — schema/docs already drift).

**Actual writers (grep across `src/`, excl. tests):**
| Transition | Writer | Path |
|---|---|---|
| (none)→**draft** | `order.service.ts:58` `addConfirmedItemToOrder`; `order.service.ts:137` `syncCartStateToDraftOrder` | conversational cart (one active draft per conversation) |
| **draft**→**waiting_address** | `order.service.ts:168` `finalizeDraftOrder` (`updateMany` — multi-row risk) | `conversation.service.ts:779` on done-ordering signal |
| (none)→**pending** | `order.service.ts:257` `createOrder` (catalog, typed `orderItems`) | admin/catalog checkout |
| **pending**→?** (add/remove)** | `addOrderItem`/`removeOrderItem` validate `status==='pending'` (`order.service.ts:319,367`) | catalog order item CRUD |
| **any**→**{status}** | `routes/orders.ts:94` inline `prisma.order.update({data:{orderStatus}})` — raw, **bypasses OrderService** (no validation/timestamp/authorship) | admin dashboard PUT `/orders/:id/status` |

> NOTE: `order.service.ts:296 updateOrderStatus` is **dead code** (zero callers). The only live admin status write is the inline `orders.ts:94`. The OrderService layer is therefore bypassed on the admin path.
> `fallback.service.ts:658` is a **read** of the active draft (`findFirst({orderStatus:'draft'})`), not a writer of statuses.

**No** engine transition for `waiting_address→paid`, `paid→packing`, `shipped→completed`, or any `→confirmed`. The engine only owns **draft→waiting_address**. Admin progression is via the **inline raw** `prisma.order.update` at `orders.ts:94` (no validation/timestamp). `order.service.ts:296 updateOrderStatus` is **dead code** (zero callers) — the live admin path bypasses the OrderService layer entirely.

**`confirmedAt` writers (the drift bug family):**
- `order.service.ts:61` — set on `addConfirmedItemToOrder` draft creation (`item.confirmedAt ?? now()`) — **premature** (draft ≠ confirmed).
- `order.service.ts:141` — set on `syncCartStateToDraftOrder` draft creation (`new Date()`) — **premature**.
- `conversation-context.service.ts:326,336` — per-item `confirmedAt` in the extraction blob.
- `fast-path.ts:375` — sets `confirmedAt: ''` (empty string!) on a price-quote fast path — **data anomaly**.
- `domain/types.ts:198` `confirmedAt: Date | null` (OrderWithItems); `:250` `confirmedAt: string` (ConfirmedItem blob).

`updateOrderStatus` (order.service.ts:296) is **dead code** (zero callers). The **live** admin `→confirmed` path is the inline `prisma.order.update({data:{orderStatus}})` at `orders.ts:94` — which also sets **only** `orderStatus`, never `confirmedAt`. The JSDoc at order.service.ts:294 ("Jika status 'confirmed', set confirmedAt") is **a lie** on both paths. → Test-9 fails (`confirmed.confirmedAt` null); production admin confirmation also loses `confirmedAt`.

### 6.2 Invariants that should hold (and which are violated)
| # | Invariant | Current | Violated? |
|---|-----------|---------|-----------|
| I-1 | Exactly one active cart (draft) per conversation | `findFirst({conversationId, orderStatus:'draft'})` (L47/119) — but `addConfirmedItemToOrder` and `syncCartStateToDraftOrder` **both** run in the same turn? No — only one is called per path. But `finalizeDraftOrder` uses `updateMany` (could hit multiple drafts). Live canary shows 6 duplicate pending carts → I-1 weak at best. | ✅ partially |
| I-2 | `confirmedAt` set iff order reaches a confirmed/paid/terminal state, exactly once | Set on DRAFT creation (wrong); NULL on `→confirmed` (wrong); empty-string in fast-path | ✅ VIOLATED |
| I-3 | Exactly one authority writes each timestamp | confirmedAt written by 4+ paths (order.service:61,141; conversation-context:326,336; fast-path:375); admin path (orders.ts:94) writes **none** | ✅ VIOLATED |
| I-4 | Cart ops are atomic (dual-write of `extractedEntities` + `Order.items` consistent) | `executeCartOps` (L884) writes `modifyCart` then `syncCartStateToDraftOrder` with **no transaction** | ✅ VIOLATED |
| I-5 | Idempotent status transitions | raw `orders.ts:94` `prisma.order.update` accepts any status; `finalizeDraftOrder` uses `updateMany` (multi-row risk); dead `updateOrderStatus` | ✅ VIOLATED |
| I-6 | `addOrderItem`/`removeOrderItem` operate on the cart | guarded `status==='pending'` (catalog order), but conversational cart is `draft` → mismatch | ✅ VIOLATED |

### 6.3 Gen-2 State Machine (recommended)

```
[no order] ─addConfirmedItem / syncCart → DRAFT            (engine/cart-authority; confirmedAt NOT set)
   DRAFT ─done-ordering ─────────────────→ WAITING_ADDRESS   (confirmedAt NOT set)
   WAITING_ADDRESS ─customer address given ─→ AWAITING_PAYMENT
   AWAITING_PAYMENT ─payment confirmed ──────→ PAID          (confirmedAt = now(), idempotent, ONE place)  ← fixes Test-9
   PAID ─pack → PACKING ─ship → SHIPPED ─complete → COMPLETED
   (cancelled | failed | refunded) available before SHIPPED (cancelled/refunded also after COMPLETED)
```

**Rules (centralized in an `OrderAggregate.transition(orderId, to, actor)`):**
- **Allowed transitions only** (table enforced in code; arbitrary `orders.ts:94` raw status set replaced by the transition validator).
- **Timestamp authority** = the transition function: `confirmedAt` set **iff** target is `PAID` (or an explicit `confirmed` admin action maps to PAID); set once; re-asserting PAID is a no-op (idempotent). Remove the premature `confirmedAt` writes in draft creation (order.service:61,141) and the `fast-path.ts:375 ''` anomaly.
- **Writer roles:** DRAFT/WAITING_ADDRESS/AWAITING_PAYMENT = engine (cart-authority, G2-C); PAID = payment webhook/admin; PACKING/SHIPPED/COMPLETED/CANCELLED/REFUNDED = admin (dashboard). Each transition records `actor`.
- **Transaction:** cart mutations (`executeCartOps`: `modifyCart` + `syncCartStateToDraftOrder`) wrapped in `prisma.$transaction` so the dual-write is atomic (until G2-C single authority removes the dual-write).
- **Dedup:** `finalizeDraftOrder` → `updateMany` over drafts is fine only if I-1 holds; Gen-2 single-cart-authority ensures one draft per conversation, so use `update` on the single active draft (not `updateMany`).

**OpenShip:** marketplace `cart-tools.ts` has a clean **Cart entity with `cartId` + payment providers (Stripe/PayPal)** — a relevant *reference* for a dedicated cart model, but QloBot's domain (Indonesia WhatsApp chat-commerce, `wa.me` contact, Bahasa) differs. → **REUSE the concept** (separate Cart entity, payment-provider abstraction) for G2-C cart-authority; **do not copy**.

---

## 7. OPENSHIP COMPARISON

`marketplace` is a **Next.js 15** e-commerce marketplace (separate git repo, own commits, untracked from garuda root). Used as reference only.

| Concern | QloBot current | OpenShip marketplace | Verdict |
|--------|----------------|----------------------|---------|
| AI / LLM provider abstraction | 3-layer mess (direct groq import + manager bypassed) | **none** (no groq/gemini/llm in codebase; only `paymentProviders`) | QloBot owns AI arch; **IGNORE** OpenShip for AI |
| Webhook security | GOWA no HMAC; Fonnte `?secret` plain `===` | **none** (no webhook/HMAC/secret pattern) | QloBot owns webhook security; **IGNORE** |
| Cart model | `Order.items` JSON + `extractedEntities` JSON, dual-writer, fuzzy names, no Cart table | Dedicated **Cart entity with `cartId`** + payment-provider abstraction (`cart-tools.ts`) | **REUSE concept** (Cart entity + payments) for G2-C; QloBot domain differs (WhatsApp/Indonesia) |
| Realtime (Socket.IO) / EventBus | in-proc (no Redis adapter) | N/A (Next.js, not realtime chat) | N/A |
| PWA | custom `apps/pwa` (vite) | N/A | N/A |

Conclusion: OpenShip has **no directly reusable** AI/webhook/realtime patterns. Only the *concept* of a structured Cart entity is referenced, and that is a **G2-C** concern (out of scope for this G2-B review).

---

## 8. G2-B SCOPE

Classify against the four G2-A problems + Project Context ("don't rewrite engine; prefer wrapper/add").

### P0 — must fix before commerce/order refactor (blockers)
- **C2 AI decision point** — wrong provider silently active on replies; blocks any AI cost/policy guarantee. (G2-B)
- **C6 Webhook security** — unauthenticated inbound messages drive the full engine + payment/cart paths on production. (G2-B)
- **Order lifecycle invariants** (`confirmedAt` not set on `→confirmed`; dead `updateOrderStatus` + inline raw `orders.ts:94` bypasses OrderService/timestamp; dual-writer non-transactional) — data correctness; directly causes Test-9 failure. (G2-B)
- **C3 PWA PII** (`phoneNumber`/`id` on public init) — already in working tree, security exposure. (G2-B)

### P1 — should fix during G2-B
- Consolidate the 3 circuit breakers → 1 (in gateway); remove `message-processor` L1 breaker duplication. (G2-B, AI)
- `express.raw` on `/api/webhooks`; webhook rate limiter mount. (G2-B, webhooks)
- Wrap cart dual-write in `prisma.$transaction`; deprecate premature `confirmedAt` writes + fast-path `''`. (G2-B, order/cart invariants)
- Golden mock-seam shift (`groqAdapter.generate` → `llmGateway.generate`). (G2-B, test)

### P2 — defer to G2-C or later
- **CartAuthority** refactor: dedicated `Cart`/`CartItem` table, single writer, eliminate dual-write, strong product identity (SKU). (G2-C — explicitly **JANGAN implementasi di G2-B**)
- Order state machine enforcement via dedicated `OrderAggregate` + event sourcing is G2-C; G2-B only defines the target + invariants.
- Multi-instance Realtime (Redis adapter for EventBus/Socket.IO). (G2-C/P4)
- PWA service-worker push / VAPID setup (enable VAPID keys in env). (G2-C/P2)

### P3 — don't touch in G2-B
- Conversation-engine internals: `interpreter.ts` logic, `reasoning.ts` logic, `normalizer`, `tier-match`, `pendingClarification`, `composer-v2`, `workspace`, `fast-path` intent logic (only the `confirmedAt:''` anomaly at fast-path.ts:375 is removed, not the logic).
- `fallback.service.ts` cart write (defer to cart-authority).
- Dashboard UX polish.

---

## 9. FILE IMPACT (NO CHANGES MADE — design only)

| Area | Files in scope (design) | Schema? | Behavior change |
|------|--------------------------|---------|-----------------|
| AI Gateway | `adapters/ai/llm-gateway.ts` (NEW); `groq.adapter.ts`, `gemini.adapter.ts` (slim); `services/chat/interpreter.ts`, `services/chat/reasoning.ts` (import seam only); `adapters/container.ts` (route to gateway); `src/tests/golden-dataset.test.ts` (mock seam) | No | Yes (policy actually enforced) |
| Webhooks | `routes/webhooks.ts`; `index.ts` (raw-body mount); `middleware/rate-limiters.ts` (webhook limiter); `services/message-queue.service.ts` (dedup) | No | Yes (auth now enforced) |
| PWA PII | `routes/pwa.ts`, `apps/pwa/src/components/ChatPage.tsx`, `apps/pwa/src/services/api.ts` | No | Yes (init shape) |
| Order lifecycle | **consolidate** admin status write: remove dead `order.service.ts:296 updateOrderStatus`; replace inline `orders.ts:94` raw update with `OrderAggregate.transition` validator; remove premature `confirmedAt` (order.service:61,141); `conversation-context.service.ts` per-item `confirmedAt`; `services/chat/fast-path.ts:375` (`''`); `conversation.service.ts` `executeCartOps` `$transaction` | No | Yes (Test-9 fixed → 15/15) |

---

## 10. DATABASE / MIGRATION IMPACT (NONE in G2-B; design only)

- **AI gateway:** no DB. Provider keys stay in env (`GROQ_API_KEYS`, `GEMINI_API_KEY`).
- **Webhooks:** no DB. `Store.webhookSecret` (schema.prisma:33) already exists for Fonnte. GOWA device-secret would add a row to an **existing** `storeSetting` key (no new table) — optional, no migration.
- **PWA PII:** no DB; only response field rename on `pwa.ts` select.
- **Order lifecycle:** `orderStatus` is a `String` (not an enum) — **no schema/migration**. The state machine is enforced in code. `confirmedAt`/`createdAt` columns already exist.
- **CartAuthority (G2-C, NOT G2-B):** the *only* part that would need schema is the G2-C Cart/CartItem table — explicitly deferred. G2-B touches **none** of it.
- Data migration: minimal — backfill `Order.confirmedAt` only for rows whose status is genuinely `paid`/`completed` (currently canary has 0 such rows → trivial). No downtime, no backfill of draft carts.
- Rollback: each area is independently toggleable (AI via `AI_GATEWAY` flag; webhook auth can reject-open behind flag; PWA field rename is additive if `phoneNumber` kept as deprecated alias during cutover).

---

## 11. API CONTRACT IMPACT

| Endpoint | Change | Break? | Migration |
|----------|--------|--------|-----------|
| `POST /pwa/:slug/message` | none (contract intact) | No | — |
| `GET /pwa/:slug/init` | `phoneNumber`+`id` → `contact{whatsappUrl,displayName,channel}` | **Yes (field rename)** | keep `phoneNumber` as deprecated alias for 1 sprint; cutover |
| `GET /pwa/:slug/history` | none | No | — |
| `GET /stores/:storeId/products` | none (public) | No | — |
| `POST /api/webhooks/gowa` | now requires valid device-secret → 401 on missing/weak | **Yes (401 on forged)** | merchants register device token (one-time setup) — acceptable |
| `POST /api/webhooks/fonnte` | `?secret` now constant-time; 401 on mismatch | **Yes (401)** | merchants re-confirm callback URL secret |
| `PUT /api/orders/:id/status` (currently inline `prisma.order.update` at `orders.ts:94`) | restricted to allowed transitions; `confirmed`/`paid` sets `confirmedAt` | **Yes (stricter)** | dashboard must send allowed status; map `confirmed`→`PAID` |
| `GET /api/admin/config`, `/api/admin/health` | gateway exposes provider stats (unchanged shape) | No | — |

---

## 12. FRONTEND IMPACT

- **PWA `ChatPage.tsx`/`Composer.tsx`/`CartSummary.tsx`:** use `data.contact.whatsappUrl` for the WhatsApp button (or the redirect endpoint). Remove any reliance on `phoneNumber`/`id`. Empty-state cart/conversation UI unchanged.
- **Dashboard:** status dropdown must reflect the new allowed transitions (remove free-text `confirmed` if mapped to `PAID`); `confirmedAt` column now populated on paid orders.
- **Real-time:** no contract change (events, rooms, dedup unchanged) — gateway is server-side only.

---

## 13. TEST MATRIX

### Regression (must stay green after G2-B — baseline = G2-A)
| Suite | Baseline | Assert on |
|-------|----------|-----------|
| golden-dataset | 17/17 | unchanged scenarios; mock seam moves to gateway |
| pipeline (+edge) | 62/62 | — |
| structured-message | 22/22 | — |
| date-range | 9/9 | — |
| order-context.integration | 14/15 → **expect 15/15** (Test-9 fixed) | `OrderAggregate.transition('confirmed'→'PAID')` sets `confirmedAt` (Test-9 calls `updateOrderStatus`; impl routes through validator) |
| notification.service | 30/30 | — |
| realtime contract | green | — |
| PWA browser baseline | 16 screenshots, 0 errors | **re-capture after init shape change** (contact object) |

### New tests for G2-B (design only — not written)
| Area | Test | What it proves |
|------|------|----------------| 
| **AI gateway** | provider-selection: primary fails → fallback invoked | policy actually enforced on reply path |
| | provider-selection: primary succeeds → primary used, no fallback | no wasted calls |
| | retry: 429/timeout → N=3 exp backoff | single retry policy |
| | circuit: ≥5 fails → breaker trips → `CircuitOpenError` (not a retry storm) | single breaker |
| | timeout: 10 s AbortSignal → fail fast | layered timeout |
| | fallback: all providers down → default intent (no crash) | graceful degradation |
| | **no direct adapter import from engine** (AST/grep rule) | decision point = gateway only |
| **Webhook** | GOWA: forged/missing device-secret → 401, no processing | no forced HMAC, device-secret enforced |
| | Fonnte: `?secret` mismatch → 401; valid → 200 | timingSafeEqual enforced |
| | replay: duplicate `messageId` within 300 s → 409 deduped | dedup-before-ack |
| | rate-limit: 60 req/10 min/device → 429 | throttle |
| | raw-body preserved for HMAC-readiness | future-proof |
| **Order lifecycle** | each illegal transition rejected | state machine |
| | idempotent re-assert of same status = no-op | idempotency |
| | `→paid`/`confirmed` sets `confirmedAt` exactly once | fixes Test-9 |
| | `→draft`/`→waiting_address` does NOT set `confirmedAt` | removes prematurity |
| **PWA PII** | `/init` returns `contact` and **NOT** `phoneNumber`/`id` | PII removed |
| | `contact.whatsappUrl` resolves to merchant `wa.me` | UX preserved |
| | redirect endpoint rate-limited + auditable | abuse control |
| **Regression gate** | golden still 17/17 after seam shift | mock seam correctness |

**Rule of thumb:** 1 assertion per invariant above; no new e2e against live WhatsApp in G2-B (keep the 4 `.e2e.*` suites as-is until scope-verified).

---

## 14. ROLLBACK STRATEGY
- **AI gateway:** feature-flag `AI_GATEWAY`. If off → adapters direct (revert path). Rollforward-safe: gateway wraps the same adapters, so flipping back re-routes interpreter/reasoning to `groqAdapter` (old behavior) instantly.
- **Webhooks:** soft-start behind `WEBHOOK_VERIFY` flag; if it breaks inbound flow, flip off (back to current no-verify) while fixing device registration.
- **PWA init:** keep `phoneNumber` as a **deprecated alias** for one sprint alongside `contact`; dashboard/PWA migrate to `contact`; then drop `phoneNumber`.
- **Order lifecycle:** the transition validator is a code-only gate; if it over-restricts a legal dashboard action, widen the allowed-set (data-only change, no schema). `confirmedAt` backfill is additive (only sets previously-null on paid/completed — reversible in practice since canary has 0 paid/completed rows). The dead `updateOrderStatus` (order.service.ts:296) is deleted as part of this step; if rollback is needed, restore the inline `orders.ts:94` raw update.

---

## 15. IMPLEMENTATION SEQUENCE (design — exact order)

1. **AI gateway first (lowest-risk, highest-leverage):** `LLMGateway` (new) wrapping existing adapters (pure transport); wire `interpreter`/`reasoning` import seam; **shift golden mock seam** → verify golden 17/17 green with `AI_GATEWAY` off-then-on. (Unblocks C2; no provider actually called.)
2. **Order lifecycle fix (unblocks Test-9):** remove dead `order.service.ts:296 updateOrderStatus` + inline `orders.ts:94` raw update; replace both with a single `OrderAggregate.transition(orderId, to, actor)` validator (allowed-transitions table + `confirmedAt` set at PAID only); remove premature `confirmedAt` writes (order.service:61,141) and `fast-path.ts:375 ''`; wrap `executeCartOps` in `$transaction`; verify order-context → 15/15.
3. **PWA PII contract:** `/init` returns `contact` (+ deprecate `phoneNumber`/`id`); ChatPage uses `contact.whatsappUrl`; re-capture PWA browser baseline (16 screenshots) — verifies §9 still 0 errors.
4. **Webhook hardening:** mount `express.raw` on `/api/webhooks`; timingSafeEqual for GOWA device-secret + Fonnte `?secret`; Redis dedup-before-ack; webhook rate limiter; soft-start behind flag.
5. **Circuit consolidation:** remove `message-processor` L1 breaker duplication; it now only orchestrates "gateway threw → apology + handoff". Verify pipeline+golden+realtime still green.
6. **(G2-C, NOT G2-B):** CartAuthority table + single writer — deferred by explicit scope rule.

Each step is independently flaggable + reversible; steps 1–3 can ship without 4/5.

---

## 16. OWNER DECISIONS REQUIRED

| # | Decision | Options | Recommendation | Rationale |
|---|----------|---------|----------------|-----------|
| D1 | Should the reply path enforce Gemini-primary/Groq-fallback via a gateway? | (a) gateway (Option B) (b) keep Groq-only direct (status quo) (c) Option A 1-line swap | **(a) gateway** | C2 is a correctness bug (declared policy not live); Option A leaves dup-breaker + test coupling |
| D2 | Shift golden mock seam from `groqAdapter.generate` → `llmGateway.generate`? | yes / no | **yes** | Required for (a); 17 scenarios unchanged, only seam |
| D3 | GOWA: accept device-secret + replay-dedup (no HMAC)? | yes / force HMAC | **yes (device-secret)** | GOWA has no inbound signature mechanism; forcing HMAC drops all webhooks |
| D4 | Fonnte: keep `?secret` query (constant-time) vs require header secret? | (a) `?secret` timingSafeEqual (b) require `X-Fonnte-Signature` header | **(a)** | Fonnte only delivers secret via callback URL; (b) would reject all real traffic |
| D5 | PWA: replace `phoneNumber`+`id` on public init with `contact{whatsappUrl}` (+ optional redirect endpoint)? | yes / keep raw | **yes** | Reduces PII/enumeration; WhatsApp button preserved |
| D6 | Order: adopt 7-state machine (DRAFT→WAITING_ADDRESS→AWAITING_PAYMENT→PAID→PACKING→SHIPPED→COMPLETED) with `confirmedAt` set ONLY at PAID (consolidating dead `updateOrderStatus` + inline `orders.ts:94`)? | yes / keep raw inline update | **yes** | Fixes Test-9, single timestamp authority, deterministic |
| D7 | CartAuthority (Cart/CartItem table, single writer) in G2-B or G2-C? | G2-B / G2-C | **G2-C** | Explicitly scoped out of G2-B; G2-B only hardens invariants + transactions |
| D8 | `generalLimiter` (1000/15 min) — mount globally or drop? | mount / drop | **mount on all non-webhook routes** | Currently defined-but-unmounted; cheap safety net |

---

## 17. FINAL RECOMMENDATION

1. **Do not rewrite the Conversation Engine.** Harden the **boundaries** around it with a **wrapper** (`LLMGateway`), per `Project Context` "WRAPPER > MODIFY ENGINE". This fixes C2 (wrong provider on replies, duplicate breaker/retry, test coupling) with the smallest correct change.
2. **Webhooks: verify by what each provider actually supports.** GOWA = device-secret verification + replay dedup (no HMAC — it doesn't exist); Fonnte = `?secret` with `timingSafeEqual` + replay nonce. Add `express.raw` on `/api/webhooks` so HMAC can be added later without re-arch. Rate-limit per device/sender. This is honest to the providers and closes the spoof-inbound-exploit.
3. **PWA public API: return a `contact` object, not raw `phoneNumber`/`id`.** Keep the WhatsApp button (it is the primary channel) but resolve the `wa.me` link server-side — optionally via a rate-limited redirect endpoint for analytics/rotation.
4. **Orders: a deterministic, idempotent state machine with ONE timestamp authority.** `confirmedAt` set exactly when an order reaches PAID (fixes Test-9 → 15/15) and never on draft. Consolidate the **dead** `updateOrderStatus` (order.service.ts:296) and the **inline raw** `orders.ts:94` update into one `OrderAggregate.transition` validator. Wrap the dual cart-write in `$transaction` as a stopgap until G2-C's CartAuthority.
5. **CartAuthority = G2-C.** G2-B must NOT touch `schema.prisma` or do a cart-table migration. G2-B's only cart-related action is hardening the invariants (single active draft, transactional dual-write, timestamp hygiene) so G2-C lands on solid ground.

**Net:** G2-B is a *boundary-hardening* pass — single AI decision point, provider-honest webhook auth, PII-safe public contract, deterministic order lifecycle — with **zero schema changes** and the engine logic untouched. If any of D1–D8 above is rejected, flag it; the affected G2-B sub-design becomes a G2-C/P2 item instead.

> **STOP.** No source/schema/migration/dependency/test-source was written or modified. `git status` is unchanged from the G2-A baseline (the new file `DOCS/AUDIT/G2-B-core-hardening-architecture-review.md` + the transient probe are the intended artifacts; the probe was removed).
