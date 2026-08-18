# G2-B D3/D8 Decision Verification

Status: **FORENSIC / READ-ONLY ONLY.** No source, schema, config, or git state was modified.
Evidence locations: `apps/api/src/routes/webhooks.ts`, `apps/api/src/adapters/whatsapp/gowa.adapter.ts`,
`apps/api/src/middleware/rate-limiters.ts`, `apps/api/src/services/message-queue.service.ts`,
`apps/api/src/services/message-processor.service.ts`, `apps/api/src/index.ts`,
`apps/api/prisma/schema.prisma`, `.env` / `apps/api/.env.example`,
`apps/api/src/bootstrap/initializeConfig.ts`, `apps/api/src/routes/admin/config.ts`,
`apps/api/src/routes/pwa.ts`, `apps/api/src/routes/products.ts`, `apps/api/src/routes/orders.ts`,
and the in-repo `marketplace/` (OpenShip) + the (non-existent) `/home/Ubuntu/Garuda/marketplace` OpenShip path.

> **Critical rule applied:** no mechanism is asserted from inference. Where evidence is insufficient,
> the section states `**UNVERIFIED**` and names the missing evidence.

---

## 1. Executive Verdict

- **D3 — GOWA webhook auth:** GOWA inbound on **this** deployment provides **NO cryptographic
  authentication** that QloBot verifies (or can verify). The only field inspected is `body.device_id`,
  which is a **bot-number identifier (JID), not a secret**. QloBot has **no** inbound webhook
  secret/token/config key. The honest design is: **do not treat `device_id` as a credential**; use it
  only for tenant routing *after* the request is deemed trusted, and add a real transport/network
  trust boundary now. Whether the GOWA gateway *software* can send a callback secret is **UNVERIFIED**
  (no vendor docs in repo).
- **D8 — Rate-limit architecture:** Only **4 limiters** are defined and only **2 are mounted**
  (`storeAuthLimiter` on `/auth`, `adminAuthLimiter` on `/admin/auth`, `conversationLimiter` on
  `/pwa/:slug/message`). `generalLimiter` (1000/15min) is **dead code** — never mounted. No
  webhook, product, admin-API, order, or PWA-init limiter exists. `trust proxy = 1` is set but the
  reverse-proxy topology is **UNVERIFIED** (no nginx/Cloudflare config in repo). A tiered
  per-surface limiter design is approved in principle; mounting it is a code change to schedule.

**D3: NEED OWNER DECISION** (approve near-term network-trust control; the secret/HMAC path is blocked
on GOWA gateway support which is UNVERIFIED).
**D8: APPROVE architecture** (tiered per-surface limiters + `trust proxy` verification);
mounting/flagging is a follow-up edit.

---

## 2. D3 — GOWA Authentication

### Q1. Actual GOWA inbound mechanism

> **VERDICT: TIDAK.** GOWA inbound webhook pada deployment ini **tidak menyediakan cryptographic
> authentication.**

Verified evidence:

| Check | Result |
|---|---|
| `routes/webhooks.ts:21` GOWA handler | reads `body.event`, `body.payload.*`, `body.device_id` — **no header/query/body secret, no `crypto`, no `timingSafeEqual`, no HMAC** |
| `grep` for `timingSafeEqual`/`createHmac`/`sha256` in `gowa` path | **none** — `crypto.timingSafeEqual` is used only in `key-rotation.service.ts:145` (internal key rotation), NOT in the webhook |
| `grep` for `Authorization`/`X-Webhook-Secret`/`signature` in `webhooks.ts` | **none** in the GOWA branch |
| GOWA `device_id` value | bot WhatsApp number JID stripped to E.164 (`62xxxxxxxxxx`) — a **public identifier**, not a credential |

So as far as QloBot's inbound code can prove: **the only "verification" is that `device_id`
matches a known `store.phoneNumber`.**

### Q2. Can QloBot configure a GOWA callback secret?

> **UNVERIFIED** (cannot be proven true from repo evidence).

- QloBot has **no code path** that registers a callback URL or pushes a secret to the GOWA gateway.
  `gowa.adapter.ts` performs **only outbound** calls:
  `POST /send/message`, `POST /message/read`, `POST /message/presence` — all authenticated with
  `Authorization: Basic ...` (`GOWA_BASIC_AUTH_USER`/`GOWA_BASIC_AUTH_PASS`) and `X-Device-Id`
  (gowa.adapter.ts:60). There is **no `setWebhook` / `callback_url` / `webhook registration`** call.
