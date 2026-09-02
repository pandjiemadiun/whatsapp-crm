import { backupService } from '../src/business/backup.service.js';
(async () => {
  try {
    await backupService.restoreDatabase('backup_2026-08-31T11-05-02-463Z_0e690d63.sql.gz.enc');
    console.log('RESTORE SUCCESS');
  } catch (e: any) {
    console.error('RESTORE FAILED:', e.message);
    process.exit(1);
  }
})();
