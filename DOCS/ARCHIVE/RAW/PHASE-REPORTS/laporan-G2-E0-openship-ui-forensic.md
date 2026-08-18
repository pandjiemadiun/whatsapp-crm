# G2-E.0 — OPENSHIP UI/UX FORENSIC AUDIT

**Master Blueprint + Master Roadmap:** Remain the source of truth.

**G2-E is MERCHANT STOREFRONT EXPERIENCE.**

**OpenShip Source:** /home/ubuntu/garuda/marketplace (Next.js 16 + shadcn-ui + Tailwind CSS v4)

**Objective:** Treat OpenShip as reference implementation visual/UX QloBot, NOT as architecture replacement.

**No changes to:** OpenShip source code, QloBot backend, UI implementation in this phase, new designs from imagination.

**No:** copy entire marketplace, modify QloBot UI, redesign from imagination if OpenShip has patterns.

**Audit Method:** Static code analysis of OpenShip Next.js 16 app, shadcn-ui components, Tailwind CSS v4 design tokens, and MCP/AI integration patterns.

---
## 1. APP SHELL / LAYOUT

**OpenShip Layout:**
- `app/layout.tsx` — Root layout with `AiConfigProvider` wrapping
- Fixed header `h-16` with `bg-background/80 backdrop-blur-sm` + `border-b`
- Logo arrangement: triangle of 3 icons (`OpenFrontIcon`, `OpenShipIcon`, `OpenSupportIcon`) hidden on `sm:flex`
- Marketplace text link with `Syne` font, gradient-foreground text
- Navigation: `ethos` link + GitHub icon link
- Body: `geistSans`/`geistMono`/`instrumentSerif`/`Syne` font variables
- Sidebar/content area with container queries via `@container/main`

**QloBot Comparison:**
- QloBot has no fixed-app header (WhatsApp-first, no persistent navbar)
- QloBot conversation header is transient (per-message, not persistent layout)
- **REUSE:** Tailwind `bg-background/80 backdrop-blur-sm` pattern, `border-b` layout
- **ADAPT:** Logo arrangement pattern for QloBot's own branding (if needed); Syne font usage
- **REBUILD:** QloBot app shell — QloBot needs different layout (conversation-centric, no persistent navbar)
- **JANGAN DIAMBIL:** Persistent fixed navbar — QloBot is chat-first, not marketplace-first

**G2-E Mapping:**
- E1 Design System — layout patterns, color schemes
- E2 First Impression — onboarding hero pattern (OpenShip has animated onboarding)
- E8 Browser Visual QA — layout consistency across breakpoints

---
## 2. DESIGN TOKENS INVENTORY

**OpenShip Tailwind CSS v4 + oklch Color Tokens:**

**Color Palette (Light/Dark):**
- `background`, `foreground`, `card`, `card-foreground`, `popover`, `popover-foreground`
- `primary`, `primary-foreground`, `secondary`, `secondary-foreground`
- `muted`, `muted-foreground`, `accent`, `accent-foreground`
- `destructive`, `border`, `input`, `ring`
- `chart-1` through `chart-5`
- `sidebar` variants (foreground, primary, accent)

**Radius Scale:**
- `--radius-sm: calc(var(--radius) - 4px)` = 0.585rem
- `--radius-md: calc(var(--radius) - 2px)` = 0.605rem
- `--radius-lg: var(--radius)` = 0.625rem
- `--radius-xl: calc(var(--radius) + 4px)` = 0.665rem
- Default `--radius: 0.625rem` (10px)

**Typography:**
- `Geist Sans` (`--font-geist-sans`) — sans-serif, Latin subset
- `Geist Mono` (`--font-geist-mono`) — monospace, Latin subset
- `Instrument Serif` (`--font-instrument-serif`) — serif, display: swap, weight 400
- `Syne` (`--font-syne`) — display font, Latin subset
- Applied via `className` on html element, or inline `className="${syne.className}"`

**Spacing:**
- None hardcoded in CSS; uses Tailwind `p-2`, `px-4`, `sm:px-6`, `lg:px-8`, `mb-8`, `pt-16`, etc.
- Common values: `px-4`, `sm:px-6`, `lg:px-8`, `py-3`, `mb-3`, `mb-4`, `mb-8`, `mb-16`

