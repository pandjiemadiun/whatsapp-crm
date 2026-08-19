/**
 * Message Processor Service — orchestrator utama untuk pipeline pemrosesan
 * pesan WhatsApp.
 *
 * Pipeline:
 * 1. Dedup (messageId cache, 5 menit TTL)
 * 2. Dead-end detection (regex lokal — skip LLM, hanya markRead)
 * 3. Coalescing (buffer 5-15s text, 10-15s media)
 * 4. Priority routing (urgent keywords → VIP)
 * 5. Mutex lock per chat (prevent concurrent processing)
 * 6. Circuit breaker (2 failures → trip → hardcoded apology)
 * 7. Rolling context (last 10 messages)
 * 8. LLM call (fallback chain: cache → FAQ → knowledge → AI)
 * 9. Presence simulation (85% full presence, 15% direct)
 * 10. Send with smart retry (10s → 30s → 2m → drop)
 * 11. Update health metrics
 */
import { adapters } from '../adapters/container.js';
import { conversationService } from '../business/conversation.service.js';
import { messageQueueService, isDeadEnd, isDeadEndWithContext, isUrgent } from './message-queue.service.js';
import { CircuitBreakerService } from './circuit-breaker.service.js';
import { presenceSimulatorService } from './presence-simulator.service.js';
import { entityCacheService } from './entity-cache.service.js';
import { healthMonitorService } from './health-monitor.service.js';
import { gowaAdapter } from '../adapters/whatsapp/gowa.adapter.js';
import { fonnteService } from '../services/fonnte.service.js';
// Smart retry backoff: 10s, 30s, 2m
const RETRY_BACKOFF_MS = [10000, 30000, 120000];
const LLM_TIMEOUT_MS = 12000;
class TimeoutError extends Error {
    constructor(ms) {
        super(`Operation timed out after ${ms}ms`);
        this.name = 'TimeoutError';
    }
}
function timeout(ms) {
    return new Promise((_, reject) => setTimeout(() => reject(new TimeoutError(ms)), ms));
}
export class MessageProcessorService {
    constructor() {
        this.llmCircuitBreaker = new CircuitBreakerService('llm-main', {
            failureThreshold: 2,
            cooldownMs: 60000,
            halfOpenSuccessThreshold: 1,
        });
        healthMonitorService.registerCircuitBreaker(this.llmCircuitBreaker);
        // Set flush handler — dipanggil ketika coalescing buffer timer fires
        messageQueueService.setFlushHandler((msg, sourceMsg) => {
            this.handleFlushed(msg, sourceMsg).catch((err) => adapters.logger.error('Flushed message processing error', err));
        });
    }
    /**
     * Entry point: process a single inbound message through the full pipeline.
     * Called by webhook handlers (GOWA / Fonnte).
     */
    async processMessage(input) {
        const startTime = Date.now();
        const chatId = input.conversationId;
        const raw = {
            id: input.messageId,
            chatId,
            storeId: input.storeId,
            customerId: input.customerId,
            type: 'text',
            content: input.text,
            receivedAt: startTime,
        };
        // 1. Dedup — drop silently on reconnects (Redis NX+EX, tenant-scoped)
        if (await messageQueueService.isDuplicate(input.storeId, raw.id)) {
            adapters.logger.debug('Duplicate message dropped', { chatId, messageId: raw.id });
            return null;
        }
        // 2. Dead-end detection — hanya markRead, skip LLM
        // Tapi: jika last AI message adalah order funnel context, bypass dead-end
        let lastAiMessage;
        if (isDeadEnd(raw.content)) {
            try {
                const { prisma } = await import('../infrastructure/prisma.js');
                const lastAi = await prisma.conversationHistory.findFirst({
                    where: { conversationId: chatId, role: 'assistant' },
                    orderBy: { createdAt: 'desc' },
                    select: { content: true },
                });
                lastAiMessage = lastAi?.content;
            }
            catch {
                // ignore lookup error
            }
        }
        if (isDeadEndWithContext(raw.content, lastAiMessage)) {
            adapters.logger.debug('Dead-end message, marking read only', { chatId, text: raw.content });
            await this.markRead(input);
            return null;
        }
        // 3. Priority check
        const priority = isUrgent(raw.content) ? 'urgent' : 'normal';
        const queued = {
            ...raw,
            priority,
            attempts: 0,
            isUgc: false,
            gateway: input.gateway,
            deviceId: input.deviceId,
            token: input.token,
            inboxId: input.inboxId,
            storeTimezone: input.storeTimezone,
        };
        // 4. Coalescing — buffer text 5-15s, media 10-15s
        // Urgent messages bypass buffer (bufferMessage returns false)
        const buffered = messageQueueService.bufferMessage(queued);
        if (buffered) {
            adapters.logger.debug('Message buffered for coalescing', { chatId, priority });
            return null; // Timer akan memanggil flushHandler untuk proses batch
        }
        // 5. Mutex lock per chat — prevent concurrent processing
        const release = messageQueueService.acquireLock(chatId);
        if (!release) {
            adapters.logger.debug('Chat locked, skipping', { chatId });
            return null;
        }
        try {
            return await this.processWithLock(chatId, { ...queued }, input);
        }
        finally {
            release();
        }
    }
    /**
     * Handle flushed message from coalescing buffer (timer fired).
     * Reconstructs ProcessMessageInput from the buffered message and processes.
     */
    async handleFlushed(msg, sourceMsg) {
        const chatId = msg.chatId;
        const release = messageQueueService.acquireLock(chatId);
        if (!release) {
            adapters.logger.debug('Chat locked when processing flushed batch', { chatId });
            return;
        }
        const input = {
            storeId: msg.storeId,
            customerId: msg.customerId,
            customerPhone: msg.customerId,
            conversationId: msg.chatId,
            text: msg.content,
            messageId: msg.id,
            gateway: sourceMsg.gateway,
            deviceId: sourceMsg.deviceId,
            token: sourceMsg.token,
            inboxId: sourceMsg.inboxId,
            storeTimezone: sourceMsg.storeTimezone,
        };
        try {
            await this.processWithLock(chatId, msg, input);
        }
        finally {
            release();
        }
    }
    /**
     * Process a message while holding the per-chat mutex lock.
     */
    async processWithLock(chatId, msg, input) {
        const startTime = Date.now();
        // 6. Circuit breaker check — jika terbuka, kirim hardcoded apology
        if (!this.llmCircuitBreaker.isAvailable()) {
            const fallbackMsg = this.llmCircuitBreaker.getFallbackMessage();
            await this.sendWithPresence(input, fallbackMsg);
            this.notifyHumanTakeover(input);
            return {
                message: fallbackMsg,
                source: 'human',
                confidence: 1.0,
                cost: 0,
                requiresHumanReview: true,
                elapsedMs: Date.now() - startTime,
                usedCircuitBreaker: true,
                usedFallback: true,
            };
        }
        // Channel-aware validation (P-PWA.4) — before creating/upserting Conversation.
        // WA: customerPhone wajib; Web: Customer.webUid wajib. Diletakkan sekali
        // di funnel ini (dipanggil baik path awal :166 maupun retry via handleFlushed :200),
        // sebelum create Conversation di :238. Jalur WA existing selalu nyalurkan
        // customerPhone (dari fromJid/sender) sehingga guard tidak pernah trigger.
        const channel = input.channel ?? 'whatsapp';
        if (channel === 'whatsapp' && !input.customerPhone) {
            throw new Error(`customerPhone required for whatsapp channel (storeId=${input.storeId}, conversationId=${input.conversationId})`);
        }
        if (channel === 'web' && !input.webUid) {
            throw new Error(`webUid required for web channel (storeId=${input.storeId}, conversationId=${input.conversationId})`);
        }
        // 7. Call conversation service (handles context + fallback chain)
        let result;
        try {
            result = await this.llmCircuitBreaker.wrap(() => conversationService.processCustomerMessage(input.storeId, input.customerId, input.conversationId, msg.content, channel, input.messageId));
        }
        catch (err) {
            this.llmCircuitBreaker.recordFailure();
            adapters.logger.error('LLM pipeline failed', err, { chatId });
            const fallbackMsg = this.llmCircuitBreaker.getFallbackMessage();
            await this.sendWithPresence(input, fallbackMsg);
            this.notifyHumanTakeover(input);
            return {
                message: fallbackMsg,
                source: 'human',
                confidence: 1.0,
                cost: 0,
                requiresHumanReview: true,
                elapsedMs: Date.now() - startTime,
                usedCircuitBreaker: true,
                usedFallback: true,
            };
        }
        if (!result || !result.message) {
            // Human takeover: AI tidak boleh membalas. Mark read saja.
            await this.markRead(input);
            adapters.logger.debug('No response from pipeline (human takeover?)', { chatId });
            return null;
        }
        // Skip send if content is empty (e.g. dead-end detected in fallback)
        if (!result.message.content) {
            adapters.logger.debug('Empty response content, skipping send', { chatId });
            return null;
        }
        // 8. Send with presence simulation + smart retry
        await this.sendWithPresence(input, result.message.content);
        // 9. QRIS image follow-up (pengiriman setelah teks payment response)
        if (result.source === 'payment' && result.metadata?.qrisImageUrl) {
            await this.sendQrisFollowUp(input, result.metadata.qrisImageUrl);
        }
        healthMonitorService.updateQueueDepth(messageQueueService.getStats().activeQueues);
        return {
            message: result.message.content,
            source: result.source,
            confidence: result.confidence,
            cost: result.cost,
            requiresHumanReview: result.requiresHumanReview,
            elapsedMs: Date.now() - startTime,
            usedCircuitBreaker: false,
            usedFallback: false,
        };
    }
    /**
     * 8. Presence simulation + proportional delay + smart retry send.
     */
    async sendWithPresence(input, content) {
        const gateway = this.getGateway(input.gateway);
        const isNightMode = presenceSimulatorService.isNightMode({
            timezone: input.storeTimezone || 'Asia/Jakarta',
        });
        // Update entity cache (profile fetch)
        const profile = await entityCacheService.getCustomerProfile(input.storeId, input.customerId);
        const customerInfo = {
            avgResponseTimeMs: profile ? undefined : undefined,
        };
        const simulation = await presenceSimulatorService.simulateResponse({
            store: { timezone: input.storeTimezone || 'Asia/Jakarta' },
            customer: customerInfo,
            content,
            gateway: gateway
                ? {
                    markRead: async (phone) => {
                        if (gateway && typeof gateway.markRead === 'function') {
                            await gateway.markRead(phone, input.deviceId);
                        }
                    },
                    setPresence: async (phone, state) => {
                        if (gateway && typeof gateway.setPresence === 'function') {
                            await gateway.setPresence(phone, state, input.deviceId);
                        }
                    },
                }
                : undefined,
            phone: input.customerPhone,
        });
        // Wait before sending (human-like delay)
        const effectiveDelay = healthMonitorService.getMetrics().safeMode
            ? simulation.delay * 2
            : simulation.delay;
        await this.sleep(effectiveDelay);
        // 9. Smart retry send
        const sendConfig = {
            deviceId: input.deviceId,
            token: input.token,
            inboxid: input.inboxId,
        };
        await this.smartRetrySend(input.customerPhone, content, sendConfig, input.gateway);
    }
    /**
     * Mark message as read (for dead-end messages dan presence flow).
     */
    async markRead(input) {
        const gateway = this.getGateway(input.gateway);
        if (gateway && typeof gateway.markRead === 'function') {
            try {
                await gateway.markRead(input.customerPhone, input.deviceId);
            }
            catch (err) {
                adapters.logger.warn('markRead failed', err);
            }
        }
    }
    /**
     * 9. QRIS follow-up — kirim gambar QRIS atau teks link tergantung gateway dan paket Fonnte.
     * - Fonnte free plan (fonnteMediaEnabled !== true): kirim teks link, JANGAN coba image.
     * - Fonnte paid plan (fonnteMediaEnabled = true): coba sendImage, fallback ke teks link.
     * - GOWA: coba native image, fallback ke teks link.
     * Semua jalur gagal → log warn.
     */
    async sendQrisFollowUp(input, imageUrl) {
        if (!imageUrl)
            return;
        const textLink = `Berikut QRIS kami, silakan klik untuk melihat: ${process.env.PUBLIC_API_URL || 'https://api.qlobot.web.id'}/r/${input.storeId}`;
        const gateway = this.getGateway(input.gateway);
        try {
            if (input.gateway === 'fonnte' && input.token) {
                const { prisma } = await import('../infrastructure/prisma.js');
                const store = await prisma.store.findUnique({
                    where: { id: input.storeId },
                    select: { config: true },
                });
                const fonnteMediaEnabled = !!store?.config?.fonnteMediaEnabled;
                if (!fonnteMediaEnabled) {
                    // Free plan — image tidak didukung, kirim teks link
                    const { fonnteService } = await import('./fonnte.service.js');
                    await fonnteService.sendMessage(input.customerPhone, textLink, { token: input.token, inboxid: input.inboxId });
                    adapters.logger.info('Fonnte free plan (no media): sent QRIS as text link', { conversationId: input.conversationId });
                    return;
                }
                // Paid plan — coba kirim gambar
                try {
                    const { fonnteService } = await import('./fonnte.service.js');
                    await fonnteService.sendImageWithToken(input.customerPhone, imageUrl, input.token, textLink);
                    adapters.logger.info('Fonnte image sent', { conversationId: input.conversationId });
                }
                catch (imgErr) {
                    adapters.logger.warn('Fonnte sendImage failed on media-enabled account, falling back to text link', {
                        conversationId: input.conversationId,
                        error: imgErr.message,
                    });
                    const { fonnteService } = await import('./fonnte.service.js');
                    await fonnteService.sendMessage(input.customerPhone, textLink, { token: input.token, inboxid: input.inboxId });
                }
            }
            else if (gateway && typeof gateway.sendImage === 'function') {
                // GOWA — native image support
                try {
                    await gateway.sendImage(input.customerPhone, imageUrl, textLink);
                    adapters.logger.info('GOWA image sent', { conversationId: input.conversationId });
                }
                catch (gowaErr) {
                    adapters.logger.warn('GOWA sendImage failed, falling back to text link', {
                        conversationId: input.conversationId,
                        error: gowaErr.message,
                    });
                    await gateway.sendMessage(input.customerPhone, textLink, { deviceId: input.deviceId });
                }
            }
            else {
                adapters.logger.warn('QRIS image not supported for this gateway, sending text link', {
                    conversationId: input.conversationId,
                    gateway: input.gateway,
                });
                if (gateway) {
                    await gateway.sendMessage(input.customerPhone, textLink, { token: input.token, inboxid: input.inboxId, deviceId: input.deviceId });
                }
            }
        }
        catch (err) {
            adapters.logger.warn('QRIS follow-up failed entirely', { conversationId: input.conversationId, error: err.message });
        }
    }
    /**
     * Smart retry dengan bounded exponential backoff.
     * Schedule: 10s, 30s, 2m → drop setelah 3 kegagalan.
     */
    async smartRetrySend(phone, content, config, gatewayType) {
        const gateway = this.getGateway(gatewayType);
        let lastError = null;
        for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt++) {
            try {
                if (!gateway) {
                    throw new Error(`Gateway ${gatewayType} not configured`);
                }
                await gateway.sendMessage(phone, content, config);
                return; // success
            }
            catch (err) {
                lastError = err;
                healthMonitorService.recordSendTimeout();
                adapters.logger.warn(`Send attempt ${attempt + 1} failed`, {
                    phone,
                    error: lastError.message,
                    gatewayType,
                });
                if (attempt < RETRY_BACKOFF_MS.length) {
                    const delay = RETRY_BACKOFF_MS[attempt];
                    adapters.logger.info(`Retrying send in ${delay / 1000}s`, { phone, attempt: attempt + 1 });
                    await this.sleep(delay);
                }
            }
        }
        adapters.logger.error('Send failed after all retries, dropping message', lastError, {
            phone,
            gatewayType,
        });
    }
    /**
     * Mark conversation for human takeover (circuit breaker terbuka).
     */
    async notifyHumanTakeover(input) {
        try {
            const { prisma } = await import('../infrastructure/prisma.js');
            await prisma.conversation.update({
                where: { id: input.conversationId },
                data: {
                    status: 'human_takeover',
                    humanTakeoverAt: new Date(),
                },
            });
        }
        catch (err) {
            adapters.logger.warn('Failed to mark human takeover', err);
        }
    }
    getGateway(gateway) {
        return gateway === 'gowa' ? gowaAdapter : fonnteService;
    }
    async sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    /** Graceful shutdown — drain pending buffers + reset state */
    async shutdown() {
        messageQueueService.cleanup();
        this.llmCircuitBreaker.reset();
        entityCacheService.clear();
        adapters.logger.info('MessageProcessorService shutdown complete');
    }
    /** Public access to circuit breaker metrics */
    getCircuitBreakerMetrics() {
        return this.llmCircuitBreaker.getMetrics();
    }
}
export const messageProcessorService = new MessageProcessorService();
//# sourceMappingURL=message-processor.service.js.map