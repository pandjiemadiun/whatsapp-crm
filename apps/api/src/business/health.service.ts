import { groqAdapter } from '../adapters/ai/groq.adapter.js';
import { geminiAdapter } from '../adapters/ai/gemini.adapter.js';
import { redisAdapter } from '../adapters/cache/redis.adapter.js';
import { adapters } from '../adapters/container.js';
import { configService } from './config.service.js';
import { prisma } from '../infrastructure/prisma.js';
const APP_START_TIME = Date.now();

interface DependencyStatus {
  status: 'ok' | 'down' | 'error' | 'unconfigured';
  responseTime?: number;
  lastCheck?: string;
  error?: string;
}

interface SystemStatus {
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  uptime: number;
  dependencies: {
    database: DependencyStatus;
    redis: DependencyStatus;
    groq: DependencyStatus;
    gemini: DependencyStatus;
  };
  metrics: {
    totalStores: number;
    activeStores: number;
    totalConversations: number;
    totalMessages: number;
    aiResponsesLast24h: number;
    avgResponseTime: number;
    whatsappConnected: number;
    whatsappDisconnected: number;
  };
}

interface CachedStatus {
  data: SystemStatus | null;
  expiresAt: number;
}

const cache: CachedStatus = { data: null, expiresAt: 0 };
const CACHE_TTL_MS = 30_000;

export class HealthService {
  async getSystemStatus(forceRefresh = false): Promise<SystemStatus> {
    if (!forceRefresh && cache.data && Date.now() < cache.expiresAt) {
      return cache.data;
    }

    const [dbStatus, redisStatus, groqStatus, geminiStatus, metrics] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkGroq(),
      this.checkGemini(),
      this.getMetrics(),
    ]);

    const deps = {
      database: dbStatus,
      redis: redisStatus,
      groq: groqStatus,
      gemini: geminiStatus,
    };

    let overall: 'ok' | 'degraded' | 'down';
    // Database & Redis are critical — everything else (Groq/Gemini) is optional
    if (dbStatus.status === 'down' || redisStatus.status === 'down') {
      overall = 'down';
    } else if (dbStatus.status !== 'ok' || redisStatus.status !== 'ok') {
      overall = 'degraded';
    } else if (groqStatus.status !== 'ok' || geminiStatus.status !== 'ok') {
      // AI providers down → report as 'ok' (core system works) but note in deps
      overall = 'ok';
    } else {
      overall = 'ok';
    }

    const result: SystemStatus = {
      status: overall,
      timestamp: new Date().toISOString(),
      uptime: Date.now() - APP_START_TIME,
      dependencies: deps,
      metrics,
    };

    cache.data = result;
    cache.expiresAt = Date.now() + CACHE_TTL_MS;

    return result;
  }

  async checkDatabase(): Promise<DependencyStatus> {
    const start = Date.now();
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', responseTime: Date.now() - start, lastCheck: new Date().toISOString() };
    } catch (error) {
      return { status: 'down', error: (error as Error).message };
    }
  }

  async checkRedis(): Promise<DependencyStatus> {
    const start = Date.now();
    try {
      const ok = await redisAdapter.ping();
      if (!ok) return { status: 'down', responseTime: Date.now() - start, error: 'PING failed' };
      return { status: 'ok', responseTime: Date.now() - start, lastCheck: new Date().toISOString() };
    } catch (error) {
      return { status: 'down', error: (error as Error).message };
    }
  }

  async checkGroq(): Promise<DependencyStatus> {
    try {
      if (!process.env.GROQ_API_KEYS) {
        const cfg = await configService.getConfig('GROQ_API_KEYS');
        if (!cfg) return { status: 'unconfigured', error: 'API key not set' };
      }
      const healthy = await groqAdapter.isHealthy();
      return healthy ? { status: 'ok' } : { status: 'error', error: 'Health check failed' };
    } catch (error) {
      return { status: 'error', error: (error as Error).message };
    }
  }

  async checkGemini(): Promise<DependencyStatus> {
    try {
      if (!process.env.GEMINI_API_KEY) {
        const cfg = await configService.getConfig('GEMINI_API_KEY');
        if (!cfg) return { status: 'unconfigured', error: 'API key not set' };
      }
      const healthy = await geminiAdapter.isHealthy();
      return healthy ? { status: 'ok' } : { status: 'error', error: 'Health check failed' };
    } catch (error) {
      return { status: 'error', error: (error as Error).message };
    }
  }

  async getMetrics() {
    const start = Date.now();
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [
      totalStores,
      activeStores,
      totalConversations,
      totalMessages,
      aiResponsesLast24h,
      avgResponseTimeAgg,
      fonnteStores,
    ] = await Promise.all([
      prisma.store.count({ where: { deletedAt: null } }),
      prisma.store.count({ where: { isActive: true, deletedAt: null } }),
      prisma.conversation.count({ where: { deletedAt: null } }),
      prisma.conversationHistory.count({ where: { conversation: { deletedAt: null } } }),
      prisma.conversationHistory.count({
        where: { role: 'assistant', createdAt: { gte: twentyFourHoursAgo }, conversation: { deletedAt: null } },
      }),
      prisma.conversationHistory.aggregate({
        where: { conversation: { deletedAt: null } },
        _avg: { responseTime: true },
      }),
      prisma.store.findMany({
        where: { deletedAt: null },
        select: { fonnteToken: true },
      }),
    ]);

    // Real check: ping Fonnte device status, bukan cuma token !== null
    let whatsappConnected = 0;
    let whatsappDisconnected = 0;
    try {
      const { fonnteService } = await import('../services/fonnte.service.js');
      for (const s of fonnteStores) {
        if (!s.fonnteToken) { whatsappDisconnected++; continue; }
        try {
          const status = await fonnteService.getDeviceStatus(s.fonnteToken);
          status.connected ? whatsappConnected++ : whatsappDisconnected++;
        } catch {
          whatsappDisconnected++;
        }
      }
    } catch {
      // Fallback to old behavior if Fonnte service unavailable
      whatsappConnected = fonnteStores.filter(s => s.fonnteToken !== null).length;
      whatsappDisconnected = fonnteStores.length - whatsappConnected;
    }

    adapters.logger.info('Health metrics calculated', { duration: Date.now() - start });

    return {
      totalStores,
      activeStores,
      totalConversations,
      totalMessages,
      aiResponsesLast24h,
      avgResponseTime: Math.round(avgResponseTimeAgg._avg.responseTime ?? 0),
      whatsappConnected,
      whatsappDisconnected,
    };
  }
}

export const healthService = new HealthService();

export function startHealthCheckInterval(): void {
  setInterval(async () => {
    try {
      await healthService.getSystemStatus(true);
    } catch (error) {
      adapters.logger.warn('Background health check failed', error as Error);
    }
  }, 30_000);
}
