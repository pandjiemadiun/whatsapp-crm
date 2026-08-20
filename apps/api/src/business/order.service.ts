import { Prisma } from '@prisma/client';
import { adapters } from '../adapters/container.js';
import { prisma } from '../infrastructure/prisma.js';
import { ApiError } from '../errors/ApiError.js';
import { ValidationError } from '../errors/ValidationError.js';
import { ErrorCodes } from '../constants/errorCodes.js';
import { productService } from './product.service.js';
import { conversationContextService } from './conversation-context.service.js';
import type { OrderItem, OrderWithItems, OrderItemInput, ExtractedEntity, ConfirmedItem, ExtractedEntities } from '../domain/types.js';
import { ResponseSource } from '../domain/types.js';
import { transitionOrder, InvalidOrderTransitionError } from './order-transition.js';
import { cartAuthority } from './cart-authority.js';

export class OrderService {
  // ============================================================
  // Stage 4 — Conversational cart (draft order lifecycle)
  // ============================================================

  // Colloquial Indonesian signals that mean "I'm done, checkout"
  private static readonly DONE_ORDERING_KEYWORDS = [
    'udah segitu aja', 'udha segitu aja', 'udah tadi aja', 'udha tadi aja',
    'checkout', 'kasarang checkout', 'bayar', 'total berapa', 'lunas',
    'minta total', 'berapa total', 'proses pesanan', 'kirim pesanan',
  ];

  /**
   * Deteksi sinyal "selesai pesan".
   * Tidak perlu LLM — keyword heuristic cukup untuk phrase idiomatik.
   */
  detectDoneOrdering(message: string): boolean {
    const lower = message.trim().toLowerCase();
    return OrderService.DONE_ORDERING_KEYWORDS.some(kw => lower.includes(kw));
  }

  /**
   * Add a single confirmed item to the conversation's draft order.
   * - If no draft order exists for this conversation, create one.
   * - If a draft exists, append the item to the existing items array.
   * Uses prisma.order.findFirst + conditional create/update via transaction.
   */
  async addConfirmedItemToOrder(
    conversationId: string,
    storeId: string,
    customerId: string,
    item: ConfirmedItem
  ): Promise<void> {
    try {
      // Cek draft order yang sudah ada
      const existing = await prisma.order.findFirst({
        where: { conversationId, orderStatus: 'draft' },
      });

      if (!existing) {
        await prisma.order.create({
          data: {
            storeId,
            conversationId,
            customerId,
            items: [item] as any,
            orderStatus: 'draft',
            totalPrice: item.price ?? 0,
            currency: 'IDR',
            confirmedAt: item.confirmedAt ? new Date(item.confirmedAt) : new Date(),
            notes: null,
          },
        });
        adapters.logger.info('Draft order created for confirmed item', {
          conversationId,
          product: item.product,
          price: item.price,
        });
      } else {
        const existingItems = Array.isArray(existing.items) ? (existing.items as any[]) : [];
        const alreadyHasItem = existingItems.some(
          (i: any) => i.product === item.product
        );
        if (alreadyHasItem) {
          adapters.logger.info('Item already in draft order, skipping', {
            conversationId,
            orderId: existing.id,
            product: item.product,
          });
          return;
        }
        const newItems = [...existingItems, item];
        const newTotal = (existing.totalPrice ?? 0) + (item.price ?? 0);

        await prisma.order.update({
          where: { id: existing.id },
          data: {
            items: newItems as any,
            totalPrice: newTotal,
          },
        });
        adapters.logger.info('Item appended to draft order', {
          conversationId,
          orderId: existing.id,
          product: item.product,
        });
      }
    } catch (error) {
      adapters.logger.error('Failed to add confirmed item to draft order', error as Error, {
        conversationId,
        product: item.product,
      });
    }
  }

