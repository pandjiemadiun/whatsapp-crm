import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { conversationService } from '../business/conversation.service.js';
import { fonnteService } from '../services/fonnte.service.js';
import { gowaAdapter } from '../adapters/whatsapp/gowa.adapter.js';
import { adapters } from '../adapters/container.js';
import { prisma } from '../infrastructure/prisma.js';
import { validateRequest, getValidated } from '../middleware/validate-request.js';
import { updateStatusSchema, replyMessageSchema } from '../schemas/index.js';
import { sanitizeMessage } from '../lib/sanitize.js';
import { eventBus } from '../services/event-bus.service.js';
const router = Router();
router.use(authMiddleware);
// GET /api/conversations — List conversations for the authenticated store
router.get('/', async (req, res) => {
    try {
        const storeId = req.user.storeId;
        const conversations = await conversationService.findAllByStore(storeId);
        // FASE 3: server-side unreadCount per conversation (admin inbox badge).
        // unread = customer (role='user') messages created AFTER adminLastReadAt,
        // stored in Conversation.metadata JSON — NO schema migration (RAILS constraint).
        // Client must NOT compute unread (CRITICAL read/unread rule).
        if (conversations.length) {
            const ids = conversations.map((c) => c.id);
            // batch fetch metadata (adminLastReadAt) + all customer messages for these convs
            const metas = await prisma.conversation.findMany({
                where: { id: { in: ids } },
                select: { id: true, metadata: true },
            });
            const metaById = new Map(metas.map((m) => [
                m.id,
                m.metadata && typeof m.metadata === 'object'
                    ? m.metadata
                    : {},
            ]));
            const userMsgs = await prisma.conversationHistory.findMany({
                where: { conversationId: { in: ids }, role: 'user' },
                select: { conversationId: true, createdAt: true },
            });
            for (const c of conversations) {
                const m = metaById.get(c.id) ?? {};
                const readAt = m.adminLastReadAt
                    ? new Date(m.adminLastReadAt)
                    : new Date(0);
                c.unreadCount = userMsgs.filter((x) => x.conversationId === c.id && x.createdAt > readAt).length;
            }
        }
        res.json({ success: true, data: conversations });
    }
    catch (error) {
        adapters.logger.error('Failed to fetch conversations', error);
        res.status(500).json({ error: error?.message || 'Failed to fetch conversations' });
    }
});
// GET /api/conversations/:id — Get conversation with history (ownership verified)
router.get('/:id', async (req, res) => {
    try {
        const storeId = req.user.storeId;
        const conversation = await prisma.conversation.findFirst({
            where: { id: req.params.id, storeId, deletedAt: null },
        });
        if (!conversation) {
            return res.status(404).json({ error: 'Conversation not found' });
        }
        const history = await prisma.conversationHistory.findMany({
            where: { conversationId: req.params.id },
            orderBy: { createdAt: 'asc' },
            select: {
                id: true,
                role: true,
                content: true,
                source: true,
                messageType: true,
                metadata: true,
                createdAt: true,
            },
        });
        res.json({
            success: true,
            data: {
                id: conversation.id,
                customerId: conversation.customerId,
                customerName: conversation.customerName,
                customerPhone: conversation.customerPhone,
                status: conversation.status,
                lastMessageAt: conversation.lastMessageAt,
                aiResponseCount: conversation.aiResponseCount,
                faqResponseCount: conversation.faqResponseCount,
                history,
            },
        });
    }
    catch (error) {
        adapters.logger.error('Failed to fetch conversation', error);
        res.status(500).json({ error: error?.message || 'Failed to fetch conversation' });
    }
});
// PUT /api/conversations/:id/status — Update conversation status (e.g. human_takeover)
router.put('/:id/status', validateRequest(updateStatusSchema, 'body'), async (req, res) => {
    try {
        const storeId = req.user.storeId;
        const { status } = getValidated(req);
        const conversation = await prisma.conversation.findFirst({
            where: { id: req.params.id, storeId, deletedAt: null },
        });
        if (!conversation) {
            return res.status(404).json({ error: 'Conversation not found' });
        }
        const updateData = { status };
        if (status === 'human_takeover') {
            updateData.humanTakeoverAt = new Date();
        }
        else if (status === 'open') {
            updateData.humanTakeoverAt = null;
        }
        else if (status === 'resolved') {
            updateData.resolvedAt = new Date();
        }
        await prisma.conversation.update({
            where: { id: req.params.id },
            data: updateData,
        });
        // FASE 3: publish status-transition events so Dashboard + Web customer react
        // realtime. conversationId tetap sama (no new conversation created).
        const convId = req.params.id;
        if (status === 'human_takeover') {
            eventBus.publish({
                event: 'conversation.handoff',
                storeId,
                data: { conversationId: convId, status: 'human_takeover' },
                ts: Date.now(),
            });
        }
        else if (status === 'open') {
            eventBus.publish({
                event: 'conversation.resumed',
                storeId,
                data: { conversationId: convId, status: 'open' },
                ts: Date.now(),
            });
        }
        else if (status === 'resolved') {
            eventBus.publish({
                event: 'conversation.resolved',
                storeId,
                data: { conversationId: convId, status: 'resolved', resolvedAt: updateData.resolvedAt },
                ts: Date.now(),
            });
        }
        // conversation.updated for all status changes (incremental list refresh).
        eventBus.publish({
            event: 'conversation.updated',
            storeId,
            data: {
                conversationId: convId,
                status,
                lastMessageAt: conversation.lastMessageAt ?? new Date(),
            },
            ts: Date.now(),
        });
        res.json({ success: true, message: `Status updated to ${status}` });
    }
    catch (error) {
        adapters.logger.error('Failed to update conversation status', error);
        res.status(500).json({ error: error?.message || 'Failed to update status' });
    }
});
// POST /api/conversations/:id/reply — Send manual reply from agent
router.post('/:id/reply', validateRequest(replyMessageSchema, 'body'), async (req, res) => {
    try {
        const storeId = req.user.storeId;
        const { message } = getValidated(req);
        const conversation = await prisma.conversation.findFirst({
            where: { id: req.params.id, storeId, deletedAt: null },
        });
        if (!conversation) {
            return res.status(404).json({ error: 'Conversation not found' });
        }
        // Save to conversation history (sanitized) — SINGLE INSERT (CRITICAL RULE #1).
        const sanitizedContent = sanitizeMessage(message);
        const historyMsg = await prisma.conversationHistory.create({
            data: {
                conversationId: conversation.id,
                role: 'agent',
                content: sanitizedContent,
                source: 'dashboard',
            },
        });
        // Take over conversation: set status to human_takeover (ADR-011)
        await prisma.conversation.update({
            where: { id: conversation.id },
            data: {
                lastMessageAt: new Date(),
                status: 'human_takeover',
                humanTakeoverAt: new Date(),
            },
        });
        // CRITICAL RULE #4: Web vs WhatsApp delivery.
        // Web (customerPhone=null, no WA number): SKIP Fonnte/GOWA — deliver via WS
        // (message.created published below). WA: keep existing Fonete/GOWA by customerPhone.
        let sendError = null;
        if (conversation.channel !== 'web') {
            const store = await prisma.store.findUnique({ where: { id: storeId } });
            if (store?.fonnteToken) {
                try {
                    if (!conversation.customerPhone) {
                        adapters.logger.warn('Skip Fonnte send: conversation.customerPhone is null', { conversationId: conversation.id, storeId });
                    }
                    else {
                        await fonnteService.sendMessage(conversation.customerPhone, sanitizedContent, {
                            token: store.fonnteToken,
                        });
                    }
                }
                catch {
                    sendError = 'Fonnte send failed';
                }
            }
            else if (store?.phoneNumber) {
                try {
                    // Fallback to GOWA if store has a WhatsApp number configured
                    if (!conversation.customerPhone) {
                        adapters.logger.warn('Skip GOWA send: conversation.customerPhone is null', { conversationId: conversation.id, storeId });
                    }
                    else {
                        const did = `garuda-${storeId.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 20)}`;
                        await gowaAdapter.sendMessage(conversation.customerPhone, sanitizedContent, {
                            deviceId: did,
                        });
                    }
                }
                catch {
                    sendError = 'GOWA send failed';
                }
            }
            else {
                sendError = 'No WhatsApp gateway configured for this store';
            }
        }
        // CRITICAL RULE #1 (WS = ZERO INSERT): WS transport only — use the DB row id
        // (historyMsg.id) as the canonical message identity (CRITICAL RULE #2).
        // DB role stays 'agent' (existing semantics); WS canonical sender = 'human_agent'
        // (CRITICAL RULE #5). type = 'text' (admin reply is never structured).
        eventBus.publish({
            event: 'message.created',
            storeId,
            data: {
                id: historyMsg.id,
                conversationId: conversation.id,
                sender: 'human_agent',
                type: 'text',
                payload: null,
                content: sanitizedContent,
                source: 'dashboard',
                confidence: null,
                createdAt: historyMsg.createdAt,
            },
            ts: Date.now(),
        });
        eventBus.publish({
            event: 'conversation.updated',
            storeId,
            data: {
                conversationId: conversation.id,
                status: 'human_takeover',
                lastMessageAt: new Date(),
            },
            ts: Date.now(),
        });
        res.json({
            success: true,
            message: 'Reply sent',
            sendError,
            messageId: historyMsg.id, // = conversation_history.id = WS event.data.id (HARD RULE #3)
        });
    }
    catch (error) {
        adapters.logger.error('Failed to send reply', error);
        res.status(500).json({ error: error?.message || 'Failed to send reply' });
    }
});
// POST /api/conversations/:id/read — admin marks conversation read.
// FASE 3: NO migration — persist into Conversation.metadata JSON (adminLastReadAt).
// Read ack must NOT create a conversation_history row (NO message event).
router.post('/:id/read', async (req, res) => {
    try {
        const storeId = req.user.storeId;
        const { at } = (req.body ?? {});
        const conversation = await prisma.conversation.findFirst({
            where: { id: req.params.id, storeId, deletedAt: null },
        });
        if (!conversation) {
            return res.status(404).json({ error: 'Conversation not found' });
        }
        const readAt = at ? new Date(at) : new Date();
        const existingMeta = conversation.metadata && typeof conversation.metadata === 'object'
            ? conversation.metadata
            : {};
        await prisma.conversation.update({
            where: { id: req.params.id },
            data: {
                metadata: { ...existingMeta, adminLastReadAt: readAt.toISOString() },
            },
        });
        // Notify Dashboard + Web customer that read state changed (incremental, no reload).
        eventBus.publish({
            event: 'conversation.updated',
            storeId,
            data: {
                conversationId: req.params.id,
                status: conversation.status,
                lastMessageAt: conversation.lastMessageAt,
                adminLastReadAt: readAt.toISOString(),
            },
            ts: Date.now(),
        });
        res.json({ success: true, adminLastReadAt: readAt.toISOString() });
    }
    catch (error) {
        adapters.logger.error('Failed to mark conversation read', error);
        res.status(500).json({ error: error?.message || 'Failed to mark read' });
    }
});
export default router;
//# sourceMappingURL=conversations.js.map