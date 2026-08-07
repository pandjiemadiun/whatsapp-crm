import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { adapters } from '../adapters/container.js';
import { getWhatsAppConnectionStatus } from '../services/whatsapp-connection.service.js';
import { prisma } from '../infrastructure/prisma.js';
import { normalizePhone } from '../lib/normalize-phone.js';
import { configService } from '../business/config.service.js';
const router = Router();
// Apply store-owner auth to all whatsapp routes
router.use(authMiddleware);
/** Resolve GOWA config dynamically from Platform Config (hot-reloadable) */
async function getGowaConfig() {
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
function basicAuthHeader(cfg) {
    return 'Basic ' + Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64');
}
async function gowaFetch(cfg, path, options = {}) {
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
    }
    catch (e) {
        adapters.logger.warn('GOWA fetch failed', { path, error: e.message });
        return { ok: false, status: 0, data: {} };
    }
}
async function fetchQRBase64(cfg, qrLink) {
    if (!qrLink)
        return null;
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
    }
    catch (e) {
        adapters.logger.warn('QR fetch error', { error: e.message });
        return null;
    }
}
function deviceId(storeId) {
    return `garuda-${storeId.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 20)}`;
}
// POST /api/whatsapp/connect — Create GOWA device and return QR code
router.post('/connect', async (req, res) => {
    try {
        const storeId = req.user.storeId;
        const cfg = await getGowaConfig();
        const did = deviceId(storeId);
        // Store phone if provided (auto-normalize)
        const rawPhone = req.body.phoneNumber || '';
        const phoneNumber = normalizePhone(rawPhone);
        if (phoneNumber) {
            await prisma.store.update({ where: { id: storeId }, data: { phoneNumber } });
        }
        // Check if device already exists and is connected
        const status = await gowaFetch(cfg, `/devices/${did}/status`);
        if (status.ok && status.status !== 404 && status.data?.results?.is_connected && status.data?.results?.is_logged_in) {
            return res.json({
                success: true,
                data: { deviceId: did, status: 'connected', qrcode: null, message: 'WhatsApp already connected' },
            });
        }
        // Remove stale device then create fresh
        if (status.ok && status.status !== 404) {
            await gowaFetch(cfg, `/devices/${did}`, { method: 'DELETE' }).catch(() => { });
        }
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
    }
    catch (error) {
        adapters.logger.error('GOWA connect failed', error);
        res.status(500).json({ error: error?.message || 'Failed to connect WhatsApp' });
    }
});
// GET /api/whatsapp/status — Get GOWA device connection status
router.get('/status', async (req, res) => {
    try {
        const storeId = req.user.storeId;
        const cfg = await getGowaConfig();
        const did = deviceId(storeId);
        const status = await gowaFetch(cfg, `/devices/${did}/status`);
        if (!status.ok || status.status === 404) {
            return res.json({
                success: true,
                data: { deviceId: did, status: 'disconnected', qrcode: null },
            });
        }
        const s = status.data?.results;
        const isConnected = s?.is_connected && s?.is_logged_in;
        let qrcode = null;
        if (!isConnected) {
            const qr = await gowaFetch(cfg, `/devices/${did}/login`);
            if (qr.ok) {
                const qrLink = qr.data?.results?.qr_link || qr.data?.results?.qr_base64 || null;
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
                profileName: null,
            },
        });
    }
    catch (error) {
        adapters.logger.error('GOWA status failed', error);
        res.status(500).json({ error: error?.message || 'Failed to get WhatsApp status' });
    }
});
// POST /api/whatsapp/reset — Full teardown: logout + delete device + clear fields
router.post('/reset', async (req, res) => {
    try {
        const storeId = req.user.storeId;
        const cfg = await getGowaConfig();
        const did = deviceId(storeId);
        await gowaFetch(cfg, `/devices/${did}/logout`, { method: 'POST' }).catch(() => { });
        await gowaFetch(cfg, `/devices/${did}`, { method: 'DELETE' }).catch(() => { });
        await prisma.store.update({
            where: { id: storeId },
            data: { phoneNumber: null, whatsappPhoneId: null },
        });
        adapters.logger.info('GOWA device fully reset', { storeId, deviceId: did });
        res.json({
            success: true,
            message: 'Device fully removed. Ready for fresh setup.',
        });
    }
    catch (error) {
        adapters.logger.error('GOWA reset failed', error);
        res.status(500).json({ error: error?.message || 'Failed to reset' });
    }
});
// POST /api/whatsapp/disconnect — Full remove device slot
router.post('/disconnect', async (req, res) => {
    try {
        const storeId = req.user.storeId;
        const cfg = await getGowaConfig();
        const did = deviceId(storeId);
        await gowaFetch(cfg, `/devices/${did}`, { method: 'DELETE' }).catch(() => { });
        res.json({ success: true, message: 'Device removed' });
    }
    catch (error) {
        adapters.logger.error('GOWA disconnect failed', error);
        res.status(500).json({ error: error?.message || 'Failed to disconnect' });
    }
});
// POST /api/whatsapp/logout — Legacy logout (kept for backward compat)
router.post('/logout', async (req, res) => {
    try {
        const storeId = req.user.storeId;
        const cfg = await getGowaConfig();
        const did = deviceId(storeId);
        await gowaFetch(cfg, `/devices/${did}/logout`, { method: 'POST' }).catch(() => { });
        res.json({ success: true, message: 'Device logged out' });
    }
    catch (error) {
        adapters.logger.error('GOWA logout failed', error);
        res.status(500).json({ error: error?.message || 'Failed to logout' });
    }
});
// GET /api/whatsapp/fonnte/status — Unified WhatsApp connection status (SATU SUMBER KEBENARAN)
router.get('/fonnte/status', async (req, res) => {
    try {
        const storeId = req.user.storeId;
        const status = await getWhatsAppConnectionStatus(storeId);
        res.json({
            success: true,
            data: {
                status: status.connected ? 'connected' : 'disconnected',
                gateway: status.gateway,
                phoneNumber: status.phoneNumber,
                fonnteNumber: status.phoneNumber || null,
                lastCheckedAt: status.lastCheckedAt,
            },
        });
    }
    catch (error) {
        adapters.logger.error('WhatsApp status check failed', error);
        res.status(500).json({ error: error?.message || 'Failed to check WhatsApp status' });
    }
});
export default router;
//# sourceMappingURL=whatsapp.js.map