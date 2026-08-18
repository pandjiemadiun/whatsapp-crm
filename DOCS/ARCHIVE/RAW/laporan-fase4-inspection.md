# FASE 4 PRE-IMPLEMENTATION INSPECTION

> **RESOLUTION (2026-08-13):** The BLOCKED verdict recorded below was superseded by
> two Owner Decisions, both APPROVED. FASE 4 was then implemented and **verified
> green** (see `DOCS/laporan-fase4-web-push-notification.md`): 63/0 smoke
> (23 critical tests + T12), 4/0 unit, F1/F2/F3 regression green, all 3 apps
> typecheck+build green, protected invariant 0 lines, committed as
> `feat(chatbox): FASE 4 web push notification`.
>
> - **Decision 1 (APPROVED):** single `Customer.pushSubscription Json?` column
>   (no separate table) — resolves the "subscription schema shape" blocker.
> - **Decision 2 (APPROVED):** conversation-scoped Socket.IO customer presence as
>   the authoritative online signal (single-VPS; no Redis/distributed; NOT
>   `isStoreOnline`) — resolves the "online eligibility" blocker.
>
> The inspection document below is preserved as the historical pre-decision
> record; its findings map directly to the implemented controls in the final
> report.

> Notification / PWA push (Web Push via VAPID, as a **signal** — not a message transport).

**Mode:** inspection + evidence only. **Nothing was implemented, installed, migrated, committed, or restarted.** (`JANGAN CODING / JANGAN membuat source file / JANGAN install / JANGAN migration / JANGAN commit / JANGAN restart PM2`.)

**Working dir:** `/home/ubuntu/garuda` — Node v24.19.0, PM2 `api` online, PostgreSQL reachable.
**Source of truth (actual repo):** the working tree at `HEAD` (`29293ce`) on top of FASE 3 (`467ecef`) and FASE 2 (`69d8859`). Docs consulted: the repo files listed in the task + `DOCS/updated-implementation-plan-chatbox-qlabot.md` (the FASE 4 design spec lives in §"FASE 4 — Notification / PWA push").

---

## 1. Git State

```
git log --oneline -5
29293ce docs(fase3): record admin-typing gap-patch completion
12fd702 fix(chatbox): complete FASE 3 admin typing        <- FASE 3 final patch
5090b2f docs(fase3): re-verification report (green) …
4bd59d8 docs(fase3): record FASE 3 commit hash & stat …
467ecef feat(chatbox): FASE 3 dashboard human messaging    <- FASE 3 implementation commit
69d8859 feat(chatbox): FASE 2 structured payload …          <- FASE 2 last
8e75e37 feat(chatbox): FASE 1 web realtime foundation        <- FASE 1
```

- **FASE 3 implementation commit:** `467ecef` (`feat(chatbox): FASE 3 dashboard human messaging`).
- **Post-FASE-3 changes:** gap patch `12fd702` + doc `29293ce` (FASE 3, already committed). **No FASE 4 commits.**
- **Uncommitted source:** **NONE.**
- **Ambient (excluded per spec):** `.env` (modified), `apps/api/dist/*` (rebuilt build artifacts), `apps/api/logs/*` (runtime logs), plus untracked `DOCS/laporan-fase3-forensic-audit.md` (audit artifact). All `dist/`/`logs`/`.env` are **not** part of any commit and are excluded from FASE 4 source analysis.
- `git diff --check` clean on source changes (no whitespace errors).

---

## 2. Existing Notification Infrastructure (search result)

Repo-wide `grep` (excl. `node_modules`/`dist`/`logs`/`.env`) for `notification`, `pushSubscription`, `web-push`, `webpush`, `VAPID`, `serviceWorker`, `PushManager`, `requestPermission`, `showNotification`, `pushManager`, `isStoreOnline`, `offline`:

