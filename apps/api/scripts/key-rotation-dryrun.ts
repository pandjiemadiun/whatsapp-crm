/* Dry-run test for key-rotation.service.ts — NO WRITES */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
const __dirname2 = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname2, '../../.env'), override: true });

import { prisma } from '../src/infrastructure/prisma.js';
import { configService } from '../src/business/config.service.js';
import { keyRotationService } from '../src/business/key-rotation.service.js';

async function main() {
  console.log('=== Key Rotation Dry-Run ===\n');

  // Show current key source
  const dbKey = await configService.getConfig('FIELD_ENCRYPTION_KEY');
  console.log('Platform Config DB key:', dbKey ? `[present, ${dbKey.length} chars]` : '[NOT SET]');
  console.log('Env FIELD_ENCRYPTION_KEY:', process.env.FIELD_ENCRYPTION_KEY ? `[present, ${process.env.FIELD_ENCRYPTION_KEY.length} chars]` : '[NOT SET]');
  console.log('Worker URL:', process.env.CLOUDFLARE_WORKER_URL || '[NOT SET]');

  console.log('\n=== dryRun() result ===');
  const result = await keyRotationService.dryRun();
  console.log(JSON.stringify(result, null, 2));

  console.log('\n=== Manual verify: per-field encrypted counts ===');
  const models: Record<string, string[]> = {
    Store: ['phoneNumber', 'address', 'fonnteToken', 'fonnteNumber'],
    Conversation: ['customerPhone', 'customerName', 'notes'],
    Order: ['shippingAddress', 'notes'],
    BankAccount: ['accountNumber', 'accountName'],
  };

  for (const [model, fields] of Object.entries(models)) {
    for (const field of fields) {
      const hasDeletedAt = model === 'Store' || model === 'Conversation' || model === 'Order';
      const count = await prisma.$queryRaw<Array<{ c: number }>>`
        SELECT COUNT(*)::int AS c FROM "${model}"
        WHERE "${field}" IS NOT NULL
          AND "${field}" LIKE '%:%'
          AND ${hasDeletedAt ? '"deletedAt" IS NULL' : 'TRUE'}
      `;
      console.log(`  ${model}.${field}: ${count[0]?.c || 0} encrypted values`);
    }
  }

  await prisma.$disconnect();
  console.log('\n=== Dry-run complete (NO WRITES made) ===');
}

main().catch((err) => {
  console.error('DRY-RUN FAILED:', err);
  process.exit(1);
});
