import { config } from 'dotenv';
config({ path: '/home/ubuntu/garuda/.env', override: true });
import { configService } from '../src/business/config.service.js';
import { initAdapters } from '../src/adapters/container.js';

async function main() {
  await initAdapters();
  for (const key of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']) {
    const val = await configService.getConfig(key);
    console.log(`${key}: ${val ? val.slice(0, 10) + '...' : 'NULL'} (len=${val?.length})`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
