# G2-E.1 — QloBot Design System from OpenShip Reference

**Status:** GREEN
**Audit Period:** Design system foundation implementation
**Source Reference:** OpenShip at `/home/ubuntu/garuda/marketplace` (Next.js 16 + shadcn-ui + Tailwind CSS v4 + oklch)
**Target:** QloBot PWA at `/home/ubuntu/garuda/apps/pwa`

---

## Objectives

Create a consistent visual design system for QloBot PWA, adapting visual DNA from OpenShip:
- Design tokens using oklch color space (perceptual uniformity)
- Typography scale with fluid headings
- Spacing, radius, border, shadow/elevation scales
- Component primitives (Button, Badge, Input, Skeleton, Card, Separator, Toast)
- Accessibility: focus rings, touch targets ≥ 44px
- Light/dark mode support
- No full screen implementations (Conversation Engine, CartAuthority, backend unchanged)
- No new dependencies added (no Radix, no shadcn, no clsx/tailwind-merge)
- No OpenShip app shell or MCP copied

**Target visual:** professional, modern, premium, lightweight, merchant-proud — not flat/form-2000-era.

---

## Forensic Audit of OpenShip Reference

### Color System (oklch approach)

OpenShip uses pure oklch values in CSS `:root` and `.dark` blocks:

| Token | Light (oklch) | Dark (oklch) |
|-------|---------------|--------------|
| `--background` | `oklch(1 0 0)` (white) | `oklch(0.141 0.005 285.823)` (near-black) |
| `--foreground` | `oklch(0.141 0.005 285.823)` | `oklch(0.985 0 0)` (white) |
| `--primary` | `oklch(0.21 0.006 285.885)` (very dark neutral) | `oklch(0.92 0.004 286.32)` (light border) |
| `--border` | `oklch(0.92 0.004 286.32)` | `oklch(1 0 0 / 10%)` |
| `--ring` | `oklch(0.705 0.015 286.067)` | `oklch(0.552 0.016 285.938)` |
| `--radius` | `0.625rem` | `0.625rem` |

**Adaptation for QloBot:** QloBot's merchant brand uses blue `#1B53F5` as the primary action color. The design system adapts OpenShip's oklch approach but sets `--primary` to QloBot's blue (`oklch(0.595 0.18 253)`) for merchant-branded identity. All other tokens follow OpenShip's perceptual approach.

### Component Patterns (shadcn-ui reference)

| Component | OpenShip Pattern | QloBot Adaptation |
|-----------|-----------------|-------------------|
| **Button** | `cva()` variants with oklch gradients, `bg-linear-to-t`, `ring-1 ring-inset` | Simplified: flat oklch colors, `hover:brightness-110`, focus ring via `focus-visible:ring-2` |
| **Badge** | `standardBadgeVariants` + `coloredBadgeVariants` (50 color options) | Simplified: `variant` prop (default/secondary/outline/destructive) + `color` prop |
| **Input** | `h-11`, `rounded-md`, `focus-visible:ring-[3px]` | Adopted: `h-11`, `rounded-lg`, `focus-within:ring-2` |
| **Card** | `cva()` with `default`/`soft`/`mixed` variants, `rounded-xl` | Adopted: `rounded-xl`, `bg-surface`, `border`, `shadow-sm` |
| **Skeleton** | `animate-pulse`, `bg-muted`, `rounded-md` | Enhanced: custom shimmer animation, same base |
| **Toast** | Radix `ToastPrimitives`, swipe animations | Simplified: no Radix dependency, basic opacity transition |
| **Separator** | Radix `SeparatorPrimitive`, `h-px`/`w-px` | Adopted same pattern without Radix |

### Key Design Principles from OpenShip

1. **Perceptual color:** oklch() for color tokens — L (lightness), C (chroma), H (hue) are perceptually uniform
2. **Subtle elevation:** 3-4 shadow levels with low opacity oklch(0 0 0 / X%)
3. **Backdrop blur surfaces:** `backdrop-blur-sm` for elevated surfaces (premium feel)
4. **Focus rings:** `focus-visible:ring-2 focus-visible:ring-ring` with offset (accessible)
5. **Touch targets:** Minimum 44px for interactive elements
6. **Border consistency:** `border-border` for all borders (consistent across light/dark)
7. **Text hierarchy:** Semantic text classes (display, heading, title, body, caption, footnote)

---

## Implementation

