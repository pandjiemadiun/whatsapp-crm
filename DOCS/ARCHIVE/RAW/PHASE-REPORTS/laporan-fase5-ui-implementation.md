# FASE 5 — UI IMPLEMENTATION REPORT
## QLOBOT Chatbox — Presentation Layer Refactor

**Base commit:** `8289f5b0fc14f76cbe27aa9eea2e890a2f2ecc84` (FASE 4 HEAD)
**Mode:** PRESENTATION-LAYER ONLY — zero backend/engine/DB/WhatsApp/realtime/notification edits.

---

## 1. Git State

| Check | Result |
|---|---|
| Base commit | `8289f5b` (FASE 4) |
| `git status --short` (source only, excl. `.env`/`dist`/`logs`) | 2 modified + 16 new files |
| Modified tracked files | `apps/pwa/src/components/ChatBubble.tsx`, `apps/pwa/src/components/ChatPage.tsx` |
| New untracked files | 15 component files + `types/chat.ts` + `utils/format.ts` |
| Protected files diff | **EMPTY** — `git diff --stat -- business/ services/ routes/ adapters/ config/ prisma/` = ∅ |
| `git diff --check` | No whitespace errors |

---

## 2. Files Changed

### Modified (2)
| File | Change |
|---|---|
| `apps/pwa/src/components/ChatPage.tsx` | Replaced flat `messages.map(<ChatBubble>)` with `MessageList` + sub-components; added `senderToRole()` (`human_agent→'agent'`); added `ConnectionState`; wired `MessageList`/`Composer`/`TypingIndicator`/`StatusBanner`/`ConnectionBanner` props. 566 → 524 lines. |
| `apps/pwa/src/components/ChatBubble.tsx` | Added `role:'agent'` variant (teal bubble + "Admin" badge); accepts `children` (structured content from `MessageRenderer`) + legacy `text` fallback; kept `isTyping` pulse. 43 → 76 lines. |

### New (15 components + 1 types + 1 util = 17)
| File | Purpose |
|---|---|
| `types/chat.ts` | Presentation-only types: `SenderRole`, `StructuredMessageType`, `ChatMessage`, `ProductPayload`, `ProductListPayload`, `CartPayload`, `QuickReplyPayload`, `HandoffPayload`, `CartOp`, `ClarificationOption` |
| `utils/format.ts` | `formatPrice(price)` → locale number, NO currency symbol (audit correction: removed "Rp" hard-code) |
| `components/MessageRenderer.tsx` | Type-dispatch: whitelist `product/product_list/cart/quick_reply/handoff/text`; all others → text; malformed payload → text fallback |
| `components/MessageList.tsx` | Scroll container + `bottomRef` + `EmptyState` + `trailing` (typing/status/error) |
| `components/TextMessage.tsx` | Plain text rendering (`whitespace-pre-wrap`) |
| `components/ProductCard.tsx` | Image (`loading="lazy"`), name, price, `StockBadge` — all from payload |
| `components/ProductList.tsx` | Responsive grid (`sm:grid-cols-2`) of `ProductCard` |
| `components/CartSummary.tsx` | Read-only item lines + total + `cartOpsExecuted`; no mutation, no product lookup |
| `components/QuickReplyBar.tsx` | `options[].label` buttons; click sends label via existing `/message`; `cartOps`/`action` not executed client-side |
| `components/HandoffMessage.tsx` | Reason label ("Pesan diteruskan ke admin") + body content |
| `components/StatusBanner.tsx` | Handoff/resolved banner (extracted from ChatPage) |
| `components/ConnectionBanner.tsx` | Connection state badge from Socket.IO readyState |
| `components/TypingIndicator.tsx` | AI pulse ("mengetik…") + admin "Admin sedang mengetik…" |
| `components/EmptyState.tsx` | Initial greeting bubble |
| `components/StockBadge.tsx` | `null→"Stok tidak terbatas"`, `0→"Stok habis"`, `>0→"Stok: N"` |
| `components/Composer.tsx` | `<textarea>` input + send button; Enter=send, Shift+Enter=newline |

