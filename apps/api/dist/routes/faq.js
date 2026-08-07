import { Router } from 'express';
import { faqService } from '../business/faq.service.js';
import { authMiddleware } from '../middleware/auth.js';
import { adapters } from '../adapters/container.js';
const router = Router();
// All FAQ routes require authentication
router.use(authMiddleware);
// GET /api/faq — List FAQs for the authenticated store
router.get('/', async (req, res) => {
    try {
        const storeId = req.user.storeId;
        const faqs = await faqService.findAll(storeId, {
            category: req.query.category,
            search: req.query.search,
        });
        res.json({ success: true, data: faqs });
    }
    catch (error) {
        adapters.logger.error('Failed to fetch FAQs', error);
        res.status(500).json({ error: error?.message || 'Failed to fetch FAQs' });
    }
});
// GET /api/faq/search — Search FAQs by text query
router.get('/search', async (req, res) => {
    try {
        const storeId = req.user.storeId;
        const query = req.query.q;
        if (!query) {
            return res.status(400).json({ error: 'q query parameter is required' });
        }
        const results = await faqService.search(storeId, query);
        res.json({
            success: true,
            data: results,
            total: results.length,
        });
    }
    catch (error) {
        adapters.logger.error('Failed to search FAQs', error);
        res.status(500).json({ error: error?.message || 'Failed to search FAQs' });
    }
});
// GET /api/faq/:id — Get single FAQ (only if owned by this store)
router.get('/:id', async (req, res) => {
    try {
        const faq = await faqService.findById(req.params.id);
        if (!faq || faq.storeId !== req.user.storeId) {
            return res.status(404).json({ error: 'FAQ not found' });
        }
        res.json({ success: true, data: faq });
    }
    catch (error) {
        adapters.logger.error('Failed to fetch FAQ', error);
        res.status(500).json({ error: error?.message || 'Failed to fetch FAQ' });
    }
});
// POST /api/faq — Create a new FAQ under the authenticated store
router.post('/', async (req, res) => {
    try {
        const { question, answer, keywords, category, priority } = req.body;
        const storeId = req.user.storeId;
        if (!question || !answer) {
            return res.status(400).json({ error: 'question and answer are required' });
        }
        const faq = await faqService.create({
            storeId,
            question,
            answer,
            keywords: keywords || [],
            category: category || null,
            priority: priority ?? 1,
        });
        res.status(201).json({
            success: true,
            message: 'FAQ created successfully',
            data: faq,
        });
    }
    catch (error) {
        adapters.logger.error('Failed to create FAQ', error);
        res.status(500).json({ error: error?.message || 'Failed to create FAQ' });
    }
});
// PUT /api/faq/:id — Update FAQ (only if owned by this store)
router.put('/:id', async (req, res) => {
    try {
        const { question, answer, keywords, category, priority } = req.body;
        const storeId = req.user.storeId;
        const existing = await faqService.findById(req.params.id);
        if (!existing || existing.storeId !== storeId) {
            return res.status(404).json({ error: 'FAQ not found' });
        }
        const faq = await faqService.update(req.params.id, {
            question,
            answer,
            keywords,
            category,
            priority,
        });
        res.json({
            success: true,
            message: 'FAQ updated successfully',
            data: faq,
        });
    }
    catch (error) {
        const msg = error?.message || '';
        if (msg.startsWith('FAQ not found')) {
            return res.status(404).json({ error: msg });
        }
        adapters.logger.error('Failed to update FAQ', error);
        res.status(500).json({ error: msg || 'Failed to update FAQ' });
    }
});
// DELETE /api/faq/:id — Soft-delete FAQ (only if owned by this store)
router.delete('/:id', async (req, res) => {
    try {
        const storeId = req.user.storeId;
        const existing = await faqService.findById(req.params.id);
        if (!existing || existing.storeId !== storeId) {
            return res.status(404).json({ error: 'FAQ not found' });
        }
        const result = await faqService.delete(req.params.id);
        res.json({
            success: true,
            message: 'FAQ deleted successfully',
            data: result,
        });
    }
    catch (error) {
        const msg = error?.message || '';
        if (msg.startsWith('FAQ not found')) {
            return res.status(404).json({ error: msg });
        }
        adapters.logger.error('Failed to delete FAQ', error);
        res.status(500).json({ error: msg || 'Failed to delete FAQ' });
    }
});
export default router;
//# sourceMappingURL=faq.js.map