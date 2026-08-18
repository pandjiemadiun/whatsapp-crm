# FASE 5 FINAL AUDIT

## 1. IMPLEMENTED

### Customer Chatbox — Presentation Layer

| Component | File | Evidence |
|---|---|---|
| MessageRenderer (type dispatch) | `apps/pwa/src/components/MessageRenderer.tsx` | Whitelist `product/product_list/cart/quick_reply/handoff/text`; all other types → text fallback. `isRecord(payload)` guard → text fallback. |
| MessageList (scroll + list) | `apps/pwa/src/components/MessageList.tsx` | `bottomRef`, `EmptyState`, `trailing` (typing/status/error). Scroll to bottom on messages change. |
| TextMessage | `apps/pwa/src/components/TextMessage.tsx` | `whitespace-pre-wrap break-words` |
| ProductCard | `apps/pwa/src/components/ProductCard.tsx` | Image (`loading="lazy"` + onError), name, `formatPrice`, `StockBadge` — all from `ProductPayload` |
| ProductList | `apps/pwa/src/components/ProductList.tsx` | `grid-cols-1 sm:grid-cols-2` grid of `ProductCard` |
| CartSummary | `apps/pwa/src/components/CartSummary.tsx` | Read-only items + total + `cartOpsExecuted`. No mutation, no product lookup. |
| QuickReplyBar | `apps/pwa/src/components/QuickReplyBar.tsx` | `options[].label` buttons → `onQuickReply(label)` → existing `POST /message`. Per-option `sentId` guard. `cartOps`/`action` never executed client-side. |
| HandoffMessage | `apps/pwa/src/components/HandoffMessage.tsx` | Reason label + body content from `HandoffPayload` |
| StatusBanner | `apps/pwa/src/components/StatusBanner.tsx` | `human_takeover` → amber, `resolved` → gray |
| ChatBubble (human_agent) | `apps/pwa/src/components/ChatBubble.tsx` | `role='agent'` → teal bubble + "Admin" badge. `role='assistant'` → gray (AI). `role='user'` → blue (customer). |
| senderToRole | `apps/pwa/src/components/ChatPage.tsx:56-62` | `human_agent→'agent'`, `customer→'user'`, `assistant→'assistant'` (matches Dashboard `ConversationInbox.tsx:383-388`) |
| TypingIndicator | `apps/pwa/src/components/TypingIndicator.tsx` | AI: `ChatBubble isTyping` pulse. Admin: "Admin sedang mengetik…" |
| ConnectionBanner | `apps/pwa/src/components/ConnectionBanner.tsx` | `connecting/connected/reconnecting/disconnected` from Socket.IO events |
| EmptyState | `apps/pwa/src/components/EmptyState.tsx` | Greeting bubble |
| Composer | `apps/pwa/src/components/Composer.tsx` | `<textarea>`, Enter=send, Shift+Enter=newline |
| ChatPage refactor | `apps/pwa/src/components/ChatPage.tsx` | State-owner shell: header + ConnectionBanner + MessageList + Composer + install banner. No global state. |
| Types | `apps/pwa/src/types/chat.ts` | `SenderRole`, `StructuredMessageType`, `ChatMessage`, payload types |
| Format | `apps/pwa/src/utils/format.ts` | `formatPrice` (number-only, no currency — audit correction) |
| Stock | `apps/pwa/src/components/StockBadge.tsx` | null→"Stok tidak terbatas", 0→"Stok habis", >0→"Stok: N" (audit correction) |

### FASE 1–4 Regression Boundaries (all preserved)

| Feature | File | Status |
|---|---|---|
| WS `message.created` handler | `ChatPage.tsx:182-213` | Preserved — `human_agent→'agent'` mapping, `renderedIds` dedup |
| `/message` HTTP optimis | `ChatPage.tsx:316-384` | Preserved — same `POST /pwa/:slug/message`, same dedup |
| `/read` ack | `ChatPage.tsx:99-108` | Preserved — 1s debounce, unchanged |
| `/typing` report | `ChatPage.tsx:271-279` | Preserved — 300ms debounce |
| Reconnect + history catch-up | `ChatPage.tsx:231-243` | Preserved — dedup append |
| Install prompt | `ChatPage.tsx:285-301` | Preserved — 7-day TTL |
| FASE 4 push opt-in | `NotificationPrompt.tsx` | UNCHANGED |
| SW push handler | `public/sw.js` | UNCHANGED |

