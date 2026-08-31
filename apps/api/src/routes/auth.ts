import express, { Request, Response } from 'express';
import crypto from 'crypto';
import multer from 'multer';
import { adapters } from '../adapters/container.js';
import { fonnteService } from '../services/fonnte.service.js';
import { hashPassword, verifyPassword } from '../utils/password.util.js';
import { prisma } from '../infrastructure/prisma.js';
import { validateRequest, getValidated } from '../middleware/validate-request.js';
import { storeRegisterSchema, storeLoginSchema, updateProfileSchema } from '../schemas/index.js';
import { sanitize } from '../lib/sanitize.js';
import { storeAuthLimiter } from '../middleware/rate-limiters.js';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { getEncryptionKey, hashField } from '../utils/encryption.js';
import { getVapidConfig } from '../config/vapid.config.js';
import { eventBus } from '../services/event-bus.service.js';

const router = express.Router();

// Generate a unique per-store webhook secret (used for Fonnte webhook URL)
function generateWebhookSecret(): string {
  return crypto.randomBytes(24).toString('hex');
}

// GET /api/push/vapid-public-key — Expose VAPID public key for merchant push subscription.
router.get('/push/vapid-public-key', (_req: Request, res: Response) => {
  const cfg = getVapidConfig();
  res.json({ publicKey: cfg?.publicKey ?? null });
});