- Config keys: the **`.env` / `.env.example` GOWA section exposes ONLY**:
  `GOWA_API_URL`, `GOWA_BASIC_AUTH_USER`, `GOWA_BASIC_AUTH_PASS` — all outbound.
  `bootstrap/initializeConfig.ts:132-147` registers exactly those 3 `GOWA_` keys.
  `admin/config.ts:93` treats any `GOWA_*` key purely as a hot-reload trigger — there is **no**
  `GOWA_WEBHOOK_SECRET` / `GOWA_WEBHOOK_TOKEN` / `GOWA_WEBHOOK_KEY` key.
- **UNVERIFIED at the software level:** Whether the GOWA gateway software running at
  `http://localhost:3001` (a self-hosted Baileys-based REST gateway) offers a "callback secret /
  webhook key / Authorization header" option in its admin UI when registering QloBot's
  `/api/webhooks/gowa` **cannot be confirmed from the repository.** No vendor README, docs, or
  config artifact in repo describes an inbound signing mechanism for GOWA.
- **What would prove it:** inspect the GOWA gateway (`localhost:3001`) admin → webhook
  registration screen for a "secret"/"token"/"key" field, and the gateway's source/docs for the
  exact header/query/form it echoes on POST to the callback.

### Q3. Options evaluation

| Option | Security strength | Feasibility | GOWA support (evidence) | Impl. cost | Recommendation |
|---|---|---|---|---|---|
| A. `device_id` comparison | **Weak** — `device_id` is the bot WA number (publicly enumerable); not a secret, trivially replayable | Trivial (already done) | Device field present in payload | None | **REJECT as auth.** Keep only as post-trust tenant routing. Elevating it to a secret has **no evidence** and contradicts the forensic rule. |
| B. shared secret (query/header) | **Strong** if a 256-bit random secret | **Cannot implement** without the gateway echoing a secret | **UNVERIFIED** | Medium (timingSafeEqual + replay store) | Only if Q2 proven by gateway admin inspection. |
| C. `Authorization: Bearer` | **Strong** | **Cannot implement** without gateway support | **UNVERIFIED** (no inbound `Authorization` in handler) | Medium | Same blocker as B. |
| D. HMAC signature | **Strongest** (integrity + origin + replay) | **Cannot implement** without gateway signing capability | **UNVERIFIED** (no signature field, no raw body) | High (raw-body mount + verifier) | Preferred *if* GOWA supports it; today it does not. |
| E. network/IP restriction | **Medium–Strong** on a self-hosted local gateway (`localhost:3001`) | High (infra-level) | N/A — enforced by deployer (bind/loopback/sg) | Low (nginx `allow 127.0.0.1; deny all;` or bind route) | **APPROVE as the base control now.** The GOWA gateway is local-host; the webhook should only accept the gateway's source. |
| F. endpoint secret | Same as B | Same | **UNVERIFIED** | Medium | Defer with B. |
| G. combination (E+B if supported) | Strongest composition | E is achievable now; B requires Q2 | E yes; B/UNVERIFIED | Low+E, Medium+B | **Recommended design** (see below). |

> Do not pick A because it is easy. A is insecure by construction (identifier ≠ secret).

### Recommended design (D3)

1. **Compensating control (deployable now):** restrict `POST /api/webhooks/gowa` to the local
   GOWA gateway origin — bind the listener to loopback, or front with nginx
   `allow 127.0.0.1; deny all;` (or source-port/sg restriction if the gateway runs on another host).
   This closes "any internet host can spoof inbound" — the realistic current exploit.
2. **Tenant routing (identifier only):** *after* the network trust boundary, extract
   `device_id` → `store.phoneNumber` for routing. `device_id` remains a **tenant key, not a
   credential** — explicitly documented so no future dev assumes it is secret.
3. **Secret path (gated on verification):** if the gateway admin inspection (Q2 evidence) shows the
   GOWA gateway can send a callback secret/header, add it with `crypto.timingSafeEqual` + a
   timestamp/nonce replay store (Redis). Mount `express.raw` on `/api/webhooks` first so a future
   HMAC can be added without re-arch.