---

## 2. PARTIAL

| Component | Gap | Current Behavior | Recommended |
|---|---|---|---|
| **Header store identity** | Fallback "Logo" text + fallback name "Toku" | `<div>Logo</div>` when no `profilePhotoUrl`; `store.name \|\| 'Toku'` | Use store initial/emoji fallback; "Toku" → "Toko" |
| **Connection banner** | No reconnect countdown or retry indicator | Shows text label only | Add attempt count (e.g., "Menyambung kembali… (3/10)") |
| **Loading state** | Generic "Memuat…" | `<p>Memuat…</p>` | Could show store name skeleton |
| **Error state** | Inline red text only | `<div className="text-red-600">{error}</div>` | Could be a banner component |
| **EmptyState** | Only renders greeting | Single `ChatBubble` + `TextMessage` | Could show quick-reply suggestions if backend provides them |
| **ProductCard** | No image aspect ratio box | `w-16 h-16` fixed — may stretch | Use `aspect-square object-cover` |
| **ProductList** | Grid only, no horizontal scroll on mobile | `grid-cols-1 sm:grid-cols-2` | Card carousel on mobile for better UX |
| **QuickReplyBar** | Buttons wrap, not scrollable | `flex-wrap gap-1.5` | Could be horizontally scrollable on mobile for long labels |

---

## 3. MISSING

| Feature | File | Required Work |
|---|---|---|
| **WhatsApp link** | `ChatPage.tsx` (header) | Store `phoneNumber`/`whatsappPhoneId` NOT in `PWA_STORE_PUBLIC_SELECT` (`routes/pwa.ts:30-47`). PWA cannot link to WhatsApp. **REQUIRES backend change** to `routes/pwa.ts` to expose phone number — BLOCKED (protected). |
| **Dynamic manifest** | `public/manifest.json` | Manifest is static JSON — name "QloBot", icons are QloBot icons. No per-merchant name or icon. **Requires dynamic manifest generation** (JS injection or backend route). |
| **Merchant app icon** | `public/manifest.json` | Icons are static `/icons/icon-192.png`, `/icon-512.png` — not merchant `profilePhotoUrl`. |
| **Dynamic theme color** | `index.html` / `index.css` | `theme-color` hard-coded `#1B53F5` in `index.html` and manifest. Store has no color field in schema. |
| **`<title>` merchant name** | `index.html` | `<title>PWA</title>` — generic, not merchant-branded. Requires JS DOM update (presentation-only) or SSR. |
| **`<html lang>`** | `index.html` | `lang="en"` — should be `lang="id"` for Indonesian UI. |
| **`manifest start_url`** | `public/manifest.json` | `"start_url": "/"` — should be `"/c/"` to match PWA routing. |
| **Standalone detection** | `ChatPage.tsx` | No `window.matchMedia('(display-mode: standalone)')` handling. Can't offer "back to browser" button or standalone-specific UI. |
| **Merchant brand color** | Schema / Store model | `schema.prisma` Store model has NO color field. Cannot be consumed without schema migration (BLOCKED). |
| **Store description display** | `ChatPage.tsx` | `/init` returns `description` but ChatPage doesn't render it anywhere. |
| **Product card image aspect ratio** | `ProductCard.tsx` | `w-16 h-16` may distort non-square images. |
| **Cart empty state** | `CartSummary.tsx` | Shows "Keranjang kosong" — correct, but could show a subtle icon. |
| **Product list horizontal scroll** | `ProductList.tsx` | Grid-only on mobile — carousel UX would be better. |

---

## 4. REGRESSION/BUG