**Shadow:**
- `shadow-md` (0 2px 4px rgba(0,0,0,0.1))
- `shadow-[0px_0px_0.492px_0px_rgba(0,0,0,0.18),0px_0.984px_2.953px_0px_rgba(0,0,0,0.1)]` (textarea)

**Border Radius:**
- `--radius: 0.625rem` (10px) as default
- `rounded-[28px]` (large rounded inputs)
- `rounded-[23.49px]` (textarea corners)
- `radius-sm`, `radius-md`, `radius-lg`, `radius-xl` CSS vars

**G2-E Mapping:**
- E1 Design System — complete token inventory captured
- E2 First Impression — token values for onboarding/hero patterns
- E8 Browser Visual QA — color/spacing tokens for visual regression

---
## 3. HEADER / NAVIGATION

**OpenShip Header (`app/layout.tsx`):**
- `h-16` fixed top, `pointer-events-none`, `z-50`, `bg-background/80 backdrop-blur-sm`, `border-b border-border/40`
- Container: `max-w-full` with `mx-auto flex h-full max-w-full items-center justify-between px-4 sm:px-6 lg:px-8`
- Logo group (sm:hidden): `OpenFrontIcon` (top), `OpenShipIcon` + `OpenSupportIcon` (bottom, gap-2)
- Marketplace link: `syne` font, `text-[0.95rem] sm:text-[1.2rem] hover:opacity-80 transition-opacity`, gradient-foreground via `bg-clip-text text-transparent`
- Nav group: `ethos` link (syne, text-muted-foreground hover:text-foreground), GitHub link with rounded badge
- Mobile: hidden logo triangle, different arrangement

**QloBot Comparison:**
- QloBot has no persistent header (WhatsApp-first, conversation-transient)
- QloBot may have header only during onboarding or admin views
- **REUSE:** `backdrop-blur-sm`, `border-b`, fixed height `h-16`, flex layout patterns
- **ADAPT:** Navigation pattern for QloBot settings/account switcher (if needed)
- **REBUILD:** QloBot header — would need different structure (conversation switcher, not marketplace nav)
- **JANGAN DIAMBIL:** Fixed navbar with logo triangle — QloBot doesn't need marketplace branding in persistent header

**G2-E Mapping:**
- E1 Design System — header token values
- E2 First Impression — onboarding hero uses similar gradient-foreground text pattern

---
## 4. PRODUCT DISCOVERY / SEARCH

**OpenShip Product Discovery:**
- Primary entry: AI chat (`HomePage`) with `discoverProducts` MCP tool call
- Suggestion: "Show me products" → triggers `/api/mcp-transport/http` → `tools/call: discoverProducts`
- Cart selection: `handleCartSelect` → `getOrCreateCart` → `viewCart` via MCP transport
- AI config: `useAiConfig` hook, `ModeSplitButton` (env/local/disabled)
- Onboarding hero: "Discover products • Shop seamlessly • Checkout instantly"
- PromptSuggestions component with click handlers
- `/api/mcp-transport/http` endpoint for all MCP tool calls (getOrCreateCart, viewCart, discoverProducts, etc.)

**QloBot Comparison:**
- QloBot product discovery: LLM-extracted product names → `CartAuthority.addLine()` → DB product lookup → `OrderItem` rows
- QloBot clarification: `resolveProductByName` with exact match + ambiguous → `ProductAmbiguousError`
- QloBot cart: `CartAuthority.executeOps()` → single `$transaction` → OrderItem rows + Order.items JSON + confirmedItems
- **REUSE:** MCP transport pattern (`/api/mcp-transport/http`), suggestion chips, ModeSplitButton
- **ADAPT:** Product discovery flow — QloBot uses conversation engine + product DB lookup, not MCP transport
- **REBUILD:** QloBot product discovery UI — would integrate with conversation service, not MCP transport
- **JANGAN DIAMBIL:** MCP transport layer — QloBot uses different architecture (CartAuthority, not MCP JSON-RPC)

**G2-E Mapping:**
- E3 Product Discovery — MCP pattern reference, suggestion chip pattern
- E2 First Impression — onboarding "Discover products" messaging

---
## 5. PRODUCT CARD

