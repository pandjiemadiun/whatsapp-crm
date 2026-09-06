/**
 * Smoke test: callV2Engine() forced to chat_fallback_2 (Internal LLM).
 *
 * - Clears resolver cache (picks up skipParams with response_format)
 * - Triggers cooldown on Mistral (primary) + SambaNova (fallback)
 *   so the gateway's 3-tier fallthrough reaches Internal LLM (fallback_2)
 * - Calls callV2Engine() with jsonMode:true (hardcoded in engine-call.ts)
 * - Reports: raw response, extractJson parse result, schema validation
 *
 * Usage: npx tsx --env-file=../../.env smoke-test-internal-llm.mts
 */
import { prisma } from './src/infrastructure/prisma.js';
import { llmGateway } from './src/adapters/ai/llm-gateway.js';
import { callV2Engine } from './src/services/chat/v2-engine/engine-call.js';
import { cooldown } from './src/services/provider-cooldown.js';
import { aiProviderResolver } from './src/services/ai-provider-resolver.service.js';

async function main() {
  console.log('=== SMOKE TEST: Internal LLM via callV2Engine ===\n');

  // ── 1. Clear resolver cache so updated skipParams is picked up ──
  aiProviderResolver.invalidateCache();
  // Clear gateway dynamic flag cache so it re-reads from DB
  (llmGateway as any).dynamicFlagCache = null;
  console.log('[1] Resolver cache cleared, gateway flag cache cleared\n');

  // ── 2. Force cooldowns on Mistral (primary) + SambaNova (fallback) ──
  // This forces 3-tier fallthrough: primary→cooldown, fallback→cooldown,
  // fallback_2→Internal LLM (NOT in cooldown)
  cooldown('Mistral', 5 * 60_000);
  cooldown('SambaNova', 5 * 60_000);
  console.log('[2] Cooldowns triggered: Mistral, SambaNova (5 min each)\n');

  // ── 3. Verify provider resolution ──
  const fb2 = await aiProviderResolver.getProvidersForRole('chat_fallback_2');
  console.log('[3] chat_fallback_2 providers:');
  for (const p of fb2) {
    const stats = (p as any);
    console.log(`    - ${stats.getName?.() ?? 'unknown'} (${stats.getModel?.() ?? '?'})`);
  }
  console.log('');

  // ── 4. Build context (mirrors buildLLMContext output format) ──
  const context = `STATE: new conversation, store=Bengkel Didik, no cart yet
HISTORY: (empty)
PESAN SEKARANG: Saya mau beli sepatu warna merah size L`;

  // ── 5. Call V2 engine (jsonMode: true is hardcoded inside callV2Engine) ──
  console.log('[4] Calling callV2Engine(context, "chat_fallback")...');
  console.log('    jsonMode: true (hardcoded in engine-call.ts)');
  console.log('    skipParams on Internal LLM: ["temperature","top_p","response_format"]\n');

  const startTime = Date.now();
  const result = await callV2Engine(context, 'chat_fallback');
  const elapsed = Date.now() - startTime;

  // ── 6. Report results ──
  console.log(`[5] callV2Engine completed in ${elapsed}ms`);
  console.log('');

  if (result.success) {
    console.log('✅ RESULT: SUCCESS (schema-valid JSON parsed)');
    console.log('');
    console.log('  Provider:', result.provider);
    console.log('  Model:', result.model);
    console.log('');
    console.log('  Parsed V2EngineOutput:');
    console.log(JSON.stringify(result.data, null, 2));
    console.log('');
    console.log('  reply_text:', result.data.reply_text);
    console.log('  intent:', result.data.intent);
    console.log('  confidence:', result.data.confidence);
    console.log('  entities:', result.data.entities?.length ?? 0);
    console.log('  proposed_actions:', result.data.proposed_actions?.length ?? 0);
  } else {
    console.log('❌ RESULT: FAILURE');
    console.log('  Error type:', result.error.type);
    console.log('  Error message:', result.error.message);
    if (result.error.type === 'parse_error') {
      console.log('');
      console.log('  ── RAW OUTPUT (truncated to 500 chars) ──');
      console.log(result.error.rawOutput.slice(0, 500));
    }
    if (result.error.type === 'provider_exhausted') {
      console.log('');
      console.log('  Failed providers:', result.error.failedProviders);
    }
  }

  await prisma.$disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