| # | Severity | Finding | File |
|---|---|---|---|
| R1 | **P1** | `manifest.json` `start_url: "/"` — installed PWA opens at root, not `/c/`. User lands on NotFound page when launching from home screen. | `public/manifest.json:5` |
| R2 | **P2** | `<html lang="en">` but all UI text is Indonesian ("Halo!", "Ketik pesan", "Kirim"). Screen readers will mispronounce. | `apps/pwa/index.html:2` |
| R3 | **P2** | `<title>PWA</title>` — generic browser tab title, no merchant identity. | `apps/pwa/index.html:8` |
| R4 | **P1** | Manifest `name: "QloBot"` / `short_name: "QloBot"` — PWA installed title shows "QloBot", not merchant store name. Violates "PWA untuk menjadi toko" north star. | `public/manifest.json:2-3` |
| R5 | **P1** | Manifest icons are static QloBot icon — installed PWA home screen shows QloBot logo, not merchant logo. | `public/manifest.json:9-19` |
| R6 | **P2** | Connection banner shows "Terputus" but HTTP `/message` POST still works (per `api.ts` axios uses same-origin, not WebSocket). User may see "disconnected" while still able to send messages — confusing but functional. Not a data-loss bug (WS reconnects). | `ConnectionBanner.tsx` + `ChatPage.tsx` |
| R7 | **P2** | Composer `<textarea>` `rows={1}` — may auto-expand awkwardly on multiline. No `maxRows` cap. | `Composer.tsx` |
| R8 | **P3** | `ChatPage.tsx:482` fallback name "Toku" — inconsistent with "Toko" used in image alt text (`store.name \|\| 'Toko'`). | `ChatPage.tsx:482` |

---

## 5. PWA AUDIT

### Manifest
- **Static JSON** (`public/manifest.json`) — NOT dynamic. Cannot per-merchant.
- `name`: "QloBot — Chat Toko" (hard-coded)
- `short_name`: "QloBot" (hard-coded)
- `description`: "Asisten chat pelanggan untuk toko online Anda" (hard-coded)
- `start_url`: "/" (**BUG** — should be `/c/`)
- `display`: "standalone" ✅
- `theme_color`: "#1B53F5" (hard-coded)
- `background_color`: "#ffffff" ✅

### Icons
- Static `/icons/icon-192.png` + `/icons/icon-512.png` — NOT merchant-specific.
- Not sourced from `store.profilePhotoUrl`.
- **No dynamic icon generation** (no canvas/blob URL manipulation in main.tsx).

### Branding
- Store schema has: `name`, `slug`, `profilePhotoUrl` — available via `/init` (`PWA_STORE_PUBLIC_SELECT`).
- ChatPage header renders `store.profilePhotoUrl` + `store.name` ✅
- **No `currency` field** on Store or Product payload → `formatPrice` must NOT fabricate (audited: number-only ✅).
- **No `brandColor`/`primaryColor` field** on Store model → theme color cannot be merchant-specific without schema migration (BLOCKED).
- **No `phoneNumber`/`whatsappPhoneId`** in `PWA_STORE_PUBLIC_SELECT` → WhatsApp link impossible (BLOCKED — requires backend change).

### Install
- SW registered at `/c/sw.js` (scope `/c/`) ✅
- `<link rel="manifest" href="/c/manifest.json" />` ✅
- `beforeinstallprompt` captured ✅ (ChatPage.tsx:285-301)
- 7-day dismiss TTL in localStorage ✅
- **No standalone detection** (`display-mode: standalone` media query) — cannot customize UI for installed mode
- **Manifest `start_url` bug** — PWA launches at `/` instead of `/c/`
- `<title>` is "PWA" — browser will show "PWA" as the window title (in standalone mode, the manifest `name` is used for the app title, which is "QloBot")