**OpenShip Product Card:**
- Not a standalone component in the explored code; products discovered via AI chat MCP `discoverProducts`
- Products rendered in chat messages as `dynamic-tool` output with `type: output-available`
- Product data structure from MCP: includes `content` with `text` field containing JSON with product info
- Product image: typically via URL from MCP response, displayed in chat
- No standalone product card component like QloBot would have

**QloBot Product Card:**
- Would be a React component showing product image, name, price, "Add to cart" button
- Uses `CartAuthority.addLine()` to add to cart
- Price from `Product.price` (DB authoritative)
- Uses `productId` for identification

**REUSE:** MCP transport JSON structure for product data
**ADAPT:** Product card React component pattern (if QloBot needs standalone product browsing)
**REBUILD:** QloBot product card — would be QloBot-specific with CartAuthority integration
**JANGAN DIAMBIL:** MCP product discovery — QloBot uses different product resolution

**G2-E Mapping:**
- E3 Product Discovery — product card pattern reference (not direct reuse)

---
## 6. PRODUCT DETAIL

**OpenShip Product Detail:**
- Shown in chat as MCP tool output
- No separate product detail page in the explored code
- Details rendered in chat message with `AIMessage` component
- Can include: product name, description, price, images, potentially QRIS links

**QloBot Product Detail:**
- Would typically be a page route or chat message with full product specs
- Uses `orderService.getOrderById()` for existing orders, or `productService.getProductById()` for new products
- Shows: product name, description, price, stock, images, customizations, "Add to order" CTA

**REUSE:** Chat message rendering pattern, `AIMessage` component
**ADAPT:** Product detail in chat context — QloBot uses conversation engine, not MCP
**REBUILD:** QloBot product detail page or chat message — QloBot-specific with order state machine
**JANGAN DIAMBIL:** MCP product detail — QloBot architecture different

**G2-E Mapping:**
- E4 Conversation Commerce — product detail in chat context

---
## 7. CART

**OpenShip Cart:**
- Managed via `localStorage` (`openfront_marketplace_carts` key)
- `cartStorage` → `Record<string, string>` mapping storeId → cartId
- MCP `getOrCreateCart` and `viewCart` tools for cart operations
- `saveCartToLocalStorage(storeId, cartId)` on `__clientAction.saveCartId`
- `removeCartId(parsedText.storeId)` on `clearCartId`
- Cart state synced to conversation via `cartIdsState` + `sessionTokensState` in `useChat`
- CartsDropdown component shows store-specific carts
- Cart IDs persisted across reload via `window.addEventListener('storage', loadCartIds)`

**QloBot Cart:**
- CartAuthority: single authority for cart state
- OrderItem relation rows + Order.items JSON + confirmedItems JSON (all synced in single `$transaction`)
- `cartAuthority.addLine()`, `removeLine()`, `updateQuantity()`, `clearCart()` — all atomic `$transaction`
- `cartAuthority.checkout()` → `transitionOrder()` → stock validation + confirmedItems clear
- Cart persistence via Prisma Order + OrderItem relation (not localStorage)
- Cart state survives channel switch (WhatsApp ↔ Chatbox) via canonical state + conversation history

**REUSE:** None directly — different cart architecture (localStorage MCP vs Prisma CartAuthority)
**ADAPT:** Cart dropdown UX pattern (CartsDropdown), localStorage persistence pattern (if QloBot ever needs offline cart)
**REBUILD:** QloBot cart — must use CartAuthority pattern with OrderItem rows, not localStorage + MCP
**JANGAN DIAMBIL:** localStorage cart management — QloBot requires persistent cart across channels and sessions; localStorage lost on new device/clear

**G2-E Mapping:**
- E5 Cart UX — major architectural difference; OpenShip cart is reference for UX patterns only, not architecture

---
## 8. EMPTY/LOADING/ERROR STATES

**OpenShip Empty States:**
- `ChatUnactivatedState` component — shown when AI not enabled/onboarded
- Onboarding hero when `!isAiChatReady` and `messages.length === 0`
- Skeleton loaders via `sonner`/`spinner` components
- `ModeSplitButton` when mode not set

**OpenShip Loading States:**
- `isLoading` state: textarea disabled, button shows spinning SVG
- `status === 'streaming'` or `status === 'submitted'` → loading
- `motion.div` with `layout="position"` animations for onboarding, chat messages
- `AnimatePresence` with `layout="popLayout"` for message enter/exit