---

## 3. Human Agent UI

**Mapping (`ChatPage.tsx` `senderToRole`):**
```
customer      → 'user'
assistant     → 'assistant'
human_agent   → 'agent'   ← distinct from AI
```
**Visual (`ChatBubble.tsx`):**
- `role='agent'` → `mr-auto bg-teal-50 text-teal-900 border border-teal-200`
- Renders `<span aria-label="Admin" class="...text-teal-700">Admin</span>` badge above content
- `role='assistant'` → `mr-auto bg-gray-200 text-gray-800` (AI, unchanged)
- `role='user'` → `ml-auto bg-blue-600 text-white` (customer, unchanged)
- `role='system'` → `mr-auto bg-gray-100 text-gray-600` (muted status)

**Constraints honored:** Backend `sender` field unchanged, DB `conversation_history.role` unchanged, EventBus `human_agent` publish unchanged.

---

## 4. MessageRenderer

```ts
switch (type) {
  case 'product':      → <ProductCard p={payload} />
  case 'product_list': → <ProductList items={payload.items} />
  case 'cart':         → <CartSummary cart={payload} />
  case 'quick_reply':  → <QuickReplyBar opts={payload.options} onPick={sendLabel} />
  case 'handoff':      → <HandoffMessage payload={payload} content={content} />
  default:             → <TextMessage text={content} />  // text + button/order/checkout/image/system/payment/notification
}
```

- **Whitelist** (`WHITELIST` const) gates dispatch on `type` — never infers from `content` (RULE #2).
- **Malformed payload guard:** `isRecord(payload)` check; non-record → `<TextMessage text={content} />`.
- **No fabricated data:** payload fields read verbatim from authoritative backend shape.

---

## 5. Product UI

`ProductCard` renders from `ProductPayload { id, name, price, stock, imageUrl }`:
- Image: `loading="lazy"`, `onError` hides broken image, fallback "No image" box.
- Name: `name ?? '—'`
- Price: `formatPrice(price)` → locale-formatted number, **no currency symbol** — audit correction: product payload has no `currency` field, PWA `/init` store response has no `currency`; per RULE "DO NOT FABRICATE CURRENCY", `formatPrice` renders number only (`150.000`), null → `—`)
- Stock: delegated to `StockBadge`

`StockBadge` (Step 3 rules — backend semantics: `null = stok tidak terbatas`):
- `stock === null` → "Stok tidak terbatas" (audit correction: was "Stok tersedia")
- `stock === 0` → "Stok habis" (red)
- `stock > 0` → "Stok: {N}"

No cart mutation, no stock mutation, no price calculation, no currency fabrication.

---

## 6. Product List UI

`ProductList` renders `ProductListPayload.items` as a responsive grid:
- `grid-cols-1 sm:grid-cols-2 gap-2` (mobile-first)
- Each item → `ProductCard`
- Empty/missing array → `null`

---

## 7. Cart UI

`CartSummary` renders `CartPayload { items, total, cartOpsExecuted }` read-only:
- Each line: `{productName} ×{quantity}` → `{formatPrice(subtotal)}`
- Total: `{formatPrice(total ?? 0)}`
- `cartOpsExecuted` shown as "Perubahan keranjang: N" if present
- No add/remove/change/quantity UI
- No product lookup (cart items carry `productName`, not `productId` — intentional per contract)
- Total from payload, never recalculated client-side

---

## 8. Quick Reply

`QuickReplyBar` renders `QuickReplyPayload { reason, question, options: [{id, label, cartOps?, action?}] }`:
- `question` rendered as `<p>` above buttons
- Buttons: `options.map((opt) => <button>{opt.label}</button>)`
- On click → `onQuickReply(opt.label)` → `sendMessage(label)` → existing `POST /pwa/:slug/message { message: label }`
- `cartOps`/`action` **never executed in browser** — engine resolves server-authoritatively
- Per-option `sentId` state disables clicked button until backend replaces the bar
- `submitting` prop also disables all buttons

---

## 9. Handoff

