import { Router, Response } from 'express';
import { adapters } from '../../adapters/container.js';
import { hashPassword } from '../../utils/password.util.js';
import { generateTempPassword } from '../../utils/generate-temp-password.js';
import { logAction } from '../../business/auditLog.service.js';
import { AuthenticatedAdminRequest } from '../../middleware/adminAuth.js';
import { prisma } from '../../infrastructure/prisma.js';
import { validateRequest, getValidated } from '../../middleware/validate-request.js';
import { queryStoresSchema, resetPasswordSchema } from '../../schemas/index.js';
import { normalizePhone } from '../../lib/normalize-phone.js';
import { fonnteService } from '../../services/fonnte.service.js';
import { configService } from '../../business/config.service.js';

const router = Router();

/** Resolve GOWA config dynamically from Platform Config (hot-reloadable) */
async function getGowaConfig(): Promise<{ baseUrl: string; username: string; password: string }> {
  const [url, user, pass] = await Promise.all([
    configService.getConfig('GOWA_API_URL'),
    configService.getConfig('GOWA_BASIC_AUTH_USER'),
    configService.getConfig('GOWA_BASIC_AUTH_PASS'),
  ]);
  return {
    baseUrl: url || process.env.GOWA_API_URL || 'http://localhost:3001',
    username: user || process.env.GOWA_BASIC_AUTH_USER || 'admin',
    password: pass || process.env.GOWA_BASIC_AUTH_PASS || '',
  };
}

function basicAuthHeader(cfg: { username: string; password: string }): string {
  return 'Basic ' + Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64');
}

async function gowaFetch(cfg: { baseUrl: string; username: string; password: string }, path: string, options: any = {}): Promise<{ ok: boolean; status: number; data: any }> {
  try {
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': basicAuthHeader(cfg),
        ...options?.headers,
      },
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    adapters.logger.warn('GOWA fetch failed', { path, error: (e as Error).message });
    return { ok: false, status: 0, data: {} };
  }
}

async function fetchQRBase64(cfg: { baseUrl: string; username: string; password: string }, qrLink?: string): Promise<string | null> {
  if (!qrLink) return null;
  try {
    // GOWA returns qr_link as http://localhost/... (no port), but our GOWA is on port 3001
    const parsed = new URL(qrLink);
    const correctedUrl = `${cfg.baseUrl}${parsed.pathname}`;
    const res = await fetch(correctedUrl, {
      headers: { 'Authorization': basicAuthHeader(cfg) },
    });
    if (!res.ok) {
      adapters.logger.warn('QR fetch failed', { correctedUrl, status: res.status });
      return null;
    }
    const buffer = await res.arrayBuffer();
    return Buffer.from(buffer).toString('base64');
  } catch (e) {
    adapters.logger.warn('QR fetch error', { error: (e as Error).message });
    return null;
  }
}

function deviceId(storeId: string): string {
  return `garuda-${storeId.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 20)}`;
}

