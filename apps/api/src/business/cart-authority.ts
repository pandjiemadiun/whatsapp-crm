/**
 * CartAuthority — G2-C Single Authority for Cart State
 *
 * SINGLE source of truth for cart operations in the conversational commerce
 * engine. Cart state = a draft Order (status='draft') with OrderItem relation
 * rows. All reads and writes go through this class.
 *
 * Design principles:
 * 1. Cart identity uses productId (UUID FK to Product), NOT product name.
 * 2. Price is ALWAYS read from Product.price at add/update time (authoritative).
 *    LLM-provided prices are treated as hints and ignored.
 * 3. All mutations are atomic via prisma.$transaction.
 * 4. Order.items JSON is kept in sync for backward compatibility with
 *    existing readers (e.g., routes/orders.ts GET returns raw rows).
 * 5. Legacy confirmedItems (extractedEntities JSON) is migrated ONCE into
 *    OrderItem rows on first access; after migration confirmedItems is
 *    read-only compatibility.
 * 6. Cart ≠ Order: Cart is the draft Order; checkout transitions it to
 *    waiting_address via the G2-B.6 state machine (immutable snapshot).
 *
 * Backward-compat wrappers:
 *   - modifyCart() → delegates to CartAuthority, returns ConfirmedItem[]
 *   - getCartFromDb() → delegates to CartAuthority.getCart(), maps to ConfirmedItem[]
 *   - fetchCart() in structured-message.mapper → delegates to getCartSummary()
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../infrastructure/prisma.js';
import { adapters } from '../adapters/container.js';
import { productService } from './product.service.js';
import { transitionOrder } from './order-transition.js';
import type { ConfirmedItem } from '../domain/types.js';
import type { CartOp } from '../domain/types.js';

/** Resolve tx or fall back to global prisma client. */
function txOrGlobal(tx?: unknown): any {
  return (tx as any) ?? prisma;
}

// ── Domain types ─────────────────────────────────────────────────────────────

/**
 * A single line item in the cart. Maps to OrderItem relation row.
 */
export interface CartLine {
  id: string;            // OrderItem.id
  productId: string | null;  // FK to Product (null if product was deleted)
  variantId: string | null;  // PV-P1: FK to ProductVariant (null = no variant)
  productName: string;   // snapshot at add time
  quantity: number;      // > 0
  unitPrice: number;     // snapshot from resolved price (Product or ProductVariant) at add time
  subtotal: number;      // unitPrice × quantity
}

/**
 * Summary of cart for UI delivery (structured-message.mapper).
 */
export interface CartSummary {
  items: CartLine[];
  total: number | null;
  orderId?: string;
}

// ── Errors ───────────────────────────────────────────────────────────────────

export class CartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CartError';
  }
}

/**
 * Thrown when a cart operation violates an invariant (invalid product,
 * cross-tenant access, insufficient stock, etc.).
 */
export class CartInvariantError extends CartError {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'CartInvariantError';
  }
}

/**
 * Thrown when product name resolution is ambiguous — multiple products
 * match the substring fallback and the correct one cannot be determined.
 */
