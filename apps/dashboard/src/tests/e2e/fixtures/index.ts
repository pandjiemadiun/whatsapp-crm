import { test as base, expect, type Page } from '@playwright/test';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './auth.fixture';
import { dbFixture, type DbFixture } from './database.fixture';

/**
 * Combined fixture: authenticatedPage (session admin dari storageState) + db (PostgreSQL).
 * Session admin di-inject oleh auth.setup.ts (token DB → localStorage), TANPA login
 * via endpoint → tidak kena rate limit login.
 *
 * ```ts
 * import { test, expect } from './fixtures';
 *
 * test('flow lengkap', async ({ authenticatedPage, db }) => { ... });
 * ```
 */
export const test = dbFixture.extend<{ authenticatedPage: Page }>({
  authenticatedPage: async ({ page }, use) => {
    // storageState dari setup project (playwright/.auth/admin.json) berisi sesi admin.
    // Verifikasi redirect halaman admin (jika sesi invalid → redirect ke /admin/login).
    await page.goto('/admin');
    await page.waitForURL('**/admin', { timeout: 15_000 });
    await use(page);
  },
});

export { expect, ADMIN_EMAIL, ADMIN_PASSWORD };
export type { DbFixture };
export type { Page };
export { test as baseTest };