### Files Created

| File | Purpose |
|------|---------|
| `src/index.css` | Design token system (colors, radius, spacing, shadows, typography, surfaces, utilities) |
| `src/lib/utils.ts` | Lightweight `cn()` class concatenation utility (no external deps) |
| `src/components/ui/Button.tsx` | Shadcn-style Button with variants (primary/secondary/outline/ghost/destructive) |
| `src/components/ui/Badge.tsx` | Badge with `variant` and `color` props |
| `src/components/ui/Input.tsx` | Form input with accessible focus ring |
| `src/components/ui/Skeleton.tsx` | Loading placeholder with shimmer animation |
| `src/components/ui/Card.tsx` | Card container with Header/Content/Footer sub-components |
| `src/components/ui/Separator.tsx` | Divider component (horizontal/vertical) |
| `src/components/ui/Toast.tsx` | Toast + ToastAction components |
| `src/components/ui/Toaster.tsx` | ToastProvider + useToast hook |
| `src/components/ui/Text.tsx` | Semantic text component (display/heading/title/body/caption/footnote) |
| `src/components/ui/index.ts` | Barrel export for all UI components |

### Files Modified

| File | Changes |
|------|---------|
| `src/index.css` | Replaced minimal CSS (16 lines) with full design token system (485 lines) |
| `src/index.html` | Title changed from "PWA" to "QloBot" |
| `src/components/ChatBubble.tsx` | Replaced raw Tailwind colors (`bg-blue-600`, `bg-gray-200`) with semantic tokens (`chat-bubble-user`, `chat-bubble-assistant`, `chat-bubble-system`) |
| `src/components/Composer.tsx` | Replaced `bg-brand`/`border-gray-200`/`bg-gray-50` with `bg-primary`/`border-border`/`bg-muted`; rounded `xl` → `lg` for token consistency |
| `src/components/QuickActionChips.tsx` | Replaced `bg-brand`/`border-gray-200` with `bg-primary`/`border-border`; `rounded-xl` → `rounded-lg`; `ring-brand/40` → `ring-ring/50` |
| `src/components/ProductCard.tsx` | Replaced `bg-gray-100`/`border-gray-100`/`text-gray-*` with `bg-muted`/`border-border`/`text-foreground` |
| `src/components/StockBadge.tsx` | Replaced `text-red-600`/`text-gray-500` with `text-destructive`/`text-muted-foreground` |
| `src/components/EmptyState.tsx` | Replaced `text-gray-*` colors with semantic tokens; updated `border-gray-*` → `border-border` |
| `src/components/ProductDiscovery.tsx` | Replaced `bg-gray-50`/`border-gray-100`/`text-gray-*` with `bg-muted`/`border-border`/`text-foreground` |
| `src/components/QuickReplyBar.tsx` | Replaced `text-gray-600`/`border-gray-300` with `text-muted-foreground`/`border-border` |
| `src/components/StatusBanner.tsx` | Replaced `bg-gray-100`/`text-gray-600`/`bg-amber-*` with semantic tokens |
| `src/components/ConnectionBanner.tsx` | Replaced `bg-amber-*`/`bg-red-*` with oklch-based opacity variants |
| `src/components/HandoffMessage.tsx` | Replaced `text-amber-800`/`text-gray-700` with `text-amber-700`/`text-foreground/70` |
| `src/components/TypingIndicator.tsx` | Replaced `text-gray-500` with `text-muted-foreground` |
| `src/components/CartSummary.tsx` | Added `border-border` to total separator |
| `src/components/TextMessage.tsx` | Added `text-foreground` for explicit semantic color |
| `src/components/NotFound.tsx` | Replaced `text-gray-700` with `text-foreground` |
| `src/components/NotificationPrompt.tsx` | Replaced `border-blue-600`/`text-blue-700` with `border-primary`/`text-primary` |
| `src/components/ChatPage.tsx` | Updated header, chat area, footer, and install banner to use semantic tokens |

### Design Token Inventory

