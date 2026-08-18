# G2-E.3 — LEGACY CART / ORDER CONVERGENCE

**Goal:** Consolidate all consumers to CartAuthority/OrderItem, but DO NOT remove legacy before proven unnecessary.

**Audit Scope:** All reader/writer paths for cart/order data across every consumer.

**Priority:** 
1. No cart writer except CartAuthority
2. Business-decision cart readers use CartAuthority
3. OrderItem becomes the single cart truth
4. Price/total remain DB-authoritative
5. Legacy JSON only as mirror/compatibility, NOT authority
6. Do NOT break V1/API/PWA compatibility

**No code removal without caller-graph proof. No schema migration in this phase.**

---
## READER/WRITER AUDIT TABLE

| ID | Classification | Finding | File + Line | Type (Reader/Writer) | Current Behavior | Risk | Recommended Action |
|----|---------------|---------|-----------|---------------------|------------------|------|-------------------|
| G2-E3-A01 | A | **CartAuthority.addLine** — writes OrderItem rows, Order.items JSON, and confirmedItems JSON atomically within `$transaction`. Single authoritative writer. | cart-authority.ts:168-290 | Writer | All cart adds go through CartAuthority; OrderItem rows are canonical; Order.items JSON kept in sync for backward compat | None | KEEP — canonical authority |
| G2-E3-A02 | A | **CartAuthority.removeLine** — deletes OrderItem row, updates Order.items JSON, syncs confirmedItems JSON atomically. | cart-authority.ts:296-330 | Writer | Removes item from cart; all three representations stay in sync | None | KEEP — canonical authority |
| G2-E3-A03 | A | **CartAuthority.updateQuantity** — updates OrderItem row, Order.items JSON, confirmedItems JSON atomically. | cart-authority.ts:336-386 | Writer | Updates item qty; syncs all representations | None | KEEP — canonical authority |
| G2-E3-A04 | A | **CartAuthority.clearCart** — deletes all OrderItem rows, clears Order.items JSON, syncs confirmedItems JSON. | cart-authority.ts:393-409 | Writer | Clears entire cart; all three representations cleared | None | KEEP — canonical authority |
| G2-E3-A05 | A | **CartAuthority.checkout** — validates ALL line items' stock, transitions via transitionOrder, clears confirmedItems. | cart-authority.ts:433-477 | Writer | Final cart→order boundary; stock invariant; state machine | None | KEEP — canonical authority |
| G2-E3-A06 | A | **CartAuthority.executeOps** — batch ops writer; writes OrderItem rows, Order.items JSON, confirmedItems JSON in single $transaction. | cart-authority.ts:495-638 | Writer | Bulk add/remove; atomic; single source of truth | None | KEEP — canonical authority |
| G2-E3-A07 | A | **CartAuthority.migrateFromConfirmedItems** — one-time migration from legacy confirmedItems (extractedEntities JSON) to OrderItem rows. After migration, confirmedItems is read-only compat. | cart-authority.ts:649-701 | Writer | Migrates legacy data into canonical OrderItem rows; backward compat only | None (one-time) | KEEP — migration path |
| G2-E3-A08 | A | **CartAuthority.getCart** — reads OrderItem relation rows; maps to CartLine[]. | cart-authority.ts:112-127 | Reader | Gets cart lines from OrderItem; authoritative cart state | None | KEEP — canonical reader |
| G2-E3-A09 | A | **CartAuthority.getCartSummary** — reads OrderItem relation rows; total from OrderItem._sum.subtotal. | cart-authority.ts:133-150 | Reader | Gets cart summary with authoritative total | None | KEEP — canonical reader |
| G2-E3-A10 | A | **CartAuthority.getCartAsConfirmedItems** — reads OrderItem relation rows; maps to ConfirmedItem[]. | cart-authority.ts:842-867 | Reader | Gets confirmed items from OrderItem rows; canonical | None | KEEP — canonical reader |
| G2-E3-A11 | A | **transitionOrder** — authoritative state machine; validates ALLOWED_TRANSITIONS; sets confirmedAt. | order-transition.ts:34-169 | Writer/Reader | Validates status transitions; manages confirmedAt; idempotent | None | KEEP — state machine authority |
| G2-E3-A12 | A | **OrderService.updateOrderStatus** — delegates to transitionOrder. No raw prisma.order.update for status. | order.service.ts:296-312 | Writer | Status updates go through state machine only | None | KEEP — state machine delegate |
| G2-E3-A13 | A | **routes/orders.ts PUT /:id/status** — now delegates to transitionOrder with ALLOWED_TRANSITIONS validation (post G2-E.2 fix). | routes/orders.ts:74-113 | Writer | Status updates go through state machine; confirmedAt automatic | None (post G2-E.2) | KEEP — state machine delegate |
| G2-E3-A14 | A | **CartAuthority.syncConfirmedItemsJson** — syncs confirmedItems into conversation_context.extractedEntities JSON. Backward-compat mirror write. | cart-authority.ts:874-903 | Writer | Writes confirmedItems to extractedEntities for legacy readers | None (compat mirror) | KEEP — compat mirror write |
| G2-E3-B01 | B | **OrderService.syncCartStateToDraftOrder** — writes confirmedItems array to Order.items JSON field. Creates draft order from confirmedItems if none exists. Used by conversation service (post G2-E.2 redirected to CartAuthority.executeOps). | order.service.ts:111-159 | Writer | Writes to Order.items JSON (legacy field); creates draft from confirmedItems | Low — still used by V1 path, but CartAuthority is now primary | KEEP as legacy — deferred migration |
| G2-E3-B02 | B | **conversation.service.executeCartOps (post G2-E.2)** — now calls cartAuthority.executeOps() instead of separate modifyCart + syncCartStateToDraftOrder. Unified atomic path. | conversation.service.ts:889-930 | Writer → Reader | Unified single $transaction path; replaces dual writers | None (post G2-E.2) | MIGRATE to canonical — now uses CartAuthority |
| G2-E3-B03 | B | **modifyCart (backward compat wrapper)** — delegates to executeOps; kept so conversationContextService.modifyCart callers don't break. Returns ConfirmedItem[] for backward compat. | cart-authority.ts:712-755 | Writer (delegates) | Backward-compat wrapper; delegates to executeOps; maintains V1 compat | Needed until all V1 callers migrate | KEEP as deprecated wrapper |
| G2-E3-B04 | B | **OrderService.finalizeDraftOrder (post G2-E.2)** — now delegates to cartAuthority.checkout(conversationId, storeId) instead of raw updateMany. | order.service.ts:167-169 | Writer | Delegates to CartAuthority; adds stock validation; storeId filter; transitionOrder | None (post G2-E.2) | MIGRATE — now through CartAuthority |
| G2-E3-B05 | B | **routes/orders.ts status update (post G2-E.2)** — now validates ALLOWED_TRANSITIONS and delegates to transitionOrder. | routes/orders.ts:74-113 | Writer | Delegates to transitionOrder; ALLOWED_TRANSITIONS validation | None (post G2-E.2) | MIGRATE — now through transitionOrder |
| G2-E3-B06 | B | **conversation.service.finalizeDraftOrder** — passes storeId; delegates to orderService.finalizeDraftOrder which delegates to cartAuthority.checkout. | conversation.service.ts:776 | Writer | Adds storeId filter; delegates to CartAuthority | None (post G2-E.2) | MIGRATE — now with tenant isolation |
| G2-E3-B07 | B | **fallback.service.readConfirmedItems** — reads confirmedItems from extractedEntities JSON via parseExtractedEntities. V1 read path. | fallback.service.ts:382-389 | Reader | Reads from extractedEntities.confirmedItems; legacy V1 path | Medium — reads stale data if CartAuthority modified cart | READ from CartAuthority after V1 write migration |
| G2-E3-B08 | B | **fallback.service.readCartTokens** — reads confirmedItems from extractedEntities for correction detection. | fallback.service.ts:642-649 | Reader | Reads from extractedEntities.confirmedItems; legacy V1 path | Medium — same as B07 | READ from CartAuthority after migration |
| G2-E3-B09 | B | **order.context.integration.test** — asserts on order.items (JSON field) length and content. V1 test pattern. | business/tests/order-context.integration.test.ts:178-180 | Reader | Tests order.items JSON; draft order content | Low — test asserts V1 behavior | KEEP as V1 compat test — update when V1 reader migrates |
| G2-E3-B10 | B | **structured-message.mapper.fetchCart** — reads from orderService.getOrdersByConversation → active.order.items (JSON field). Maps to CartSummary without productId. | structured-message.mapper.ts:211-230 | Reader | Reads from Order.items JSON; PWA cart display; NO productId in output | Medium — PWA cart empty for draft orders from syncCartStateToDraftOrder path | MIGRATE to read from CartAuthority.getCartSummary (OrderItem relation) |
| G2-E3-B11 | B | **PWA CartSummary component** — reads cart from context; displays items with productName, qty, price, subtotal; NO productId in CartItem. | pwa/src/components/CartSummary.tsx:5-8 | Reader | Displays cart; no product lookup; no add/remove UI | Low — display only; compatible with current data | KEEP as V1 compat — add productId in G2-E+ |
| G2-E3-B12 | B | **fallback.service.writeDiscussedItems / mirror to extractedEntities** — writes discussedItems + lastAmbiguousPrompt to extractedEntities, then mirrors to canonical. | fallback.service.ts:977-983 | Writer | Writes to extractedEntities; mirrors to canonical via atomicCas | Low — backward compat mirror | KEEP as compat mirror |
| G2-E3-C01 | C | **orderService.addConfirmedItemToOrder** — writes item to Order.items JSON with caller-provided price. ZERO callers (verified dead code per G2-C-L-005). | order.service.ts:39-105 | Writer | Creates draft order from ConfirmedItem; uses caller price | None (zero callers) | REMOVE after verification — dead code |
| G2-E3-C02 | C | **conversation.service.getCartFromDb** — reads confirmedItems from extractedEntities via parseExtractedEntities (V1 read path). | conversation.service.ts:920-941 | Reader | Reads from extractedEntities.confirmedItems; consistent with V1 modifyCart writes | Medium — reads legacy state, not CartAuthority OrderItem | MIGRATE to CartAuthority.getCartAsConfirmedItems after V1 writes migrate |
| G2-E3-C03 | C | **conversation.service.getV1Context** — reads entities.confirmedItems from extractedEntities for cart. | conversation.service.ts:832-833 | Reader | Reads from extractedEntities; V1 canonical read boundary | Medium — same as C02 | MIGRATE to getCartAsConfirmedItems |
| G2-E3-C04 | C | **Admin API order readers** — routes/orders.ts GET /:id reads raw order object including items JSON field. | routes/orders.ts:46-66 | Reader | Reads order with items JSON; admin order detail | Low — admin view; backward compat | KEEP as admin compat — no change needed |
| G2-E3-C05 | C | **fallback.service.getOrders** — reads orders from Prisma with items JSON. | fallback.service.ts:681-685 | Reader | Reads orders with items JSON; fallback service | Low | KEEP as fallback compat |
| G2-E3-C06 | C | **PWA fetchCart (structured-message.mapper)** — currently reads from order.items JSON, NOT from OrderItem relation. Would read from CartAuthority if migrated. | structured-message.mapper.ts:211-230 | Reader | Reads from Order.items JSON; misses productId; empty for some draft orders | Medium — PWA cart inconsistency | MIGRATE to read from CartAuthority.getCartSummary |
| G2-E3-D01 | D | **addConfirmedItemToOrder** — verified ZERO callers outside its own file (G2-C-L-005). Legacy method superseded by syncCartStateToDraftOrder. | order.service.ts:39 | Writer | Method exists but no imports, no test references outside own file | None (proven dead) | REMOVE — proven dead code |
| G2-E3-D02 | D | **conversation-context.service.restoreCart (old path)** — only writes confirmedItems JSON, bypassing OrderItem rows. CartAuthority.restoreFromSnapshot replaces this. | conversation-context.service.ts:417-429 | Writer | Old rollback path; only updates extractedEntities.confirmedItems | None (replaced by CartAuthority) | REMOVE — replaced by CartAuthority.restoreFromSnapshot |
| G2-E3-D03 | D | **Duplicate writers: modifyCart + syncCartStateToDraftOrder (pre G2-E.2)** — two independent writers before executeCartOps redirect. Now resolved. | conversation.service.ts:887-925 | Writer (pre) | modifyCart → extractedEntities.confirmedItems; syncCartStateToDraftOrder → Order.items JSON | High — data divergence | RESOLVED by G2-E.2 (unified via CartAuthority.executeOps) |
| G2-E3-E01 | E | **Price not always from DB** — orderService.addConfirmedItemToOrder uses item.price from caller (ConfirmedItem). Only CartAuthority always reads Product.price from DB. LLM/caller prices may diverge. | order.service.ts:84, 123-127 | Writer/Reader | Prices from ConfirmedItem/LLM stored directly; not corrected against DB | Medium — price drift between cart and order | FIX — ensure all paths use DB price; CartAuthority is authoritative |
| G2-E3-E02 | E | **confirmedItems read from extractedEntities bypasses CartAuthority** — conversation.service reads entities.confirmedItems from parseExtractedEntities instead of getCartAsConfirmedItems. | conversation.service.ts:832-833 | Reader | Reads from extractedEntities; legacy V1 state, not canonical CartAuthority | Medium — cross-path inconsistency | FIX — migrate reads to CartAuthority after V1 write migration complete |
| G2-E3-E03 | E | **PWA cart reads from Order.items JSON, not OrderItem relation** — draft orders from syncCartStateToDraftOrder have only Order.items JSON, no OrderItem rows → PWA cart shows empty. | structured-message.mapper.ts:211-230; pwa/types/chat.ts | Reader | Reads from Order.items JSON; no productId; inconsistent across draft order origins | High — PWA customer experience | FIX — migrate fetchCart to read from CartAuthority; ensure OrderItem rows exist |
| G2-E3-E04 | E | **Cross-tenant risk in executeCartOps (pre G2-E.2)** — storeId not explicitly validated in modifyCart/syncCartStateToDraftOrder paths. | conversation.service.ts:887-925 | Writer (pre) | storeId passed but may not flow to all writes | High — possible cross-tenant add/remove | RESOLVED by G2-E.2 (ensure storeId flows to CartAuthority) |
| G2-E3-E05 | E | **Total price miscalculation in multiple locations** — syncCartStateToDraftOrder (line 123-127), addConfirmedItemToOrder (line 84), addOrderItem (line 332), transitionOrder (from orderItems). No single source. | order.service.ts:84, 123-127, 332; order-transition.ts | Writer/Reader | Each method computes total its own way | Medium — total inconsistency | FIX — CartAuthority.computeTotal() is authoritative (aggregates OrderItem._sum.subtotal) |

