import { test as setup } from '@playwright/test';
import pg from 'pg';
import crypto from 'crypto';
import { E2E_STORE_ID, E2E_STORE_NAME } from './fixtures/constants';

/**
 * Setup global:
 * 1. Buat store test dengan UUID valid + kategori (backend zod mensyaratkan UUID,
 *    tapi store seed project memakai id non-UUID seperti "store-1").
 * 2. Buat token admin langsung di DB + inject ke localStorage
 *    (TIDAK lewat endpoint login → tidak kena rate limit 5x/15 menit).
 */
const { Pool } = pg;
const pool = new Pool({
  host: process.env.DATABASE_HOST || 'localhost',
  port: Number(process.env.DATABASE_PORT || 5432),
  database: process.env.DATABASE_NAME || 'garuda_dev',
  user: process.env.DATABASE_USER || 'garuda_user',
  password: process.env.DATABASE_PASSWORD || 'your_db_password',
});

/** Store UUID test — konsisten dipakai test suite. */
const authFile = 'playwright/.auth/admin.json';

setup('setup store + admin session', async ({ page }) => {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@test.com';

  // 1. Store test dengan UUID valid + kategori "Sayuran"
  await pool.query(
    `INSERT INTO stores (id, name, email, "phoneNumber", "isActive", "createdAt", "updatedAt")
     VALUES ($1, $2, 'e2e-magic@store.test', '+6281234', true, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [E2E_STORE_ID, E2E_STORE_NAME]
  );
  await pool.query(
    `INSERT INTO product_categories (id, "storeId", name, "displayOrder", "isActive", "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, 'Sayuran', 1, true, NOW(), NOW())
     ON CONFLICT DO NOTHING`,
    [E2E_STORE_ID]
  );

  // 2. Admin token
  const { rows } = await pool.query(
    `SELECT id, email, role FROM admin_users WHERE email = $1 AND "deletedAt" IS NULL LIMIT 1`,
    [adminEmail]
  );
  if (rows.length === 0) {
    throw new Error(`Admin ${adminEmail} tidak ditemukan di DB. Jalankan seed terlebih dahulu.`);
  }
  const admin = rows[0];

  const token = crypto.randomUUID();
  await pool.query(
    `INSERT INTO admin_auth_tokens (id, "adminUserId", token, "expiresAt", "createdAt")
     VALUES (gen_random_uuid(), $1, $2, NOW() + INTERVAL '1 day', NOW())`,
    [admin.id, token]
  );

  // 3. Inject session ke localStorage
  await page.goto('/admin/login');
  await page.evaluate(
    ({ token, email, role }) => {
      localStorage.setItem(
        'garuda_admin',
        JSON.stringify({ adminId: 'session', email, role, token })
      );
    },
    { token, email: admin.email, role: admin.role }
  );
  await page.context().storageState({ path: authFile });

  await pool.end();
});
