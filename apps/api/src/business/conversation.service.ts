import { adapters } from '../adapters/container.js';
import { fallbackService } from './fallback.service.js';
import { orderService } from './order.service.js';
import { conversationContextService } from './conversation-context.service.js';
import { prisma } from '../infrastructure/prisma.js';
import { decideRoute, buildRouteContext, RouteContext, ConfirmedItemLike } from './route-decider.js';
import { normalizeMessage } from '../services/message-normalizer.js';
import { resolvePendingClarification, buildPendingFromClarification } from '../services/clarification-resolver.js';
import { interpretMessage, countLlmCallsInWindow } from '../services/ot-or-interpreter.js';

import {
  ConversationMessage,
  ConversationContext,
  ResponseResult,
  ConversationStats,
  ResponseSource,
  ConversationWithContext,
  ConversationContextData,
  ConfirmedItem,
  ExtractedEntities,
} from '../domain/types.js';

interface ConversationListItem {
  id: string;
  customerId: string;
  customerName: string | null;
  customerPhone: string;
  status: string;
  lastMessageAt: Date | null;
  aiResponseCount: number;
  faqResponseCount: number;
}

interface ConversationDetail extends ConversationListItem {
  history: Array<{
    id: string;
    role: string;
    content: string;
    source: string | null;
    createdAt: Date;
  }>;
}

export class ConversationService {
  async processCustomerMessage(
    storeId: string,
    customerId: string,
    conversationId: string,
    customerMessage: string
  ): Promise<ResponseResult | null> {
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
      } as ConversationMessage);
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
    let customerCity: string | null = null;
    try {
      const ctxRow = await prisma.conversationContext.findUnique({
        where: { conversationId },
        select: { extractedEntities: true },
      });
      const raw = ctxRow?.extractedEntities as Record<string, unknown> | null;
      if (raw && typeof raw.customerCity === 'string') {
        customerCity = raw.customerCity as string;
      }
    } catch {
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
        } as ConversationMessage);
        await this.saveMessage({
          id: crypto.randomUUID(),
          conversationId,
          sender: 'assistant',
          content: resolveResult.reply ?? 'Saya akan hubungkan ke pemilik toko.',
          source: ResponseSource.HUMAN,
          createdAt: new Date(),
        } as ConversationMessage);
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
      } as ConversationMessage);
      await this.saveMessage({
        id: crypto.randomUUID(),
        conversationId,
        sender: 'assistant',
        content: resolveResult.reply ?? 'Baik.',
        source: ResponseSource.SOP,
        createdAt: new Date(),
      } as ConversationMessage);
      await conversationContextService.refreshSession(conversationId);
      return this.buildResult(conversationId, {
        source: ResponseSource.SOP,
        content: resolveResult.reply ?? 'Baik.',
        confidence: 0.9,
        cost: 0,
        metadata: { reason: 'resolver_no_llm', resolvedAction: resolveResult.action },
      });
    }

    // ── BAGIAN 1: Normalizer — lowercase + squash repeats + slang dict ──
    // Guard: jika pesan fuzzy-match nama produk aktif, jangan dinormalisasi
    const normResult = await normalizeMessage(customerMessage, storeId);
    const normalizedMsg = normResult.normalized;

    // Stage 2.5: Route decision via decideRoute (single source of truth)
    let result: ResponseResult | null = null;

    try {
      const routeCtx = await buildRouteContext(conversationId, storeId, normalizedMsg, customerCity);
      const route = await decideRoute(routeCtx);

      if (route.kind === 'order_change' && routeCtx.activeOrder) {
        const option = await fallbackService.handleOrderChangeRequest(
          context, customerMessage, routeCtx.activeOrder.orderStatus
        );
        result = this.buildResult(conversationId, option);
      } else if (route.kind === 'cart_modify' && route.remove) {
        // BAGIAN 2.4 — Snapshot previousCart sebelum mutasi
        const cartBeforeMutation = [...routeCtx.cart];
        const updatedItems = await conversationContextService.modifyCart(conversationId, 'remove', {
          cancelledProduct: route.remove[0],
        });
        await orderService.syncCartStateToDraftOrder(conversationId, storeId, customerId, updatedItems, null);

        // Store previousMutation for potential rollback
        await this.storePreviousMutation(conversationId, cartBeforeMutation, normalizedMsg);

        const replyText = await this.renderCartSummary(conversationId, updatedItems, route.remove[0]);
        result = this.buildModifyCartResult(conversationId, replyText);
      } else if (route.kind === 'cart_clarify') {
        // BAGIAN 1.3 & 1.4 — Destructive guard / negation rollback
        if (route.intent === 'ROLLBACK' && routeCtx.previousMutation) {
          // Rollback to snapshot
          const restoredItems = await conversationContextService.restoreCart(conversationId, routeCtx.previousMutation.cartSnapshot);
          await orderService.syncCartStateToDraftOrder(conversationId, storeId, customerId, restoredItems, null);
          const cartSummary = restoredItems.length > 0
            ? restoredItems.map(i => `• ${i.product} ×${typeof i.qty === 'number' ? i.qty : 1}`).join('\n')
            : 'keranjang kosong';
          const replyText = `Oke Kak, aku batalkan perubahan terakhir ya. *Keranjang sebelumnya* sudah dipulihkan:\n\n${cartSummary}`;
          result = this.buildModifyCartResult(conversationId, replyText);
        } else {
          // Clarification needed — set pending BEFORE sending question (BAGIAN 2.2)
          await conversationContextService.setPendingClarification(conversationId, {
            question: 'Maaf Kak, bisa dijelaskan produk yang ingin diubah?',
            options: [{ id: '0', label: 'tolong spesifikkan produk yang ingin dihapus' }],
            expected_type: 'yes_no',
          });
          const replyText = `Maaf Kak, bisa dijelaskan produk yang ingin diubah? Misalnya: "Hapus Wortel ya" atau "Ganti Brambang dengan Kentang".`;
          result = this.buildResult(conversationId, {
            source: ResponseSource.SOP,
            content: replyText,
            confidence: 0.7,
            cost: 0,
            metadata: { reason: 'clarification_needed' },
          });
        }
      }
      // For 'total', 'order_status', 'waterfall' -> fall through to waterfall below
    } catch (err) {
      adapters.logger.warn('decideRoute failed, falling through to waterfall', { conversationId, err });
    }