**Source hits (real):**
| Term | File | Line | Behavior | Pre-existing? | Reusable? |
|---|---|---|---|---|---|
| `notification.created` (type) | `apps/api/src/services/event-bus.service.ts` | 25 | declared in `ChatbotEventType` union | YES (FASE 1) | ✅ contract boundary |
| `notification.created` (subscribe) | `apps/api/src/services/realtime.service.ts` | 72 | RealtimeService subscribes in `init()` | YES | ✅ boundary |
| `notification.created` (dispatch) | `apps/api/src/services/realtime.service.ts` | 239 | `case 'notification.created'` → dispatches to `adminRoom` + `customerConvRoom` | YES | ✅ boundary |
| `isStoreOnline` (define) | `apps/api/src/services/realtime.service.ts` | 91 | `onlineByStore.get(storeId)>0` in-memory | YES (FASE 1) | ⚠️ dead code / store-level (see §9) |
| `serviceWorker` (register) | `apps/pwa/src/main.tsx` | 21 | `navigator.serviceWorker.register('/c/sw.js')` | YES (P-PWA.15) | ✅ owner (extend) |
| `online` | `apps/pwa/src/components/ChatPage.tsx` | — | `navigator.onLine` (PWA client net-status) | YES | ❌ client-only, not authoritative |

**`notification` (false positives / unrelated):**
- `apps/dashboard/src/components/DashboardLayout.tsx` (lines 59-254): in-app **bell/dropdown** notification center (`notificationOpen`, `notificationCount` badge) — NOT push, unrelated.
- `apps/api/src/config/backup.config.ts`: `notificationEmail` (email alert for backups) — unrelated.
- `apps/api/src/services/structured-message.mapper.ts` line 47: `'notification'` as a **StructuredMessageType** (a chat message type sent by admin to Web customers, e.g. announcement) — conceptually a *chat payload type*, **not** web push. Note this is NOT a push transport.
- `apps/pwa/public/sw.js`: no `notification`/`push` (only install/activate/fetch).
- `apps/api/src/routes/pwa.ts`: matched "is online" only as incidental text; **no** notification/push logic.

**No hits** (confirming absence): `pushSubscription`, `web-push`/`webpush`, `VAPID`, `PushManager`, `Notification.requestPermission`, `showNotification`, `registration.pushManager`, `subscribe` route — **none in source.**

## 3. EventBus Notification Contract

`apps/api/src/services/event-bus.service.ts` (57 lines, FASE 1 foundation):
- `ChatbotEventType` union **already includes** `'notification.created'` (line 25) and `'device.status.changed'` (line 26, FASE 6).
- `eventBus = { publish(env), subscribe(event, listener) }` — in-process Node `EventEmitter`, synchronous publish.
- `RealtimeService.init()` **already subscribes** `'notification.created'` (line 72, part of the `subs[]` array) and `dispatch()` already handles it (lines 239-243): emits to `adminRoom(storeId)` + `customerConvRoom(storeId, convId)`.

**Verdict:** the **event boundary `notification.created` EXISTS and is REUSABLE** — RealtimeService already knows how to route it. **BUT it is never published by anyone** in the current source (see §12). The contract is *dormant*, not *wired* to a producer. This is an **asset** for FASE 4 (no need to invent a new event like `push.notification.created` — use the established boundary, per task rule).

## 4. RealtimeService (Socket.IO — must NOT be disturbed by FASE 4)

`apps/api/src/services/realtime.service.ts` (259 lines, FASE 1):
- `init()` mounts Socket.IO on the same Express http server, `authGuard`, `onConnection` rooms + `admin_typing` forward, and the `subs[]` EventBus→WS dispatch list (incl. `notification.created`).
- `isStoreOnline(storeId)` (lines 90-94): reads in-memory `onlineByStore` Map.
- `onlineByStore` is keyed by **storeId only** (line 160 sets/clears per `ctx.storeId`; lines 198-200 decrement per store). The FASE 4 design doc (impl-plan §9) claims "tracks per `storeId:convId`" — **discrepancy**: actual code is store-level, not per-conversation.
- **Must not change** per task (Fase 3 regression surface). FASE 4 push eligibility would *call* `isStoreOnline` rather than modify it.

