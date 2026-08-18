import { configService } from '../../business/config.service.js';

export interface AiDefaults {
  primaryModel: string;
  fallbackModel: string;
  temperature: number;
  topP: number;
  maxTokensGemini: number;
  maxTokensGroq: number;
  buySignalTemperature: number;
  styleGuide: string;
}

const FALLBACKS: AiDefaults = {
  primaryModel: 'gemini-3.6-flash',
  fallbackModel: 'openai/gpt-oss-120b',
  temperature: 0.7,
  topP: 0.95,
  maxTokensGemini: 2048,
  maxTokensGroq: 500,
  buySignalTemperature: 0.1,
  styleGuide: `[Panduan Gaya Bahasa Customer Service WhatsApp]
- Gunakan bahasa Indonesia yang ramah, sopan, dan hangat khas CS toko online (gunakan sapaan "Kak").
- Jangan pernah menutup transaksi secara kaku/prematur. Selalu tawarkan bantuan atau tanyakan apakah ada tambahan item.
- Jawab secara ringkas dan lugas (cocok untuk pesan WhatsApp).`,
};

function parseNum(val: string | null, fallback: number): number {
  if (val == null) return fallback;
  const n = parseFloat(val);
  return isNaN(n) ? fallback : n;
}

function parseIntSafe(val: string | null, fallback: number): number {
  if (val == null) return fallback;
  const n = parseInt(val, 10);
  return isNaN(n) ? fallback : n;
}

let cachedDefaults: { values: AiDefaults; timestamp: number } | null = null;
const CACHE_TTL_MS = 30_000; // 30 seconds local cache (configService already caches 5 min)

export async function getAiDefaults(): Promise<AiDefaults> {
  const now = Date.now();
  if (cachedDefaults && now - cachedDefaults.timestamp < CACHE_TTL_MS) {
    return cachedDefaults.values;
  }

  const [
    primaryModel,
    fallbackModel,
    temperature,
    topP,
    maxTokensGemini,
    maxTokensGroq,
    buySignalTemp,
    styleGuide,
  ] = await Promise.all([
    configService.getConfig('ai.model.primary'),
    configService.getConfig('ai.model.fallback'),
    configService.getConfig('ai.temperature'),
    configService.getConfig('ai.topP'),
    configService.getConfig('ai.maxTokens.gemini'),
    configService.getConfig('ai.maxTokens.groq'),
    configService.getConfig('ai.buySignalTemperature'),
    configService.getConfig('ai.styleGuide'),
  ]);

  const values: AiDefaults = {
    primaryModel: primaryModel || FALLBACKS.primaryModel,
    fallbackModel: fallbackModel || FALLBACKS.fallbackModel,
    temperature: parseNum(temperature, FALLBACKS.temperature),
    topP: parseNum(topP, FALLBACKS.topP),
    maxTokensGemini: parseIntSafe(maxTokensGemini, FALLBACKS.maxTokensGemini),
    maxTokensGroq: parseIntSafe(maxTokensGroq, FALLBACKS.maxTokensGroq),
    buySignalTemperature: parseNum(buySignalTemp, FALLBACKS.buySignalTemperature),
    styleGuide: styleGuide !== null ? styleGuide : FALLBACKS.styleGuide,
  };

  cachedDefaults = { values, timestamp: now };
  return values;
}

export function invalidateAiDefaultsCache(): void {
  cachedDefaults = null;
}
