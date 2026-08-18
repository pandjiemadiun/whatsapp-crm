# G2-C CartAuthority Architecture Review

## 1. Executive Summary

**Current state:** Cart state is stored in two independent, unsynchronized locations:
`confirmedItems` (JSON in `conversation_context.extractedEntities`) and `Order.items`
(JSON in `orders` table). Product identity uses fuzzy string matching on product names.
Price is accepted as an LLM hint. No single authority owns cart state.

**Problem:** Dual authority, fuzzy identity, non-authoritative price, and a data integrity
bug where PWA cart display shows empty for draft orders (OrderItem relation rows are
not created by the sync path).

**Solution:** Create `CartAuthority` as the single authority. Cart state lives in a
draft `Order` (status=`draft`) with proper `OrderItem` relation rows (productId FK).
All reads and writes go through `CartAuthority`. Legacy `confirmedItems` is migrated
once (backward-compatible read), then becomes read-only compatibility.

**Risk level:** GREEN — changes are backward-compatible wrappers. No conversation engine
rewrite. No schema migration required (OrderItem table already exists). No destructive
migration.

## 2. Current Cart Architecture

### Storage Locations

| Location | Column/Table | Type | Readers | Writers |
|----------|-------------|------|---------|---------|
| Conversation context | `conversation_context.extractedEntities` → `confirmedItems` | JSON | `getCartFromDb`, `buildPipelineContext`, `fallback.service` | `modifyCart`, `restoreCart` |
| Draft order (JSON) | `orders.items` | JSON | `fetchCart` (via `getOrdersByConversation` → `mapOrderWithItems`) — **BUG: reads orderItems not items** | `syncCartStateToDraftOrder`, `addConfirmedItemToOrder` (dead) |
| Draft order (relation) | `orders.orderItems` | Relation | `mapOrderWithItems` (maps orderItems→items) | `createOrder` (only) |
| v2 workspace | `conversation_context.workspace_v2` → `draft_cart` | JSON | `buildMinimalContext` (fast-path), v2 engine | `addToDraft`, `confirmDraftItem` |

### Critical Gap
`syncCartStateToDraftOrder` writes to `orders.items` JSON field but does NOT create
`OrderItem` relation rows. `mapOrderWithItems` maps `raw.orderItems` → `items`, not
`raw.items` (JSON). So `fetchCart` returns empty items for draft orders.
**This is the P0 data integrity bug (G2-C-L-002).**

## 3. Current Authority Map

| Operation | Writer | Reader | Authority |
|-----------|--------|--------|-----------|
| Add to cart | `conversationContextService.modifyCart` | `getCartFromDb` | `confirmedItems` JSON (ConversationContext) |
| Sync to Order | `orderService.syncCartStateToDraftOrder` | `fetchCart` | `Order.items` JSON (Orders) |
| Remove from cart | `conversationContextService.modifyCart` | `getCartFromDb` | `confirmedItems` JSON |
| Rollback cart | `conversationContextService.restoreCart` | — | `confirmedItems` JSON |
| Add confirmed item | `orderService.addConfirmedItemToOrder` | DEAD CODE | `Order.items` JSON (never called) |
| Finalize → checkout | `orderService.finalizeDraftOrder` | — | `Order.orderStatus` (via updateMany, bypasses state machine) |

**Finding: Two authorities with no single owner (G2-C-L-001).**

## 4. Cart Dependency Graph

```
Conversation Engine (processCustomerMessage)
├── v2 path (engine-branch-v2)
│   ├── buildPipelineContext → getCartFromDb → confirmedItems
│   ├── executeCartOps
│   │   ├── modifyCart → confirmedItems (atomicCas)
│   │   └── syncCartStateToDraftOrder → Order.items JSON
│   └── getCartFromDb → confirmedItems (for reply rendering)
├── v1 path (fallback)
│   ├── getCartFromDb → confirmedItems (buildPipelineContext)
│   ├── executeCartOps → (same as above)
│   ├── [BUG] EXECUTE pending → modifyCart directly (NO syncCartStateToDraftOrder)
│   └── getCartFromDb → confirmedItems
└── Structured Message Delivery (conversation-delivery.service)
    └── mapStructured → fetchCart → getOrdersByConversation → Order.orderItems
        [BUG: returns empty for drafts because syncCartStateToDraftOrder
         writes Order.items JSON, not orderItems relation]

Structured Message Enrichment:
    fetchCart → orderService.getOrdersByConversation → Order.orderItems
    → mapOrderWithItems → OrderWithItems.items
    [BUG: draft orders have no orderItems rows]
```

## 5. OpenShip Comparison