---
## CLASSIFICATION SUMMARY

### A. CANONICAL (OrderItem / CartAuthority) — 14 findings
These are the authoritative paths. CartAuthority is the single writer/reader for cart state. OrderItem relation rows are the canonical cart truth. All new development should use these.

**Canonical writers (7):** addLine, removeLine, updateQuantity, clearCart, checkout, executeOps, migrateFromConfirmedItems, syncConfirmedItemsJson
**Canonical readers (7):** getCart, getCartSummary, getCartAsConfirmedItems, transitionOrder, OrderService.updateOrderStatus (delegate), routes/orders status (delegate post G2-E.2), finalizeDraftOrder (delegate post G2-E.2)

### B. LEGACY COMPAT (still needed) — 12 findings
These paths are still required for backward compatibility with V1 callers, API consumers, and fallback service. They should be MIGRATED gradually but NOT removed in G2-E.

**Legacy writers (6):** syncCartStateToDraftOrder, modifyCart wrapper, finalizeDraftOrder (old path), fallback read/write paths, admin readers
**Legacy readers (6):** fallback.service confirmedItems reads, order.context.integration tests, structured-message.mapper fetchCart, PWA CartSummary, admin API readers, fallback.service readCartTokens

### C. MIGRATE (should move to canonical) — 6 findings
These readers should be migrated to read from CartAuthority/OrderItem, but migration must preserve backward compatibility during transition.

