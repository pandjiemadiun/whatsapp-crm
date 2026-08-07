import { test, expect } from './fixtures/index';
import crypto from 'node:crypto';

/**
 * Playwright E2E — Analytics Empty State (Phase 1.9.6 hardening).
 * Runner: npx playwright test src/tests/e2e/analytics-empty.e2e.test.ts
 * (atau dengan config verifikasi: npx playwright test --config playwright.verify.config.ts)
 *
 * Memverifikasi bahwa halaman /dashboard/analytics menampilkan empty state
 * ("Belum ada data extraction") untuk akun store yang belum pernah menjalankan
 * Magic Paste. Alur:
 *   1. Buat store baru + token via DB (tanpa login endpoint → tidak kena rate limit)
 *   2. Inject token ke localStorage (pola sama seperti auth.setup.ts)
 *   3. Buka /dashboard/analytics
 *   4. Assert empty state + tidak ada KPI
 *
 * Cleanup: dijalankan di afterAll (dan juga di dalam try setelah setup) agar
 * store test tidak pernah tertinggal walau setup/assert gagal di tengah.
 */

const PREFIX = `anl-empty-${Date.now()}`;
const EMAIL = `${PREFIX}@e2e.test`;
const STORE_ID = `store-${PREFIX}`;

test.afterAll(async ({ db }) => {
  await db.cleanup('magic_paste_runs', `"storeId" = '${STORE_ID}'`);
  await db.cleanup('store_settings', `"storeId" = '${STORE_ID}'`);
  await db.cleanup('products', `"storeId" = '${STORE_ID}'`);
  await db.cleanup('stores', `id = '${STORE_ID}'`);
});

test('Analytics empty state: "Belum ada data extraction" tampil, KPI tidak dirender', async ({ page, db }) => {
  // ── 1. Setup store + auth token langsung di DB ──
  const token = crypto.randomUUID();
  await db.query(
    `INSERT INTO stores (id, name, email, "createdAt", "updatedAt") VALUES ($1, $2, $3, now(), now())`,
    [STORE_ID, 'E2E Empty Store', EMAIL]
  );
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await db.query(
    `INSERT INTO store_settings (id, "storeId", key, value, "createdAt", "updatedAt")
     VALUES ($1, $2, 'auth_token', $3, now(), now())`,
    [crypto.randomUUID(), STORE_ID, token]
  );
  await db.query(
    `INSERT INTO store_settings (id, "storeId", key, value, "createdAt", "updatedAt")
     VALUES ($1, $2, 'auth_token_expires_at', $3, now(), now())`,
    [crypto.randomUUID(), STORE_ID, expiresAt]
  );

  try {
    // ── 2. Inject sesi ke localStorage (pola auth.setup) ──
    await page.goto('/');
    await page.evaluate(
      ([t, sid, email]) => {
        localStorage.setItem(
          'garuda_user',
          JSON.stringify({
            email,
            storeId: sid,
            storeName: 'E2E Empty Store',
            token: t,
            hasProfile: true,
          })
        );
      },
      [token, STORE_ID, EMAIL] as [string, string, string]
    );

    // ── 3. Buka halaman analytics ──
    await page.goto('/dashboard/analytics');

    // ── 4. Assert empty state ──
    await expect(page.getByText('Belum ada data extraction')).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText('Gunakan fitur Magic Paste di halaman Products untuk mulai melihat analytics confidence di sini.')
    ).toBeVisible();

    // KPI tidak boleh tampil saat kosong
    await expect(page.getByText('Total Extraction')).toHaveCount(0);
    await expect(page.getByText('Avg Confidence')).toHaveCount(0);
  } finally {
    // ── 5. Bersihkan data test (jaring pengaman di samping afterAll) ──
    await db.cleanup('magic_paste_runs', `"storeId" = '${STORE_ID}'`);
    await db.cleanup('store_settings', `"storeId" = '${STORE_ID}'`);
    await db.cleanup('products', `"storeId" = '${STORE_ID}'`);
    await db.cleanup('stores', `id = '${STORE_ID}'`);
  }
});
