import { adapters } from '../../adapters/container.js';

const REDIS_KEY_PREFIX = 'engine:v2:metrics:';
const MAX_ENTRIES_PER_STORE = 1000;

export interface EngineV2Metric {
  storeId: string;
  conversationId: string;
  outcome: string; // 'success' | 'fallback_reasoning_failed' | etc.
  llmCalls: number;
  validatorReasons: string[];
  replyLength: number;
  timestamp: number;
}

export function logEngineV2Metrics(
  storeId: string,
  conversationId: string,
  outcome: string,
  llmCalls: number,
  validatorReasons: string[],
  replyLength: number
): void {
  const metric: EngineV2Metric = {
    storeId,
    conversationId,
    outcome,
    llmCalls,
    validatorReasons,
    replyLength,
    timestamp: Date.now(),
  };

  const key = `${REDIS_KEY_PREFIX}${storeId}`;
  
  // Log to structured logger
  adapters.logger.info('Engine v2 metrics', metric);

  // Store in Redis list (async/fire-and-forget for performance)
  adapters.cache.lpush(key, JSON.stringify(metric)).catch((err: Error) => {
    adapters.logger.error('Failed to store engine v2 metrics', err);
  });
  
  // Truncate list to keep size manageable
  adapters.cache.ltrim(key, 0, MAX_ENTRIES_PER_STORE - 1).catch((err: Error) => {
    adapters.logger.error('Failed to truncate engine v2 metrics', err);
  });
}

export async function getCanaryMetrics(
  storeId: string,
  days = 7
): Promise<{
  totalMessages: number;
  avgLlmCalls: number;
  topValidatorReasons: Array<{ reason: string; count: number }>;
  avgReplyLength: number;
  errorRate: number;
}> {
  const key = `${REDIS_KEY_PREFIX}${storeId}`;
  const rawMetrics = await adapters.cache.lrange(key, 0, -1);
  const now = Date.now();
  const msPerDay = 24 * 60 * 60 * 1000;

  const metrics: EngineV2Metric[] = rawMetrics
    .map((m: string) => JSON.parse(m) as EngineV2Metric)
    .filter((m: EngineV2Metric) => now - m.timestamp <= days * msPerDay);

  const totalMessages = metrics.length;
  if (totalMessages === 0) {
    return {
      totalMessages: 0,
      avgLlmCalls: 0,
      topValidatorReasons: [],
      avgReplyLength: 0,
      errorRate: 0,
    };
  }

  let totalLlmCalls = 0;
  let totalReplyLength = 0;
  let fallbackErrors = 0;
  const validatorReasonsCount: Record<string, number> = {};

  for (const m of metrics) {
    totalLlmCalls += m.llmCalls;
    totalReplyLength += m.replyLength;
    if (m.outcome === 'fallback_reasoning_failed') fallbackErrors++;
    
    for (const reason of m.validatorReasons) {
      validatorReasonsCount[reason] = (validatorReasonsCount[reason] || 0) + 1;
    }
  }

  const topValidatorReasons = Object.entries(validatorReasonsCount)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  return {
    totalMessages,
    avgLlmCalls: totalLlmCalls / totalMessages,
    topValidatorReasons,
    avgReplyLength: totalReplyLength / totalMessages,
    errorRate: (fallbackErrors / totalMessages) * 100,
  };
}
