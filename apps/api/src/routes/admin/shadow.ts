import { Router } from 'express';
import { computeShadowSummary } from '../../services/chat/shadow-summary.js';
import { getPendingReviews, updateReviewDecision } from '../../services/chat/shadow-storage.js';
import { adminAuthMiddleware } from '../../middleware/adminAuth.js';

const router = Router();

router.get('/shadow-summary', adminAuthMiddleware, async (req, res) => {
  const storeId = req.query.storeId as string | undefined;
  const hours = parseInt(req.query.hours as string) || 24;
  const summary = await computeShadowSummary(storeId, hours);
  res.json(summary);
});

router.get('/shadow-review', adminAuthMiddleware, async (req, res) => {
  const limit = parseInt(req.query.limit as string) || 20;
  const reviews = await getPendingReviews(limit);
  res.json(reviews);
});

router.post('/shadow-review/:id', adminAuthMiddleware, async (req, res) => {
  const { decision, note } = req.body;
  if (!['correct', 'better', 'worse', 'edge_case'].includes(decision)) {
    return res.status(400).json({ error: 'Invalid decision' });
  }
  await updateReviewDecision(req.params.id, decision, note);
  res.json({ success: true });
});

export default router;
