import express, { Request, Response } from 'express';
import crypto from 'crypto';
import { conversationService } from '../business/conversation.service.js';
import { adapters } from '../adapters/container.js';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { prisma } from '../infrastructure/prisma.js';

const router = express.Router();

// Public base URL used to build webhook URLs shown to store owners.
// In production this MUST be the public API origin (e.g. https://api.qlobot.web.id),
// because req.host behind the dashboard proxy is localhost:3000.
function getPublicWebhookBaseUrl(req: Request): string {
  const configured = process.env.PUBLIC_API_URL;
  if (configured) {
    return configured.replace(/\/+$/, '');
  }
  const host = req.get('host') || '';
  // Fallback: only trust the Host header when it isn't localhost/private
  if (host && !/localhost|127\.0\.0\.1|\.local|^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
    return `${req.protocol}://${host}`;
  }
  return 'https://api.qlobot.web.id';
}

// All message handling requires store auth. storeId is always derived from the
// bearer token — never trusted from the request body (prevents cross-tenant IDOR).
router.use(authMiddleware);

router.post('/handle', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const storeId = req.user!.storeId;
    const { customerId, conversationId, message } = req.body;

    if (!customerId || !conversationId || !message) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const result = await conversationService.processCustomerMessage(
      storeId,
      customerId,
      conversationId,
      message
    );

    if (!result) {
      return res.json({
        success: true,
        source: 'human_takeover',
        content: null,
        message: 'Conversation is under human takeover, AI reply skipped.',
      });
    }

    res.json({
      success: true,
      messageId: result.message.id,
      source: result.source,
      content: result.message.content,
      confidence: result.confidence,
      cost: result.cost,
      requiresHumanReview: result.requiresHumanReview,
      timestamp: result.message.createdAt,
    });
  } catch (error) {
    adapters.logger.error('Message handler error', error as Error);
    res.status(500).json({ error: 'Failed to process message' });
  }
});

router.get('/stats/:conversationId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { conversationId } = req.params;
    const storeId = req.user!.storeId;

    // Only allow stats for conversations owned by this store
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, storeId },
    });
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const stats = await conversationService.getConversationStats(conversationId);

    res.json({ success: true, data: stats });
  } catch (error) {
    adapters.logger.error('Stats handler error', error as Error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// POST /rotate-webhook-secret — Generate a new per-store webhook secret.
// Returns the new secret + the full Fonnte webhook URL for the owner to paste
// into the Fonnte dashboard.
router.post('/rotate-webhook-secret', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const storeId = req.user!.storeId;
    const webhookSecret = crypto.randomBytes(24).toString('hex');

    await prisma.store.update({
      where: { id: storeId },
      data: { webhookSecret },
    });

    const webhookUrl = `${getPublicWebhookBaseUrl(req)}/api/webhooks/fonnte?secret=${webhookSecret}`;

    res.json({ success: true, data: { webhookSecret, webhookUrl } });
  } catch (error) {
    adapters.logger.error('Rotate webhook secret error', error as Error);
    res.status(500).json({ error: 'Failed to rotate webhook secret' });
  }
});

// GET /webhook-url — Return the store's current Fonnte webhook URL + secret
router.get('/webhook-url', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const storeId = req.user!.storeId;
    const store = await prisma.store.findUnique({ where: { id: storeId } });
    if (!store || !store.webhookSecret) {
      return res.status(404).json({ error: 'Webhook secret not set' });
    }

    const webhookUrl = `${getPublicWebhookBaseUrl(req)}/api/webhooks/fonnte?secret=${store.webhookSecret}`;

    res.json({
      success: true,
      data: { webhookSecret: store.webhookSecret, webhookUrl },
    });
  } catch (error) {
    adapters.logger.error('Get webhook url error', error as Error);
    res.status(500).json({ error: 'Failed to get webhook url' });
  }
});

export default router;
