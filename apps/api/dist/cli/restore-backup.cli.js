import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
async function main() {
    const args = process.argv.slice(2);
    const backupArg = args.find((a) => a.startsWith('--backup='));
    const dryRun = args.includes('--dry-run');
    const verifyOnly = args.includes('--verify-only');
    if (!backupArg) {
        console.error('Usage: node restore-backup.cli.js --backup=<filename> [--dry-run] [--verify-only]');
        process.exit(1);
    }
    const filename = backupArg.split('=')[1];
    // Dynamic import karena ESM
    const { backupService } = await import('../business/backup.service.js');
    if (verifyOnly) {
        console.log(`[Restore CLI] Verifying backup: ${filename}`);
        const result = await backupService.verifyBackupIntegrity(filename);
        console.log(`  Valid: ${result.valid}`);
        console.log(`  Size: ${result.size} bytes`);
        if (result.error)
            console.error(`  Error: ${result.error}`);
        process.exit(result.valid ? 0 : 1);
    }
    if (dryRun) {
        console.log(`[Restore CLI] DRY RUN — would restore: ${filename}`);
        console.log(`[Restore CLI] Backup exists in local storage, proceeding...`);
        const detail = await backupService.getBackupDetail(filename);
        console.log(`  Filename: ${detail.filename}`);
        console.log(`  Created: ${detail.createdAt}`);
        console.log(`  Size: ${detail.size} bytes`);
        console.log(`  Checksum: ${detail.checksum}`);
        console.log(`[Restore CLI] Dry run complete — no changes made.`);
        process.exit(0);
    }
    // Full restore
    console.log(`[Restore CLI] WARNING: This will overwrite the current database!`);
    console.log(`[Restore CLI] Restoring: ${filename}`);
    console.log(`[Restore CLI] Press Ctrl+C within 5 seconds to cancel...`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
    try {
        await backupService.restoreDatabase(filename);
        console.log(`[Restore CLI] Restore completed successfully.`);
        process.exit(0);
    }
    catch (error) {
        console.error(`[Restore CLI] Restore failed:`, error.message);
        process.exit(1);
    }
}
main();
//# sourceMappingURL=restore-backup.cli.js.map