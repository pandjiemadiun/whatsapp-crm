import 'dotenv/config';
import { adapters, initAdapters } from './apps/api/src/adapters/container.js';

async function main() {
  await initAdapters();
  
  const response = await adapters.ai.generate(
    'Jelaskan singkat dalam 50 kata: apa itu Artificial Intelligence?',
    { maxTokens: 200 }
  );

  console.log('\n=== FULL RESPONSE DEBUG ===');
  console.log('Content length:', response.content.length);
  console.log('Full content:\n', response.content);
  console.log('\nTokens:', response.tokens);
  console.log('Cost:', response.cost);
}

main().catch(console.error);