// Stage 3 — Buy signal detection
    const isBuySignal = !result && await fallbackService.detectBuySignal(normalizedMsg);
    const hasPendingAmbiguity = !result && await fallbackService.hasPendingAmbiguity(conversationId);

    if (!result && (isBuySignal || hasPendingAmbiguity)) {
      result = await fallbackService.resolveBuySignal(context, normalizedMsg);
    }
    if (!result) {
      result = await fallbackService.getResponse(context, normalizedMsg, true, customerCity);
    }

    // ── BAGIAN 3: One-shot interpreter — only if normalizer + tier + resolver ALL miss ──
    // I8: max 1 LLM call per message — proof via token-tracker
    if (!result) {
      const llmCalls = await countLlmCallsInWindow(conversationId, 120_000);
      if (llmCalls === 0) {
        const ctxRow = await prisma.conversationContext.findUnique({
          where: { conversationId },
          select: { extractedEntities: true },
        });
        const entities = conversationContextService.parseExtractedEntities(ctxRow?.extractedEntities);
        const cart = entities.confirmedItems || [];
        const activeOrder = await prisma.order.findFirst({
          where: { conversationId, deletedAt: null, orderStatus: { notIn: ['shipped', 'delivered', 'cancelled'] } },
          orderBy: { createdAt: 'desc' },
          select: { id: true, orderStatus: true, items: true, notes: true },
        });

        const interpreterResult = await interpretMessage(
          conversationId,
          storeId,
          normalizedMsg,
          cart.map((i) => ({
            product: i.product,
            qty: typeof i.qty === 'number' ? i.qty : undefined,
            price: i.price ?? undefined,
          })),
          activeOrder as any,
          customerCity
        );

        if (interpreterResult) {
          // If interpreter returned a clarification → SET pending BEFORE reply
          if (interpreterResult.clarification) {
            await conversationContextService.setPendingClarification(
              conversationId,
              buildPendingFromClarification(interpreterResult.clarification)
            );
          }

          // Intent data → render from DB state (reply_draft is style only)
          const addOps = (interpreterResult.cart_ops || []).filter((o: any) => o.type === 'add');
          if (interpreterResult.intent === 'ADD_TO_CART' && addOps.length > 0) {
            const addedItems = await conversationContextService.modifyCart(conversationId, 'add', {
              addedProduct: addOps[0].product,
              qty: interpreterResult.order_extract?.items?.[0]?.qty,
            });
            await orderService.syncCartStateToDraftOrder(conversationId, storeId, customerId, addedItems, null);
            // Render cart from DB state
            const reply = await this.renderCartSummary(conversationId, addedItems, addOps[0].product);
            result = this.buildModifyCartResult(conversationId, reply);
          } else if (interpreterResult.reply_draft) {
            // Open intent → reply_draft langsung (maks 2 kalimat, gaya WA)
            result = this.buildResult(conversationId, {
              source: ResponseSource.AI,
              content: interpreterResult.reply_draft,
              confidence: interpreterResult.confidence,
              cost: 0,
              metadata: { source: 'interpreter', intent: interpreterResult.intent },
            });
          }
        }
      } else {
        adapters.logger.warn('Interpreter skipped — LLM call budget exceeded (I8)', { conversationId, llmCalls });
      }
    }
    await this.saveMessage({
      id: crypto.randomUUID(),
      conversationId,
      sender: 'customer',
      content: customerMessage,
      createdAt: new Date(),
    } as ConversationMessage);
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

    // Non-blocking conversational cart: sync confirmed items to draft order.
    // Handles both single confirm (metadata.confirmedProduct) and multi-confirm (metadata.confirmedProducts).
    // BUG-9: gunakan (isBuySignal || hasPendingAmbiguity) karena resolveBuySignal
    // juga bisa berjalan via hasPendingAmbiguity (mis. "kangkung sama bawang aja").
    if ((isBuySignal || hasPendingAmbiguity) && result.source === ResponseSource.PRODUCT) {
      const meta = result.metadata || {};
      if (meta.confirmedProduct) {
        await this.syncConfirmedItemToCart(conversationId, storeId, customerId, meta.confirmedProduct as string);
      } else if (meta.confirmedProducts) {
        for (const name of meta.confirmedProducts as string[]) {
          await this.syncConfirmedItemToCart(conversationId, storeId, customerId, name);
        }
      }
    }

    // Done-ordering signal → finalize draft order to waiting_address
