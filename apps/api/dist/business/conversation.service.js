import { adapters } from '../adapters/container.js';
import { fallbackService } from './fallback.service.js';
import { orderService } from './order.service.js';
import { conversationContextService } from './conversation-context.service.js';
import { prisma } from '../infrastructure/prisma.js';
import { productService } from './product.service.js';
import { resolvePendingClarification, buildPendingFromClarification } from '../services/clarification-resolver.js';
import { normalize } from '../services/chat/normalizer.js';
import { runOneCall, validateCartOps, truncateTo2Sentences } from '../services/chat/interpreter.js';
import { ResponseSource, } from '../domain/types.js';
export class ConversationService {
    async processCustomerMessage(storeId, customerId, conversationId, customerMessage) {
        adapters.logger.info('Processing customer message', { storeId, customerId, conversationId });
        const conversation = await prisma.conversation.upsert({
            where: { id: conversationId },
            update: {},
            create: {
                id: conversationId,
                storeId: storeId,
                customerId: customerId,
                customerPhone: customerId, // Fallback nilai phone dengan customerId
                channel: 'whatsapp',
                status: 'open',
            },
        });
        if (conversation.status === 'human_takeover') {
            await this.saveMessage({
                id: crypto.randomUUID(),
                conversationId,
                sender: 'customer',
                content: customerMessage,
                createdAt: new Date(),
            });
            await prisma.conversation.update({
                where: { id: conversationId },
                data: { lastMessageAt: new Date() },
            });
            adapters.logger.info('Skipping AI reply — conversation under human takeover', { conversationId });
            return null;
        }
        // Pastikan context aktif (buat baru jika belum ada / sudah expired)
        const existingContext = await conversationContextService.getContext(conversationId);
        if (!existingContext) {
            await conversationContextService.initializeContext({
                storeId,
                customerId,
                conversationId,
            });
        }
        const context = await this.getOrCreateContext(storeId, customerId, conversationId, customerMessage);
        // Extract customerCity from context entities
        let customerCity = null;
        try {
            const ctxRow = await prisma.conversationContext.findUnique({
                where: { conversationId },
                select: { extractedEntities: true },
            });
            const raw = ctxRow?.extractedEntities;
            if (raw && typeof raw.customerCity === 'string') {
                customerCity = raw.customerCity;
            }
        }
        catch {
            // non-critical
        }
        // ── BAGIAN 2: Pending clarification resolver — runs FIRST, before normalizer/tier/interpreter ──
        // Jika ada pending clarification, resolver cek afirmatif/negasi V0 LLM.
        const resolveResult = await resolvePendingClarification(conversationId, storeId, customerMessage);
        if (resolveResult.handled) {
            if (resolveResult.escalate) {
                // Alihkan ke pemilik toko (retry_count max 1 exceeded)
                await this.saveMessage({
                    id: crypto.randomUUID(),
                    conversationId,
                    sender: 'customer',
                    content: customerMessage,
                    createdAt: new Date(),
                });
                await this.saveMessage({
                    id: crypto.randomUUID(),
                    conversationId,
                    sender: 'assistant',
                    content: resolveResult.reply ?? 'Saya akan hubungkan ke pemilik toko.',
                    source: ResponseSource.HUMAN,
                    createdAt: new Date(),
                });
                await conversationContextService.refreshSession(conversationId);
                return this.buildResult(conversationId, {
                    source: ResponseSource.HUMAN,
                    content: resolveResult.reply ?? 'Saya akan hubungkan ke pemilik toko.',
                    confidence: 0.9,
                    cost: 0,
                    metadata: { reason: 'escalation_clarification_retry_exceeded' },
                });
            }
            // Approved atau negasi — eksekusi cart_ops TANPA LLM, render dari DB state
            await this.saveMessage({
                id: crypto.randomUUID(),
                conversationId,
                sender: 'customer',
                content: customerMessage,
                createdAt: new Date(),
            });
            await this.saveMessage({
                id: crypto.randomUUID(),
                conversationId,
                sender: 'assistant',
                content: resolveResult.reply ?? 'Baik.',
                source: ResponseSource.SOP,
                createdAt: new Date(),
            });
            await conversationContextService.refreshSession(conversationId);
            return this.buildResult(conversationId, {
                source: ResponseSource.SOP,
                content: resolveResult.reply ?? 'Baik.',
                confidence: 0.9,
                cost: 0,
                metadata: { reason: 'resolver_no_llm', resolvedAction: resolveResult.action },
            });
        }
        // ── BAGIAN 1: Normalizer (0 LLM) ───────────────────────────────────
        // I12: guard nama produk — cek produk DULU (fuzzy match), jangan dimutasi.
        let result = null;
        let normalizedMsg = customerMessage;
        const storeProducts = await this.getStoreProducts(storeId);
        const productDictionary = storeProducts.map((p) => p.name);
        normalizedMsg = normalize(customerMessage, productDictionary);
        // Bangun PipelineContext sekali — dibawa ke Stage 3 + Stage 4.
        const pipelineCtx = await this.buildPipelineContext(storeId, customerId, conversationId, context, customerCity, conversation.customerName ?? null, storeProducts);
        // ── STAGE 3: Rule-based fast-path tiers (0 LLM) ────────────────────
        // I13: reply Stage 3 hanya memakai harga dari DB, tidak dari LLM.
        // getResponse kembalikan terminal fallback (source HUMAN) bila tidak ada
        // tier yang cocok; perlakukan sebagai miss agar Stage 4 (LLM) dapat jalan.
        const tierResult = await fallbackService.getResponse(normalizedMsg, pipelineCtx);
        if (tierResult && tierResult.source !== ResponseSource.HUMAN) {
            result = tierResult;
        }
        // ── STAGE 4: Single LLM Interpreter (MAKS 1 CALL) ──────────────────
        // I8: cek ctx.llmCalledThisTurn sebelum panggil runOneCall.
        if (!result && !pipelineCtx.llmCalledThisTurn) {
            pipelineCtx.llmCalledThisTurn = true;
            const llmResult = await runOneCall(normalizedMsg, pipelineCtx);
            if (llmResult) {
                let executedAdd = false;
                // I15: validateCartOps dipanggil sebelum executeCartOps.
                if (llmResult.cart_ops && llmResult.cart_ops.length > 0) {
                    const { valid, missing } = validateCartOps(llmResult.cart_ops, storeProducts);
                    if (valid.length > 0) {
                        await this.executeCartOps(valid, pipelineCtx, normalizedMsg);
                        executedAdd = valid.some((o) => o.type === 'add');
                    }
                    if (missing.length > 0) {
                        llmResult.missing_info = [...(llmResult.missing_info || []), ...missing];
                    }
                }
                if (llmResult.clarification) {
                    // Simpan pending BEFORE kirim pertanyaan (BAGIAN 2.2)
                    await conversationContextService.setPendingClarification(conversationId, buildPendingFromClarification(llmResult.clarification));
                    result = this.buildResult(conversationId, {
                        source: ResponseSource.SOP,
                        content: llmResult.clarification.question,
                        confidence: 0.85,
                        cost: 0,
                        metadata: { reason: 'clarification_asked' },
                    });
                }
                else if (llmResult.reply_draft) {
                    // Guardrail: reply_draft maks 2 kalimat
                    result = this.buildResult(conversationId, {
                        source: ResponseSource.AI,
                        content: truncateTo2Sentences(llmResult.reply_draft),
                        confidence: llmResult.confidence,
                        cost: 0,
                        metadata: {
                            source: 'interpreter',
                            intent: llmResult.intent,
                            missing_info: llmResult.missing_info || undefined,
                        },
                    });
                }
                else if (executedAdd) {
                    // Safety-net: add dieksekusi tapi LLM tidak sertakan reply_draft →
                    // render keranjang dari DB state (harga dari DB, bukan LLM).
                    const cart = await this.getCartFromDb(conversationId);
                    const reply = await this.renderCartSummary(conversationId, cart, undefined);
                    result = this.buildModifyCartResult(conversationId, reply);
                }
            }
        }
        // ── STAGE 5: Dead-end fallback ─────────────────────────────────────
        if (!result) {
            result = this.buildResult(conversationId, {
                source: ResponseSource.HUMAN,
                content: 'Maaf kak, saya kurang paham. Bisa diulang?',
                confidence: 0.5,
                cost: 0,
                metadata: { reason: 'dead_end_fallback' },
            });
        }
        await this.saveMessage({
            id: crypto.randomUUID(),
            conversationId,
            sender: 'customer',
            content: customerMessage,
            createdAt: new Date(),
        });
        await this.saveMessage(result.message);
        await this.updateConversationStats(context, result);
        // Sinkronkan pesan ke context + refresh sesi
        await conversationContextService.appendMessage(conversationId, {
            id: crypto.randomUUID(),
            conversationId,
            sender: 'customer',
            content: customerMessage,
            createdAt: new Date(),
        });
        await conversationContextService.appendMessage(conversationId, result.message);
        await conversationContextService.refreshSession(conversationId);
        // Non-blocking order extraction — fire and forget, errors caught silently
        orderService.extractAndSaveOrder(conversationId, customerId, storeId, normalizedMsg);
        // Done-ordering signal → finalize draft order to waiting_address
        if (orderService.detectDoneOrdering(normalizedMsg)) {
            await orderService.finalizeDraftOrder(conversationId);
        }
        return result;
    }
    /**
     * Bungkus teks balasan MODIFY_CART menjadi ResponseResult standar.
     */
    /**
     * Ambil daftar produk aktif toko sebagai { name, price, stock }.
     * Dipakai I12 (guard normalizer) + validasi interpreter (validateCartOps).
     */
    async getStoreProducts(storeId) {
        const products = await productService.listActiveProducts(storeId);
        return products.map((p) => ({
            name: p.name,
            price: p.price ?? 0,
            stock: p.stock ?? null,
        }));
    }
    /**
     * Bangun PipelineContext (biru) dari ConversationContext DB + relasi.
     * messages sudah termasuk pesan pelanggan terbaru (dari getOrCreateContext).
     */
    async buildPipelineContext(storeId, customerId, conversationId, context, customerCity, customerName, storeProducts) {
        const ctxRow = await prisma.conversationContext.findUnique({
            where: { conversationId },
            select: { extractedEntities: true },
        });
        const entities = conversationContextService.parseExtractedEntities(ctxRow?.extractedEntities);
        const cart = entities.confirmedItems || [];
        const activeOrder = await prisma.order.findFirst({
            where: {
                conversationId,
                deletedAt: null,
                orderStatus: { notIn: ['shipped', 'delivered', 'cancelled'] },
            },
            orderBy: { createdAt: 'desc' },
            select: { id: true, orderStatus: true, items: true, notes: true },
        });
        return {
            storeId,
            customerId,
            conversationId,
            messages: context.messages,
            customerCity,
            customerName,
            cart,
            activeOrder: activeOrder,
            pendingClarification: entities.pendingClarification ?? null,
            llmCalledThisTurn: false,
            storeProducts,
        };
    }
    /**
     * Execute (add / remove) validated cart_ops ke DB, lalu sync ke draft order.
     * Untuk remove, snapshot cart sebelum mutasi agar negasi -> rollback masih
     * memungkinkan. I15: hanya dipanggil setelah validateCartOps mengembalikan valid.
     */
    async executeCartOps(ops, pipelineCtx, message) {
        const { conversationId, storeId, customerId } = pipelineCtx;
        const hasRemove = ops.some((o) => o.type === 'remove');
        let cartBefore = [];
        if (hasRemove) {
            cartBefore = await this.getCartFromDb(conversationId);
            await this.storePreviousMutation(conversationId, cartBefore.map((i) => ({ product: i.product, qty: i.qty ?? null, price: i.price ?? null })), message);
        }
        let items = cartBefore;
        for (const op of ops) {
            if (op.type === 'add') {
                items = await conversationContextService.modifyCart(conversationId, 'add', {
                    addedProduct: op.product,
                    qty: op.qty,
                    price: op.price,
                });
            }
            else if (op.type === 'remove') {
                items = await conversationContextService.modifyCart(conversationId, 'remove', {
                    cancelledProduct: op.product,
                });
            }
        }
        if (ops.length > 0) {
            await orderService.syncCartStateToDraftOrder(conversationId, storeId, customerId, items, null);
        }
        return items;
    }
    /**
     * Baca snapshot keranjang terkonfirmasi dari DB (extractedEntities).
     */
    async getCartFromDb(conversationId) {
        const ctxRow = await prisma.conversationContext.findUnique({
            where: { conversationId },
            select: { extractedEntities: true },
        });
        return conversationContextService.parseExtractedEntities(ctxRow?.extractedEntities).confirmedItems || [];
    }
    /** BAGIAN 2.4 — Store previousCart snapshot untuk rollback */
    async storePreviousMutation(conversationId, cartSnapshot, message) {
        try {
            const ctxRow = await prisma.conversationContext.findUnique({
                where: { conversationId },
                select: { extractedEntities: true },
            });
            const entities = ctxRow?.extractedEntities || {};
            await prisma.conversationContext.update({
                where: { conversationId },
                data: {
                    extractedEntities: {
                        ...entities,
                        previousMutation: { cartSnapshot, message },
                    },
                },
            });
        }
        catch (e) {
            adapters.logger.warn('Failed to store previousMutation', { error: e.message });
        }
    }
    /** BAGIAN 2.5 — Render cart state dari DB (bukan dari memory) */
    async renderCartSummary(conversationId, currentItems, removedItemName) {
        let replyText;
        if (removedItemName) {
            replyText = `Oke Kak, *${removedItemName}* sudah dihapus dari keranjang ya. 🛒`;
        }
        else {
            replyText = 'Keranjang belanja Kakak sudah diperbarui ya.';
        }
        if (currentItems.length > 0) {
            const cartSummary = currentItems
                .map((i) => {
                const qty = typeof i.qty === 'number' ? i.qty : 1;
                const price = typeof i.price === 'number' ? i.price : 0;
                return `• ${i.product} ×${qty}${price > 0 ? ` — Rp ${(price * qty).toLocaleString('id-ID')}` : ''}`;
            })
                .join('\n');
            replyText += `\n\n*Keranjang sekarang:*\n${cartSummary}\n\nMau tambah yang lain atau sudah cukup Kak? 😊`;
        }
        else {
            replyText += '\n\nKeranjang Kakak sekarang kosong. Mau cari produk lain? 😊';
        }
        return replyText;
    }
    buildModifyCartResult(conversationId, replyText) {
        const msg = {
            id: crypto.randomUUID(),
            conversationId,
            sender: 'assistant',
            content: replyText,
            source: ResponseSource.PRODUCT,
            createdAt: new Date(),
        };
        return {
            conversationId,
            message: msg,
            source: ResponseSource.PRODUCT,
            confidence: 0.95,
            cost: 0,
            requiresHumanReview: false,
            metadata: { reason: 'modify_cart' },
        };
    }
    buildResult(conversationId, option) {
        const msg = {
            id: crypto.randomUUID(),
            conversationId,
            sender: 'assistant',
            content: option.content,
            source: option.source,
            createdAt: new Date(),
        };
        return {
            conversationId,
            message: msg,
            source: option.source,
            confidence: option.confidence,
            cost: option.cost,
            requiresHumanReview: false,
            metadata: option.metadata || {},
        };
    }
    async getOrCreateContext(storeId, customerId, conversationId, newMessage) {
        const history = await prisma.conversationHistory.findMany({
            where: { conversationId },
            orderBy: { createdAt: 'asc' },
        });
        // Rolling context window: hanya ambil pesan terakhir (efisien untuk LLM)
        const ROLLING_SIZE = 10;
        const trimmedHistory = history.slice(-ROLLING_SIZE);
        const allMessages = [
            ...trimmedHistory.map(m => ({
                id: m.id,
                conversationId: m.conversationId,
                sender: m.role === 'user' ? 'customer' : 'assistant',
                content: m.content,
                source: m.source || undefined,
                cost: m.costUSD,
                createdAt: m.createdAt,
            })),
            {
                id: crypto.randomUUID(),
                conversationId,
                sender: 'customer',
                content: newMessage,
                createdAt: new Date(),
            },
        ];
        return {
            storeId,
            customerId,
            conversationId,
            messages: allMessages,
            lastMessageAt: new Date(),
            status: 'active',
        };
    }
    async saveMessage(message) {
        try {
            await prisma.conversationHistory.create({
                data: {
                    id: message.id,
                    conversationId: message.conversationId,
                    role: message.sender === 'customer' ? 'user' : 'assistant',
                    content: message.content,
                    source: message.source || null,
                    costUSD: message.cost || 0,
                    metadata: message.metadata || undefined,
                    createdAt: message.createdAt,
                },
            });
        }
        catch (error) {
            adapters.logger.error('Failed to save message', error);
        }
    }
    async updateConversationStats(context, result) {
        const isAI = result.source === ResponseSource.AI;
        const isFAQ = result.source === ResponseSource.FAQ;
        // NOTE: human_takeover di-set hanya oleh circuit breaker (notifyHumanTakeover)
        // di MessageProcessorService. Jangan auto-set di sini karena akan
        // menimbonloop: resume AI → AI gagal → status kembali human_takeover.
        // Individual AI failures (FallbackService HUMAN) harus tetap open
        // agar bisa auto-recovery setelah circuit breaker cooldown.
        try {
            await prisma.conversation.update({
                where: { id: context.conversationId },
                data: {
                    lastMessageAt: new Date(),
                    status: 'open',
                    aiResponseCount: isAI ? { increment: 1 } : undefined,
                    faqResponseCount: isFAQ ? { increment: 1 } : undefined,
                },
            });
        }
        catch {
            adapters.logger.warn('Failed to update conversation stats');
        }
    }
    // ============================================================
    // Phase 1.9.2 — Context-aware conversation methods
    // ============================================================
    /**
     * Ambil percakapan lengkap termasuk context dan orders (dengan items).
     */
    async getConversationWithContext(conversationId) {
        const conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
        if (!conv || conv.deletedAt)
            return null;
        const [context, orders] = await Promise.all([
            conversationContextService.getContext(conversationId),
            orderService.getOrdersByConversation(conversationId),
        ]);
        return this.mapConversationWithContext(conv, context, orders);
    }
    /**
     * Buat percakapan baru + inisialisasi context-nya sekaligus.
     */
    async createConversation(storeId, customerId, customerPhone, customerName) {
        const conv = await prisma.conversation.create({
            data: {
                storeId,
                customerId,
                customerPhone,
                customerName: customerName ?? null,
                channel: 'whatsapp',
                status: 'open',
            },
        });
        const context = await conversationContextService.initializeContext({
            storeId,
            customerId,
            conversationId: conv.id,
        });
        adapters.logger.info('Conversation created with context', { conversationId: conv.id, storeId });
        return this.mapConversationWithContext(conv, context, []);
    }
    /**
     * Simpan pesan ke conversation_history DAN sinkronkan ke context
     * (appendMessage + refreshSession).
     */
    async appendMessageWithContext(conversationId, role, content) {
        const message = {
            id: crypto.randomUUID(),
            conversationId,
            sender: role === 'user' ? 'customer' : 'assistant',
            content,
            createdAt: new Date(),
        };
        await prisma.conversationHistory.create({
            data: {
                id: message.id,
                conversationId,
                role,
                content,
                createdAt: message.createdAt,
            },
        });
        await conversationContextService.appendMessage(conversationId, message);
        await conversationContextService.refreshSession(conversationId);
    }
    /**
     * Update status percakapan. Jika 'resolved', set resolvedAt.
     */
    async updateConversationStatus(conversationId, status) {
        await prisma.conversation.update({
            where: { id: conversationId },
            data: {
                status,
                ...(status === 'resolved' ? { resolvedAt: new Date() } : {}),
            },
        });
        adapters.logger.info('Conversation status updated', { conversationId, status });
    }
    /**
     * Ambil percakapan terbuka terbaru (default 50), termasuk context & orders.
     */
    async getRecentConversations(storeId, limit = 50) {
        const limitClamped = Math.min(Math.max(1, limit), 100);
        const convs = await prisma.conversation.findMany({
            where: { storeId, deletedAt: null, status: 'open' },
            orderBy: { lastMessageAt: 'desc' },
            take: limitClamped,
        });
        const results = [];
        for (const conv of convs) {
            const [context, orders] = await Promise.all([
                conversationContextService.getContext(conv.id),
                orderService.getOrdersByConversation(conv.id),
            ]);
            results.push(this.mapConversationWithContext(conv, context, orders));
        }
        return results;
    }
    // ============================================================
    // Private helpers
    // ============================================================
    mapConversationWithContext(conv, context, orders) {
        return {
            id: conv.id,
            storeId: conv.storeId,
            customerId: conv.customerId,
            customerName: conv.customerName,
            customerPhone: conv.customerPhone,
            status: conv.status,
            channel: conv.channel,
            lastMessageAt: conv.lastMessageAt,
            aiResponseCount: conv.aiResponseCount,
            faqResponseCount: conv.faqResponseCount,
            createdAt: conv.createdAt,
            updatedAt: conv.updatedAt,
            context,
            orders,
        };
    }
    async getConversationStats(conversationId) {
        const messages = await prisma.conversationHistory.findMany({
            where: { conversationId },
        });
        const sourceDistribution = {
            cache: 0, faq: 0, knowledge: 0, ai: 0, human: 0, fallback: 0,
        };
        let totalCost = 0;
        messages.forEach((m) => {
            if (m.source && m.source in sourceDistribution) {
                sourceDistribution[m.source]++;
            }
            totalCost += m.costUSD || 0;
        });
        return {
            conversationId,
            totalMessages: messages.length,
            sourceDistribution: sourceDistribution,
            totalCost,
            averageResponseTime: 0,
        };
    }
    async findAllByStore(storeId) {
        return prisma.conversation.findMany({
            where: { storeId, deletedAt: null },
            orderBy: { lastMessageAt: 'desc' },
            select: {
                id: true,
                customerId: true,
                customerName: true,
                customerPhone: true,
                status: true,
                lastMessageAt: true,
                aiResponseCount: true,
                faqResponseCount: true,
            },
        });
    }
    async findByIdWithHistory(id) {
        const conv = await prisma.conversation.findUnique({
            where: { id },
        });
        if (!conv || conv.deletedAt)
            return null;
        const history = await prisma.conversationHistory.findMany({
            where: { conversationId: id },
            orderBy: { createdAt: 'asc' },
            select: {
                id: true,
                role: true,
                content: true,
                source: true,
                createdAt: true,
            },
        });
        return {
            id: conv.id,
            customerId: conv.customerId,
            customerName: conv.customerName,
            customerPhone: conv.customerPhone,
            status: conv.status,
            lastMessageAt: conv.lastMessageAt,
            aiResponseCount: conv.aiResponseCount,
            faqResponseCount: conv.faqResponseCount,
            history,
        };
    }
}
export const conversationService = new ConversationService();
//# sourceMappingURL=conversation.service.js.map