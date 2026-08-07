import { adapters } from '../adapters/container.js';
import { prisma } from '../infrastructure/prisma.js';
import { ApiError } from '../errors/ApiError.js';
import { ValidationError } from '../errors/ValidationError.js';
import { ErrorCodes } from '../constants/errorCodes.js';
import { productService } from './product.service.js';
import { conversationContextService } from './conversation-context.service.js';
const EXTRACTION_PROMPT = `Anda adalah parser JSON. Tidak boleh mengembalikan apapun kecuali JSON.

Tugas: Ekstrak informasi pesanan dari teks berikut ke format JSON EXACT ini:
{"intent":"buy","items":[{"product":"nama produk","quantity":angka}],"destination":"alamat"}

Aturan:
- intent: "buy" jika pelanggan ingin MEMBELI (kata kunci: beli, pesan, mau, ambil, order, saya ingin <produk>). "inquiry" jika hanya bertanya atau minta info.
- items: array produk yang disebutkan. Jika tidak ada produk, array kosong.
- quantity: angka. Default 1 jika tidak disebut.
- destination: alamat tujuan jika disebut, string kosong jika tidak.
- WAJIB: output HANYA object JSON. Tidak ada teks lain, tidak ada markdown, tidak ada backticks, tidak ada penjelasan.

Teks:`;
const RETRY_PROMPT = `Output Anda sebelumnya tidak valid. Kembalikan HANYA JSON dengan format:
{"intent":"buy","items":[{"product":"...","quantity":1}],"destination":"..."}
Tidak ada teks lain. Tidak ada backticks. Tidak ada markdown. Hanya JSON.

Teks asli:`;
function extractJsonFromText(raw) {
    // Try direct parse first
    const trimmed = raw.trim();
    try {
        JSON.parse(trimmed);
        return trimmed;
    }
    catch {
        // Try to find a JSON object in the text using regex
        const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const candidate = jsonMatch[0];
            try {
                JSON.parse(candidate);
                return candidate;
            }
            catch {
                return null;
            }
        }
        return null;
    }
}
function cleanJsonString(text) {
    return text
        .replace(/```json\s*/gi, '')
        .replace(/```\s*$/g, '')
        .replace(/`/g, '')
        .trim();
}
function validateParsedOrder(raw) {
    if (!raw || typeof raw !== 'object')
        return false;
    if (!raw.intent || !['buy', 'inquiry'].includes(raw.intent))
        return false;
    if (raw.items !== undefined && !Array.isArray(raw.items))
        return false;
    return true;
}
async function attemptExtraction(text, promptTemplate) {
    const fullPrompt = `${promptTemplate}\n${text}`;
    const result = await adapters.ai.generate(fullPrompt, { temperature: 0.1, maxTokens: 300 });
    const cleaned = cleanJsonString(result.content);
    const jsonStr = extractJsonFromText(cleaned);
    if (!jsonStr) {
        adapters.logger.warn('Failed to extract JSON from LLM output', { raw: result.content });
        return null;
    }
    try {
        const parsed = JSON.parse(jsonStr);
        if (!validateParsedOrder(parsed)) {
            adapters.logger.warn('LLM output failed validation', { parsed });
            return null;
        }
        return parsed;
    }
    catch {
        adapters.logger.warn('JSON parse failed after extraction', { jsonStr });
        return null;
    }
}
export class OrderService {
    async extractAndSaveOrder(conversationId, customerId, storeId, message) {
        try {
            adapters.logger.info('Extracting order from message', { conversationId });
            // First attempt
            let parsed = await attemptExtraction(message, EXTRACTION_PROMPT);
            // Single retry if first attempt failed
            if (!parsed) {
                adapters.logger.info('Retrying order extraction with stricter prompt', { conversationId });
                parsed = await attemptExtraction(message, RETRY_PROMPT);
            }
            if (!parsed) {
                adapters.logger.warn('Order extraction failed after retry', { conversationId });
                return null;
            }
            // Only save to DB if intent is 'buy'
            if (parsed.intent === 'buy') {
                const items = parsed.items || [];
                await prisma.order.create({
                    data: {
                        storeId,
                        conversationId,
                        customerId,
                        items: items,
                        currency: 'IDR',
                        orderStatus: 'pending',
                        shippingAddress: parsed.destination || null,
                        notes: null,
                    },
                });
                adapters.logger.info('Order saved from extracted intent', {
                    conversationId,
                    items: items.length,
                    destination: parsed.destination,
                });
            }
            else {
                adapters.logger.info('Intent is inquiry, skipping order creation', { conversationId });
            }
            return parsed;
        }
        catch (error) {
            adapters.logger.error('Order extraction failed (non-blocking)', error);
            return null;
        }
    }
    /**
     * Deteksi sinyal "selesai pesan".
     * Tidak perlu LLM — keyword heuristic cukup untuk phrase idiomatik.
     */
    detectDoneOrdering(message) {
        const lower = message.trim().toLowerCase();
        return OrderService.DONE_ORDERING_KEYWORDS.some(kw => lower.includes(kw));
    }
    /**
     * Add a single confirmed item to the conversation's draft order.
     * - If no draft order exists for this conversation, create one.
     * - If a draft exists, append the item to the existing items array.
     * Uses prisma.order.findFirst + conditional create/update via transaction.
     */
    async addConfirmedItemToOrder(conversationId, storeId, customerId, item) {
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
                        items: [item],
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
            }
            else {
                const existingItems = Array.isArray(existing.items) ? existing.items : [];
                const alreadyHasItem = existingItems.some((i) => i.product === item.product);
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
                        items: newItems,
                        totalPrice: newTotal,
                    },
                });
                adapters.logger.info('Item appended to draft order', {
                    conversationId,
                    orderId: existing.id,
                    product: item.product,
                });
            }
        }
        catch (error) {
            adapters.logger.error('Failed to add confirmed item to draft order', error, {
                conversationId,
                product: item.product,
            });
        }
    }
    /**
     * Sync complete cart state (confirmedItems array) to draft order.
     * Replaces or updates existing draft order items with current confirmedItems.
     */
    async syncCartStateToDraftOrder(conversationId, storeId, customerId, confirmedItems, shippingAddress) {
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
                if (confirmedItems.length === 0)
                    return;
                await prisma.order.create({
                    data: {
                        storeId,
                        conversationId,
                        customerId,
                        items: confirmedItems,
                        orderStatus: 'draft',
                        totalPrice,
                        currency: 'IDR',
                        shippingAddress: shippingAddress ?? null,
                        confirmedAt: new Date(),
                    },
                });
                adapters.logger.info('Draft order created from cart state sync', { conversationId, count: confirmedItems.length });
            }
            else {
                await prisma.order.update({
                    where: { id: existing.id },
                    data: {
                        items: confirmedItems,
                        totalPrice,
                        ...(shippingAddress ? { shippingAddress } : {}),
                    },
                });
                adapters.logger.info('Draft order updated from cart state sync', { conversationId, count: confirmedItems.length });
            }
        }
        catch (error) {
            adapters.logger.error('Failed to sync cart state to draft order', error, { conversationId });
        }
    }
    /**
     * Check-out: transition draft order → waiting_address.
     * Called when done-ordering signal detected.
     */
    async finalizeDraftOrder(conversationId) {
        const result = await prisma.order.updateMany({
            where: { conversationId, orderStatus: 'draft' },
            data: { orderStatus: 'waiting_address' },
        });
        adapters.logger.info('Draft order finalized → waiting_address', {
            conversationId,
            ordersUpdated: result.count,
        });
    }
    // ============================================================
    // Phase 1.9.2 — Order CRUD dengan integrasi product & context
    // ============================================================
    /**
     * Ambil pesanan lengkap (termasuk items) by ID.
     */
    async getOrderById(orderId) {
        const row = await prisma.order.findUnique({
            where: { id: orderId },
            include: { orderItems: { orderBy: { createdAt: 'asc' } } },
        });
        if (!row || row.deletedAt) {
            throw new ApiError(ErrorCodes.ERR_NOT_FOUND, `Order ${orderId} not found`);
        }
        return this.mapOrderWithItems(row);
    }
    /**
     * Ambil semua pesanan milik satu percakapan, urut createdAt DESC.
     */
    async getOrdersByConversation(conversationId) {
        const rows = await prisma.order.findMany({
            where: { conversationId, deletedAt: null },
            include: { orderItems: { orderBy: { createdAt: 'asc' } } },
            orderBy: { createdAt: 'desc' },
        });
        return rows.map((r) => this.mapOrderWithItems(r));
    }
    /**
     * Buat pesanan dari daftar productId + qty.
     * 1. Validasi produk & stok
     * 2. Hitung totalPrice
     * 3. Buat order + orderItem (snapshot nama & harga)
     * 4. Update extractedEntities di context (type: order, product)
     */
    async createOrder(storeId, conversationId, customerId, items) {
        if (!items.length) {
            throw new ValidationError('Order must contain at least one item');
        }
        // Validasi semua item dulu (fail fast)
        const validated = [];
        for (const item of items) {
            if (!item.productId)
                throw new ValidationError('productId is required for each item');
            if (item.quantity < 1)
                throw new ValidationError(`Quantity must be >= 1 for ${item.productId}`);
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
                    items: validated.map((v) => ({ productId: v.productId, productName: v.productName, quantity: v.quantity, unitPrice: v.unitPrice })),
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
                                ? { customizations: v.customizations }
                                : {}),
                        })),
                    },
                },
                include: { orderItems: true },
            });
            // Sinkronisasi entity ke context (non-blocking)
            const entities = validated.map((v) => ({
                type: 'product',
                value: v.productName,
                confidence: 1,
                metadata: { productId: v.productId, quantity: v.quantity },
            }));
            entities.push({ type: 'order', value: row.id, confidence: 1 });
            await conversationContextService.updateExtractedEntities(conversationId, entities);
            adapters.logger.info('Order created via catalog', { orderId: row.id, storeId, items: validated.length });
            return this.mapOrderWithItems(row);
        }
        catch (error) {
            if (error instanceof ApiError)
                throw error;
            adapters.logger.error('Failed to create order', error, { storeId, conversationId });
            throw new ApiError(ErrorCodes.ERR_DB, 'Failed to create order');
        }
    }
    /**
     * Update status pesanan. Jika status 'confirmed', set confirmedAt.
     */
    async updateOrderStatus(orderId, status) {
        const existing = await this.getOrderById(orderId);
        try {
            const row = await prisma.order.update({
                where: { id: orderId },
                data: {
                    orderStatus: status,
                },
                include: { orderItems: true },
            });
            adapters.logger.info('Order status updated', { orderId, status, previous: existing.orderStatus });
            return this.mapOrderWithItems(row);
        }
        catch (error) {
            adapters.logger.error('Failed to update order status', error, { orderId, status });
            throw new ApiError(ErrorCodes.ERR_DB, 'Failed to update order status');
        }
    }
    /**
     * Tambah item ke pesanan berstatus pending.
     */
    async addOrderItem(orderId, productId, quantity, customizations) {
        const order = await this.getOrderById(orderId);
        if (order.orderStatus !== 'pending') {
            throw new ValidationError(`Cannot add items to order with status ${order.orderStatus}`);
        }
        if (quantity < 1)
            throw new ValidationError('Quantity must be >= 1');
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
                                ? { customizations: customizations }
                                : {}),
                        },
                    },
                },
                include: { orderItems: { orderBy: { createdAt: 'asc' } } },
            });
            adapters.logger.info('Order item added', { orderId, productId, quantity });
            return this.mapOrderWithItems(row);
        }
        catch (error) {
            if (error instanceof ApiError)
                throw error;
            adapters.logger.error('Failed to add order item', error, { orderId, productId });
            throw new ApiError(ErrorCodes.ERR_DB, 'Failed to add order item');
        }
    }
    /**
     * Hapus item dari pesanan, kurangi totalPrice.
     */
    async removeOrderItem(orderId, orderItemId) {
        const order = await this.getOrderById(orderId);
        if (order.orderStatus !== 'pending') {
            throw new ValidationError(`Cannot remove items from order with status ${order.orderStatus}`);
        }
        const item = order.items.find((i) => i.id === orderItemId);
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
            return this.mapOrderWithItems(row);
        }
        catch (error) {
            adapters.logger.error('Failed to remove order item', error, { orderId, orderItemId });
            throw new ApiError(ErrorCodes.ERR_DB, 'Failed to remove order item');
        }
    }
    // ============================================================
    // Private helpers
    // ============================================================
    mapOrderWithItems(raw) {
        return {
            id: raw.id,
            storeId: raw.storeId,
            conversationId: raw.conversationId,
            customerId: raw.customerId,
            totalPrice: raw.totalPrice,
            currency: raw.currency,
            orderStatus: raw.orderStatus,
            shippingAddress: raw.shippingAddress,
            notes: raw.notes,
            confirmedAt: raw.confirmedAt,
            createdAt: raw.createdAt,
            updatedAt: raw.updatedAt,
            items: (raw.orderItems ?? []).map((i) => ({
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
// ============================================================
// Stage 4 — Conversational cart (draft order lifecycle)
// ============================================================
// Colloquial Indonesian signals that mean "I'm done, checkout"
OrderService.DONE_ORDERING_KEYWORDS = [
    'udah segitu aja', 'udha segitu aja', 'udah tadi aja', 'udha tadi aja',
    'checkout', 'kasarang checkout', 'bayar', 'total berapa', 'lunas',
    'minta total', 'berapa total', 'proses pesanan', 'kirim pesanan',
];
export const orderService = new OrderService();
//# sourceMappingURL=order.service.js.map