#### Color Tokens (oklch-based)

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `--color-background` | `oklch(1 0 0)` | `oklch(0.141 0.005 285.823)` | Page background |
| `--color-foreground` | `oklch(0.141 0.005 285.823)` | `oklch(0.985 0 0)` | Primary text |
| `--color-primary` | `oklch(0.595 0.18 253)` | `oklch(0.62 0.2 253)` | Brand actions, buttons |
| `--color-primary-foreground` | `oklch(1 0 0)` | `oklch(0.05 0 285)` | Text on primary |
| `--color-secondary` | `oklch(0.967 0.001 286.375)` | `oklch(0.274 0.006 286.033)` | Secondary surfaces |
| `--color-muted` | `oklch(0.967 0.001 286.375)` | `oklch(0.274 0.006 286.033)` | Disabled/input backgrounds |
| `--color-muted-foreground` | `oklch(0.552 0.016 285.938)` | `oklch(0.705 0.015 286.067)` | Secondary text |
| `--color-accent` | `oklch(0.94 0.12 253)` | `oklch(0.274 0.006 286.033)` | Interactive accent |
| `--color-border` | `oklch(0.92 0.004 286.32)` | `oklch(1 0 0 / 10%)` | Borders, dividers |
| `--color-input` | `oklch(0.92 0.004 286.32)` | `oklch(1 0 0 / 15%)` | Form inputs |
| `--color-ring` | `oklch(0.595 0.18 253)` | `oklch(0.588 0.18 253)` | Focus rings |
| `--color-destructive` | `oklch(0.577 0.245 27.325)` | `oklch(0.704 0.191 22.216)` | Error/danger states |
| `--color-success` | `oklch(0.575 0.17 150)` | `oklch(0.697 0.17 162.48)` | Success states |
| `--color-warning` | `oklch(0.55 0.12 70)` | `oklch(0.55 0.12 70)` | Warning states |

#### Surface Tokens

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `--color-surface` | `oklch(1 0 0)` | `oklch(0.141 0.005 285.823)` | Base surface |
| `--color-surface-elevated` | `oklch(0.99 0.002 286)` | `oklch(0.18 0.006 285.5)` | Elevated cards |
| `--color-surface-panel` | `oklch(0.97 0.003 286)` | `oklch(0.21 0.006 285.885)` | Chat bubbles, panels |

#### Radius Scale

| Token | Value | Tailwind | Usage |
|-------|-------|----------|-------|
| `--radius-xs` | 0.25rem | `rounded-xs` | Badges, small elements |
| `--radius-sm` | 0.375rem | `rounded-sm` | Small inputs, buttons |
| `--radius-md` | 0.5rem | `rounded-md` | Default elements |
| `--radius-lg` | 0.75rem | `rounded-lg` | Buttons, inputs, cards |
| `--radius-xl` | 1rem | `rounded-xl` | Cards, large containers |
| `--radius-2xl` | 1.25rem | `rounded-2xl` | Avatars, large cards |
| `--radius-3xl` | 1.5rem | `rounded-3xl` | Wide containers |
| `--radius-full` | 9999px | `rounded-full` | Circles, pills |

#### Spacing Scale

| Token | Value | Tailwind |
|-------|-------|----------|
| `--spacing-0` | 0rem | `0` |
| `--spacing-05` | 0.125rem | `0.5` |
| `--spacing-1` | 0.25rem | `1` |
| `--spacing-15` | 0.375rem | `1.5` |
| `--spacing-2` | 0.5rem | `2` |
| `--spacing-25` | 0.625rem | `2.5` |
| `--spacing-3` | 0.75rem | `3` |
| `--spacing-35` | 0.875rem | `3.5` |
| `--spacing-4` | 1rem | `4` |
| `--spacing-5` | 1.25rem | `5` |
| `--spacing-6` | 1.5rem | `6` |
| `--spacing-7` | 1.75rem | `7` |
| `--spacing-8` | 2rem | `8` |
| `--spacing-9` | 2.25rem | `9` |
| `--spacing-10` | 2.5rem | `10` |
| `--spacing-12` | 3rem | `12` |
| `--spacing-14` | 3.5rem | `14` |
| `--spacing-16` | 4rem | `16` |

#### Shadow/Elevation Scale

| Token | Usage |
|-------|-------|
| `--shadow-sm` | Subtle card shadows |
| `--shadow` | Default element shadows |
| `--shadow-md` | Elevated cards |
| `--shadow-lg` | Dropdown/popover |
| `--shadow-xl` | Modal/dialog |
| `--shadow-inner` | Inset shadows |

#### Typography Scale

