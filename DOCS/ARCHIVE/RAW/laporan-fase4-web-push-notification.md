# FASE 4 — Web Push Notification (Signal, Not Transport)

**Qlobot Chatbox — FASE 4 completion report**
**Verdict: ✅ COMPLETE (RUNTIME VERIFIED)**

Commit: `feat(chatbox): FASE 4 web push notification` (on top of `29293ce` FASE 3)
Date: 2026-08-13 · Author: Poolside agent · Repo: `garuda` (monorepo)

---

## 1. Executive Summary

FASE 4 implements a **Web Push notification signal** that fires **only** when a
**human agent replies to a web customer who is currently offline** (has no active
conversation-scoped Socket.IO presence). Web Push is explicitly **not** a message
transport: it never inserts `conversation_history`, never creates a message
bubble, and never replaces Socket.IO (which remains the primary real-time
transport).

All acceptance criteria are met and verified green:

| Gate | Scope | Result |
|------|-------|--------|
| FASE 4 smoke (23 critical tests + T12) | `apps/api/scripts/smoke-fase4-notification.ts` | **63 passed, 0 failed** |
| FASE 4 unit tests | `src/tests/notification/notification.service.test.ts` | **4 passed, 0 failed** |
| FASE 1 regression | `scripts/smoke-fase1-realtime.ts` | **13 passed, 0 failed** |
| FASE 2 regression | `src/tests/{structured-message,pipeline,pipeline-edge-cases,golden-dataset,date-range}.ts` | **85 passed, 0 failed (12 suites)** |
| FASE 3 regression | `scripts/smoke-fase3-chatbox.ts` + admin-typing | **49 / 0**, **14 / 0** |
| Typecheck | `tsc --noEmit` (API / PWA / Dashboard) | **0 / 0 / 0** |
| Build | `tsc` (API) + `vite build` (PWA) + `vite build` (Dashboard) | **all exit 0** |
| Protected invariant | 13 protected files | **0 lines changed** (see §20) |

**COMPLETE criterion satisfied:** 23 scenarios + T12 runtime-verified (server
side) + F1/F2/F3 regression green + all typecheck/build green + committed + this
report written. Per the owner rules, the Service Worker is **SOURCE VERIFIED**
(it is owner-maintained code at `apps/pwa/public/sw.js` with no browser binary
available); the push/ notificationclick/ pushsubscriptionchange handlers are
covered by source + the server-side send path is runtime-verified via the
integration smoke (web-push `sendNotification` spied end-to-end).

---

## 2. Owner Decisions Implemented

Two decisions issued at FASE 4 inspection were **APPROVED** and are implemented
verbatim.

**Decision 1 — Push Subscription (Opsi A).**
`Customer.pushSubscription Json?` was added as a single new column on the
existing `Customer` model. No separate `PushSubscription` table. The
subscription is **server-authoritative** (created/refreshed/cleared by the
server after the browser posts its subscription to `/api/pwa/:slug/subscribe`,
which performs server-side `slug + webUid + store ownership` verification).

**Decision 2 — Online Eligibility.**
`isStoreOnline` (dead, store-level, in-memory) is **NOT** used for notification
eligibility. The authoritative online signal is **conversation-scoped,
store-scoped Socket.IO customer presence**:

> A customer is **ONLINE** for a conversation when there is ≥ 1 active
> authenticated customer Web Socket for that `(storeId, conversationId)`.
> Otherwise **OFFLINE**.

No Redis, no distributed presence (single-VPS MVP). Multi-instance presence is a
future concern (not introduced here).

---

## 3. Scope & Boundaries (non-goals)

Implemented:
- Human-agent → web-customer push **signal** (title / body / deep-link).
- Subscription lifecycle: subscribe / refresh-replace / unsubscribe.
- VAPID configuration + server-side subscription persistence.
- Conversation-scoped customer presence.
- Owner Service Worker extended (push, notificationclick, pushsubscriptionchange).

