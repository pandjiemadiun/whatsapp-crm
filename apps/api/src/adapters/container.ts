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
  info: (msg: string, meta?: unknown) => winstonLogger.info(msg, meta as Record<string, unknown> | undefined),
  debug: (msg: string, meta?: unknown) => winstonLogger.debug(msg, meta as Record<string, unknown> | undefined),
  warn: (msg: string, meta?: unknown) => winstonLogger.warn(msg, meta as Record<string, unknown> | undefined),
  error: (msg: string, error?: unknown, meta?: unknown) => {
    if (error && typeof error === 'object') {
      winstonLogger.error(msg, { error: (error as Error).message || String(error), ...(meta as Record<string, unknown> | undefined) });
    } else {
      winstonLogger.error(msg, meta as Record<string, unknown> | undefined);
    }
  },
};

const ai = {
  generate: (prompt: string, options?: any) =>
    aiProviderManager.generate(prompt, options),
  extractIntent: (message: string, contextSummary?: string) =>
    aiProviderManager.extractIntent(message, contextSummary),
  getStats: () => aiProviderManager.getStats(),
  getProviders: () => aiProviderManager.getProviders(),
};

const cache = redisAdapter;

export const adapters = {
  logger,
  ai,
  cache,
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

export async function reloadAdaptersConfig(): Promise<void> {
  // AI Providers
  const groqKeys = await configService.getConfig('GROQ_API_KEYS');
  if (groqKeys) groqAdapter.configureKeys(groqKeys);

  const geminiKey = await configService.getConfig('GEMINI_API_KEY');
  if (geminiKey) geminiAdapter.configure(geminiKey);

  // GOWA + Storage + Backup adapters (hot-reload)
  await gowaAdapter.reconfigure();
  await r2Adapter.reconfigure();
  await reconfigureStorage();
  await reconfigureBackupConfig();

  logger.info('Adapter configs reloaded from database');
}
