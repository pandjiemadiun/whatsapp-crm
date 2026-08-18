# G2-E.1 — ORDER / CHECKOUT BOUNDARY FORENSIC AUDIT

**Audit Scope:** CartAuthority → draft Order → checkout → Order State Machine → address → payment → fulfillment/status → confirmed Order

**Priority Axis:** cart integrity > price/total integrity > order status integrity > checkout correctness > tenant isolation > concurrent mutation > PWA/customer experience

**Method:** Code review of source files, Prisma schema, existing audit ledger (G2-C/L), test files, and route handlers. No code changes performed.

---
## ARCHITECTURE MAP

```mermaid
flowchart TD
    subgraph CartAuthority
        CA[CartAuthority class]
        CA.addLine[addLine / executeOps]
        CA.removeLine[removeLine]
        CA.updateQuantity[updateQuantity]
        CA.clearCart[clearCart]
        CA.checkout[checkout]
        CA.migrate[migrateFromConfirmedItems]
    end

    subgraph Draft Order
        DB[Prisma Order / OrderItem]
        Order[Order row: storeId, conversationId, customerId, items(JSON), totalPrice, orderStatus, confirmedAt]
        Items[OrderItem rows: productId, productName, quantity, unitPrice, subtotal]
    end

    subgraph Checkout / State Machine
        SM[transitionOrder (order-transition.ts)]
        ALLOWED[ALLOWED_TRANSITIONS matrix]
        confirmedAt[confirmedAt setter]
    end

    subgraph API Routes
        RO[routes/orders.ts]
        PUTStatus[PUT /:id/status - raw prisma.order.update]
        GETOrder[GET /:id - fetch order]
    end

    subgraph Order Service
        OS[order.service.ts]
        addConfItem[addConfirmedItemToOrder]
        syncCart[syncCartStateToDraftOrder]
        updateStatus[updateOrderStatus]
    end

    subgraph Payment / Fulfillment
        PWA[PWA cart read]
        API[API order reads]
    end

    CartAuthority -->|writes| OrderItem
    CartAuthority -->|writes| Order.items(JSON)
    CartAuthority -->|writes| confirmedItems(JSON) via ctx
    OrderItem -->|reads| fetchCart / PWA
    Order.items -->|reads| fallback readers
    transitionOrder -->|validates| ALLOWED
    transitionOrder -->|sets| confirmedAt
    RO PUTStatus -->|raw DB write| Order
    OS addConfItem -->| writes| Order.items(JSON), totalPrice
    OS syncCart -->| writes| Order.items(JSON), totalPrice
    OS updateStatus -->| writes| orderStatus
    PWA -->|reads| OrderItem, confirmedItems
    API -->|reads| Order, Order.items, OrderItem
```

---
## FINDINGS TABLE

