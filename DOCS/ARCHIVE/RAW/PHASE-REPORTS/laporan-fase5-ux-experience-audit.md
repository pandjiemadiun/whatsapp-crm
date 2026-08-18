# FASE 5 FINAL UX EXPERIENCE AUDIT

**Mode:** INSPECTION ONLY — no code, no commit, no install, no migration.
**Source:** Repository at commit `8289f5b` + uncommitted FASE 5 work.
**Date:** 2026-08-13

---

## 1. IMPLEMENTED

### Customer Chatbox — Component Inventory

| Component | File | Implementation Status |
|---|---|---|
| **ChatPage (state owner)** | `apps/pwa/src/components/ChatPage.tsx:64-524` | ✅ State owner: store init, history load, WS realtime, send, typing, read, install prompt, connection state, conversation status |
| **MessageList** | `apps/pwa/src/components/MessageList.tsx` | ✅ Scroll container, bottomRef, empty state, trailing (typing/status/error) |
| **MessageRenderer** | `apps/pwa/src/components/MessageRenderer.tsx:42-88` | ✅ Whitelist dispatch: product/product_list/cart/quick_reply/handoff/text. All other types → text fallback. `isRecord(payload)` guard. |
| **TextMessage** | `apps/pwa/src/components/TextMessage.tsx` | ✅ `whitespace-pre-wrap break-words` |
| **ProductCard** | `apps/pwa/src/components/ProductCard.tsx` | ✅ Image (lazy + onError), name, price (no currency), StockBadge |
| **ProductList** | `apps/pwa/src/components/ProductList.tsx` | ✅ `grid-cols-1 sm:grid-cols-2` |
| **CartSummary** | `apps/pwa/src/components/CartSummary.tsx` | ✅ Read-only, no mutation, no product lookup |
| **QuickReplyBar** | `apps/pwa/src/components/QuickReplyBar.tsx` | ✅ Buttons send `label` via existing `/message`; no client-side cartOps |
| **HandoffMessage** | `apps/pwa/src/components/HandoffMessage.tsx` | ✅ Reason label + body |
| **StatusBanner** | `apps/pwa/src/components/StatusBanner.tsx` | ✅ Handoff/resolved banner |
| **ChatBubble** | `apps/pwa/src/components/ChatBubble.tsx` | ✅ 4 roles: user (blue/right), assistant (gray/left), agent (teal/left + "Admin" badge), system (gray-100/left) |
| **TypingIndicator** | `apps/pwa/src/components/TypingIndicator.tsx` | ✅ AI pulse + admin "Admin sedang mengetik…" |
| **ConnectionBanner** | `apps/pwa/src/components/ConnectionBanner.tsx` | ✅ 4 states with aria-live |
| **EmptyState** | `apps/pwa/src/components/EmptyState.tsx` | ✅ Greeting bubble "Halo! Ada yang bisa dibantu?" |
| **Composer** | `apps/pwa/src/components/Composer.tsx` | ✅ `<textarea>`, Enter=send, Shift+Enter=newline |
| **StockBadge** | `apps/pwa/src/components/StockBadge.tsx` | ✅ null→"Stok tidak terbatas", 0→"Stok habis", >0→"Stok: N" |
| **Types** | `apps/pwa/src/types/chat.ts` | ✅ Presentation-only types mirroring backend contract |
| **Utils** | `apps/pwa/src/utils/format.ts` | ✅ `formatPrice` number-only, no currency symbol |

### Verified Working Flows

