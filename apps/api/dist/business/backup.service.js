import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { backupConfig } from '../config/backup.config.js';
import { adapters } from '../adapters/container.js';
import { getBackupAdapter } from './backup.adapter.js';
import { ApiError } from '../errors/ApiError.js';
import { ErrorCodes } from '../constants/errorCodes.js';
import fs from 'fs/promises';
import fsSync from 'fs';
import { prisma } from '../infrastructure/prisma.js';
const execAsync = promisify(exec);
const TMP_DIR = path.join(os.tmpdir(), 'garuda-backup-tmp');
function execShell(cmd, timeout) {
    return execAsync(cmd, { timeout, shell: true });
}
export class BackupService {
    constructor() {
        this.adapter = getBackupAdapter();
        fsSync.mkdirSync(TMP_DIR, { recursive: true });
    }
    /**
     * Validate that pg_dump and psql are available before backup/restore operations.
     * Throws ApiError with helpful install instructions on failure.
     */
    async validateDatabaseTools() {
        const platform = process.platform;
        if (platform === 'win32') {
            throw new ApiError(ErrorCodes.ERR_EXTERNAL_UNAVAILABLE, 'Database backup requires pg_dump/psql which are not available on Windows. ' +
                'Use WSL2, Docker, or a remote server for backup operations.');
        }
        try {
            await execShell('pg_dump --version', 2000);
            adapters.logger.info('pg_dump found in PATH');
        }
        catch {
            throw new ApiError(ErrorCodes.ERR_EXTERNAL_UNAVAILABLE, 'pg_dump not found. Install postgresql-client:\n' +
                '  • macOS: brew install postgresql\n' +
                '  • Linux: apt-get install postgresql-client\n' +
                '  • Docker: RUN apk add postgresql-client\n' +
                '  • Or run the app inside the Docker network where postgres is available');
        }
    }
    async createDatabaseBackup(type = 'daily') {
        await this.validateDatabaseTools();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const random = crypto.randomBytes(4).toString('hex');
        const baseName = `backup_${timestamp}_${random}`;
        const filename = `${baseName}.sql.gz.enc`;
        const gzPath = path.join(TMP_DIR, `${baseName}.sql.gz`);
        const encPath = path.join(TMP_DIR, filename);
        adapters.logger.info(`[Backup] Starting ${type} database backup...`);
        try {
            const dbUrl = new URL(process.env.DATABASE_URL || '');
            const dbName = dbUrl.pathname.slice(1);
            const dbHost = dbUrl.hostname;
            const dbPort = dbUrl.port || '5432';
            const dbUser = dbUrl.username;
            const dbPass = dbUrl.password;
            adapters.logger.info(`[Backup] Dumping database ${dbName}...`);
            const dumpCmd = `PGPASSWORD="${dbPass}" pg_dump -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${dbName} --format=custom | gzip -${backupConfig.compressionLevel} > "${gzPath}"`;
            await execShell(dumpCmd, backupConfig.backupTimeout);
            const gzData = await fs.readFile(gzPath);
            const key = crypto.scryptSync(backupConfig.encryptionKey, 'garuda-backup-salt', 32);
            const iv = crypto.randomBytes(16);
            const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
            const encrypted = Buffer.concat([iv, cipher.update(gzData), cipher.final()]);
            // Upload via adapter
            await this.adapter.upload(filename, encrypted);
            // Clean temp
            await fs.unlink(gzPath);
            const checksum = crypto.createHash('sha256').update(encrypted).digest('hex');
            await prisma.backupManifest.create({
                data: {
                    filename,
                    type,
                    size: encrypted.length,
                    checksum,
                    algorithm: 'sha256',
                    encrypted: true,
                    status: 'completed',
                },
            });
            adapters.logger.info(`[Backup] Completed: ${filename} (${(encrypted.length / 1024 / 1024).toFixed(2)} MB)`);
            return { filename, size: encrypted.length, timestamp: new Date(), checksum };
        }
        catch (error) {
            for (const p of [gzPath, encPath]) {
                try {
                    await fs.unlink(p);
                }
                catch { }
            }
            await prisma.backupManifest.create({
                data: {
                    filename,
                    type,
                    size: 0,
                    checksum: '',
                    algorithm: 'sha256',
                    encrypted: true,
                    status: 'failed',
                    errorMessage: error.message,
                },
            }).catch(() => { });
            adapters.logger.error(`[Backup FAILED] ${type} backup`, error);
            throw error;
        }
    }
    async getBackupsList() {
        const backups = await prisma.backupManifest.findMany({
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' },
        });
        const serialized = backups.map(b => ({
            ...b,
            size: Number(b.size),
        }));
        const stats = {
            total: backups.length,
            totalSize: backups.reduce((sum, b) => sum + Number(b.size), 0),
            oldest: backups[backups.length - 1]?.createdAt || null,
            newest: backups[0]?.createdAt || null,
        };
        return { backups: serialized, stats };
    }
    async getBackupDetail(filename) {
        const backup = await prisma.backupManifest.findUnique({ where: { filename } });
        if (!backup || backup.deletedAt)
            throw new Error('Backup not found');
        return { ...backup, size: Number(backup.size) };
    }
    async verifyBackupIntegrity(filename) {
        try {
            const data = await this.adapter.download(filename);
            const checksum = crypto.createHash('sha256').update(data).digest('hex');
            // Test decrypt
            const key = crypto.scryptSync(backupConfig.encryptionKey, 'garuda-backup-salt', 32);
            const iv = data.subarray(0, 16);
            const enc = data.subarray(16);
            const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
            decipher.update(enc);
            decipher.final();
            await prisma.backupManifest.update({
                where: { filename },
                data: { verifiedAt: new Date() },
            });
            return { valid: true, checksum, size: data.length, lastVerified: new Date().toISOString() };
        }
        catch (error) {
            return { valid: false, checksum: '', size: 0, error: error.message };
        }
    }
    async restoreDatabase(filename) {
        await this.validateDatabaseTools();
        adapters.logger.warn(`[RESTORE] Starting database restore from ${filename}...`);
        try {
            const data = await this.adapter.download(filename);
            const key = crypto.scryptSync(backupConfig.encryptionKey, 'garuda-backup-salt', 32);
            const iv = data.subarray(0, 16);
            const enc = data.subarray(16);
            const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
            const decrypted = Buffer.concat([decipher.update(enc), decipher.final()]);
            const gzPath = path.join(TMP_DIR, `${filename}.restore`);
            await fs.writeFile(gzPath, decrypted);
            const dbUrl = new URL(process.env.DATABASE_URL || '');
            const dbName = dbUrl.pathname.slice(1);
            const dbHost = dbUrl.hostname;
            const dbPort = dbUrl.port || '5432';
            const dbUser = dbUrl.username;
            const dbPass = dbUrl.password;
            const killCmd = `PGPASSWORD="${dbPass}" psql -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${dbName} -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${dbName}' AND pid <> pg_backend_pid();" 2>/dev/null || true`;
            await execShell(killCmd, 30000);
            const restoreCmd = `gunzip -c "${gzPath}" | PGPASSWORD="${dbPass}" psql -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${dbName} 2>&1`;
            await execShell(restoreCmd, backupConfig.backupTimeout);
            await fs.unlink(gzPath);
            await prisma.backupManifest.update({
                where: { filename },
                data: { restoredAt: new Date(), restoredBy: 'system' },
            });
            adapters.logger.info(`[RESTORE] Database restored successfully from ${filename}`);
        }
        catch (error) {
            adapters.logger.error(`[RESTORE FAILED]`, error);
            throw error;
        }
    }
    async deleteBackup(filename) {
        try {
            await this.adapter.delete(filename);
        }
        catch { }
        await prisma.backupManifest.update({
            where: { filename },
            data: { deletedAt: new Date() },
        });
        adapters.logger.info(`[Backup] Deleted: ${filename}`);
    }
    async deleteOldBackups() {
        const cutoff = new Date(Date.now() - backupConfig.retentionDays * 24 * 60 * 60 * 1000);
        const old = await prisma.backupManifest.findMany({
            where: { createdAt: { lt: cutoff }, deletedAt: null },
        });
        let freedSize = 0;
        for (const backup of old) {
            try {
                await this.adapter.delete(backup.filename);
            }
            catch { }
            freedSize += Number(backup.size);
        }
        await prisma.backupManifest.updateMany({
            where: { id: { in: old.map((b) => b.id) } },
            data: { deletedAt: new Date() },
        });
        adapters.logger.info(`[Backup Cleanup] Deleted ${old.length} backups, freed ${(freedSize / 1024 / 1024).toFixed(2)} MB`);
        return { deleted: old.length, freedSize };
    }
    async getLatestBackup() {
        return prisma.backupManifest.findFirst({
            where: { status: 'completed', deletedAt: null },
            orderBy: { createdAt: 'desc' },
        });
    }
}
export const backupService = new BackupService();
//# sourceMappingURL=backup.service.js.map