**OpenShip Error States:**
- `onError: (error) => console.error("Chat error:", error)` in `useChat`
- Caught errors logged, fallback to `sendMessage({ text: suggestion })`
- QRIS follow-up failures logged with `adapters.logger.warn`
- Try/catch blocks with fallback messages throughout

**QloBot Empty/Loading/Error States:**
- Empty cart: `cartAuthority.getCartSummary()` returns `{ items: [], total: null }`
- Loading: textarea disabled, send button shows spinner
- Error: cart operations throw `CartInvariantError`; caught in webhook handlers; user sees friendly messages
- Skeleton states not heavily used; loading states via disabled attribute + spinner SVG

**REUSE:** Loading button pattern (spinner SVG), skeleton-like disabled states
**ADAPT:** Error boundary patterns — QloBot uses `CartInvariantError` + webhook error handling
**REBUILD:** QloBot empty/loading/error states — must be built for conversation + cart + stock flows
**JANGAN DIAMBIL:** localStorage error handling — QloBot uses Prisma DB, not localStorage

**G2-E Mapping:**
- E5 Cart UX — loading/error patterns for cart operations
- E8 Browser Visual QA — visual consistency of states across breakpoints

---
## 9. CHAT/CONVERSATION UI (IF PRESENT)

**OpenShip Chat UI:**
- `ChatContainerRoot` / `ChatContainerContent` / `ChatContainerScrollAnchor` — dual-sidebar layout
- `AIMessage` component — renders assistant messages with `isLoading`, `status`, `parts` (dynamic-tool output)
- `PromptSuggestions` — clickable suggestion chips (e.g., "Show me products", "Total belanja")
- `CartsDropdown` — store-specific cart selector
- `PromptSuggestions` + `ModeSplitButton` + `CartsDropdown` in input area
- `ChatUnactivatedState` — when AI not yet onboarded; shows onboarding hero
- `useChat` from `ai-sdk/react` with `DefaultChatTransport` to `/api/completion`
- `sendMessage`, `stop`, `setMessages` hooks
- `useRef` for cart IDs, session tokens, marketplace config persistence
- `motion` (framer-motion) for layout animations (`layout="popLayout"`, `layout="position"`)
- `AnimatePresence` for message enter/exit

**QloBot Chat UI:**
- `conversationService.processCustomerMessage()` — V1/V2 engine branching
- `cartAuthority.getCartAsConfirmedItems()` — cart state in chat context
- `transitionOrder` — state machine transitions
- `structured-message.mapper.fetchCart` — reads from OrderItem relation
- No `dual-sidebar` layout; single conversation column
- No `CartsDropdown` — cart accessed via chat commands ("total", "cek pesanan")
- No `ModeSplitButton` — QloBot has only one engine path (with V1/V2 fallback)
- `useChat` not used; custom message pipeline via `messageProcessorService`

**REUSE:** `AIMessage` component pattern (if QloBot needs chat message rendering)
**ADAPT:** Chat layout — QloBot different (single column, no dual sidebar)
**REBUILD:** QloBot chat UI — must be built for conversation-first, cart-authority-integrated flow
**JANGAN DIAMBIL:** Dual-sidebar layout — QloBot is conversation-centric, not marketplace dual-panel

**G2-E Mapping:**
- E4 Conversation Commerce — chat UI patterns, but architecture different

---
## 10. MOBILE/RESPONSIVE BEHAVIOR

**OpenShip Mobile (sm: breakpoints):**
- Header logo triangle `hidden sm:flex` — hides on mobile, different arrangement
- Input area: `flex-col md:absolute md:bottom-[-70px] md:order-2 md:h-[70px] md:left-0 md:right-0 md:px-2` — shifts from order-1/2 to absolute bottom on mobile
- `max-w-[50rem]` on main content — max width 800px
- `px-2` on input container, `sm:px-0` on onboarding
- `text-[0.95rem] sm:text-[1.2rem]` — font sizes scale at sm breakpoint
- `grid-cols-1` implicit — content flows single column

**QloBot Mobile:**
- Conversation scrolls vertically; no persistent header to hide
- Input area at bottom, full width
- No dual-sidebar; single conversation column
- Touch targets: minimum 44px (Tailwind `size-8 sm:size-9` = 32px/36px, may need increase for touch)