// POST /api/auth/register — Register with email + password
router.post('/register', validateRequest(storeRegisterSchema, 'body'), storeAuthLimiter, async (req: Request, res: Response) => {
  try {
    const {
      email,
      password,
      phoneNumber,
      address,
      originProvinceId,
      originProvinceName,
      originCityId,
      originCityName,
      originSubdistrictId,
      originSubdistrictName,
    } = getValidated<{
      email: string;
      password: string;
      phoneNumber: string;
      address: string;
      originProvinceId: string;
      originProvinceName: string;
      originCityId: string;
      originCityName: string;
      originSubdistrictId: string;
      originSubdistrictName: string;
    }>(req);

    const existing = await prisma.store.findFirst({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const storeId = `store-${crypto.randomUUID().slice(0, 8)}`;
    const key = await getEncryptionKey();

    // Pre-check: phone number already registered (by hash, since phoneNumber is encrypted)
    if (phoneNumber && key) {
      const phoneHash = hashField(phoneNumber, key);
      const existingPhone = await prisma.store.findFirst({ where: { phoneNumberHash: phoneHash } });
      if (existingPhone) {
        return res.status(409).json({ error: 'Nomor HP sudah terdaftar' });
      }
    }

    const store = await prisma.store.create({
      data: {
        id: storeId,
        name: email.split('@')[0],
        email,
        phoneNumber,
        phoneNumberHash: phoneNumber ? hashField(phoneNumber, key) : null,
        address,
        originProvinceId,
        originProvinceName,
        originCityId,
        originCityName,
        originSubdistrictId,
        originSubdistrictName,
        webhookSecret: generateWebhookSecret(),
      },
    });

    // Store password in store_settings
    await prisma.storeSetting.create({
      data: {
        storeId: store.id,
        key: 'auth_password',
        value: await hashPassword(password),
      },
    });

    const token = crypto.randomUUID();

    // Persist token for session validation
    await prisma.storeSetting.upsert({
      where: { storeId_key: { storeId: store.id, key: 'auth_token' } },
      update: { value: token },
      create: { storeId: store.id, key: 'auth_token', value: token },
    });

    // Set token expiry to 7 days from now
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await prisma.storeSetting.upsert({
      where: { storeId_key: { storeId: store.id, key: 'auth_token_expires_at' } },
      update: { value: expiresAt },
      create: { storeId: store.id, key: 'auth_token_expires_at', value: expiresAt },
    });

    res.status(201).json({
      success: true,
      data: {
        storeId: store.id,
        storeName: store.name,
        email: store.email,
        token,
        hasProfile: false,
      },
    });
  } catch (error: any) {
    // Unique constraint violation — distinguish email vs phone vs slug
    if (error?.code === 'P2002') {
      const target = error?.meta?.target;
      if (target && target.includes('phoneNumberHash')) {
        return res.status(409).json({ error: 'Nomor HP sudah terdaftar' });
      }
      if (target && target.includes('slug')) {
        return res.status(409).json({ error: 'Nama toko sudah digunakan' });
      }
      return res.status(409).json({ error: 'Email already registered' });
    }
    adapters.logger.error('Registration failed', error as Error);
    res.status(500).json({ error: error?.message || 'Registration failed' });
  }
});

// POST /api/auth/login — Login with email + password, auto-create store if new
router.post('/login', validateRequest(storeLoginSchema, 'body'), storeAuthLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password } = getValidated<{ email: string; password: string }>(req);

    // Find store by email
    let store = await prisma.store.findFirst({ where: { email, deletedAt: null } });

    // Suspend check: store non-aktif tidak boleh login
    if (store && !store.isActive) {
      return res.status(403).json({ error: 'Akun Anda telah dinonaktifkan. Silakan hubungi admin.' });
    }

    if (!store) {
      // Registrasi terpisah via /register (wajib isi phone + address + lokasi).
      // Tidak lagi auto-create Store di sini.
      return res.status(401).json({
        error: 'Email belum terdaftar. Silakan daftar terlebih dahulu.',
        code: 'ERR_NOT_REGISTERED',
        redirect: '/register',
      });
    }

    // Verify password (mendukung hash lama SHA-256 + auto-upgrade ke bcrypt)
    const setting = await prisma.storeSetting.findUnique({
      where: { storeId_key: { storeId: store.id, key: 'auth_password' } },
    });
    if (!setting) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const { valid, needsRehash } = await verifyPassword(password, setting.value);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (needsRehash) {
      const newHash = await hashPassword(password);
      await prisma.storeSetting.update({
        where: { storeId_key: { storeId: store.id, key: 'auth_password' } },
        data: { value: newHash },
      });
    }

    const token = crypto.randomUUID();

    // Persist token for session validation
    await prisma.storeSetting.upsert({
      where: { storeId_key: { storeId: store.id, key: 'auth_token' } },
      update: { value: token },
      create: { storeId: store.id, key: 'auth_token', value: token },
    });

    // Set token expiry to 7 days from now
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await prisma.storeSetting.upsert({
      where: { storeId_key: { storeId: store.id, key: 'auth_token_expires_at' } },
      update: { value: expiresAt },
      create: { storeId: store.id, key: 'auth_token_expires_at', value: expiresAt },
    });

    // Check if onboarding was completed
    const onboardingSetting = await prisma.storeSetting.findUnique({
      where: { storeId_key: { storeId: store.id, key: 'onboarding_complete' } },
    });
    const hasProfile = onboardingSetting?.value === 'true';

    res.json({
      success: true,
      data: {
        storeId: store.id,
        storeName: store.name,
        email: store.email,
        token,
        hasProfile,
      },
    });
  } catch (error: any) {
    adapters.logger.error('Login failed', error as Error);
    res.status(500).json({ error: error?.message || 'Login failed' });
  }
});