| Pattern | QloBot Current | OpenShip Reference | Take? |
|---------|----------------|-------------------|-------|
| Cart identity | Product name (string, fuzzy match) | `variantId: string` (exact) | YES — adopt productId |
| Cart item structure | `ConfirmedItem{product, qty, price}` (JSON) | `CartLineItem{id, variantId, quantity, productTitle, price}` (typed) | YES — adopt OrderItem with productId |
| Cart total | Computed ad-hoc in syncCartStateToDraftOrder | `cart.total` (authoritative) | YES — centralize in CartAuthority |
| Checkout boundary | `finalizeDraftOrder` (updateMany, no state machine) | `completeCart` (adapter) + `validateCartForCheckout` | YES — use state machine + validate |
| Cart storage | Two places (confirmedItems + Order.items JSON) | Single Cart entity per store | YES — single CartAuthority |
| Draft vs Order | Draft order IS cart (Status='draft') | Cart ≠ Order (Cart→Order on completeCart) | PARTIAL — QloBot already uses draft Order as cart; keep this pattern |

**Why not copy wholesale:** OpenShip is a multi-store marketplace with web
customers, sessions, and Stripe/PayPal checkout. QloBot is a single-store WhatsApp
chatbot with no e-commerce checkout of its own (orders are manual). We adapt the
*pattern* (productId identity, checkout boundary, validation before action) not
the implementation.

## 6. Target CartAuthority

### Conceptual Model

```
Cart = Draft Order (status='draft', conversationId UNIQUE)
Items = OrderItem[] relation rows
  ├── productId (FK to Product, NOT NULL)
  ├── productName (snapshot string)
  ├── quantity (Int > 0)
  ├── unitPrice (Float from Product.price)
  └── subtotal (Float = unitPrice × quantity)
Subtotal/Total = computed by CartAuthority from OrderItem rows
```

### CartAuthority API

```typescript
// Domain types
interface CartLine {
  id: string;            // OrderItem.id
  productId: string;     // FK to Product
  productName: string;   // snapshot
  quantity: number;      // > 0
  unitPrice: number;     // from Product.price (authoritative)
  subtotal: number;      // unitPrice × quantity
}

interface CartSummary {
  items: CartLine[];
  total: number | null;
}

// Public API
class CartAuthority {
  // READ (no mutation)
  getCart(conversationId): Promise<CartLine[]>
  getCartSummary(conversationId): Promise<CartSummary>
  hasCart(conversationId): Promise<boolean>

  // WRITE (all atomic via $transaction)
  addLine(convId, storeId, custId, productId, qty?): Promise<CartLine[]>
  removeLine(convId, lineItemId): Promise<CartLine[]>
  updateQuantity(convId, lineItemId, qty): Promise<CartLine[]>
  clearCart(convId): Promise<void>

  // CHECKOUT (immutable boundary)
  checkout(convId, storeId): Promise<string>  // → transitionOrder to 'waiting_address'

  // MIGRATION (one-time backward compat)
  migrateFromConfirmedItems(convId, storeId, custId, confirmedItems): Promise<void>
}
```

### Flow

```
Conversation Engine
  │  produces CartOp[]: [{type:'add', product:'ayam goreng', qty:2, price:25000}]
  ↓
CartAuthority.executeOps(ops, storeId, customerId, conversationId)
  │  1. Resolve product name → productId (validateCartOpsAgainstDb extended)
  │  2. Read price from DB (authoritative, ignore op.price)
  │  3. Find-or-create draft Order for conversation
  │  4. For each op:
  │     - add → upsert OrderItem (same productId = increment qty)
  │     - remove → delete OrderItem (by productId match)
  │  5. Recompute totalPrice
  │  6. All in $transaction
  ↓
OrderItem[] (relation rows) ← SINGLE SOURCE OF TRUTH
confirmedItems ← READ-ONLY compatibility (migration only)
```

## 7. Cart Identity

| Scenario | Behavior |
|----------|----------|
| Same product add | Upsert OrderItem: `quantity += n` (productId match) |
| Same product, different "variant" | N/A (QloBot has no variants) |
| Product name fuzzy match (LLM output) | Resolve to productId via `productService.searchProducts` + exact name match in `Product.name` |
| Remove | Match by productId in OrderItem, delete row |
| Update quantity | Match by OrderItem.id, set `quantity = n` (n > 0, else remove) |
| Clear all | Delete all OrderItem rows for conversation's draft order |
| Out-of-stock | Reject add, report to engine |
| Deleted product | Reject add (product not found / deletedAt not null) |
| Inactive product | Reject add (isActive = false) |
| Price changed | Always read current `Product.price` at add time (authoritative) |

## 8. Price Authority

