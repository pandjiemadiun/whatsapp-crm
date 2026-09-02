#!/usr/bin/env node
/**
 * CLI script to reset an admin user's password.
 * 
 * USAGE:
 *   npx tsx scripts/reset-admin-password.ts <admin-email> <new-password>
 * 
 * This script is intended for:
 * - Owner/Kilo to reset blocked-out admin passwords
 * - Emergency access when no valid session exists
 * 
 * REQUIREMENTS:
 * - DATABASE_URL environment variable set
 * - FIELD_ENCRYPTION_KEY (if any encrypted fields are involved)
 * 
 * The password is hashed with bcrypt (10 rounds), same as the API.
 * All existing auth tokens for this admin are revoked after reset.
 */

import { prisma } from '../apps/api/src/infrastructure/prisma.js';
import { hashPassword } from '../apps/api/src/utils/password.util.js';

const [, , email, newPassword, confirm] = process.argv;

if (!email || !newPassword) {
  console.error('Usage: npx tsx scripts/reset-admin-password.ts <admin-email> <new-password> [--yes]');
  console.error('\nExample:');
  console.error('  npx tsx scripts/reset-admin-password.ts admin@qlobot.web.id "newsecurepass123" --yes');
  process.exit(1);
}

// Validate email format (basic)
if (!email.includes('@') || !email.includes('.')) {
  console.error('Error: Invalid email format');
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
  // Check if admin exists
  const admin = await prisma.adminUser.findUnique({
    where: { email },
    select: { id: true, email: true, isActive: true, deletedAt: true },
  });

  if (!admin || admin.deletedAt) {
    console.error('Error: Admin user not found or deleted');
    await prisma.$disconnect();
    process.exit(1);
  }

  if (!admin.isActive) {
    console.error('Error: Admin account is inactive');
    await prisma.$disconnect();
    process.exit(1);
  }

  // Confirmation prompt
  if (confirm !== '--yes') {
    console.log(`\n⚠️  WARNING: This will reset the password for: ${email}`);
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

  await prisma.adminUser.update({
    where: { id: admin.id },
    data: { passwordHash: hashedPassword },
  });

  // Invalidate all existing tokens
  await prisma.adminAuthToken.updateMany({
    where: { adminUserId: admin.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  console.log(`\n✅ Success! Password reset for ${admin.email}`);
  console.log(`   All existing sessions have been revoked.`);
  console.log(`\n🔑 New login credentials:`);
  console.log(`   Email: ${admin.email}`);
  console.log(`   Password: [new password provided]`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('Error:', e.message);
  prisma.$disconnect().then(() => process.exit(1));
});