import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load .env but do NOT override existing env vars (e.g. DATABASE_URL passed via CLI).
dotenv.config({ path: path.resolve(__dirname, '../../../.env'), override: false });

import { backupService } from '../src/business/backup.service.js';
import { prisma } from '../src/infrastructure/prisma.js';
import { reconfigureBackupConfig } from '../src/config/backup.config.js';

async function main() {
  const type = (process.argv[2] as 'daily' | 'weekly' | 'manual') || 'manual';

  // Ensure backupConfig is populated from DB/env before any backup operation.
  // This mirrors what initAdapters() does at server startup.
  await reconfigureBackupConfig();

  const result = await backupService.createDatabaseBackup(type);
  console.log(JSON.stringify(result, null, 2));
  await prisma.$disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error('Backup failed:', e.message);
  process.exit(1);
});
