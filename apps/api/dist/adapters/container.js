import { aiProviderManager } from './ai/manager.js';
import { geminiAdapter } from './ai/gemini.adapter.js';
import { groqAdapter } from './ai/groq.adapter.js';
import { redisAdapter } from './cache/redis.adapter.js';
import { catalogStorage, profileStorage, cloudinaryAdapter, reconfigureStorage } from './storage/cloudinary.adapter.js';
import { r2Adapter } from './storage/r2.adapter.js';
import { gowaAdapter } from './whatsapp/gowa.adapter.js';
import { configService } from '../business/config.service.js';
import { reconfigureBackupConfig } from '../config/backup.config.js';
import winstonLogger from '../utils/logger.js';
// Thin wrapper to match existing logger API:
//   error(msg, error? | undefined, meta?)
//   info(msg, meta?)
//   warn(msg, meta?)
const logger = {
    info: (msg, meta) => winstonLogger.info(msg, meta),
    debug: (msg, meta) => winstonLogger.debug(msg, meta),
    warn: (msg, meta) => winstonLogger.warn(msg, meta),
    error: (msg, error, meta) => {
        if (error && typeof error === 'object') {
            winstonLogger.error(msg, { error: error.message || String(error), ...meta });
        }
        else {
            winstonLogger.error(msg, meta);
        }
    },
};
const ai = {
    generate: (prompt, options) => aiProviderManager.generate(prompt, options),
    extractIntent: (message, contextSummary) => aiProviderManager.extractIntent(message, contextSummary),
    getStats: () => aiProviderManager.getStats(),
    getProviders: () => aiProviderManager.getProviders(),
};
const cache = redisAdapter;
const llm = {
    chat: async (messages, options) => {
        return aiProviderManager.generate(messages[messages.length - 1].content, options, options?.intent || 'tryAI');
    },
};
export const adapters = {
    logger,
    ai,
    cache,
    llm,
    catalogStorage,
    profileStorage,
};
export async function initAdapters() {
    logger.info('🚀 Initializing adapters...');
    // Re-read credentials from Platform Config (DB-first, env as fallback)
    await cloudinaryAdapter.reconfigure();
    await r2Adapter.reconfigure();
    await reconfigureStorage();
    await gowaAdapter.reconfigure();
    await reconfigureBackupConfig();
    // Load dynamic configs from DB and push into adapters
    await reloadAdaptersConfig();
    const providers = aiProviderManager.getProviders();
    logger.info(`AI Providers configured:`, {
        primary: providers.primary,
        fallback: providers.fallback,
    });
    logger.info('✅ Adapters initialized successfully');
}
export async function reloadAdaptersConfig() {
    // AI Providers
    const groqKeys = await configService.getConfig('GROQ_API_KEYS');
    if (groqKeys)
        groqAdapter.configureKeys(groqKeys);
    const geminiKey = await configService.getConfig('GEMINI_API_KEY');
    if (geminiKey)
        geminiAdapter.configure(geminiKey);
    // GOWA + Storage + Backup adapters (hot-reload)
    await gowaAdapter.reconfigure();
    await r2Adapter.reconfigure();
    await reconfigureStorage();
    await reconfigureBackupConfig();
    logger.info('Adapter configs reloaded from database');
}
//# sourceMappingURL=container.js.map