| Flow | Evidence |
|---|---|
| Store identity display | `ChatPage.tsx:137` `/init` → `setStore(...)` → header renders `store.name` + `store.profilePhotoUrl` (`ChatPage.tsx:471-482`) |
| human_agent → agent | `ChatPage.tsx:56-62 senderToRole()` + `ChatPage.tsx:203` WS handler; `ChatBubble.tsx:23,44-51` teal + Admin badge |
| AI reply (text) | `ChatPage.tsx:342-348` HTTP optimis → `MessageRenderer` → `TextMessage` |
| AI reply (product) | `MessageRenderer.tsx:60-63` `case 'product'` → `ProductCard` from `payload` |
| AI reply (quick_reply) | `MessageRenderer.tsx:73-85` `case 'quick_reply'` → `QuickReplyBar` → `onQuickReply(label)` → `sendMessage(label)` → `POST /message` |
| Human handoff | `ChatPage.tsx:248-252` WS `conversation.handoff` → `human_takeover` status; `ChatBubble` agent teal |
| Connection states | `ChatPage.tsx:171-179` socket events → `setConnectionState`; `ConnectionBanner` renders |
| Typing (both directions) | `ChatPage.tsx:271-279` (customer→typing POST) + `216-221` (admin→typing WS) → `TypingIndicator` |
| Install prompt | `ChatPage.tsx:285-301` `beforeinstallprompt` + 7-day TTL; `installBanner()` UI |
| Reconnect + catch-up | `ChatPage.tsx:231-243` history refetch + dedup |
| Read ack | `ChatPage.tsx:99-108` 1s debounce `POST /read` |

---

## 2. PARTIAL

| Component | Incomplete | Gap | File |
|---|---|---|---|
| **Header** | Partial merchant branding | Fallback is "Logo" text div + name fallback "Toku" (not "Toko") | `ChatPage.tsx:478-482` |
| **Loading state** | Generic only | `<p>Memuang…</p>` — no store skeleton, no branded loading | `ChatPage.tsx:440` |
| **ProductCard** | Image may distort | `w-16 h-16 rounded object-cover` — non-square images stretch vertically | `ProductCard.tsx:14` |
| **ProductList** | Grid only on mobile | `grid-cols-1 sm:grid-cols-2` — single column on mobile, no horizontal scroll | `ProductList.tsx:16` |
| **QuickReplyBar** | Buttons wrap | `flex-wrap gap-1.5` — long labels create vertical stacks, not horizontal scroll | `QuickReplyBar.tsx:22` |
| **ConnectionBanner** | No reconnect info | Shows "Menyambung kembali…" but no attempt count (e.g., 3/10) | `ConnectionBanner.tsx` |
| **Composer** | No quick-action chips | Plain textarea + send button only. No "Lihat Produk" or "Hubungi Admin" quick chip | `Composer.tsx` |
| **EmptyState** | Single greeting | Only "Halo! Ada yang bisa dibantu?" — no quick suggestions for what to ask | `EmptyState.tsx` |
| **StatusBanner** | No WhatsApp reference | Handoff banner mentions admin but no WhatsApp alternative | `StatusBanner.tsx` |
| **CartSummary** | No visual hierarchy | Plain table layout — could have divider, summary styling | `CartSummary.tsx` |
| **MessageList** | No auto-scroll-to-bottom button | Scrolls to bottom on new messages but no "scroll to bottom" FAB for long conversations | `MessageList.tsx` |

---

## 3. MISSING

### 3.1 Product Discovery (the core gap for "first-open → see products without typing")

| Missing Feature | Why it's blocked | Files |
|---|---|---|
| **Product catalog browser** | `/init` (`PWA_STORE_PUBLIC_SELECT`, `routes/pwa.ts:30-47`) does NOT return `store.id`. Product endpoints (`GET /api/stores/:storeId/products`, `routes/products.ts:21-64`) require `storeId` (UUID), not `slug`. PWA only has `slug` from URL route `/c/:slug`. | `routes/pwa.ts:30-47`, `routes/products.ts:21`, `ChatPage.tsx:137` |
| **Quick action chips** | No quick-action surface on first screen. No "Lihat Produk" / "Lihat Harga" chips. | `EmptyState.tsx`, `Composer.tsx` |
| **Product search** | No search bar. PWA never calls `GET /api/stores/:storeId/products/search` (also requires storeId). | `ChatPage.tsx` |