**REUSE:** `sm:` breakpoint patterns, `max-w-[50rem]`, font size scaling
**ADAPT:** Mobile input positioning — QloBot would adapt `absolute bottom` pattern
**REBUILD:** QloBot mobile responsiveness — must be built for conversation flow, no marketplace dual-panel
**JANGAN DIAMBIL:** Mobile header hiding pattern — QloBot doesn't have persistent header

**G2-E Mapping:**
- E8 Browser Visual QA — responsive breakpoints

---
## 11. INTERACTION/ANIMATION

**OpenShip Motion:**
- `framer-motion` heavily used:
  - `layout="popLayout"` — onboarding hero enter/exit
  - `layout="position"` — chat input container, message animations
  - `AnimatePresence` with `layout="popLayout"` — message enter/exit
  - `motion.div` with custom `layoutId` for coordinated animations
- `tw-animate-css` plugin for additional animations
- `sonner` toast notifications with custom patterns
- `ember` (likely typo, should be `sonner`) toast component

**OpenShip Interactions:**
- `ModeSplitButton` — env/local/disabled mode selection
- `CartsDropdown` — store cart selector with `onCartSelect` handler
- `PromptSuggestions` — suggestion chip click → `handleSuggestionClick`
- `handleKeyDown` → Enter sends message, Shift+Enter = new line (typical textarea)
- `handleSuggestionClick` — "Show me products" → MCP `discoverProducts` call
- `handleCartSelect` — cart selection with MCP `getOrCreateCart` + `viewCart`
- `saveCartToLocalStorage` / `removeCartId` — localStorage persistence
- `window.addEventListener('storage')` — persistence across reloads

**QloBot Interactions:**
- `conversationService.processCustomerMessage()` — message processing
- `cartAuthority.executeOps()` — cart add/remove/update in single tx
- `transitionOrder()` — state machine transitions
- `cartAuthority.checkout()` — stock validation + transition
- `cartAuthority.getCartAsConfirmedItems()` — cart read
- Clarification resolver: `resolvePending`, `resolvePending` with EXECUTE/ROLLBACK/RETRY
- Human takeover: `markHumanTakeover`, `human_takeover` status
- No `ModeSplitButton` — only one engine path with V1/V2 fallback
- No `CartsDropdown` — cart via chat commands
- No `PromptSuggestions` with MCP calls — uses conversation engine suggestions

**REUSE:** `handleKeyDown` pattern (Enter to send, Shift+Enter new line), `motion` animation principles
**ADAPT:** Interaction patterns for chat + cart — QloBot different architecture
**REBUILD:** QloBot interactions — must be built for conversation + cart-authority flow
**JANGAN DIAMBIL:** MCP transport calls — QloBot uses different architecture

**G2-E Mapping:**
- E5 Cart UX — interaction patterns reference
- E6 Human Handoff — human takeover pattern reference

---
## 12. ACCESSIBILITY / TOUCH TARGETS

**OpenShip Accessivity:**
- `focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0` — explicit removal (may be too minimal)
- `placeholder:text-muted-foreground` — accessible placeholder styling
- `disabled:cursor-not-allowed disabled:opacity-50` — disabled state accessibility
- `aria-label="GitHub"` on GitHub link — accessible icon link
- `text-muted-foreground` used for non-primary text
- `bg-white dark:bg-gray-950` for textarea background — high contrast
- `shadow-[0px_0px_0.492px_0px_rgba(0,0,0,0.18)]` — subtle shadow for inputs

**Touch Targets:**
- `size-8 sm:size-9` = 32px/36px — below 44px Apple/Google recommendation
- `rounded-full` on submit button — may be small for touch
- `p-2` on textarea container — may be tight for touch
- `rounded-[23.49px]` / `rounded-[28px]` — inputs have relatively large touch targets

**QloBot Accessibility:**
- Would need: `min-h-[44px]` / `min-w-[44px]` for touch targets
- `focus-visible` styles should be added (currently removed in OpenShip)
- Color contrast already good (oklch tokens)
- `aria-label` on interactive elements