Explicitly **NOT** implemented (and not attempted):
- Push as a message transport (no `conversation_history` insert, no message
  bubble, no fallback transport).
- AI/assistant → customer push triggers (no new trigger added).
- Customer → agent / assistant → agent push.
- Rich notification actions / data channel.
- Notification analytics / metrics / read-receipts.
- Redis/distributed presence.
- A second Service Worker (the existing owner SW at `/c/sw.js` was extended).
- PM2 restart, deploy, commit of non-FASE4 artifacts.

The push payload is **signal-only** (`conversationId, messageId, title, body,
url, timestamp`). It carries **no** Bearer token, **no** access token, **no**
VAPID private key, **no** cost/margin/history/phone/webUid.

---

## 4. Architecture Overview

```
                    ┌─────────────────────────────────────────────┐
                    │  apps/api/src/routes/conversations.ts        │
  Admin reply  ────►│  POST /conversations/:id/reply               │
                    │  1. single prisma.conversationHistory.create │
                    │     (role=agent, source=dashboard)          │
                    │  2. eventBus.publish('message.created', {    │
                    │       sender:'human_agent',                    │
                    │       id: <conversation_history.id>, ...})   │
                    └───────────────┬──────────────┬────────────────┘
                                    │              │
                                    ▼              ▼
          ┌────────────────────────────────────┐   ┌────────────────────────────────────┐
          │ RealtimeService (Socket.IO)         │   │ NotificationService (web-push)      │
          │  dispatch('message.created')        │   │  subscribe('message.created')      │
          │  → customer room:                  │   │                                     │
          │     online customer → WS recv msg  │   │  shouldPush():                      │
          │     offline customer → (no WS)     │   │    sub exists? + online?            │
          │                                     │   │    → push payload (signal only)     │
          └────────────────────────────────────┘   │    → webPush.sendNotification(sub,   │
                                                  │                     JSON.stringify,  │
                                                  │                     {TTL:3600})      │
         PWA client (online): receives          ┌─┤                                     │
         message.created over Socket.IO         ││  failure: 410/gone → clear            │
         (primary transport, no push)            ││           subscription only;          │
                                                 ││  other error → log, never rollback   │
         PWA client (offline): push arrives at   │└────────────────────────────────────┘
         Service Worker 'push' → showNotification
          → notificationclick → open/focus /c/<slug>/<conv>
```

Key asymmetry: **Socket.IO delivers the message; Web Push only signals it.**
When the customer is online, the `message.created` event fans out over Socket.IO
to the customer conversation room and the push path is skipped (no duplicate).

---

## 5. Files Changed (committed)

Modified (tracked):
- `apps/api/prisma/schema.prisma` — `+ pushSubscription Json?` on `Customer` (Decision 1).
- `apps/api/.env.example` — VAPID template section.
- `apps/api/package.json` — `web-push ^3.6.7`, `@types/web-push ^3.6.4` (dev).
- `apps/api/package-lock.json` — web-push lockfile entries.
- `apps/api/src/index.ts` — `notificationService.init()` after `realtimeService.init`.
- `apps/api/src/routes/pwa.ts` — `/init` returns `vapidPublicKey`; `POST /:storeSlug/subscribe`; `POST /:storeSlug/unsubscribe`.
- `apps/api/src/services/realtime.service.ts` — `customerPresence` Map + `isCustomerConversationOnline`; connect/disconnect hooks. **Unchanged:** `onlineByStore`, auth, typing, rooms, dispatch, `isStoreOnline`.
- `apps/pwa/public/sw.js` — `push`, `notificationclick`, `pushsubscriptionchange` handlers (owner SW extended; no second SW).
- `apps/pwa/src/components/ChatPage.tsx` — fetches `vapidPublicKey` from `/init`; renders `<NotificationPrompt>` after store name.