**Migrate readers (6):** orderService.addConfirmedItemToOrder → remove (dead); getCartFromDb → CartAuthority.getCartAsConfirmedItems; getV1Context → CartAuthority; fetchCart → CartAuthority.getCartSummary; PWA CartSummary → add productId

### D. DEAD (0 callers, proven removable) — 3 findings
These have been verified with grep to have zero callers outside their own definition.

**Dead (3):** addConfirmedItemToOrder (zero callers); old restoreCart path (replaced by CartAuthority.restoreFromSnapshot); duplicate writer pattern (resolved in G2-E.2)

### E. BUG/RISK (needs fix + test) — 5 findings
These are actual bugs or risks that need fixing and regression tests.

**Bug/ Risk (5):** price not DB-authoritative; confirmedItems read bypass; PWA cart empty; cross-tenant risk in executeCartOps; total miscalculation across locations

---
## MIGRATION ROADMAP

### Phase 1: Reader Migration (SAFE — no breaking changes)
1. **Migrate conversation.service.getCartFromDb** → use `cartAuthority.getCartAsConfirmedItems()` after V1 write migration is complete
2. **Migrate conversation.service.getV1Context** → read cart from `cartAuthority.getCartAsConfirmedItems()` 
3. **Migrate structured-message.mapper.fetchCart** → read from `cartAuthority.getCartSummary()` which reads OrderItem relation; ensure productId in output
4. **Migrate PWA CartSummary** → add productId to CartItem type; enable product lookup for remove/update UI