### Service Worker
- Path: `public/sw.js` → served at `/c/sw.js`, scope `/c/` ✅
- Install: `self.skipWaiting()` ✅
- Activate: `self.clients.claim()` ✅
- Fetch: pass-through, skips `/api/*` ✅ (prevents ChatPage "Toko tidak ditemukan" bug)
- Push: FASE 4 notification signal only ✅
- `notificationclick`: focuses/opens `/c/<slug>` deep link ✅
- `pushsubscriptionchange`: auto-refresh via cached identity ✅

### Routing
- `App.tsx`: `/c/:slug` → ChatPage, `*` → NotFound ✅
- `vite.config.ts`: `base: '/c/'` ✅ (preserved)
- `index.html`: script `/src/main.tsx` → Vite rewrites to `/c/src/main.tsx` in build ✅

### Blockers
| Blocker | Description | Owner decision required? |
|---|---|---|
| **B1** | `manifest start_url: "/"` should be `/c/` | No — presentation fix |
| **B2** | Static manifest — no per-merchant name/icon | Yes — requires dynamic manifest (JS injection or backend route) |
| **B3** | No merchant `brandColor` in schema | Yes — requires `schema.prisma` migration (BLOCKED) |
| **B4** | No WhatsApp phone in PWA init response | Yes — requires `routes/pwa.ts` change (BLOCKED, protected) |
| **B5** | `<html lang="en">` should be `lang="id"` | No — presentation fix |

---

## 6. CURRENT UX SCORECARD

| Area | Status | Evidence |
|---|---|---|
| **First open** | GREEN ✅ | Loads store via `/init`, fetches history, establishes WS |
| **Store identity** | YELLOW ⚠️ | Header shows `store.name` + `profilePhotoUrl` ✅, but fallback is "Logo" text + "Toku" (typo) |
| **Conversation** | GREEN ✅ | MessageList + ChatBubble, dedup, scroll-to-bottom |
| **Product** | GREEN ✅ | ProductCard with image, name, price, StockBadge |
| **Product list** | GREEN ✅ | Responsive grid |
| **Cart** | GREEN ✅ | Read-only, no mutation |
| **Quick action** | GREEN ✅ | QuickReplyBar buttons send label via existing `/message` |
| **Human handoff** | GREEN ✅ | `role='agent'` teal bubble + "Admin" badge, distinct from AI |
| **Connection** | GREEN ✅ | ConnectionBanner with 4 states + aria-live |
| **Composer** | GREEN ✅ | textarea, Enter send, Shift+Enter newline, disabled on resolved |
| **Mobile** | GREEN ✅ | `max-w-[75%]`, `sm:grid-cols-2`, responsive layout |
| **Accessibility** | GREEN ✅ | aria-labels, focus outlines, live regions, image alt |
| **Merchant branding** | RED ❌ | Manifest static "QloBot", icons are QloBot, no merchant theme color, title is "PWA" |
| **PWA installability** | RED ❌ | `start_url: "/"` bug will land installed app on NotFound; no dynamic manifest/icon |
| **WhatsApp link** | RED ❌ | No WhatsApp number available in PWA init response (backend change required) |

---

## 7. FILES TO CHANGE

### Presentation-only (safe to edit):

| File | Change |
|---|---|
| `apps/pwa/index.html` | Fix `<html lang="en">` → `<html lang="id">`; change `<title>PWA</title>` → dynamic merchant name via JS |
| `apps/pwa/public/manifest.json` | Fix `start_url: "/"` → `"/c/"`; consider dynamic name/icon via JS injection |
| `apps/pwa/src/main.tsx` | Add `display-mode: standalone` detection; add dynamic `<title>` update; optionally inject dynamic manifest via `<link rel="manifest" href="data:...">` |
| `apps/pwa/src/components/ChatPage.tsx` | Fix fallback name "Toku" → "Toko"; add WhatsApp link IF phone number becomes available; add store description display |
| `apps/pwa/src/components/ProductCard.tsx` | Fix image aspect ratio (`aspect-square object-cover`) |
| `apps/pwa/src/components/ProductList.tsx` | Consider horizontal scroll carousel on mobile |
| `apps/pwa/src/components/Composer.tsx` | Add `maxRows` cap for textarea |
| `apps/pwa/src/components/ConnectionBanner.tsx` | Add reconnect attempt count display |