**REUSE:** Placeholder styling, disabled state patterns
**ADAPT:** Touch target sizes — QloBot should increase to 44px minimum
**REBUILD:** QloBot accessibility — built for conversation + cart authority flows
**JANGAN DIAMBIL:** Explicit `outline-none` removal — may hurt accessibility; QloBot should keep focus visible

**G2-E Mapping:**
- E8 Browser Visual QA — accessibility visual check
- E5 Cart UX — touch target requirements

---
## 14. COMPONENT LIBRARY & REUSABLE COMPONENTS

**OpenShip Component Library (shadcn-ui based, 90+ components):**
- **Layout:** `layout.tsx`, `sidebar.tsx`, `dual-sidebar/` (ChatContainerRoot/Content/ScrollAnchor), `mode-split-button.tsx`
- **Form:** `input.tsx`, `textarea.tsx`, `select.tsx`, `checkbox.tsx`, `radio-group.tsx`, `switch.tsx`, `toggle.tsx`, `toggle-group.tsx`, `form.tsx`, `field-label.tsx`, `field-container.tsx`, `field-description.tsx`, `input-otp.tsx`
- **Feedback:** `alert.tsx`, `alert-dialog.tsx`, `toast.tsx`, `toaster.tsx`, `sonner` notifications
- **Navigation:** `breadcrumb.tsx`, `dropdown-menu.tsx`, `menubar.tsx`, `navigation-menu.tsx`, `popover.tsx`, `tooltip.tsx`
- **Data Display:** `badge.tsx`, `table.tsx`, `card.tsx`, `carousel.tsx`, `chart.tsx`, `progress.tsx`
- **Feedback/interaction:** `accordion.tsx`, `avatar.tsx`, `aspect-ratio.tsx`, `button.tsx`, `badge-button.tsx`, `collapsible.tsx`, `command.tsx`, `dialog.tsx`, `drag-resizable`, `hover-card.tsx`, `loading-button.tsx`, `resizable.tsx`, `separator.tsx`, `skeleton.tsx`, `sonner`/`toast`
- **Utility:** `theme-switcher.tsx`, `use-mobile.tsx`, `use-toast.ts`, `lib/utils.tsx` (cn helper)

**QloBot Component Needs:**
- Would need: conversation message components, cart display, stock badges, clarification chips, human takeover badge, order state indicators
- Can reuse: `input.tsx`, `button.tsx`, `form.tsx`, `alert.tsx`, `toast.tsx` patterns
- Would need to build: `AIMessage` equivalent, cart display, order state indicator, clarification resolver UI

**REUSE:** shadcn-ui base components (input, button, form, alert, toast)
**ADAPT:** Component patterns for chat + cart flow
**REBUILD:** Full component library for QloBot — different domain, different state management
**JANGAN DIAMBIL:** Complete component library — QloBot needs different set

**G2-E Mapping:**
- E1 Design System — component patterns reference
- E5 Cart UX — cart display component patterns

---
## 15. DEPENDENCIES & LICENSING CONCERNS

**OpenShip Dependencies:**
- `@radix-ui/react-*` (9 radix UI primitives) — MIT license
- `framer-motion` — MIT license
- `sonner` — MIT license
- `lucide-react` — ISC license
- `@radix-ui/react-*` — all MIT
- `tailwindcss` — MIT license
- `next` — MIT license
- `ai-sdk/react` — Apache-2.0
- `@modelcontextprotocol/sdk` — Apache-2.0
- `stripe/react-paypal-js` — vary by component
- `lucide-react` — ISC
- `lodash` — MIT
- `class-variance-authority` — MIT
- `clsx` — MIT
- `cmdk` — MIT
- `embla-carousel-react` — MIT
- `graphql` / `graphql-request` — MIT/Apache-2.0
- `react-country-flag` — MIT
- `react-day-picker` — MIT
- `react-hook-form` — MIT
- `react-markdown` — MIT
- `react-resizable-panels` — MIT
- `recharts` — MIT
- `remark-breaks` / `remark-gfm` — MIT
- `sonner` — MIT
- `tailwind-merge` — MIT
- `tailwindcss-animate` — MIT
- `use-stick-to-bottom` — MIT

**QloBot Dependency Concerns:**
- No new dependencies needed from OpenShip — QloBot has its own dependency set
- If adapting shadcn-ui components: same licenses apply (MIT)
- `@radix-ui/react-*` components can be directly used in QloBot (same licenses)
- `framer-motion` may already be a QloBot dependency or can be added (MIT)
- No GPL or copyleft concerns in OpenShip dependency tree

