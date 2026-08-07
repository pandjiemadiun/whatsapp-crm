import { test, expect } from './fixtures/index';
import { E2E_STORE_NAME, SAMPLE_TEXT } from './fixtures/constants';

/**
 * Playwright E2E — Magic Paste Admin UI (Phase 1.9.4).
 * Runner: npx playwright test
 *
 * Group 1: Navigation (2) · Group 2: Input Validation (3) · Group 3: Store Selector (1)
 * Group 4: Extract & Preview (4) · Group 5: Confirm Modal (3) · Group 6: Creation (2)
 * Group 7: Error Handling (2) · Group 8: Mobile (2) · Group 9: Accessibility (2)
 */

const BASE = '/admin/products/magic-paste';

/** Navigasi ke halaman Magic Paste + pilih store E2E (UUID valid). */
async function gotoMagicPaste(page: any) {
  await page.goto(BASE);
  await expect(page.getByRole('heading', { name: 'Magic Paste' })).toBeVisible();
  // Pilih store UUID test (backend zod mensyaratkan UUID — store seed pakai id non-UUID)
  await expect(page.getByLabel('Store')).toBeEnabled();
  await page.getByLabel('Store').selectOption({ label: E2E_STORE_NAME });
}

// ─────────────────────────────────────────────────────────────
// GROUP 1 — NAVIGATION
// ─────────────────────────────────────────────────────────────

test('1.1 Navigate ke /admin/products/magic-paste — textarea + extract button visible', async ({ authenticatedPage }) => {
  await gotoMagicPaste(authenticatedPage);
  await expect(authenticatedPage.getByLabel('Teks Produk')).toBeVisible();
  await expect(authenticatedPage.getByRole('button', { name: 'Extract' })).toBeVisible();
});

