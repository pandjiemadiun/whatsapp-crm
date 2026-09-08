import express, { Request, Response } from 'express';
import crypto from 'crypto';
import { conversationService } from '../business/conversation.service.js';
import { adapters } from '../adapters/container.js';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { prisma } from '../infrastructure/prisma.js';
import { ApiError } from '../errors/ApiError.js';

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
    const { customerId, conversationId, message, clientMsgId } = req.body;

    if (!customerId || !conversationId || !message) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // UNIT6-B Unit 1 (option a): thread a stable messageId into processCustomerMessage so
    // /handle joins the claimAction/idempotency path.
    //
    // Before this change, /handle called processCustomerMessage with 4 args => messageId
    // undefined => executeWaCartMutation took the unlocked branch at action-registry.ts:1580
    // (a direct cartAuthority.executeOps with NO claim/FOR UPDATE — no idempotency).
    // With a messageId on every call, :1580 is no longer reachable from /handle: the request
    // flows through claimAction on the claimed path => actionId is constructed at
    // action-registry.ts:1593-1594 as `${prefix}:${conversationId}:${messageId}`, so a
    // resent clientMsgId is deduped (already_applied) rather than double-applied.
    //
    // Mirrors the PWA /message clientMsgId pattern (routes/pwa.ts:386-396): a stable
    // clientMsgId is reused verbatim (trimmed, capped 128); absent/invalid falls back to a
    // server uuid (crypto.randomUUID) with a warning. `crypto` is already imported (L2).
    //
    // channel is left at its DEFAULT to preserve /handle's pre-existing behavior —
    // changing it would alter customerPhone (conversation.service.ts:94) and the actionId
    // prefix (action-registry.ts:1593), which is out of scope for this unit (strictly the
    // messageId thread; no other /handle behavior change).
    let messageId: string;
    if (typeof clientMsgId === 'string' && clientMsgId.trim().length > 0) {
      messageId = clientMsgId.trim().slice(0, 128);
    } else {
      if (clientMsgId !== undefined && clientMsgId !== '') {
        adapters.logger.warn('POST /api/messages/handle: clientMsgId present but invalid/empty — falling back to server id', { storeId });
      } else {
        adapters.logger.warn('POST /api/messages/handle: clientMsgId absent — falling back to server id', { storeId });
      }
      messageId = crypto.randomUUID();
    }

    const result = await conversationService.processCustomerMessage(
      storeId,
      customerId,
      conversationId,
      message,
      undefined,
      messageId
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
  } catch (error: any) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode || 500).json({ error: error.message });
    }
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