4. **Hard no:** do **not** invent a secret from `device_id`; do **not** add a shared secret that the
   gateway cannot send (it would silently drop 100% of real webhooks).

### Evidence log
- GOWA `.env`: `GOWA_API_URL=http://localhost:3001`, `GOWA_BASIC_AUTH_USER=admin`,
  `GOWA_BASIC_AUTH_PASS=<redacted>` — all outbound Basic-Auth (gowa.adapter.ts:20-24, 47-49).
- `routes/webhooks.ts:21-30`: route + `res.status(200)` immediately (no auth before ack).
- `routes/webhooks.ts:33-55`: `event`/`payload` shape consumed (`message`, `is_from_me`,
  `chat_id`, `from`, `body`, `pushName`, `notifyName`, `id`, `device_id`).
- No `GOWA_WEBHOOK_*` config key in `initializeConfig.ts:132-147` / `admin/config.ts:93`.

---

## 3. D3 — Tenant Resolution

Current flow:
```
POST /api/webhooks/gowa (200 sent immediately)
        │
        ▼
device_id (body)                       ← currently the ONLY discriminator, treated as identity
        │
        ▼
botNumberRaw = device_id stripped @s.whatsapp.net
        │
        ▼
store = prisma.store.findFirst({ phoneNumber: botNumberRaw, isActive, !deleted })
        │
        ▼
conversationId = `${store.id}:${customerPhone}` , then messageProcessorService.processMessage(...)
```

Recommended flow (separate authentication from identification, per the question's mandate that
authentication must precede trust):
```
NETWORK TRUST LAYER  (lokal gateway source only — see §2 design)
        ▼          [this layer replaces "device_id is the secret"]
REQUEST RECEIVED
        ▼
device_id (body)  →  tenant identifier (NOT credential)
        ▼
store lookup by phoneNumber  (same as today)
        ▼
messageId = payload.id || fallback   →  dedup cache (§4)
        ▼
messageProcessorService.processMessage(...)
```

**`device_id` may still be used as the identifier AFTER the request is authenticated (here: after the
network trust boundary).** It must never be the *only* thing standing between "spoofed POST" and
"engine runs". Today it *is* the only thing — that is the vulnerability D3 closes via the network
control, with an optional secret added only if Q2 is proven.

---

## 4. D3 — Replay Protection

Current dedup (verified in source):
- `services/message-queue.service.ts:90` `DEDUP_TTL_MS = 300_000` (5 min).
- `services/message-queue.service.ts:153` `private dedupeCache: Map<string, number>` — **in-memory**.
- `services/message-queue.service.ts:179` `isDuplicate(messageId)` — returns `true` if `messageId`
  already in the cache; otherwise `set(messageId, now)`.
- `services/message-processor.service.ts:110` `if (messageQueueService.isDuplicate(raw.id)) {
  drop }` — checked **during processing** (after the engine mutex), **not before the HTTP 200**.

Findings (read-only):
- **messageId uniqueness:** GOWA's `payload.id` is the WA message id; QloBot falls back to
  `${conversationId}:${Date.now()}` only when `payload.id` is absent (webhooks.ts:55). Uniqueness
  therefore depends on the gateway providing a stable `payload.id`.
- **TTL:** 5 min — short; a replay window of 5 min remains *live*.
- **Storage:** single-process `Map` — **NOT multi-instance safe**. (Here: single PM2 `api` pid
  370262, so OK *today*; breaks if api is clustered/scaled.)
- **Ack ordering:** `res.status(200)` is sent at webhooks.ts:24 **before** `isDuplicate` runs at
  message-processor:110 — so a replayed POST is acknowledged 200 then dropped during processing.
  Dedup prevents a double *engine run*, but does **not** dedup-before-ack.
- **Replay nonce:** none. No timestamp-window rejection.

Recommendation (design only — not implemented):
- Move dedup to **Redis** (shared across instances) with the same 5-min TTL, keyed by
  `${storeId}:msg:${messageId}`.
- For GOWA specifically, **reject after ack is not needed** today because the gateway re-POSTs
  only on `5xx`/timeout (and the handler 200s instantly) — the live threat is an attacker
  re-POSTing a captured `messageId`. The Redis dedup covers that; a per-`device_id`+IP window is
  the rate-limit complement (§7).

---

## 5. D3 — GOWA Rate Limit