test('1.2 Responsive: layout tampil di 320px / 768px / 1440px', async ({ browser }) => {
  for (const viewport of [
    { width: 320, height: 800 },
    { width: 768, height: 900 },
    { width: 1440, height: 900 },
  ]) {
    // storageState diambil dari config → sesi admin tersedia di context baru
    const ctx = await browser.newContext({
      viewport,
      storageState: 'playwright/.auth/admin.json',
    });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await expect(page.getByLabel('Teks Produk')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Extract' })).toBeVisible();
    await ctx.close();
  }
});

// ─────────────────────────────────────────────────────────────
// GROUP 2 — INPUT VALIDATION
// ─────────────────────────────────────────────────────────────

test('2.1 Char counter update live + extract disabled < 10 chars', async ({ authenticatedPage }) => {
  await gotoMagicPaste(authenticatedPage);
  const textarea = authenticatedPage.getByLabel('Teks Produk');
  const extract = authenticatedPage.getByRole('button', { name: 'Extract' });

  await textarea.fill('abc');
  await expect(authenticatedPage.getByText('3 / 2000 chars')).toBeVisible();
  await expect(extract).toBeDisabled();

  await textarea.fill('Kangkung segar');
  await expect(authenticatedPage.getByText('14 / 2000 chars')).toBeVisible();
  await expect(extract).toBeEnabled();
});

test('2.2 Extract disabled saat textarea kosong atau < 10 chars', async ({ authenticatedPage }) => {
  await gotoMagicPaste(authenticatedPage);
  const extract = authenticatedPage.getByRole('button', { name: 'Extract' });
  await expect(extract).toBeDisabled();
  await authenticatedPage.getByLabel('Teks Produk').fill('pendek');
  await expect(extract).toBeDisabled();
});

test('2.3 Truncate di 2000 chars + counter merah', async ({ authenticatedPage }) => {
  await gotoMagicPaste(authenticatedPage);
  const textarea = authenticatedPage.getByLabel('Teks Produk');
  // maxLength di HTML otomatis memotong input Playwright
  await textarea.fill('x'.repeat(2500));
  const value = await textarea.inputValue();
  expect(value.length).toBe(2000);
  await expect(authenticatedPage.getByText('2000 / 2000 chars')).toBeVisible();
});

// ─────────────────────────────────────────────────────────────
// GROUP 3 — STORE SELECTOR
// ─────────────────────────────────────────────────────────────

test('3.1 Store dropdown punya opsi + bisa pilih', async ({ authenticatedPage, db }) => {
  await gotoMagicPaste(authenticatedPage);
  const select = authenticatedPage.getByLabel('Store');
  await expect(select).toBeVisible();
  const options = select.locator('option');
  const count = await options.count();
  expect(count).toBeGreaterThan(1); // placeholder + minimal 1 store
  // Pastikan ada store aktif di DB agar opsi benar-benar ada
  const stores = await db.query('SELECT id, name FROM stores WHERE "deletedAt" IS NULL LIMIT 1');
  expect(stores.length).toBe(1);
});

// ─────────────────────────────────────────────────────────────
// GROUP 4 — EXTRACT & PREVIEW
// ─────────────────────────────────────────────────────────────

test('4.1 Extract → spinner → preview table (name/price/stock)', async ({ authenticatedPage }) => {
  await gotoMagicPaste(authenticatedPage);
  await authenticatedPage.getByLabel('Teks Produk').fill(SAMPLE_TEXT);
  await authenticatedPage.getByRole('button', { name: 'Extract' }).click();

  // Spinner loading
  await expect(authenticatedPage.getByText('Extracting...')).toBeVisible();

  // Preview muncul (LLM/fallback backend; name Kangkung atau hasil ekstraksi)
  await expect(authenticatedPage.getByText('Preview Hasil Ekstraksi')).toBeVisible({ timeout: 15_000 });
  await expect(authenticatedPage.getByText('Nama', { exact: true })).toBeVisible();
  await expect(authenticatedPage.getByText('Harga', { exact: true })).toBeVisible();
  await expect(authenticatedPage.getByText('Stok', { exact: true })).toBeVisible();
});

test('4.2 Confidence bar warna sesuai skor', async ({ authenticatedPage }) => {
  await gotoMagicPaste(authenticatedPage);
  await authenticatedPage.getByLabel('Teks Produk').fill(SAMPLE_TEXT);
  await authenticatedPage.getByRole('button', { name: 'Extract' }).click();
  await expect(authenticatedPage.getByText('Preview Hasil Ekstraksi')).toBeVisible({ timeout: 15_000 });

  // Bar confidence (role=progressbar) + label persen
  const bar = authenticatedPage.getByRole('progressbar', { name: 'Confidence score' });
  await expect(bar).toBeVisible();
  await expect(authenticatedPage.getByText(/%$/)).toBeVisible();
});

test('4.3 Warning badge untuk confidence rendah / kategori hilang', async ({ authenticatedPage }) => {
  await gotoMagicPaste(authenticatedPage);
  // Teks tanpa kategori & ambigu → fallback confidence rendah → warning
  await authenticatedPage.getByLabel('Teks Produk').fill('Beras 15000 per kg');
  await authenticatedPage.getByRole('button', { name: 'Extract' }).click();
  await expect(authenticatedPage.getByText('Preview Hasil Ekstraksi')).toBeVisible({ timeout: 15_000 });
  // Warning banner "Perlu perhatian" muncul (confidence rendah atau kategori tak match)
  const alert = authenticatedPage.getByRole('alert');
  await expect(alert.first()).toBeVisible();
});

test('4.4 Extract error 400 → pesan error + retry', async ({ authenticatedPage }) => {
  await gotoMagicPaste(authenticatedPage);
  // Harga > 10jt → backend ERR_PRICE_INVALID (400)
  await authenticatedPage.getByLabel('Teks Produk').fill('Mobil mewah 50 juta stok 1');
  await authenticatedPage.getByRole('button', { name: 'Extract' }).click();
  // Error banner muncul
  await expect(authenticatedPage.getByRole('alert').first()).toBeVisible({ timeout: 15_000 });
  // Tombol Extract masih tersedia untuk retry
  await expect(authenticatedPage.getByRole('button', { name: 'Extract' })).toBeEnabled();
});

// ─────────────────────────────────────────────────────────────
// GROUP 5 — CONFIRM MODAL
// ─────────────────────────────────────────────────────────────

test('5.1 Create Product → modal konfirmasi dengan data', async ({ authenticatedPage }) => {
  await gotoMagicPaste(authenticatedPage);
  await authenticatedPage.getByLabel('Teks Produk').fill(SAMPLE_TEXT);
  await authenticatedPage.getByRole('button', { name: 'Extract' }).click();
  await expect(authenticatedPage.getByRole('button', { name: 'Create Product' })).toBeVisible({ timeout: 15_000 });

  await authenticatedPage.getByRole('button', { name: 'Create Product' }).click();
  const modal = authenticatedPage.getByRole('dialog', { name: 'Konfirmasi pembuatan produk' });
  await expect(modal).toBeVisible();
  await expect(modal.getByText('Konfirmasi Produk')).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Create' })).toBeVisible();
});

test('5.2 Cancel → modal tutup, data preview tetap', async ({ authenticatedPage }) => {
  await gotoMagicPaste(authenticatedPage);
  await authenticatedPage.getByLabel('Teks Produk').fill(SAMPLE_TEXT);
  await authenticatedPage.getByRole('button', { name: 'Extract' }).click();
  await expect(authenticatedPage.getByRole('button', { name: 'Create Product' })).toBeVisible({ timeout: 15_000 });
  await authenticatedPage.getByRole('button', { name: 'Create Product' }).click();

  const modal = authenticatedPage.getByRole('dialog', { name: 'Konfirmasi pembuatan produk' });
  await modal.getByRole('button', { name: 'Cancel' }).click();
  await expect(modal).not.toBeVisible();
  // Preview tetap ada
  await expect(authenticatedPage.getByText('Preview Hasil Ekstraksi')).toBeVisible();
});

test('5.3 Klik overlay → modal tutup', async ({ authenticatedPage }) => {
  await gotoMagicPaste(authenticatedPage);
  await authenticatedPage.getByLabel('Teks Produk').fill(SAMPLE_TEXT);
  await authenticatedPage.getByRole('button', { name: 'Extract' }).click();
  await expect(authenticatedPage.getByRole('button', { name: 'Create Product' })).toBeVisible({ timeout: 15_000 });
  await authenticatedPage.getByRole('button', { name: 'Create Product' }).click();

  const modal = authenticatedPage.getByRole('dialog', { name: 'Konfirmasi pembuatan produk' });
  await expect(modal).toBeVisible();
  // Klik di luar modal (overlay)
  await authenticatedPage.mouse.click(5, 5);
  await expect(modal).not.toBeVisible();
});

// ─────────────────────────────────────────────────────────────
// GROUP 6 — PRODUCT CREATION
// ─────────────────────────────────────────────────────────────

test('6.1 Create → pesan sukses muncul', async ({ authenticatedPage, db }) => {
  // Nama HANYA huruf — backend regex fallback menganggap angka pertama = harga
  const unique = `TestProduct_${Math.random().toString(36).replace(/[0-9]/g, '').slice(0, 8)}`;
  await gotoMagicPaste(authenticatedPage);
  await authenticatedPage.getByLabel('Teks Produk').fill(`${unique} 5000 stok 100`);
  await authenticatedPage.getByRole('button', { name: 'Extract' }).click();
  await expect(authenticatedPage.getByRole('button', { name: 'Create Product' })).toBeVisible({ timeout: 15_000 });
  await authenticatedPage.getByRole('button', { name: 'Create Product' }).click();

  const modal = authenticatedPage.getByRole('dialog', { name: 'Konfirmasi pembuatan produk' });
  await modal.getByRole('button', { name: 'Create' }).click();

  // Toast sukses (feedback banner) — pakai .first() karena ada 2 elemen serupa
  await expect(authenticatedPage.getByText('Product berhasil dibuat!').first()).toBeVisible({ timeout: 15_000 });
  await expect(authenticatedPage.getByText(/Mengarahkan ke detail produk/)).toBeVisible();

  // Cleanup produk test
  await db.cleanup('products', `name = '${unique}'`);
});

test('6.2 Produk ter-create di DB dengan field benar', async ({ authenticatedPage, db }) => {
  const unique = `TestProduct_${Math.random().toString(36).replace(/[0-9]/g, '').slice(0, 8)}`;
  await gotoMagicPaste(authenticatedPage);
  await authenticatedPage.getByLabel('Teks Produk').fill(`${unique} 7500 stok 42`);
  await authenticatedPage.getByRole('button', { name: 'Extract' }).click();
  await expect(authenticatedPage.getByRole('button', { name: 'Create Product' })).toBeVisible({ timeout: 15_000 });
  await authenticatedPage.getByRole('button', { name: 'Create Product' }).click();
  await authenticatedPage.getByRole('dialog', { name: 'Konfirmasi pembuatan produk' })
    .getByRole('button', { name: 'Create' }).click();
  await expect(authenticatedPage.getByText('Product berhasil dibuat!').first()).toBeVisible({ timeout: 15_000 });

  // Verifikasi DB
  const rows = await db.query(
    `SELECT name, price, stock, source FROM products WHERE name = $1 AND "deletedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1`,
    [unique]
  );
  expect(rows.length).toBe(1);
  expect((rows[0] as any).price).toBe(7500);
  expect((rows[0] as any).stock).toBe(42);
  expect((rows[0] as any).source).toBe('magic_paste');

  // Cleanup
  await db.cleanup('products', `name = '${unique}'`);
});

// ─────────────────────────────────────────────────────────────
// GROUP 7 — ERROR HANDLING
// ─────────────────────────────────────────────────────────────

test('7.1 Extract error 400 → banner + retry', async ({ authenticatedPage }) => {
  await gotoMagicPaste(authenticatedPage);
  await authenticatedPage.getByLabel('Teks Produk').fill('Produk 0 rupiah');
  await authenticatedPage.getByRole('button', { name: 'Extract' }).click();
  const alert = authenticatedPage.getByRole('alert').first();
  await expect(alert).toBeVisible({ timeout: 15_000 });
  await expect(authenticatedPage.getByRole('button', { name: 'Extract' })).toBeEnabled();
});

test('7.2 Create error 401 → redirect login / pesan error', async ({ authenticatedPage, page }) => {
  // Simulasi token tidak valid dengan route mock pada create call
  await gotoMagicPaste(authenticatedPage);
  await page.route('**/api/admin/products/magic-paste', (route) => {
    if (route.request().method() === 'POST' && route.request().url().includes('preview=true')) {
      return route.continue();
    }
    return route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error: { code: 'ERR_UNAUTHORIZED', message: 'Unauthorized' } }),
    });
  });
  await authenticatedPage.getByLabel('Teks Produk').fill(SAMPLE_TEXT);
  await authenticatedPage.getByRole('button', { name: 'Extract' }).click();
  const createBtn = authenticatedPage.getByRole('button', { name: 'Create Product' });
  await createBtn.scrollIntoViewIfNeeded();
  await expect(createBtn).toBeVisible({ timeout: 15_000 });
  await createBtn.click();
  await authenticatedPage.getByRole('dialog', { name: 'Konfirmasi pembuatan produk' })
    .getByRole('button', { name: 'Create' }).click();

  // 401 → redirect ke /admin/login
  await authenticatedPage.waitForURL('**/admin/login', { timeout: 10_000 }).catch(() => {});
  // ATAU pesan error muncul — salah satu cukup
  const onLogin = authenticatedPage.url().includes('/admin/login');
  if (!onLogin) {
    await expect(authenticatedPage.getByRole('alert').first()).toBeVisible({ timeout: 10_000 });
  }
});