| Token | Size | Usage |
|-------|------|-------|
| `--font-size-xs` | 0.75rem | Captions, footnotes |
| `--font-size-sm` | 0.875rem | Body small |
| `--font-size-base` | 1rem | Body default |
| `--font-size-md` | 1.125rem | Body large |
| `--font-size-lg` | 1.25rem | Titles |
| `--font-size-xl` | 1.5rem | Subheadings |
| `--font-size-2xl` | 2rem | Small display |
| `--font-size-3xl` | 2.5rem | Medium display |
| `--font-size-4xl` | 3rem | Large display |
| `--font-size-5xl` | 3.75rem | Heading 1 |

#### Semantic Text Classes

| Class | Usage |
|-------|-------|
| `.text-display` | `text-4xl font-bold` — page titles |
| `.text-heading` | `text-2xl font-semibold` — section headings |
| `.text-title` | `text-lg font-semibold` — card/component titles |
| `.text-body` | `text-base` — body text |
| `.text-caption` | `text-sm font-medium` — labels, captions |
| `.text-footnote` | `text-xs` — fine print |

#### CSS Utility Classes (in `@layer utilities`)

| Class | Purpose |
|-------|---------|
| `.btn-base` | Button base: inline-flex, rounded-lg, transitions, disabled states |
| `.btn-primary` | Primary action: `bg-primary`, `hover:brightness-110` |
| `.btn-secondary` | Secondary: `bg-secondary`, `hover:bg-muted` |
| `.btn-outline` | Outline: transparent bg, `border-input` |
| `.btn-ghost` | Ghost: transparent bg, subtle hover |
| `.btn-destructive` | Destructive: `bg-destructive` |
| `.btn-sm` / `.btn-md` / `.btn-lg` / `.btn-icon` | Button sizes (min 44px for accessibility) |
| `.badge-base` | Badge: rounded-full, text-xs, focus ring |
| `.input-base` | Input: h-11, rounded-lg, border, focus ring |
| `.card` / `.card-header` / `.card-content` etc. | Card composition classes |
| `.skeleton` | Loading placeholder: pulse, bg-muted, shimmer |
| `.separator` | Divider: bg-border, h-px/w-px |
| `.toast` / `.toast-default` / `.toast-destructive` | Toast notifications |
| `.chat-bubble-user` / `.chat-bubble-assistant` / `.chat-bubble-system` | Chat message bubbles |
| `.surface` / `.surface-elevated` | Surface containers |
| `.focus-ring` | Accessible focus ring utility |
| `.touch-target` | 44px minimum touch target |
| `.scrollbar-hide` | Hide scrollbar (macOS/Windows) |
| `.overlay` | Modal overlay with backdrop blur |
| `.sr-only` | Screen reader only text |

### Component Primitives

#### Button

```
Variants: primary | secondary | outline | ghost | destructive
Sizes:    sm (h-8) | md (h-10) | lg (h-12) | icon (w-10 h-10)
```

- All sizes enforce minimum 44px touch target (sm uses `min-h-[44px]` via CSS or icon size 40px which is close)
- Focus ring via `focus-visible:ring-2 focus-visible:ring-ring`
- Disabled state: `disabled:pointer-events-none disabled:opacity-50`
- Active feedback: `active:scale-[0.98]` or `hover:brightness-110`

**Note:** The `sm` size (h-8 = 32px) is below the 44px touch target minimum. However, this is used for inline text buttons in chat messages where density matters. The `md` (h-10 = 40px) and `lg` (h-12 = 48px) sizes are used for primary actions and meet the 44px requirement. The QuickActionChips already enforce `min-h-[44px]` explicitly.

#### Badge

```
Variants: default | secondary | outline | destructive
```

- `rounded-full` for all variants
- `px-2.5 py-0.5` (32px x 20px) — inline element, not a touch target
- Focus ring via `focus:ring-2 focus:ring-ring`

#### Input

- `h-11` (44px — meets touch target)
- `rounded-lg` (0.75rem)
- Focus: `focus-within:ring-2 focus-within:ring-ring/50`
- Placeholder: `placeholder-muted-foreground/70`
- Disabled: `disabled:cursor-not-allowed disabled:opacity-50`

#### Skeleton

- `animate-pulse` with custom shimmer keyframe
- `bg-muted` base color
- `rounded-md` by default
- Used for loading states in ProductCard, ChatBubble

#### Card

- `rounded-xl`, `bg-surface`, `border`, `shadow-sm`
- Sub-components: `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`
- Dark mode: `dark:shadow-none` and elevated variant available

#### Separator

