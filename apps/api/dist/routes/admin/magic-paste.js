import { Router } from 'express';
import { randomUUID } from 'crypto';
import { productService } from '../../business/product.service.js';
import { adapters } from '../../adapters/container.js';
import { logAction } from '../../business/auditLog.service.js';
const router = Router();
// Semua routes butuh admin auth
router.use((req, _res, next) => {
    // adminAuthMiddleware sudah di-apply di src/index.ts sebelum router ini
    next();
});
/**
 * GET /api/admin/magic-paste
 * Dapatkan semua pattern + settings dalam satu response.
 */
router.get('/', async (req, res) => {
    try {
        const patterns = await productService.loadPatterns();
        const settings = await productService.loadSettings();
        res.json({
            success: true,
            data: { patterns, settings },
        });
    }
    catch (error) {
        adapters.logger.error('Failed to load magic paste config', error);
        res.status(500).json({ error: error?.message || 'Failed to load config' });
    }
});
/**
 * POST /api/admin/magic-paste/patterns
 * Buat pattern baru.
 */
router.post('/patterns', async (req, res) => {
    try {
        const { name, description, regex, fieldMappings, confidence, isActive, sortOrder } = req.body;
        if (!name || !regex) {
            return res.status(400).json({ error: 'name dan regex wajib diisi' });
        }
        // Validasi regex valid
        try {
            new RegExp(regex, 'gi');
        }
        catch {
            return res.status(400).json({ error: 'regex tidak valid' });
        }
        const patterns = await productService.loadPatterns();
        const newPattern = {
            id: randomUUID(),
            name: String(name),
            description: String(description || ''),
            regex: String(regex),
            fieldMappings: Array.isArray(fieldMappings) ? fieldMappings : [],
            confidence: Number(confidence) || 0.5,
            isActive: isActive !== false,
            sortOrder: Number(sortOrder) || 100,
        };
        await productService.savePatterns([...patterns, newPattern]);
        await logAction({
            storeId: null,
            action: 'magic_paste_pattern_created',
            entity: 'MagicPastePattern',
            entityId: newPattern.id,
            adminId: req.admin.adminId,
            changes: newPattern,
            ipAddress: req.ip,
        });
        res.status(201).json({ success: true, data: newPattern });
    }
    catch (error) {
        adapters.logger.error('Failed to create pattern', error);
        res.status(500).json({ error: error?.message || 'Failed to create pattern' });
    }
});
/**
 * PUT /api/admin/magic-paste/patterns/:id
 * Update pattern yang ada.
 */
router.put('/patterns/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, regex, fieldMappings, confidence, isActive, sortOrder } = req.body;
        if (!name || !regex) {
            return res.status(400).json({ error: 'name dan regex wajib diisi' });
        }
        // Validasi regex valid
        try {
            new RegExp(regex, 'gi');
        }
        catch {
            return res.status(400).json({ error: 'regex tidak valid' });
        }
        const patterns = await productService.loadPatterns();
        const idx = patterns.findIndex((p) => p.id === id);
        if (idx === -1) {
            return res.status(404).json({ error: 'Pattern tidak ditemukan' });
        }
        const updated = {
            ...patterns[idx],
            name: String(name),
            description: String(description || ''),
            regex: String(regex),
            fieldMappings: Array.isArray(fieldMappings) ? fieldMappings : [],
            confidence: Number(confidence) || 0.5,
            isActive: isActive !== false,
            sortOrder: Number(sortOrder) || patterns[idx].sortOrder,
        };
        patterns[idx] = updated;
        await productService.savePatterns(patterns);
        await logAction({
            storeId: null,
            action: 'magic_paste_pattern_updated',
            entity: 'MagicPastePattern',
            entityId: String(id),
            adminId: req.admin.adminId,
            changes: updated,
            ipAddress: req.ip,
        });
        res.json({ success: true, data: updated });
    }
    catch (error) {
        adapters.logger.error('Failed to update pattern', error);
        res.status(500).json({ error: error?.message || 'Failed to update pattern' });
    }
});
/**
 * DELETE /api/admin/magic-paste/patterns/:id
 * Hapus pattern.
 */
router.delete('/patterns/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const patterns = await productService.loadPatterns();
        const idx = patterns.findIndex((p) => p.id === id);
        if (idx === -1) {
            return res.status(404).json({ error: 'Pattern tidak ditemukan' });
        }
        const removed = patterns[idx];
        const remaining = patterns.filter((p) => p.id !== id);
        await productService.savePatterns(remaining);
        await logAction({
            storeId: null,
            action: 'magic_paste_pattern_deleted',
            entity: 'MagicPastePattern',
            entityId: id,
            adminId: req.admin.adminId,
            changes: removed,
            ipAddress: req.ip,
        });
        res.json({ success: true, message: 'Pattern berhasil dihapus' });
    }
    catch (error) {
        adapters.logger.error('Failed to delete pattern', error);
        res.status(500).json({ error: error?.message || 'Failed to delete pattern' });
    }
});
/**
 * PUT /api/admin/magic-paste/settings
 * Update settings Magic Paste.
 */
router.put('/settings', async (req, res) => {
    try {
        const { regexFirstThreshold, llmEnabled, cacheEnabled } = req.body;
        const current = await productService.loadSettings();
        const updated = {
            regexFirstThreshold: Number(regexFirstThreshold) || current.regexFirstThreshold,
            llmEnabled: llmEnabled !== undefined ? Boolean(llmEnabled) : current.llmEnabled,
            cacheEnabled: cacheEnabled !== undefined ? Boolean(cacheEnabled) : current.cacheEnabled,
        };
        await productService.saveSettings(updated);
        await logAction({
            storeId: null,
            action: 'magic_paste_settings_updated',
            entity: 'MagicPasteSettings',
            entityId: 'settings',
            adminId: req.admin.adminId,
            changes: updated,
            ipAddress: req.ip,
        });
        res.json({ success: true, data: updated });
    }
    catch (error) {
        adapters.logger.error('Failed to update settings', error);
        res.status(500).json({ error: error?.message || 'Failed to update settings' });
    }
});
export default router;
//# sourceMappingURL=magic-paste.js.map