  /**
   * Sync complete cart state (confirmedItems array) to draft order.
   * Replaces or updates existing draft order items with current confirmedItems.
   */
  async syncCartStateToDraftOrder(
    conversationId: string,
    storeId: string,
    customerId: string,
    confirmedItems: ConfirmedItem[],
    shippingAddress?: string | null
  ): Promise<void> {
    try {
      const existing = await prisma.order.findFirst({
        where: { conversationId, orderStatus: 'draft' },
      });

      const totalPrice = confirmedItems.reduce((sum, item) => {
        const qty = typeof item.qty === 'number' ? item.qty : 1;
        const price = typeof item.price === 'number' ? item.price : 0;
        return sum + price * qty;
      }, 0);

      if (!existing) {
        if (confirmedItems.length === 0) return;
        await prisma.order.create({
          data: {
            storeId,
            conversationId,
            customerId,
            items: confirmedItems as any,
            orderStatus: 'draft',
            totalPrice,
            currency: 'IDR',
            shippingAddress: shippingAddress ?? null,
            confirmedAt: new Date(),
          },
        });
        adapters.logger.info('Draft order created from cart state sync', { conversationId, count: confirmedItems.length });
      } else {
        await prisma.order.update({
          where: { id: existing.id },
          data: {
            items: confirmedItems as any,
            totalPrice,
            ...(shippingAddress ? { shippingAddress } : {}),
          },
        });
        adapters.logger.info('Draft order updated from cart state sync', { conversationId, count: confirmedItems.length });
      }
    } catch (error) {
      adapters.logger.error('Failed to sync cart state to draft order', error as Error, { conversationId });
    }
  }

  /**
   * Check-out: transition draft order → waiting_address.
   * Called when done-ordering signal detected.
   * Delegates to CartAuthority.checkout which enforces stock validation,
   * storeId filtering, and state machine transition via transitionOrder.
   */
  async finalizeDraftOrder(conversationId: string, storeId: string): Promise<string> {
    return await cartAuthority.checkout(conversationId, storeId);
  }

  // ============================================================
  // Phase 1.9.2 — Order CRUD dengan integrasi product & context
  // ============================================================

  /**
   * Ambil pesanan lengkap (termasuk items) by ID.
   */
  async getOrderById(orderId: string): Promise<OrderWithItems> {
    const row = await prisma.order.findUnique({
      where: { id: orderId },
      include: { orderItems: { orderBy: { createdAt: 'asc' } } },
    });
    if (!row || row.deletedAt) {
      throw new ApiError(ErrorCodes.ERR_NOT_FOUND, `Order ${orderId} not found`);
    }
    return this.mapOrderWithItems(row as any);
  }

