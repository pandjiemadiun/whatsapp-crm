import crypto from 'crypto';
import { prisma } from '../infrastructure/prisma.js';
import { configService } from '../business/config.service.js';
import { getEncryptionKey, refreshEncryptionKey, encryptField, decryptField, parseKey } from '../utils/encryption.js';
import { backupService } from '../business/backup.service.js';
import logger from '../utils/logger.js';
/**
 * Models with encrypted fields — maps Prisma model name → SQL table name + encrypted columns.
 * Sources: prisma.ts SENSITIVE_FIELDS (create) + schema.prisma @@map table names.
 */
const ENCRYPTED_MODELS = [
    { model: 'Store', table: 'stores', fields: ['phoneNumber', 'address', 'fonnteToken', 'fonnteNumber'], hasSoftDelete: true },
    { model: 'Conversation', table: 'conversations', fields: ['customerPhone', 'customerName', 'notes'], hasSoftDelete: true },
    { model: 'Order', table: 'orders', fields: ['shippingAddress', 'notes'], hasSoftDelete: true },
    { model: 'BankAccount', table: 'bank_accounts', fields: ['accountNumber', 'accountName'], hasSoftDelete: true },
];
/** Exact phrase admin must type to confirm rotation. */
export const ROTATION_CONFIRM_PHRASE = 'ROTATE ENCRYPTION KEY';
export class KeyRotationService {
    /**
     * Count rows and encrypted fields per model. No writes.
     */
    async dryRun() {
        const result = {
            models: {},
            totalRows: 0,
            totalEncryptedFields: 0,
            currentSource: await this.getCurrentKeySource(),
        };
        for (const { model, table, fields, hasSoftDelete } of ENCRYPTED_MODELS) {
            const modelDry = { rowCount: 0, encryptedFieldCount: 0, fields: {} };
            // Build WHERE clause: at least one non-null field, not soft-deleted
            const nullCondition = fields.map((f) => `"${f}" IS NOT NULL`).join(' OR ');
            const deletedClause = hasSoftDelete ? ' AND "deletedAt" IS NULL' : '';
            // Count rows that have at least one non-null encrypted field
            const sql = `
        SELECT COUNT(*)::int AS count FROM "${table}"
        WHERE (${nullCondition})${deletedClause}
      `;
            const countRes = await prisma.$queryRawUnsafe(sql);
            modelDry.rowCount = Number(countRes[0]?.count || 0);
            // Count encrypted fields per column (values containing ":" — encrypted format)
            for (const field of fields) {
                const encSql = `
          SELECT COUNT(*)::int AS count FROM "${table}"
          WHERE "${field}" IS NOT NULL
            AND "${field}" LIKE '%:%'${hasSoftDelete ? ' AND "deletedAt" IS NULL' : ''}
        `;
                const encRes = await prisma.$queryRawUnsafe(encSql);
                const c = Number(encRes[0]?.count || 0);
                modelDry.fields[field] = c;
                modelDry.encryptedFieldCount += c;
            }
            result.models[model] = modelDry;
            result.totalRows += modelDry.rowCount;
            result.totalEncryptedFields += modelDry.encryptedFieldCount;
        }
        return result;
    }
    async getCurrentKeySource() {
        try {
            const dbVal = await configService.getConfig('FIELD_ENCRYPTION_KEY');
            if (dbVal && dbVal.length > 0)
                return 'database';
        }
        catch { }
        if (process.env.CLOUDFLARE_WORKER_URL && process.env.CLOUDFLARE_WORKER_TOKEN) {
            return 'cloudflare_worker';
        }
        if (process.env.FIELD_ENCRYPTION_KEY)
            return 'env';
        return 'none';
    }
    /**
     * Execute key rotation: re-encrypt all data with the new key.
     * - Requires a fresh backup (< 1 hour old) or auto-triggers one.
     * - All re-encryption happens in a single Prisma transaction.
     * - Any decryption/re-encryption failure rolls back the entire transaction.
     * - On success: writes new key to Platform Config, invalidates cache.
     */
    async rotate(newKeyRaw) {
        // ── Step 1: Validate new key ──
        const newKeyBuffer = parseKey(newKeyRaw);
        if (newKeyBuffer.length !== 32) {
            throw new Error(`New encryption key must produce a 32-byte Buffer (got ${newKeyBuffer.length} bytes)`);
        }
        // ── Step 2: Get current key ──
        const currentKey = await getEncryptionKey();
        if (!currentKey) {
            throw new Error('No current encryption key available — cannot decrypt existing data');
        }
        // Get raw current key string for comparison and old-key decryption
        let currentKeyRaw = null;
        try {
            currentKeyRaw = await configService.getConfig('FIELD_ENCRYPTION_KEY');
        }
        catch { }
        if (!currentKeyRaw)
            currentKeyRaw = process.env.FIELD_ENCRYPTION_KEY || null;
        if (!currentKeyRaw) {
            throw new Error('Cannot determine current key source — aborting rotation');
        }
        const oldKeyBuffer = parseKey(currentKeyRaw);
        // ── Step 3: Reject identical keys ──
        if (crypto.timingSafeEqual(oldKeyBuffer, newKeyBuffer)) {
            throw new Error('New key is identical to current key — no rotation needed');
        }
        // ── Step 4: Validate roundtrip with new key ──
        const testPlain = 'key-rotation-roundtrip-test-' + crypto.randomUUID();
        const testEnc = encryptField(testPlain, newKeyBuffer);
        const testDec = decryptField(testEnc, newKeyBuffer);
        if (testDec !== testPlain) {
            throw new Error('New key validation failed — encrypt/decrypt roundtrip mismatch');
        }
        // ── Step 5: Enforce backup ──
        let backupVerified = false;
        const latest = await backupService.getLatestBackup();
        if (latest) {
            const hoursSince = (Date.now() - new Date(latest.createdAt).getTime()) / (1000 * 60 * 60);
            if (hoursSince < 1) {
                backupVerified = true;
                logger.info('[KeyRotation] Recent backup confirmed', { filename: latest.filename, hoursSinceBackup: Math.round(hoursSince) });
            }
        }
        if (!backupVerified) {
            logger.info('[KeyRotation] No recent backup (<1hr) — triggering manual backup');
            await backupService.createDatabaseBackup('manual');
            backupVerified = true;
            logger.info('[KeyRotation] Backup completed before rotation');
        }
        // ── Step 6: Re-encrypt all data in a single transaction ──
        let totalReEncrypted = 0;
        const modelsAffected = [];
        await prisma.$transaction(async (tx) => {
            for (const { model, table, fields, hasSoftDelete } of ENCRYPTED_MODELS) {
                const columnList = fields.map((f) => `"${f}"`).join(', ');
                const nullCondition = fields.map((f) => `"${f}" IS NOT NULL`).join(' OR ');
                const deletedClause = hasSoftDelete ? ' AND "deletedAt" IS NULL' : '';
                // Read raw encrypted values (bypasses Prisma encryption middleware)
                const selectSql = `
          SELECT id, ${columnList} FROM "${table}"
          WHERE (${nullCondition})${deletedClause}
        `;
                const rows = await tx.$queryRawUnsafe(selectSql);
                if (rows.length === 0)
                    continue;
                let modelCount = 0;
                for (const row of rows) {
                    const updates = {};
                    for (const field of fields) {
                        const encrypted = row[field];
                        if (!encrypted)
                            continue;
                        // Decrypt with OLD key — throws FieldDecryptionError on failure
                        // (wrong key or corrupt data), aborting the entire rotation.
                        const decrypted = decryptField(encrypted, oldKeyBuffer, { model, field, recordId: row.id });
                        // If value was plaintext (not encrypted), re-encrypt with new key too
                        const reencrypted = encryptField(decrypted, newKeyBuffer);
                        if (reencrypted !== null) {
                            updates[field] = reencrypted;
                        }
                    }
                    if (Object.keys(updates).length === 0)
                        continue;
                    // Build parameterized UPDATE — bypasses Prisma middleware via $executeRawUnsafe
                    // PostgreSQL uses $1, $2, ... positional placeholders
                    const fieldNames = Object.keys(updates);
                    const paramPlaceholders = fieldNames.map((f, i) => `"${f}" = $${i + 1}`).join(', ');
                    const paramValues = fieldNames.map((f) => updates[f]);
                    const idParam = `$${fieldNames.length + 1}`;
                    await tx.$executeRawUnsafe(`UPDATE "${table}" SET ${paramPlaceholders} WHERE "id"::text = ${idParam}`, ...paramValues, row.id);
                    modelCount++;
                    totalReEncrypted++;
                }
                if (modelCount > 0) {
                    modelsAffected.push(model);
                }
            }
        });
        // ── Step 7: Install new key in Platform Config ──
        await configService.setConfig('FIELD_ENCRYPTION_KEY', newKeyRaw, {
            category: 'encryption',
            isSecret: true,
            description: 'AES-256-GCM field encryption key (32 bytes hex). Primary: DB. Fallback: Cloudflare Worker / env.',
        });
        // ── Step 8: Invalidate 10-min cache ──
        await refreshEncryptionKey();
        logger.info('[KeyRotation] Complete', { rowsReEncrypted: totalReEncrypted, modelsAffected, newKeyInstalled: true });
        return {
            success: true,
            rowsReEncrypted: totalReEncrypted,
            modelsAffected,
            newKeyInstalled: true,
        };
    }
}
export const keyRotationService = new KeyRotationService();
//# sourceMappingURL=key-rotation.service.js.map