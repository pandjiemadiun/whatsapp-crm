import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import { prisma } from './infrastructure/prisma.js';
// Global BigInt serialization (Prisma returns BigInt for numeric fields)
BigInt.prototype.toJSON = function () {
    return Number(this);
};
import messagesRouter from './routes/messages.js';
import faqRouter from './routes/faq.js';
import knowledgeRouter from './routes/knowledge.js';
import webhooksRouter from './routes/webhooks.js';
import authRouter from './routes/auth.js';
import metricsRouter from './routes/metrics.js';
import whatsappRouter from './routes/whatsapp.js';
import conversationsRouter from './routes/conversations.js';
import ordersRouter from './routes/orders.js';
import settingsRouter from './routes/settings.js';
import profileRouter from './routes/profile.js';
import adminAuthRoutes from './routes/admin/auth.js';
import adminStoresRoutes from './routes/admin/stores.js';
import adminConfigRoutes from './routes/admin/config.js';
import adminAuditRoutes from './routes/admin/audit-logs.js';
import adminBackupRoutes from './routes/admin/backups.js';
import adminKeyRotationRoutes from './routes/admin/key-rotation.js';
import adminMagicPasteRoutes from './routes/admin/magic-paste.js';
import missionControlRouter from './routes/admin/mission-control.js';
import adminAnalyticsRoutes from './routes/admin/analytics.js';
import productsRouter from './routes/products.js';
import storeProductsRouter from './routes/store-products.js';
import analyticsRouter from './routes/analytics.js';
import adminProductsRoutes from './routes/admin/products.js';
import bankAccountsRouter from './routes/bank-accounts.js';
import sopRouter from './routes/sop.js';
import { adminAuthMiddleware } from './middleware/adminAuth.js';
import { requireAdminRole } from './middleware/adminAuthGuard.js';
import { initializeDefaultConfigs } from './bootstrap/initializeConfig.js';
import { maintenanceModeMiddleware } from './middleware/maintenanceMode.js';
import healthRouter from './routes/health.js';
import redirectRouter from './routes/redirect.js';
import { startHealthCheckInterval } from './business/health.service.js';
import { messageProcessorService } from './services/message-processor.service.js';
import { healthMonitorService } from './services/health-monitor.service.js';
import { scheduleBackups } from './bootstrap/scheduleBackups.js';
import { scheduleFollowUps } from './bootstrap/scheduleFollowUps.js';
import { scheduleLearning } from './bootstrap/scheduleLearning.js';
import { requestIdMiddleware } from './middleware/requestId.js';
import { errorHandler } from './middleware/errorHandler.js';
import logger from './utils/logger.js';
import { getEncryptionKey } from './utils/encryption.js';
// Menyesuaikan __dirname untuk TypeScript ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Arahkan ke .env di root project (naik 3 level dari dist/ ke root, atau 2 level dari src/)
// override:true → root .env SELALU menang, meski process.env sudah terisi dari sumber lain.
dotenv.config({ path: path.resolve(__dirname, '../../../.env'), override: true });
const app = express();
const PORT = process.env.PORT || 3000;
// Behind Cloudflare Tunnel (proxy) — trust the immediate proxy hop so that
// express-rate-limit can correctly identify real client IPs via X-Forwarded-For.
// Without this, every visitor appears as 127.0.0.1 and rate limits hit everyone.
app.set('trust proxy', Number(process.env.TRUST_PROXY || 1));
// Middleware JSON & CORS
app.use(express.json());
app.use(cors({
    origin: ['http://localhost:5173', 'http://localhost:4173'],
    credentials: true,
}));
// Request correlation ID (must be after CORS, before everything else)
app.use(requestIdMiddleware);
// Maintenance mode check (skip health check and root)
app.use(maintenanceModeMiddleware);
// Health check routes (mounted BEFORE other routes, AFTER CORS)
app.use('/api', healthRouter);
// Short-link redirect routes (public — QR codes printed on materials must work)
app.use('/r', redirectRouter);
// Mount Routes
app.use('/api/messages', messagesRouter);
app.use('/api/faq', faqRouter);
app.use('/api/knowledge', knowledgeRouter);
app.use('/api/webhooks', webhooksRouter);
app.use('/api/auth', authRouter);
app.use('/api/dashboard', metricsRouter);
app.use('/api/whatsapp', whatsappRouter);
app.use('/api/conversations', conversationsRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/profile', profileRouter);
app.use('/api/bank-accounts', bankAccountsRouter);
app.use('/api/sop', sopRouter);
app.use('/api/admin/auth', adminAuthRoutes);
app.use('/api/admin/stores', adminAuthMiddleware, adminStoresRoutes);
app.use('/api/admin/config', adminAuthMiddleware, adminConfigRoutes);
app.use('/api/admin/audit-logs', adminAuthMiddleware, adminAuditRoutes);
app.use('/api/admin/backups', adminAuthMiddleware, adminBackupRoutes);
app.use('/api/admin/key-rotation', adminAuthMiddleware, adminKeyRotationRoutes);
app.use('/api/admin/analytics', adminAuthMiddleware, adminAnalyticsRoutes);
app.use('/api/admin/magic-paste', adminAuthMiddleware, adminMagicPasteRoutes);
app.use('/api/admin/mission-control', adminAuthMiddleware, requireAdminRole(['super_admin']), missionControlRouter);
app.use('/api/admin', adminProductsRoutes);
// Store-owner product routes (auth) — mounted BEFORE public catalog
app.use('/api/products', storeProductsRouter);
// Store-owner analytics routes (auth)
app.use('/api/analytics', analyticsRouter);
// Public product catalog routes (mounted under /api, path di-handle dalam router)
app.use('/api', productsRouter);
// Health Check Endpoint — under /api so dashboard's axios baseURL works
app.get('/api/health', async (req, res) => {
    try {
        await prisma.$queryRaw `SELECT 1`;
        res.json({
            status: 'ok',
            database: 'connected',
            timestamp: new Date()
        });
    }
    catch (error) {
        res.status(503).json({
            status: 'error',
            database: 'disconnected',
            error: error.message
        });
    }
});
// Root Endpoint
app.get('/', (req, res) => {
    res.json({ message: 'PROJECT GARUDA v1.0' });
});
// 404 handler — must be after all routes
app.use((_req, res) => {
    res.status(404).json({ error: 'Route not found', code: 'ERR_NOT_FOUND', requestId: _req.requestId || 'unknown', timestamp: new Date().toISOString() });
});
// Global error handler (must be last middleware)
app.use(errorHandler);
app.listen(PORT, async () => {
    logger.info(`🚀 GARUDA API running on port ${PORT}`);
    // Pre-load encryption key from Cloudflare Worker / env var
    try {
        const key = await getEncryptionKey();
        if (key) {
            logger.info('Encryption key loaded successfully (source: Cloudflare Worker)');
        }
        else {
            logger.warn('Encryption key not available — field encryption is DISABLED');
        }
    }
    catch (err) {
        logger.warn('Failed to load encryption key — field encryption is DISABLED', { error: err.message });
    }
    // Initialize default system configs (idempotent)
    try {
        await initializeDefaultConfigs();
        logger.info('Default system configs initialized');
    }
    catch (err) {
        logger.warn('Config initialization skipped', { error: err.message });
    }
    // Load dynamic configs (AI keys, etc.) from DB into adapters
    try {
        const { initAdapters } = await import('./adapters/container.js');
        await initAdapters();
    }
    catch (err) {
        logger.warn('Adapter initialization failed', { error: err.message });
    }
    // Start background health check (every 30 seconds)
    startHealthCheckInterval();
    // Start backup scheduler (daily 2AM, weekly Sun 3AM)
    scheduleBackups();
    // Start proactive follow-up scheduler (every 10min by default)
    scheduleFollowUps();
    scheduleLearning();
    // Seed default store on first startup
    try {
        await prisma.store.upsert({
            where: { id: 'store-1' },
            update: {},
            create: {
                id: 'store-1',
                name: 'Toko Uji Coba',
                phoneNumber: '+6281234567890',
            },
        });
        const envStoreId = process.env.DEFAULT_STORE_ID;
        if (envStoreId && envStoreId !== 'store-1') {
            await prisma.store.upsert({
                where: { id: envStoreId },
                update: {},
                create: {
                    id: envStoreId,
                    name: process.env.DEFAULT_STORE_NAME || 'Default Store',
                    phoneNumber: process.env.DEFAULT_STORE_PHONE || '+6280000000000',
                },
            });
        }
        logger.info('Default store seeded');
    }
    catch (err) {
        logger.warn('Store seeding skipped', { error: err.message });
    }
    // WhatsApp pipeline initialization (circuit breaker, health monitor)
    logger.info('Wa pipeline initialized', {
        circuitState: messageProcessorService.getCircuitBreakerMetrics().state,
    });
    // Health monitor — check safe mode every 30 seconds
    setInterval(() => {
        healthMonitorService.checkSafeMode();
    }, 30000);
});
// Graceful shutdown — drain queues, reset circuit breakers, close DB
process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down gracefully...');
    await messageProcessorService.shutdown();
    await prisma.$disconnect();
    process.exit(0);
});
process.on('SIGINT', async () => {
    logger.info('SIGINT received, shutting down gracefully...');
    await messageProcessorService.shutdown();
    await prisma.$disconnect();
    process.exit(0);
});
//# sourceMappingURL=index.js.map