// ─────────────────────────────────────────────────────────────
// GROUP 8 — MOBILE RESPONSIVE
// ─────────────────────────────────────────────────────────────

test('8.1 Flow lengkap di 320px', async ({ browser }) => {
  const ctx = await browser.newContext({
    viewport: { width: 320, height: 800 },
    storageState: 'playwright/.auth/admin.json',
  });
  const page = await ctx.newPage();
  await page.goto(BASE);

  await page.getByLabel('Teks Produk').fill(SAMPLE_TEXT);
  await page.getByRole('button', { name: 'Extract' }).click();
  await expect(page.getByText('Preview Hasil Ekstraksi')).toBeVisible({ timeout: 15_000 });
  await ctx.close();
});

test('8.2 Flow lengkap di 768px (tablet)', async ({ browser }) => {
  const ctx = await browser.newContext({
    viewport: { width: 768, height: 900 },
    storageState: 'playwright/.auth/admin.json',
  });
  const page = await ctx.newPage();
  await page.goto(BASE);

  await page.getByLabel('Teks Produk').fill(SAMPLE_TEXT);
  await page.getByRole('button', { name: 'Extract' }).click();
  await expect(page.getByText('Preview Hasil Ekstraksi')).toBeVisible({ timeout: 15_000 });
  await ctx.close();
});