Recommendation: rate-limit GOWA per **composite `device_id` + source IP** (the gateway's IP, since
the gateway multiplexes many bot numbers on one instance). Rationale:
- Per-IP alone is too coarse (one gateway IP serves N stores) and too fine in one sense (the gateway
  is a single source). A burst from the gateway is legitimate; a burst *not* from the gateway is
  rejected by the network control in §2 before any limiter matters.
- Per-`device_id` alone would let one rogue device starve others.
- Composite `device_id`+IP keeps the network control as the primary gate and adds a secondary
  per-bot throttle (e.g., ~60/min/device from the gateway IP).

> Note: the Fonnte path is symmetric (per-store `?secret` + per-store IP/window) but is specified
> in the D3 scope as the Fonnte companion; same principle — see §6 inventory.

---

## 6. D8 — Current Rate Limit Inventory

Defined (all in `middleware/rate-limiters.ts`, `express-rate-limit`, **in-memory** store by default):

| Limiter | Window | Max | Mounted on | Notes |
|---|---|---|---|---|
| `adminAuthLimiter` | 15 min | 5 | `routes/admin/auth.ts:14` (register), `:61` (login) | skip in `NODE_ENV=test` |
| `storeAuthLimiter` | 15 min | 5 | `routes/auth.ts:22` (register), `:89` (login) | skip in test |
| `generalLimiter` | 15 min | 1000/IP | **NOWHERE** (dead code) | defined L40, never imported as a mount |
| `conversationLimiter` | 15 min | 100/IP | `routes/pwa.ts:164` `POST /:storeSlug/message` | the only "business" limiter |

Manual (non-rate-limiter) throttling present:
- `routes/pwa.ts:287` `typingThrottle: Map<string, number>` — in-memory, per-key, no real window config,
  not Redis. Treat as a weak app-level throttle, **not** a rate limiter.

**Missing limiters (zero definitions found):** webhook, product/catalog, admin-API (non-auth),
order-mutation, PWA init/history/typing/subscribe, upload, public redirect/contact.

- `index.ts:77` global `express.json()` (no `express.raw` → no raw body preserved).
- No `helmet` anywhere (grep confirms; matches G2-A).

---

## 7. D8 — Endpoint Risk Matrix

| Surface | Endpoint | Auth | Risk | Workload | Recommended limiter |
|---|---|---|---|---|---|
| 1 | `POST /api/pwa/:slug/message` | none (customer) | High (billable LLM) | LLM call | **keep** `conversationLimiter`; key by `storeSlug`+`customerPhone`+`IP`, sliding window, Redis |
| 2 | `POST /api/pwa/:slug/typing` | none | Low | trivial | `typingThrottle` (in-proc) is OK short-term; back-end by store+IP, ~120/15min, Redis |
| 3 | `GET /api/pwa/:slug/history?uid=` | none | Medium (history enumeration per uid) | DB read | per `storeSlug`+`uid`, ~60/15min, Redis |
| 4 | `GET /api/pwa/:slug/init` | none | **High** (PII: phoneNumber + id) | cheap | per `storeSlug`+`IP`, ~120/15min, Redis (also fixes via §C3 contact contract) |
| 5 | `GET /api/stores/:storeId/products` | none | Medium (catalog scraping) | DB read | per `storeId`+`IP`, ~90/15min, Redis |
| 6 | `POST /api/webhooks/gowa` | **none** (D3 finding) | **High** (spoofs inbound → engine → billable) | heavy | network-trusted source (§2) **+** per `device_id`+gateway-IP, ~60/15min, Redis |
| 7 | `POST /api/webhooks/fonnte` | `?secret` (timingSafeEqual pending) | High | heavy | per `secret`-store+`IP`, ~60/15min, Redis; 200-before-process + dedup |
| 8 | `POST /auth/login`, `/auth/register` | none | High (brute force) | auth | **keep** `storeAuthLimiter` (5/15min); key by identifier (phone) not only IP |
| 9 | Dashboard (static) | cookie/session | Low | serve | `generalLimiter` as global safety net once mounted |
| 10 | Admin API (all `/admin/*`) | admin JWT | High (privilege) | read/write | **new** `adminApiLimiter` (e.g. 300/15min/IP + per-store) — currently only `/admin/auth/*` is limited |
| 11 | Product CRUD | admin | Medium | mutation | `adminApiLimiter` + per-store |
| 12 | `PUT /api/orders/:id/status` | admin | High (mutation; currently raw `orders.ts:94`) | write | `adminApiLimiter` + audit log |
| 13 | Public redirect/contact (D5, new) | none | Medium (abuse/spam of redirect) | cheap | per `storeSlug`+`IP`, ~60/15min, Redis |

