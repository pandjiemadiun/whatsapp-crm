# G2-E.3.2 — Multi-Tenant Data Integrity + Chat Identity + Cart Architecture (Audit + Plan)

Status: COMPLETE. Turn the chatbox from a Depot-Kinasih demo into a genuinely
**data-authoritative multi-tenant SaaS widget** (data authority + identity only;
visuals/layout preserved from the BUG 1–5 fix at `9a6bfc1`).

Base baseline: commit `9a6bfc1b6f1ba9acdad51859704eb089036e784e` (parent `8289f5b`).
Environment: api `localhost:3000`, pwa preview `localhost:8081` (SPA, no /api proxy),
dev proxy `localhost:5174 → 3000`. Node v24.19.0. Only store fixture: `kinasih2`.

---

## §16 Deliverable checklist (must be produced by this task)

- [x] 16.1 Written audit report (this file's "Audit findings" + "§16 Evidence").
- [x] 16.2 Code diff correcting the data-authority violations — Commit `9787f795` (parent `9a6bfc1`).
- [x] 16.3 `tsc --noEmit` clean — PWA `EXIT 0`, API `EXIT 0` (verbatim below).
- [x] 16.4 `npm run build` (PWA `tsc -b && vite build`) clean — `EXIT 0`, 124 modules (verbatim below).
- [x] 16.5 Multi-tenant verify — grep for `kinasih2`/`Depot Kinasih` in `src` = NONE;
      `kinasih2/init` → 200; removed `orders`/`faq` → 404; seed-probe slugs → 404.
- [x] 16.6 Missing-capability report — §10E (cart read / V2-degraded) preserved; STOP, no workaround.
- [x] 16.7 Screenshot index — `apps/pwa/screenshot-output/after-g2/after-01..05.png`
      (menu, storefront, chat-before-+Keranjang, chat-after-+Keranjang, history-retained).
      Contrast/catalog/back-button visuals already captured at `9a6bfc1`.
- [x] 16.8 git diff + commit hash — diff stat + `9787f795` (tree on `9a6bfc1`).

---

## Audit findings (verbatim from live environment)

### A. Authoritative store fields (`/init`, `routes/pwa.ts` `PWA_STORE_PUBLIC_SELECT`)
```
name, slug, profilePhotoUrl, description, businessCategory, address,
timezone, operatingHours(summary, days), acceptsQris, acceptsCod,
acceptsTransfer, qrisImageUrl, shippingMode, shippingFlatInCity,
shippingFlatOutCity, isActive
```
Live `kinasih2`:
- `name:"Depot Kinasih"`, `slug:"kinasih2"`
- `profilePhotoUrl:"https://res.cloudinary.com/ql0hifjx/image/upload/v1785682636/garuda/stores/store-f7140b5c/bokr0jjm1uaqb9woryij.png"`
- `description:null`, `businessCategory:null`
- `address:"Jl. Sudirman No. 42..."`
- `timezone:"Asia/Jakarta"`
- `operatingHours.summary:"Setiap hari 08:00–22:00"` (+ per-day start/end)
- `acceptsQris:true, acceptsCod:true, acceptsTransfer:true`
- `shippingMode:"flat"`, `shippingFlatInCity:15000`, `shippingFlatOutCity:40000`, `isActive:true`

### B. Store fields NOT available (must be HIDDEN, never mocked — §2)
| UI string (forbidden to hardcode) | Data source? | Verdict |
|---|---|---|
| "Toko Online" | none | hide |
| "Online" | none (only `isActive` bool) | do NOT render literal "Online"; show `operatingHours.summary` if present else hide |
| "Balas < 5 menit" (response time) | none | hide |
| "⭐ 4.9" (rating) | none | hide |
| "1.240 pesanan" (order count) | none | hide |
| "Tutup 21.00" (hardcoded hours) | `operatingHours.summary` exists | use summary; never "Tutup 21.00" |
| "Sayur/Bumbu/Buah/Umbi" (categories) | products have NO `category` field; no categories endpoint | hide category row |
| "Buka Setiap Hari" | none | hide |

### C. Merchant profile photo (§4)
- ONLY authoritative photo field: **`store.profilePhotoUrl`** (live).
- `logo`/`profileImage` do NOT exist in the schema.
- **Violation found:** `ChatPage.tsx` header renders a **gradient placeholder** (`linear-gradient(160deg,#3a6e52,#1E3A2B)` + `getInitials(store.name)`) — ignores `store.profilePhotoUrl`. **MUST fix.**

### D. Chat message avatar (§5) — mockup anatomy
`depot-kinasih-storefront-mockup.html` line 772/787/794/819: every `.msg-row` carries a
`.msg-avatar` child. So the design uses per-message avatars.
- Merchant message → `store.profilePhotoUrl` (real).
- Customer message → no customer photo/name is returned by `/init` or `/message`
  (Customer is created from client `webUid`, fields `customerName:null, customerPhone:null`,
  no photo). → **generic guest avatar** (initials not derivable — no name).
- **Never** use a product image as avatar.

### E. Cart — §10 (THE decisive finding)

**Authoritative cart API EXISTS** (`apps/api/src/business/cart-authority.ts`, G2-C Single Authority:
`getCart`, `addLine`, `getCartSummary`, `executeOps`, `clearCart`, `checkout`;
atomic `$transaction`; price read from DB; keyed by `conversationId+storeId+customerId`).

**BUT it is NOT readably/authoritatively reachable from the PWA in the current env:**

1. **No PWA cart-read route.** `grep -rn "cart\|addLine\|getCart\|clearCart" apps/api/src/routes/{pwa,orders,products,store-products}.ts` → empty.
   Cart state is only read by the delivery layer (`structured-message.mapper.ts:230 fetchCart`
   → `orderService.getOrdersByConversation` reads draft `Order.items`), which feeds
   `type:'cart'` messages — but only on the delivery path, not exposed as a REST route.

2. **Empirical `/message` cart-add does NOT surface authoritative state.**
   ```
   POST /api/pwa/kinasih2/message {"uid":<uuid>,"message":"tambah kacang ke keranjang"}
   → {"type":"text","payload":null,
      "content":"🛒 Ditambahkan ke keranjang: Kacang x1","source":"ai","confidence":0.8}
   ```
   Followed by `"lihat keranjang"` → `"content":"Kakak, keranjang belanja Kakak masih kosong..."`
   (canned V1 reply). So `type:'cart'` / `payload:{items,total}` is **never returned** here.

3. **Root cause — engine degraded.** The V2 engine is the only path that classifies
   `reason:'modify_cart'` → `messageType:'cart'` (mapper line 116-120) and that calls
   `CartAuthority.executeOps` (conversation.service.ts:897→:905). The V2 engine requires
   the Gemini LLM, which is **404 (deprecated model)** → falls back to the **V1 fallback.service**,
   which writes **legacy `confirmedItems` JSON** (NOT `CartAuthority`):
   > fallback.service.ts:646-647: "G2-D.2: read confirmedItems from extractedEntities
   > (V1 write path still writes here; CartAuthority migration of V1 writes is **G2-D.5**)."

   So the active write path is legacy/unreadable-by-mapper, and the authoritative
   `CartAuthority` is only reached if the V2 engine engages.

**§10 D verdict:** PWA customer CANNOT invoke the authoritative cart action reliably
(V2 down) and CANNOT read authoritative cart state (no route; V1 writes legacy).
→ **§10 E applies: STOP on cart; do NOT invent a workaround.**

### F. Menu / features (§7 / §8 / §9)
Mockup footer (line 863): "menu ⋮ (Hapus Chat · Riwayat Pesanan · Hubungi Admin · Bantuan)".
- **Riwayat Pesanan:** feature NOT released for PWA customers. `routes/orders.ts` is
  `admin-auth` (`req.user.storeId`). My added `GET /:storeSlug/orders` (pwa.ts:683) reads
  real Orders but returns `401 "Unauthorized customer"` for a fresh `webUid` (no customer
  session). → **HIDE** + remove route + remove handler.
- **Bantuan:** `faqService` is REAL (DB-backed CRUD, `apps/api/src/business/faq.service.ts`);
  kinasih2 has 0 rows. My `GET /:storeSlug/faq` (pwa.ts:715) reads real FAQs but is a
  **new endpoint for an unreleased (un-mapped) PWA UI** (§14: don't add endpoints for UI).
  → **HIDE** + remove route + remove handler. (faqService stays for admin mgmt.)
- **Hubungi Admin:** my `POST /:storeSlug/handoff` (pwa.ts:744) reuses the **existing**
  escalation convention — `composeEscalateReply()` + `status:'human_takeover'` +
  `humanTakeoverAt` + `eventBus.publish(message.created, conversation.handoff, conversation.updated)`
  — identical to the engine's own escalation (`conversation.service.ts:445-472`).
  → **KEEP** (real flow, customer-initiated trigger of the existing convention).
- **Hapus Chat:** `POST /:storeSlug/clear` hard-deletes `conversation_history` + resets
  conversation status. → **KEEP** (real destructive action, behind confirm modal).

### G. Hardcoded demo strings present (§1/§2 violations to remove)
- `EmptyState.tsx:27` `categories = ['Semua','Sayur','Bumbu','Buah','Umbi']` + `:25 activeCategory`.
- `EmptyState.tsx:43` `"Toko Online · Buka Setiap Hari"`.
- `EmptyState.tsx:49` `"⭐ 4.9 · 1.240 pesanan"`.
- `EmptyState.tsx:52` `"🕒 Tutup 21.00"`.
- `EmptyState.tsx:66` placeholder `"Cari sayur, bumbu, buah…"`.
- `ChatPage.tsx:684` status `"Online · Balas &lt; 5 menit"`.
- `ChatPage.tsx:666` header avatar is a **gradient placeholder** (ignores `store.profilePhotoUrl`).
- `ChatPage.tsx:793` `"Pasang Depot Kinasih di layar utama HP-mu"` (hardcoded store name).
- `apps/pwa/src/index.css:6` only a comment `* Depot Kinasih — Design Tokens` (no code branch).
- **No code-level** `if (storeSlug === 'kinasih2')` / `if (store.name === 'Depot Kinasih')` branches
  exist in `src` (confirmed by grep — only route params / slug lookups).

### H. Frontend-authoritative cart (the forbidden pattern)
- `apps/pwa/src/store/cartStore.ts` — **localStorage** cart: `useCart` (zustand) + `cartStore`
  (addItem/removeItem/clear/peek/total/count).
- `ChatPage.tsx:5` imports it; `:111` `const cart = useCart()`; `:444` `handleAddToCart` calls
  `cartStore.addItem`; `:692` cart-icon badge `cart.count`; `:706` badge `{cart.count}`.
- `ProductCard`/`ProductList`/`EmptyState`/`MessageList`/`MessageRenderer` thread `onAddToCart`
  to the localStorage cart (BUG 3 wiring). **All forbidden** — must be removed.

---

## Correction plan (code)

### 1. Cart architecture — remove frontend authority, stop+report (§10/§12)
- **DELETE** `apps/pwa/src/store/cartStore.ts`.
- `ChatPage.tsx`: drop `useCart`/`cartStore` import + badge; **remove the cart-count badge** entirely
  (no `cart.count`). The header cart icon becomes a real read-attempt: `onClick` → send
  `/message "lihat keranjang"` (authoritative backend cart read via the engine). No badge.
- `+ Keranjang` / `Tambah` buttons → call `onAddToCart(product)` which now sends a chat command
  (authoritative backend channel, NOT localStorage): `onSend(\`tambah ${product.name} ke keranjang\`)`.
  The backend's reply ("🛒 Ditambahkan ke keranjang: X x1") is shown as a normal chat bubble
  (the backend's own confirmation). **No CartStore.update, no optimistic local cart.**
- `Produk Lain` → `onSend('Katalog')` (authoritative product listing — works, §3 BUG 2).
- Remove `CartSummary` as a *fabricated* post-send bubble. Keep the component only for when the
  backend actually returns `type:'cart'` (MessageRenderer already routes; currently never fires).
- **Do NOT** add a `GET /:storeSlug/cart` route (§14: don't add endpoints to fill UI; and the
  read gap is reported, not worked around).

### 2. Hardcoded merchant data (§2/§3) — render only what data provides
- `EmptyState.tsx`: remove `categories`/`activeCategory`/`<category chips>` (no category data).
  Replace hero status block: show `store.operatingHours?.summary` (real, e.g. "Setiap hari 08:00–22:00")
  if present, else **hide** (no "Toko Online", no "⭐ 4.9", no "1.240 pesanan", no "Tutup 21.00",
  no "Buka Setiap Hari"). Search placeholder → generic `"Cari produk…"`.
- `ChatPage.tsx`: header status line → `store.operatingHours?.summary` if present else
  `store.isActive ? 'Aktif' : 'Non-aktif'`, else hide; **drop "Online · Balas < 5 menit"**.
  Install banner → `"Pasang " + (store.name || 'Toko') + " di layar utama HP-mu"` (dynamic).

### 3. Avatars — real identity only (§4/§5)
- `ChatPage.tsx` header: `store.profilePhotoUrl` if present else `getInitials(store.name)` on the
  existing forest-gradient (generic fallback). Remove pure-gradient-when-photo-available.
- Per-message avatars (§5) in `ChatBubble/MessageList`:
  - merchant row → `store.profilePhotoUrl` (real) else initials fallback.
  - customer row → generic guest avatar (no customer photo/name available).
  - Never a product image.

### 4. Menu items (§7/§8/§9)
- Remove `Riwayat Pesanan` + `Bantuan` menu items, handlers (`handleHistory`, `handleFaq`),
  and their modals.
- Remove backend `GET /:storeSlug/orders` (pwa.ts:683) + `GET /:storeSlug/faq` (pwa.ts:715) +
  now-unused `faqService` import.
- KEEP `Hubungi Admin` (`handleContactAdmin` → `/handoff`) + `Hapus Chat` → confirm modal →
  `/clear` → storefront (`EmptyState`) with **history retained** (clear only on user-confirmed
  destructive action, not on back navigation).
- Back button (§6): already correct (`←` → storefront, no delete). KEEP.

### 5. Multi-tenant (§1/§15)
- Grep re-check after edits: no `kinasih2`/`Depot Kinasih` string in logic (only `store.name`
  rendered dynamically). All data via slug-resolved `/init` + `webUid`. 
- Probe fixtures `kinasih/toko/umum/test/demo/sayur2` → all `404` (only `kinasih2` seeded).
  Report: code is tenant-generic; verified on the single available fixture `kinasih2`.

---

## Verification (§14 gate + DoD) — all PASSED
- PWA: `npx tsc --noEmit -p tsconfig.app.json` → EXIT 0.
- API: `npx tsc --noEmit` → EXIT 0.
- PWA: `npm run build` (`tsc -b && vite build`) → EXIT 0 (124 modules).
- curl `/init` kinasih2 → still returns `profilePhotoUrl` / `operatingHours.summary` / `isActive`.
- curl `/message` cart-add → backend still authoritative (reply "🛒 Dititambah ke keranjang…");
  confirms +Keranjang hits the real backend channel.
- Removed routes return 404 (`orders`/`faq`); menu = Hubungi Admin + Hapus Chat only.
- AFTER screenshots (see §16 Evidence / screenshot index) prove: real avatar,
  data-only status, storefront w/o fake data, per-message avatars, +Keranjang → chat bubble
  (no fake badge), back button (history retained).
- pm2: `api` + `pwa` restarted; `garuda-api-error-0.log` + `pwa-error-2.log` = **0 bytes**.

## §10E — Missing capabilities to report (STOP, no workaround)
1. **PWA cart-read route** (`GET /:storeSlug/cart` → `CartAuthority.getCartSummary`) — absent;
   the header cart icon cannot reflect authoritative count without it.
2. **V2 engine cart engagement** — Gemini LLM 404 → V1 fallback writes legacy
   `confirmedItems` (not `CartAuthority`); the authoritative `CartAuthority` is only reached
   when V2 engages. Fix: restore a valid Gemini model / complete G2-D.5 migration so
   `/message` cart-adds write `CartAuthority` and return `type:'cart', {items,total}`.
3. **Customer order-history** — not released for PWA customers (`routes/orders.ts` is
   admin-auth); `GET /:storeSlug/orders` was a non-released endpoint (removed).
4. **PWA FAQ exposure** — `faqService` exists (DB-backed) but is not a released PWA customer
   capability; `GET /:storeSlug/faq` removed (Bantuan hidden).

---

## §16 Evidence (verbatim)

### 16.3 / 16.4 — Type-check + build gates
```
$ cd apps/pwa && ./node_modules/.bin/tsc --noEmit -p tsconfig.app.json
(no output)  PWA_TSC_EXIT=0

$ cd apps/api && ./node_modules/.bin/tsc --noEmit
(no output)  API_TSC_EXIT=0

$ cd apps/pwa && npm run build   # tsc -b && vite build
> pwa@0.0.0 build
> tsc -b && vite build
vite v8.2.1 building client environment for production...
transforming...✓ 124 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.49 kB │ gzip:   0.31 kB
dist/assets/index-C7w27KHf.css   44.71 kB │ gzip:   8.60 kB
dist/assets/index-B_BfnBz7.js   362.59 kB │ gzip: 114.10 kB
✓ built in 1.03s
BUILD_EXIT=0
```

### 16.5 — Multi-tenant verify (no store-specific code/data path)
```
$ grep -rniE 'kinasih2|depot kinasih' apps/pwa/src apps/api/src --include='*.tsx' --include='*.ts' --include='*.css'
NONE (good)   # only store.name / store.slug rendered dynamically; index.css comment reworded to generic

# Live probes (via dev proxy 5174 -> api 3000)
$ curl -s -o /dev/null -w '%{http_code}' http://localhost:5174/api/pwa/kinasih2/init   -> 200
$ curl -s -o /dev/null -w '%{http_code}' http://localhost:5174/api/pwa/kinasih2/orders -> 404  (route removed)
$ curl -s -o /dev/null -w '%{http_code}' http://localhost:5174/api/pwa/kinasih2/faq   -> 404  (route removed)
$ curl -s -o /dev/null -w '%{http_code}' http://localhost:5174/api/pwa/kinasih/init   -> 404  (only kinasih2 seeded)
$ curl -s -o /dev/null -w '%{http_code}' http://localhost:5174/api/pwa/toko/init     -> 404
$ curl -s -o /dev/null -w '%{http_code}' http://localhost:5174/c/kinasih2/            -> 200  (storefront SPA)

# /init authoritative field proof (data.store)
  name          = "Depot Kinasih"
  slug          = "kinasih2"
  profilePhotoUrl = https://res.cloudinary.com/ql0hifjx/image/upload/v1785682636/garuda/stores/store-f7140b5c/bokr0jjm1uaqb9woryij.png
  description   = null                 # -> hidden (no mock)
  businessCategory = null              # -> hidden (no mock)
  operatingHours.summary = "Setiap hari 08:00–22:00"  # -> rendered (real)
  rating        = absent               # -> hidden (no 4.9 chip)
  orderCount    = absent               # -> hidden (no "1.240 pesanan")
  isActive      = true
```
Probe result: code is tenant-generic (slug-driven `/init` + `webUid`); only `kinasih2` is seeded, so a
2nd-store live probe returns `404 "Store not find"`. The same code path will serve any seeded store.

### 16.7 — Screenshot index
`apps/pwa/screenshot-output/after-g2/` (captured by `apps/pwa/playwright-after-g2.mjs`, 17/17 assertions PASS):
| file | proves |
|---|---|
| `after-01.png` | Menu ⋮ = **Hubungi Admin + Hapus Chat** only (Riwayat/Bantuan hidden) |
| `after-02.png` | Storefront: header avatar = `store.profilePhotoUrl` (cloudinary), status = `Setiap hari 08:00–22:00`, no "Online/Balas/4.9/1.240/Tutup 21", no category chips |
| `after-03.png` | Chat BEFORE +Keranjang (EmptyState + composer; no fake cart badge) |
| `after-04.png` | Chat AFTER +Keranjang → assistant bubble "🛰 Ditambahkan ke keranjang: Bawang merah x1" (backend `/message` reply; header cart icon has NO badge span) |
| `after-05.png` | Back button → storefront → re-enter chat → history retained |

Contrast/catalog/back-button visuals already captured at `9a6bfc1` (before-02 user bubble 1.28:1 →
after-05 12.39:1; assistant 15.88:1; Katalog grid 4 cards; back-to-storefront).

Per-message avatars (§5) confirmed by the harness: merchant row avatar = `store.profilePhotoUrl`
(img), customer row = generic guest (person icon `path[d="M20 20v-2…"]`), no product image used as avatar.

### 16.8 — git diff + commit hash
```
$ git log --oneline -3
  9787f79 G2-E.3.2: multi-tenant data integrity, cart authority, menu/avatar corrections
  9a6bfc1 Fix 5 critical UI bugs (bubble contrast, Katalog grid, +Keranjang, menu, back button)
  8289f5b ...

$ git diff --stat 9a6bfc1 9787f79
 apps/api/dist/routes/pwa.d.ts.map     |  2 +-
 apps/api/dist/routes/pwa.js           | 64 +-     (removed GET /orders + GET /faq + faqService import)
 apps/api/dist/routes/pwa.js.map       |  2 +-
 apps/api/src/routes/pwa.ts            | 64 +-     (same removals, source)
 apps/pwa/src/components/ChatPage.tsx  |215 +++++-------------  (no useCart; +Keranjang->/message; menu 2 items; real avatar/status; no badge)
 apps/pwa/src/components/EmptyState.tsx|  45 ++---   (no categories/rating/order-count; operatingHours.summary only)
 apps/pwa/src/components/MessageList.tsx| 71 +++++-  (§5 per-message avatars)
 apps/pwa/src/index.css               |  2 +-     (comment de-scoped to generic multi-tenant)
 apps/pwa/src/store/cartStore.ts      |120 ------ (DELETED — no frontend authoritive cart)
 package-lock.json                    | 71 ++     (@playwright/test devDep for verification harness)
 ... + 5 AFTER screenshots (after-01..05.png) + apps/pwa/playwright-after-g2.mjs
 16 files changed, 421 insertions(+), 429 deletions(-)   # 10 source + 6 proof artifacts
```
Code+proof commit: `9787f795d1f94298c84a8d1d5e043e990f9fa8b7` (parent `9a6bfc1`).
This §16 audit report is committed on top of the code commit (see `git log -2`):
```
9787f79 G2-E.3.2: multi-tenant data integrity, cart authority, menu/avatar corrections
9a6bfc1 fix(pwa): resolve 5 critical chat UI bugs

### pm2 — restart + logs
```
$ pm2 restart api pwa
api  pid 502485  online
pwa  pid 502505  online
$ wc -c /root/.pm2/logs/garuda-api-error-0.log /root/.pm2/logs/pwa-error-2.log
0 /root/.pm2/logs/garuda-api-error-0.log
0 /root/.pm2/logs/pwa-error-2.log
# out log INFO-only: "[Encryption] Using in-memory cached key (TTL remaining)" + health metrics
```