`HandoffMessage` renders from `HandoffPayload { reason, content }`:
- `reason === 'escalation_clarification_retry_exceeded'` → "Pesan diteruskan ke admin."
- Other → "Terhubung ke admin."
- Body content rendered below (if present)
- `StatusBanner` (separate) handles: `human_takeover` → amber banner, `resolved` → gray banner

Conversation status lifecycle: `open | human_takeover | resolved` (canonical, from `Conversation.status` — not invented).

---

## 10. Connection UX

`ConnectionBanner` (Step 8 — presentation only):
- States: `connecting | connected | reconnecting | disconnected`
- Derived from existing Socket.IO events:
  - `connect` → `connected`
  - `reconnect_attempt` → `reconnecting`
  - `reconnect` → `connected`
  - `reconnect_failed` → `disconnected`
  - `disconnect` → `disconnected`
  - `connect_error` → `disconnected`
- Compact badge: green/red/amber, `role="status"`, `aria-live="polite"`
- Does NOT create a new socket, does NOT change WS auth, does NOT change reconnect config.

---

## 11. Read / Unread UX

**Preserved (no change):**
- `POST /pwa/:slug/read { uid, conversationId }` — 1s debounce via `scheduleReadAck`
- Read ack triggers: on WS `connect` + after every `message.created` (1s client debounce, 5s server throttle)
- No new DB field, no per-message read state

**Removed (audit correction — false unread signal):**
- `UnreadDivider` **DELETED** — `scheduleReadAck` fires on connect (marks all history as read immediately) and on every `message.created` (1s debounce + 5s server throttle). The `webLastReadAt` watermark always catches up to ~NOW within 5s. A divider would only flash briefly during the throttle gap, showing a false "unread" indicator while the customer is actively viewing. Per audit gate: "JANGAN membuat unread count/divider palsu."
- `lastReadAt` state removed from ChatPage; `webLastReadAt` handling removed from `conversation.updated` handler (status handling preserved).

---

## 12. Typing

**Preserved (no backend change):**
- Customer → Admin: `POST /pwa/:slug/typing` (300ms debounce) → EventBus `typing.started/stopped{party:'customer'}`
- Admin → Customer: WS `typing.started/stopped{party:'human_agent'}` → `setIsAdminTyping(true)`

**Presentation (`TypingIndicator`):**
- AI typing: `ChatBubble role='assistant' isTyping` (3-dot pulse "mengetik…")
- Admin typing: "Admin sedang mengetik…" + pulse (`role="status"`, `aria-live="polite"`)

---

## 13. Composer

`Composer` (extracted from ChatPage footer — audit correction: switched to `<textarea>`):
- `<textarea>` + send button, `value`, `onChange`, `onKeyDown` (Enter sends; **Shift+Enter = newline** — audit correction: `<textarea>` supports multi-line, unlike single-line `<input>`)
- `aria-label="Ketik pesan"` on textarea, `aria-label="Kirim"` on button
- `disabled` when `conversationStatus === 'resolved'` or `sending`
- `placeholder` reflects status ("Percakapan telah selesai" / "Sedang ditangani oleh admin..." / "Ketik pesan...")
- Send button shows "Mengirim…" during `sending`
- No API change, no message identity change, no dedup change
- `disabled` condition on send button: `disabled || isEmpty` (was `!value.trim()`; equivalent logic with `isEmpty` check)

---

## 14. ChatPage Refactor

Refactored from 566-line monolith into a **state-owner shell** that delegates render to child components:

```
ChatPage (state owner)
  ├── header: store avatar + name + NotificationPrompt
  ├── ConnectionBanner(state)
  ├── MessageList(messages, lastReadAt, bottomRef, onQuickReply, submitting, trailing)
  │     ├── EmptyState (when 0 messages)
  │     ├── messages.map → MessageBubble → ChatBubble(role) + MessageRenderer
  │     │     ├── UnreadDivider (per message)
  │     └── bottomRef anchor
  ├── Composer(value, onInput, onSend, sending, disabled, placeholder)
  └── installBanner (conditional)
```

**No global state introduced.** No Redux/Zustand. State remains local `useState`/`useRef` in `ChatPage`.