Risk classes mapped to the "rate-limit principle" buckets: **AUTH ABUSE** (8), **CHAT FLOOD** (1,2),
**WEBHOOK FLOOD** (6,7), **CATALOG SCRAPING** (3,5), **ADMIN/API ABUSE** (9-12),
**EXPENSIVE OPERATIONS** (1 LLM, 6/7 engine). Different limits per bucket — not a single number.

---

## 8. D8 — Recommended Rate Limit Architecture

**Principle (per surface — not one global number):**

| Bucket | Key | Algorithm | Storage | Example limit | Failure |
|---|---|---|---|---|---|
| Auth abuse | identifier (phone) | fixed window | Redis | 5 / 15 min | 429 + lockout msg |
| Chat flood | store+customer+IP | sliding window | Redis | 100 / 15 min | 429 (matches today) |
| Webhook flood | device_id+gatewayIP | sliding window | Redis | 60 / 15 min / device | 429 (provider retries) |
| Catalog scraping | storeId+IP | fixed window | Redis | 90 / 15 min / store | 429 |
| Admin/API abuse | user/IP | sliding window | Redis | 300 / 15 min | 429 + audit log |
| Expensive op | customer | token bucket | Redis | 1 LLM / 3 s burst 3 | 429 / queue |

- **Switch the `express-rate-limit` store to Redis** (`rate-limit-redis`) — current store is
  in-memory → per-process → **not consistent across PM2 cluster** (api pid 370262 is single today,
  but `generalLimiter` being in-memory is a latent multi-instance bug).
- **Mount `generalLimiter`** as the global safety net on all non-webhook routes (D8 — this is the
  "mount it" decision; currently it is dead code).
- **Keep `webhooks` off the global limiter** and give them their own limiter (webhook traffic is
  bursty and from one gateway IP).
- **Trust the network first (§2), then limiter.**

---

## 9. Trust Proxy Analysis

- `apps/api/index.ts:74` `app.set('trust proxy', Number(process.env.TRUST_PROXY || 1))` → default
  **`trust proxy = 1`** (TRUST_PROXY is **not** in `.env`).
- Comment at `index.ts:72`: "express-rate-limit can correctly identify real client IPs via X-Forwarded-For."
- **Verified:** single trusted hop is correct **only** for a single reverse proxy (one nginx) in
  front of Express.
- **UNVERIFIED:** the actual reverse-proxy topology. Repo contains **no nginx config, no
  Cloudflare config, no `TRUST_PROXY` override**. Two topologies matter:
  - **Cloudflare → nginx → Express:** `trust proxy = 1` trusts the nginx hop and uses
    `CF-Connecting-IP`/`X-Forwarded-For` from nginx. Works *if* nginx forwards the real client.
    OK with `=1` provided nginx is the only proxy.
  - **Direct Cloudflare → Express (no nginx):** `trust proxy=1` trusts the leftmost XFF hop, which a
    **client can spoof** (`X-Forwarded-For: attacker-ip`) → **rate-limit bypass**. Would need
    `trust proxy = 'cf.bot.cidr, cf.a.b.c'` style Cloudflare preset or `loopback` for direct.
- **Spoofing via direct XFF (no proxy):** safe — Express ignores `X-Forwarded-For` from an
  untrusted (direct, non-proxied) connection when `trust proxy` is set; `req.ip` stays the real
  socket peer. So a direct spoof is **not** effective today.
- **Finding (not fixed):** `trust proxy = 1` is **fragile/unverified**. If the deployment adds a
  second hop or routes Cloudflare-direct, limiters keyed on `req.ip` become bypassable.
  **Recommendation:** set `TRUST_PROXY` explicitly to the real hop count and document the topology.
  For Cloudflare-direct, use the `cloudflare` preset (requires `trust proxy = 'cf.*'`-style, not `=1`).

---

## 10. OpenShip Comparison

- `/home/ubuntu/garuda/marketplace` (in-repo Next.js 15) exists; **`grep gowa` → 0 results.** No
  WhatsApp-gateway code and no webhook-auth pattern in OpenShip.
