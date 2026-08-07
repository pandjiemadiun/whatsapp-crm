import { Router, Response } from 'express';
import { knowledgeService } from '../business/knowledge.service.js';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { adapters } from '../adapters/container.js';

const router = Router();

router.use(authMiddleware);

// GET /api/knowledge — List all knowledge entries for the authenticated store
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const storeId = req.user!.storeId;

    const entries = await knowledgeService.list(storeId, {
      category: req.query.category as string | undefined,
      search: req.query.search as string | undefined,
    });

    res.json({ success: true, data: entries });
  } catch (error: any) {
    adapters.logger.error('Failed to fetch knowledge entries', error as Error);
    res.status(500).json({ error: error?.message || 'Failed to fetch knowledge entries' });
  }
});

// GET /api/knowledge/search — Search knowledge base by text query
router.get('/search', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const storeId = req.user!.storeId;
    const query = req.query.q as string;

    if (!query) {
      return res.status(400).json({ error: 'q query parameter is required' });
    }

    const results = await knowledgeService.search(storeId, query);

    res.json({
      success: true,
      data: results,
      total: results.length,
    });
  } catch (error: any) {
    adapters.logger.error('Failed to search knowledge base', error as Error);
    res.status(500).json({ error: error?.message || 'Failed to search knowledge base' });
  }
});

// GET /api/knowledge/:id — Get single knowledge entry (only if owned by this store)
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const entry = await knowledgeService.findById(req.params.id);
    if (!entry || entry.storeId !== req.user!.storeId) {
      return res.status(404).json({ error: 'Knowledge entry not found' });
    }
    res.json({ success: true, data: entry });
  } catch (error: any) {
    adapters.logger.error('Failed to fetch knowledge entry', error as Error);
    res.status(500).json({ error: error?.message || 'Failed to fetch knowledge entry' });
  }
});

// POST /api/knowledge — Create a new knowledge entry under the authenticated store
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { title, content, category, tags, source, relevanceScore } = req.body;
    const storeId = req.user!.storeId;

    if (!title || !content) {
      return res.status(400).json({ error: 'title and content are required' });
    }

    const entry = await knowledgeService.create({
      storeId,
      title,
      content,
      category,
      tags,
      source,
      relevanceScore,
    });

    res.status(201).json({
      success: true,
      message: 'Knowledge entry created successfully',
      data: entry,
    });
  } catch (error: any) {
    adapters.logger.error('Failed to create knowledge entry', error as Error);
    res.status(500).json({ error: error?.message || 'Failed to create knowledge entry' });
  }
});

// PUT /api/knowledge/:id — Update knowledge entry (only if owned by this store)
router.put('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const storeId = req.user!.storeId;
    const existing = await knowledgeService.findById(req.params.id);
    if (!existing || existing.storeId !== storeId) {
      return res.status(404).json({ error: 'Knowledge entry not found' });
    }

    const { title, content, category, tags, source, relevanceScore } = req.body;

    const entry = await knowledgeService.update(req.params.id, {
      title,
      content,
      category,
      tags,
      source,
      relevanceScore,
    });

    res.json({
      success: true,
      message: 'Knowledge entry updated successfully',
      data: entry,
    });
  } catch (error: any) {
    const msg = error?.message || '';
    if (msg.startsWith('Knowledge entry not found')) {
      return res.status(404).json({ error: msg });
    }
    adapters.logger.error('Failed to update knowledge entry', error as Error);
    res.status(500).json({ error: msg || 'Failed to update knowledge entry' });
  }
});

// DELETE /api/knowledge/:id — Soft-delete knowledge entry (only if owned by this store)
router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const storeId = req.user!.storeId;
    const existing = await knowledgeService.findById(req.params.id);
    if (!existing || existing.storeId !== storeId) {
      return res.status(404).json({ error: 'Knowledge entry not found' });
    }

    const result = await knowledgeService.delete(req.params.id);
    res.json({
      success: true,
      message: 'Knowledge entry deleted successfully',
      data: result,
    });
  } catch (error: any) {
    const msg = error?.message || '';
    if (msg.startsWith('Knowledge entry not found')) {
      return res.status(404).json({ error: msg });
    }
    adapters.logger.error('Failed to delete knowledge entry', error as Error);
    res.status(500).json({ error: msg || 'Failed to delete knowledge entry' });
  }
});

export default router;