---

## 15. Responsive

- Product list: `grid-cols-1 sm:grid-cols-2` (mobile-first)
- All bubbles: `max-w-[75%]`, responsive via Tailwind
- Viewport: `width=device-width, initial-scale=1.0` (preserved)
- Base path `/c/` preserved — no `vite.config.ts` base change, no SW scope change

---

## 16. Accessibility

| Element | a11y treatment |
|---|---|
| Composer input | `aria-label="Ketik pesan"` |
| Send button | `aria-label="Kirim"` |
| Quick reply buttons | `<button type="button">`, `focus:outline-2 focus:outline-offset-2 focus:outline-teal-500` |
| ConnectionBanner | `role="status"`, `aria-live="polite"`, `aria-label="Koneksi: {state}"` |
| StatusBanner | `role="status"`, `aria-live="polite"` |
| TypingIndicator (admin) | `role="status"`, `aria-live="polite"`, `aria-label="Admin sedang mengetik"` |
| Product image | `alt={name ?? 'Produk'}`, `loading="lazy"`, `onError` fallback |
| StockBadge | `aria-label="Stok tidak terbatas/tersedia/habis"` |

---

## 17. Design System

Extended `index.css` (no new dependencies):
- `--color-brand: #1B53F5` (preserved)
- Added semantic color usage via Tailwind: teal (`agent`/Admin badge), amber (`handoff`), gray (`assistant`/`system`), blue (`user`), red/green status
- All components use Tailwind utility classes — no component library, no shadcn, no Radix
- `dot-pulse` animation preserved for typing

---

## 18. Protected Files Verification

```
$ git diff --stat HEAD -- business/ services/ routes/ adapters/ config/ prisma/
(empty)
```

| Protected file | Status |
|---|---|
| `business/conversation.service.ts` | UNCHANGED ✅ |
| `services/chat/*` | UNCHANGED ✅ |
| `business/fallback.service.ts` | UNCHANGED ✅ |
| `business/order.service.ts` | UNCHANGED ✅ |
| `business/conversation-context.service.ts` | UNCHANGED ✅ |
| `services/message-queue.service.ts` | UNCHANGED ✅ |
| `services/message-processor.service.ts` | UNCHANGED ✅ |
| `services/conversation-delivery.service.ts` | UNCHANGED ✅ |
| `services/event-bus.service.ts` | UNCHANGED ✅ |
| `services/structured-message.mapper.ts` | UNCHANGED ✅ |
| `routes/webhooks.ts` | UNCHANGED ✅ |
| `routes/messages.ts` | UNCHANGED ✅ |
| `routes/conversations.ts` | UNCHANGED ✅ |
| `routes/pwa.ts` | UNCHANGED ✅ |
| `services/fonnte.service.ts` | UNCHANGED ✅ |
| `adapters/whatsapp/gowa.adapter.ts` | UNCHANGED ✅ |
| `services/notification.service.ts` | UNCHANGED ✅ |
| `services/realtime.service.ts` | UNCHANGED ✅ |
| `config/vapid.config.ts` | UNCHANGED ✅ |
| `prisma/schema.prisma` | UNCHANGED ✅ |
| `services/vapid.ts` / `NotificationPrompt.tsx` | UNCHANGED ✅ |
| `public/sw.js` | UNCHANGED ✅ |

---

## 19. Regression Results

| Suite | Expected | Actual | Status |
|---|---|---|---|
| FASE 1 smoke (`smoke-fase1-realtime.ts`) | 13/13 | **13/13** | ✅ |
| FASE 2 tests (structured-message + pipeline + pipeline-edge + golden + date-range + notification) | 85/85 base | **89/89** | ✅ |
| FASE 3 smoke (`smoke-fase3-chatbox.ts`) | 49/49 | **49/49** | ✅ |
| Admin typing (`smoke-admin-typing.ts`) | 14/14 | **14/14** | ✅ |
| FASE 4 smoke (`smoke-fase4-notification.ts`) | 63/63 | **63/63** | ✅ |
| FASE 4 unit (`notification.service.test.ts`) | 4/4 | **4/4** | ✅ |
| PWA `tsc --noEmit -p tsconfig.app.json` | exit 0 | exit 0 | ✅ |
| PWA `npm run build` (tsc -b && vite build) | ✓ built | ✓ built 707ms | ✅ |
| API `tsc --noEmit -p tsconfig.json` | exit 0 | exit 0 | ✅ |

