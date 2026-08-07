import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger.js';
import { backupConfig } from '../config/backup.config.js';

export interface BackupAdapter {
  upload(filename: string, buffer: Buffer): Promise<void>;
  download(filename: string): Promise<Buffer>;
  list(): Promise<string[]>;
  delete(filename: string): Promise<void>;
}

export class LocalBackupAdapter implements BackupAdapter {
  private readonly basePath: string;

  constructor(basePath?: string) {
    this.basePath = basePath || process.env.BACKUP_PATH || '/tmp/garuda-backups';
  }

  private async ensureDir() {
    await fs.mkdir(this.basePath, { recursive: true });
  }

  async upload(filename: string, buffer: Buffer): Promise<void> {
    await this.ensureDir();
    const filepath = path.join(this.basePath, filename);
    await fs.writeFile(filepath, buffer);
    logger.info('Backup saved', { filename, size: buffer.length, path: this.basePath });
  }

  async download(filename: string): Promise<Buffer> {
    const filepath = path.join(this.basePath, filename);
    const buffer = await fs.readFile(filepath);
    logger.info('Backup loaded', { filename, size: buffer.length });
    return buffer;
  }

  async list(): Promise<string[]> {
    await this.ensureDir();
    const files = await fs.readdir(this.basePath);
    return files.filter((f) => f.endsWith('.sql.gz.enc'));
  }

  async delete(filename: string): Promise<void> {
    const filepath = path.join(this.basePath, filename);
    await fs.rm(filepath);
    logger.info('Backup deleted', { filename });
  }

  getBasePath(): string {
    return this.basePath;
  }
}

export function getBackupAdapter(): BackupAdapter {
  const provider = backupConfig.provider;
  logger.info('Initializing backup adapter', { provider });

  switch (provider) {
    case 's3':
    case 'gcs':
    case 'minio':
      logger.warn(`${provider} adapter not yet implemented, falling back to local`);
      return new LocalBackupAdapter();
    default:
      return new LocalBackupAdapter();
  }
}