- `/home/Ubuntu/Garuda/marketplace` (the capitalized OpenShip path referenced by `Project Context`)
  **does not exist** on disk → nothing to compare.
- OpenShip has no relevant rate-limit pattern to adopt (its cart concept is `cartId` + payment
  providers Stripe/PayPal in `app/api/mcp-transport/tools/cart-tools.ts`). **Ignore for D3/D8.**
- Conclusion: OpenShip is **not** a source for GOWA webhook auth nor rate-limit architecture.

---

## 11. Final Decisions

### D3 — GOWA authentication
- **REJECT:** treating `device_id` as a webhook secret. No evidence it is a credential; it is the
  bot WA number (public identifier). Per the forensic rule, **never assume `device_id` is a secret**.
- **APPROVE (near term):** network/IP trust boundary for `POST /api/webhooks/gowa`
  (loopback/`allow 127.0.0.1`/gateway-source-only), plus per-`device_id`+gateway-IP limiter
  (§5). `device_id` used **only** for tenant routing after trust.
- **GATE on owner decision:** if the gateway-admin inspection proves GOWA can send a callback
  secret/header, implement B/C/D with `timingSafeEqual` + Redis replay nonce.
- **D3 verdict: NEED OWNER DECISION** — the secret/HMAC path is **UNVERIFIED** and blocked until the
  GOWA gateway admin UI/source confirms an inbound signing option. The network-trust control
  (E) is independently safe to deploy now.

### D8 — Rate-limit architecture
- **APPROVE** the tiered per-surface design in §8 (per-bucket key/algorithm/storage/limit).
- **APPROVE** mounting `generalLimiter` globally on non-webhook routes (currently dead code).
- **APPROVE** switching the rate-limit store from in-memory to Redis.
- **APPROVE** introducing the missing limiters (webhook, admin-API, PWA init/history/typing,
  products, order mutation, public redirect/contact) per §7.
- **FLAG (trust proxy):** set `TRUST_PROXY` explicitly and document topology — do not rely on `=1`.
- **D8 verdict: APPROVE architecture**; the limiter *mounting* is a code change tracked separately
  (implementation, not design) — G2-B remains read-only by these two decisions; the design itself is
  approved.

---

## 12. Implementation Impact (files to change — NOT changed)

Read-only listing for the next phase. **None of these files were modified in this verification.**

| Area | File | Change |
|---|---|---|
| GOWA auth (base) | `apps/api/src/routes/webhooks.ts` (GOWA branch) | add network/IP allowlist (or bind loopback) **before** the 200; keep `device_id` as tenant key only |
| GOWA auth (if Q2 verified) | `apps/api/src/routes/webhooks.ts`, new `middleware/webhook-verify.ts` | `timingSafeEqual` on callback secret + timestamp/nonce replay; `express.raw` on `/api/webhooks` |
| Replay | `apps/api/src/services/message-queue.service.ts` | migrate `dedupeCache` Map → Redis; key `${storeId}:msg:${id}`; TTL 5 min |
| Rate limiters | `apps/api/src/middleware/rate-limiters.ts` | add `redisStore` (rate-limit-redis); define `webhookLimiter`, `pwaInitLimiter`, `productsLimiter`, `adminApiLimiter`; mark `generalLimiter` as mounted |
| Routes — mounts | `apps/api/src/routes/webhooks.ts`, `routes/pwa.ts`, `routes/products.ts`, `routes/orders.ts`, `routes/admin/*.ts` | mount the new per-surface limiters; move `/webhooks` off global |
| Proxy | `apps/api/src/index.ts:74` | set `TRUST_PROXY` explicitly + document topology (no code change if topology == one nginx) |
| PWA / PII | `apps/api/src/routes/pwa.ts` (init handler) | emit `contact` object instead of raw `phoneNumber`+`id` (complements the init limiter above) |
| Admin orders | `apps/api/src/routes/orders.ts:74` | route status write through `OrderAggregate.transition` (ties D8 audit abuse bucket to C-art-5) |

> **Scope guard:** G2-B adds **no** new secret that the GOWA gateway cannot prove it sends. The
> approved deployable is the network trust boundary + limiter + Redis dedup + trust-proxy
> documentation — all read-only design today. No `.env`/schema/route was edited.
