import express from 'express';
import { messageProcessorService } from '../services/message-processor.service.js';
import { adapters } from '../adapters/container.js';
import { prisma } from '../infrastructure/prisma.js';
import { webhookLimiter } from '../middleware/rate-limiters.js';
import { gowaTrustMiddleware } from '../middleware/gowa-trust.js';
import { getEncryptionKey, hashField } from '../utils/encryption.js';
const router = express.Router();
/**
 * Normalize phone number to international format (62xxx)
 * Converts 0xxx → 62xxx
 */
function normalizePhoneNumber(phoneNumber) {
    if (!phoneNumber)
        return '';
    const cleaned = phoneNumber.replace(/\D/g, '');
    if (cleaned.startsWith('0'))
        return '62' + cleaned.substring(1);
    if (cleaned.startsWith('62'))
        return cleaned;
    return '62' + cleaned;
}
// POST /api/webhooks/gowa — Receive incoming messages from GOWA
// GOWA trust boundary (G2-B.2): only loopback sources allowed.
router.post('/gowa', gowaTrustMiddleware, webhookLimiter, async (req, res) => {
    // Always respond 200 immediately to prevent retries
    res.status(200).json({ status: 'ok' });
    try {
        const body = req.body;
        const event = body.event;
        const payload = body.payload || {};
        // Only process text messages from other people (not ourselves)
        if (event !== 'message' || payload.is_from_me)
            return;
        // Guard: reject group messages — only handle DMs
        const chatId = payload.chat_id || '';
        if (chatId.endsWith('@g.us')) {
            adapters.logger.debug('Ignoring group message', { chatId });
            return;
        }
        // Guard: must have text content
        const text = (payload.body || '').trim();
        if (!text) {
            adapters.logger.debug('Ignoring non-text message', { chatId });
            return;
        }
        // Extract customer phone from sender JID
        const fromJid = payload.from || '';
        const customerPhone = fromJid.replace(/@.*$/, '');
        // Bot number comes from device_id
        const deviceId = body.device_id || '';
        const botNumberRaw = deviceId.replace(/@.*$/, '');
        if (!botNumberRaw) {
            adapters.logger.warn('Could not determine bot number from GOWA payload, skipping');
            return;
        }
        // Look up store by the bot's WhatsApp number.
        // phoneNumber is encrypted at rest (AES-256-GCM, random IV), so we look up
        // by the deterministic hash column instead of the encrypted value.
        const key = await getEncryptionKey();
        const botNumberHash = hashField(botNumberRaw, key);
        const store = await prisma.store.findFirst({
            where: { phoneNumberHash: botNumberHash, isActive: true, deletedAt: null },
        });
        if (!store) {
            adapters.logger.warn('No store found for bot number', { botNumber: botNumberRaw });
            return;
        }
        const conversationId = `${store.id}:${customerPhone}`;
        const messageId = payload.id || `${conversationId}:${Date.now()}`;
        // Upsert Customer (GOWA pushName / notifyName)
        const customerName = payload.pushName || payload.notifyName || null;
        try {
            const existingCustomer = await prisma.customer.findUnique({
                where: { storeId_phone: { storeId: store.id, phone: customerPhone } },
            });
            if (existingCustomer) {
                await prisma.customer.update({
                    where: { storeId_phone: { storeId: store.id, phone: customerPhone } },
                    data: {
                        lastSeenAt: new Date(),
                        ...(customerName && !existingCustomer.name ? { name: customerName, nameSource: 'pushname' } : {}),
                    },
                });
            }
            else {
                await prisma.customer.create({
                    data: {
                        storeId: store.id,
                        phone: customerPhone,
                        ...(customerName ? { name: customerName, nameSource: 'pushname' } : {}),
                    },
                });
            }
        }
        catch (err) {
            adapters.logger.warn('Customer upsert failed (GOWA)', { conversationId, error: err.message });
        }
        // Process through full pipeline (dedup → dead-end → coalesce → priority → mutex →
        // circuit breaker → rolling context → LLM → presence simulation → smart retry send)
        const result = await messageProcessorService.processMessage({
            storeId: store.id,
            customerId: customerPhone,
            customerPhone,
            conversationId,
            text,
            messageId,
            gateway: 'gowa',
            channel: 'whatsapp',
            deviceId,
            storeTimezone: store.timezone,
        });
        if (result) {
            adapters.logger.info('GOWA message processed', {
                conversationId,
                source: result.source,
                confidence: result.confidence.toFixed(2),
                elapsedMs: result.elapsedMs,
                usedCircuitBreaker: result.usedCircuitBreaker,
            });
        }
    }
    catch (error) {
        adapters.logger.error('GOWA webhook processing error', error);
    }
});
// POST /api/webhooks/fonnte — Receive incoming messages from Fonnte
router.post('/fonnte', webhookLimiter, async (req, res) => {
    // --- Webhook secret validation (per-store) ---
    // The secret is embedded in the webhook URL that merchants paste into the
    // Fonnte dashboard (?secret=...). Without a matching Store.webhookSecret
    // we reject the request before any processing.
    const webhookSecret = req.query.secret;
    if (!webhookSecret) {
        adapters.logger.warn('Webhook request missing secret');
        return res.status(401).json({ error: 'Webhook secret is required' });
    }
    const store = await prisma.store.findFirst({
        where: { webhookSecret, isActive: true, deletedAt: null },
        select: { id: true, fonnteNumber: true, fonnteToken: true, timezone: true },
    });
    if (!store) {
        adapters.logger.warn('Webhook request invalid secret');
        return res.status(401).json({ error: 'Invalid webhook secret' });
    }
    const body = req.body;
    // Handle system/status events (connect, disconnect, etc.)
    if (body.status === 'connect' || body.status === 'disconnect') {
        adapters.logger.info('Fonnte device status event ignored', { status: body.status });
        return res.status(200).json({ status: 'ignored' });
    }
    // Respond 200 immediately — process async
    res.status(200).json({ status: 'ok' });
    (async () => {
        try {
            // Extract fields from Fonnte payload
            const sender = body.sender || body.pengirim || '';
            const message = body.message || body.text || '';
            const gatewayNumber = body.device || '';
            const inboxId = body.id || body.message_id || null;
            if (!sender || !message || !gatewayNumber) {
                adapters.logger.warn('Fonnte webhook missing required fields', { sender, gatewayNumber });
                return;
            }
            const text = String(message).trim();
            if (!text) {
                adapters.logger.debug('Ignoring non-text message from Fonnte');
                return;
            }
            // Normalize the incoming gateway number and verify it matches
            // the store authenticated by the webhook secret.
            const normalizedGatewayNumber = normalizePhoneNumber(gatewayNumber);
            const storedNormalizedNumber = normalizePhoneNumber(store.fonnteNumber || '');
            if (storedNormalizedNumber !== normalizedGatewayNumber) {
                adapters.logger.warn('Fonnte gateway number mismatch', {
                    expected: storedNormalizedNumber,
                    received: normalizedGatewayNumber,
                    storeId: store.id,
                });
                return;
            }
            // Verify the store has a Fonnte token configured for replies
            if (!store.fonnteToken) {
                adapters.logger.warn('No Fonnte token configured for store', { storeId: store.id });
                return;
            }
            const customerPhone = sender;
            const conversationId = `${store.id}:${customerPhone}`;
            const messageId = body.message_id || `${conversationId}:${Date.now()}`;
            // Extract customer name from Fonnte payload (pushname / name / senderName)
            const customerName = body.name || body.pushname || body.senderName || null;
            // Upsert Customer (track visits, name, pushname fallback)
            try {
                const existingCustomer = await prisma.customer.findUnique({
                    where: { storeId_phone: { storeId: store.id, phone: customerPhone } },
                });
                if (existingCustomer) {
                    await prisma.customer.update({
                        where: { storeId_phone: { storeId: store.id, phone: customerPhone } },
                        data: {
                            lastSeenAt: new Date(),
                            ...(customerName && !existingCustomer.name ? { name: customerName, nameSource: 'pushname' } : {}),
                        },
                    });
                }
                else {
                    await prisma.customer.create({
                        data: {
                            storeId: store.id,
                            phone: customerPhone,
                            ...(customerName ? { name: customerName, nameSource: 'pushname' } : {}),
                        },
                    });
                }
            }
            catch (err) {
                adapters.logger.warn('Customer upsert failed (Fonnte)', { conversationId, error: err.message });
            }
            // Update conversation.customerName if a name was provided and DB value is null/empty
            if (customerName) {
                try {
                    const existing = await prisma.conversation.findUnique({
                        where: { id: conversationId },
                        select: { customerName: true },
                    });
                    if (!existing || !existing.customerName) {
                        await prisma.conversation.upsert({
                            where: { id: conversationId },
                            create: {
                                id: conversationId,
                                storeId: store.id,
                                customerId: customerPhone,
                                customerPhone: customerPhone,
                                customerName: customerName,
                                channel: 'whatsapp',
                                status: 'open',
                            },
                            update: { customerName: customerName },
                        });
                    }
                }
                catch (err) {
                    adapters.logger.warn('Failed to update conversation customerName', { conversationId, storeId: store.id, error: err.message });
                }
            }
            // Process through full pipeline
            const result = await messageProcessorService.processMessage({
                storeId: store.id,
                customerId: customerPhone,
                customerPhone,
                conversationId,
                text,
                messageId,
                gateway: 'fonnte',
                channel: 'whatsapp',
                token: store.fonnteToken,
                inboxId: inboxId ? Number(inboxId) : undefined,
                storeTimezone: store.timezone,
            });
            if (result) {
                adapters.logger.info('Fonnte auto-reply sent', {
                    sender,
                    gatewayNumber,
                    source: result.source,
                    cost: result.cost,
                    elapsedMs: result.elapsedMs,
                });
            }
        }
        catch (error) {
            adapters.logger.error('Fonnte webhook processing error', error);
        }
    })();
});
export default router;
//# sourceMappingURL=webhooks.js.map