### Audit Corrections (FASE 5 Correction Gate)

| # | Finding | Correction |
|---|---|---|
| 1 | `formatPrice` hard-coded `"Rp"` | Removed currency symbol — product payload (`{id,name,price,stock,imageUrl}`) and `/init` store response (`PWA_STORE_PUBLIC_SELECT`) have no `currency` field. Per RULE "DO NOT FABRICATE CURRENCY", `formatPrice` now returns locale-formatted number only (`150.000`). |
| 2 | `StockBadge` null → "Stok tersedia" | Changed to "Stok tidak terbatas" (backend semantics: `null = stok tidak terbatas` per `domain/types.ts:157`). |
| 3 | `Composer` used `<input>` but claimed Shift+Enter | Switched to `<textarea>`: Enter=send, Shift+Enter=newline. No API/message/dedup change. |
| 4 | `UnreadDivider` false unread signal | **Deleted** — `scheduleReadAck()` fires on `connect` + every `message.created` (1s debounce, 5s server throttle). Watermark always catches up to ~NOW within 5s. A divider would only flash during the throttle gap, giving a false "unread" signal while actively viewing. Removed `lastReadAt` state, `webLastReadAt` handling, and `UnreadDivider.tsx`. Read ack backend (`POST /read`) unchanged. |

---

## 20. Typecheck

```
$ cd apps/pwa && npx tsc --noEmit -p tsconfig.app.json
(exit 0, no errors)
```

TypeScript config (`tsconfig.app.json`): `noUnusedLocals: true`, `noUnusedParameters: true`, `verbatimModuleSyntax: true` — all satisfied. No `eslint` configured; typecheck is the gate.

---

## 21. Build

```
$ cd apps/pwa && npm run build
> tsc -b && vite build
✓ 129 modules transformed
✓ built in 707ms
dist/index.html                    0.49 kB
dist/assets/index-BzKsY7rE.js      335.58 kB (gzip: 108.54 kB)
dist/assets/index-BpbLi0-g.css     13.99 kB  (gzip: 3.86 kB)
```

---

## 22. Browser Verification Limitation

**No browser exists in this environment.** Per §21 of the inspection report:
- `chromium`, `chromium-browser`, `google-chrome`, `chrome`, `chrome-headless-shell` → all missing
- `apps/pwa/package.json` has no test script; no vitest/jest/cypress/playwright
- No test runner for PWA

**FASE 5 acceptance is source-verified only** (typecheck + build + reasoning). Browser-based visual verification of the "Admin" badge, bubble colors, and quick_reply click behavior cannot be executed here. This is a verification constraint, not a blocker. See §25 (Deferred).

---

## 23. Git Diff

```
$ git diff --name-only HEAD | grep -v dist/ | grep -v logs/ | grep -v '^.env$'
apps/pwa/src/components/ChatBubble.tsx    (modified)
apps/pwa/src/components/ChatPage.tsx      (modified)
```

New untracked files: 14 new component files (`apps/pwa/src/components/`) + `apps/pwa/src/types/chat.ts` + `apps/pwa/src/utils/format.ts` = **16 new**.
Deleted: `apps/pwa/src/components/UnreadDivider.tsx` (audit correction — false unread signal).

---

## 24. Commit Hash

- **Base:** `8289f5b0fc14f76cbe27aa9eea2e890a2f2ecc84` (FASE 4 HEAD)
- **Not yet committed** — changes are in working tree (uncommitted). No commit created per task instructions ("Do not deploy").

---

## 25. Remaining Deferred Features

