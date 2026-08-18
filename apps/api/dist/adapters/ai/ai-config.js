import { configService } from '../../business/config.service.js';
const FALLBACKS = {
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
function parseNum(val, fallback) {
    if (val == null)
        return fallback;
    const n = parseFloat(val);
    return isNaN(n) ? fallback : n;
}
function parseIntSafe(val, fallback) {
    if (val == null)
        return fallback;
    const n = parseInt(val, 10);
    return isNaN(n) ? fallback : n;
}
let cachedDefaults = null;
const CACHE_TTL_MS = 30000; // 30 seconds local cache (configService already caches 5 min)
export async function getAiDefaults() {
    const now = Date.now();
    if (cachedDefaults && now - cachedDefaults.timestamp < CACHE_TTL_MS) {
        return cachedDefaults.values;
    }
    const [primaryModel, fallbackModel, temperature, topP, maxTokensGemini, maxTokensGroq, buySignalTemp, styleGuide,] = await Promise.all([
        configService.getConfig('ai.model.primary'),
        configService.getConfig('ai.model.fallback'),
        configService.getConfig('ai.temperature'),
        configService.getConfig('ai.topP'),
        configService.getConfig('ai.maxTokens.gemini'),
        configService.getConfig('ai.maxTokens.groq'),
        configService.getConfig('ai.buySignalTemperature'),
        configService.getConfig('ai.styleGuide'),
    ]);
    const values = {
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
export function invalidateAiDefaultsCache() {
    cachedDefaults = null;
}
//# sourceMappingURL=ai-config.js.map