New (untracked → added):
- `apps/api/prisma/migrations/20260813115500_add_customer_push_subscription/migration.sql`
- `apps/api/src/config/vapid.config.ts`
- `apps/api/src/services/notification.service.ts`
- `apps/api/src/tests/notification/notification.service.test.ts`
- `apps/api/scripts/smoke-fase4-notification.ts`
- `apps/pwa/src/utils/vapid.ts`
- `apps/pwa/src/components/NotificationPrompt.tsx`
- `DOCS/laporan-fase4-web-push-notification.md` (this report)
- `DOCS/laporan-fase4-inspection.md` (pre-implementation inspection → resolved)

**NOT committed (ambient):** `.env`, `apps/api/dist/*`, `apps/api/logs/*`, and
all other pre-existing untracked `DOCS/*.md` (blueprint/audit/fonnte/taskPWA
docs — FASE 4 scope only the two `laporan-fase4-*` files).

---

## 6. Migration

Single approved column (Decision 1), no separate table:

```prisma
model Customer {
  ...
  webUid        String?  @unique
  pushSubscription Json?  // FASE 4: persistent Web Push subscription (VAPID). server-authoritative; scoped by storeId+webUid (no cross-tenant).
  name          String?
  ...
}
```

`prisma/migrations/20260813115500_add_customer_push_subscription/migration.sql`:
```sql
ALTER TABLE "customers" ADD COLUMN     "pushSubscription" JSONB;
```

Applied (production requirement — persistent subscription):
`npx prisma generate` (client regenerated; `node_modules/.prisma/client/index.d.ts`
references `pushSubscription`); `npx prisma migrate deploy` (DB `garuda_dev`,
`_prisma_migrations` tracks it as 17/17 latest).

Verification query (DB): `SELECT count(*) FROM "customers" WHERE "pushSubscription" IS NOT NULL` — subscription rows confirmed during the smoke (`subscribe` → 1 row persisted).

---

## 7. VAPID Configuration

`apps/api/src/config/vapid.config.ts` — `getVapidConfig(): VapidConfig | null`
reads `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
(default `mailto:admin@qlobot.local`). Returns `null` if public/private absent →
`notificationService.init()` degrades gracefully (push disabled, **no crash**;
Socket.IO continues as primary transport).

Private key is **server-only**: it is read in `getVapidConfig()` (server) and
applied once via `webPush.setVapidDetails(subject, publicKey, privateKey)` in
`init()`. The PWA receives **only** `VAPID_PUBLIC_KEY` (public) through
`GET /api/pwa/:storeSlug/init` → `data.vapidPublicKey`. `apps/pwa/.env`/build
never receives the private key (no `VITE_*`/exposed private).

`.env.example` (committed):
```
# Web Push — FASE 4
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:admin@qlobot.local
```

VAPID is verified deterministically in the smoke `[5]`:
`setVapidDetails` spy confirms `init()` applied `(subject, PUBLIC, PRIVATE)` from
env, `isVapidConfigured()` returns true, `generateVAPIDKeys()` works, and `/init`
exposes only the public key.

---

## 8. RealtimeService Customer Presence

`apps/api/src/services/realtime.service.ts` — added without disturbing existing
members:

```ts
private customerPresence = new Map<string, Set<string>>(); // key: `${storeId}:${convId}`