| Feature | Status | Reason |
|---|---|---|
| `order` structured type UI | Deferred | Engine never authors `order` (classifyStructured has no order branch). Would require engine change — BLOCKED. Text fallback only. |
| `checkout` interactive UI | Deferred | No customer checkout/payment backend. `finalizeDraftOrder` is engine-side keyword heuristic only. BLOCKED — needs owner authorization. |
| `payment` / gateway UI | Deferred | `tryPayment` is intent-only → text. No gateway/session type exists. BLOCKED. |
| `button` type UI | Not implemented | Engine never authors `button`. Text fallback. |
| Standalone `image` type UI | Not implemented | Image only arrives inside `product`/`product_list` payload (`imageUrl`). No standalone image bubble. |
| `UnreadDivider` / unread badge | Removed (audit) | `scheduleReadAck` fires on connect + every `message.created`; watermark always catches up to ~NOW within 5s; divider would only flash falsely. |
| Browser E2E tests | Deferred | No chromium/test runner in environment. Source-verified only. |
| PWA unit tests | Deferred | No test script/dependencies. Would require adding vitest + test infra (new dependency — outside presentation-only scope). |
| Product list virtualization | N/A | Message list unbounded but acceptable for chat volumes (per §19 Performance). |

---

## FINAL VERDICT

**✅ FASE 5 COMPLETE — Presentation Layer Only**

All 6 steps of the primary objective are implemented:
1. ✅ **Step 1 — Human Agent:** `senderToRole` maps `human_agent→'agent'`; `ChatBubble` renders teal bubble + "Admin" badge, visually distinct from AI `assistant` (gray).
2. ✅ **Step 2 — Message Types:** `MessageRenderer` dispatches on `type`/`payload`/`content`/`role`; whitelist of 6 types; text fallback for all others.
3. ✅ **Step 3 — Product Card:** Image + name + formatted price (no currency symbol) + `StockBadge` (null→"Stok tidak terbatas", 0→"Stok habis", >0→"Stok: N"). Read-only.
4. ✅ **Step 4 — Product List:** Responsive grid of `ProductCard`. Read-only.
5. ✅ **Step 5 — Cart:** Items + total + `cartOpsExecuted`. Read-only. No product lookup, no recalculation.
6. ✅ **Step 6 — Quick Reply:** `option.label` buttons send via existing `POST /message`. `cartOps`/`action` not executed client-side.
7. ✅ **Step 7 — Handoff:** `HandoffMessage` + `StatusBanner` from canonical status.
8. ✅ **Step 8 — Connection UX:** `ConnectionBanner` from Socket.IO readyState.
9. ✅ **Step 9 — Read/Unread:** Read ack preserved (`POST /read`, 1s debounce). `UnreadDivider` **removed** (audit: false unread signal — watermark always catches up within 5s throttle).
10. ✅ **Step 10 — Typing:** `TypingIndicator` (AI pulse + admin "Admin sedang mengetik…").
11. ✅ **Step 11 — Composer:** `<textarea>` extracted; Enter=send, Shift+Enter=newline. No API change.
12. ✅ **Step 12 — ChatPage Refactor:** State owner shell delegates to `MessageList`/`MessageRenderer`/`Composer`/`TypingIndicator`/`StatusBanner`/`ConnectionBanner`/`EmptyState`.
13. ✅ **Step 13 — Design:** Tailwind v4 extended, no new deps.
14. ✅ **Step 14 — Accessibility:** aria-labels, focus outlines, live regions, image alt.
15. ✅ **Step 15 — Responsive:** Mobile-first grid, `/c/` base preserved.

**Zero database writes** added (persistence rule honored).
**Zero protected file changes** (verified via `git diff --stat` — empty for all protected paths).
**All regression baselines green** (13/13 + 89/89 + 49/49 + 14/14 + 63/63 + 4/4).
**Typecheck + build green** (PWA exit 0 + built; API exit 0).
**4 audit corrections applied** (currency fabrication removed, stock null label fixed, composer textarea, UnreadDivider removed for false-signal).

**Blocked/deferred (require owner decision):** `order`/`checkout`/`payment`/`button`/`standalone-image` interactive UI — no authoritative backend data exists for customer; rendered as text fallback per RULE #2.