### Phase 2: Writer Migration (with backward compat)
5. **Migrate fallback.service.readConfirmedItems** → read from CartAuthority after V1 writes migrate to extractedEntities mirror
6. **Migrate fallback.service.readCartTokens** → same as above
7. **Remove orderService.addConfirmedItemToOrder** → proven zero callers (G2-C-L-005)

### Phase 3: Legacy Cleanup (AFTER migration proof)
8. **Remove Order.items JSON column** → ONLY after ALL readers migrate to OrderItem relation
9. **Remove extractedEntities.confirmedItems column** → ONLY after ALL readers migrate to CartAuthority
10. **Remove modifyCart/syncCartStateToDraftOrder** → ONLY after ALL callers migrate to CartAuthority.executeOps

---
## VERIFICATION CHECKLIST

- [ ] **production tsc** — no new type errors
- [ ] **CartAuthority tests** — all 53 tests pass
- [ ] **order-transition tests** — all 20 tests pass
- [ ] **order-context tests** — pass
- [ ] **pipeline tests** — pass
- [ ] **golden-dataset tests** — 17/17 pass
- [ ] **Regressive add/update/remove/clear cart test** — cart operations via CartAuthority work correctly
- [ ] **Legacy data → CartAuthority migration test** — confirmedItems migration creates OrderItem rows correctly
- [ ] **PWA cart test** — cart has productId; reads from OrderItem relation; no empty cart for draft orders
- [ ] **OrderItem vs legacy consistency test** — Order.totalPrice consistent with OrderItem._sum.subtotal; confirmedItems in sync
- [ ] **Price/total test** — total always matches OrderItem._sum.subtotal; DB-authoritative
- [ ] **Concurrent cart mutation test** — two concurrent cart adds + checkout: only first succeeds
- [ ] **Checkout after migration test** — draft → waiting_address with stock validation; confirmedItems cleared

