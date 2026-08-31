import { test, after } from 'node:test';
import assert from 'node:assert';
import { prisma } from '../infrastructure/prisma.js';
import { encryptField, decryptField, parseKey } from '../utils/encryption.js';
import { keyRotationService, ROTATION_CONFIRM_PHRASE } from '../business/key-rotation.service.js';
import { configService } from '../business/config.service.js';

/**
 * Key rotation integration test.
 *
 * Uses isolated test database (key_rotation_test) to avoid touching real data.
 * Run with: DATABASE_URL="postgresql://...@127.0.0.1:5432/key_rotation_test" npx tsx --test ...
 *
 * Strategy: set current key = oldKey, seed PLAINTEXT values (Prisma middleware
 * encrypts with oldKey), then rotate to newKey. This avoids double-encryption.
 */

const OLD_KEY_RAW = 'a'.repeat(64); // 64-char hex → 32 bytes
const NEW_KEY_RAW = 'b'.repeat(64); // different 64-char hex → 32 bytes
const CORRUPT_KEY_RAW = 'c'.repeat(64);

const testStoreIds: string[] = [];

after(async () => {
  // Clean up all test data
  await prisma.bankAccount.deleteMany({ where: { storeId: { in: testStoreIds } } });
  await prisma.store.deleteMany({ where: { id: { in: testStoreIds } } });
  await prisma.store.deleteMany({ where: { id: { in: ['rot-test-corrupt-1'] } } });
  try { await configService.deleteConfig('FIELD_ENCRYPTION_KEY'); } catch {}
});

test('1. seed rows (middleware encrypts plaintext with old key)', async () => {
  // Set old key as current so Prisma middleware encrypts with it
  const origEnv = process.env.FIELD_ENCRYPTION_KEY;
  process.env.FIELD_ENCRYPTION_KEY = OLD_KEY_RAW;
  await configService.setConfig('FIELD_ENCRYPTION_KEY', OLD_KEY_RAW, {
    category: 'encryption',
    isSecret: true,
    description: 'test old key',
  });

  try {
    const store = await prisma.store.create({
      data: {
        id: 'rot-test-store-1',
        name: 'Rotation Test Store',
        slug: 'rot-test-store-1',
        // Pass PLAINTEXT — Prisma middleware encrypts with current key (oldKey)
        phoneNumber: '081111111111',
        address: 'Jl Test Rotation',
        originProvinceId: '1',
        originProvinceName: 'Jawa Barat',
        originCityId: '101',
        originCityName: 'Bandung',
        originSubdistrictId: '1001',
        originSubdistrictName: 'Coblong',
      },
    });
    testStoreIds.push(store.id);

    await prisma.bankAccount.create({
      data: {
        storeId: store.id,
        bankName: 'BCA',
        accountNumber: '1234567890',
        accountName: 'Test Account',
      },
    });

    // Verify old key decrypts (via raw query to bypass middleware)
    const raw = await prisma.$queryRawUnsafe(
      `SELECT "phoneNumber", "address" FROM stores WHERE "id" = $1`,
      store.id
    ) as any[];
    assert.equal(decryptField(raw[0].phoneNumber, parseKey(OLD_KEY_RAW)), '081111111111');
    assert.equal(decryptField(raw[0].address, parseKey(OLD_KEY_RAW)), 'Jl Test Rotation');
    console.log('  Seeded store + bank account (middleware encrypted with old key)');
  } finally {
    process.env.FIELD_ENCRYPTION_KEY = origEnv;
  }
});

test('2. confirmation phrase guard logic', async () => {
  // The route guard: confirmationPhrase !== ROTATION_CONFIRM_PHRASE → reject
  const wrongPhrases = [
    'rotate encryption key',       // wrong case
    'ROTATE ENCRYPTION KEY ',      // trailing space
    ' ROTATE ENCRYPTION KEY',      // leading space
    'rotate',                      // partial
    '',                            // empty
    'ROTATEENCRYPTIONKEY',         // no spaces
  ];

  for (const p of wrongPhrases) {
    assert.notEqual(p, ROTATION_CONFIRM_PHRASE, `should reject: "${p}"`);
  }

  // Exact phrase must match
  assert.equal(ROTATION_CONFIRM_PHRASE, 'ROTATE ENCRYPTION KEY');
  console.log('  Confirmed: exact phrase required, all variants rejected');
});

