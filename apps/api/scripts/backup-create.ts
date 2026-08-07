import { backupService } from '../src/business/backup.service.js';

async function main() {
  const type = (process.argv[2] as 'daily' | 'weekly' | 'manual') || 'manual';
  const result = await backupService.createDatabaseBackup(type);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error('Backup failed:', e.message);
  process.exit(1);
});
