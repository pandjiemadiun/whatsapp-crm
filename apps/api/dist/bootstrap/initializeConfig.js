import { prisma } from '../infrastructure/prisma.js';
const groqApiKeys = (process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
    .join(',');
const DEFAULT_CONFIGS = [
    {
        key: 'GROQ_API_KEYS',
        value: groqApiKeys,
        category: 'ai',
        isSecret: true,
        description: 'Groq API keys (comma-separated) for multi-key auto-rotation',
    },
    {
        key: 'GEMINI_API_KEY',
        value: process.env.GEMINI_API_KEY || '',
        category: 'ai',
        isSecret: true,
        description: 'Google Gemini API key',
    },
    {
        key: 'OPENAI_API_KEY',
        value: process.env.OPENAI_API_KEY || '',
        category: 'ai',
        isSecret: true,
        description: 'OpenAI API key (backup AI provider)',
    },
    {
        key: 'REDIS_URL',
        value: process.env.REDIS_URL || 'redis://localhost:6379',
        category: 'cache',
        isSecret: false,
        description: 'Redis connection URL for caching',
    },
    {
        key: 'CLOUDINARY_CLOUD_NAME',
        value: process.env.CLOUDINARY_CLOUD_NAME || '',
        category: 'storage',
        isSecret: false,
        description: 'Cloudinary cloud name',
    },
    {
        key: 'CLOUDINARY_API_KEY',
        value: process.env.CLOUDINARY_API_KEY || '',
        category: 'storage',
        isSecret: true,
        description: 'Cloudinary API key',
    },
    {
        key: 'CLOUDINARY_API_SECRET',
        value: process.env.CLOUDINARY_API_SECRET || '',
        category: 'storage',
        isSecret: true,
        description: 'Cloudinary API secret',
    },
    {
        key: 'MAX_DAILY_AI_REQUESTS',
        value: '1000',
        category: 'general',
        isSecret: false,
        description: 'Max AI requests per day (rate limit)',
    },
    {
        key: 'MAINTENANCE_MODE',
        value: 'false',
        category: 'general',
        isSecret: false,
        description: "Set to 'true' to enable maintenance mode",
    },
    // ─── AI Behavior (hot-reloadable, no restart needed) ───
    {
        key: 'ai.model.primary',
        value: 'gemini-1.5-flash',
        category: 'ai_behavior',
        isSecret: false,
        description: 'Primary AI model for natural conversation responses',
    },
    {
        key: 'ai.model.fallback',
        value: 'llama-3.3-70b-versatile',
        category: 'ai_behavior',
        isSecret: false,
        description: 'Fallback AI model (Groq)',
    },
    {
        key: 'ai.temperature',
        value: '0.7',
        category: 'ai_behavior',
        isSecret: false,
        description: 'AI response temperature (0.0-1.0). Higher = more creative.',
    },
    {
        key: 'ai.topP',
        value: '0.95',
        category: 'ai_behavior',
        isSecret: false,
        description: 'AI nucleus sampling parameter (0.0-1.0)',
    },
    {
        key: 'ai.maxTokens.gemini',
        value: '2048',
        category: 'ai_behavior',
        isSecret: false,
        description: 'Max output tokens for Gemini model',
    },
    {
        key: 'ai.maxTokens.groq',
        value: '500',
        category: 'ai_behavior',
        isSecret: false,
        description: 'Max output tokens for Groq LLaMA model',
    },
    {
        key: 'ai.buySignalTemperature',
        value: '0.1',
        category: 'ai_behavior',
        isSecret: false,
        description: 'Temperature for buy-signal intent classification (Groq gatekeeper)',
    },
    {
        key: 'ai.styleGuide',
        value: '[Panduan Gaya Bahasa Customer Service WhatsApp]\n- Gunakan bahasa Indonesia yang ramah, sopan, dan hangat khas CS toko online (gunakan sapaan "Kak").\n- Jangan pernah menutup transaksi secara kaku/prematur. Selalu tawarkan bantuan atau tanyakan apakah ada tambahan item.\n- Jawab secara ringkas dan lugas (cocok untuk pesan WhatsApp).',
        category: 'ai_behavior',
        isSecret: false,
        description: 'WhatsApp CS style guide appended to every AI prompt',
    },
    // ─── Integrations (GOWA / Backup / Storage — hot-reloadable, secrets masked) ───
    {
        key: 'GOWA_API_URL',
        value: process.env.GOWA_API_URL || 'http://localhost:3001',
        category: 'integrations',
        isSecret: false,
        description: 'GOWA (WhatsApp gateway) API base URL',
    },
    {
        key: 'GOWA_BASIC_AUTH_USER',
        value: process.env.GOWA_BASIC_AUTH_USER || 'admin',
        category: 'integrations',
        isSecret: false,
        description: 'GOWA basic auth username',
    },
    {
        key: 'GOWA_BASIC_AUTH_PASS',
        value: process.env.GOWA_BASIC_AUTH_PASS || '',
        category: 'integrations',
        isSecret: true,
        description: 'GOWA basic auth password',
    },
    {
        key: 'BACKUP_ENCRYPTION_KEY',
        value: process.env.BACKUP_ENCRYPTION_KEY || '',
        category: 'integrations',
        isSecret: true,
        description: 'Encryption key for database backup files',
    },
    {
        key: 'BACKUP_S3_BUCKET',
        value: process.env.BACKUP_S3_BUCKET || '',
        category: 'integrations',
        isSecret: false,
        description: 'S3 bucket for backup storage (used when BACKUP_PROVIDER=s3)',
    },
    {
        key: 'BACKUP_S3_REGION',
        value: process.env.BACKUP_S3_REGION || process.env.AWS_REGION || 'us-east-1',
        category: 'integrations',
        isSecret: false,
        description: 'AWS region for S3 backups',
    },
    {
        key: 'BACKUP_ALERT_EMAIL',
        value: process.env.BACKUP_ALERT_EMAIL || '',
        category: 'integrations',
        isSecret: false,
        description: 'Email address to receive backup failure alerts',
    },
    {
        key: 'BACKUP_PROVIDER',
        value: process.env.BACKUP_PROVIDER || 'local',
        category: 'integrations',
        isSecret: false,
        description: 'Backup storage provider: "local" or "s3"',
    },
    {
        key: 'STORAGE_PROVIDER',
        value: process.env.STORAGE_PROVIDER || 'r2',
        category: 'integrations',
        isSecret: false,
        description: 'Storage adapter: "r2", "cloudinary", or "auto"',
    },
    {
        key: 'R2_ACCOUNT_ID',
        value: process.env.R2_ACCOUNT_ID || '',
        category: 'integrations',
        isSecret: true,
        description: 'Cloudflare R2 account ID',
    },
    {
        key: 'R2_ACCESS_KEY_ID',
        value: process.env.R2_ACCESS_KEY_ID || '',
        category: 'integrations',
        isSecret: true,
        description: 'Cloudflare R2 S3-compatible access key ID',
    },
    {
        key: 'R2_SECRET_ACCESS_KEY',
        value: process.env.R2_SECRET_ACCESS_KEY || '',
        category: 'integrations',
        isSecret: true,
        description: 'Cloudflare R2 S3-compatible secret access key',
    },
    {
        key: 'R2_BUCKET',
        value: process.env.R2_BUCKET || '',
        category: 'integrations',
        isSecret: false,
        description: 'Cloudflare R2 bucket name',
    },
    {
        key: 'R2_PUBLIC_BASE_URL',
        value: process.env.R2_PUBLIC_BASE_URL || '',
        category: 'integrations',
        isSecret: false,
        description: 'Public base URL for R2 object access (optional)',
    },
    // ─── Encryption key (Stage G2: migrated to DB as primary source) ───
    {
        key: 'FIELD_ENCRYPTION_KEY',
        value: process.env.FIELD_ENCRYPTION_KEY || '',
        category: 'encryption',
        isSecret: true,
        description: 'AES-256-GCM field encryption key (32 bytes hex). Primary: DB. Fallback: Cloudflare Worker / env.',
    },
];
export async function initializeDefaultConfigs() {
    for (const cfg of DEFAULT_CONFIGS) {
        const existing = await prisma.systemSetting.findUnique({ where: { key: cfg.key } });
        if (!existing) {
            await prisma.systemSetting.create({
                data: {
                    key: cfg.key,
                    value: cfg.isSecret ? Buffer.from(cfg.value).toString('base64') : cfg.value,
                    category: cfg.category,
                    isSecret: cfg.isSecret,
                    description: cfg.description,
                },
            });
            console.log(`[Bootstrap] Seeded config: ${cfg.key}`);
        }
    }
}
//# sourceMappingURL=initializeConfig.js.map