  /**
   * Ambil semua pesanan milik satu percakapan, urut createdAt DESC.
   */
  async getOrdersByConversation(conversationId: string): Promise<OrderWithItems[]> {
    const rows = await prisma.order.findMany({
      where: { conversationId, deletedAt: null },
      include: { orderItems: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r: any) => this.mapOrderWithItems(r));
  }

  /**
   * Buat pesanan dari daftar productId + qty.
   * 1. Validasi produk & stok
   * 2. Hitung totalPrice
   * 3. Buat order + orderItem (snapshot nama & harga)
   * 4. Update extractedEntities di context (type: order, product)
   */
  async createOrder(
    storeId: string,
    conversationId: string,
    customerId: string,
    items: OrderItemInput[]
  ): Promise<OrderWithItems> {
    if (!items.length) {
      throw new ValidationError('Order must contain at least one item');
    }

    // Validasi semua item dulu (fail fast)
    const validated = [];
    for (const item of items) {
      if (!item.productId) throw new ValidationError('productId is required for each item');
      if (item.quantity < 1) throw new ValidationError(`Quantity must be >= 1 for ${item.productId}`);

      const product = await productService.getProductById(item.productId);
      if (product.storeId !== storeId) {
        throw new ApiError(ErrorCodes.ERR_VALIDATION, `Product ${item.productId} does not belong to store`);
      }
      const available = await productService.checkStockAvailability(item.productId, item.quantity);
      if (!available) {
        throw new ApiError(ErrorCodes.ERR_VALIDATION, `Insufficient stock for product ${product.name}`);
      }
      validated.push({
        productId: product.id,
        productName: product.name,
        quantity: item.quantity,
        unitPrice: product.price,
        customizations: item.customizations ?? null,
      });
    }

    const totalPrice = validated.reduce((sum, v) => sum + v.unitPrice * v.quantity, 0);

    try {
      const row = await prisma.order.create({
        data: {
          storeId,
          conversationId,
          customerId,
          items: validated.map((v) => ({ productId: v.productId, productName: v.productName, quantity: v.quantity, unitPrice: v.unitPrice })) as unknown as Prisma.InputJsonValue,
          totalPrice,
          currency: 'IDR',
          orderStatus: 'pending',
          orderItems: {
            create: validated.map((v) => ({
              productId: v.productId,
              productName: v.productName,
              quantity: v.quantity,
              unitPrice: v.unitPrice,
              subtotal: v.unitPrice * v.quantity,
              ...(v.customizations
                ? { customizations: v.customizations as unknown as Prisma.InputJsonValue }
                : {}),
            })),
          },
        },
        include: { orderItems: true },
      });

      // Sinkronisasi entity ke context (non-blocking)
      const entities: ExtractedEntity[] = validated.map((v) => ({
        type: 'product',
        value: v.productName,
        confidence: 1,
        metadata: { productId: v.productId, quantity: v.quantity },
      }));
      entities.push({ type: 'order', value: row.id, confidence: 1 });
      await conversationContextService.updateExtractedEntities(conversationId, entities);

      adapters.logger.info('Order created via catalog', { orderId: row.id, storeId, items: validated.length });
      return this.mapOrderWithItems(row as any);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      adapters.logger.error('Failed to create order', error as Error, { storeId, conversationId });
      throw new ApiError(ErrorCodes.ERR_DB, 'Failed to create order');
    }
  }

  /**
   * Update status pesanan via state machine otoritatif (order-transition).
   *
   * FIX (G2-F1): sebelumnya pakai `prisma.order.update` mentah yang BYPASS
   * `transitionOrder()` — melanggar invarian single-source-of-truth
   * (order-transition.ts:8-10). Sekarang delegasi penuh ke transitionOrder
   * agar validasi ALLOWED_TRANSITIONS + invariant confirmedAt tetap berlaku.
   * Signature dipertahankan (dipakai oleh test integration).
   */
  async updateOrderStatus(orderId: string, status: string): Promise<OrderWithItems> {
    const existing = await this.getOrderById(orderId);
    try {
      const updated = await transitionOrder(orderId, status, { actor: 'system' });
      adapters.logger.info('Order status updated', { orderId, status, previous: existing.orderStatus });
      return updated;
    } catch (error) {
      if (error instanceof InvalidOrderTransitionError) {
        throw new ApiError(ErrorCodes.ERR_VALIDATION, error.message);
      }
      if (error instanceof ApiError) throw error;
      adapters.logger.error('Failed to update order status', error as Error, { orderId, status });
      throw new ApiError(ErrorCodes.ERR_DB, 'Failed to update order status');
    }
  }

  /**
   * Tambah item ke pesanan berstatus pending.
   */
  async addOrderItem(orderId: string, productId: string, quantity: number, customizations?: Record<string, unknown>): Promise<OrderWithItems> {
    const order = await this.getOrderById(orderId);
    if (order.orderStatus !== 'pending') {
      throw new ValidationError(`Cannot add items to order with status ${order.orderStatus}`);
    }
    if (quantity < 1) throw new ValidationError('Quantity must be >= 1');

    const product = await productService.getProductById(productId);
    const available = await productService.checkStockAvailability(productId, quantity);
    if (!available) {
      throw new ApiError(ErrorCodes.ERR_VALIDATION, `Insufficient stock for product ${product.name}`);
    }

    const subtotal = product.price * quantity;
    const newTotal = (order.totalPrice ?? 0) + subtotal;

    try {
      const row = await prisma.order.update({
        where: { id: orderId },
        data: {
          totalPrice: newTotal,
          orderItems: {
            create: {
              productId: product.id,
              productName: product.name,
              quantity,
              unitPrice: product.price,
              subtotal,
              ...(customizations
                ? { customizations: customizations as unknown as Prisma.InputJsonValue }
                : {}),
            },
          },
        },
        include: { orderItems: { orderBy: { createdAt: 'asc' } } },
      });
      adapters.logger.info('Order item added', { orderId, productId, quantity });
      return this.mapOrderWithItems(row as any);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      adapters.logger.error('Failed to add order item', error as Error, { orderId, productId });
      throw new ApiError(ErrorCodes.ERR_DB, 'Failed to add order item');
    }
  }

  /**
   * Hapus item dari pesanan, kurangi totalPrice.
   */
  async removeOrderItem(orderId: string, orderItemId: string): Promise<OrderWithItems> {
    const order = await this.getOrderById(orderId);
    if (order.orderStatus !== 'pending') {
      throw new ValidationError(`Cannot remove items from order with status ${order.orderStatus}`);
    }

    const item = order.items.find((i: OrderItem) => i.id === orderItemId);
    if (!item) {
      throw new ApiError(ErrorCodes.ERR_NOT_FOUND, `Order item ${orderItemId} not found`);
    }

    const newTotal = Math.max(0, (order.totalPrice ?? 0) - item.subtotal);

    try {
      await prisma.orderItem.delete({ where: { id: orderItemId } });
      const row = await prisma.order.update({
        where: { id: orderId },
        data: { totalPrice: newTotal },
        include: { orderItems: { orderBy: { createdAt: 'asc' } } },
      });
      adapters.logger.info('Order item removed', { orderId, orderItemId });
      return this.mapOrderWithItems(row as any);
    } catch (error) {
      adapters.logger.error('Failed to remove order item', error as Error, { orderId, orderItemId });
      throw new ApiError(ErrorCodes.ERR_DB, 'Failed to remove order item');
    }
  }

  /**
   * Cancel an order via the authoritative state machine (order-transition).
   *
   * Business invariant: only transitions present in ALLOWED_TRANSITIONS are
   * permitted. Per the existing single-source-of-truth state machine this
   * means draft / waiting_address / waiting_payment / pending / confirmed /
   * packing / paid / shipped MAY cancel, while completed / refunded /
   * cancelled are terminal and are REJECTED.
   *
   * Ownership (store + customer) is validated here — order-transition.ts
   * documents that "Ownership is validated by the caller". Runs inside an
   * optional tx so it can participate in the structured-action idempotency
   * transaction (FOR UPDATE + SAVEPOINT). Business rejections are thrown as
   * plain errors with an INVALID_-prefixed code so the action registry's
   * executeClaimedAction records them as FAILED (not an infra abort).
   */
  async cancelOrder(
    orderId: string,
    storeId: string,
    customerId: string,
    options?: { tx?: any }
  ): Promise<OrderWithItems> {
    const tx = (options?.tx ?? prisma) as any;

    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { orderItems: { orderBy: { createdAt: 'asc' } } },
    });