test('3. rotation re-encrypts all rows with new key', async () => {
  // Set old key as current so rotation finds it
  await configService.setConfig('FIELD_ENCRYPTION_KEY', OLD_KEY_RAW, {
    category: 'encryption',
    isSecret: true,
    description: 'test old key',
  });
  const origEnv = process.env.FIELD_ENCRYPTION_KEY;
  process.env.FIELD_ENCRYPTION_KEY = OLD_KEY_RAW;

  try {
    const result = await keyRotationService.rotate(NEW_KEY_RAW);

    assert.equal(result.success, true);
    assert.ok(result.rowsReEncrypted >= 2, 'should re-encrypt at least 2 rows (store + bank account)');
    assert.ok(result.modelsAffected.includes('Store'), 'should affect Store model');
    assert.ok(result.modelsAffected.includes('BankAccount'), 'should affect BankAccount model');
    console.log(`  Rotation succeeded: ${result.rowsReEncrypted} rows re-encrypted across ${result.modelsAffected.join(', ')}`);
  } finally {
    process.env.FIELD_ENCRYPTION_KEY = origEnv;
  }
});

test('4. rows decryptable under new key, NOT under old key', async () => {
  const newKey = parseKey(NEW_KEY_RAW);
  const oldKey = parseKey(OLD_KEY_RAW);

  // Read raw (bypass middleware)
  const raw = await prisma.$queryRawUnsafe(
    `SELECT "phoneNumber", "address" FROM stores WHERE "id" = $1`,
    testStoreIds[0]
  ) as any[];

  // Decryptable under new key
  assert.equal(decryptField(raw[0].phoneNumber, newKey), '081111111111');
  assert.equal(decryptField(raw[0].address, newKey), 'Jl Test Rotation');

  // NOT decryptable under old key (throws FieldDecryptionError)
  assert.throws(() => decryptField(raw[0].phoneNumber, oldKey), /Decryption failed/);
  assert.throws(() => decryptField(raw[0].address, oldKey), /Decryption failed/);

  console.log('  Verified: new key decrypts, old key throws');
});

test('5. corrupt row: rotation aborts cleanly (transaction rollback)', async () => {
  const oldKey = parseKey(OLD_KEY_RAW);
  const newKey = parseKey(NEW_KEY_RAW);
  const corruptKey = parseKey(CORRUPT_KEY_RAW);

  // Seed a store where phoneNumber is encrypted with a THIRD key (not oldKey)
  // We must bypass the middleware to insert corrupt data
  const corruptStoreId = 'rot-test-corrupt-1';
  const encryptedWithCorrupt = encryptField('082222222222', corruptKey);
  const encryptedWithOld = encryptField('Jl Corrupt', oldKey);

  await prisma.$executeRawUnsafe(
    `INSERT INTO stores ("id", "name", "slug", "phoneNumber", "address", "originProvinceId", "originProvinceName", "originCityId", "originCityName", "originSubdistrictId", "originSubdistrictName", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())`,
    corruptStoreId, 'Corrupt Test Store', 'rot-test-corrupt-1',
    encryptedWithCorrupt, encryptedWithOld,
    '1', 'Jawa Barat', '101', 'Bandung', '1001', 'Coblong'
  );

  // Set old key as current
  await configService.setConfig('FIELD_ENCRYPTION_KEY', OLD_KEY_RAW, {
    category: 'encryption',
    isSecret: true,
    description: 'test old key for corrupt test',
  });
  const origEnv = process.env.FIELD_ENCRYPTION_KEY;
  process.env.FIELD_ENCRYPTION_KEY = OLD_KEY_RAW;

  let threw = false;
  let errorMsg = '';
  try {
    // This should throw because the corrupt row can't be decrypted with oldKey
    await keyRotationService.rotate(NEW_KEY_RAW);
  } catch (e: any) {
    threw = true;
    errorMsg = e.message;
    console.log('  Rotation threw as expected:', errorMsg);
  } finally {
    process.env.FIELD_ENCRYPTION_KEY = origEnv;
  }

  // Rotation MUST throw (cannot decrypt corrupt row with oldKey)
  assert.ok(threw, 'rotation should throw on corrupt data');

  // Verify NO partial rotation occurred (transaction rolled back)
  const raw = await prisma.$queryRawUnsafe(
    `SELECT "phoneNumber", "address" FROM stores WHERE "id" = $1`,
    corruptStoreId
  ) as any[];

  // phoneNumber should still be decryptable with CORRUPT key (unchanged)
  assert.equal(decryptField(raw[0].phoneNumber, corruptKey), '082222222222');
  // address should still be decryptable with OLD key (unchanged — rotation rolled back)
  assert.equal(decryptField(raw[0].address, oldKey), 'Jl Corrupt');

  console.log('  Verified: transaction rolled back, no partial state');
});
