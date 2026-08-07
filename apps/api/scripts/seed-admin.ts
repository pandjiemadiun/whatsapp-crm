import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { hashPassword } from '../src/utils/password.util.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.resolve(__dirname, '../../.env');
console.log(`[Seed] Loading .env from: ${envPath}`);
dotenv.config({ path: envPath });

const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2] || 'admin@garuda.io';
  const password = process.argv[3] || 'admin123';

  const existing = await prisma.adminUser.findFirst({ where: { email } });
  if (existing) {
    console.log(`[Seed] Admin ${email} already exists, skipping.`);
    return;
  }

  const passwordHash = await hashPassword(password);

  const admin = await prisma.adminUser.create({
    data: {
      email,
      passwordHash,
      role: 'super_admin',
      isActive: true,
    },
  });

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await prisma.adminAuthToken.create({
    data: {
      adminUserId: admin.id,
      token,
      expiresAt,
    },
  });

  console.log(`[Seed] Super admin created:`);
  console.log(`  Email:   ${email}`);
  console.log(`  Role:    super_admin`);
  console.log(`  Token:   ${token}`);
  console.log(`  Expires: ${expiresAt.toISOString()}`);
  console.log('');
  console.log(`[Seed] Test with:`);
  console.log(`  curl -H "Authorization: Bearer ${token}" http://localhost:3000/api/admin/auth/me`);
}

main()
  .catch((err) => {
    console.error('[Seed] Failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