## 5. Customer Push Subscription State

`apps/api/prisma/schema.prisma` — `model Customer` (lines 394-413):
```
model Customer {
  id            String   @id @default(uuid())
  storeId       String
  phone         String?
  webUid        String?  @unique
  name          String?
  ...
  @@unique([storeId, phone])
  @@index([storeId])
  @@map("customers")
}
```
- **No `pushSubscription` column exists.** Confirmed: `grep -niE "push|webpush|vapid|subscription" prisma/schema.prisma` → only the `'pushname'` comment.
- The impl-plan §11 explicitly recommends `Customer.pushSubscription Json?` (Opsi A, MVP, per `storeId+webUid`) or a separate `PushSubscription` table (Opsi B, multi-device).
- **→ Database migration is REQUIRED** to persist subscriptions (task §6 mandates persistent, not memory-only; §22 forbids migration now).

## 6. Subscription Lifecycle (existing API)

`apps/api/src/routes/pwa.ts` routes (lines 50-429):
```
GET  /:storeSlug/init
GET  /:storeSlug/history
POST /:storeSlug/message   (conversationLimiter)
POST /:storeSlug/typing    (1s throttle)
POST /:storeSlug/read
```
- **No `/subscribe` route exists.** No subscribe/unsubscribe/refresh endpoints.
- Web customer auth pattern (reusable for subscribe): `slug` + `webUid` (+ optional `conversationId`), resolved server-side (store→customer→conversation ownership) in `RealtimeService.authGuard` — a sound, tenant-isolated pattern to **reuse** for a future `/subscribe` route.

## 7. Web Push Dependency (package.json)

| App | `web-push` | `socket.io` | `socket.io-client` | `vite-plugin-pwa` | workbox | `redis`/`ioredis` |
|---|---|---|---|---|---|---|
| `apps/api/package.json` | ❌ missing | ✅ `^4.8.3` | (server) | n/a | n/a | ✅ (pre-existing, Socket.IO Redis adapter — unrelated to push) |
| `apps/pwa/package.json` | ❌ missing | n/a | ✅ `^4.8.3` | ❌ missing | ❌ missing | n/a |

- **`web-push` is NOT installed** in `apps/api` → **dependency is required** (impl-plan §7.12, §12: "web-push (server)"). Per task, **do NOT install now.**
- Client side uses native browser `PushManager`/`Notification` (no extra deps) — impl-plan §12.

## 8. VAPID Configuration