**Critical blocker:** The PWA cannot load products proactively because:
1. `PWA_STORE_PUBLIC_SELECT` excludes `id: true` (line 30-47, no `id` field)
2. Product endpoints use `:storeId` (UUID), not `:slug`
3. No slug-to-storeId resolution endpoint exists
4. Modifying `routes/pwa.ts` to include `id: true` requires owner decision (PROTECTED file)

### 3.2 PWA Branding

| Missing Feature | Details | Files |
|---|---|---|
| **Dynamic manifest** | Manifest is static JSON. Name "QloBot", not merchant. | `public/manifest.json` |
| **Dynamic icons** | Icons are static `/icons/icon-*.png`, not merchant `profilePhotoUrl` | `public/manifest.json:9-19` |
| **Merchant theme color** | No color field in Store schema. `#1B53F5` hard-coded everywhere. | `schema.prisma` (Store model: no color field), `index.html:6`, `manifest.json:8` |
| **Merchant `<title>`** | `<title>PWA</title>` — generic | `index.html:8` |
| **`display-mode` detection** | No `window.matchMedia('(display-mode: standalone)')` — can't adapt UI for installed mode | `main.tsx` |
| **`manifest start_url` fix** | `start_url: "/"` should be `/c/` | `public/manifest.json:5` |
| **`lang="id"`** | `<html lang="en">` — wrong for Indonesian UI | `index.html:2` |

### 3.3 WhatsApp Integration (presentation-only gap, requires backend)

| Missing | Why | Files |
|---|---|---|
| **WhatsApp link in chat** | `PWA_STORE_PUBLIC_SELECT` explicitly EXCLUDES `phoneNumber` and `whatsappPhoneId` (comment: "Kolom terlarang yang DIS-eksklusi", `routes/pwa.ts:28-29`) | `routes/pwa.ts:28-47` |
| **WhatsApp as alternative channel** | No UI offering WhatsApp as fallback | `ChatPage.tsx`, `StatusBanner.tsx` |
| **Store WhatsApp display** | `phoneNumber`/`whatsappPhoneId` not available even for display (read-only) | `schema.prisma` Store model |

### 3.4 Commerce Read-Only Enhancements

| Missing | Details | Files |
|---|---|---|
| **Product list pagination** | `ProductList` renders all items in payload. No "load more" if payload is paginated. | `ProductList.tsx` |
| **Cart checkout flow** | Cart is read-only. No checkout/payment (correctly blocked — no backend). But no "hubungi admin untuk checkout" guidance. | `CartSummary.tsx` |
| **Store shipping/payment hints** | `/init` returns `acceptsQris`/`acceptsCod`/`acceptsTransfer`/`shippingMode` but ChatPage never displays them. | `ChatPage.tsx:137` |

---

## 4. REGRESSION/BUG

| # | Severity | Finding | File | Impact |
|---|---|---|---|---|
| **R1** | **P0 — CRITICAL** | `manifest start_url: "/"` — installed PWA opens root → `App.tsx` `*` route → `NotFound` page. Customer lands on 404 after install. | `public/manifest.json:5` | PWA unusable when installed |
| **R2** | **P1 — HIGH** | Manifest name "QloBot" + static icons — installed app shows "QloBot", not merchant. Violates "PWA untuk menjadi toko." | `public/manifest.json` | Product north star violated |
| **R3** | **P2 — MEDIUM** | `<html lang="en">` — screen readers use English pronunciation for Indonesian UI text | `index.html:2` | Accessibility degradation |
| **R4** | **P2 — MEDIUM** | `<title>PWA</title>` — generic browser tab title, not merchant name | `index.html:8` | Poor tab/browser identity |
| **R5** | **P2 — MEDIUM** | `store.name \|\| 'Toku'` — "Toku" is not a proper Indonesian word; should be "Toko" | `ChatPage.tsx:482` | Confusing fallback |
| **R6** | **P3 — LOW** | ConnectionBanner "Terputus" while HTTP still works — could confuse user into thinking chat is broken | `ConnectionBanner.tsx` | Minor UX confusion (HTTP fallback is correct behavior) |
| **R7** | **P3 — LOW** | "Memuang…" loading — no store skeleton, poor first impression | `ChatPage.tsx:440` | Minor polish |