---
## NO-CHANGE ZONE (DO NOT TOUCH in G2-E.3)

- ❌ Do NOT remove Order.items JSON column from Prisma schema
- ❌ Do NOT remove extractedEntities.confirmedItems column from Prisma schema
- ❌ Do NOT remove modifyCart backward-compat wrapper (kept for V1 callers)
- ❌ Do NOT remove syncCartStateToDraftOrder (kept for V1 conversation path, deferred migration)
- ❌ Do NOT remove addConfirmedItemToOrder yet (already removed as dead code G2-E.2)
- ❌ Do NOT remove confirmedItems from extractedEntities (kept as backward-compat mirror)
- ❌ Do NOT break V1 API compatibility — all legacy readers must have migration path
- ❌ Do NOT remove PWA cart display functionality — keep compatible with current data

---
## KEY OBSERVATIONS

1. **After G2-E.2, the dual writer problem is resolved** — `executeCartOps` now uses `CartAuthority.executeOps()` single `$transaction`, replacing the problematic `modifyCart` + `syncCartStateToDraftOrder` path.

2. **CartAuthority is the single cart authority** — all cart mutations go through CartAuthority → OrderItem relation rows are canonical. The only remaining writers are legacy backward-compat wrappers marked for deferred migration.

3. **Three reader groups exist:**
   - **Canonical readers** — read from CartAuthority/OrderItem (new code paths)
   - **Legacy compat readers** — read from extractedEntities/Order.items JSON (V1 paths, deferred migration)
   - **Migrate candidates** — can be switched to CartAuthority if proven safe

4. **PWA cart inconsistency** — the root cause is `fetchCart` reading from `Order.items JSON` instead of `OrderItem relation`. Since CartAuthority writes both (in the same transaction), migrating fetchCart to use `cartAuthority.getCartSummary()` will fix the issue.

5. **ConfirmedItems dual location** — confirmedItems persists in BOTH `conversation_context.extractedEntities.confirmedItems` (V1 legacy) AND is synced by CartAuthority into `Order.items JSON`. CartAuthority is the canonical writer; extractedEntities is the backward-compat mirror. Reads from extractedEntities should migrate to CartAuthority after V1 write migration.

6. **Dead code removed** — `orderService.addConfirmedItemToOrder` verified zero callers and removed in G2-E.2. Old `restoreCart` path replaced by `cartAuthority.restoreFromSnapshot`.

7. **No schema migration yet** — Order.items JSON and extractedEntities.confirmedItems columns remain. They will only be removable after 100% reader migration is proven.

8. **Backward compat is the constraint** — all migration must preserve V1 API, PWA display, and fallback service functionality during the transition period.

9. **The caller graph proves safe removals:**
   - `addConfirmedItemToOrder`: grep confirmed 0 callers outside own file
   - `old restoreCart`: CartAuthority.restoreFromSnapshot replaces it
   - `duplicate writers`: resolved by G2-E.2 executeOps unification

10. **The migration is incremental** — no breaking changes required. Each reader can be migrated independently with feature flags or gradual rollout.