// ─── GET /api/admin/stores — List all stores (paginated + searchable) ───
router.get('/', validateRequest(queryStoresSchema, 'query'), async (req: AuthenticatedAdminRequest, res: Response) => {
  try {
    const { page, search, status } = getValidated<{ page: number; search?: string; status?: string }>(req);
    const pageSize = 20;

    const where: Record<string, unknown> = { deletedAt: null };

    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (status === 'active') where.isActive = true;
    else if (status === 'suspended') where.isActive = false;

    const total = await prisma.store.count({ where });
    const stores = await prisma.store.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        phoneNumber: true,
        isActive: true,
        fonnteToken: true,
        fonnteNumber: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Get lastMessageAt for each store
    const storeIds = stores.map(s => s.id);
    const lastMessages = await prisma.conversation.groupBy({
      by: ['storeId'],
      where: { storeId: { in: storeIds }, deletedAt: null },
      _max: { lastMessageAt: true },
    });
    const lastMessageMap = new Map(lastMessages.map(lm => [lm.storeId, lm._max.lastMessageAt]));

    const result = stores.map(s => ({
      id: s.id,
      name: s.name,
      email: s.email,
      phoneNumber: s.phoneNumber,
      isActive: s.isActive,
      fonnteConnected: false, // real check async, updated below
      fonnteNumber: s.fonnteNumber,
      lastMessageAt: lastMessageMap.get(s.id) ?? null,
      createdAt: s.createdAt,
    }));

    res.json({
      success: true,
      data: {
        stores: result,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error: any) {
    adapters.logger.error('Failed to list stores', error as Error);
    res.status(500).json({ error: error?.message || 'Failed to list stores' });
  }
});

// ─── PUT /api/admin/stores/:storeId/suspend — Suspend store ───
router.put('/:storeId/suspend', async (req: AuthenticatedAdminRequest, res: Response) => {
  try {
    const { storeId } = req.params;
    const { reason } = req.body;

    const store = await prisma.store.findFirst({
      where: { id: storeId, deletedAt: null },
    });

    if (!store) {
      return res.status(404).json({ error: 'Store not found' });
    }

    if (!store.isActive) {
      return res.status(400).json({ error: 'Already suspended' });
    }

    await prisma.store.update({
      where: { id: storeId },
      data: { isActive: false },
    });

    await logAction({
      storeId,
      action: 'store_suspended',
      entity: 'Store',
      entityId: storeId,
      adminId: req.admin!.adminId,
      changes: { isActive: { from: true, to: false }, reason: reason || null },
      ipAddress: req.ip,
    });

    const updated = await prisma.store.findUnique({ where: { id: storeId } });

    res.json({
      success: true,
      data: {
        storeId: updated!.id,
        name: updated!.name,
        email: updated!.email,
        isActive: updated!.isActive,
        updatedAt: updated!.updatedAt,
      },
    });
  } catch (error: any) {
    adapters.logger.error('Failed to suspend store', error as Error);
    res.status(500).json({ error: error?.message || 'Failed to suspend store' });
  }
});

// ─── PUT /api/admin/stores/:storeId/activate — Reactivate suspended store ───
router.put('/:storeId/activate', async (req: AuthenticatedAdminRequest, res: Response) => {
  try {
    const { storeId } = req.params;

    const store = await prisma.store.findFirst({
      where: { id: storeId, deletedAt: null },
    });

    if (!store) {
      return res.status(404).json({ error: 'Store not found' });
    }

    if (store.isActive) {
      return res.status(400).json({ error: 'Already active' });
    }

    await prisma.store.update({
      where: { id: storeId },
      data: { isActive: true },
    });

    await logAction({
      storeId,
      action: 'store_activated',
      entity: 'Store',
      entityId: storeId,
      adminId: req.admin!.adminId,
      changes: { isActive: { from: false, to: true } },
      ipAddress: req.ip,
    });

    const updated = await prisma.store.findUnique({ where: { id: storeId } });

    res.json({
      success: true,
      data: {
        storeId: updated!.id,
        name: updated!.name,
        email: updated!.email,
        isActive: updated!.isActive,
        updatedAt: updated!.updatedAt,
      },
    });
  } catch (error: any) {
    adapters.logger.error('Failed to activate store', error as Error);
    res.status(500).json({ error: error?.message || 'Failed to activate store' });
  }
});

// ─── POST /api/admin/stores/:storeId/reset-password — Set temporary password ───
router.post('/:storeId/reset-password', validateRequest(resetPasswordSchema, 'body'), async (req: AuthenticatedAdminRequest, res: Response) => {
  try {
    const { storeId } = req.params;
    const { tempPassword: inputPassword } = getValidated<{ tempPassword?: string }>(req);

    const store = await prisma.store.findFirst({
      where: { id: storeId, deletedAt: null },
    });

    if (!store) {
      return res.status(404).json({ error: 'Store not found' });
    }

    const tempPassword = inputPassword || generateTempPassword();
    const hashedPassword = await hashPassword(tempPassword);

    // Update password in store_settings
    await prisma.storeSetting.upsert({
      where: { storeId_key: { storeId, key: 'auth_password' } },
      update: { value: hashedPassword },
      create: { storeId, key: 'auth_password', value: hashedPassword },
    });

    // Invalidate all current store tokens by setting expiry to now
    const now = new Date();
    await prisma.storeSetting.updateMany({
      where: { storeId, key: 'auth_token_expires_at' },
      data: { value: now.toISOString() },
    });

    // Also invalidate auth_token
    await prisma.storeSetting.updateMany({
      where: { storeId, key: 'auth_token' },
      data: { value: '' },
    });

    await logAction({
      storeId,
      action: 'store_password_reset',
      entity: 'Store',
      entityId: storeId,
      adminId: req.admin!.adminId,
      changes: { method: 'admin_reset' },
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      data: {
        storeId,
        tempPassword,
        message: 'Temporary password created. Store user must login and change it.',
      },
    });
  } catch (error: any) {
    adapters.logger.error('Failed to reset password', error as Error);
    res.status(500).json({ error: error?.message || 'Failed to reset password' });
  }
});

// ─── POST /api/admin/stores/:storeId/verify-email — Mark store email as verified ───
router.post('/:storeId/verify-email', async (req: AuthenticatedAdminRequest, res: Response) => {
  try {
    const { storeId } = req.params;

    const store = await prisma.store.findFirst({
      where: { id: storeId, deletedAt: null },
    });

    if (!store) {
      return res.status(404).json({ error: 'Store not found' });
    }

    await prisma.storeSetting.upsert({
      where: { storeId_key: { storeId, key: 'email_verified' } },
      update: { value: 'true' },
      create: { storeId, key: 'email_verified', value: 'true' },
    });

    await logAction({
      storeId,
      action: 'store_email_verified',
      entity: 'Store',
      entityId: storeId,
      adminId: req.admin!.adminId,
      changes: { emailVerified: true },
      ipAddress: req.ip,
    });

    res.json({ success: true, message: 'Email verified' });
  } catch (error: any) {
    adapters.logger.error('Failed to verify email', error as Error);
    res.status(500).json({ error: error?.message || 'Failed to verify email' });
  }
});

// ─── POST /api/admin/stores/:storeId/disconnect-fonnte — Revoke Fonnte token ───
router.post('/:storeId/disconnect-fonnte', async (req: AuthenticatedAdminRequest, res: Response) => {
  try {
    const { storeId } = req.params;

    const store = await prisma.store.findFirst({
      where: { id: storeId, deletedAt: null },
    });

    if (!store) {
      return res.status(404).json({ error: 'Store not found' });
    }

    if (!store.fonnteToken) {
      return res.status(400).json({ error: 'Fonnte already disconnected' });
    }

    await prisma.store.update({
      where: { id: storeId },
      data: { fonnteToken: null, fonnteNumber: null },
    });

    await logAction({
      storeId,
      action: 'fonnte_disconnected',
      entity: 'Store',
      entityId: storeId,
      adminId: req.admin!.adminId,
      changes: { fonnteToken: null, fonnteNumber: null },
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      data: { storeId, fonnteConnected: false },
    });
  } catch (error: any) {
    adapters.logger.error('Failed to disconnect Fonnte', error as Error);
    res.status(500).json({ error: error?.message || 'Failed to disconnect Fonnte' });
  }
});

// ─── GET /api/admin/stores/:storeId/gowa-status — Check GOWA device status ───
router.get('/:storeId/gowa-status', async (req: AuthenticatedAdminRequest, res: Response) => {
  try {
    const { storeId } = req.params;
    const cfg = await getGowaConfig();
    const did = deviceId(storeId);

    const status = await gowaFetch(cfg, `/devices/${did}/status`);

    // Device tidak ada di GOWA → disconnected
    if (!status.ok || status.status === 404) {
      return res.json({
        success: true,
        data: { deviceId: did, status: 'disconnected', qrcode: null, ownerJid: null },
      });
    }

    const s = status.data?.results;
    const isConnected = s?.is_connected && s?.is_logged_in;

    let qrcode: string | null = null;
    if (!isConnected) {
      // Ambil QR login → dapat qr_link → fetch gambarnya → base64
      const login = await gowaFetch(cfg, `/devices/${did}/login`);
      if (login.ok) {
        const qrLink = login.data?.results?.qr_link || login.data?.results?.qr_base64 || null;
        qrcode = qrLink?.startsWith('data:') ? qrLink.replace(/^data:image\/png;base64,/, '') : await fetchQRBase64(cfg, qrLink);
      }
    }

    res.json({
      success: true,
      data: {
        deviceId: did,
        status: isConnected ? 'connected' : 'disconnected',
        qrcode,
        ownerJid: s?.jid || null,
      },
    });
  } catch (error: any) {
    adapters.logger.error('GOWA status check failed', error as Error);
    res.status(500).json({ error: error?.message || 'Failed to check GOWA status' });
  }
});

// ─── POST /api/admin/stores/:storeId/gowa-connect — Create GOWA device + get QR ───
router.post('/:storeId/gowa-connect', async (req: AuthenticatedAdminRequest, res: Response) => {
  try {
    const { storeId } = req.params;
    const cfg = await getGowaConfig();
    const did = deviceId(storeId);
    const rawPhone = req.body.phoneNumber || '';
    const phoneNumber = normalizePhone(rawPhone);

    // Update store phone (normalized)
    if (phoneNumber) {
      await prisma.store.update({ where: { id: storeId }, data: { phoneNumber } });
    }

    // Check existing status
    const existing = await gowaFetch(cfg, `/devices/${did}/status`);
    if (existing.ok && existing.status !== 404 && existing.data?.results?.is_connected && existing.data?.results?.is_logged_in) {
      return res.json({
        success: true,
        data: { deviceId: did, status: 'connected', qrcode: null, message: 'Already connected' },
      });
    }

    // Remove stale device if exists (disconnected but still registered)
    if (existing.ok && existing.status !== 404) {
      await gowaFetch(cfg, `/devices/${did}`, { method: 'DELETE' }).catch(() => {});
    }

    // Create fresh device
    const created = await gowaFetch(cfg, '/devices', {
      method: 'POST',
      body: JSON.stringify({ device_id: did }),
    });
    if (!created.ok) {
      return res.status(502).json({ error: `GOWA create device failed: ${JSON.stringify(created.data)}` });
    }

    // Get QR login
    const login = await gowaFetch(cfg, `/devices/${did}/login`);
    if (!login.ok) {
      return res.status(502).json({ error: `GOWA login failed: ${JSON.stringify(login.data)}` });
    }

    // Convert QR to base64
    const qrLink = login.data?.results?.qr_link || login.data?.results?.qr_base64 || null;
    const qrcode = qrLink?.startsWith('data:') ? qrLink.replace(/^data:image\/png;base64,/, '') : await fetchQRBase64(cfg, qrLink);

    res.json({
      success: true,
      data: {
        deviceId: did,
        status: 'connecting',
        qrcode,
        pairingCode: login.data?.results?.pairing_code || null,
        message: 'Device created. Scan the QR code to connect.',
      },
    });
  } catch (error: any) {
    adapters.logger.error('GOWA connect failed', error as Error);
    res.status(500).json({ error: error?.message || 'Failed to connect GOWA' });
  }
});

// ─── POST /api/admin/stores/:storeId/gowa-reset — Full remove GOWA device + clear fields ───
router.post('/:storeId/gowa-reset', async (req: AuthenticatedAdminRequest, res: Response) => {
  try {
    const { storeId } = req.params;
    const cfg = await getGowaConfig();
    const did = deviceId(storeId);

    // Full teardown: logout then delete device slot entirely
    await gowaFetch(cfg, `/devices/${did}/logout`, { method: 'POST' }).catch(() => {});
    await gowaFetch(cfg, `/devices/${did}`, { method: 'DELETE' }).catch(() => {});

    // Clear store fields
    await prisma.store.update({
      where: { id: storeId },
      data: { phoneNumber: null, whatsappPhoneId: null },
    });

    res.json({ success: true, message: 'GOWA device fully removed and reset' });
  } catch (error: any) {
    adapters.logger.error('GOWA reset failed', error as Error);
    res.status(500).json({ error: error?.message || 'Failed to reset GOWA' });
  }
});

// ─── GET /api/admin/stores/:storeId — Store detail + statistics (must be last, after specific routes) ───
router.get('/:storeId', async (req: AuthenticatedAdminRequest, res: Response) => {
  try {
    const { storeId } = req.params;

    const store = await prisma.store.findFirst({
      where: { id: storeId, deletedAt: null },
    });

    if (!store) {
      return res.status(404).json({ error: 'Store not found' });
    }

    const [totalConversations, totalMessages, totalOrders, aiResponseCount, humanTakeoverCount, costAgg] =
      await Promise.all([
        prisma.conversation.count({ where: { storeId, deletedAt: null } }),
        prisma.conversationHistory.count({
          where: { conversation: { storeId, deletedAt: null } },
        }),
        prisma.order.count({ where: { storeId, deletedAt: null } }),
        prisma.conversationHistory.count({
          where: { conversation: { storeId, deletedAt: null }, role: 'assistant' },
        }),
        prisma.conversation.count({
          where: { storeId, deletedAt: null, humanTakeoverAt: { not: null } },
        }),
        prisma.conversationHistory.aggregate({
          where: { conversation: { storeId, deletedAt: null } },
          _sum: { costUSD: true },
          _avg: { responseTime: true },
        }),
      ]);

    // Real Fonnte device status (ping sebenarnya)
    let fonnteConnected = false;
    let fonnteError: string | undefined;
    if (store.fonnteToken) {
      try {
        const deviceStatus = await fonnteService.getDeviceStatus(store.fonnteToken);
        fonnteConnected = deviceStatus.connected;
        fonnteError = deviceStatus.error;
      } catch {
        fonnteConnected = false;
      }
    }

    res.json({
      success: true,
      data: {
        id: store.id,
        name: store.name,
        email: store.email,
        phoneNumber: store.phoneNumber,
        description: store.description,
        businessCategory: store.businessCategory,
        address: store.address,
        isActive: store.isActive,
        timezone: store.timezone,
        profilePhotoUrl: store.profilePhotoUrl,
        createdAt: store.createdAt,
        updatedAt: store.updatedAt,
        stats: {
          totalConversations,
          totalMessages,
          totalOrders,
          aiResponseCount,
          humanTakeoverCount,
          totalCostUSD: costAgg._sum.costUSD ?? 0,
          avgResponseTimeMs: Math.round(costAgg._avg.responseTime ?? 0),
        },
        fonnteStatus: {
          connected: fonnteConnected,
          error: fonnteError,
          phoneNumber: store.fonnteNumber,
        },
        subscriptionStatus: store.isActive ? 'active' : 'suspended',
      },
    });
  } catch (error: any) {
    adapters.logger.error('Failed to fetch store detail', error as Error);
    res.status(500).json({ error: error?.message || 'Failed to fetch store detail' });
  }
});

export default router;