if (orderService.detectDoneOrdering(normalizedMsg)) {
      await orderService.finalizeDraftOrder(conversationId);
    }

    return result;

  }

  /**
   * Bungkus teks balasan MODIFY_CART menjadi ResponseResult standar.
   */
  /** BAGIAN 2.4 — Store previousCart snapshot untuk rollback */
  private async storePreviousMutation(
    conversationId: string,
    cartSnapshot: ConfirmedItemLike[],
    message: string
  ): Promise<void> {
    try {
      const ctxRow = await prisma.conversationContext.findUnique({
        where: { conversationId },
        select: { extractedEntities: true },
      });
      const entities = (ctxRow?.extractedEntities as Record<string, unknown>) || {};
      await prisma.conversationContext.update({
        where: { conversationId },
        data: {
          extractedEntities: {
            ...entities,
            previousMutation: { cartSnapshot, message },
          } as any,
        },
      });
    } catch (e) {
      adapters.logger.warn('Failed to store previousMutation', { error: (e as Error).message });
    }
  }

  /** BAGIAN 2.5 — Render cart state dari DB (bukan dari memory) */
  private async renderCartSummary(
    conversationId: string,
    currentItems: ConfirmedItem[],
    removedItemName?: string
  ): Promise<string> {
    let replyText: string;
    if (removedItemName) {
      replyText = `Oke Kak, *${removedItemName}* sudah dihapus dari keranjang ya. 🛒`;
    } else {
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
    } else {
      replyText += '\n\nKeranjang Kakak sekarang kosong. Mau cari produk lain? 😊';
    }
    return replyText;
  }

  private buildModifyCartResult(conversationId: string, replyText: string): ResponseResult {
    const msg: ConversationMessage = {
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

  private buildResult(conversationId: string, option: { source: ResponseSource; content: string; confidence: number; cost: number; metadata?: Record<string, any> }): ResponseResult {
    const msg: ConversationMessage = {
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


  private async getOrCreateContext(
    storeId: string,
    customerId: string,
    conversationId: string,
    newMessage: string
  ): Promise<ConversationContext> {

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
        sender: m.role === 'user' ? 'customer' : 'assistant' as const,
        content: m.content,
        source: (m.source as ResponseSource) || undefined,
        cost: m.costUSD,
        createdAt: m.createdAt,
      })),
      {
        id: crypto.randomUUID(),
        conversationId,
        sender: 'customer' as const,
        content: newMessage,
        createdAt: new Date(),
      },
    ];

    return {
      storeId,
      customerId,
      conversationId,
      messages: allMessages as ConversationMessage[],
      lastMessageAt: new Date(),
      status: 'active',
    };
  }

  private async saveMessage(message: ConversationMessage): Promise<void> {
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
    } catch (error) {
      adapters.logger.error('Failed to save message', error as Error);
    }
  }

  /**
   * Sync confirmed items and shipping info from conversation context to draft order.
   */
  private async syncConfirmedItemToCart(
    conversationId: string,
    storeId: string,
    customerId: string,
    productName: string
  ): Promise<void> {
    try {
      const ctx = await prisma.conversationContext.findUnique({
        where: { conversationId },
        select: { extractedEntities: true },
      });

      if (!ctx?.extractedEntities) return;

      const raw = ctx.extractedEntities as Record<string, unknown> | null;
      if (!raw || Array.isArray(raw)) return;

      const confirmed = Array.isArray(raw.confirmedItems)
        ? raw.confirmedItems as ConfirmedItem[]
        : [];
      const shippingAddress = typeof raw.shippingAddress === 'string' ? raw.shippingAddress : null;

      await orderService.syncCartStateToDraftOrder(
        conversationId,
        storeId,
        customerId,
        confirmed,
        shippingAddress
      );
    } catch (error) {
      adapters.logger.warn('Failed to sync confirmed item to cart', {
        conversationId,
        productName,
        error: (error as Error).message,
      });
    }
  }

  private async updateConversationStats(
    context: ConversationContext,
    result: ResponseResult
  ): Promise<void> {
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
    } catch {
      adapters.logger.warn('Failed to update conversation stats');
    }
  }

  // ============================================================
  // Phase 1.9.2 — Context-aware conversation methods
  // ============================================================

  /**
   * Ambil percakapan lengkap termasuk context dan orders (dengan items).
   */
  async getConversationWithContext(conversationId: string): Promise<ConversationWithContext | null> {
    const conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conv || conv.deletedAt) return null;

    const [context, orders] = await Promise.all([
      conversationContextService.getContext(conversationId),
      orderService.getOrdersByConversation(conversationId),
    ]);

    return this.mapConversationWithContext(conv as any, context, orders);
  }

  /**
   * Buat percakapan baru + inisialisasi context-nya sekaligus.
   */
  async createConversation(
    storeId: string,
    customerId: string,
    customerPhone: string,
    customerName?: string
  ): Promise<ConversationWithContext> {
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
    return this.mapConversationWithContext(conv as any, context, []);
  }

  /**
   * Simpan pesan ke conversation_history DAN sinkronkan ke context
   * (appendMessage + refreshSession).
   */
  async appendMessageWithContext(conversationId: string, role: string, content: string): Promise<void> {
    const message: ConversationMessage = {
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
  async updateConversationStatus(conversationId: string, status: string): Promise<void> {
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
  async getRecentConversations(storeId: string, limit = 50): Promise<ConversationWithContext[]> {
    const limitClamped = Math.min(Math.max(1, limit), 100);
    const convs = await prisma.conversation.findMany({
      where: { storeId, deletedAt: null, status: 'open' },
      orderBy: { lastMessageAt: 'desc' },
      take: limitClamped,
    });

    const results: ConversationWithContext[] = [];
    for (const conv of convs) {
      const [context, orders] = await Promise.all([
        conversationContextService.getContext(conv.id),
        orderService.getOrdersByConversation(conv.id),
      ]);
      results.push(this.mapConversationWithContext(conv as any, context, orders));
    }
    return results;
  }

  // ============================================================
  // Private helpers
  // ============================================================

  private mapConversationWithContext(
    conv: any,
    context: ConversationContextData | null,
    orders: any[]
  ): ConversationWithContext {
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

  async getConversationStats(conversationId: string): Promise<ConversationStats> {
    const messages = await prisma.conversationHistory.findMany({
      where: { conversationId },
    });

    const sourceDistribution: Record<string, number> = {
      cache: 0, faq: 0, knowledge: 0, ai: 0, human: 0, fallback: 0,
    };

    let totalCost = 0;

    messages.forEach((m: any) => {
      if (m.source && m.source in sourceDistribution) {
        sourceDistribution[m.source]++;
      }
      totalCost += m.costUSD || 0;
    });

    return {
      conversationId,
      totalMessages: messages.length,
      sourceDistribution: sourceDistribution as Record<ResponseSource, number>,
      totalCost,
      averageResponseTime: 0,
    };
  }

  async findAllByStore(storeId: string): Promise<ConversationListItem[]> {
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

  async findByIdWithHistory(id: string): Promise<ConversationDetail | null> {
    const conv = await prisma.conversation.findUnique({
      where: { id },
    });
    if (!conv || conv.deletedAt) return null;

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
