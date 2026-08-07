import { Router, Response } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { adapters } from '../adapters/container.js';
import { prisma } from '../infrastructure/prisma.js';

const router = Router();

router.use(authMiddleware);

// GET /api/settings/ai — Get AI system prompt for the authenticated store
router.get('/ai', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const storeId = req.user!.storeId;

    const setting = await prisma.storeSetting.findUnique({
      where: { storeId_key: { storeId, key: 'ai_system_prompt' } },
    });

    res.json({
      success: true,
      data: {
        systemPrompt: setting?.value || 'You are a helpful WhatsApp commerce assistant for Indonesian MSMEs. Answer concisely and professionally.',
      },
    });
  } catch (error: any) {
    adapters.logger.error('Failed to fetch AI settings', error as Error);
    res.status(500).json({ error: error?.message || 'Failed to fetch AI settings' });
  }
});

// PUT /api/settings/ai — Update AI system prompt
router.put('/ai', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const storeId = req.user!.storeId;
    const { systemPrompt } = req.body;

    if (!systemPrompt || typeof systemPrompt !== 'string') {
      return res.status(400).json({ error: 'systemPrompt is required and must be a string' });
    }
    if (systemPrompt.length > 2000) {
      return res.status(400).json({ error: 'systemPrompt must not exceed 2000 characters' });
    }

    await prisma.storeSetting.upsert({
      where: { storeId_key: { storeId, key: 'ai_system_prompt' } },
      update: { value: systemPrompt },
      create: { storeId, key: 'ai_system_prompt', value: systemPrompt },
    });

    res.json({ success: true, message: 'AI system prompt updated successfully' });
  } catch (error: any) {
    adapters.logger.error('Failed to update AI settings', error as Error);
    res.status(500).json({ error: error?.message || 'Failed to update AI settings' });
  }
});

export default router;
