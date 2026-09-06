/**
 * Smoke test 2: callV2Engine() with smalltalk intent.
 * Same setup as test 1, different context.
 */
import { prisma } from './src/infrastructure/prisma.js';
import { llmGateway } from './src/adapters/ai/llm-gateway.js';
import { callV2Engine } from './src/services/chat/v2-engine/engine-call.js';
import { cooldown } from './src/services/provider-cooldown.js';
import { aiProviderResolver } from './src/services/ai-provider-resolver.service.js';

async function main() {
  console.log('=== SMOKE TEST 2: smalltalk ===\n');

  aiProviderResolver.invalidateCache();
  (llmGateway as any).dynamicFlagCache = null;
  cooldown('Mistral', 5 * 60_000);
  cooldown('SambaNova', 5 * 60_000);

  const context = `STATE: new conversation, store=Bengkel Didik
HISTORY: (empty)
PESAN SEKARANG: Halo, ada diskon nggak?`;

  console.log('[Calling callV2Engine with jsonMode:true — response_format OMITTED via skipParams]\n');
  const result = await callV2Engine(context, 'chat_fallback');

  if (result.success) {
    console.log('✅ SUCCESS');
    console.log('Provider:', result.provider);
    console.log('Model:', result.model);
    console.log('Intent:', result.data.intent);
    console.log('Confidence:', result.data.confidence);
    console.log('Reply:', result.data.reply_text);
    console.log('Entities:', JSON.stringify(result.data.entities));
    console.log('Proposed actions:', JSON.stringify(result.data.proposed_actions));
    console.log('Summary:', result.data.summary_update);
    console.log('');
    console.log('Full V2EngineOutput:');
    console.log(JSON.stringify(result.data, null, 2));
  } else {
    console.log('❌ FAILURE');
    console.log('Type:', result.error.type);
    console.log('Message:', result.error.message);
    if ('rawOutput' in result.error) {
      console.log('Raw output (first 500 chars):');
      console.log(result.error.rawOutput.slice(0, 500));
    }
  }

  await prisma.$disconnect();
  process.exit(0);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
