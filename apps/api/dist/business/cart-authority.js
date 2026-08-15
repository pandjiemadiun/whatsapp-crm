import { prisma } from '../infrastructure/prisma.js';
import { adapters } from '../adapters/container.js';
import { productService } from './product.service.js';
import { transitionOrder } from './order-transition.js';
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
        return { items, total };
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
    async addLine(conversationId, storeId, customerId, productId, qty = 1) {
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
        // Price from DB (authoritative — ignore any caller-provided price)
        const unitPrice = product.price;
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
            // Find existing OrderItem for this productId
            const existingItem = await tx.orderItem.findFirst({
                where: {
                    orderId: order.id,
                    productId: productId,
                },
            });
            // Stock check: existing qty in cart + new qty must not exceed stock
            const existingQty = existingItem ? Number(existingItem.quantity) : 0;
            if (freshProduct.stock !== null && freshProduct.stock < existingQty + newQty) {
                throw new CartInvariantError(`Insufficient stock for ${freshProduct.name}: ${freshProduct.stock} available, ${existingQty + newQty} needed`, 'INSUFFICIENT_STOCK');
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
    async removeLine(conversationId, lineItemId) {
        return await prisma.$transaction(async (tx) => {
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
        });
    }
    /**
     * Update quantity of a line item. qty = 0 deletes the line item.
     * Invariant: quantity >= 0; line item belongs to cart.
     */
    async updateQuantity(conversationId, lineItemId, qty) {
        if (qty < 0) {
            throw new CartInvariantError('Quantity must be >= 0', 'INVALID_QUANTITY');
        }
        return await prisma.$transaction(async (tx) => {
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
        });
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
     * Stock invariant:
     *   Cart is NOT a stock reservation — it is a soft-check workspace.
     *   The FINAL stock invariant is enforced HERE at the cart→order boundary
     *   (cart→order transition). If any line item exceeds available stock
     *   at checkout time, throw CartInvariantError(InsufficientStock).
     *
     *   Cart-level stock checks (addLine/executeOps) are best-effort for UX
     *   feedback only. Two concurrent cart adds MAY both pass the soft check
     *   but only the first checkout will succeed if stock is constrained.
     *
     *   Full stock reservation (lock rows) is NOT implemented — would require
     *   G2-C+ reservation architecture. See ledger G2-C-L-016.
     */
    async checkout(conversationId, storeId) {
        const order = await prisma.order.findFirst({
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
        // FINAL stock invariant at cart→order boundary
        // Validates every line item's quantity against current DB stock
        for (const item of order.orderItems) {
            if (!item.productId)
                continue; // skip items with no product (product was deleted)
            const product = await productService.getProductById(item.productId);
            if (!product.isActive || product.deletedAt) {
                throw new CartInvariantError(`Product "${product.name}" is no longer available`, 'PRODUCT_INACTIVE');
            }
            if (product.stock !== null && product.stock < item.quantity) {
                throw new CartInvariantError(`Insufficient stock for "${product.name}": ${product.stock} available, ${item.quantity} in cart`, 'INSUFFICIENT_STOCK');
            }
        }
        // Delegate to state machine (G2-B.6)
        // transitionOrder validates ALLOWED_TRANSITIONS (draft → waiting_address ✓)
        // and sets confirmedAt on confirmed/paid transitions (not applicable here)
        await transitionOrder(order.id, 'waiting_address', { actor: 'system' });
        // Clear confirmedItems JSON — cart state is now committed to the Order
        // (OrderItem rows are immutable snapshot; confirmedItems was cart scratchpad)
        await this.syncConfirmedItemsJson(prisma, conversationId, []);
        return order.id;
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
                // Resolve product name → productId for both add and remove
                let result;
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
                    const { productId, productName, unitPrice } = result;
                    const qty = op.qty && op.qty >= 1 ? Math.floor(op.qty) : 1;
                    // Stock check: existing qty in cart + new qty must not exceed stock
                    const existing = items.find((i) => i.productId === productId);
                    const existingQty = existing ? Number(existing.quantity) : 0;
                    const product = await productService.getProductById(productId);
                    if (product.stock !== null && product.stock < existingQty + qty) {
                        adapters.logger.warn('CartAuthority: insufficient stock, skipping', {
                            product: productName,
                            requested: qty,
                            inCart: existingQty,
                            available: product.stock,
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
                                unitPrice: unitPrice,
                                subtotal: unitPrice * newQty,
                            },
                        });
                        // Update items array
                        items = items.map((i) => i.id === existing.id
                            ? { ...i, quantity: newQty, unitPrice, subtotal: unitPrice * newQty }
                            : i);
                    }
                    else {
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
                        items = [...items, newItem];
                    }
                }
                else if (op.type === 'remove') {
                    if (result) {
                        const toRemove = items.filter((i) => i.productId === result.productId);
                        for (const ri of toRemove) {
                            await tx.orderItem.delete({ where: { id: ri.id } });
                        }
                        items = items.filter((i) => i.productId !== result.productId);
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
            // Return as ConfirmedItem[] (backward compat)
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
        }));
    }
    /** Map OrderItem rows to CartLine[]. */
    mapOrderItems(items) {
        return items.map((i) => ({
            id: i.id,
            productId: i.productId ?? null,
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
            mentionedAt: new Date().toISOString(),
            confirmedAt: new Date().toISOString(),
        }));
    }
    /** Convert OrderItem rows directly to ConfirmedItem[]. */
    orderItemsToConfirmedItems(items) {
        return items.map((i) => ({
            product: i.productName,
            qty: i.quantity,
            price: i.unitPrice,
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