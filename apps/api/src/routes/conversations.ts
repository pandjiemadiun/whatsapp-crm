import { Router, Response } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { conversationService } from '../business/conversation.service.js';
import { fonnteService } from '../services/fonnte.service.js';
import { gowaAdapter } from '../adapters/whatsapp/gowa.adapter.js';
import { adapters } from '../adapters/container.js';
import { prisma } from '../infrastructure/prisma.js';
import { validateRequest, getValidated } from '../middleware/validate-request.js';
import { updateStatusSchema, replyMessageSchema } from '../schemas/index.js';
import { sanitizeMessage } from '../lib/sanitize.js';

const router = Router();

router.use(authMiddleware);

// GET /api/conversations — List conversations for the authenticated store
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const storeId = req.user!.storeId;
    const conversations = await conversationService.findAllByStore(storeId);

    res.json({ success: true, data: conversations });
  } catch (error: any) {
    adapters.logger.error('Failed to fetch conversations', error as Error);
    res.status(500).json({ error: error?.message || 'Failed to fetch conversations' });
  }
});

// GET /api/conversations/:id — Get conversation with history (ownership verified)
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const storeId = req.user!.storeId;
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
  } catch (error: any) {
    adapters.logger.error('Failed to fetch conversation', error as Error);
    res.status(500).json({ error: error?.message || 'Failed to fetch conversation' });
  }
});

// PUT /api/conversations/:id/status — Update conversation status (e.g. human_takeover)
router.put('/:id/status', validateRequest(updateStatusSchema, 'body'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const storeId = req.user!.storeId;
    const { status } = getValidated<{ status: string }>(req);

    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.id, storeId, deletedAt: null },
    });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

const updateData: Record<string, any> = { status };
    if (status === 'human_takeover') {
      updateData.humanTakeoverAt = new Date();
    } else if (status === 'open') {
      updateData.humanTakeoverAt = null;
    }

    await prisma.conversation.update({
      where: { id: req.params.id },
      data: updateData,
    });

    res.json({ success: true, message: `Status updated to ${status}` });
  } catch (error: any) {
    adapters.logger.error('Failed to update conversation status', error as Error);
    res.status(500).json({ error: error?.message || 'Failed to update status' });
  }
});

// POST /api/conversations/:id/reply — Send manual reply from agent
router.post('/:id/reply', validateRequest(replyMessageSchema, 'body'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const storeId = req.user!.storeId;
    const { message } = getValidated<{ message: string }>(req);

    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.id, storeId, deletedAt: null },
    });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Save to conversation history (sanitized)
    const sanitizedContent = sanitizeMessage(message);
    await prisma.conversationHistory.create({
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

    // Send via Fonnte, with GOWA fallback
    let sendError: string | null = null;

    const store = await prisma.store.findUnique({ where: { id: storeId } });
    if (store?.fonnteToken) {
      try {
        await fonnteService.sendMessage(conversation.customerPhone, sanitizedContent, {
          token: store.fonnteToken,
        });
      } catch {
        sendError = 'Fonnte send failed';
      }
    } else if (store?.phoneNumber) {
      try {
        // Fallback to GOWA if store has a WhatsApp number configured
        const did = `garuda-${storeId.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 20)}`;
        await gowaAdapter.sendMessage(conversation.customerPhone, sanitizedContent, {
          deviceId: did,
        });
      } catch {
        sendError = 'GOWA send failed';
      }
    } else {
      sendError = 'No WhatsApp gateway configured for this store';
    }

    res.json({
      success: true,
      message: 'Reply sent',
      sendError,
    });
  } catch (error: any) {
    adapters.logger.error('Failed to send reply', error as Error);
    res.status(500).json({ error: error?.message || 'Failed to send reply' });
  }
});

export default router;