// PUT /api/auth/profile — Update store profile (onboarding or gateway settings)
// Auth required. storeId always derived from the bearer token — never from body.
router.put('/profile', authMiddleware, validateRequest(updateProfileSchema, 'body'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const storeId = req.user!.storeId;
    const key = await getEncryptionKey();
    const { name, timezone, phoneNumber, fonnteToken, fonnteNumber, acceptsTransfer, acceptsQris, acceptsCod, qrisImageUrl, shippingMode, shippingFlatInCity, shippingFlatOutCity } = getValidated<any>(req);

    if (fonnteToken !== undefined && fonnteToken !== null && fonnteToken !== '') {
      const isValid = await fonnteService.validateToken(fonnteToken);
      if (!isValid) {
        return res.status(400).json({ error: 'Fonnte token is invalid' });
      }
    }

    const updateData: Record<string, any> = {};
    if (name?.trim()) updateData.name = sanitize(name.trim());
    if (timezone) updateData.timezone = timezone;
    if (phoneNumber !== undefined) {
      if (!phoneNumber || !String(phoneNumber).trim()) return res.status(400).json({ error: 'Nomor HP tidak boleh dikosongkan' });
      const phoneStr = String(phoneNumber).trim();
      updateData.phoneNumber = phoneStr;
      updateData.phoneNumberHash = hashField(phoneStr, key);
    }
    if (fonnteToken !== undefined) updateData.fonnteToken = fonnteToken === '' ? null : fonnteToken;
    if (fonnteNumber !== undefined) updateData.fonnteNumber = fonnteNumber === '' ? null : fonnteNumber;
    if (acceptsTransfer !== undefined) updateData.acceptsTransfer = acceptsTransfer;
    if (acceptsQris !== undefined) updateData.acceptsQris = acceptsQris;
    if (acceptsCod !== undefined) updateData.acceptsCod = acceptsCod;
    if (qrisImageUrl !== undefined) updateData.qrisImageUrl = qrisImageUrl === '' ? null : qrisImageUrl;
    if (shippingMode !== undefined) updateData.shippingMode = shippingMode;
    if (shippingFlatInCity !== undefined) updateData.shippingFlatInCity = shippingFlatInCity;
    if (shippingFlatOutCity !== undefined) updateData.shippingFlatOutCity = shippingFlatOutCity;

    const store = await prisma.store.update({
      where: { id: storeId },
      data: updateData,
    });

    // Mark onboarding as complete
    await prisma.storeSetting.upsert({
      where: { storeId_key: { storeId, key: 'onboarding_complete' } },
      update: { value: 'true' },
      create: { storeId, key: 'onboarding_complete', value: 'true' },
    });

    res.json({
      success: true,
      data: {
        storeId: store.id,
        name: store.name,
        timezone: store.timezone,
        phoneNumber: store.phoneNumber,
        fonnteToken: store.fonnteToken ? '***' : null,
        fonnteNumber: store.fonnteNumber || null,
        webhookSecret: store.webhookSecret || null,
        acceptsTransfer: store.acceptsTransfer,
        acceptsQris: store.acceptsQris,
        acceptsCod: store.acceptsCod,
        qrisImageUrl: store.qrisImageUrl || null,
        shippingMode: store.shippingMode,
        shippingFlatInCity: store.shippingFlatInCity,
        shippingFlatOutCity: store.shippingFlatOutCity,
      },
    });
  } catch (error: any) {
    const msg = error?.message || '';
    if (msg.includes('Fonnte')) {
      return res.status(400).json({ error: msg });
    }
    adapters.logger.error('Failed to update profile', error as Error);
    res.status(500).json({ error: error?.message || 'Failed to update profile' });
  }
});

// Multer config untuk upload QRIS image (memory storage, 3MB, image only)
// — sama persis dengan store-products.ts
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'));
    }
    cb(null, true);
  },
});

// POST /api/auth/profile/qris-image — upload QRIS image, update qrisImageUrl di store
router.post('/profile/qris-image', authMiddleware, upload.single('image'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const storeId = req.user!.storeId;

    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }

    const { url } = await adapters.catalogStorage.uploadImage(
      req.file.buffer,
      `garuda/qris/${storeId}`,
    );

    // Update qrisImageUrl di store profile
    await prisma.store.update({
      where: { id: storeId },
      data: { qrisImageUrl: url },
    });

    adapters.logger.info('QRIS image uploaded', { storeId });
    res.status(201).json({
      success: true,
      message: 'QRIS image uploaded successfully',
      data: { qrisImageUrl: url },
    });
  } catch (error: any) {
    adapters.logger.error('QRIS image upload failed', error as Error);
    res.status(400).json({ error: error?.message || 'Failed to upload QRIS image' });
  }
});

// POST /api/push/subscribe — Store (merchant) push subscription.
// Auth required. storeId derived from bearer token (never from body).
// Supports multiple subscriptions per store (multi-device/tab).
router.post('/push/subscribe', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const storeId = req.user!.storeId;
    const { subscription } = req.body as {
      subscription?: { endpoint?: string; keys?: { auth?: string; p256dh?: string } };
    };

    if (
      !subscription ||
      typeof subscription.endpoint !== 'string' ||
      !subscription.keys ||
      typeof subscription.keys.auth !== 'string' ||
      typeof subscription.keys.p256dh !== 'string'
    ) {
      return res.status(400).json({ error: 'Valid PushSubscription (endpoint, auth, p256dh) required' });
    }

    await prisma.storePushSubscription.upsert({
      where: { storeId_endpoint: { storeId, endpoint: subscription.endpoint } },
      update: {
        auth: subscription.keys.auth,
        p256dh: subscription.keys.p256dh,
        userAgent: req.headers['user-agent'] ?? null,
      },
      create: {
        storeId,
        endpoint: subscription.endpoint,
        auth: subscription.keys.auth,
        p256dh: subscription.keys.p256dh,
        userAgent: req.headers['user-agent'] ?? null,
      },
    });

    res.json({ success: true });
  } catch (error: any) {
    adapters.logger.error('Merchant push subscribe error', error as Error);
    res.status(500).json({ error: 'Failed to save subscription' });
  }
});

