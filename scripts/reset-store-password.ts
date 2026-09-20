#!/usr/bin/env node
/**
 * CLI script to reset a Store's password.
 *
 * Pola sama seperti scripts/reset-admin-password.ts, tapi untuk tabel Store
 * (via store_settings.key = 'auth_password').
 *
 * USAGE:
 *   npx tsx scripts/reset-store-password.ts <store-id> <new-password> [--yes]
 *
 * REQUIREMENTS:
 * - DATABASE_URL environment variable set
 *
 * Password di-hash dengan bcrypt (10 rounds), sama seperti API.
 * Semua auth token existing untuk toko ini akan di-invalidasi setelah reset.
 */

import { prisma } from '../apps/api/src/infrastructure/prisma.js';
import { hashPassword } from '../apps/api/src/utils/password.util.js';

const [, , storeId, newPassword, confirm] = process.argv;

if (!storeId || !newPassword) {
  console.error('Usage: npx tsx scripts/reset-store-password.ts <store-id> <new-password> [--yes]');
  console.error('\nExample:');
  console.error('  npx tsx scripts/reset-store-password.ts store-a3cd7205 "newsecurepass123" --yes');
  process.exit(1);
}

// Validate storeId format (UUID-ish or store-* prefix)
if (!storeId.includes('-') || storeId.length < 10) {
  console.error('Error: Invalid store-id format');
  process.exit(1);
}

// Validate password length
if (newPassword.length < 6 || newPassword.length > 128) {
  console.error('Error: Password must be between 6 and 128 characters');
  process.exit(1);
}

// Confirmation prompt (skip if --yes is passed)
const rl = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function main() {
  // Check if store exists
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true, name: true, email: true, isActive: true, deletedAt: true },
  });

  if (!store || store.deletedAt) {
    console.error('Error: Store not found or deleted');
    await prisma.$disconnect();
    process.exit(1);
  }

  if (!store.isActive) {
    console.error('Error: Store account is inactive');
    await prisma.$disconnect();
    process.exit(1);
  }

  // Confirmation prompt
  if (confirm !== '--yes') {
    console.log(`\n⚠️  WARNING: This will reset the password for store: ${store.name} (${store.email})`);
    console.log(`✍️  New password: ${'*'.repeat(newPassword.length)} (${newPassword.length} chars)`);

    const answer = await new Promise<string>((resolve) => {
      rl.question('\nType "yes" to confirm: ', resolve);
    });
    rl.close();

    if (answer.toLowerCase() !== 'yes') {
      console.log('Password reset cancelled.');
      await prisma.$disconnect();
      process.exit(0);
    }
  }

  // Hash and update password
  const hashedPassword = await hashPassword(newPassword);

  await prisma.storeSetting.upsert({
    where: { storeId_key: { storeId: store.id, key: 'auth_password' } },
    update: { value: hashedPassword },
    create: { storeId: store.id, key: 'auth_password', value: hashedPassword },
  });

  // Invalidate all existing tokens
  await prisma.storeSetting.updateMany({
    where: { storeId: store.id, key: 'auth_token' },
    data: { value: '' },
  });
  await prisma.storeSetting.updateMany({
    where: { storeId: store.id, key: 'auth_token_expires_at' },
    data: { value: '' },
  });

  console.log(`\n✅ Success! Password reset for ${store.name} (${store.email})`);
  console.log(`   All existing sessions have been revoked.`);
  console.log(`\n🔑 New login credentials:`);
  console.log(`   Store ID: ${store.id}`);
  console.log(`   Email:    ${store.email}`);
  console.log(`   Password: [new password provided]`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('Error:', e.message);
  prisma.$disconnect().then(() => process.exit(1));
});
