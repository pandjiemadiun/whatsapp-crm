import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { prisma } from '../infrastructure/prisma.js';
import { adapters } from '../adapters/container.js';
const router = Router();
// Semua route butuh auth store owner — storeId dari token saja
router.use(authMiddleware);
// GET /api/bank-accounts — list semua rekening bank milik store ini
// (hanya yang belum di-delete / deletedAt null)
router.get('/', async (req, res) => {
    try {
        const storeId = req.user.storeId;
        const bankAccounts = await prisma.bankAccount.findMany({
            where: { storeId, deletedAt: null },
            orderBy: { createdAt: 'desc' },
        });
        res.json({ success: true, data: bankAccounts });
    }
    catch (error) {
        adapters.logger.error('Failed to fetch bank accounts', error);
        res.status(500).json({ error: error?.message || 'Failed to fetch bank accounts' });
    }
});
// POST /api/bank-accounts — create rekening bank baru
// bankName, accountNumber, accountName wajib diisi
router.post('/', async (req, res) => {
    try {
        const storeId = req.user.storeId;
        const { bankName, accountNumber, accountName } = req.body;
        if (!bankName || !accountNumber || !accountName) {
            return res.status(400).json({ error: 'bankName, accountNumber, and accountName are required' });
        }
        const bankAccount = await prisma.bankAccount.create({
            data: {
                storeId,
                bankName,
                accountNumber,
                accountName,
            },
        });
        adapters.logger.info('Bank account created', { storeId, bankAccountId: bankAccount.id });
        res.status(201).json({
            success: true,
            message: 'Bank account created successfully',
            data: bankAccount,
        });
    }
    catch (error) {
        adapters.logger.error('Failed to create bank account', error);
        res.status(500).json({ error: error?.message || 'Failed to create bank account' });
    }
});
// PUT /api/bank-accounts/:id — update rekening (ownership check: 404 jika bukan milik store ini)
router.put('/:id', async (req, res) => {
    try {
        const storeId = req.user.storeId;
        const { id } = req.params;
        const { bankName, accountNumber, accountName, isActive } = req.body;
        // Ownership check — cari dulu, pastikan milik store ini
        const existing = await prisma.bankAccount.findFirst({
            where: { id, storeId, deletedAt: null },
        });
        if (!existing) {
            return res.status(404).json({ error: 'Bank account not found' });
        }
        const updateData = {};
        if (bankName !== undefined)
            updateData.bankName = bankName;
        if (accountNumber !== undefined)
            updateData.accountNumber = accountNumber;
        if (accountName !== undefined)
            updateData.accountName = accountName;
        if (isActive !== undefined)
            updateData.isActive = isActive;
        const updated = await prisma.bankAccount.update({
            where: { id },
            data: updateData,
        });
        res.json({
            success: true,
            message: 'Bank account updated successfully',
            data: updated,
        });
    }
    catch (error) {
        const msg = error?.message || '';
        if (msg.includes('not found')) {
            return res.status(404).json({ error: msg });
        }
        adapters.logger.error('Failed to update bank account', error);
        res.status(500).json({ error: msg || 'Failed to update bank account' });
    }
});
// DELETE /api/bank-accounts/:id — soft-delete (ownership check: 404 jika bukan milik store ini)
router.delete('/:id', async (req, res) => {
    try {
        const storeId = req.user.storeId;
        const { id } = req.params;
        // Ownership check
        const existing = await prisma.bankAccount.findFirst({
            where: { id, storeId, deletedAt: null },
        });
        if (!existing) {
            return res.status(404).json({ error: 'Bank account not found' });
        }
        await prisma.bankAccount.update({
            where: { id },
            data: { deletedAt: new Date() },
        });
        res.json({
            success: true,
            message: 'Bank account deleted successfully',
            data: { id },
        });
    }
    catch (error) {
        adapters.logger.error('Failed to delete bank account', error);
        res.status(500).json({ error: error?.message || 'Failed to delete bank account' });
    }
});
export default router;
//# sourceMappingURL=bank-accounts.js.map