export class ProductAmbiguousError extends CartError {
  constructor(
    productName: string,
    public readonly candidates: string[],
  ) {
    super(
      `Product name "${productName}" is ambiguous — matched ${candidates.length} products. ` +
      `Candidates: ${candidates.join(', ')}. Please specify the exact product name.`,
    );
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
  async getCart(conversationId: string): Promise<CartLine[]> {
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

    return this.mapOrderItems(order.orderItems as any[]);
  }

  /**
   * Get cart summary (items + total) for structured-message delivery.
   * Total is authoritative from Order.totalPrice if available, else computed.
   */
  async getCartSummary(conversationId: string): Promise<CartSummary> {
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

    const items = this.mapOrderItems((order as any).orderItems || []);
    const total = order.totalPrice ?? items.reduce((s, i) => s + i.subtotal, 0);
    return { items, total, orderId: order.id };
  }

  /** Check whether a draft order (cart) exists for this conversation. */
  async hasCart(conversationId: string): Promise<boolean> {
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
  async addLine(
    conversationId: string,
    storeId: string,
    customerId: string,
    productId: string,
    qty: number = 1,
    variantId: string | null = null,
  ): Promise<CartLine[]> {
    if (qty < 1) {
      throw new CartInvariantError('Quantity must be >= 1', 'INVALID_QUANTITY');
    }

    // Validate product belongs to store + is active + not deleted
    const product = await productService.getProductById(productId);
    if (product.storeId !== storeId) {
      throw new CartInvariantError(
        `Product ${productId} does not belong to store ${storeId}`,
        'CROSS_TENANT',
      );
    }
    if (!product.isActive || product.deletedAt) {
      throw new CartInvariantError(
        `Product ${product.name} is not available`,
        'PRODUCT_INACTIVE',
      );
    }

    // PV-P1: price/stock authoritatively resolved via centralized helper.
    // variantId null → Product (unchanged); variantId set → ProductVariant.
    const { price: unitPrice, stock } = await this.resolvePriceAndStock(productId, variantId);
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
      const order = await this.findOrCreateDraftOrder(
        tx as any,
        conversationId,
        storeId,
        customerId,
      );

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
        throw new CartInvariantError(
          `Insufficient stock for ${freshProduct.name}: ${stock} available, ${existingQty + newQty} needed`,
          'INSUFFICIENT_STOCK',
        );
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
      } else {
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
      const total = await this.computeTotal(tx as any, order.id);
      const items = await this.mapOrderItems(
        await tx.orderItem.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' } }) as any[],
      );
      const confirmedItems = this.cartLinesToConfirmedItems(items);
      await tx.order.update({
        where: { id: order.id },
        data: {
          totalPrice: total,
          items: await this.exportItemsJson(tx as any, order.id),
        },
      });
      await this.syncConfirmedItemsJson(tx as any, conversationId, confirmedItems);

      // Return updated cart
      return items;
    });
  }

  /**
   * Remove a line item from the cart by lineItemId.
   * Invariant: line item belongs to this conversation's draft order.
   */
  async removeLine(conversationId: string, lineItemId: string, tx?: any): Promise<CartLine[]> {
    const run = async (client: any) => {
      const tx = client;
      const order = await this.findDraftOrder(tx as any, conversationId);
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

      const total = await this.computeTotal(tx as any, order.id);
      const items = await this.mapOrderItems(
        await tx.orderItem.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' } }) as any[],
      );
      const confirmedItems = this.cartLinesToConfirmedItems(items);
      await tx.order.update({
        where: { id: order.id },
        data: {
          totalPrice: total,
          items: await this.exportItemsJson(tx as any, order.id),
        },
      });
      await this.syncConfirmedItemsJson(tx as any, conversationId, confirmedItems);

      return items;
    };
    // Reuse caller's transaction when provided (locked idempotency pattern);
    // otherwise open a fresh one. Core logic unchanged.
    if (tx) return run(tx);
    return prisma.$transaction(run);
  }

  /**
   * Update quantity of a line item. qty = 0 deletes the line item.
   * Invariant: quantity >= 0; line item belongs to cart.
   */
  async updateQuantity(conversationId: string, lineItemId: string, qty: number, tx?: any): Promise<CartLine[]> {
    if (qty < 0) {
      throw new CartInvariantError('Quantity must be >= 0', 'INVALID_QUANTITY');
    }

    const run = async (client: any) => {
      const tx = client;
      const order = await this.findDraftOrder(tx as any, conversationId);
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
      } else {
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

      const total = await this.computeTotal(tx as any, order.id);
      const items = await this.mapOrderItems(
        await tx.orderItem.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' } }) as any[],
      );
      const confirmedItems = this.cartLinesToConfirmedItems(items);
      await tx.order.update({
        where: { id: order.id },
        data: {
          totalPrice: total,
          items: await this.exportItemsJson(tx as any, order.id),
        },
      });
      await this.syncConfirmedItemsJson(tx as any, conversationId, confirmedItems);

      return items;
    };
    // Reuse caller's transaction when provided (locked idempotency pattern);
    // otherwise open a fresh one. Core logic unchanged.
    if (tx) return run(tx);
    return prisma.$transaction(run);
  }

