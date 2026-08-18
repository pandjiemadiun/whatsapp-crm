# FASE 5 — PRE-IMPLEMENTATION INSPECTION REPORT
## QLOBOT CHATBOX — PWA Chatbox Redesign + Commerce UI

**Mode:** READ-ONLY / INSPECTION ONLY — **NO source edits, NO installs, NO migrations, NO commits, NO deploy, NO PM2 restart.**

**Basis:** Repository working tree + git history + typecheck/build + existing test output + runtime smoke evidence (see §1). Where DOCS and source diverge, **source is authoritative** and the discrepancy is reported.

---

## 0. EXECUTIVE SUMMARY (TL;DR)

| Area | Status | Evidence |
|---|---|---|
| Git state | CLEAN post-FASE4 | HEAD `8289f5b`; working tree = `.env` + `apps/api/dist/*` + `apps/api/logs/*` only; **0 uncommitted source** |
| Engine / WA / realtime / notification | PROTECTED — do not touch | `conversation.service.ts`, `services/chat/*`, `order.service.ts`, `conversation-context.service.ts`, `message-queue/message-processor`, `routes/webhooks.ts`, `routes/messages.ts`, `routes/conversations.ts`, `fonnte.service.ts`, `gowa.adapter.ts`, `realtime.service.ts`, `conversation-delivery.service.ts`, `notification.service.ts`, `vapid.config.ts`, `schema.prisma` (only `pushSubscription` line added in FASE4) |
| Structured data pipeline to PWA | COMPLETE ✅ | `message.created` (WS) + `/message` (HTTP) + `/history` all carry authoritative `type` + `payload` (HARD RULE #11/#12, `conversation-delivery.service.ts:206-266`, `routes/pwa.ts:159-276`) |
| Structured rendering | ABSENT ❌ | `ChatPage.tsx` stores `type`/`payload` in `HistoryMsg` (l.20,147,373,381) but render (l.454-461) passes only `role/text/source` to `ChatBubble` → all structured messages render as plain text |
| `human_agent` distinction | ABSENT in PWA ❌ / PRESENT in Dashboard ✅ | PWA `ChatPage.tsx:205` maps `human_agent`→`role:'assistant'` (identical to AI); Dashboard `ConversationInbox.tsx:383-388` correctly maps `human_agent`→`'agent'` |
| Authored structured types (backend) | 6 of 13 | `text`, `quick_reply`, `cart`, `product`, `product_list`, `handoff` — per `classifyStructured`/`mapStructured` + test assertions |
| Non-authored (placeholder) types | 7 of 13 | `button`, `order`, `checkout`, `image`, `system`, `payment`, `notification` → **always** `text` fallback (test l.245-254) |
| Commerce read API (PUBLIC to customer) | OK | `GET /api/stores/:storeId/products`, `GET /api/products/:id`, `GET /api/stores/:id/products/search` (`routes/products.ts`) |
| Commerce write API (customer) | MISSING | `routes/orders.ts` = owner-auth only; **no** customer cart/checkout/order-status/payment endpoint exists |
| Checkout / payment backend | MISSING | No gateway, no session, no `CheckoutSession`/`PaymentIntent` type; checkout = engine-side heuristic `finalizeDraftOrder`(`draft`→`waiting_address`); payment = intent classification only (`fallback.service.ts:130`) → still `text` |
| PWA test infra | NONE | `apps/pwa/package.json` has no test script; deps = `axios/react/react-dom/react-router-dom/socket.io-client` + tailwind/vite/ts; **no vitest/jest/cypress/playwright**; **no chromium** binary on host |
| Typecheck/build | GREEN ✅ | `npx tsc --noEmit -p tsconfig.app.json` exit 0; `npm run build` (`tsc -b && vite build`) ✓ 1.92s |

**Verdict (preliminary):** FASE 5 is **READY** for implementation **as a PRESENTATION-LAYER effort**, with the explicit, documented constraint that **`order` / `checkout` / `payment` / `button` / `image`(standalone) / `system` / `notification` UI MUST render as text fallback** (no authoritative backend data exists for the customer), and **checkout/payment interactivity is BLOCKED** unless a customer checkout/payment backend is separately authorized.

---

## 1. GIT FORENSIC (post-FASE4)

Commands run (fresh, at inspection time):

```
$ git log --oneline -15
8289f5b feat(chatbox): FASE 4 web push notification      <- HEAD
29293ce docs(fase3): record admin-typing gap-patch completion
12fd702 fix(chatbox): complete FASE 3 admin typing
5090b2f docs(fase3): re-verification report (green) after connection interruption
4bd59d8 docs(fase3): record FASE 3 commit hash & stat in report
467ecef feat(chatbox): FASE 3 dashboard human messaging
69d8859 feat(chatbox): FASE 2 structured payload — authoritative quick_reply/cart/product
8a1c0f7 feat(chatbox): FASE 2 structured message mapping (authority-only, same-row update)
8e75e37 feat(chatbox): FASE 1 Web realtime foundation
74dd0f4 fix(PWA.20): baca response envelope {success,data:{store|history}} di ChatPage …
5a8e92b feat(PWA.19): deploy apps/pwa ke production …
…
```

```
$ git status --short
 M .env
 M apps/api/dist/...**                      (build artifacts: .js/.js.map/.d.ts)
 M apps/api/logs/combined.log               (runtime log)
 M apps/api/logs/error.log
 M apps/api/logs/exceptions.log
?? DOCS/05_PWA_IDENTITY_BLUEPRINT.md
?? DOCS/contract-chatbox.md
?? DOCS/laporan-audit-chatbox-qlabot.md     (plus other untracked DOCS reference files)
?? apps/api/dist/config/vapid.config.*      (stale build artifact, not source)
```

```
$ git diff --stat HEAD
 .env                                    |  3 +
 apps/api/dist/**/*                       (27 files: .js/.map — recompiled build output)
 apps/api/logs/*                          (combined.log 5705+/error.log/exceptions.log)
```

**A. FASE 2 last commit** → `8a1c0f7` (FASE 2 structured message mapping).
**B. FASE 3 commit** → `467ecef` (FASE 3 dashboard human messaging) + `5090b2f` re-verification.
**C. FASE 4 commit** → `8289f5b` (HEAD). ✅
**D. Modified files** → `.env`, `apps/api/dist/*` (build artifacts), `apps/api/logs/*`.
**E. Untracked files** → `DOCS/*.md` reference docs (read-only input, not source) + stale `apps/api/dist/config/vapid.config.*`.
**F. Partial implementation of FASE 4 still in tree?** → NO. All FASE 4 files listed in the FASE 4 report are committed at `8289f5b`; `git diff --stat HEAD` shows only `dist`/`logs`/`.env` changes — **no uncommitted source**.
**G. Source changed but not committed?** → NO tracked source file is modified vs HEAD.

**Conclusion §1:** FASE 5 starts from a **clean, FASE-4-committed baseline**. `apps/api/dist/*` and `apps/api/logs/*` are ambient build/runtime artifacts (excluded from FASE scope unless proving relevance). `.env` is ambient (excluded). No FASE 5 work has been started.

> **DISCREPANCY note:** `.env` shows as `M` — redacted in this context; **do not** rely on file contents. The committed source baseline is authoritative.

---

## 2. PWA STRUCTURE (apps/pwa/src)

Tree (9 source files):

```
apps/pwa/src/
├── App.tsx                  # Router: /c/:slug -> ChatPage; * -> NotFound. (14 lines)
├── components/
│   ├── ChatPage.tsx         # 503 lines — MONOLITHIC page (all chat state + render)
│   ├── ChatBubble.tsx       # 44 lines — single bubble renderer (role/text/source/isTyping)
│   ├── NotificationPrompt.tsx# 106 lines — FASE 4 push opt-in (permission + subscribe)
│   └── NotFound.tsx         # 404
├── index.css                # Tailwind v4 import + @color-brand + dot-pulse animation (25 lines)
├── main.tsx                 # ReactDOM.createRoot, BrowserRouter, ChatPage (no global state)
├── services/
│   └── api.ts               # 38 lines — axios baseURL '/api'; WS config + createChatSocket
└── utils/
    └── vapid.ts             # 11 lines — urlBase64ToUint8Array (public-key decode for push)
```

| File | Responsibility | Current Behavior | FASE5 Action |
|---|---|---|---|
| `ChatPage.tsx` | Page state + render (monolith) | Loads store/init + history; WS `message.created` listener; send via `/message`; typing `/typing`; read `/read`; install banner | **MODIFY** — add structured dispatch + human_agent role; extract child components |
| `ChatBubble.tsx` | Single bubble | Props `role:'user'|'assistant'|'system'` + `text/source/isTyping`. Styles: user=blue-right, assistant/system=gray-left, system=gray-100. `isTyping`→"mengetik"+dot-pulse. **No `type`/`payload`/`human` role.** | **MODIFY** — add `role:'agent'` (or `'human'`) variant; accept typed payload or delegate to a `MessageRenderer` |
| `api.ts` | HTTP + WS client | `baseURL:'/api'` (no auth interceptor — web customer is anonymous); `createChatSocket({slug,uid,conversationId})` WS path `/api/ws`, `transports:['websocket']`, reconnect 10× (1–5s), timeout 10s. `WS_BASE_ORIGIN` = dev `http://localhost:3000` else same-origin | UNCHANGED (presentation layer) |
| `App.tsx` | Routes | `/c/:slug` → ChatPage | UNCHANGED |
| `main.tsx` | Bootstrap | createRoot, BrowserRouter | UNCHANGED |
| `index.css` | Styles | Tailwind v4 via `@import "tailwindcss"`; `--color-brand:#1B53F5`; `dot-pulse` keyframes. **No design-token system, no component library.** | EXTEND (design system) |
| `index.html` | Shell | manifest `/c/manifest.json`, `theme-color #1B53F5`, script `/src/main.tsx` | UNCHANGED |
| `NotificationPrompt.tsx` / `vapid.ts` | FASE 4 push | Opt-in + subscribe/unsubscribe + vapid decode | UNCHANGED (FASE 4, regression boundary §16) |
| `services/api.ts` (dashboard) | PROTECTED | — | UNCHANGED |

**State ownership (ChatPage) is entirely local component state** (no global store): `messages`, `conversationId`, `webUid` (localStorage `garuda_pwa_uid`), `conversationStatus`, typing/read/send timers, `renderedIds` dedup ref, `deferredPrompt`. **No message-normalization layer** — `HistoryMsg` is flat `{id,role,content,source,type,payload,createdAt}`.

---

## 3. CURRENT CHAT UI

**Component structure:** Flat — `ChatPage` owns everything; `ChatBubble` is the only presentation atom. No list/composer/typing sub-components.

| Sub-system | Implementation | Evidence |
|---|---|---|
| Message list | `messages.map` → `<ChatBubble role/text/source>` | `ChatPage.tsx:454-461` — **`type`/`payload` dropped at render** |
| Empty state | `messages.length===0` → `<ChatBubble role="assistant" text="Halo! Ada yang bisa dibantu?" />` | `ChatPage.tsx:451-452` |
| Input composer | `<input>` + send button, `value=input`, `disabled=inputDisabled` | `ChatPage.tsx:490-503` |
| Typing indicator (customer→admin) | `reportTyping(typing)` → debounced 300ms → `POST /pwa/:slug/typing` → EventBus `typing.started/stopped` `{party:'customer'}` → admin room | `ChatPage.tsx:267-278`, `routes/pwa.ts:278-340` (server 1s throttle) |
| Typing indicator (admin→customer) | WS `typing.started/stopped` `{party:'human_agent'}` → `setIsAdminTyping(true)` → render "Admin sedang mengetik…" line | `ChatPage.tsx:233-238,464-468` |
| Connection indicator | `socket.on('connect')` → `scheduleReadAck` only. `connect_error` branch is a **no-op** (`if (err?.message?.startsWith('unauthorized')) {}` — empty). | `ChatPage.tsx:180-183, 240-245` — **NO visible online/offline/reconnect UI** |
| Read state | `scheduleReadAck()` → 1s debounce → `POST /pwa/:slug/read {uid,conversationId}` (server 5s throttle) → `conversation.metadata.webLastReadAt` (no history insert, no `message.created`) | `ChatPage.tsx:94-107, 182, 215`; `routes/pwa.ts:342-427` |
| Unread marker/badge | **ABSENT.** PWA only ACKs read; it does not track or render an unread count/badge on `/history` nor a "new messages" divider. (Dashboard tracks `unreadCount` server-side.) | `ChatPage.tsx` — no unread UI element |
| Loading state | `<p>Memuat…</p>` | `ChatPage.tsx:408-414` |
| Error state | `<div className="text-red-600">{error}</div>` (send errors); 404 store → "Toko tidak ditemukan" | `ChatPage.tsx:416-423, 483-485` |
| Reconnect / catch-up | `socket.io(reconnect)` → re-fetch `/history`, append missing (dedup by `id`), `scheduleReadAck` | `ChatPage.tsx:247-260` |
| Dedup | `renderedIds.current` Set; seeded from history (l.150) + HTTP messageId (l.337) + WS (l.201) | `ChatPage.tsx:80,150,201,337` |
| Scroll | `bottomRef.scrollIntoView({behavior:'smooth'})` on mount msgs list + each new msg | `ChatPage.tsx:168, 213, 374, 382, 255` |

**human_agent rendering:** `ChatPage.tsx:205` — WS `sender==='human_agent'` → `role:'assistant'`. Identical bubble to AI. **Gap.**

**structured message rendering:** `ChatPage.tsx:454-461` — `ChatBubble` receives only `role/text/source`. `type`/`payload` are parsed into `HistoryMsg` and persisted in state but **never passed to a renderer**. **Gap.**

---

## 4. HUMAN_AGENT UI GAP

**Exact current mapping (PWA):**
- WS handler `ChatPage.tsx:198-211`:
  ```ts
  if (data.sender !== 'assistant' && data.sender !== 'human_agent') return
  // …
  setMessages((m) => [...m, { id, role: 'assistant', content: data.content, source, type, payload, createdAt }])
  ```
  → **both** `assistant` (AI) and `human_agent` (admin) are normalized to `role:'assistant'`.
- `HistoryMsg.role` type = `'user' | 'assistant' | 'system'` (no `human_agent`/`agent`).
- `ChatBubble` role check: `role==='user'` → blue-right; else gray-left. So admin == AI visually.

**Exact current mapping (Dashboard — reference, PRESENT):**
- `ConversationInbox.tsx:383-388`:
  ```ts
  const role = data.sender === 'customer' ? 'user'
            : data.sender === 'human_agent' ? 'agent'
            : 'assistant'
  ```
  → admin is `'agent'`, distinct from `'assistant'`.

**Fix location (presentation-only):**
1. `ChatPage.tsx` WS handler: map `sender==='human_agent'` → `role:'agent'` (mirror dashboard). Also map history `role:'agent'` (DB stores admin messages as `role:'agent'` via `routes/conversations.ts:186` insert; `HistoryMsg.role` should include `'agent'`).
2. `ChatBubble.tsx`: add a `'agent'`/`'human_agent'` variant (distinct from assistant — e.g., teal/amber bubble with an "Admin" badge), keeping `role` as the discriminator.
3. Optionally unify role vocabulary: `user | assistant | agent | system`.

**Constraints honored (no scope creep):**
- ✅ No change to DB `conversation_history.role` values (`assistant`, `user`, `agent`, `customer` source).
- ✅ No change to persistence / EventBus / `message.created` shape (`sender:'human_agent'` intact).
- ✅ No change to `processCustomerMessage`/`saveMessage`/`buildResult`/`getOrCreateContext`/`acquireLock`.
- This is a **render-time normalization** — exactly the Presentation Layer scope.

---

## 5. STRUCTURED MESSAGE CONTRACT (data that reaches the PWA)

Authoritative shape comes from `MessageCreatedData` (`conversation-delivery.service.ts:30-45`) and is identical on WS + HTTP (HARD RULE #11/#12):

```ts
type SenderParty = 'assistant' | 'customer' | 'human_agent'
type StructuredMessageType =
  | 'text' | 'product' | 'product_list' | 'cart'
  | 'quick_reply' | 'button' | 'order' | 'checkout'
  | 'image' | 'system' | 'handoff' | 'payment' | 'notification'

interface MessageCreatedData {
  id: string              // conversation_history.id (single identity, HARD RULE #3)
  conversationId: string
  sender: SenderParty
  type: StructuredMessageType
  payload: Record<string, unknown> | null   // null for text
  content: string
  source: ResponseSource
  confidence: number | null
  createdAt: Date
}
```

**Delivery path to PWA — three identical channels:**
- **WS** `message.created` → `ChatPage.tsx:186-216` (handler receives `{id,sender,type,content,source,confidence,createdAt,payload}`).
- **HTTP** `POST /pwa/:slug/message` → `routes/pwa.ts:261-271` returns `{messageId,type,payload,content,source,confidence,timestamp}`.
- **HTTP** `GET /pwa/:slug/history` → `routes/pwa.ts:134-149` normalizes per row: `type = h.messageType ?? 'text'`, `payload = (h.metadata as any).messagePayload ?? null`.

So the PWA receives the **full authoritative `type` + `payload`** on every channel. The contract is **complete at the transport layer**; only presentation is missing.

---

## 6. STRUCTURED PAYLOAD DATA AVAILABILITY (which types are actually authored)

Source of truth: `classifyStructured`/`mapStructured` (`structured-message.mapper.ts`) + assertions in `structured-message.test.ts`.

| type | Authored? | Payload shape (authoritative) | Evidence |
|---|---|---|---|
| `text` | ✅ always (fallback) | `null` | `mapper.ts:103,143`; `test T1/T6/T6B` |
| `quick_reply` | ✅ when `reason:'clarification_asked'` | `{reason:'clarification_asked', question:<content>, options:[{id,label,cartOps?:[{type,product,qty?,price?}],action?:string}]}` | `mapper.ts:112-114,165-169`; `test T2/T2-int` l.202-300 |
| `cart` | ✅ when `reason:'modify_cart'` + non-empty draft | `{reason:'modify_cart', cartOpsExecuted:<n>, items:[{id,productName,quantity,unitPrice,subtotal}], total:<n>}` | `mapper.ts:115-120,171-176`; `test T4/T4-int` l.212-365 |
| `product` | ✅ when `source===PRODUCT` + 1 matched name | `{id,name,price,stock,imageUrl}` (no internal fields like `costUSD`/`margin`) | `mapper.ts:134-136,177-179,227-238`; `test T3-int` l.387-409 |
| `product_list` | ✅ when `source===PRODUCT` + ≥2 matched names | `{items:[{id,name,price,stock,imageUrl}]}` | `mapper.ts:126-133,180-184`; `test T3-list-int` l.411-436 |
| `handoff` | ✅ when `reason:'escalation_clarification_retry_exceeded'` | `{reason, content}` | `mapper.ts:109-110,185-186`; `test` l.222-227 |
| `button` | ❌ NO | — (never dispatched; `default: text`) | `mapper.ts:187-188`; `test` l.245-254 |
| `order` | ❌ NO | — | `mapper.ts:187-188`; `classifyStructured` has no `order` branch |
| `checkout` | ❌ NO | — | same |
| `image` (standalone) | ❌ NO | — | no classification branch; image only appears **inside** `product`/`product_list` via `imageUrl` |
| `system` | ❌ NO (engine) | — | system bubbles ("Pesan diteruskan ke admin") are **client-created** `role:'system'` (`ChatPage.tsx:354-357,386-393`), not engine-authored |
| `payment` | ❌ NO | — | `fallback.service.ts:130` `tryPayment` is intent-only → `ResponseSource.PAYMENT` → `classifyStructured` returns `text` (no `payment` branch) |
| `notification` | ❌ NO (structured) | — | `notification.created` is **dormant** (declared, never published); FASE 4 consumes `message.created` directly (`summary` + `event-bus.service.ts`) |

**Key fact:** `classifyStructured` (pure, `mapper.ts:99-144`) has branches **only** for `handoff`, `quick_reply`, `cart`, `product`, `product_list`; **everything else falls through to `default: text`** (`mapper.ts:187-188`). So the 7 non-authored types are **forward-compatibility placeholders in the union** — they have no payload authoring path today. **The PWA must render these as `text` fallback (NOT as specialized UI) because no authoritative data will ever arrive.**

---

## 7. COMMERCE BACKEND — PRODUCT (public read)

`routes/products.ts` (PUBLIC — no `authMiddleware`):
- `GET /api/stores/:storeId/products` → `{products, pagination{limit,offset,total,hasMore}}` (`productService.getProductsByStore`)
- `GET /api/stores/:storeId/products/search?q=&offset=&limit=` → `{query, results, pagination}` (`productService.searchProducts`)
- `GET /api/products/:productId` → `{success,data:product}` (`productService.getProductById`)

`business/product.service.ts`:
- `getProductById(id)` returns `Product` = `{id,storeId,categoryId,name,description,price,currency,sku,stock,images,primaryImageUrl,isActive,source,createdAt,updatedAt,deletedAt}` + optional `category`. Stock `null` => unlimited (`checkStockAvailability`).
- `getProductsByStore(storeId,{limit,offset,sortBy,order})` returns `{products,total}`.
- `searchProducts(storeId,q)` — keyword extraction with stopwords (excludes payment/shipping keywords), max 20.
- **Image freshness caveat:** only the admin route `GET /api/products/my` refreshes R2 presigned `primaryImageUrl`/`images` URLs (`store-products.ts:90-103` calls `adapters.catalogStorage.refreshImageUrl`). The PUBLIC `GET /api/products/:id` returns `primaryImageUrl` **as stored** (7-day R2 presigned expiry). The `product` payload already carries `imageUrl` (refreshed at authoring time via `enrichProduct`→`getProductById`), so the chat payload is the freshest available; the PWA should **prefer the payload `imageUrl`** over a fresh `/products/:id` fetch.

✅ **Verdict:** Product read is **public and sufficient** for product/product_list rendering. No backend change needed.

---

## 8. COMMERCE BACKEND — ORDER (owner-auth only)

`routes/orders.ts` — **requires `authMiddleware`** (owner/admin only):
- `GET /api/orders` → list orders for authenticated store
- `GET /api/orders/:id` → order detail (ownership-checked)
- `PUT /api/orders/:id/status` → update `orderStatus` (validated against `VALID_ORDER_STATUSES`)

`orderStatus` lifecycle (schema `prisma/schema.prisma:217` + `order.service.ts`):
```
draft → waiting_address → waiting_payment → paid → packing → shipped
                    ↘ cancelled | completed | refunded
```
`VALID_ORDER_STATUSES = ['draft','waiting_address','waiting_payment','paid','packing','shipped','pending','cancelled','completed','refunded']`.

`business/order.service.ts`:
- `getOrdersByConversation(conversationId)` → `OrderWithItems[]` (used by mapper for cart enrichment).
- `finalizeDraftOrder` — engine-side, transitions `draft`→`waiting_address` on "done ordering" keyword heuristic (`order.service.ts:17-31`).
- `createOrder`/`addOrderItem`/`removeOrderItem`/`updateOrderStatus` — exist on the service but **are NOT exposed on any customer-facing route** (only admin `routes/orders.ts`).

**⚠ Critical gap for FASE5:** The `order` *structured message type* is **never authored** (see §6), AND the order-detail API is **admin-only**. So the **web customer can never receive an authoritative `order` message nor query order status via a public API.** A customer-facing order-detail UI is therefore **impossible without a new customer order/status endpoint** (out of scope — would touch `routes/orders.ts` + new route).

---

## 9. COMMERCE BACKEND — CART (engine-sided, display-only for PWA)

There is **no `Cart` table** (`schema.prisma` — confirmed: no `model Cart`). The cart is the **draft `Order`** (`orderStatus:'draft'`), owned by `order.service.ts`:
- `addConfirmedItemToOrder` / `syncCartStateToDraftOrder` — cart mutations, called by the **engine** (`conversation.service.ts` resolves clarification → `flattenPendingOps` → `addConfirmedItemToOrder`), NOT by the customer directly.
- `finalizeDraftOrder` — `draft`→`waiting_address`.
- The mapper `fetchCart` (`mapper.ts:211-224`) reads the draft order + maps `orderItems` → `{id,productName,quantity,unitPrice,subtotal}` + `total`. **Note:** `productId` is intentionally dropped from the cart payload (only `productName`).

**→ Customer cannot add/remove cart items via API.** Cart changes happen **only** through engine intent resolution (customer message matches a quick_reply option's `action`/`cartOps`, or LLM extracts add-to-cart intent). The PWA renders the cart **read-only** from the `cart` payload; any "add to cart" affordance is via the chat input or quick_reply buttons (→ `/message` text).

✅ **Verdict:** `cart` rendering is **presentation-only** and backend-supported (display of draft-order state). ✅ PWA-safe (read-only).

---

## 10. COMMERCE BACKEND — CHECKOUT / PAYMENT / SHIPPING

**Search result (exhaustive):** No customer-facing checkout, payment, or gateway route exists. Only:
- `order.service.ts:17-31` `DONE_ORDERING_KEYWORDS` — engine-side heuristic (`'checkout','bayar','total berapa','lunas','proses pesanan','kirim pesanan'`) that triggers `finalizeDraftOrder` (`draft`→`waiting_address`). **No payment collection.**
- `fallback.service.ts:130` `tryPayment` — intent classification only (`ResponseSource.PAYMENT` → `classifier` returns `text`). **No gateway.**
- `store.shippingMode`, `shippingFlatInCity/OutCity`, `acceptsQris/Cod/Transfer`, `qrisImageUrl` — **store profile fields** surfaced via `GET /pwa/:slug/init` (`routes/pwa.ts:30-47,66`), i.e. read-only display data.
- No `CheckoutSession`/`PaymentIntent` type in `domain/types.ts` (grep confirmed absent).
- No `/checkout`, `/payment`, `/stripe`, `/midtrans`, `/pay` route in `src/routes/` (grep `src/routes/`+`src/business/` confirmed: only `orders.ts` admin + engine heuristics).

| concept | backend existence | PWA customer access |
|---|---|---|
| Checkout (session/order finalize) | keyword heuristic only → `waiting_address` | No session/gateway |
| Payment (gateway/QR/invoice) | none | none |
| Shipping config | store profile (public) | read-only display |
| Order status | admin API only | **no** customer API |

**⚠ FASE 5 implication:** Any UI labelled "checkout" / "pay now" / "order status" that *actuates* must be **disabled/blocked** unless the owner authorizes a customer checkout+payment backend. The PWA may display shipping/payment *method hints* from `/init` (read-only) — presentation only.

---

## 11. BUTTON / QUICK_REPLY CONTRACT

**quick_reply (authored):**
- `ClarificationOption` (`domain/types.ts:283-288`): `{id:string, label:string, cartOps?:CartOp[], action?:string}`.
- `CartOp` (`domain/types.ts:275-280`): `{type:'add'|'remove', product:string, qty?:number, price?:number}` — price is a *hint*, replaced by DB at execution.
- `PendingClarification.expected_type`: `'affirmative' | 'choice' | 'yes_no'`.
- **Authoritative payload** (`test T2-int` l.261-300, `mapper.ts:165-169`): `{reason:'clarification_asked', question:<content>, options:[...]}`.
- **Customer action semantics:** the customer clicks an option → the PWA sends `option.label` as a **text message** via existing `POST /pwa/:slug/message` (`ChatPage.tsx:324-327`). The engine's resolver then matches the label to the pending option and **executes `cartOps` server-authoritatively** (`conversation.service.ts:422-508`, `conversation-context.service.ts:312-317` handle `action:'remove'|'swap'|'add'`). So `action:'add'`/`cartOps` are **already-resolved server signals**; the PWA only renders the label and dispatches a text message. ✅ No backend change; commerce authority stays server-side.

**button:** `classifyStructured` has **no `button` branch** → always `text`. The structured union includes `button` for forward-compat, but `test` l.245-254 explicitly asserts `button/order/checkout/catalog → text`. **No actionable button payload ever arrives.** PWA must NOT render actionable buttons for non-existent intent (would be fake).

---

## 12. HANDOFF UX

**Backend:**
- `Conversation.status` (`schema.prisma:146` default `'open'`) — values seen: `open | human_takeover | resolved`.
- `human_takeover` triggered by engine `human_takeover guard` (`conversation.service.ts:81`) → delivery publishes `conversation.handoff` + `conversation.updated{status:'human_takeover'}` + the customer message first (`conversation-delivery.service.ts:116-156`).
- Admin reply → `POST /conversations/:id/reply` (`routes/conversations.ts:186`) inserts `role:'agent', source:'dashboard'`, publishes `message.created{sender:'human_agent'}`.
- `conversation.resumed` (dashboard resume AI) and `conversation.resolved` (dashboard resolve) — `ConversationInbox.tsx:246-270` call `PUT /conversations/:id/status`.

**PWA (current):**
- WS listeners `ChatPage.tsx:220-230`: `conversation.handoff`→`human_takeover`, `.resumed`→`open`, `.resolved`→`resolved`, `.updated`→status.
- Render (`ChatPage.tsx:464-482`): typing line "Admin sedang mengetik…"; banners "Pesan Anda diteruskan ke admin. Mohon tunggu." / "Percakapan telah diselesaikan oleh admin."; footer disabled when `resolved`.
- Admin reply arrives as `message.created{sender:'human_agent'}` → currently rendered as `role:'assistant'` (the §4 gap).

✅ Handoff lifecycle is **wired end-to-end**; only the **visual distinction of the human_agent bubble** is missing.

---

## 13. READ / UNREAD (FASE 3)

- PWA: `POST /pwa/:slug/read {uid,conversationId,at?}` → server (5s throttle) writes `conversation.metadata.webLastReadAt` (JSON merge) + publishes `conversation.updated{webLastReadAt}` (`routes/pwa.ts:342-427`).
- Trigger: debounced 1s (`scheduleReadAck`) on WS connect + on new human/agent message (`ChatPage.tsx:107,182,215`).
- **No unread badge/divider on the PWA.** The PWA only ACKs; it does not compute or display unread counts or a "new messages" marker. (Dashboard computes `unreadCount` from `adminLastReadAt`.)
- `message.created` for read is intentionally NOT published (read = `conversation.updated` only) — HARD rule upheld (`routes/pwa.ts:343-345` comment).

✅ Read acknowledgement works. ⚠️ **No read/unread *presentation* (badge/divider/last-read marker)** — a FASE5 UI gap (presentation-layer).

---

## 14. TYPING

- **Customer→Admin:** `ChatPage.tsx:267-278` `reportTyping` (300ms debounce) → `POST /pwa/:slug/typing` → EventBus `typing.started/stopped{party:'customer',channel:'web'}` → admin room `store:{storeId}:admin` (server 1s self-throttle). `routes/pwa.ts:278-340` authorizes via store+webUid+conversationId.
- **Admin→Customer:** dashboard `ConversationInbox.tsx:130-154` `reportAdminTyping` → `socket.emit('admin_typing')` → server forwards `typing.started/stopped{party:'human_agent'}` to the customer's conversation room (`realtime.service.ts` customerPresence map, `store:{storeId}:conv:{id}`).
- PWA receives admin typing (`ChatPage.tsx:233-238`) → "Admin sedang mengetik…".
✅ Typing is **fully implemented** FASE1+FASE3. No change needed.

---

## 15. RECONNECT / CONNECTION UX

- `api.ts` `createChatSocket`: Socket.IO v4.8.3, `transports:['websocket']`, `reconnection:10×`, `reconnectionDelay:1s`→`5s`, `timeout:10s`.
- `ChatPage.tsx:247-260` on `reconnect` → re-fetch `/history`, append missing (dedup by id), mark read.
- **Gap:** `connect_error` handler (`ChatPage.tsx:240-245`) is a **no-op** (empty body; only checks `unauthorized`). There is **no visible offline/reconnecting indicator** and no explicit connection-state banner. The only liveness signal is the admin-typing line.
✅ Reconnect + catch-up work. ⚠️ **No connection-state UI** (offline/reconnecting banner) — presentation gap for FASE5.

---

## 16. NOTIFICATION INTEGRATION (FASE 4 — REGRESSION BOUNDARY)

FASE 4 is **COMPLETE & runtime-verified** (smoke `63 passed, 0 failed`; unit tests `4/4 pass`). Protected — **do not modify**:

| File | Role (FASE 4) |
|---|---|
| `apps/api/src/services/notification.service.ts` | `notificationService.sendNotification(message, customer.pushSubscription)`; type `'order_update'|'message_from_admin'` |
| `apps/api/src/services/realtime.service.ts` | `customerPresence: Map<string,Set<string>>` keyed `${storeId}:${conversationId}`; `isCustomerConversationOnline(storeId,conversationId)`; **eligible** customers get WS; ineligible get **push** (`realtime.service.ts` subscriber on `message.created`) |
| `apps/api/src/config/vapid.config.ts` | VAPID `(subject, PUBLIC, PRIVATE)` from `VAPID_SUBJECT/PUBLIC_KEY/PRIVATE_KEY` |
| `apps/api/src/index.ts` | `notificationService.init()` after `realtimeService.init` |
| `apps/api/src/routes/pwa.ts` | `/init` (returns `vapidPublicKey`), `/subscribe`, `/unsubscribe` (persist `Customer.pushSubscription`) |
| `apps/pwa/public/sw.js` | push event → `showNotification(title, body, icon, badge, data.url)`; notificationclick → focus/ open `data.url` |
| `apps/pwa/src/components/NotificationPrompt.tsx` | permission + `subscribe(pushSubscription)` + UI |
| `apps/pwa/src/utils/vapid.ts` | `urlBase64ToUint8Array` |
| `apps/api/prisma/schema.prisma` | `+ pushSubscription Json? // FASE 4` (only schema line changed in whole repo history) |

**How FASE 5 must interact with FASE 4 (do NOT touch):**
- FASE 5 UI should treat push as a *transport preference* only. When the customer is **online** (WS connected, `realtime.service.ts` `isCustomerConversationOnline` true → WS delivery), **no push** is sent for `message.created`. Push only fires when WS is absent (`realtime.service.ts` pushes on `message.created` when no online presence).
- **Do NOT** publish a new `notification.created` from FASE 5 UI (it is dormant by design; FASE 4 consumes `message.created` directly). FASE 5 UI should not re-implement push subscription logic (reuse `NotificationPrompt.tsx`).
- `sw.js` is the **only** service worker; do NOT add a second SW. Base URL is `/c/` — do NOT change `vite.config.ts` base (would break nginx `location /c/` → `8081/` strip-prefix contract, `vite.config.ts:15`).

**Regression risk:** Any FASE 5 change that alters the `message.created` shape, the `/init` envelope, or the SW registration path **breaks FASE 4**. Verify via `scripts/smoke-fase4-notification.ts` (63 asserts) after any UI change.

---

## 17. MEDIA / IMAGE

- **Standalone `image` structured type: NEVER authored** (see §6). `classifyStructured` has no image branch; image only arrives **inside** `product`/`product_list` payloads as `imageUrl` (`enrichProduct` → `primaryImageUrl`).
- `Product.images` (array `{url}`) + `primaryImageUrl` are stored on the `Product` row; public `GET /api/products/:id` returns them **as stored** (R2 presigned, 7-day expiry — not refreshed on public route). The chat `product` payload `imageUrl` is the freshest source (`mapper.ts:227-238 enricheProduct` calls `getProductById` at authoring/delivery time).
- **No customer image upload.** `routes/store-products.ts` image upload is **admin-only** (`authMiddleware`). PWA is read-only for media.
- `manifest.json` icons: `/icons/icon-192.png`, `/icons/icon-512.png` (PWA install assets, not chat images).

✅ Image rendering in FASE 5 = render `payload.imageUrl` inside `product`/`product_list` bubbles (fallback UI if null). ❌ Do NOT implement a standalone `image` message type (no backend authoring).

---

## 18. RESPONSIVE + PWA CONSTRAINTS

- **Base URL:** `vite.config.ts:15` `base:'/c/'` → production assets served at `/c/assets/*`; nginx `location /c/ { ... 8081/; }` strips `/c/`. **Do not change.**
- **Routing:** `App.tsx` `/c/:slug` → ChatPage; `*` → NotFound.
- **Manifest:** `public/manifest.json` — `display:'standalone'`, `theme_color:'#1B53F5'`, `background_color`, name+short_name, icons 192/512, `start_url:'/c/'`, `scope:'/c/'`. SW registered at `/c/sw.js` scope `/c/`.
- **index.html:** `theme-color #1B53F5`, manifest link, `script /src/main.tsx` (vite injects `/c/src/main.tsx` in build).
- **Install:** `beforeinstallprompt` captured (`ChatPage.tsx:287-303`), 7-day dismiss TTL in `localStorage.pwa_install_prompt`; Safari/iOS show manual instructions (no `beforeinstallprompt`). ✅ implemented (FASE 1.5).
- **Auth model:** web customer is **anonymous** (no Bearer); identity = `slug + webUid(localStorage garuda_pwa_uid) + conversationId` via WS query. Admin = Bearer `auth.token`. PWA `api.ts` has **no auth interceptor**.
- **Viewport:** `width=device-width, initial-scale=1.0` ✅.

✅ PWA constraints are sound; FASE 5 UI must stay within `tailwindcss v4` + the `/c/` base + the existing WS/HTTP contract.

---

## 19. ACCESSIBILITY + PERFORMANCE

**Accessibility (gaps):**
- `alt` on store avatar/img: `store.profilePhotoUrl` image has `alt={store.name||'Toko'}` ✅; product images (future) must set `alt`.
- No ARIA live regions (typing/read status are plain divs with `aria-label` only on banners).
- No `role`/`aria-live` on the scroll-to-bottom target.
- Inputs lack associated labels (the composer `<input>` has no `<label>`; relies on placeholder). Future quick_reply buttons need `aria-label`/keyboard focus.
- Color contrast: current bubbles use tailwind `bg-gray-200/100`, `bg-blue-600`; brand `#1B53F5`. Acceptable for now.

**Performance:**
- `ChatPage` is a single 503-line monolith — no virtualization; fine for chat volumes but message list grows unbounded (no trim).
- Each WS message triggers `scrollIntoView({behavior:'smooth'})` + `scheduleReadAck` (1s debounce). Acceptable.
- Image rendering: lazy via native `loading="lazy"` recommended for product images.
- `tsc --noEmit` + `vite build` are the only verification gates (no browser/E2E — see §21).

---

## 20. DESIGN SYSTEM

- **Foundation:** Tailwind CSS v4 (`@tailwindcss/vite` + `@import "tailwindcss"`). `index.css` defines only `--color-brand:#1B53F5` and the `dot-pulse` typing animation. **No design-token file, no component library (no shadcn/ui, no radix).**
- Colors used: `gray-100/200/400/500/600`, `blue-600`, `amber-50/800`, `red-*`, `green-*` (dashboard reference only). No shared token system between PWA and dashboard (dashboard uses its own `tailwind.config`/classes like `bg-line`/`text-muted`).
- Components: **ChatBubble** (1 atom) + **NotificationPrompt** (FASE 4). No `MessageList`, `Composer`, `TypingIndicator`, `StatusBanner`, `ProductCard`, `CartSummary`, `QuickReplyBar`.

⚠️ FASE 5 will need to **extend** `index.css`/`tailwind.config` with design tokens (e.g., `--color-human`, `--color-ai`, `--color-product-card`) — **no new dependency** (Tailwind arbitrary values/variants suffice). Do not introduce a component library (scope creep).

---

## 21. TESTING INFRASTRUCTURE + BROWSER AVAILABILITY

**PWA (`apps/pwa`):**
- `package.json` scripts: `dev`, `build` (`tsc -b && vite build`), `preview`. **No `test` script.**
- devDeps: `@tailwindcss/vite`, `@types/*`, `@vitejs/plugin-react`, `tailwindcss`, `typescript ~6.0.2`, `vite ^8.1.5`. **No vitest / jest / cypress / playwright / puppeteer.**
- `tsconfig.app.json`: `exclude: ['src/tests', ...]` — implies a tests dir *could* exist but none does.
- **No browser binary** on host: `chromium`, `chromium-browser`, `google-chrome`, `chrome`, `chrome-headless-shell` → all **MISSING**.

**API:** tests run via `node --test` (`tsx --test`), no browser needed. ✅

**Implication (source-verified vs browser-verified):** FASE 5 PWA changes can be verified by **type-check only** (`npx tsc --noEmit -p tsconfig.app.json` — currently exit 0) and **production build** (`npm run build` — currently ✓ 1.92s). **No E2E/browser smoke is possible** in this environment. Any browser-based claim is **source-verified by reasoning**, not executed. This is a **verification constraint**, not a blocker — flag it in FASE 5 DoD.

---

## 22. PROTECTED ARCHITECTURE (must NOT be modified in FASE 5)

**FASE 3 protected (Conversation Engine / Socket.IO foundation):**
- `business/conversation.service.ts` (`processCustomerMessage`)
- `business/fallback.service.ts`
- `business/order.service.ts`
- `business/conversation-context.service.ts` (`getOrCreateContext`)
- `services/message-queue.service.ts` (`acquireLock`)
- `services/message-processor.service.ts`
- `services/chat/*`
- `services/conversation-delivery.service.ts`
- `services/event-bus.service.ts` (`publish`/`subscribe`)
- `services/structured-message.mapper.ts` (classifier/enrichment — authoritative contract)
- `routes/webhooks.ts`
- `routes/messages.ts`
- `routes/conversations.ts` (admin reply path, `human_agent` publish)
- `adapters/whatsapp/gowa.adapter.ts`
- `services/fonnte.service.ts`
- `prisma/schema.prisma` (only `+ pushSubscription` diff is permitted)

**FASE 4 protected (notification):** `notification.service.ts`, `realtime.service.ts` (customerPresence/eligibility), `vapid.config.ts`, FASE 4 entries in `routes/pwa.ts` (`/subscribe`/`/unsubscribe`/`/init` vapid), `index.ts` init order, `public/sw.js`, `NotificationPrompt.tsx`, `utils/vapid.ts`.

**Functions that must remain byte-for-byte invariant:** `processCustomerMessage()`, `saveMessage()`, `buildResult()`, `getOrCreateContext()`, `acquireLock()`.

**Frontend rule (enforced by inspection):** The PWA must **never** decide `orderStatus`, `payment`, `cart` total, `product` availability/stock-of-truth, or `conversation` status. All of those are server-authored. The PWA renders the authoritative `message.created` payload **as-is** (text fallback for everything the engine doesn't author).

⚠️ **Commerce backends are inspect-only** (`routes/products.ts`, `routes/orders.ts`, `routes/store-products.ts`, `business/product.service.ts`, `business/order.service.ts`) — do not extend them in the UI task.

---

## 23. COMMERCE AUTHORITY MATRIX

| Feature | Authoritative source | PWA may render? | Constraint |
|---|---|---|---|
| **product** card (id/name/price/stock/image) | `message.created.payload` (enriched from `getProductById`) = `{id,name,price,stock,imageUrl}` | ✅ READ-ONLY display | Optionally fetch `GET /api/products/:id` (public) for richer detail; **prefer payload `imageUrl`** (fresher). Never compute price/stock. |
| **product_list** | payload `items:[{id,name,price,stock,imageUrl}]` | ✅ READ-ONLY | render as horizontal/vertical list of product cards. |
| **cart** summary (items+total) | payload `{items:[{id,productName,quantity,unitPrice,subtotal}], total, cartOpsExecuted}` | ✅ READ-ONLY display | Items lack `productId` (only `productName`) — do NOT try to look up products by id from the cart payload. Cart **mutation** is engine-sided; PWA click → `/message` text only. |
| **quick_reply** buttons | payload `{reason,question,options:[{id,label,cartOps,action}]}` | ✅ render as buttons | On click → `POST /pwa/:slug/message {message: option.label}`. Do NOT execute `cartOps` client-side. |
| **handoff** | payload `{reason, content}` | ✅ render as system/handoff bubble | human_agent rendering (§4). |
| **text** | `content` | ✅ | default. |
| **order** (status/detail) | ❌ NEVER authored; order API admin-only | ❌ Do NOT render order-detail UI | Would require new customer endpoint — BLOCKED. Render as text if it ever appears (defensive). |
| **checkout** (session) | ❌ no gateway/session backend | ❌ No interactive checkout | Keyword heuristic only → `waiting_address`. **BLOCKED** for actuation. |
| **payment** (gateway/QR) | ❌ none | ❌ No payment UI | `tryPayment` intent → text. **BLOCKED**. May display store method hints from `/init` (read-only). |
| **button** | ❌ never authored | ❌ | text fallback. |
| **image** (standalone) | ❌ never authored (image only inside product payload) | ❌ | render product image inside product card; no standalone image bubble. |
| **system** | client-only (`role:'system'`) | ✅ as status text | engine never emits `system` type. |
| **notification** | FASE 4 push (transport), not a message type | ✅ as a *transport* | do not render as a chat bubble type; push handled by SW. |

✅ = presentation-safe from authoritative data. ❌ = no authoritative data → **must be text fallback or blocked**.

---

## 24. PROPOSED COMPONENT ARCHITECTURE (FASE 5 — presentation only)

Derived from the current monolith (`ChatPage.tsx:454-461` drops `type`/`payload`). Proposal splits rendering but **keeps all state in `ChatPage`**:

```
apps/pwa/src/components/
├── ChatPage.tsx            # state owner (unchanged data flow); delegates render
├── MessageList.tsx          # scroll container + bottomRef + empty-state
├── MessageRenderer.tsx      # NEW: dispatch on `type` (source of truth)
│     ├─ TextMessage        # text
│     ├─ ProductCard        # product  (payload.id/name/price/stock/imageUrl)
│     ├─ ProductList        # product_list
│     ├─ CartSummary        # cart     (items + total; read-only)
│     ├─ QuickReplyBar      # quick_reply (buttons = option.label)
│     ├─ HandoffMessage     # handoff
│     └─ (fallback TextMessage) for: button|order|checkout|image|system|payment|notification
├── ChatBubble.tsx          # MODIFY: add `role:'agent'` variant (human_agent)
├── Composer.tsx           # NEW: input + send + quick_reply-aware (disabled states)
├── TypingIndicator.tsx    # NEW: AI "mengetik" + admin "Admin sedang mengetik…"
├── StatusBanner.tsx       # NEW: handoff/resolved banner (extracted from ChatPage:469-482)
├── ConnectionBanner.tsx    # NEW (gap §15): offline/reconnecting indicator
├── NotificationPrompt.tsx  # unchanged (FASE 4)
├── EmptyState.tsx         # NEW: greeting bubble
└── UnreadDivider.tsx      # NEW (gap §13): optional last-read marker
```

**`MessageRenderer` dispatch (canonical):**
```ts
switch (msg.type) {
  case 'product':      return <ProductCard p={payload} />;
  case 'product_list': return <ProductList items={payload.items} />;
  case 'cart':         return <CartSummary cart={payload} />;
  case 'quick_reply':  return <QuickReplyBar opts={payload.options} onPick={sendLabel} />;
  case 'handoff':      return <HandoffMessage />;
  default:             return <TextMessage text={msg.content} source={msg.source} />; // text + all placeholders
}
```
- `sendLabel(label)` → `onSend` already calls `POST /message{message:label}` — reuse the composer's send path (no new backend). ✅ presentation-only.
- `role` mapping: `customer→'user'`, `human_agent→'agent'`, `assistant→'assistant'`, `system→'system'`.

⚠️ This is a **proposal**. No code written.

---

## 25. DATA FLOW (FASE 5 must NOT change the engine contract)

```
Customer sends text
  → POST /pwa/:slug/message {uid, message}           (ChatPage onSend)
  → conversationDeliveryService.processWebRequest   (ONE acquireLock)
  → conversationService.processCustomerMessage      (engine: persist user + assistant)  [PROTECTED]
  → mapStructured(result, conv)                     (classify + enrich)               [PROTECTED]
  → UPDATE conversationHistory SET messageType+payload (SAME row, HARD RULE #3/#9)      [PROTECTED]
  → eventBus.publish('message.created', {sender,type,payload,content,...})              [PROTECTED]
      ⟶ WS: realtime delivers to customer room store:{storeId}:conv:{id}        (FASE 3) [PROTECTED]
      ⟶ /history HTTP: normalized type=payload.messagePayload                      (FASE 2) [PROTECTED]
  → PWA: message.created.data → HistoryMsg{type,payload} → MessageRenderer       (FASE 5) ⬅ HERE
```

The **only** FASE 5 touchpoint is the **render** step (PWA consumes the already-delivered `type`/`payload`). Engine/lock/persistence/event shape are immutable.

---

## 26. IMPLEMENTATION RISK REGISTER

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Rendering a non-authored type (order/checkout/payment/button) with fake data | Medium | High (authority leak) | `MessageRenderer` whitelist = only `product|product_list|cart|quick_reply|handoff|text`; everything else → text fallback. Never fabricate. |
| R2 | Cart items lack `productId` → product image lookup impossible | Certain | Medium | Render cart as text/names+quantities+total only; do not attempt image enrichment. Use `/init` shipping hints read-only. |
| R3 | Product image `imageUrl` (R2 presigned, 7-day) expires in chat history | Low | Low | Prefer payload `imageUrl` (fresh at delivery); fall back to `GET /api/products/:id` on error. |
| R4 | `connect_error` no-op leaves user with no offline signal | Certain | Low | Add `ConnectionBanner` reading `socket.io` readyState (presentation only). |
| R5 | Monolith refactor breaks existing FASE1/F3/F4 wiring (WS/typing/read/install) | Medium | High | Keep `ChatPage` as state owner; extract render children only; run `tsc --noEmit` + `vite build` + FASE4 smoke after. |
| R6 | `human_agent` vs `agent` role drift vs DB `conversation_history.role='agent'` and history envelope `role` | Medium | Low | Normalize once: `sender==='human_agent' → role:'agent'`; include `'agent'` in `HistoryMsg.role` union; `ChatBubble` handles `'agent'`. |
| R7 | No browser/E2E available → cannot visually verify bubble distinction | Certain | Medium | Source-verify via `tsc`+`build`; manual checklist of role→variant mapping. |

---

## 27. ACCEPTANCE CRITERIA DRAFT (FASE 5 — presentation)

A. **human_agent distinct** — admin reply renders in a visually distinct bubble (e.g., teal/amber + "Admin" label), NOT identical to AI `assistant`.
B. **structured message rendering** — `MessageRenderer` dispatches on `type` to render `product`, `product_list`, `cart`, `quick_reply`, `handoff`; all other types render as `text` (no fabricated data).
C. **product card** — shows `name`, formatted `price`, `stock` badge (null stock = "stok tidak terbatas"), `imageUrl` thumb (if present) — from payload; no backend call for price/stock.
D. **cart summary** — shows items (name×qty × unitPrice = subtotal) + `total`, read-only (no client-side mutation).
E. **quick_reply** — renders `options[].label` as tappable buttons; each button sends `label` via existing `/message` text path; does NOT execute `cartOps` client-side.
F. **connection banner** — shows reconnecting/offline state derived from `socket.io` readyState.
G. **no unread badge regression** — read ack (`/read`) still fires (must not break FASE 3).
H. **no FASE 4 regression** — push subscription + `NotificationPrompt` intact; `tsc --noEmit` exit 0; `vite build` ✓; `scripts/smoke-fase4-notification.ts` still 63/0 (re-run if any `message.created`/envelope change).
I. **no protected file change** — `git diff --name-only` of protected set = ∅ (except the committed `schema.prisma pushSubscription` line).
J. **type safety** — `pwa tsconfig` has `noUnusedLocals:true`, `verbatimModuleSyntax:true`; build must pass.

---

## 28. VERIFICATION PLAN (no browser available)

1. `cd apps/pwa && npx tsc --noEmit -p tsconfig.app.json` → expect exit 0.
2. `cd apps/pwa && npm run build` → expect `✓ built` (tsc -b + vite).
3. `cd apps/api && npx tsc --noEmit -p tsconfig.json` → exit 0 (no backend change expected).
4. Re-run `npx tsx --env-file=../../.env scripts/smoke-fase4-notification.ts` → `63 passed, 0 failed` (regression gate).
5. Confirm `git diff --name-only HEAD` (excl dist/logs/.env) shows **only** the intended new/modified PWA files.
6. **No E2E possible** (no chromium, no test runner) — FASE 5 acceptance is type+build+reasoning source-verified. Document this as a verification limitation.

---

## 29. STOP CONDITIONS / BLOCKED TRIGGERS

FASE 5 implementation MUST **stop and re-surface for owner decision** (do not silently extend scope) if any of these is required:

1. **A structured type outside the authored-6 set** is needed as a live, interactive UI (i.e., the engine is expected to emit `button`/`order`/`checkout`/`image`/`system`/`payment`/`notification`). → Requires engine change to `classifyStructured`/`mapStructured` (**PROTECTED**). **BLOCKED — needs owner.**
2. **Customer order status / order-detail view.** → No public order API (`routes/orders.ts` admin-only). → **BLOCKED — needs new customer route.**
3. **Interactive checkout + payment.** → No gateway/session backend. → **BLOCKED — needs payment backend.**
4. **A second service worker or a `base` change from `/c/`.** → Breaks nginx push contract. → **BLOCKED — do not proceed.**
5. **PWA deciding cart-total / product-stock / orderStatus / conversation-status.** → Authority leak. → **BLOCKED — redesign.**
6. **Installing a browser or test runner** to "enable E2E". → Outside the "no install" rule for inspection; defer to implementation phase with owner approval.

None of these are triggered by the *safe* presentation work (§24). They are guardrails.

---

## 30. REGRESSION BOUNDARIES vs FASE 1 / 2 / 3 / 4

| Surface | Owned by FASE | FASE 5 must NOT break | Verification |
|---|---|---|---|
| WS `message.created` payload shape (`sender/type/payload`) | F2/F3 | ✅ preserve exact fields | smoke-fase4 + fase3 + typecheck |
| `/pwa/:slug/history` envelope (`{history:[{role,type,payload}]}`) | F2/F3 | ✅ | typecheck + manual |
| `/pwa/:slug/message` HTTP envelope (`type`/`payload`) | F2/F3 | ✅ | smoke-fase3 |
| read ack (`POST /read`, `webLastReadAt`, no `message.created`) | F3 | ✅ (`scheduleReadAck`) | typecheck |
| typing (`POST /typing`, `typing.started/stopped{party}`) | F1/F3 | ✅ (`reportTyping`) | typecheck |
| admin reply → `sender:'human_agent'` publish | F3 | ✅ (`routes/conversations.ts:186`) | conversations.ts unchanged |
| `human_agent` WS handling | F3 | ✅ (handler still accepts it) | — |
| install banner / beforeinstallprompt | F1.5 | ✅ | — |
| web-push subscribe/unsubscribe + SW + NotificationPrompt | F4 | ✅ protected | smoke-fase4 (63/0) |
| vapid `/init` `data.vapidPublicKey` | F4 | ✅ | — |
| `customerPresence` / online eligibility | F4 | ✅ (realtime.service) | — |

**Net:** FASE 5 is *additive* on top of the F1–F4 foundation. It changes **only** the PWA render layer. It neither mutates the engine's `message.created` shape nor the HTTP envelopes. The single regression risk is accidentally re-mapping `human_agent` wrongly or breaking the (already-wired) `type`/`payload` flow while refactoring the monolith.

---

## 31. GAP SUMMARY (what is missing today)

| Gap | Section | Fix scope |
|---|---|---|
| `human_agent` rendered as `assistant` | §4 | presentation (role normalization + ChatBubble variant) |
| `type`/`payload` received but not rendered | §5/6 | presentation (`MessageRenderer` dispatch) |
| No unread badge / last-read divider | §13 | presentation |
| `connect_error` no-op; no connection state banner | §15 | presentation (`ConnectionBanner`) |
| No `product`/`cart`/`quick_reply`/`handoff` UI | §7-12 | presentation (new components) |
| No `order`/`checkout`/`payment` UI | §10 | **backend missing** → blocked; text fallback only |
| No commerce mutation path for customer | §9/11 | engine-sided by design; click = text `/message` |
| No design tokens / component library | §20 | extend Tailwind (no new dep) |
| No browser/E2E verification | §21 | type+build+reasoning only |

---

## 32. DISCREPANCIES (DOCS vs Repository)

All discrepancies below are **DOCS vs source**; source is authoritative. None require docs editing during inspection (docs are read-only input).

| DOCS claim | Repository reality | Status |
|---|---|---|
| (FASE 3/4 reports describe completed states) | Verified: FASE 3 commit `467ecef`; FASE 4 commit `8289f5b` HEAD; working tree clean (dist/logs/.env only); FASE 4 smoke 63/0; FASE 3 smoke 49/0. | ✅ Consistent |
| FASE 4 `notification.created` event exists | `eventBus` declares `notification.created` but **never publishes** it; FASE 4 consumes `message.created` directly (`notification.service.ts` subscriber). | ℹ️ Docs say "notification.created declared" — accurate as a type, but **dormant**. Report this semantic gap. |
| FASE 4 smoke "real web-push send to local http collector" | Replaced with `setVapidDetails` spy (EPROTO on TLS localhost http). Documented in rejected list. | ✅ Already resolved (presentation not affected). |

No further discrepancies found in the inspected surface.

---

## 33. EVIDENCE CHAIN (files read during this inspection)

- `apps/api/prisma/schema.prisma` — models: `ConversationHistory` (l.171: `messageType`, `metadata`), `Order` (l.209: `orderStatus`, `totalPrice`, `items`, `orderItems`), `OrderItem` (l.238: `productId?`, `productName`, `quantity`, `unitPrice`, `subtotal`), `Product` (l.277: `price`, `stock`, `primaryImageUrl`, `images`), `Conversation` (l.140: `status`, `metadata`), `Customer` (l.394: `webUid`, `pushSubscription`).
- `apps/api/src/services/conversation-delivery.service.ts` — `MessageCreatedData`, publish ordering, same-row UPDATE.
- `apps/api/src/services/structured-message.mapper.ts` — `classifyStructured`/`mapStructured`, exact payload shapes, `default: text`.
- `apps/api/src/tests/structured-message.test.ts` — authoritative payload assertions (T1/T2/T2-int/T3/T3-list/T4/cart/quick_reply/product/handoff + button/order/checkout→text).
- `apps/api/src/routes/pwa.ts` — `/init`, `/history`, `/message`, `/typing`, `/read`, `/subscribe`, `/unsubscribe`.
- `apps/api/src/routes/products.ts`, `orders.ts`, `store-products.ts` — commerce API (read public; write admin-only; no checkout/payment).
- `apps/api/src/business/order.service.ts`, `product.service.ts` — commerce service authority.
- `apps/api/src/domain/types.ts` — `ResponseSource`, `Product`, `OrderWithItems`, `OrderItem`, `CartOp`, `ClarificationOption`, `PendingClarification`, `PipelineContext`, `ConfirmedItem`.
- `apps/api/src/routes/conversations.ts:186` — admin reply → `human_agent` publish (from FASE3 audit report + commit).
- `apps/api/src/services/event-bus.service.ts` — sync `publish`, `subscribe` returns unsubscribe.
- `apps/api/src/services/realtime.service.ts` — `customerPresence` Map + `isCustomerConversationOnline`.
- `apps/pwa/src/components/ChatPage.tsx` (1-503) — all state + render; `human_agent→role:'assistant'` (l.205); `type`/`payload` dropped at render (l.454-461); connect_error no-op (l.240); read/typing/reconnect logic.
- `apps/pwa/src/components/ChatBubble.tsx` (44) — no `agent`/`human` role, no structured render.
- `apps/pwa/src/services/api.ts` (38) — axios + WS config.
- `apps/pwa/src/components/NotificationPrompt.tsx` + `utils/vapid.ts` — FASE 4 push.
- `apps/pwa/public/sw.js` — FASE 4 service worker (push + notificationclick).
- `apps/pwa/public/manifest.json` + `apps/pwa/index.html` + `apps/pwa/vite.config.ts` + `apps/pwa/tsconfig.app.json`.
- `apps/dashboard/src/pages/ConversationInbox.tsx` (human_agent→`'agent'` reference) + `apps/dashboard/src/services/realtime.ts` (`CreatedMessageData`).
- `apps/api/scripts/smoke-fase3-chatbox.ts`, `smoke-fase4-notification.ts` — runtime evidence (prior runs: 49/0, 63/0, 4/4).

---

## 34. VERIFICATION STATUS (commands already green in session)

| Check | Result |
|---|---|
| API `tsc --noEmit -p tsconfig.json` | exit 0 |
| PWA `tsc --noEmit -p tsconfig.app.json` | exit 0 |
| dashboard `tsc --noEmit` | exit 0 |
| API `tsc -p tsconfig.json` (build) | exit 0 |
| PWA `npm run build` | ✓ built 1.92s |
| dashboard `npm run build` | exit 0 |
| FASE4 smoke `scripts/smoke-fase4-notification.ts` | 63 passed, 0 failed |
| FASE4 unit `src/tests/notification/notification.service.test.ts` | 4 pass, 0 fail |
| FASE1 smoke | 13 passed, 0 failed |
| FASE2 tests (structured/pipeline/golden/date-range) | 85 pass, 0 fail (12 suites) |
| FASE3 smoke `scripts/smoke-fase3-chatbox.ts` | 49 passed, 0 failed |
| FASE3 admin-typing `scripts/smoke-admin-typing.ts` | 14 passed, 0 failed |

No source edits were made during this inspection.

---

## 35. FINAL VERDICT

> **STATE: ✅ READY for FASE 5 implementation — as a PRESENTATION-LAYER-only effort, with documented BLOCKED sub-features.**

**READY because:**
1. The entire **data pipeline** for structured commerce messaging is already delivered to the PWA (`type`+`payload` on WS `message.created`, HTTP `/message`, and `/history`) — `ChatPage` already stores `type`/`payload`; only **render** is missing.
2. The **6 authoritative types** (`text, quick_reply, cart, product, product_list, handoff`) carry exact, test-asserted payloads the UI can render **read-only**.
3. **Public read APIs** for products exist (`GET /api/stores/:id/products`, `GET /api/products/:id`).
4. The **`human_agent` fix is presentation-only** — the Dashboard already proves the canonical `sender→role` mapping (`ConversationInbox.tsx:383-388`), and the PWA receives the same `sender` field; no engine/DB/event change is required.
5. FASE 1/3/4 are green-verified (smoke + typecheck + build) — the regression gates exist.
6. The PWA is a thin shell (9 files) — refactoring `ChatPage` into the proposed `MessageRenderer` components is mechanically small and type-checked via the existing `tsc -b && vite build` gate.

**BLOCKED / NOT-POSSIBLE without owner decision (do NOT attempt silently):**
- **`order` / `checkout` / `payment` interactive UI** — no customer backend exists (Orders API is admin-only; no gateway/session). These must render as `text` fallback or be left unimplemented until a customer commerce backend is authorized.
- **`button` / standalone `image` / `system` / `notification` message types** — never authored by the engine; render as `text` (do NOT fabricate payloads).

**Recommended start order:**
1. §4 `human_agent` role mapping (highest signal, lowest risk — mirrors dashboard).
2. §24 `MessageRenderer` with whitelist dispatch (product/product_list/cart/quick_reply/handoff + text fallback).
3. §30 gap `ConnectionBanner` + `UnreadDivider` (pure presentation).
4. Extend `index.css` design tokens (no new deps).
5. Re-run the FASE 4 smoke (`63/0`) and `tsc --noEmit`/`vite build` after any refactor to prove no regression to §30 boundaries.

**Go / No-go hinges entirely on the owner accepting that `order`/`checkout`/`payment` are deferred** (text fallback) and that verification is **source-verified only** (no browser/E2E available in this environment, §21).
