import cron from 'node-cron';
import { backupService } from '../business/backup.service.js';
import { backupConfig } from '../config/backup.config.js';
import { adapters } from '../adapters/container.js';

export function scheduleBackups(): void {
  if (!backupConfig.enabled) {
    adapters.logger.info('[Backup Scheduler] Disabled by config');
    return;
  }

  // Daily backup at 2 AM
  cron.schedule(backupConfig.scheduleDaily, async () => {
    adapters.logger.info('[Backup Scheduler] Starting daily backup...');
    try {
      await backupService.createDatabaseBackup('daily');
    } catch (error) {
      adapters.logger.error('[Backup Scheduler] Daily backup failed', error as Error);
    }
  });

  // Weekly backup at 3 AM Sunday
  cron.schedule(backupConfig.scheduleWeekly, async () => {
    adapters.logger.info('[Backup Scheduler] Starting weekly backup...');
    try {
      await backupService.createDatabaseBackup('weekly');
    } catch (error) {
      adapters.logger.error('[Backup Scheduler] Weekly backup failed', error as Error);
    }
  });

  // Cleanup old backups at 4 AM daily
  cron.schedule('0 4 * * *', async () => {
    adapters.logger.info('[Backup Scheduler] Running cleanup...');
    try {
      await backupService.deleteOldBackups();
    } catch (error) {
      adapters.logger.error('[Backup Scheduler] Cleanup failed', error as Error);
    }
  });

  adapters.logger.info('[Backup Scheduler] Started — daily 2AM, weekly Sun 3AM, cleanup 4AM');
}
