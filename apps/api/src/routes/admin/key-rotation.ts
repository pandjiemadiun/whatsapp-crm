import { Router, Response } from 'express';
import { AuthenticatedAdminRequest } from '../../middleware/adminAuth.js';
import { requireAdminRole } from '../../middleware/adminAuthGuard.js';
import { keyRotationService, ROTATION_CONFIRM_PHRASE } from '../../business/key-rotation.service.js';
import { adapters } from '../../adapters/container.js';


const router = Router();

// ─── POST /api/admin/key-rotation/dry-run ───
// Returns row counts and encrypted field counts per model. No writes.
router.post(
  '/dry-run',
  requireAdminRole(['super_admin']),
  async (_req: AuthenticatedAdminRequest, res: Response) => {
    try {
      const result = await keyRotationService.dryRun();
      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      adapters.logger.error('Key rotation dry-run failed', error as Error);
      res.status(500).json({ error: error?.message || 'Dry-run failed' });
    }
  }
);

// ─── POST /api/admin/key-rotation/execute ───
// Body: { newKey: string, confirmationPhrase: string }
// Requires the admin to type the exact confirmation phrase.
router.post(
  '/execute',
  requireAdminRole(['super_admin']),
  async (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      const { newKey, confirmationPhrase } = req.body;

      // Validate new key
      if (!newKey || typeof newKey !== 'string' || newKey.trim().length === 0) {
        return res.status(400).json({ error: 'newKey is required' });
      }

      // Validate confirmation phrase
      if (confirmationPhrase !== ROTATION_CONFIRM_PHRASE) {
        return res.status(400).json({
          error: `Confirmation phrase mismatch. Type exactly: "${ROTATION_CONFIRM_PHRASE}"`,
          requiredPhrase: ROTATION_CONFIRM_PHRASE,
        });
      }

      adapters.logger.warn('[KeyRotation] EXECUTE requested by admin', {
        adminId: req.admin!.adminId,
        adminEmail: req.admin!.email,
      });

      const result = await keyRotationService.rotate(newKey);

      res.json({
        success: true,
        data: result,
        message: `Key rotated successfully. ${result.rowsReEncrypted} field values re-encrypted across ${result.modelsAffected.length} models.`,
      });
    } catch (error: any) {
      adapters.logger.error('Key rotation failed', error as Error);
      res.status(500).json({
        success: false,
        error: error?.message || 'Key rotation failed',
      });
    }
  }
);

export default router;