**Note on R6:** The connection banner showing "Terputus" while HTTP `/message` still works is **by design** (WS = real-time push, HTTP = request-response fallback). The message still sends and gets an optimistic response. However, the user won't receive real-time delivery of the engine's reply until WS reconnects. This should be clarified with inline text, not treated as a bug.

---

## 5. PWA AUDIT

### Manifest
- **Static** (`public/manifest.json`) — NOT dynamic. One manifest for all merchants.
- `name`: "QloBot — Chat Toko" (static)
- `short_name`: "QloBot" (static)
- `description`: "Asisten chat pelanggan untuk toko online Anda" (static)
- `start_url`: **"/"** — BUG (should be `/c/`)
- `display`: "standalone" ✅
- `theme_color`: "#1B53F5" (static)
- `background_color`: "#ffffff" ✅
- `icons`: `/icons/icon-192.png`, `/icons/icon-512.png` (static, QloBot logo, NOT merchant)

### Icons
- Static PNG files at `apps/pwa/public/icons/icon-192.png` (988 bytes), `icon-512.png` (3228 bytes)
- NOT sourced from merchant `store.profilePhotoUrl`
- No dynamic icon generation (no canvas/blob URL, no `createImageBitmap` in `main.tsx`)

### Branding
- Store has: `name`, `slug`, `profilePhotoUrl`, `description` — available via `/init` ✅
- Store has: `phoneNumber`, `whatsappPhoneId` — NOT exposed to PWA (excluded in `PWA_STORE_PUBLIC_SELECT`)
- Store model has: NO `color`/`brandColor` field (`schema.prisma` Store model lines 10-39)
- `currency` field exists on Product model (`schema.prisma:216`) but NOT on Store, and NOT in PWA payload

### Install
- SW registered: `main.tsx:21-24` → `navigator.serviceWorker.register('/c/sw.js')` ✅
- `beforeinstallprompt` captured: `ChatPage.tsx:285-301` ✅
- 7-day dismiss TTL ✅
- `display-mode: standalone` detection: **MISSING** — `main.tsx` has no `matchMedia` check
- Installed PWA would show "QloBot" name + icon (NOT merchant)

### Service Worker
- `public/sw.js` — scope `/c/` ✅
- Install: `self.skipWaiting()` ✅
- Activate: `self.clients.claim()` ✅
- Fetch: pass-through, skips `/api/*` ✅
- Push: FASE 4 notification signal ✅
- `notificationclick`: deep-link to `/c/` or `/c/<slug>` ✅

### Routing
- `App.tsx:7` — `/c/:slug` → ChatPage ✅
- `App.tsx:10` — `*` → NotFound ✅
- `vite.config.ts:15` — `base: '/c/'` ✅
- `index.html:7` — `<link rel="manifest" href="/c/manifest.json" />` ✅

### Blockers
| Blocker | Description | Files to change (presentation-only if possible) |
|---|---|---|
| **B1** | `manifest start_url: "/"` | Fix to `"/c/"` in `public/manifest.json` |
| **B2** | Static manifest — no merchant name/icon | Generate dynamic manifest via JS in `main.tsx` (presentation-only) — inject `<link rel="manifest" href="data:application/manifest+json,...">` after `/init` fetches store data |
| **B3** | No merchant theme color | Store schema has no color field — BLOCKED (requires schema migration) |
| **B4** | No WhatsApp phone in init response | `routes/pwa.ts:28-47` excludes `phoneNumber` — BLOCKED (protected file) |
| **B5** | Generic `<title>PWA</title>` | JS update `document.title` from store name (presentation-only) |
| **B6** | `<html lang="en">` | Change to `lang="id"` (presentation-only) |

---

## 6. CURRENT UX SCORECARD