    if (!order || order.deletedAt) {
      const err = new Error(`Order ${orderId} not found`) as any;
      err.code = 'INVALID_ORDER_NOT_FOUND';
      err.name = 'InvalidOrderStateError';
      throw err;
    }

    if (order.storeId !== storeId || order.customerId !== customerId) {
      const err = new Error(
        `Order ${orderId} does not belong to store ${storeId} / customer ${customerId}`
      ) as any;
      err.code = 'INVALID_ORDER_OWNERSHIP';
      err.name = 'InvalidOrderStateError';
      throw err;
    }

    try {
      return await transitionOrder(orderId, 'cancelled', { tx });
    } catch (e: any) {
      if (e instanceof InvalidOrderTransitionError) {
        const err = new Error(e.message) as any;
        err.code = 'INVALID_ORDER_TRANSITION';
        err.name = 'InvalidOrderStateError';
        throw err;
      }
      throw e;
    }
  }

  // ============================================================
  // Private helpers
  // ============================================================

  private mapOrderWithItems(raw: any): OrderWithItems {
    return {
      id: raw.id,
      storeId: raw.storeId,
      conversationId: raw.conversationId,
      customerId: raw.customerId,
      totalPrice: raw.totalPrice,
      currency: raw.currency,
      orderStatus: raw.orderStatus,
      paymentMethod: raw.paymentMethod ?? null,
      paymentStatus: raw.paymentStatus ?? 'unpaid',
      paymentProofUrl: raw.paymentProofUrl ?? null,
      paymentReportedAt: raw.paymentReportedAt ?? null,
      paymentVerifiedAt: raw.paymentVerifiedAt ?? null,
      verifiedByAdminId: raw.verifiedByAdminId ?? null,
      shippingAddress: raw.shippingAddress,
      notes: raw.notes,
      confirmedAt: raw.confirmedAt,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      items: (raw.orderItems ?? []).map((i: any): OrderItem => ({
        id: i.id,
        orderId: i.orderId,
        productId: i.productId,
        productName: i.productName,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        subtotal: i.subtotal,
        customizations: i.customizations,
        createdAt: i.createdAt,
        updatedAt: i.updatedAt,
      })),
    };
  }
}

export const orderService = new OrderService();
