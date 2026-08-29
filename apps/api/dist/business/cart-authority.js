import { prisma } from '../infrastructure/prisma.js';
import { adapters } from '../adapters/container.js';
import { productService } from './product.service.js';
import { transitionOrder } from './order-transition.js';
import { ErrorCodes } from '../constants/errorCodes.js';
/** Resolve tx or fall back to global prisma client. */
function txOrGlobal(tx) {
    return tx ?? prisma;
}
// ── Errors ───────────────────────────────────────────────────────────────────
export class CartError extends Error {
    constructor(message) {
        super(message);
        this.name = 'CartError';
    }
}
/**
 * Thrown when a cart operation violates an invariant (invalid product,
 * cross-tenant access, insufficient stock, etc.).
 */
export class CartInvariantError extends CartError {
    constructor(message, code) {
        super(message);
        this.code = code;
        this.name = 'CartInvariantError';
    }
}
/**
 * Thrown when product name resolution is ambiguous — multiple products
 * match the substring fallback and the correct one cannot be determined.
 */
export class ProductAmbiguousError extends CartError {
    constructor(productName, candidates) {
        super(`Product name "${productName}" is ambiguous — matched ${candidates.length} products. ` +
            `Candidates: ${candidates.join(', ')}. Please specify the exact product name.`);
        this.candidates = candidates;
        this.name = 'ProductAmbiguousError';
    }
}
// ── CartAuthority ─────────────────────────────────────────────────────────────
export class CartAuthority {
    // ================================================================
    // READ — no mutations, no transactions needed
    // ================================================================
    /**
     * Get cart line items (OrderItem relation rows) for a conversation's
     * draft order. Returns empty array if no draft order exists.
     */
    async getCart(conversationId) {
        const order = await prisma.order.findFirst({
            where: {
                conversationId,
                orderStatus: 'draft',
                deletedAt: null,
            },
            include: { orderItems: { orderBy: { createdAt: 'asc' } } },
        });
        if (!order || !order.orderItems || order.orderItems.length === 0) {
            return [];
        }
        return this.mapOrderItems(order.orderItems);
    }
    /**
     * Get cart summary (items + total) for structured-message delivery.
     * Total is authoritative from Order.totalPrice if available, else computed.
     */
    async getCartSummary(conversationId) {
        const order = await prisma.order.findFirst({
            where: {
                conversationId,
                orderStatus: 'draft',
                deletedAt: null,
            },
            include: { orderItems: { orderBy: { createdAt: 'asc' } } },
        });
        if (!order) {
            return { items: [], total: null };
        }
        const items = this.mapOrderItems(order.orderItems || []);
        const total = order.totalPrice ?? items.reduce((s, i) => s + i.subtotal, 0);
        return { items, total, orderId: order.id };
    }
    /** Check whether a draft order (cart) exists for this conversation. */
    async hasCart(conversationId) {
        const count = await prisma.order.count({
            where: {
                conversationId,
                orderStatus: 'draft',
                deletedAt: null,
            },
        });
        return count > 0;
    }
    // ================================================================
    // WRITE — all atomic via $transaction
    // ================================================================
    /**
     * Add a product to the cart (or increment quantity if already present).
     *
     * Invariants:
     * - product valid (not deleted, belongs to store)
     * - quantity > 0
     * - tenant correct (storeId check)
     * - customer correct (customerId check)
     * - price from DB (authoritative, not from caller)
     */
    async addLine(conversationId, storeId, customerId, productId, qty = 1, variantId = null) {
        if (qty < 1) {
            throw new CartInvariantError('Quantity must be >= 1', 'INVALID_QUANTITY');
        }
        // Validate product belongs to store + is active + not deleted
        const product = await productService.getProductById(productId);
        if (product.storeId !== storeId) {
            throw new CartInvariantError(`Product ${productId} does not belong to store ${storeId}`, 'CROSS_TENANT');
        }
        if (!product.isActive || product.deletedAt) {
            throw new CartInvariantError(`Product ${product.name} is not available`, 'PRODUCT_INACTIVE');
        }
        // PV-P1: price/stock authoritatively resolved via centralized helper.
        // variantId null → Product (unchanged); variantId set → ProductVariant.
        const { price: unitPrice, stock } = await this.resolvePriceAndStock(productId, variantId, undefined);
        const newQty = qty;
        return await prisma.$transaction(async (tx) => {
            // Re-fetch product inside transaction for latest stock (avoids race)
            const freshProduct = await tx.product.findUnique({
                where: { id: productId },
            });
            if (!freshProduct || freshProduct.deletedAt) {
                throw new CartInvariantError(`Product ${productId} no longer available`, 'PRODUCT_INACTIVE');
            }
            if (freshProduct.storeId !== storeId) {
                throw new CartInvariantError(`Product ${productId} does not belong to store ${storeId}`, 'CROSS_TENANT');
            }
            // Find-or-create draft order
            const order = await this.findOrCreateDraftOrder(tx, conversationId, storeId, customerId);
            // PV-P1: find key = productId + variantId (variantId null is a VALID value,
            // not an empty filter — match it explicitly).
            const existingItem = await tx.orderItem.findFirst({
                where: {
                    orderId: order.id,
                    productId: productId,
                    variantId: variantId ?? null,
                },
            });
            // Stock check: existing qty in cart + new qty must not exceed stock
            const existingQty = existingItem ? Number(existingItem.quantity) : 0;
            if (stock !== null && stock < existingQty + newQty) {
                throw new CartInvariantError(`Insufficient stock for ${freshProduct.name}: ${stock} available, ${existingQty + newQty} needed`, 'INSUFFICIENT_STOCK');
            }
            if (existingItem) {
                // Upsert: increment quantity
                const updatedQty = existingItem.quantity + newQty;
                const updatedSubtotal = unitPrice * updatedQty;
                await tx.orderItem.update({
                    where: { id: existingItem.id },
                    data: {
                        quantity: updatedQty,
                        unitPrice: unitPrice,
                        subtotal: updatedSubtotal,
                    },
                });
            }
            else {
                // Create new OrderItem
                const subtotal = unitPrice * newQty;
                await tx.orderItem.create({
                    data: {
                        orderId: order.id,
                        productId,
                        variantId: variantId ?? null,
                        productName: product.name,
                        quantity: newQty,
                        unitPrice,
                        subtotal,
                    },
                });
            }
            // Recompute and update Order.totalPrice + Order.items JSON + confirmedItems
            const total = await this.computeTotal(tx, order.id);
            const items = await this.mapOrderItems(await tx.orderItem.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' } }));
            const confirmedItems = this.cartLinesToConfirmedItems(items);
            await tx.order.update({
                where: { id: order.id },
                data: {
                    totalPrice: total,
                    items: await this.exportItemsJson(tx, order.id),
                },
            });
            await this.syncConfirmedItemsJson(tx, conversationId, confirmedItems);
            // Return updated cart
            return items;
        });
    }
    /**
     * Remove a line item from the cart by lineItemId.
     * Invariant: line item belongs to this conversation's draft order.
     */
    async removeLine(conversationId, lineItemId, tx) {
        const run = async (client) => {
            const tx = client;
            const order = await this.findDraftOrder(tx, conversationId);
            if (!order) {
                throw new CartInvariantError('No active cart for this conversation', 'CART_NOT_FOUND');
            }
            // Ownership check: line item must belong to this order
            const item = await tx.orderItem.findUnique({
                where: { id: lineItemId },
                select: { id: true, orderId: true },
            });
            if (!item || item.orderId !== order.id) {
                throw new CartInvariantError('Line item not found in cart', 'ITEM_NOT_FOUND');
            }
            await tx.orderItem.delete({ where: { id: lineItemId } });
            const total = await this.computeTotal(tx, order.id);
            const items = await this.mapOrderItems(await tx.orderItem.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' } }));
            const confirmedItems = this.cartLinesToConfirmedItems(items);
            await tx.order.update({
                where: { id: order.id },
                data: {
                    totalPrice: total,
                    items: await this.exportItemsJson(tx, order.id),
                },
            });
            await this.syncConfirmedItemsJson(tx, conversationId, confirmedItems);
            return items;
        };
        // Reuse caller's transaction when provided (locked idempotency pattern);
        // otherwise open a fresh one. Core logic unchanged.
        if (tx)
            return run(tx);
        return prisma.$transaction(run);
    }
    /**
     * Update quantity of a line item. qty = 0 deletes the line item.
     * Invariant: quantity >= 0; line item belongs to cart.
     */
    async updateQuantity(conversationId, lineItemId, qty, tx) {
        if (qty < 0) {
            throw new CartInvariantError('Quantity must be >= 0', 'INVALID_QUANTITY');
        }
        const run = async (client) => {
            const tx = client;
            const order = await this.findDraftOrder(tx, conversationId);
            if (!order) {
                throw new CartInvariantError('No active cart for this conversation', 'CART_NOT_FOUND');
            }
            const item = await tx.orderItem.findUnique({
                where: { id: lineItemId },
                include: { product: true },
            });
            if (!item || item.orderId !== order.id) {
                throw new CartInvariantError('Line item not found in cart', 'ITEM_NOT_FOUND');
            }
            if (qty === 0) {
                // Delete line item
                await tx.orderItem.delete({ where: { id: lineItemId } });
            }
            else {
                // Recompute subtotal with current unitPrice
                const unitPrice = item.unitPrice;
                await tx.orderItem.update({
                    where: { id: lineItemId },
                    data: {
                        quantity: qty,
                        subtotal: unitPrice * qty,
                    },
                });
            }
            const total = await this.computeTotal(tx, order.id);
            const items = await this.mapOrderItems(await tx.orderItem.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' } }));
            const confirmedItems = this.cartLinesToConfirmedItems(items);
            await tx.order.update({
                where: { id: order.id },
                data: {
                    totalPrice: total,
                    items: await this.exportItemsJson(tx, order.id),
                },
            });
            await this.syncConfirmedItemsJson(tx, conversationId, confirmedItems);
            return items;
        };
        // Reuse caller's transaction when provided (locked idempotency pattern);
        // otherwise open a fresh one. Core logic unchanged.
        if (tx)
            return run(tx);
        return prisma.$transaction(run);
    }
    /**
     * Clear all items from the cart. Deletes all OrderItem rows for the
     * conversation's draft order. Does NOT delete the Order row itself
     * (preserves conversation linkage + status).
     */
    async clearCart(conversationId) {
        await prisma.$transaction(async (tx) => {
            const order = await this.findDraftOrder(tx, conversationId);
            if (order) {
                await tx.orderItem.deleteMany({ where: { orderId: order.id } });
                await tx.order.update({
                    where: { id: order.id },
                    data: {
                        totalPrice: 0,
                        items: [],
                    },
                });
                // Also clear confirmedItems JSON (backward compat sync)
                await this.syncConfirmedItemsJson(tx, conversationId, []);
            }
        });
    }
    // ================================================================
    // CHECKOUT — Cart → Order boundary (immutable snapshot)
    // ================================================================
    /**
     * Checkout: transition draft Order → waiting_address via state machine.
     * The draft Order becomes an immutable snapshot (post-checkout states
     * managed by G2-B.6 state machine).
     *
     * Stock invariant (PV-P1-08):
     *   The cart→order boundary is the SINGLE atomic stock-deducting point.
     *   The entire checkout — stock validation, stock DECREMENT, autoCancelAt
     *   stamping, state-machine transition, and cart-scratchpad clear — runs
     *   inside ONE prisma.$transaction: any failure (incl. a lost stock race)
     *   rolls EVERYTHING back so stock is never decremented for a failed order.
     *
     *   Cart-level stock checks (addLine/executeOps) remain best-effort for UX.
     *   Two concurrent checkouts for the last unit cannot both succeed: the
     *   decrement uses an atomic compare-and-swap (updateMany WHERE stock >= qty);
     *   the loser's updateMany returns count===0 → CartInvariantError(INSUFFICIENT_STOCK)
     *   → transaction rollback. This replaces the old "best-effort, not locked"
     *   comment — stock is now truly reserved at checkout.
     *
     *   Stock is restored on cancellation (see OrderService.cancelOrder + the
     *   AutoCancel cron) by reversing the same per-item decrement.
     */
    async checkout(conversationId, storeId) {
        const orderId = await prisma.$transaction(async (tx) => {
            const order = await tx.order.findFirst({
                where: {
                    conversationId,
                    orderStatus: 'draft',
                    deletedAt: null,
                    storeId,
                },
                include: { orderItems: { where: { productId: { not: null } } } },
            });
            if (!order) {
                throw new CartInvariantError('No draft order to checkout', 'CART_NOT_FOUND');
            }
            // 1) Best-effort stock validation (read-only). Provides a clean UX error
            //    BEFORE attempting the atomic decrement. The authoritative gate is
            //    the decrement below (updateMany + gte), which also closes the race
            //    window between this read and the write.
            for (const item of order.orderItems) {
                if (!item.productId)
                    continue; // skip items with no product (product was deleted)
                const product = await productService.getProductById(item.productId);
                if (!product.isActive || product.deletedAt) {
                    throw new CartInvariantError(`Product "${product.name}" is no longer available`, 'PRODUCT_INACTIVE');
                }
                // PV-P1: stock source depends on whether the line carries a variant.
                const { stock } = await this.resolvePriceAndStock(item.productId, item.variantId ?? null, tx);
                if (stock !== null && stock < item.quantity) {
                    throw new CartInvariantError(`Insufficient stock for "${product.name}": ${stock} available, ${item.quantity} in cart`, 'INSUFFICIENT_STOCK');
                }
            }
            // 2) Atomic stock decrement — compare-and-swap at the DB level
            //    (updateMany WHERE stock >= quantity). Variant-aware: variant lines
            //    decrement ProductVariant.stock; plain-product lines decrement
            //    Product.stock (stock===null → unlimited → skipped, never decrement).
            //    If a concurrent checkout already consumed the stock, count===0 →
            //    hard failure → transaction rollback (no partial reservation).
            for (const item of order.orderItems) {
                if (!item.productId)
                    continue;
                if (item.variantId) {
                    const result = await tx.productVariant.updateMany({
                        where: { id: item.variantId, stock: { gte: item.quantity } },
                        data: { stock: { decrement: item.quantity } },
                    });
                    if (result.count === 0) {
                        throw new CartInvariantError(`Insufficient stock for variant ${item.variantId} of "${item.productName}" (race lost)`, 'INSUFFICIENT_STOCK');
                    }
                }
                else {
                    // No variant: read stock in-tx to decide skip-if-unlimited, then CAS.
                    const { stock } = await this.resolvePriceAndStock(item.productId, item.variantId ?? null, tx);
                    if (stock === null)
                        continue; // unlimited stock — never decremented, skip
                    const result = await tx.product.updateMany({
                        where: { id: item.productId, stock: { gte: item.quantity } },
                        data: { stock: { decrement: item.quantity } },
                    });
                    if (result.count === 0) {
                        throw new CartInvariantError(`Insufficient stock for "${item.productName}" (race lost)`, 'INSUFFICIENT_STOCK');
                    }
                }
            }
            // 3) Stamp auto-cancel expiry (configurable ORDER_AUTO_CANCEL_HOURS, default 24h).
            //    Paired with the stock reservation so a stuck order releases stock automatically.
            const autoCancelHours = Number(process.env.ORDER_AUTO_CANCEL_HOURS ?? '24');
            await tx.order.update({
                where: { id: order.id },
                data: { autoCancelAt: new Date(Date.now() + autoCancelHours * 3600000) },
            });
            // 4) State machine transition (G2-B.6) — atomic with the decrement above.
            //    transitionOrder validates ALLOWED_TRANSITIONS (draft → waiting_address ✓)
            //    and sets confirmedAt on confirmed/paid transitions (N/A here).
            await transitionOrder(order.id, 'waiting_address', { tx: tx, actor: 'system' });
            // 5) Clear confirmedItems JSON — cart state is now committed to the Order
            //    (OrderItem rows are immutable snapshot; confirmedItems was scratchpad)
            await this.syncConfirmedItemsJson(tx, conversationId, []);
            return order.id;
        });
        return orderId;
    }
    // ================================================================
    // BULK OPS — used by conversation engine (executeCartOps)
    // ================================================================
    /**
     * Execute a batch of CartOps atomically.
     * Resolves product names → productId via productService, reads price from DB.
     * This replaces the current pattern of:
     *   modifyCart (writes confirmedItems) + syncCartStateToDraftOrder (writes Order.items)
     *
     * If `tx` is provided (from caller's existing transaction), uses it directly.
     * Otherwise creates a new prisma.$transaction.
     *
     * Returns the updated cart as ConfirmedItem[] (backward compat for callers
     * that expect ConfirmedItem[] from modifyCart).
     */
    async executeOps(ops, storeId, customerId, conversationId, tx) {
        const runOps = async (client) => {
            const tx = client;
            let order = await this.findDraftOrder(tx, conversationId);
            if (!order) {
                order = await this.createDraftOrder(client, conversationId, storeId, customerId);
            }
            // Load existing cart
            let items = await tx.orderItem.findMany({
                where: { orderId: order.id },
            });
            for (const op of ops) {
                // Resolve product → productId for both add and remove.
                // Structured/validated path: bila op.productId ada, resolve langsung
                // (skip resolveProductByName). LLM/natural-language path (tanpa
                // productId) tetap menggunakan resolveProductByName seperti semula.
                let result;
                if (op.productId) {
                    result = await this.resolveProductById(tx, storeId, op.productId);
                }
                else {
                    try {
                        result = await this.resolveProductByName(tx, storeId, op.product);
                    }
                    catch (err) {
                        if (err instanceof ProductAmbiguousError) {
                            // DO NOT mutate cart on ambiguous product
                            adapters.logger.warn('CartAuthority: ambiguous product name, skipping op', {
                                product: op.product,
                                storeId,
                                conversationId,
                                candidates: err.candidates,
                            });
                            continue;
                        }
                        throw err;
                    }
                }
                if (op.type === 'add') {
                    if (!result) {
                        // Product not found — skip (don't fail the entire transaction)
                        adapters.logger.warn('CartAuthority: product not found, skipping', {
                            product: op.product,
                            storeId,
                            conversationId,
                        });
                        continue;
                    }
                    const { productId, productName } = result;
                    const qty = op.qty && op.qty >= 1 ? Math.floor(op.qty) : 1;
                    // PV-P2c-LLM-B B1.3: resolve free-text variant label → variantId
                    // (DB-driven, I13). Explicit variantId (structured/PWA path, already
                    // tenant-validated) ALWAYS takes precedence; the `variant` text is only
                    // consulted when variantId is absent. A null result (no/ambiguous
                    // match) is NOT thrown here — resolvePriceAndStock enforces
                    // VARIANT_REQUIRED downstream with a single, consistent error surface.
                    let variantId = op.variantId ?? null;
                    if (!variantId && op.variant) {
                        variantId = await this.resolveVariantByLabel(tx, storeId, productId, op.variant);
                    }
                    // PV-P1: authoritative price/stock (variant or parent product).
                    // Use the persisted price, NOT `result.unitPrice` (which is the parent
                    // product price from resolveProductById — wrong for variants).
                    const { price: authPrice, stock } = await this.resolvePriceAndStock(productId, variantId, tx);
                    const existing = items.find((i) => i.productId === productId && (i.variantId ?? null) === (variantId ?? null));
                    const existingQty = existing ? Number(existing.quantity) : 0;
                    if (stock !== null && stock < existingQty + qty) {
                        adapters.logger.warn('CartAuthority: insufficient stock, skipping', {
                            product: productName,
                            requested: qty,
                            inCart: existingQty,
                            available: stock,
                        });
                        continue;
                    }
                    // Check existing item (reuse from stock check above)
                    if (existing) {
                        const newQty = existing.quantity + qty;
                        await tx.orderItem.update({
                            where: { id: existing.id },
                            data: {
                                quantity: newQty,
                                unitPrice: authPrice,
                                subtotal: authPrice * newQty,
                            },
                        });
                        // Update items array
                        items = items.map((i) => i.id === existing.id
                            ? { ...i, quantity: newQty, unitPrice: authPrice, subtotal: authPrice * newQty }
                            : i);
                    }
                    else {
                        const subtotal = authPrice * qty;
                        const newItem = await tx.orderItem.create({
                            data: {
                                orderId: order.id,
                                productId,
                                variantId: variantId ?? null,
                                productName,
                                quantity: qty,
                                unitPrice: authPrice,
                                subtotal,
                            },
                        });
                        items = [...items, newItem];
                    }
                }
                else if (op.type === 'remove') {
                    if (result) {
                        const variantId = op.variantId ?? null;
                        const toRemove = items.filter((i) => i.productId === result.productId && (i.variantId ?? null) === (variantId ?? null));
                        for (const ri of toRemove) {
                            await tx.orderItem.delete({ where: { id: ri.id } });
                        }
                        items = items.filter((i) => !(i.productId === result.productId && (i.variantId ?? null) === (variantId ?? null)));
                        adapters.logger.debug('CartAuthority: removed product from cart', {
                            product: result.productName,
                            conversationId,
                        });
                    }
                    else {
                        // No product match — nothing to remove
                        adapters.logger.debug('CartAuthority: remove product not found in cart', {
                            product: op.product,
                            conversationId,
                        });
                    }
                }
            }
            // Recompute total and sync Order.items JSON + confirmedItems (backward compat)
            const total = items.reduce((s, i) => s + Number(i.subtotal || 0), 0);
            await tx.order.update({
                where: { id: order.id },
                data: {
                    totalPrice: total,
                    items: this.itemsToJson(items),
                },
            });
            // G2-C backward compat: also sync confirmedItems into extractedEntities JSON
            // so existing readers (tests, PWA) that read confirmedItems still work.
            const confirmedItems = this.orderItemsToConfirmedItems(items);
            await this.syncConfirmedItemsJson(tx, conversationId, confirmedItems);
            // Return confirmedItems (backward compat for PipelineContext callers).
            // `items` now carries the correct unitPrice (variant or product) and
            // variantId after the authPrice fix above, so confirmedItems is authoritative.
            return confirmedItems;
        };
        // If caller provided a tx, use it directly (transaction propagation).
        // Otherwise, wrap in a new $transaction.
        if (tx) {
            return runOps(tx);
        }
        return prisma.$transaction(runOps);
    }
    // ================================================================
    // MIGRATION — one-time backward compat
    // ================================================================
    /**
     * Migrate legacy confirmedItems from extractedEntities JSON to OrderItem rows.
     * Called on first cart access if no draft Order exists but confirmedItems has data.
     * After migration, confirmedItems is read-only (CartAuthority is authoritative).
     */
    async migrateFromConfirmedItems(conversationId, storeId, customerId, confirmedItems) {
        if (!confirmedItems || confirmedItems.length === 0)
            return;
        // Check if already migrated (draft order exists)
        const existing = await this.hasCart(conversationId);
        if (existing)
            return;
        await prisma.$transaction(async (tx) => {
            const order = await this.createDraftOrder(tx, conversationId, storeId, customerId);
            for (const item of confirmedItems) {
                const qty = typeof item.qty === 'number' ? item.qty : 1;
                const price = typeof item.price === 'number' ? item.price : 0;
                const subtotal = price * qty;
                // Try to resolve productId from name for referential integrity
                const resolved = await this.resolveProductByName(null, storeId, item.product);
                const productId = resolved?.productId ?? null;
                const productName = resolved?.productName ?? item.product;
                await tx.orderItem.create({
                    data: {
                        orderId: order.id,
                        productId,
                        productName,
                        quantity: qty,
                        unitPrice: price,
                        subtotal,
                    },
                });
            }
            const items = await tx.orderItem.findMany({ where: { orderId: order.id } });
            const total = items.reduce((s, i) => s + Number(i.subtotal || 0), 0);
            await tx.order.update({
                where: { id: order.id },
                data: {
                    totalPrice: total,
                    items: this.itemsToJson(items),
                },
            });
        });
        adapters.logger.info('CartAuthority: migrated confirmedItems → OrderItem rows', {
            conversationId,
            itemCount: confirmedItems.length,
        });
    }
    // ================================================================
    // BACKWARD COMPAT — modifyCart wrapper
    // ================================================================
    /**
     * Backward-compatible modifyCart that delegates to CartAuthority.
     * Kept so conversationContextService.modifyCart callers don't break.
     * Returns ConfirmedItem[] (mapped from CartLine[]).
     */
    async modifyCart(conversationId, storeId, customerId, action, opts, tx) {
        // First, migrate from confirmedItems if needed (only when no tx — i.e., standalone call)
        if (!tx) {
            const existingCart = await this.getCart(conversationId);
            if (existingCart.length === 0 && opts.addedProduct) {
                const legacyItems = await this.readLegacyConfirmedItems(conversationId);
                if (legacyItems.length > 0) {
                    await this.migrateFromConfirmedItems(conversationId, storeId, customerId, legacyItems);
                }
            }
        }
        return await this.executeOps([
            ...((action === 'remove' || action === 'swap') && opts.cancelledProduct
                ? [{ type: 'remove', product: opts.cancelledProduct }]
                : []),
            ...((action === 'add' || action === 'swap') && opts.addedProduct
                ? [{
                        type: 'add',
                        product: opts.addedProduct,
                        qty: opts.qty,
                        price: opts.price, // ignored by executeOps, always from DB
                    }]
                : []),
        ], storeId, customerId, conversationId, tx);
    }
    /**
     * Backward-compatible getCartFromDb that delegates to CartAuthority.
     * If tx is provided, uses it for the read.
     */
    async getCartFromDb(conversationId, tx) {
        return await this.getCartAsConfirmedItems(conversationId, tx);
    }
    /**
     * Restore cart to a previous snapshot (ROLLBACK path).
     * Clears all existing OrderItem rows and re-adds items from the snapshot.
     * This ensures OrderItem rows, Order.items JSON, and confirmedItems JSON
     * all stay consistent after a rollback.
     *
     * Uses productId if available in snapshot; falls back to name resolution.
     */
    async restoreFromSnapshot(conversationId, storeId, customerId, snapshot) {
        await prisma.$transaction(async (tx) => {
            // 1. Clear existing cart (OrderItem rows, Order.items JSON, confirmedItems JSON)
            const order = await this.findDraftOrder(tx, conversationId);
            if (order) {
                await tx.orderItem.deleteMany({ where: { orderId: order.id } });
            }
            // 2. Re-add items from snapshot (resolve productId from name)
            const items = [];
            for (const item of snapshot) {
                const qty = typeof item.qty === 'number' ? item.qty : 1;
                if (qty < 1)
                    continue;
                const resolved = await this.resolveProductByName(tx, storeId, item.product);
                if (!resolved) {
                    adapters.logger.warn('CartAuthority: restore snapshot product not found, skipping', {
                        product: item.product,
                        storeId,
                        conversationId,
                    });
                    continue;
                }
                const { productId, productName, unitPrice } = resolved;
                const subtotal = unitPrice * qty;
                const newItem = await tx.orderItem.create({
                    data: {
                        orderId: order.id,
                        productId,
                        productName,
                        quantity: qty,
                        unitPrice,
                        subtotal,
                    },
                });
                items.push(newItem);
            }
            // 3. Sync Order.totalPrice + Order.items JSON + confirmedItems JSON
            const total = items.reduce((s, i) => s + Number(i.subtotal || 0), 0);
            if (order) {
                await tx.order.update({
                    where: { id: order.id },
                    data: {
                        totalPrice: total,
                        items: this.itemsToJson(items),
                    },
                });
            }
            const confirmedItems = this.orderItemsToConfirmedItems(items);
            await this.syncConfirmedItemsJson(tx, conversationId, confirmedItems);
            adapters.logger.info('CartAuthority: restored cart from snapshot', {
                conversationId,
                itemCount: items.length,
            });
        });
    }
    /**
     * Get cart as ConfirmedItem[] (backward compat for PipelineContext.cart).
     * Migrates from confirmedItems if no draft Order exists.
     */
    async getCartAsConfirmedItems(conversationId, tx) {
        const client = txOrGlobal(tx);
        let cartLines = await this.mapOrderItems(await client.orderItem.findMany({
            where: { order: { conversationId, orderStatus: 'draft', deletedAt: null } },
            orderBy: { createdAt: 'asc' },
        }));
        // If empty, try migration from legacy confirmedItems
        if (cartLines.length === 0) {
            const order = await client.order.findFirst({
                where: { conversationId, orderStatus: 'draft', deletedAt: null },
                select: { storeId: true, customerId: true },
            });
            if (order) {
                const legacy = await this.readLegacyConfirmedItems(conversationId);
                if (legacy.length > 0) {
                    await this.migrateFromConfirmedItems(conversationId, order.storeId, order.customerId, legacy);
                    cartLines = await this.getCart(conversationId);
                }
            }
        }
        return this.cartLinesToConfirmedItems(cartLines);
    }
    /**
     * Sync confirmedItems into conversationContext.extractedEntities JSON.
     * Backward-compat: existing tests and readers still read from confirmedItems
     * in extractedEntities. This keeps both in sync atomically within the tx.
     */
    async syncConfirmedItemsJson(tx, conversationId, confirmedItems) {
        // Merge: preserve other extractedEntities fields, update confirmedItems
        const ctxRow = await tx.conversationContext.findUnique({
            where: { conversationId },
            select: { extractedEntities: true },
        });
        // If ConversationContext doesn't exist, skip — it will be created
        // by conversationContextService.initializeContext in the normal flow.
        // Backward-compat sync only applies when the context already exists.
        if (!ctxRow) {
            return;
        }
        const existing = ctxRow?.extractedEntities && typeof ctxRow.extractedEntities === 'object'
            ? ctxRow.extractedEntities
            : {};
        existing.confirmedItems = confirmedItems;
        await tx.conversationContext.updateMany({
            where: { conversationId },
            data: {
                extractedEntities: existing,
            },
        });
    }
    /**
     * Find the conversation's draft order. Returns null if not found.
     */
    async findDraftOrder(tx, conversationId) {
        return await tx.order.findFirst({
            where: {
                conversationId,
                orderStatus: 'draft',
                deletedAt: null,
            },
        });
    }
    /**
     * Find-or-create draft order for a conversation. Creates if absent.
     */
    async findOrCreateDraftOrder(tx, conversationId, storeId, customerId) {
        const existing = await this.findDraftOrder(tx, conversationId);
        if (existing)
            return existing;
        return await this.createDraftOrder(tx, conversationId, storeId, customerId);
    }
    async createDraftOrder(tx, conversationId, storeId, customerId) {
        return await tx.order.create({
            data: {
                storeId,
                conversationId,
                customerId,
                items: [],
                totalPrice: 0,
                currency: 'IDR',
                orderStatus: 'draft',
                confirmedAt: null,
            },
        });
    }
    /**
     * Resolve a product name (from LLM) to productId + unitPrice via DB.
     *
     * Resolution order:
     * 1. Exact case-insensitive name match → deterministic, returns single result
     * 2. Substring `contains` match → count candidates:
     *    - 0 candidates → return null (not found)
     *    - 1 candidate → return it
     *    - >1 candidates → throw ProductAmbiguousError (DO NOT pick arbitrarily)
     *
     * `tx` can be null (standalone query) — used during migration.
     * StoreId is ALWAYS used as a filter (tenant isolation).
     */
    /**
     * Resolve a product by its authoritative productId (structured/validated path).
     *
     * Tenant-isolated: filters by storeId, enforces isActive + not deleted.
     * Used when a CartOp carries `productId` directly so we skip the
     * name-based round-trip (resolveProductByName). Returns null when the
     * product is missing / not accessible, mirroring resolveProductForCart.
     */
    async resolveProductById(tx, storeId, productId) {
        const client = tx ?? prisma;
        const product = await client.product.findUnique({
            where: { id: productId },
            select: { id: true, name: true, price: true, storeId: true, isActive: true, deletedAt: true },
        });
        if (!product)
            return null;
        if (product.storeId !== storeId)
            return null;
        if (!product.isActive || product.deletedAt)
            return null;
        return {
            productId: product.id,
            productName: product.name,
            unitPrice: product.price,
        };
    }
    /**
     * PV-P1/PV-P2 — SATU helper terpusat untuk resolve price + stock dari cart line.
     *
     * Aturan:
     * - variantId != null  → BACA DARI ProductVariant (price + stock). Product.price/
     *   Product.stock TIDAK PERNAH dipakai untuk baris ini. Variant divalidasi
     *   milik productId yang benar & aktif; kalau tidak valid → throw (sama perilaku
     *   product tidak ditemukan).
     * - variantId == null  → BACA DARI Product seperti sebelum task ini.
     *   PV-P2: kalau product.hasVariants === true → throw VARIANT_REQUIRED.
     *   Single authority untuk guard ini ada di sini (sesuai kontrak §2.3/§6A.1).
     *   Handler-layer guard di action-registry.ts tetap ada sebagai defense-in-depth.
     *
     * Semua titik yang butuh price/stock (addLine, executeOps, checkout) WAJIB pakai
     * helper ini — jangan duplikasi logika.
     */
    async resolvePriceAndStock(productId, variantId, tx) {
        const client = tx ?? prisma;
        const product = await client.product.findUnique({
            where: { id: productId },
            select: { id: true, price: true, stock: true, isActive: true, deletedAt: true, storeId: true, hasVariants: true },
        });
        if (!product || product.storeId === undefined) {
            const err = new Error('Product not found or not accessible');
            err.code = 'PRODUCT_NOT_FOUND';
            err.name = 'CartInvariantError';
            throw err;
        }
        if (!product.isActive || product.deletedAt) {
            const err = new Error('Product not found or not accessible');
            err.code = 'PRODUCT_NOT_FOUND';
            err.name = 'CartInvariantError';
            throw err;
        }
        // PV-P2: single-authority guard — produk dengan varian WAJIB pilih variant.
        // Hasil: WA path (executeWaCartMutation) TIDAK BISA bypass validasi ini.
        if (product.hasVariants && !variantId) {
            throw new CartInvariantError(`Product ${productId} requires a variantId — hasVariants=true but variantId is missing`, ErrorCodes.VARIANT_REQUIRED);
        }
        if (variantId) {
            const variant = await client.productVariant.findUnique({ where: { id: variantId } });
            if (!variant || variant.productId !== productId || !variant.isActive) {
                throw new CartInvariantError(`Product variant ${variantId} is not valid for product ${productId}`, 'VARIANT_INVALID');
            }
            // Parent product isActive/deletedAt checked above.
            return { price: variant.price, stock: variant.stock };
        }
        return { price: product.price, stock: product.stock };
    }
    /**
     * PV-P2c-LLM-B Bagian 1.2 — Resolve a free-text variant label (warna/ukuran,
     * mis. "merah", "merah size L") ke variantId — DETERMINISTIK dari data DB
     * (ProductVariant.attributes + sku), bukan LLM/embedding (I13).
     *
     * Strategi (mengikuti pola resolveProductByName: exact → substring):
     *   1. Exact     : variantText sama persis (case-insensitive) dengan salah
     *                  satu attribute VALUE atau sku.
     *   2. Substring : semua token variantText ada di "label token" variant
     *                  (gabungan attribute key + value + sku, lowercased,
     *                  dipecah non-word boundary).
     * - 1 kandidat (exact atau substring) → kembalikan variantId.
     * - >1 kandidat (ambiguous) → kembalikan null (JANGAN throw).
     * - 0 kandidat (no match) → kembalikan null.
     *
     * null (tidak ter-resolve) disengaja dibiarkan: resolvePriceAndStock — yang
     * sudah ada & battle-tested — akan melempar CartInvariantError VARIANT_REQUIRED
     * untuk product.hasVariants. Dengan demikian ada SATU error surface yang
     * konsisten (tidak 2 pesan error berbeda untuk kasus yang sama).
     */
    async resolveVariantByLabel(tx, storeId, productId, variantText) {
        const client = tx ?? prisma;
        const q = (variantText || '').toLowerCase().trim();
        if (!q)
            return null;
        const variants = await client.productVariant.findMany({
            where: { productId, storeId, isActive: true },
            select: { id: true, sku: true, attributes: true },
        });
        if (variants.length === 0)
            return null;
        const qTokens = q.split(/\W+/).filter(Boolean);
        const exact = [];
        const substring = [];
        for (const v of variants) {
            const attr = v.attributes;
            const values = [];
            const tokens = [];
            if (attr && typeof attr === 'object' && !Array.isArray(attr)) {
                for (const [key, val] of Object.entries(attr)) {
                    if (val === null || val === undefined)
                        continue;
                    const vstr = String(val).toLowerCase();
                    values.push(vstr);
                    for (const t of vstr.split(/\W+/).filter(Boolean))
                        tokens.push(t);
                    // termasuk key sebagai token supaya "size L" bisa match key "size"
                    tokens.push(key.toLowerCase());
                }
            }
            if (v.sku) {
                const s = v.sku.toLowerCase();
                values.push(s);
                for (const t of s.split(/\W+/).filter(Boolean))
                    tokens.push(t);
            }
            if (values.length === 0 && tokens.length === 0)
                continue;
            // 1. Exact: variantText sama persis dengan attribute value / sku
            if (values.some((vv) => vv === q)) {
                exact.push(v.id);
                continue;
            }
            // 2. Substring: semua token variantText ada di label token variant
            if (qTokens.length > 0 && qTokens.every((t) => tokens.includes(t))) {
                substring.push(v.id);
            }
        }
        if (exact.length === 1)
            return exact[0];
        if (exact.length > 1)
            return null; // ambiguous pada level exact
        if (substring.length === 1)
            return substring[0];
        return null; // 0 (no match) atau >1 (ambiguous) pada level substring
    }
    async resolveProductByName(tx, storeId, productName) {
        const client = tx ?? prisma;
        const normalized = productName.trim().toLowerCase();
        // 1. Exact name match (case-insensitive) — deterministic, no fuzzy
        const exactRow = await client.product.findFirst({
            where: {
                storeId,
                deletedAt: null,
                isActive: true,
                name: { equals: normalized, mode: 'insensitive' },
            },
            select: { id: true, name: true, price: true, stock: true },
        });
        if (exactRow) {
            return {
                productId: exactRow.id,
                productName: exactRow.name,
                unitPrice: exactRow.price,
            };
        }
        // 2. Substring fallback — must check for ambiguity
        const fallbackRows = await client.product.findMany({
            where: {
                storeId,
                deletedAt: null,
                isActive: true,
                name: { contains: normalized, mode: 'insensitive' },
            },
            select: { id: true, name: true, price: true, stock: true },
            orderBy: { createdAt: 'desc' },
        });
        if (fallbackRows.length === 0) {
            return null; // Clear: not found, 0 candidates
        }
        if (fallbackRows.length === 1) {
            const r = fallbackRows[0];
            return {
                productId: r.id,
                productName: r.name,
                unitPrice: r.price,
            };
        }
        // >1 candidate → must NOT pick arbitrarily
        throw new ProductAmbiguousError(productName, fallbackRows.map((r) => r.name));
    }
    /**
     * Compute total price from OrderItem rows.
     */
    async computeTotal(tx, orderId) {
        const result = await tx.orderItem.aggregate({
            where: { orderId },
            _sum: { subtotal: true },
        });
        return Number(result._sum?.subtotal ?? 0);
    }
    /**
     * Export OrderItem rows to JSON array for Order.items field (backward compat).
     */
    async exportItemsJson(tx, orderId) {
        const items = await tx.orderItem.findMany({ where: { orderId } });
        return this.itemsToJson(items);
    }
    /** Convert OrderItem rows to JSON-compatible array for Order.items field. */
    itemsToJson(items) {
        return items.map((i) => ({
            product: i.productName,
            qty: i.quantity,
            price: i.unitPrice,
            productItemId: i.id,
            productId: i.productId,
            // PV-P1: carry variantId so downstream consumers can distinguish variants
            // of the same product (null = no variant).
            variantId: i.variantId ?? null,
        }));
    }
    /** Map OrderItem rows to CartLine[]. */
    mapOrderItems(items) {
        return items.map((i) => ({
            id: i.id,
            productId: i.productId ?? null,
            variantId: i.variantId ?? null,
            productName: i.productName,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            subtotal: i.quantity * i.unitPrice,
        }));
    }
    /** Convert CartLine[] to ConfirmedItem[] (backward compat for PipelineContext). */
    cartLinesToConfirmedItems(lines) {
        return lines.map((l) => ({
            product: l.productName,
            qty: l.quantity,
            price: l.unitPrice,
            variantId: l.variantId ?? null,
            mentionedAt: new Date().toISOString(),
            confirmedAt: new Date().toISOString(),
        }));
    }
    /** Convert OrderItem rows directly to ConfirmedItem[]. */
    orderItemsToConfirmedItems(items) {
        return items.map((i) => ({
            id: i.id ?? null,
            product: i.productName,
            qty: i.quantity,
            price: i.unitPrice,
            variantId: i.variantId ?? null,
            mentionedAt: new Date().toISOString() ?? '',
            confirmedAt: new Date().toISOString() ?? '',
        }));
    }
    /** Read legacy confirmedItems from extractedEntities JSON (migration source). */
    async readLegacyConfirmedItems(conversationId) {
        try {
            const ctxRow = await prisma.conversationContext.findUnique({
                where: { conversationId },
                select: { extractedEntities: true },
            });
            if (!ctxRow?.extractedEntities)
                return [];
            const raw = ctxRow.extractedEntities;
            if (Array.isArray(raw))
                return []; // legacy array format (toleransi per G2-B)
            const items = raw.confirmedItems;
            if (!Array.isArray(items))
                return [];
            return items;
        }
        catch {
            return [];
        }
    }
}
// ── Singleton ────────────────────────────────────────────────────────────────
export const cartAuthority = new CartAuthority();
//# sourceMappingURL=cart-authority.js.map