isCustomerConversationOnline(storeId: string, conversationId: string): boolean {
  return this.customerPresence.get(`${storeId}:${conversationId}`)?.size > 0;
}
```

- `onConnection`: for an authenticated customer socket carrying
  `{ storeId, customerId, conversationId }` (resolved server-side from
  `slug + uid`), adds `socket.id` to `customerPresence[${storeId}:${conversationId}]`.
- `disconnect`: removes `socket.id`; deletes the key when the set is empty.
- Key is **store-scoped** (`${storeId}:${conversationId}`) → tenant isolation by
  construction.
- `onlineByStore`, auth, typing, rooms, rooms-emit, dispatch, `isStoreOnline`
  **unchanged**. `isStoreOnline` remains in place but is **not used** for
  eligibility (no new callers).

Online = ≥ 1 active authenticated customer Web Socket for the conversation
(Decision 2). Offline = no customer socket for the conversation.

---

## 9. NotificationService

`apps/api/src/services/notification.service.ts` — a delivery-layer-only
singleton. It imports `prisma`, `realtimeService`, `eventBus`, `web-push`,
`adapters.logger`, and `getVapidConfig`. It does **not** import the Conversation
Engine.

- `init()`: if VAPID configured → `webPush.setVapidDetails(...)` +
  `eventBus.subscribe('message.created', ...)` (fire-and-forget
  `handleMessageCreated(...).catch(log)`); else warn + disable.
- `isVapidConfigured()`: returns the init flag (not a live env re-read).
- `getSubscription(customerId)`: reads `Customer.pushSubscription`
  (handles both JSONB-object and stringified).
- `shouldPush({ storeId, conversationId, customerId }) → { push, reason }`:
  returns `push=true` **only** when subscription exists AND
  `realtimeService.isCustomerConversationOnline(...)` is false. Reasons include
  `tenant_mismatch_or_customer_missing`, `no_push_subscription`,
  `customer_online_no_duplicate`, `customer_offline`.
- `buildPayload(d): PushPayload` — pure; fields
  `{ conversationId, messageId (= d.id), title, body (truncated 80), url=/c/<slug>, timestamp }`.
- `handleMessageCreated(env)`:
  1. `if (!vapidConfigured) return;` (WS still primary)
  2. trigger filter: `if (data.sender !== 'human_agent') return;` (no AI/customer push)
  3. resolve conversation (store-scoped tenant check); `if (!conv) return;`
  4. `if (conv.storeId !== env.storeId) return;` (tenant isolation)
  5. `if (conv.channel !== 'web') return;` (WA uses WA gateway — Web/WhatsApp isolation)
  6. `shouldPush(...)`; if `!push` → log skip + return (online customers are skipped)
  7. resolve store slug → `buildPayload` → `getSubscription` (re-check; race guard)
  8. `await webPush.sendNotification(sub, JSON.stringify(payload), { TTL: 3600 })`
  9. catch: `isSubscriptionError(e)` (404/410/gone/expired/invalid/unsubscribe/removed) →
     `prisma.customer.update({ pushSubscription: null })` (clear only); else log only.
     **Never** rolls back message / reply / status / event / WS.

`isSubscriptionError` is a module-local pure helper matching `{statusCode ∈ {404,410}}` or message keywords.

The listener is **fire-and-forget** and registered after `RealtimeService.init()`
(see `index.ts`), so the synchronous EventBus emit + WS delivery is never blocked
by push I/O, and a push error can never propagate into the WS dispatch path.

---

## 10. PWA Routes (server-side ownership)

`apps/api/src/routes/pwa.ts` (Express `Router`, mounted at `/api/pwa`):

- `GET /:storeSlug/init` — unchanged behavior + `vapidPublicKey:
  process.env.VAPID_PUBLIC_KEY || null` added to `data`.
- `POST /:storeSlug/subscribe` — body `{ uid, subscription }`. Server resolves
  **store** by `slug`, then **customer** by `{ storeId, webUid = uid }` (tenant
  scoped). If store or customer not found → **401**. Otherwise
  `prisma.customer.update({ where: { id: customer.id }, data: { pushSubscription:
  subscription } })` (REPLACE semantics — refresh). Subscription shape validated
  (endpoint string required).
- `POST /:storeSlug/unsubscribe` — body `{ uid }`. Server verifies slug+uid the
  same way; `pushSubscription: null` on the customer row. No-op-safe.

The client **never** sends `customerId`/`storeId`; it only sends `uid` + `slug`,
which the server re-derives. Cross-store subscribe (`uid` of store A to slug of
store B) returns 401 (smoke `[4]`).

---

## 11. Service Worker (extended owner SW)

`apps/pwa/public/sw.js` — **no second Service Worker created** (existing owner
SW at `/c/sw.js` scope `/c/` extended):

- `message` listener: caches `{ type:'FASE4_IDENTITY', slug, uid }` on
  `self.__fase4Identity` so `pushsubscriptionchange` can re-POST after a refresh.
- `push` handler: `const data = evt.data?.json()` (minimal payload);
  `self.registration.showNotification(data.title, { body:data.body,
  data:{conversationId, messageId, url:data.url, timestamp } })`. **No DB write,
  no message create, no fetch to /message.**
- `notificationclick`: `clients.matchAll({type:'window', includeUncontrolled:true})`
  — focus the client whose `url` matches `notification.data.url` (`/c/<slug>`);
  otherwise `clients.openWindow(url)`. **No token in URL.**
- `pushsubscriptionchange`: reads cached identity →
  `registration.pushManager.subscribe({userVisibleOnly:true,
  applicationServerKey})` with the cached public key → POST
  `/api/pwa/<slug>/subscribe { uid, subscription }` (replace). Falls back to
  `unregister()` + `unsubscribe()` if identity unknown.

Existing `install`/`activate`/`fetch` handlers are **unchanged**. PWA is served
at `/c/` (vite `base:'/c/'`, SW registered at `/c/sw.js`). `manifest.json`
`display:"standalone"` (no token in start URL).

---

## 12. PWA Client

- `apps/pwa/src/utils/vapid.ts` — `urlBase64ToUint8Array(base64String): Uint8Array`
  (standard base64url → Uint8Array for `applicationServerKey`).
- `apps/pwa/src/components/NotificationPrompt.tsx` (new) — renders only when
  `slug && uid && conversationId && vapidPublicKey && permission==='default' &&
  !subscribed`. Triggered **only** by a user click on "🔔 Notifikasi" (user
  activation; never on page load). Flow: `Notification.requestPermission()` →
  `navigator.serviceWorker.ready` → `pushManager.subscribe({
  userVisibleOnly:true, applicationServerKey })` → `POST /pwa/:slug/subscribe
  { uid, subscription }` → `postMessage({type:'FASE4_IDENTITY',...})` to the SW.
  Denied permission → component returns `null`, chat continues over Socket.IO
  (no fallback push). The `applicationServerKey` is cast to satisfy the lib.dom
  `BufferSource` type (a lib.dom `Uint8Array<ArrayBufferLike>` quirk, not a runtime
  issue — the value is a valid `Uint8Array` at runtime).
- `apps/pwa/src/components/ChatPage.tsx` — imports `NotificationPrompt`, fetches
  `vapidPublicKey` from `GET /api/pwa/:slug/init`, renders
  `<NotificationPrompt slug uid conversationId vapidPublicKey />` after the store
  name. No ChatPage redesign (PWA style preserved).

`apps/pwa/src/services/api.ts` is unchanged (axios `baseURL:'/api'`, no auth
interceptor — public routes).

---

## 13. Trigger Filter

Implemented exactly per the owner "Primary notification-worthy event":
**Human Agent → Web Customer**. The notification service consumes the **existing**
`message.created` EventBus event (no new event type invented) and filters
internally:

- `data.sender !== 'human_agent'` → no push (covers `assistant`/AI and
  `customer` echo). **No AI/assistant push trigger added** (none existed to
  require).
- `conv.channel !== 'web'` → no push (WA goes through Fonnte/GOWA).

This is **do-not-push-automatically-for-every-event**: there is exactly one
trigger path, and eligibility (`shouldPush`) additionally requires offline +
subscription. No notification storm.

---

## 14. Payload Contract

Minimal signal (verified by unit test + smoke `[11]`/`[15]`):

```json
{
  "conversationId": "conv-f4-web",
  "messageId": "a1bc8286-... (=== conversation_history.id)",
  "title": "f4-1",
  "body": "Ada balasan dari admin: <content, truncated 80>",
  "url": "/c/f4-1",
  "timestamp": "2026-08-13T13:25:23.011Z"
}
```

Invariants (asserted):
- `messageId` === the `conversation_history.id` persisted by the admin reply
  route (`routes/conversations.ts:186` single `conversationHistory.create`,
  `id` emitted as `message.id` on `message.created` — HARD RULE #3). Smoke
  `[11]`/`T12-B`: `payload.messageId === reply.messageId`.
- `url` = `/c/<storeSlug>`, contains **no** `token`/`Bearer`.
- No `vapidPrivateKey`, `cost`, `margin`, `history`, `phone`, `webUid`,
  `authorization`, `Bearer` anywhere in the payload blob (smoke `[15]`:
  `leaked: none`).

---

## 15. Failure Semantics (no rollback rule)

- **Push failure (transient / 5xx / network):** logged only; the message, reply,
  conversation status, event emission, and Socket.IO delivery are
  **unaffected** (`message.created` already published before push). Smoke `[13]`:
  `sendNotification` throws → message row still exists (no rollback).
- **Invalid / expired / gone subscription (410/410/gone/expired/invalid/...):**
  `Customer.pushSubscription` is set to `null` (silently; no retry). The message
  is NOT rolled back. Smoke `[14]:` 410 → `pushSubscription` cleared to `null`.
- **No subscription at send time (race):** re-checked before send; no-op.
- Push is best-effort signal; the authoritative message path is Socket.IO + DB.

Push **never** calls `conversationHistory.create`, `message`, `reply`, or
`conversation.updated`; the only `prisma` writes a push error can produce are
`customer.update({ pushSubscription: null })` on a 410/gone (isolated to the
offending customer row).

---

## 16. Security

- **Server-authoritative subscription.** The browser cannot set
  `customerId`/`storeId`; it sends `uid` + `slug`, and the server re-derives
  store + customer (tenant scoped). Subscription upsert is scoped to the resolved
  customer row — confirmed by smoke `[4]` (cross-store subscribe → 401).
- **Tenant isolation.** `customerPresence` key = `${storeId}:${conversationId}`;
  `shouldPush` checks `customer.storeId === params.storeId`; `/subscribe`
  resolves customer within `storeId`. Smoke `[4]` + `[21]`: S2 customer's
  presence is invisible to S1, and S1 cannot read S2's conversation.
- **No token in URL.** Push `url` = `/c/<slug>` (no query params);
  `notificationclick` opens/focuses that URL only. The VAPID **private** key
  never leaves the server (applied once in `init()`; only public key exposed via
  `/init`).
- **VAPID subject** (`mailto:admin@qlobot.local` by default) configurable via
  `VAPID_SUBJECT`.
- **Payload minimal:** no PII beyond the message preview; no cost/margin/history.

---

## 17. Verification Matrix (23 critical tests + T12)

All runtime-verified in `scripts/smoke-fase4-notification.ts` (63 asserts). The
isolated unit tests (`src/tests/notification/`) cover the pure payload contract.

| # | Requirement | Evidence (smoke + unit) | Status |
|---|-------------|------------------------|--------|
| 5 | VAPID configuration (keys loaded, `setVapidDetails` called w/ subject+pub+priv, public key exposed via `/init`, private key server-only) | smoke `[5]` (setVapid spy + `isVapidConfigured` + `generateVAPIDKeys` + `/init`); unit `isVapidConfigured` | PASS |
| 1 | Subscription registration persisted (`POST /subscribe` valid → `Customer.pushSubscription`) | smoke `[1]` | PASS |
| 2 | Subscription refresh = UPDATE existing row (no duplicate customer row) | smoke `[2]` (count delta 0) | PASS |
| 3 | Unsubscribe clears `pushSubscription` (null) | smoke `[3]` | PASS |
| 4 | Tenant ownership: cross-store subscribe → 401; S2 untouched | smoke `[4]` | PASS |
| 6 | Presence ONLINE on customer WS connect | smoke `[6]` | PASS |
| 8 | Multiple sockets same conv → online | smoke `[8]` | PASS |
| 9 | Last socket disconnect → OFFLINE | smoke `[9]` | PASS |
| 10 | Online customer: NO push + receives `message.created` via WS (primary transport) | smoke `[10]` | PASS |
| 11 | Offline + sub → push, `messageId`==DB id, deep-link url, no token | smoke `[11]` | PASS |
| 12 | Offline + no sub → no push (no error) | smoke `[12]` | PASS |
| 13 | Push failure → message NOT rolled back | smoke `[13]` | PASS |
| 14 | Invalid sub (410) → clears DB, message not rolled back | smoke `[14]` | PASS |
| 15 | Payload contains no secret/token/private | smoke `[15]`, unit `buildPayload` | PASS |
| 16 | `payload.messageId` == conversation_history.id | smoke `[11]` (and T12-B), unit | PASS |
| 17 | Push does NOT INSERT history (delta == 1, only admin reply) | smoke `[17]` | PASS |
| 18 | Socket.IO remains primary transport | smoke `[10]`/`[18]` | PASS |
| 19 | No duplicate bubble (exactly 1 `message.created` while online) | smoke `[19]` | PASS |
| 20 | Web/WhatsApp isolation (WA channel → no push; WA reply still works) | smoke `[20]` | PASS |
| 21 | Tenant isolation (presence store-scoped) | smoke `[21]` | PASS |
| 22 | FASE 3 regression (message.created path) | smoke `[22]` (F3 smoke 49/0) | PASS |
| 23 | FASE 2 regression (admin reply type=text) | smoke `[23]` (F2 85/0) | PASS |
| 7  | Presence OFFLINE baseline (no socket) | smoke `[7]` | PASS |
| T12-A | Online customer gets WS `message.created` (canonical id), push NOT sent | smoke T12 `(A)` | PASS |
| T12-B | Disconnect → offline; push sent, `messageId`==DB id, exactly 1 history insert | smoke T12 `(B)` | PASS |

**T12 (end-to-end, single-VPS):** Online customer (subscribed) receives
`message.created` over Socket.IO and gets **no** push; after disconnect, the next
admin reply triggers exactly one web push whose `messageId` equals the new
`conversation_history.id`, with exactly one history INSERT for that reply (push
adds zero).

---

## 18. Test Results (raw)

```
FASE4 SMOKE RESULT: 63 passed, 0 failed      (scripts/smoke-fase4-notification.ts)
  ✔ NotificationService.buildPayload        (4/0, src/tests/notification/*.test.ts)
F1 SMOKE RESULT:    13 passed, 0 failed      (scripts/smoke-fase1-realtime.ts)
F2 unit tests:       85 passed, 0 failed     (12 suites)
FASE3 SMOKE RESULT:  49 passed, 0 failed      (scripts/smoke-fase3-chatbox.ts)
ADMIN-TYPING SMOKE:  14 passed, 0 failed      (scripts/smoke-admin-typing.ts)
API  tsc --noEmit:  exit 0
PWA  tsc --noEmit:  exit 0
DASH tsc --noEmit:  exit 0
API  tsc build:     exit 0
PWA  vite build:    ✓ built in 1.92s
DASH vite build:    exit 0
```

Run commands:
```
cd apps/api && npx tsx --env-file=../../.env scripts/smoke-fase4-notification.ts
cd apps/api && npx tsx --env-file=../../.env --test --test-force-exit src/tests/notification/notification.service.test.ts
cd apps/api && npx tsx --env-file=../../.env --test --test-force-exit src/tests/structured-message.test.ts src/tests/pipeline.test.ts src/tests/pipeline-edge-cases.test.ts src/tests/golden-dataset.test.ts src/tests/date-range.test.ts
```

---

## 19. F1 / F2 / F3 Regression

- **FASE 1** (`smoke-fase1-realtime.ts`): 13/0 — web realtime connect/auth/reply path intact.
- **FASE 2** (`src/tests/structured-message|pipeline|pipeline-edge-cases|golden-dataset|date-range`): 85/0 — structured message, pipeline, pipeline edge cases, golden dataset, date range all green.
- **FASE 3** (`smoke-fase3-chatbox.ts`): 49/0; (`smoke-admin-typing.ts`): 14/0 — admin reply → `message.created` delivery, typing, and dashboard human-messaging all intact.

The only pre-existing failures (not FASE 4) remain the two F2 chat-jest suites
(`engine-config-v2` redisAdapter init + `reasoning-v2` LLM) — unchanged,
unrelated to Web Push, and out of FASE 4 scope.

---

## 20. Protected-File & Schema Invariant

Per the FASE 3 forensic contract, the following must remain untouched; for FASE 4
the **only** approved deviation is the single `Customer.pushSubscription` column
(Decision 1):

```
$ git diff --name-only HEAD   # (excluding .env/dist/logs)
apps/api/.env.example
apps/api/package-lock.json
apps/api/package.json
apps/api/prisma/schema.prisma          ← only: + 1 pushSubscription line
apps/api/src/index.ts
apps/api/src/routes/pwa.ts
apps/api/src/services/realtime.service.ts
apps/pwa/public/sw.js
apps/pwa/src/components/ChatPage.tsx

$ git diff HEAD -- apps/api/prisma/schema.prisma
  +  pushSubscription Json?  // FASE 4: persistent Web Push subscription (VAPID)...
```

Diffed against HEAD (`29293ce`) for all 13 protected paths — the **non-schema**
protected set returns **0 lines**:

```
business/conversation.service.ts, services/chat/*, business/fallback.service.ts,
business/order.service.ts, business/conversation-context.service.ts,
services/message-queue.service.ts, services/message-processor.service.ts,
services/fonnte.service.ts, adapters/whatsapp/gowa.adapter.ts,
routes/webhooks.ts, routes/messages.ts,
apps/dashboard/src/contexts/AuthContext.tsx, apps/dashboard/src/services/api.ts
```

Protected functions untouched: `processCustomerMessage`, `saveMessage`,
`buildResult`, `getOrCreateContext`, `acquireLock`. The Conversation Engine and
Fonnte/GOWA adapters are **not** imported by `NotificationService` (verified by
source: `notification.service.ts` imports only `web-push`, `event-bus.service`,
`realtime.service`, `vapid.config`, `prisma`, `adapters/container`).

---

## 21. Completion Verdict & Out-of-Scope

**FASE 4 status: ✅ COMPLETE.** All 23 critical scenarios + T12 pass at runtime;
isolated unit tests pass; F1/F2/F3 regression green; all 3 apps typecheck +
build; protected invariant holds; schema change is exactly the approved column.
Committed as `feat(chatbox): FASE 4 web push notification`.

**Out of scope (NOT started — future concerns):**
- Multi-instance / Redis presence (single-VPS MVP only).
- AI/assistant → customer push triggers.
- Rich notification actions / notification analytics.
- Device-/user-level subscription management beyond the single customer row.
- Push as a fallback transport or retry/backoff queue.
- FASE 5 and any UI redesign, commerce, or Fonnte device-status work.
- No PM2 auto-restart; the API was not restarted by this work (the smoke boots an
  ephemeral server separate from the running service).

> Note on `DOCS/laporan-fase4-inspection.md`: that file pre-dates these owner
> decisions and recorded a **BLOCKED** verdict. It is included in the commit with a
> top-of-file resolution banner pointing to this report; the BLOCKED condition is
> superseded by Decision 1 + Decision 2 above.
