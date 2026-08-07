#!/usr/bin/env node
import 'dotenv/config';
import { adapters, initAdapters } from './apps/api/src/adapters/container.js';

async function runTests() {
  console.log('\n========================================');
  console.log('   🤖 AI ADAPTER INTEGRATION TEST');
  console.log('   Groq PRIMARY | Gemini FALLBACK');
  console.log('========================================\n');

  // Environment check
  console.log('📋 Environment check:');
  const hasGemini = !!process.env.GEMINI_API_KEY;
  const hasGroq = !!process.env.GROQ_API_KEYS;
  console.log(`   GEMINI_API_KEY: ${hasGemini ? '✅' : '❌'} loaded`);
  console.log(`   GROQ_API_KEYS: ${hasGroq ? '✅' : '❌'} loaded`);

  if (!hasGemini || !hasGroq) {
    console.error('❌ Missing API keys!');
    process.exit(1);
  }

  // Init adapters
  console.log('\n🔧 Initializing adapters...');
  await initAdapters();

  // Test 1: Short explanation
  console.log('\n\n[TEST 1] Short explanation (50 kata)\n');
  try {
    const result1 = await adapters.ai.generate(
      'Jelaskan singkat dalam 50 kata: apa itu Artificial Intelligence?',
      { maxTokens: 1000 }
    );

    console.log('✅ Response:');
    console.log(`   "${result1.content}"`);
    console.log('\n📊 Stats:');
    console.log(`   Length: ${result1.content.length} chars`);
    console.log(`   Input tokens: ${result1.tokens.input}`);
    console.log(`   Output tokens: ${result1.tokens.output}`);
    console.log(`   Cost: $${result1.cost.toFixed(6)}`);
  } catch (error) {
    console.error('❌ Test 1 failed:', error);
  }

  // Test 2: Detailed examples
  console.log('\n\n[TEST 2] Detailed examples\n');
  try {
    const result2 = await adapters.ai.generate(
      'Berikan 5 contoh penggunaan AI dalam bisnis e-commerce dengan penjelasan singkat.',
      { maxTokens: 1000 }
    );

    console.log('✅ Response:');
    console.log(result2.content);
    console.log('\n📊 Stats:');
    console.log(`   Length: ${result2.content.length} chars`);
    console.log(`   Input tokens: ${result2.tokens.input}`);
    console.log(`   Output tokens: ${result2.tokens.output}`);
    console.log(`   Cost: $${result2.cost.toFixed(6)}`);
  } catch (error) {
    console.error('❌ Test 2 failed:', error);
  }

  console.log('\n========================================');
  console.log('   ✅ Tests completed');
  console.log('========================================\n');
}

runTests().catch(console.error);
