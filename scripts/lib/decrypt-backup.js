import crypto from 'crypto';
import fs from 'fs';

// Reuse exact decryption logic from apps/api/src/business/backup.service.ts
// (22 Agu verified restore rehearsal).
//
// Format: [16 bytes IV][AES-256-CBC ciphertext]
// Key derivation: scryptSync(password, 'garuda-backup-salt', 32)
//
// Backward-compat: some backups were created with empty encryption key
// (backupConfig.encryptionKey uninitialized). Try configured key first,
// then fallback to empty string if decrypt fails.

const INPUT = process.argv[2];
const OUTPUT = process.argv[3];

if (!INPUT || !OUTPUT) {
  console.error('Usage: node decrypt-backup.js <input.enc> <output.gz>');
  process.exit(1);
}

const ENCRYPTION_KEY = process.env.BACKUP_ENCRYPTION_KEY || '';

function attemptDecrypt(keyPassword) {
  const data = fs.readFileSync(INPUT);
  const key = crypto.scryptSync(keyPassword, 'garuda-backup-salt', 32);
  const iv = data.subarray(0, 16);
  const enc = data.subarray(16);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}

let decrypted;
try {
  decrypted = attemptDecrypt(ENCRYPTION_KEY);
  if (ENCRYPTION_KEY) {
    console.log(`Decrypted with configured key (${ENCRYPTION_KEY.slice(0, 8)}...)`);
  }
} catch (e) {
  if (e.code === 'ERR_OSSL_BAD_DECRYPT' && !ENCRYPTION_KEY) {
    console.error('ERROR: BACKUP_ENCRYPTION_KEY is required for decryption');
    process.exit(1);
  }
  if (e.code === 'ERR_OSSL_BAD_DECRYPT' && ENCRYPTION_KEY) {
    console.warn('⚠️  Decryption with configured key failed, trying empty key fallback...');
    try {
      decrypted = attemptDecrypt('');
      console.log('Decrypted with empty key fallback (backup was created before encryption key was set)');
    } catch (e2) {
      console.error('ERROR: Decryption failed with both configured key and empty fallback.');
      console.error('  Check BACKUP_ENCRYPTION_KEY or restore from a different backup.');
      process.exit(1);
    }
  } else {
    throw e;
  }
}

fs.writeFileSync(OUTPUT, decrypted);
console.log(`Decrypted ${INPUT} -> ${OUTPUT} (${decrypted.length} bytes)`);
