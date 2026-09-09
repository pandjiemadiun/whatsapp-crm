import { config } from 'dotenv';
config({ path: '../../.env' });

import { runV2MapperWirePath } from '../src/services/chat/v2-engine/v2-mapper-wire.js';
import { executeWaCartMutation } from '../src/business/action-registry.js';

async function main() {
  const raw = process.argv.find((a) => a.startsWith('{'));
  if (!raw) {
    console.error('usage: run-smoke.ts \'<V2MapperWireInput JSON>\'');
    process.exit(2);
  }
  const input = JSON.parse(raw);
  const out = await runV2MapperWirePath(input, executeWaCartMutation);
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