// POST /api/push/unsubscribe — Remove a merchant push subscription.
router.post('/push/unsubscribe', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const storeId = req.user!.storeId;
    const { endpoint } = req.body as { endpoint?: string };
    if (!endpoint || typeof endpoint !== 'string') {
      return res.status(400).json({ error: 'endpoint required' });
    }

    await prisma.storePushSubscription.deleteMany({ where: { storeId, endpoint } });
    res.json({ success: true });
  } catch (error: any) {
    adapters.logger.error('Merchant push unsubscribe error', error as Error);
    res.status(500).json({ error: 'Failed to remove subscription' });
  }
});

// --- Test-only endpoints for E2E push verification ---
// These emit real EventBus events for manual/E2E testing. Protected by a test secret.

function testAuth(req: Request, res: Response): boolean {
  const secret = req.headers['x-test-secret'];
  if (secret !== process.env.TEST_E2E_SECRET) {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  return true;
}

// POST /api/test/trigger-order-created — emit order.created for a store (by email).
router.post('/test/trigger-order-created', async (req: Request, res: Response) => {
  if (!testAuth(req, res)) return;
  try {
    const { email } = req.body as { email?: string };
    if (!email) return res.status(400).json({ error: 'email required' });
    const store = await prisma.store.findUnique({ where: { email, deletedAt: null }, select: { id: true } });
    if (!store) return res.status(404).json({ error: 'Store not found' });

    eventBus.publish({
      event: 'order.created',
      storeId: store.id,
      data: { orderId: `test-${Date.now()}`, storeId: store.id, itemCount: 2, total: 100000 },
      ts: Date.now(),
    });
    res.json({ success: true, storeId: store.id, event: 'order.created' });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed' });
  }
});

// POST /api/test/trigger-payment-pending — emit order.payment_verification_pending.
router.post('/test/trigger-payment-pending', async (req: Request, res: Response) => {
  if (!testAuth(req, res)) return;
  try {
    const { email } = req.body as { email?: string };
    if (!email) return res.status(400).json({ error: 'email required' });
    const store = await prisma.store.findUnique({ where: { email, deletedAt: null }, select: { id: true } });
    if (!store) return res.status(404).json({ error: 'Store not found' });

    eventBus.publish({
      event: 'order.payment_verification_pending',
      storeId: store.id,
      data: { orderId: `test-pay-${Date.now()}`, storeId: store.id, total: 50000 },
      ts: Date.now(),
    });
    res.json({ success: true, storeId: store.id, event: 'order.payment_verification_pending' });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed' });
  }
});

// POST /api/test/trigger-customer-message — emit message.created (customer→admin).
router.post('/test/trigger-customer-message', async (req: Request, res: Response) => {
  if (!testAuth(req, res)) return;
  try {
    const { email } = req.body as { email?: string };
    if (!email) return res.status(400).json({ error: 'email required' });
    const store = await prisma.store.findUnique({ where: { email, deletedAt: null }, select: { id: true } });
    if (!store) return res.status(404).json({ error: 'Store not found' });

    eventBus.publish({
      event: 'message.created',
      storeId: store.id,
      data: {
        id: `test-msg-${Date.now()}`,
        conversationId: `test-conv-${store.id}`,
        sender: 'customer',
        content: 'Halo, ini pesan test dari customer',
        storeId: store.id,
        customerName: 'Customer Test',
      },
      ts: Date.now(),
    });
    res.json({ success: true, storeId: store.id, event: 'message.created' });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed' });
  }
});

export default router;