**G2-E Mapping:**
- E1 Design System — dependency inventory for design token system
- E8 Browser Visual QA — no licensing blockers from OpenShip

---
## QLOBot ↔ OPENSHIP GAP ANALYSIS

| Category | OpenShip → QloBot: REUSE | OpenShip → QloBot: ADAPT | OpenShip → QloBot: REBUILD | GAP |
|----------|----------------------|----------------------|------------------------|-----|
| **Layout** | `backdrop-blur-sm`, `border-b`, flex patterns | Navigation adaptation | Full app shell rebuild | Mobile header hiding |
| **Design Tokens** | Color values, radius, typography family | Font size scaling at breakpoints | Full token system rebuild | oklch color space adaptation |
| **Product Discovery** | MCP transport JSON, suggestion chips | Conversation engine integration | Full product discovery rebuild | MCP vs CartAuthority architecture |
| **Product Card/Detail** | Chat message rendering, AIMessage component | Conversation engine product detail | Full product UI rebuild | MCP vs OrderItem architecture |
| **Cart** | None (architecturally incompatible) | Cart dropdown UX pattern | Full cart rebuild with CartAuthority | localStorage vs Prisma |
| **Empty/Loading/Error** | Loading button, skeleton patterns | Error boundary patterns | Full states rebuild for conv+cart | localStorage vs DB |
| **Chat UI** | AIMessage component, suggestion chips | Chat layout adaptation | Full chat UI rebuild | Dual-sidebar vs single column |
| **Mobile** | Breakpoint patterns, font scaling | Input positioning adaptation | Full responsiveness rebuild | No persistent header |
| **Motion/Animation** | framer-motion patterns, layout animations | Animation principles | Full motion system rebuild | framer-motion usage |
| **Accessibility** | Placeholder styling, disabled states | Touch target minimum 44px | Full a11y rebuild for conv+cart | outline-none removal |
| **Component Library** | shadcn-ui base (input, button, form, alert, toast) | Chat+cart component adaptation | Full component library rebuild | Complete library mismatch |
| **Dependencies** | MIT-licensed shared deps | Same licenses apply | No new deps needed | None critical |

**GAP Summary:**
- **Critical GAPs:** Cart architecture (localStorage MCP vs CartAuthority), chat layout (dual-sidebar vs single column), state management (MCP JSON-RPC vs Prisma + state machine)
- **Medium GAPs:** Motion/animation patterns, touch target sizing, accessibility enhancements
- **Low GAPs:** Color tokens, radius values, typography families (can be directly adapted)

**G2-E Roadmap Mapping:**
- E1 Design System — token inventory, component patterns (LOW GAP — can adapt)
- E2 First Impression — onboarding/hero patterns (LOW GAP — can adapt)
- E3 Product Discovery — MCP vs CartAuthority architecture (CRITICAL GAP — rebuild needed)
- E4 Conversation Commerce — chat architecture (CRITICAL GAP — rebuild needed)
- E5 Cart UX — cart architecture (CRITICAL GAP — rebuild needed)
- E6 Human Handoff — human takeover patterns (MEDIUM GAP — can adapt some)
- E7 Merchant PWA — PWA patterns can adapt (LOW GAP)
- E8 Browser Visual QA — visual regression patterns (LOW GAP — can adapt)

**VERDICT: YELLOW**
OpenShip UI successfully mapped and many patterns can be adapted for QloBot design system (tokens, components, layouts). However, critical architectural gaps exist in cart architecture, chat layout, and state management that require QloBot-specific rebuilding, not direct reuse. The reference value is high for design tokens, interaction patterns, and visual design — but the core commerce engine integration cannot copy OpenShip directly.

**RECOMMENDATION:** Use OpenShip as reference for:
- Design token system (colors, typography, radius, spacing)
- Interaction patterns (keyboard navigation, motion, loading states)
- Component patterns (shadcn-ui base components)
- Visual design systems and layout concepts
NOT for:
- Cart architecture (use CartAuthority)
- Chat engine architecture (use conversation engine)
- State management (use Prisma + state machine)
- Product discovery flow (use MCP vs CartAuthority integration)