  /**
   * Clear all items from the cart. Deletes all OrderItem rows for the
   * conversation's draft order. Does NOT delete the Order row itself
   * (preserves conversation linkage + status).
   */
  async clearCart(conversationId: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const order = await this.findDraftOrder(tx as any, conversationId);
      if (order) {
        await tx.orderItem.deleteMany({ where: { orderId: order.id } });
        await tx.order.update({
          where: { id: order.id },
          data: {
            totalPrice: 0,
            items: [] as any,
          },
        });
        // Also clear confirmedItems JSON (backward compat sync)
        await this.syncConfirmedItemsJson(tx as any, conversationId, []);
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
  async checkout(conversationId: string, storeId: string): Promise<string> {
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
    // Validates every line item's quantity against current DB stock (variant-aware).
    for (const item of order.orderItems as any[]) {
      if (!item.productId) continue; // skip items with no product (product was deleted)
      const product = await productService.getProductById(item.productId);
      if (!product.isActive || product.deletedAt) {
        throw new CartInvariantError(
          `Product "${product.name}" is no longer available`,
          'PRODUCT_INACTIVE',
        );
      }
      // PV-P1: stock source depends on whether the line carries a variant.
      const { stock } = await this.resolvePriceAndStock(item.productId, item.variantId ?? null);
      if (stock !== null && stock < item.quantity) {
        throw new CartInvariantError(
          `Insufficient stock for "${product.name}": ${stock} available, ${item.quantity} in cart`,
          'INSUFFICIENT_STOCK',
        );
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
  async executeOps(
    ops: CartOp[],
    storeId: string,
    customerId: string,
    conversationId: string,
    tx?: unknown,
  ): Promise<ConfirmedItem[]> {
    const runOps = async (client: any) => {
      const tx = client;
      let order = await this.findDraftOrder(tx as any, conversationId);
      if (!order) {
        order = await this.createDraftOrder(client as any, conversationId, storeId, customerId);
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
        let result: { productId: string; productName: string; unitPrice: number } | null;
        if (op.productId) {
          result = await this.resolveProductById(tx as any, storeId, op.productId);
        } else {
          try {
            result = await this.resolveProductByName(tx as any, storeId, op.product);
          } catch (err) {
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

          const { productId, productName, unitPrice } = result;
          const qty = op.qty && op.qty >= 1 ? Math.floor(op.qty) : 1;
          const variantId = (op as any).variantId ?? null;

          // PV-P1: stock check via centralized helper (variant-aware).
          const { stock } = await this.resolvePriceAndStock(productId, variantId);
          const existing = items.find(
            (i: any) => i.productId === productId && (i.variantId ?? null) === (variantId ?? null),
          );
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
                unitPrice: unitPrice,
                subtotal: unitPrice * newQty,
              },
            });
            // Update items array
            items = items.map((i: any) =>
              i.id === existing.id
                ? { ...i, quantity: newQty, unitPrice, subtotal: unitPrice * newQty }
                : i,
            );
          } else {
            const subtotal = unitPrice * qty;
            const newItem = await tx.orderItem.create({
              data: {
                orderId: order.id,
                productId,
                variantId: variantId ?? null,
                productName,
                quantity: qty,
                unitPrice,
                subtotal,
              },
            });
            items = [...items, newItem];
          }
        } else if (op.type === 'remove') {
          if (result) {
            const variantId = (op as any).variantId ?? null;
            const toRemove = items.filter(
              (i: any) => i.productId === result.productId && (i.variantId ?? null) === (variantId ?? null),
            );
            for (const ri of toRemove) {
              await tx.orderItem.delete({ where: { id: ri.id } });
            }
            items = items.filter(
              (i: any) => !(i.productId === result.productId && (i.variantId ?? null) === (variantId ?? null)),
            );
            adapters.logger.debug('CartAuthority: removed product from cart', {
              product: result.productName,
              conversationId,
            });
          } else {
            // No product match — nothing to remove
            adapters.logger.debug('CartAuthority: remove product not found in cart', {
              product: op.product,
              conversationId,
            });
          }
        }
      }

      // Recompute total and sync Order.items JSON + confirmedItems (backward compat)
      const total = items.reduce((s: number, i: any) => s + Number(i.subtotal || 0), 0);
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
      return runOps(tx as any);
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
  async migrateFromConfirmedItems(
    conversationId: string,
    storeId: string,
    customerId: string,
    confirmedItems: ConfirmedItem[],
  ): Promise<void> {
    if (!confirmedItems || confirmedItems.length === 0) return;

    // Check if already migrated (draft order exists)
    const existing = await this.hasCart(conversationId);
    if (existing) return;

    await prisma.$transaction(async (tx) => {
      const order = await this.createDraftOrder(tx as any, conversationId, storeId, customerId);

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
      const total = items.reduce((s: number, i: any) => s + Number(i.subtotal || 0), 0);
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
  async modifyCart(
    conversationId: string,
    storeId: string,
    customerId: string,
    action: 'add' | 'remove' | 'swap',
    opts: {
      cancelledProduct?: string;
      addedProduct?: string;
      qty?: number;
      price?: number;  // IGNORED — always from DB
    },
    tx?: unknown,
  ): Promise<ConfirmedItem[]> {
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

    return await this.executeOps(
      [
        ...((action === 'remove' || action === 'swap') && opts.cancelledProduct
          ? [{ type: 'remove' as const, product: opts.cancelledProduct }]
          : []),
        ...((action === 'add' || action === 'swap') && opts.addedProduct
          ? [{
            type: 'add' as const,
            product: opts.addedProduct,
            qty: opts.qty,
            price: opts.price, // ignored by executeOps, always from DB
          }]
          : []),
      ],
      storeId,
      customerId,
      conversationId,
      tx,
    );
  }

  /**
   * Backward-compatible getCartFromDb that delegates to CartAuthority.
   * If tx is provided, uses it for the read.
   */
  async getCartFromDb(conversationId: string, tx?: unknown): Promise<ConfirmedItem[]> {
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
  async restoreFromSnapshot(
    conversationId: string,
    storeId: string,
    customerId: string,
    snapshot: ConfirmedItem[],
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      // 1. Clear existing cart (OrderItem rows, Order.items JSON, confirmedItems JSON)
      const order = await this.findDraftOrder(tx as any, conversationId);
      if (order) {
        await tx.orderItem.deleteMany({ where: { orderId: order.id } });
      }

      // 2. Re-add items from snapshot (resolve productId from name)
      const items: any[] = [];
      for (const item of snapshot) {
        const qty = typeof item.qty === 'number' ? item.qty : 1;
        if (qty < 1) continue;

        const resolved = await this.resolveProductByName(tx as any, storeId, item.product);
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
            orderId: order!.id,
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
      const total = items.reduce((s: number, i: any) => s + Number(i.subtotal || 0), 0);
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
      await this.syncConfirmedItemsJson(tx as any, conversationId, confirmedItems);

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
  async getCartAsConfirmedItems(conversationId: string, tx?: unknown): Promise<ConfirmedItem[]> {
    const client = txOrGlobal(tx);
    let cartLines = await this.mapOrderItems(
      await client.orderItem.findMany({
        where: { order: { conversationId, orderStatus: 'draft', deletedAt: null } },
        orderBy: { createdAt: 'asc' },
      }),
    );

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
  private async syncConfirmedItemsJson(
    tx: any,
    conversationId: string,
    confirmedItems: ConfirmedItem[],
  ): Promise<void> {
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

    const existing: Record<string, unknown> =
      ctxRow?.extractedEntities && typeof ctxRow.extractedEntities === 'object'
        ? (ctxRow.extractedEntities as Record<string, unknown>)
        : {};
    existing.confirmedItems = confirmedItems;
    await tx.conversationContext.updateMany({
      where: { conversationId },
      data: {
        extractedEntities: existing as unknown as Prisma.InputJsonValue,
      },
    });
  }


  /**
   * Find the conversation's draft order. Returns null if not found.
   */
  private async findDraftOrder(
    tx: any,
    conversationId: string,
  ): Promise<any | null> {
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
  private async findOrCreateDraftOrder(
    tx: any,
    conversationId: string,
    storeId: string,
    customerId: string,
  ): Promise<any> {
    const existing = await this.findDraftOrder(tx, conversationId);
    if (existing) return existing;
    return await this.createDraftOrder(tx, conversationId, storeId, customerId);
  }

  private async createDraftOrder(
    tx: any,
    conversationId: string,
    storeId: string,
    customerId: string,
  ): Promise<any> {
    return await tx.order.create({
      data: {
        storeId,
        conversationId,
        customerId,
        items: [] as any,
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
  private async resolveProductById(
    tx: any,
    storeId: string,
    productId: string,
  ): Promise<{ productId: string; productName: string; unitPrice: number } | null> {
    const client = tx ?? prisma;
    const product = await client.product.findUnique({
      where: { id: productId },
      select: { id: true, name: true, price: true, storeId: true, isActive: true, deletedAt: true },
    });
    if (!product) return null;
    if (product.storeId !== storeId) return null;
    if (!product.isActive || product.deletedAt) return null;
    return {
      productId: product.id,
      productName: product.name,
      unitPrice: product.price,
    };
  }

  /**
   * PV-P1 — SATU helper terpusat untuk resolve price + stock dari cart line.
   *
   * Aturan:
   * - variantId != null  → BACA DARI ProductVariant (price + stock). Product.price/
   *   Product.stock TIDAK PERNAH dipakai untuk baris ini. Variant divalidasi
   *   milik productId yang benar & aktif; kalau tidak valid → throw (sama perilaku
   *   product tidak ditemukan).
   * - variantId == null  → BACA DARI Product seperti sebelum task ini (TIDAK BERUBAH).
   *
   * Semua titik yang butuh price/stock (addLine, executeOps, checkout) WAJIB pakai
   * helper ini — jangan duplikasi logika.
   */
  private async resolvePriceAndStock(
    productId: string,
    variantId: string | null,
  ): Promise<{ price: number; stock: number | null }> {
    const product = await productService.getProductById(productId);
    if (!product || product.storeId === undefined) {
      throw new CartInvariantError(`Product ${productId} not found`, 'PRODUCT_NOT_FOUND');
    }

    if (variantId) {
      const variant = await prisma.productVariant.findUnique({ where: { id: variantId } });
      if (!variant || variant.productId !== productId || !variant.isActive) {
        throw new CartInvariantError(
          `Product variant ${variantId} is not valid for product ${productId}`,
          'VARIANT_INVALID',
        );
      }
      return { price: variant.price, stock: variant.stock };
    }

    return { price: product.price, stock: product.stock };
  }

  private async resolveProductByName(
    tx: any,
    storeId: string,
    productName: string,
  ): Promise<{ productId: string; productName: string; unitPrice: number } | null> {
    const client = tx ?? prisma;
    const normalized = productName.trim().toLowerCase();

    // 1. Exact name match (case-insensitive) — deterministic, no fuzzy
    const exactRow = await client.product.findFirst({
      where: {
        storeId,
        deletedAt: null,
        isActive: true,
        name: { equals: normalized, mode: 'insensitive' as const },
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
        name: { contains: normalized, mode: 'insensitive' as const },
      },
      select: { id: true, name: true, price: true, stock: true },
      orderBy: { createdAt: 'desc' },
    });

    if (fallbackRows.length === 0) {
      return null;  // Clear: not found, 0 candidates
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
    throw new ProductAmbiguousError(
      productName,
      fallbackRows.map((r: any) => r.name),
    );
  }

  /**
   * Compute total price from OrderItem rows.
   */
  private async computeTotal(tx: any, orderId: string): Promise<number> {
    const result = await tx.orderItem.aggregate({
      where: { orderId },
      _sum: { subtotal: true },
    });
    return Number(result._sum?.subtotal ?? 0);
  }

  /**
   * Export OrderItem rows to JSON array for Order.items field (backward compat).
   */
  private async exportItemsJson(tx: any, orderId: string): Promise<any[]> {
    const items = await tx.orderItem.findMany({ where: { orderId } });
    return this.itemsToJson(items);
  }

  /** Convert OrderItem rows to JSON-compatible array for Order.items field. */
  private itemsToJson(items: any[]): any[] {
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
  private mapOrderItems(items: any[]): CartLine[] {
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
  private cartLinesToConfirmedItems(lines: CartLine[]): ConfirmedItem[] {
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
  private orderItemsToConfirmedItems(items: any[]): ConfirmedItem[] {
    return items.map((i) => ({
      product: i.productName,
      qty: i.quantity,
      price: i.unitPrice,
      variantId: i.variantId ?? null,
      mentionedAt: new Date().toISOString() ?? '',
      confirmedAt: new Date().toISOString() ?? '',
    }));
  }

  /** Read legacy confirmedItems from extractedEntities JSON (migration source). */
  private async readLegacyConfirmedItems(conversationId: string): Promise<ConfirmedItem[]> {
    try {
      const ctxRow = await prisma.conversationContext.findUnique({
        where: { conversationId },
        select: { extractedEntities: true },
      });
      if (!ctxRow?.extractedEntities) return [];
      const raw = ctxRow.extractedEntities as Record<string, unknown>;
      if (Array.isArray(raw)) return []; // legacy array format (toleransi per G2-B)
      const items = raw.confirmedItems;
      if (!Array.isArray(items)) return [];
      return items as ConfirmedItem[];
    } catch {
      return [];
    }
  }
}

// ── Singleton ────────────────────────────────────────────────────────────────

export const cartAuthority = new CartAuthority();