| Question | Answer |
|----------|--------|
| When price is read | At every `addLine` / `syncFromItems` call (NOT at storage time for existing items) |
| Source | `Product.price` from DB (via `productService.getProductById`) |
| Snapshot stored? | Yes — `OrderItem.unitPrice` is a snapshot of `Product.price` at add time |
| Price changes after add | Existing OrderItem retains snapshot price; new adds use current price |
| Checkout handles price change | `checkout` → `transitionOrder` (does not recalculate; uses existing OrderItem prices) |
| Frontend computes? | NO — frontend receives `subtotal` and `total` from backend |

## 9. Transaction Boundaries

All CartAuthority mutations run in a single `prisma.$transaction`:

```
addLine:
  1. Find draft Order by conversationId (+ storeId, status='draft') → create if not found
  2. Find existing OrderItem by productId → update quantity, OR create new OrderItem
  3. Recompute Order.totalPrice
  4. Write OrderItem + Order price atomically

removeLine:
  1. Find draft Order by conversationId
  2. Delete OrderItem by lineItemId (with conversationId ownership check)
  3. Recompute Order.totalPrice

updateQuantity:
  1. Find draft Order by conversationId
  2. Find OrderItem by lineItemId (ownership check)
  3. If qty > 0: update; if qty = 0: delete
  4. Recompute Order.totalPrice

clearCart:
  1. Find draft Order by conversationId
  2. Delete all OrderItem rows (or delete Order entirely)
  3. Reset totalPrice to 0

checkout:
  1. Find draft Order by conversationId (with storeId check)
  2. Call transitionOrder(orderId, 'waiting_address')
  3. Transition is atomic (G2-B.6 state machine)
```

## 10. Typed Commerce Actions

Current `CartOp` contract (domain/types.ts:275):
```typescript
interface CartOp {
  type: 'add' | 'remove';
  product: string;    // LLM output — product NAME, not productId
  qty?: number;
  price?: number;     // LLM hint — NOT authoritative
}
```

**G2-C enhancement** (new `CommerceAction` type, kept additive):
```typescript
type CommerceAction =
  | { type: 'cart.add'; productId: string; qty: number; }
  | { type: 'cart.remove'; productId: string; }
  | { type: 'cart.update'; productId: string; qty: number; }
  | { type: 'cart.clear'; }
  | { type: 'cart.view'; }
  | { type: 'checkout.start'; }
  | { type: 'product.search'; query: string; }
  | { type: 'product.list'; categoryId?: string; };

// Backward compat: CartOp → CommerceAction via name resolution
```

**Flow:**
```
Natural Language
  ↓
Interpreter (LLM) → CartOp[]
  ↓
validateCartOpsAgainstDb → resolves name → productId, validates
  ↓
Commerce Action (typed)
  ↓
CartAuthority.executeActions(actions[])
```

## 11. Cart → Order Boundary

| Concept | Current | Target (G2-C) |
|---------|---------|---------------|
| Cart storage | `confirmedItems` JSON + `Order.items` JSON | Draft `Order` (status='draft') + `OrderItem` relation |
| Order snapshot | `createOrder` (separate path, uses OrderItem relation) | `checkout` transitions draft → `waiting_address` (snapshot is the draft Order itself, now frozen) |
| Draft Order = Cart? | Yes (draft Order IS the cart) | Yes — cart IS the draft Order; checkout transitions it to waiting_address |
| Immutable after checkout | No (can be mutated via updateOrderStatus) | Yes — post-checkout states managed by state machine (G2-B.6) |

**Key insight:** QloBot already uses draft Order as cart. The problem is that
`syncCartStateToDraftOrder` writes to `Order.items` JSON (not `OrderItem` rows),
and `mapOrderWithItems` reads `orderItems`. The fix: write to `OrderItem` relation
rows instead of/in addition to the JSON field.

## 12. Legacy State Migration

| Legacy State | Source | Target | Phase |
|-------------|--------|--------|-------|
| `confirmedItems` (ConfirmedItem[]) | `extractedEntities.confirmedItems` JSON | `OrderItem[]` rows (productId, productName, qty, unitPrice) | Phase 1 — one-time read |
| `Order.items` JSON | `orders.items` | `OrderItem[]` relation | Phase 2 — compat read |
| `workspace_v2.draft_cart` | `workspace_v2` JSON | `OrderItem[]` rows (on commit) | Phase 2 — sync on write |
| `previousMutation.cartSnapshot` | `extractedEntities.previousMutation` | Remove (rollback via OrderItem delete) | Phase 3 — replace |