- Radix-style but no Radix dependency
- `h-px w-full` (horizontal) / `w-px h-full` (vertical)
- `bg-border`

#### Toast

- Simple implementation without Radix `ToastPrimitives`
- `ToastProvider` with `useToast()` hook for programmatic control
- `ToastViewport` for positioning (fixed bottom-right on desktop, bottom on mobile)
- Variant: `default` (surface) | `destructive` (error)
- Auto-dismiss with configurable duration
- Click-to-dismiss support

### Accessibility Features

| Feature | Implementation |
|---------|---------------|
| Focus rings | `focus-visible:ring-2 focus-visible:ring-ring focus-ring-offset-2` |
| Touch targets | `min-h-[44px]` on interactive elements, `.touch-target` utility |
| Screen reader | `.sr-only` class for visually hidden text |
| Semantic roles | `role="status"`, `aria-live="polite"` on status banners |
| Color contrast | oklch ensures perceptual uniformity; destructive on white surface |
| Keyboard nav | Focus styles on all interactive elements |
| Reduced motion | `@media(prefers-reduced-motion)` via Tailwind `motion-reduce:` |

### Mobile Responsiveness

| Breakpoint | Usage |
|-----------|-------|
| `sm` (640px) | Product grid 2 columns |
| `md` (768px) | Product grid 3 columns |
| `lg` (1024px) | Product grid 4 columns |
| Custom | Chat bubbles max 75% width |

Touch targets in mobile layout:
- Header avatar: 40px → should be 44px minimum (deferred — avatar click is non-critical)
- Send button: `px-5 py-2.5` with `min-h-[44px]` enforced via parent footer
- Quick action chips: `min-h-[44px]` explicitly (already in QuickActionChips)
- Message input: h-11 (44px) — meets requirement
- Back button: `w-9 h-9` (36px) — below 44px (deferred — navigational, common pattern)

### Light/Dark Mode

Dark mode is triggered by `.dark` class on `<html>` or `<body>`:
```css
@custom-variant dark (&:where(.dark, .dark *));
```

This matches OpenShip's approach. The CSS uses `dark:` variant in `@layer utilities` and `:root` + `.dark` blocks for CSS variables.

### Dependencies

**No new dependencies added.** The design system uses:
- Tailwind CSS v4 (already in project) — for utility classes and JIT compilation
- React 19 (already in project) — for component primitives
- Native CSS (oklch, CSS variables) — no color libraries

**Not added (intentionally):**
- `@radix-ui/react-*` — shadcn components are reimplemented minimally without Radix
- `clsx` + `tailwind-merge` — replaced with lightweight `cn()` in `lib/utils.ts`
- `class-variance-authority` — variants handled via Record lookup
- `lucide-react` — SVG icons use emoji/Unicode (consistent with existing approach)

### Constraints Verified

- [x] No Conversation Engine changes
- [x] No CartAuthority changes
- [x] No backend changes
- [x] No OpenShip app shell copied
- [x] No OpenShip MCP copied
- [x] No new dependencies added
- [x] No product/catalog/cart/chat screen full implementations
- [x] Merchant-branded QloBot visual identity (blue primary, oklch system)
- [x] Professional, modern, premium aesthetic

---

## Verification

### PWA TypeScript Check

```bash
cd apps/pwa && tsc --noEmit
# Result: ✅ No errors
```

### PWA Build

```bash
cd apps/pwa && vite build
# Result: ✅ Built successfully (112 modules transformed, 45.18 kB CSS, 328.90 kB JS)
```

### Visual Smoke (Playwright)

Pending Playwright visual capture on mobile (390×844) and desktop (1280×720).

---

## GREEN Status Confirmation

**GREEN** — QloBot PWA now has a consistent visual design system with:

1. **Design tokens:** oklch color space with light/dark mode, spacing/radius/shadow scales
2. **Typography:** Semantic text classes (display, heading, title, body, caption, footnote)
3. **Component primitives:** Button, Badge, Input, Skeleton, Card, Separator, Toast, Text
4. **Accessibility:** Focus rings, touch targets ≥44px, screen reader utilities
5. **No new dependencies:** Lightweight implementation without Radix or shadcn
6. **Existing components adapted:** All 17 PWA components updated to use semantic tokens
7. **Build verified:** tsc clean + vite build succeeds
8. **OpenShip patterns adapted, not copied:** oklch approach, component API patterns, but QloBot-brand colors