| Area | Score | Reason |
|---|---|---|
| **First open** | YELLOW ⚠️ | Store header loads, greeting appears, but "Memuang…" is generic; no product discovery |
| **Store identity** | GREEN ✅ | Header shows merchant name + logo from `/init` |
| **Conversation** | GREEN ✅ | WhatsApp-like chat, AI/human distinction clear, dedup, reconnect |
| **Product** | GREEN ✅ | ProductCard with image, name, price, stock badge — all authoritative |
| **Product list** | YELLOW ⚠️ | Grid works but mobile is single-column; no pagination, no carousel |
| **Cart** | GREEN ✅ | Read-only, clear items + total |
| **Quick action** | RED ❌ | No quick-action chips; must type everything; quick_reply only appears after engine asks |
| **Human handoff** | GREEN ✅ | Teal bubble + "Admin" badge, clear handoff banner, distinct from AI |
| **Connection** | YELLOW ⚠️ | Banner works, but "Terputus" while HTTP still works could confuse |
| **Composer** | GREEN ✅ | textarea with Enter/Shift+Enter, clear disabled states |
| **Mobile** | YELLOW ⚠️ | Responsive grid, but single-column products; buttons wrap on long labels |
| **Accessibility** | GREEN ✅ | aria-labels, focus outlines, live regions, image alt, textarea label |
| **Merchant branding** | RED ❌ | PWA shows "QloBot" everywhere; not merchant-branded; start_url bug |
| **PWA installability** | RED ❌ | `start_url: "/"` lands on 404; no merchant identity in manifest |

---

## 7. FILES TO CHANGE

### Presentation-only (safe to edit):

| Priority | File | Change |
|---|---|---|
| **P0** | `apps/pwa/public/manifest.json` | Fix `start_url: "/"` → `"/c/"` |
| **P0** | `apps/pwa/index.html` | `lang="en"` → `lang="id"`; `<title>PWA</title>` → dynamic via JS |
| **P0** | `apps/pwa/src/main.tsx` | Add dynamic `<title>` + theme-color update from `/init`; add `display-mode` detection; add dynamic manifest injection (blob URL with merchant name + profilePhotoUrl icon) |
| **P1** | `apps/pwa/src/components/ChatPage.tsx` | Fix fall-back "Toku" → "Toko"; add store description display; add dynamic `<title>` update; add "Lihat Produk" quick chip on EmptyState |
| **P1** | `apps/pwa/src/components/EmptyState.tsx` | Add quick-action suggestion chips: "Lihat Produk", "Cari Produk", "Hubungi Admin" — each sends a predefined message via existing `/message` |
| **P1** | `apps/pwa/src/components/Composer.tsx` | Add quick-action chip row above textarea (product discovery shortcuts) |
| **P1** | `apps/pwa/src/components/ProductList.tsx` | Add horizontal scroll container on mobile; pagination "load more" support |
| **P1** | `apps/pwa/src/components/ProductCard.tsx` | Fix image aspect ratio (`aspect-square`) |
| **P1** | `apps/pwa/src/components/QuickReplyBar.tsx` | Horizontal scroll container for buttons on mobile |
| **P1** | `apps/pwa/src/components/ConnectionBanner.tsx` | Add reconnect attempt count (e.g., "Menyambung kembali… (3/10)") |
| **P1** | `apps/pwa/src/components/CartSummary.tsx` | Add "Hubungi Admin untuk checkout" note (no checkout button — blocked) |
| **P1** | `apps/pwa/src/components/MessageList.tsx` | Add "scroll to bottom" FAB for long conversations |
| **P2** | `apps/pwa/src/components/StatusBanner.tsx` | Add WhatsApp hint when human_takeover ("atau hubungi via WhatsApp") — if phone number becomes available |

### Requires owner decision (backend):

| File | Change | Why blocked |
|---|---|---|
| `apps/api/src/routes/pwa.ts` | Add `id: true` to `PWA_STORE_PUBLIC_SELECT` | PROTECTED — needed for product endpoint (storeId) |
| `apps/api/src/routes/pwa.ts` | Add `phoneNumber: true` / `whatsappPhoneId: true` to `PWA_STORE_PUBLIC_SELECT` | PROTECTED — needed for WhatsApp link |
| `apps/api/prisma/schema.prisma` | Add `brandColor` to Store model | PROTECTED + migration |