- **`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `PWA_ALLOWED_ORIGINS`** are **NOT present** in `apps/api/.env.example` or any source.
- `.env.example` **does** contain `PWA_ALLOWED_ORIGINS=https://qlobot.web.id` (CORS origin whitelist — useful, can be reused for push `allowedOrigins`).
- `VAPID_SUBJECT` not present.
- **No VAPID private key is hardcoded anywhere** (it doesn't exist) → no exposure risk *today*, but the secret must be generated at deploy and loaded from env only (§21/H).

## 9. Online/Offline Detection

- `RealtimeService.isStoreOnline(storeId)` (lines 90-94, 160, 198-200): **EXISTS** but is **dead code** — `grep isStoreOnline` in source finds **only the definition + `.d.ts`**, **zero callers**.
- Granularity: keyed by `storeId` (store-level), **not** per-customer/per-conversation — contradicts impl-plan §9 ("per `storeId:convId`").
- In-memory `Map`, per-instance: resets on PM2 restart; **not** authoritative across multiple PM2 instances or after restart.
- Client-side `navigator.onLine` (`ChatPage.tsx`, `api.ts`) is browser-network-only → **not authoritative** on the server (task §11: push must NOT be based on `navigator.onLine` alone).
- **→ Online eligibility authority is NOT established.** For FASE 4, push-eligibility for "customer offline" needs a reliable server-side source; the current in-memory store-level counter is insufficient for per-customer decisions. **STOP condition (§30 J) applies.**

## 10. Notification Trigger Candidates

Per EventBus + impl-plan §8/§10/§12, the notification-worthy events are:
- `message.created` with `sender: 'human_agent'` **and** conversation channel `web` (admin → web customer) — the primary push trigger (customer possibly offline).
- `conversation.handoff` (bot→human takeover) — admin-facing (bell badge / optional admin push).
- **NOT** every EventBus event — push must be gated by eligibility + dedup (avoid notification storm).
- `typing.*` — NOT notification-worthy (transient; suppress push).
- `conversation.resumed`/`resolved`/`updated` — low priority, suppress (would cause push noise / double "message" signals).

## 11. Online Client Duplication Risk (no duplicate message)

- Socket.IO is the **primary transport** (message.created already reaches online customers — FASE 3 verified).
- Push must be a **signal only** (title/body/preview + deep-link `conversationId`); on click, open/focus `/c/<slug>` and fetch history. **No INSERT/append message** from a push handler.
- The gating rule: only push when the customer is **offline on Socket.IO** (eligibility). With the current dead store-level `isStoreOnline`, this gate cannot be reliably evaluated (§9) — a key risk to enforce "no duplicate bubble."

## 12. Push Payload Contract (per plan §14 / §12)

Minimal, no secrets:
```
{ conversationId, messageId?, title, body/preview, url/deep-link (/c/<slug>), timestamp }
```
- **MUST NOT** include: full conversation history, internal metadata, cost/margin, auth token, or any secret.
- `notification.created {storeId, conversationId, type, sender}` (impl-plan §10) is the internal EventBus form; the **push payload** (to the browser) is a separate, minimal subset.

## 13. Failure Semantics (notification is secondary)

- Push failure → message/`message.created` **must still succeed** (Socket.IO delivers if online). Notification error → logged, not propagated.
- No rollback of message / human reply / status (task §16 F).
- No infinite retry (task §16). → design requirement; no current impl to violate it yet.

## 14. Invalid Subscription Handling

- `web-push` errors `404`/`410`/`expired`/`invalid` → **delete** the stale `pushSubscription` row (customer-store), **without** touching conversation/message.
- No code exists yet (would live in `notification.service.ts`); design as a post-publish cleanup step.

## 15. Multi-Tenant Security

- Subscription must bind to `storeId` + `webUid` (Customer). The PWA customer auth (`slug`+`webUid`) already resolves `storeId` authoritatively in `authGuard` (RealtimeService lines 113-156) — **reuse this pattern** for `/subscribe`.
- Do NOT trust client-supplied `storeId`/`customerId` — server resolves from slug+uid (tenant isolation proven in FASE 1 smoke [2]/[3]).
- **Feasible** but must be implemented carefully (risk note, not a hard block).

## 16. Auth / Security

- Customer Web push subscription: verify store + customer/webUid via the existing slug+uid auth pattern (§15).
- **Admin push is OUT OF SCOPE** for FASE 4 (task §19 explicitly: "Fase 4 fokus customer Web notification kecuali plan secara eksplisit mengatakan admin push"). The impl-plan §8 mentions optional admin push — treat as optional/out-of-scope unless owner decides.
- VAPID private key → server env only; **never** in source/Git/frontend bundle (§8/H).

## 17. Service Worker

`apps/pwa/public/sw.js` (33 lines, manual, no vite-plugin-pwa/workbox):
- Owner confirmed: registered at `/c/sw.js` (scope `/c/`, production), single SW, `clients.claim()` on activate, fetch pass-through (skips `/api/`).
- PWA served at production sub-path `/c/` (`qlobot.web.id/c/<slug>`); dashboard at `/` has **no** SW → **no scope/SW conflict** (FASE 3/4 safe).
- **Currently has NO** `push`, `notificationclick`, or `pushsubscriptionchange` handlers, and no `Notification`.
- **→ Extend the existing owner SW** (add `push` → `self.registration.showNotification(...)`, `notificationclick` → focus/open `/c/<slug>`, `pushsubscriptionchange`); do **NOT** create a second SW (task §9 stop condition C not met — ownership is clear).
- `manifest.json` exists in `public/` — PWA is installable (no scope change needed).

## 18. PWA Installation / Registration

`apps/pwa/src/main.tsx:21`: registers `/c/sw.js` on `load`. No `Notification.requestPermission` / `PushManager.subscribe()` in the client today → FASE 4 must add permission request (likely in `ChatPage.tsx` or a new PWA util) + subscription send to `POST /pwa/:slug/subscribe`. `vite.config.ts`: manual SW, no PWA plugin. Scope `/c/` is correct and isolated.

## 19. Existing FASE 3 Integration Points (for the trigger wiring)

FASE 4 hooks into the existing FASE 3 delivery path without touching the engine/WA/Socket.IO foundation:
- **Producer (trigger):** `apps/api/src/services/conversation-delivery.service.ts` (FASE 3, **not** in the protected/engine list) — the impl-plan §3 says "delivery publish notification.created bila lawan belah pihak offline." Currently `notification.created` is **never published** — the gap-patch-level integration point is here (or in a thin notification service subscribed to `message.created`).
- **Dispatch (reuse):** `RealtimeService.dispatch` already routes `notification.created` to rooms (lines 239-243) — **do not modify** this foundation.
- **Eligibility:** `RealtimeService.isStoreOnline` — exists but dead/store-level (§9).
- Engine (`conversation.service.ts`), WA gateway, mutex, FASE 1 realtime foundation, FASE 2 mapping: **untouched** (verified via `git diff 69d8859..12fd702 -- <protected>` = 0 lines).

## 20. Test Strategy (drafting, since no impl exists yet)

- **T12-style** runtime test (mirror `smoke-fase3-chatbox.ts`): boot ephemeral Express+WS; assert `POST /pwa/:slug/subscribe` persists a subscription; assert a `message.created {sender:human_agent}` to an **offline** customer triggers a push (mock `web-push` send) and **not** to an online customer (no duplicate); assert invalid subscription (410) is deleted; assert push failure does not rollback the message/row count.
- Unit tests for `notification.service.ts` eligibility logic (online vs offline) and subscription resolve.
- No jest `node:test` shim changes needed — keep in-proc EventBus + WS like the FASE 1/3 smoke pattern.

## 21. STOP Conditions (§30) status

| Cond | Condition | Met? | Evidence |
|---|---|---|---|
| A | `Customer.pushSubscription` schema missing + migration required + not approved | **YES ⛔ STOP** | §5: no column; §5/§22: persistent storage requires migration; not approved (pre-impl) |
| B | SW ownership unclear | No | §17: single owner SW at `/c/` |
| C | Existing PWA SW managed by another tool / risk of 2nd SW | No | §17: manual SW, no `vite-plugin-pwa` |
| D | Notification requires Conversation Engine changes | No | trigger is in delivery service / notification service (external to engine) |
| E | Push becomes primary transport | No (by design) | Socket.IO remains primary; push = signal (§11/§13) |
| F | Push failure rolls back message | No (by design) | notification is secondary (§13) |
| G | Multi-tenant ownership not guarantable | No (design is sound) | reuse slug+uid auth pattern (§15) |
| H | VAPID secret exposure risk | **YES ⚠️ (design risk)** | VAPID absent today → must generate at deploy, never source/git/frontend (§8/§16) |
| I | Admin/customer auth semantics unclear | No | customer auth clear; admin push out of scope (§16/§19) |
| J | Online/offline eligibility has no authoritative source | **YES ⛔ STOP** | §9: `isStoreOnline` dead code + store-level + in-memory; not authoritative per-customer |
| K | Existing notification impl conflict | No | `notification.created` is dormant (subscribed but never published) — no conflict, but no producer |

## 22. Database / Migration Requirement (§22)

- **`Customer.pushSubscription Json?`** (impl-plan §11, §22 recommends **Opsi A**) is **ABSENT**.
- Persistent subscription storage requires a migration → **STOP condition A** → **do not migrate in this inspection phase**; report the exact gap (this section).
- This is the single schema change blocking FASE 4 implementation (a 1-column nullable addition, low risk, but must be approved + scheduled).

## 23. Recommended Implementation Sequence

1. **OWNER DECISION (BLOCKERS):** approve (a) `Customer.pushSubscription Json?` migration (Opsi A) and (b) online-eligibility authority for `isStoreOnline` (per-customer? persist/reconnect grace? or accept store-level on single-instance?).
2. Add `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` to `.env` + `.env.example`; install `web-push` server dep.
3. Add `POST /pwa/:slug/subscribe` route (auth via slug+uid → storeId+customer; persist `Json?`). Add `/unsubscribe` (delete on 410/expired).
4. Create `services/notification.service.ts`: subscribe to EventBus `message.created` (filter sender=human_agent + channel=web) → `isStoreOnline(storeId)` eligibility → if offline → publish `notification.created` and/or directly `web-push` to the persisted subscription (minimal payload, no secrets).
5. Extend `apps/pwa/public/sw.js` with `push` + `notificationclick` (`pushsubscriptionchange` optional).
6. Add client-side `Notification.requestPermission` + `PushManager.subscribe()` in PWA (`main.tsx`/ChatPage), POST subscription to `/subscribe`.
7. **Do NOT modify** engine, WA, mutex, Socket.IO foundation, FASE 1 realtime, FASE 2 mapping, schema (except the approved `pushSubscription` column).
8. Add tests (T12 smoke + unit eligibility) mirroring `smoke-fase3-chatbox.ts` patterns.
9. Re-run FASE 1/2/3 regression (must stay green).

## 24. FINAL VERDICT

### ⛔ BLOCKED — NEED OWNER DECISION

The FASE 4 **design and most boundaries already exist and are reusable** (EventBus `notification.created` contract, RealtimeService subscribe+dispatch of it, the existing owner SW at `/c/`, the Customer model, the slug+uid web auth pattern). This is not a ground-up feature.

However, two **owner-decision blockers** prevent safe implementation now:

1. **Schema migration (STOP A):** `Customer.pushSubscription` does **not** exist; persistent subscription storage (task-required) mandates a migration (plan §11/§22 explicitly: "DATABASE MIGRATION: YES" — Opsi A recommended). **Not approved → STOP.** Action: owner approves the `Customer.pushSubscription Json?` column (or Opsi B table) before implementation.

2. **Online-eligibility authority (STOP J):** `isStoreOnline` exists but is (a) **dead code** (zero callers), (b) **store-level not per-customer** (discrepancy vs impl-plan §9), and (c) **in-memory + per-instance** (resets on restart/PM2). There is **no authoritative server-side per-customer online state**. Push-gating on "customer offline" cannot be reliably implemented without resolving this. Action: owner decides the authoritative eligibility mechanism.

Secondary design risks to confirm (not hard blocks): VAPID secret generation/handing (§16/H — generate at deploy, never in source/Git/frontend); and that `notification.created` is currently **dormant** (subscribed/dispatched but never published) — FASE 4 must add the producer without breaking the FASE 3 `RealtimeService` foundation.

> If the owner approves **(1)** the `Customer.pushSubscription Json?` migration and **(2)** the per-customer online-eligibility approach, FASE 4 proceeds to `READY FOR IMPLEMENTATION` using the reusable assets above, with zero changes to engine/WA/mutex/Socket.IO/FASE 1 foundation.

**STOP** — no code written, no deps installed, no migration run, no commit, no PM2 restart. This inspection report is documentation only.