| ID | Classification | Finding | Severity | File + Line | Current Behavior | Risk | Recommended Authority | Target Phase |
|----|---------------|---------|----------|-----------|------------------|------|----------------------|-------------|
| G2-E1-A01 | A | **CartAuthority.attackLine** — single canonical writer for cart state: adds/removes/updates OrderItem rows, Order.items JSON, and confirmedItems JSON atomically within `$transaction`. All reads (getCart, getCartSummary) derive from OrderItem relation rows. | CANONICAL | cart-authority.ts:103-386 | CartAuthority is the single source of truth; writes are atomic via prisma.$transaction | None | CartAuthority (already implemented) | — |
| G2-E1-A02 | A | **CartAuthority.checkout** — transitions draft → waiting_address via `transitionOrder` state machine. Validates ALL line items' quantity against current DB stock before state transition. Clears confirmedItems JSON after commit. | CANONICAL | cart-authority.ts:433-477 | Stock invariant enforced at cart→order boundary; idempotent transition via `transitionOrder` | None | CartAuthority → transitionOrder | — |
| G2-E1-A03 | A | **transitionOrder** — authoritative state machine (ALLOWED_TRANSITIONS). Validates from→to status transition. Sets confirmedAt for confirmed/paid. Idempotent same-status no-op. | CANONICAL | order-transition.ts:34-169 | Strict transition enforcement; prevents invalid status jumps | None | Single source of truth | — |
| G2-E1-A04 | A | **OrderService.updateOrderStatus** — delegates to `transitionOrder`. No raw prisma.order.update for status outside this method. | CANONICAL | order.service.ts:296-312 | Status updates go through state machine validation | None | transitionOrder | — |
| G2-E1-B01 | B | **migrateFromConfirmedItems** — one-time migration from legacy confirmedItems (extractedEntities JSON) to OrderItem rows. Called on first cart access if no draft Order exists. After migration, confirmedItems is read-only compatibility. | LEGACY COMPAT | cart-authority.ts:649-701 | Migrates legacy data into canonical OrderItem rows; backward compat only | Migration needed for existing data | CartAuthority (one-time) | G2-E |
| G2-E1-B02 | B | **modifyCart wrapper** — backward-compatible modifyCart that delegates to `executeOps`. Kept so `conversationContextService.modifyCart` callers don't break. Returns ConfirmedItem[] for backward compat. | LEGACY COMPAT | cart-authority.ts:712-755 | Delegates to executeOps; maintains compat with V1 write path | Needed until all callers migrate | CartAuthority | G2-E |
| G2-E1-B03 | B | **OrderService.syncCartStateToDraftOrder** — writes confirmedItems array to Order.items JSON field. Creates draft order from confirmedItems if none exists. Used by conversation service executeCartOps. | LEGACY COMPAT | order.service.ts:111-159 | Writes to Order.items JSON (legacy field); draft orders created from confirmedItems | Still used by V1 conversation path | order.service (deprecated but kept) | G2-E |
| G2-E1-C01 | C | **finalizeDraftOrder bypass** — `order.service.ts:165` uses `prisma.order.updateMany` directly (no `transitionOrder` call). Bypasses ALLOWED_TRANSITIONS validation and confirmedAt invariant. Transitions draft → waiting_address without state machine guard. | BYPASS | order.service.ts:165-174 | `updateMany({ where: { conversationId, orderStatus: 'draft' } })` → sets orderStatus = waiting_address | Bypasses state machine invariants; no confirmedAt set; concurrent calls can race | Delegate to `cartAuthority.checkout()` → `transitionOrder()` | G2-E |
| G2-E1-C02 | C | **routes/orders.ts:74 PUT /:id/status** — raw `prisma.order.update({ where: { id }, data: { orderStatus } })` without transitionOrder validation. No ALLOWED_TRANSITIONS check. Allows any status value from validated list but bypasses state machine invariants (confirmedAt, idempotency). | BYPASS | routes/orders.ts:94-99 | Direct DB write sets orderStatus to whatever client sends | Bypasses state machine; client can set invalid from→to transitions; no confirmedAt management | Route should delegate to `transitionOrder` | G2-E |
| G2-E1-C03 | C | **conversation.service.ts:776** — `orderService.finalizeDraftOrder(conversationId)` called without storeId filter. Uses conversationId namespace isolation only. | BYPASS | conversation.service.ts:776 | `orderService.finalizeDraftOrder` → `updateMany` without storeId | Cross-tenant leakage risk: user could potentially affect orders in other tenants if conversationId collision | Add storeId filter; delegate to cartAuthority.checkout | G2-E |
| G2-E1-C04 | C | **executeCartOps → modifyCart path** — `conversation.service.ts:909-913` calls `conversationContextService.modifyCart()` (backward compat wrapper) then `orderService.syncCartStateToDraftOrder()`. The modifyCart writes to confirmedItems (extractedEntities), syncCartStateToDraftOrder writes to Order.items JSON. Two separate writers, potential divergence. | BYPASS | conversation.service.ts:887-925 | Two independent writes: modifyCart → extractedEntities.confirmedItems; syncCartStateToDraftOrder → Order.items JSON | Data divergence between confirmedItems and Order.items; PWA cart may show stale state | Unify via CartAuthority.executeOps | G2-E |
| G2-E1-D01 | D | **Duplicate authority: Order.items JSON vs OrderItem rows** — Order model has both `items: Json` field and `orderItems: OrderItem[]` relation. `createOrder` writes BOTH. `syncCartStateToDraftOrder` writes ONLY Order.items JSON. `CartAuthority` writes BOTH OrderItem rows AND Order.items JSON. Readers inconsistent: `mapOrderWithItems` maps from `raw.orderItems`; `fetchCart` maps from `orderItems` relation but draft orders from `syncCartStateToDraftOrder` have no orderItems rows. | DUPLICATE AUTHORITY | order.service.ts:138, 256-271; schema.prisma:214; cart-authority.ts:272-285 | Schema has dual representations; usage inconsistent depending on code path | Readers may miss data: `mapOrderWithItems` sees empty items for draft orders created by syncCartStateToDraftOrder; `fetchCart` via CartAuthority works because it reads OrderItem relation | Standardize on OrderItem relation as canonical; Order.items JSON kept only for backward compat | G2-E |
| G2-E1-D02 | D | **Duplicate authority: confirmedItems JSON vs OrderItem rows** — confirmedItems persisted in `conversation_context.extractedEntities.confirmedItems` (V1 legacy) AND CartAuthority syncs confirmedItems into Order.items JSON. Readers: PWA/structured-message.mapper reads from OrderItem relation via CartAuthority; legacy readers read from extractedEntities.confirmedItems. Two writers: CartAuthority.syncConfirmedItemsJson + order.service modifyCart/syncCartStateToDraftOrder. | DUPLICATE AUTHORITY | cart-authority.ts:874-903; order.service.ts:111-155; conversation.context:197 | Both locations store confirmedItems; CartAuthority keeps them in sync atomically within tx | Potential inconsistency if either writer fails; legacy readers always read from extractedEntities | CartAuthority is canonical; extractedEntities kept as backward-compat mirror | G2-E |
| G2-E1-D03 | D | **Duplicate total/price calculation** — `Order.totalPrice` computed in multiple locations with different logic: `syncCartStateToDraftOrder` (line 123-127), `addConfirmedItemToOrder` (line 84), `addOrderItem` (line 332), `transitionOrder` (computed from orderItems). No single source of truth for total across all code paths. | DUPLICATE AUTHORITY | order.service.ts:84, 123-127, 332; order-transition.ts:137-139 | Each method computes total its own way; increment vs aggregate vs item-by-item | Total mismatch between what CartAuthority stores and what OrderService readers see | CartAuthority.computeTotal() is authoritative (aggregates OrderItem._sum.subtotal) | G2-E |
| G2-E1-E01 | E | **addConfirmedItemToOrder** — `order.service.ts:39` verified: ZERO callers outside its own file. Legacy method superseded by `syncCartStateToDraftOrder`. | DEAD CODE | order.service.ts:39 | Method exists but no imports, no test references | Dead code; can be safely removed | Remove after verification | G2-E |
| G2-E1-E02 | E | **restoreCart (rollback path)** — `conversation-context.service.ts:417-429` — analyzed in G2-C. Only writes confirmedItems JSON, bypassing OrderItem rows. However, current CartAuthority.restoreFromSnapshot (cart-authority.ts:773) properly syncs all three. The old conversation-context restoreCart is dead code path. | DEAD CODE | conversation-context.service.ts:417-429 | Only updates extractedEntities.confirmedItems; OrderItem rows stale | readers reading OrderItem get post-mutation-stale state | Deprecated; use cartAuthority.restoreFromSnapshot | G2-E |
| G2-E1-F01 | F | **Stock race condition** — `addLine`/`executeOps` soft stock check in cart (best-effort UX only). Two concurrent cart adds may both pass soft check but only first checkout succeeds. Final invariant enforced at checkout. | BUG/RISK | cart-authority.ts:204-210, 547-559 | Cart-level stock check does NOT account for existing cart qty + new qty under concurrency | Concurrent cart adds can exceed actual stock; checkout invariant catches first winner, but UX may show overcommit | Documented: cart ≠ stock reservation. Final invariant at checkout (G2-C-L-022) | Deferred/G2-E |
| G2-E1-F02 | F | **Insufficient stock check gap in finalizeDraftOrder** — `order.service.ts:165` has NO stock validation. `conversation.service.ts:776` calls finalizeDraftOrder without stock check. Allows checkout with insufficient stock if transitionOrder passes (but transitionOrder doesn't check stock). | BUG/RISK | order.service.ts:165-176; conversation.service.ts:776 | `finalizeDraftOrder` → `updateMany` → sets waiting_address without stock check | Cart with insufficient stock can reach waiting_address state; stock invariant only in cartAuthority.checkout | Stock check must be enforced before any draft→order transition | G2-E |
| G2-E1-F03 | F | **Missing storeId in finalizeDraftOrder** — `order.service.ts:167` `updateMany({ where: { conversationId, orderStatus: 'draft' } })` has NO storeId filter. Relies on conversationId namespace. | BUG/RISK | order.service.ts:167-169 | No storeId in WHERE clause | Cross-tenant: user could potentially change status of draft orders belonging to other stores if conversationId overlaps | Add storeId filter; cartAuthority.checkout filters by storeId | G2-E |
| G2-E1-F04 | F | **routes/orders.ts:74 no transition validation** — raw status update without ALLOWED_TRANSITIONS guard. Client can set any status from the valid list, including invalid from→to transitions. | BUG/RISK | routes/orders.ts:86-99 | `prisma.order.update({ where: { id, storeId }, data: { orderStatus } })` | Status can jump arbitrarily (e.g., pending → completed without going through waiting_address → waiting_payment → paid) | Route must delegate to transitionOrder with fromStatus validation | G2-E |
| G2-E1-F05 | F | **Price not always from DB authoritative** — `order.service.ts:addConfirmedItemToOrder` uses `item.price` from caller (ConfirmedItem). `syncCartStateToDraftOrder` also uses item.price from caller. Only CartAuthority always reads Product.price from DB. LLM/caller-provided prices may diverge from DB price. | BUG/RISK | order.service.ts:84, 123-127; cart-authority.ts:205 | Prices from ConfirmedItem/LLM stored directly; not corrected against DB | Price drift between cart authority and order service; customer sees different totals in PWA vs API | CartAuthority always reads DB price; other paths should too | G2-E |
| G2-E1-F06 | F | **conferredItems read from extractedEntities bypasses CartAuthority** — `conversation.service.ts:833` reads `entities.confirmedItems` from `parseExtractedEntities(ctxRow?.extractedEntities)` instead of `getCartAsConfirmedItems`. Reads legacy V1 state, not canonical CartAuthority state. | BUG/RISK | conversation.service.ts:832-833 | Reads confirmedItems from extractedEntities JSON | Reads stale data if CartAuthority modified cart after V1 write; cross-path inconsistency | Migrate reads to CartAuthority.getCartAsConfirmedItems | G2-E |
| G2-E1-F07 | F | **PWA cart reads from Order.items JSON, not OrderItem relation** — PWA `fetchCart` (structured-message.mapper) maps OrderItem relation but drops productId (G2-C-L-013). Draft orders created by `syncCartStateToDraftOrder` have NO orderItems rows, only Order.items JSON → PWA cart shows empty for draft orders. | BUG/RISK | pwa/types/chat.ts:47; structured-message.mapper.ts:215-218 | PWA CartItem has productName, qty, price, subtotal — NO productId | Cannot identify items for remove/update from UI; product resolution ambiguous | Add productId to CartItem; fetchCart maps productId | G2-E |
| G2-E1-F08 | F | **cross-tenant validation missing in executeCartOps** — `conversation.service.ts:executeCartOps` calls `modifyCart` and `syncCartStateToDraftOrder` without explicit storeId validation inside those methods (though CartAuthority.addLine validates product.storeId). The conversation service has storeId available. | BUG/RISK | conversation.service.ts:887-925 | storeId passed to executeCartOps but may not flow to all writes | Cross-tenant add/remove possible if storeId not properly forwarded | Ensure storeId flows to CartAuthority; CartAuthority already validates | G2-E |
| G2-E1-F09 | F | **concurrent mutation risk: modifyCart + syncCartStateToDraftOrder not atomic** — `conversation.service.ts:executeCartOps` calls modifyCart (outside tx if no tx provided) then syncCartStateToDraftOrder (separate prisma order.create/update). Two separate DB operations, no guaranteed atomicity. | BUG/RISK | conversation.service.ts:887-925 | Two separate prisma operations | modifyCart succeeds but syncCartStateToDraftOrder fails → cart state diverge; or vice versa | Unify via CartAuthority.executeOps (single $transaction) | G2-E |
| G2-E1-F10 | F | **checkout stock check only in cartAuthority.checkout** — `finalizeDraftOrder` (conversation.service.ts:776) and `routes/orders.ts` have NO stock check. Only `cartAuthority.checkout` validates all line items against current DB stock. Other paths to waiting_address bypass stock validation. | BUG/RISK | cart-authority.ts:433-465; conversation.service.ts:776; order.service.ts:165 | Stock check only in one code path | Inconsistent stock enforcement; same cart can reach waiting_address via some paths but not others | All draft→order transitions must enforce stock check | G2-E |

---
## PRIORITIZATION SUMMARY

### Critical (P0/P1) — Must Fix in G2-E
| ID | Finding | Impact |
|----|---------|--------|
| G2-E1-F01 | Stock race condition — concurrent cart adds can exceed stock | cart integrity, price/total integrity |
| G2-E1-F02 | finalizeDraftOrder has no stock validation | order status integrity, checkout correctness |
| G2-E1-F03 | finalizeDraftOrder missing storeId ownership check | tenant isolation |
| G2-E1-F04 | routes/orders.ts raw status update bypasses state machine | order status integrity |
| G2-E1-F06 | confirmedItems read from extractedEntities bypasses CartAuthority | cart integrity, price/total integrity |
| G2-E1-F07 | PWA cart empty for draft orders (no OrderItem rows) | PWA/customer experience |
| G2-E1-F08 | cross-tenant risk in executeCartOps | tenant isolation |
| G2-E1-F09 | concurrent mutation: modifyCart + syncCartStateToDraftOrder not atomic | cart integrity, concurrent mutation |
| G2-E1-F10 | checkout stock check only in one path | checkout correctness, price/total integrity |

### High (P2) — Should Fix in G2-E
| ID | Finding | Impact |
|----|---------|--------|
| G2-E1-D01 | Duplicate authority: Order.items JSON vs OrderItem rows | price/total integrity, order status integrity |
| G2-E1-D02 | Duplicate authority: confirmedItems JSON vs OrderItem rows | cart integrity |
| G2-E1-D03 | Duplicate total/price calculation in multiple places | price/total integrity |
| G2-E1-F05 | Price not always from DB authoritative | price/total integrity |
| G2-E1-F02 | Stock check gap in finalizeDraftOrder | checkout correctness |

### Medium (P3) — Can Defer / Cleanup
| ID | Finding | Impact |
|----|---------|--------|
| G2-E1-E01 | addConfirmedItemToOrder dead code | code cleanup |
| G2-E1-E02 | Old restoreCart dead code | code cleanup |
| G2-E1-B02 | modifyCart backward compat wrapper | deferred until caller migration |
| G2-E1-B03 | syncCartStateToDraftOrder legacy path | deferred until V1 write migration |

---
## RECOMMENDED G2-E IMPLEMENTATION ORDER

### Phase 1: State Machine Enforcement (Critical)
1. **Delegate finalizeDraftOrder → cartAuthority.checkout → transitionOrder** — Replace `order.service.ts:finalizeDraftOrder`'s raw `updateMany` with call to `cartAuthority.checkout(conversationId, storeId)`. This adds stock validation, storeId filtering, and state machine transition.
2. **Route status updates → transitionOrder** — Modify `routes/orders.ts:PUT /:id/status` to delegate to `transitionOrder()` instead of raw `prisma.order.update`. Pass fromStatus for validation.
3. **Add storeId filter to finalizeDraftOrder** — If keeping the method, add `storeId` to the `where` clause.

### Phase 2: Price/Total Authority (High)
4. **Centralize total price computation** — Ensure all code paths use CartAuthority's `computeTotal()` (aggregates OrderItem._sum.subtotal) as the authoritative total. Deprecate incremental calculations in `addConfirmedItemToOrder`, `addOrderItem`, `syncCartStateToDraftOrder`.
5. **Price always from DB** — Ensure `order.service.ts` reads Product.price from DB, not from ConfirmedItem.price caller parameter. Add product lookup before storing price.

### Phase 3: PWA / Cart Integrity (High)
6. **Add productId to PWA CartItem** — Update PWA types and `fetchCart` mapper to include productId from OrderItem relation. Enable item identification for remove/update in UI.
7. **Ensure PWA reads from OrderItem relation** — Fix `structured-message.mapper.fetchCart` to always have orderItems rows, not just Order.items JSON. For draft orders created by CartAuthority, OrderItem rows exist; for those from `syncCartStateToDraftOrder`, need migration or dual-read.

### Phase 4: Tenant Isolation & Concurrent Mutation (Medium)
8. **Ensure storeId flows through executeCartOps** — Verify storeId is passed and validated at CartAuthority boundary for all add/remove operations.
9. **Atomize executeCartOps** — Refactor `conversation.service.ts:executeCartOps` to use `CartAuthority.executeOps()` instead of separate modifyCart + syncCartStateToDraftOrder calls. Single $transaction guarantees atomicity.

### Phase 5: Legacy Cleanup (Medium)
10. **Dead code removal** — Remove `addConfirmedItemToOrder()` (zero callers). Deprecate `syncCartStateToDraftOrder` after all callers migrate to CartAuthority.
11. **Migrate confirmedItems reads** — Update `conversation.service.ts:getCartFromDb` / `getV1Context` to use `getCartAsConfirmedItems` after CartAuthority write migration is complete.

---
## BLOCKERS vs DEFERRED

### Blockers (must resolve before G2-E complete)
- [ ] **State machine bypass**: finalizeDraftOrder and routes/orders.ts must delegate to transitionOrder/cartAuthority.checkout
- [ ] **Stock enforcement**: All draft→order transitions must include stock check (not just cartAuthority.checkout)
- [ ] **Tenant isolation**: storeId must be enforced in all order status writes and cart operations
- [ ] **PWA productId**: PWA cart must have productId for item identification

### Deferred (can postpone to G2-E cleanup or later)
- [ ] **Dead code removal**: addConfirmedItemToOrder (zero callers)
- [ ] **modifyCart backward compat**: keep until all conversation service callers migrate
- [ ] **syncCartStateToDraftOrder**: keep as legacy path until V1 write migration complete
- [ ] **Duplicate authority documentation**: Order.items JSON vs OrderItem rows — keep JSON for backward compat, mark as legacy

---
## VERIFICATION CHECKLIST

- [ ] **Audit caller graph**: All `prisma.order.update` calls for status → trace to transitionOrder or bypass
- [ ] **Audit direct DB writes**: All `prisma.order.create/update/delete` → verify they go through CartAuthority or have proper guards
- [ ] **Audit state-machine bypass**: finalizeDraftOrder, routes/orders.ts PUT status → confirm they use transitionOrder
- [ ] **Audit CartAuthority boundary**: All cart add/remove/update/checkout → go through CartAuthority class methods

---
## KEY OBSERVATIONS

1. **CartAuthority is the canonical single authority** for cart state (OrderItem rows + Order.items JSON + confirmedItems JSON), implemented with atomic `$transaction` writes. Most cart integrity findings are about ensuring ALL paths go through CartAuthority.

2. **Two bypass paths exist** that bypass the state machine and CartAuthority:
   - `finalizeDraftOrder` in order.service.ts uses raw `prisma.order.updateMany`
   - `routes/orders.ts:PUT /:id/status` uses raw `prisma.order.update`
   Both need to delegate to `transitionOrder`.

3. **Price/total integrity has multiple sources of truth**:
   - CartAuthority computes total from OrderItem._sum.subtotal (authoritative)
   - order.service computes incrementally from ConfirmedItem.price (caller-provided, not DB authoritative)
   - Need to centralize on CartAuthority's computation.

4. **PWA cart discrepancy**: Draft orders created via `syncCartStateToDraftOrder` have only Order.items JSON, no OrderItem rows → PWA cart shows empty. CartAuthority-created drafts have OrderItem rows → PWA works. Need to ensure consistent path.

5. **The `checkout` flow is generally correct** when going through `cartAuthority.checkout` → `transitionOrder`, including stock validation and confirmedItems cleanup. The issues are with OTHER paths that also transition draft orders to waiting_address.