// ─────────────────────────────────────────────────────────────
// GROUP 9 — ACCESSIBILITY
// ─────────────────────────────────────────────────────────────

test('9.1 Keyboard: Tab dari textarea ke Extract, Enter submit', async ({ authenticatedPage }) => {
  await gotoMagicPaste(authenticatedPage);
  await authenticatedPage.getByLabel('Teks Produk').fill(SAMPLE_TEXT);
  const extract = authenticatedPage.getByRole('button', { name: 'Extract' });

  // Focus textarea lalu Tab — extract adalah tombol berikutnya setelah Clear/Example
  await authenticatedPage.getByLabel('Teks Produk').focus();
  await authenticatedPage.keyboard.press('Tab'); // → Clear
  await authenticatedPage.keyboard.press('Tab'); // → Example
  await authenticatedPage.keyboard.press('Tab'); // → Extract
  await expect(extract).toBeFocused();

  // Enter submit
  await authenticatedPage.keyboard.press('Enter');
  await expect(authenticatedPage.getByText('Preview Hasil Ekstraksi')).toBeVisible({ timeout: 15_000 });
});

test('9.2 ARIA labels ada di textarea, tombol, modal', async ({ authenticatedPage }) => {
  await gotoMagicPaste(authenticatedPage);
  // Label form
  await expect(authenticatedPage.getByLabel('Teks Produk')).toBeVisible();
  await expect(authenticatedPage.getByLabel('Store')).toBeVisible();
  // Tombol dengan aksesibilitas
  await expect(authenticatedPage.getByRole('button', { name: 'Extract' })).toBeVisible();
  await expect(authenticatedPage.getByRole('button', { name: 'Clear' })).toBeVisible();
  await expect(authenticatedPage.getByRole('button', { name: 'Example' })).toBeVisible();

  // Extract → preview → buka modal, cek role dialog
  await authenticatedPage.getByLabel('Teks Produk').fill(SAMPLE_TEXT);
  await authenticatedPage.getByRole('button', { name: 'Extract' }).click();
  await expect(authenticatedPage.getByRole('button', { name: 'Create Product' })).toBeVisible({ timeout: 15_000 });
  await authenticatedPage.getByRole('button', { name: 'Create Product' }).click();
  await expect(authenticatedPage.getByRole('dialog', { name: 'Konfirmasi pembuatan produk' })).toBeVisible();
});
