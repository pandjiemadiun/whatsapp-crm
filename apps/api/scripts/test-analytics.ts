/* Test analytics service against live DB — read-only */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });

import { analyticsService } from '../src/business/analytics.service.js';
import { prisma } from '../src/infrastructure/prisma.js';

async function main() {
  const start = Date.now();
  const result = await analyticsService.getAnalytics('30d', true);
  const duration = Date.now() - start;

  console.log('=== Analytics Result (30d) ===');
  console.log(JSON.stringify(result, null, 2));
  console.log(`\n⚡ Query time: ${duration}ms`);
  console.log('=== End ===');

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('ANALYTICS TEST FAILED:', err);
  process.exit(1);
});