**Migration process:** When CartAuthority accesses a conversation's cart and finds
no draft Order, it checks `confirmedItems` in extractEntities. If present, it
migrates them to `OrderItem` rows (resolving product name → productId where possible,
storing null productId with productName snapshot where not). After migration, the
source of truth is `OrderItem` rows.

## 13. Schema Impact

**NO schema changes required.** The existing `Order` and `OrderItem` models are
sufficient:

```prisma
model Order {
  id         String   @id
  storeId    String
  conversationId String
  customerId String
  items      Json     // ← kept for backward compat (READ-ONLY)
  totalPrice Float?
  orderStatus String @default("draft")
  confirmedAt DateTime?
  ...
  orderItems OrderItem[]  // ← CartAuthority writes here
}

model OrderItem {
  id          String  @id
  orderId     String
  productId   String?  // ← FK to Product (used by CartAuthority)
  productName String   // snapshot
  quantity    Int
  unitPrice   Float
  subtotal    Float
  ...
}
```

**Compatibility window:** `Order.items` JSON stays for backward-compat read.
`confirmedItems` stays for one-time migration. No column drops in G2-C.

## 14. API Impact

| API | Change |
|-----|--------|
| `/api/pwa/:slug/message` | No change — ConversationService internal wiring only |
| `/api/orders` (GET) | No change — reads Orders table |
| `/api/orders/:id/status` (PUT) | No change — uses state machine |
| Structured message delivery | Cart payload shape changes: adds `productId` field |

## 15. Frontend Impact

| Component | Change |
|-----------|--------|
| `pwa/src/types/chat.ts` | Add `productId?: string` to `CartItem` |
| `pwa/src/components/CartSummary.tsx` | No change (read-only, uses productName) |
| `pwa/src/components/ChatPage.tsx` | No change (receives structured payload from backend) |

## 16. Migration Strategy (5 Phases)

1. **Phase 1 — New authority**: Create `CartAuthority` class. Deploy alongside existing code. No behavior change yet.
2. **Phase 2 — Migration read**: `getCartFromDb()` checks for draft Order; if absent, migrate from `confirmedItems`. Reads go through CartAuthority.
3. **Phase 3 — Cutover writes**: `modifyCart()` delegates to `CartAuthority.addLine/removeLine`. `syncCartStateToDraftOrder` becomes a no-op compat shim.
4. **Phase 4 — Cutover reads**: `fetchCart()` reads via `CartAuthority.getCartSummary()`. `fallback.service` reads via CartAuthority.
5. **Phase 5 — Legacy removal (G2-C+)**: Remove `confirmedItems` from ExtractedEntities. Remove `syncCartStateToDraftOrder` shim.

## 17. Risk Assessment

| Risk | Mitigation | Status |
|------|-----------|--------|
| Migration data loss | Keep `confirmedItems` read-only; migrate product name as snapshot if productId resolves fails | Acceptable |
| Transaction failure | CartAuthority catches and logs; conversation engine handles gracefully | Acceptable |
| v2 workspace_v2 staleness | CartAuthority is source of truth; workspace_v2.draft_cart is read-only view for reasoning | Acceptable |
| Performance: extra DB queries | CartAuthority batches reads; one query for draft Order + OrderItems | Acceptable |
| Breaking conversation engine | Wrapper approach: modifyCart signature unchanged; getCartFromDb returns same shape | Low |

## 18. Implementation Sequence

1. ✅ Create logic cleanup ledger
2. ✅ Create this architecture review
3. Create `src/business/cart-authority.ts` (CartAuthority class + types)
4. Create `src/tests/cart-authority.test.ts` (invariant tests)
5. Wire CartAuthority into `conversationContextService.modifyCart` (wrapper)
6. Wire CartAuthority into `conversation.service.getCartFromDb` (wrapper)
7. Wire CartAuthority into `structured-message.mapper.fetchCart` (wrapper)
8. Fix `orderService.finalizeDraftOrder` → delegate to CartAuthority.checkout → state machine
9. Fix v1 executor path → use executeCartOps (transaction wrapper)
10. Update PWA `CartItem` type (add productId)
11. Run full regression
12. Write final phase report

## 19. Owner Decisions Required

| Decision | Question |
|----------|---------|
| D7-CartAuthority | ✅ Approved (G2-B D7 was deferred to G2-C, now implemented) |
| Schema migration | No schema changes needed (OrderItem table sufficient) |
| Legacy removal timeline | Phase 5 deferred to G2-C+ (not in scope) |
| PWA cart UI | PWA is read-only cart display (no add/remove). Customer interacts via chat. |

**Verdict: GREEN** — G2-C is implementable safely with backward-compatible wrappers.
No destructive migration, no conversation engine rewrite, no schema change required.