### Requires owner decision (backend/schema change):

| File | Change | Blocker |
|---|---|---|
| `apps/api/src/routes/pwa.ts` | Add `phoneNumber`/`whatsappPhoneId` to `PWA_STORE_PUBLIC_SELECT` | PROTECTED — requires owner decision |
| `apps/api/src/routes/pwa.ts` | Add dynamic manifest endpoint (or serve manifest with store data) | PROTECTED — requires owner decision |
| `apps/api/prisma/schema.prisma` | Add `brandColor`/`primaryColor` to Store model | PROTECTED + migration — BLOCKED |

---

## 8. PROTECTED FILES

The following files are **PROTECTED — must remain untouched** in FASE 5:

### FASE 2/3 protected (Conversation Engine / Socket.IO foundation):
- `apps/api/src/business/conversation.service.ts` (`processCustomerMessage`)
- `apps/api/src/business/fallback.service.ts`
- `apps/api/src/business/order.service.ts`
- `apps/api/src/business/conversation-context.service.ts` (`getOrCreateContext`)
- `apps/api/src/services/message-queue.service.ts` (`acquireLock`)
- `apps/api/src/services/message-processor.service.ts`
- `apps/api/src/services/chat/*`
- `apps/api/src/services/conversation-delivery.service.ts`
- `apps/api/src/services/event-bus.service.ts`
- `apps/api/src/services/structured-message.mapper.ts`
- `apps/api/src/routes/webhooks.ts`
- `apps/api/src/routes/messages.ts`
- `apps/api/src/routes/conversations.ts`
- `apps/api/src/services/fonnte.service.ts`
- `apps/api/src/adapters/whatsapp/gowa.adapter.ts`
- `apps/api/prisma/schema.prisma`

### FASE 4 protected (Notification):
- `apps/api/src/services/notification.service.ts`
- `apps/api/src/services/realtime.service.ts`
- `apps/api/src/config/vapid.config.ts`
- `apps/api/src/routes/pwa.ts` (`/subscribe`/`/unsubscribe`/`/init` vapid — and store select)
- `apps/pwa/public/sw.js`
- `apps/pwa/src/components/NotificationPrompt.tsx`
- `apps/pwa/src/utils/vapid.ts`

**Verified: `git diff --stat HEAD -- business/ services/ routes/ adapters/ config/ prisma/` = empty (zero changes).**

---

## 9. RECOMMENDED IMPLEMENTATION ORDER

### Phase A — Critical Fixes (presentation-only, P1)
1. Fix `manifest.json` `start_url: "/"` → `"/c/"`
2. Fix `index.html` `<html lang>` → `lang="id"`
3. Dynamic `<title>` per merchant (JS in `main.tsx` or `ChatPage`)
4. Fix `ChatPage.tsx` fallback name "Toku" → "Toko"

### Phase B — PWA Branding (presentation-only, P1)
5. Dynamic manifest name/icon via JS blob injection (`main.tsx`) — use `store.profilePhotoUrl` as icon
6. `display-mode: standalone` detection in `main.tsx`
7. Dynamic `theme-color` meta tag based on store (if available)

### Phase C — UX Polish (presentation-only, P2)
8. `ProductCard` — `aspect-square object-cover` for images
9. `Composer` — `maxRows` cap
10. `ConnectionBanner` — reconnect attempt count
11. `ProductList` — horizontal carousel on mobile

### Phase D — Owner Decision Required (BLOCKED)
12. Add `phoneNumber` to PWA init response → WhatsApp link in header
13. Add `brandColor` to Store schema → dynamic theme color
14. Dynamic manifest endpoint (backend)

Each phase gated by: `tsc --noEmit` ✅ + `npm run build` ✅ + regression smoke (FASE 1/2/3/4).

---

## 10. STOP

No code written. No commit. No install. No migration.

This is an inspection-only audit. All findings are source-verified from the repository at commit `8289f5b`.