---

## 8. PROTECTED FILES

Must remain UNTOUCHED in all FASE 5.x work:

```
apps/api/src/business/conversation.service.ts      (processCustomerMessage)
apps/api/src/services/chat/*
apps/api/src/business/fallback.service.ts
apps/api/src/business/order.service.ts
apps/api/src/business/conversation-context.service.ts  (getOrCreateContext)
apps/api/src/services/message-queue.service.ts    (acquireLock)
apps/api/src/services/message-processor.service.ts
apps/api/src/services/conversation-delivery.service.ts
apps/api/src/services/event-bus.service.ts
apps/api/src/services/structured-message.mapper.ts
apps/api/src/routes/webhooks.ts
apps/api/src/routes/messages.ts
apps/api/src/routes/conversations.ts
apps/api/src/routes/products.ts
apps/api/src/business/product.service.ts
apps/api/src/services/fonnte.service.ts
apps/api/src/adapters/whatsapp/gowa.adapter.ts
apps/api/src/services/notification.service.ts
apps/api/src/services/realtime.service.ts
apps/api/src/config/vapid.config.ts
apps/api/prisma/schema.prisma
apps/pwa/public/sw.js
apps/pwa/src/components/NotificationPrompt.tsx
apps/pwa/src/utils/vapid.ts
```

**Verified:**
```
$ git diff --stat HEAD -- business/ services/ routes/ adapters/ config/ prisma/
(empty — zero changes)
```

---

## 9. RECOMMENDED IMPLEMENTATION ORDER

### Phase A — Critical PWA Fixes (presentation-only, < 1 day)
1. Fix `manifest.json` `start_url: "/"` → `"/c/"` (prevents 404 on install)
2. Fix `index.html` `<html lang="en">` → `lang="id"`
3. Add dynamic `<title>` in `main.tsx` (from store data after `/init`)
4. Add dynamic theme-color meta update (use `--color-brand` or store profilePhotoUrl)

### Phase B — Non-Typing Product Discovery (presentation-only + owner decision, 1-2 days)
5. **[OWNER DECISION]** Add `id: true` to `PWA_STORE_PUBLIC_SELECT` in `routes/pwa.ts` — required for product endpoint access
6. Add quick-action chips in `EmptyState.tsx`: "Lihat Produk", "Cari Produk", "Hubungi Admin" (each sends a predefined message via existing `/message`)
7. Add quick-action chip row in `Composer.tsx` (visible when no text input)
8. Add product catalog fetch in ChatPage after `/init` (if storeId available): `GET /api/stores/:storeId/products`
9. Render initial product list as `ProductList` structured message (presentation-only — use existing `ProductList` component)

### Phase C — Dynamic PWA Identity (presentation-only, 1 day)
10. Inject dynamic manifest via JS in `main.tsx` (merchant name + `profilePhotoUrl` as icon)
11. Add `display-mode: standalone` detection for install-specific UI
12. Update ConnectionBanner with reconnect attempt count

### Phase D — WhatsApp Integration (requires owner decision, BLOCKED)
13. **[OWNER DECISION]** Add `phoneNumber`/`whatsappPhoneId` to `PWA_STORE_PUBLIC_SELECT`
14. Add WhatsApp link in header / StatusBanner when human_takeover

### Phase E — Polish (presentation-only, 1-2 days)
15. ProductCard aspect-square fix
16. ProductList/ProductCard carousel on mobile
17. QuickReplyBar horizontal scroll on mobile
18. Scroll-to-bottom FAB
19. Store description display in header or empty state

---

## 10. STOP

No code written. No commit. No install. No migration.

This is an inspection-only audit. All findings are source-verified from `apps/pwa/src/` and `apps/api/src/` at commit `8289f5b` + uncommitted FASE 5 work.
