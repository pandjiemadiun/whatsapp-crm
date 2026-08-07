import { test, expect } from '@playwright/test';

test.describe('WhatsApp Connection Status — Regression + Notification Center', () => {
  test.describe.configure({ mode: 'serial' });

  // ── FIX B: Header = satu pusat notifikasi (lonceng), tidak ada titik WA ──
  test.describe('Header notification center', () => {
    test('WA phone-dot dihapus; lonceng punya tepat 1 badge', async ({ page }) => {
      // Store terputus
      await page.addInitScript(() => {
        window.localStorage.setItem('garuda_user', JSON.stringify({
          email: 'test@depo.com',
          storeId: 'store-d49b4e1e',
          storeName: 'test',
          token: 'e1852bbd-459c-44f4-8568-c96d391bea2e',
          hasProfile: true,
        }));
      });

      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto('/dashboard');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(5000);

      // 1. WA phone-dot di header — HAPPUS
      const waPhoneDot = await page.locator('button[aria-label*="WhatsApp terhubung"], button[aria-label*="WhatsApp belum terhubung"]').count();
      expect(waPhoneDot).toBe(0);

      // 2. Bell badge — tepat 1 badge (rounded-full di sebelah Bell icon)
      const bell = page.locator('button[aria-label="Notifikasi"]');
      await expect(bell).toBeVisible();
      const bellBadge = await bell.locator('span[class*="rounded-full"][class*="bg-brand"]').count();
      expect(bellBadge).toBe(1);
    });

    test('Bell dropdown menampilkan status WA channel', async ({ page }) => {
      await page.addInitScript(() => {
        window.localStorage.setItem('garuda_user', JSON.stringify({
          email: 'test@depo.com',
          storeId: 'store-d49b4e1e',
          storeName: 'test',
          token: 'e1852bbd-459c-44f4-8568-c96d391bea2e',
          hasProfile: true,
        }));
      });

      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto('/dashboard');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(5000);

      // Klik lonceng
      await page.click('button[aria-label="Notifikasi"]');

      // Dropdown harus ada baris status WA
      const waStatusRow = await page.locator('text=WhatsApp: Terputus — hubungkan').count();
      expect(waStatusRow).toBe(1);

      // Klik baris WA → navigasi ke /dashboard/whatsapp
      await page.click('text=WhatsApp: Terputus — hubungkan');
      await page.waitForURL('**/dashboard/whatsapp');
    });

    test('Bell dropdown menampilkan "Terhubung • <number>" ketika store connected', async ({ page }) => {
      // Mock API /whatsapp/fonnte/status → connected
      await page.addInitScript(() => {
        window.localStorage.setItem('garuda_user', JSON.stringify({
          email: 'test@depo.com',
          storeId: 'store-f7140b5c',
          storeName: 'Depot Kinasih',
          token: 'b7f35799-6098-487d-8f91-afc48aae634a',
          hasProfile: true,
        }));
      });

      await page.route('**/api/whatsapp/fonnte/status', (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              status: 'connected',
              gateway: 'fonnte',
              phoneNumber: '6289612345678',
              fonnteNumber: '6289612345678',
              lastCheckedAt: new Date().toISOString(),
            },
          }),
        });
      });

      // Mock metrics + other endpoints to avoid errors
      await page.route('**/api/dashboard/metrics', (route) => {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { totalMessages: 10, faqAnswered: 5, aiCostUSD: 0.01 } }) });
      });
      await page.route('**/api/conversations*', (route) => {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
      });
      await page.route('**/api/orders*', (route) => {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
      });
      await page.route('**/api/products/my*', (route) => {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { products: [] } }) });
      });
      await page.route('**/api/profile*', (route) => {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { name: 'Depot Kinasih', profilePhotoUrl: null } }) });
      });

      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto('/dashboard');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(5000);

      // 1. Banner shows "Lihat Percakapan"
      const connectedCta = await page.locator('button:has-text("Lihat Percakapan")').count();
      expect(connectedCta).toBeGreaterThan(0);

      // 2. No WA phone-dot in header
      const waPhoneDot = await page.locator('button[aria-label*="WhatsApp terhubung"], button[aria-label*="WhatsApp belum terhubung"]').count();
      expect(waPhoneDot).toBe(0);

      // 3. Bell badge = 1 (notification badge, not WA dot)
      const bell = page.locator('button[aria-label="Notifikasi"]');
      const bellBadge = await bell.locator('span[class*="rounded-full"][class*="bg-brand"]').count();
      expect(bellBadge).toBe(1);

      // 4. Bell dropdown shows connected WA status
      await page.click(bell);
      const waConnectedRow = await page.locator('text=WhatsApp: Terhubung • 6289612345678').count();
      expect(waConnectedRow).toBe(1);

      await page.screenshot({ path: 'screenshots/whatsapp-header-connected-375.png', fullPage: true });
    });
  });

  // ── FIX A: DashboardHome banner konsisten dengan endpoint ──
  test.describe('DashboardHome banner consistency', () => {
    test('Store terhubung → banner "Lihat Percakapan"', async ({ page }) => {
      await page.addInitScript(() => {
        window.localStorage.setItem('garuda_user', JSON.stringify({
          email: 'test@depo.com',
          storeId: 'store-f7140b5c',
          storeName: 'Depot Kinasih',
          token: 'b7f35799-6098-487d-8f91-afc48aae634a',
          hasProfile: true,
        }));
      });

      // Mock connected status
      await page.route('**/api/whatsapp/fonnte/status', (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              status: 'connected',
              gateway: 'fonnte',
              phoneNumber: '6289612345678',
              fonnteNumber: '6289612345678',
              lastCheckedAt: new Date().toISOString(),
            },
          }),
        });
      });
      await page.route('**/api/dashboard/metrics', (route) => {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { totalMessages: 10, faqAnswered: 5, aiCostUSD: 0.01 } }) });
      });
      await page.route('**/api/conversations*', (route) => {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
      });
      await page.route('**/api/orders*', (route) => {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
      });
      await page.route('**/api/products/my*', (route) => {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { products: [] } }) });
      });
      await page.route('**/api/profile*', (route) => {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { name: 'Depot Kinasih', profilePhotoUrl: null } }) });
      });

      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto('/dashboard');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(5000);

      const connectedCta = await page.locator('button:has-text("Lihat Percakapan")').count();
      expect(connectedCta).toBeGreaterThan(0);

      const waBanner = await page.locator('text=Terhubung').first().count();
      expect(waBanner).toBe(1);
    });

    test('Store terputus → banner "Hubungkan WhatsApp dulu"', async ({ page }) => {
      await page.addInitScript(() => {
        window.localStorage.setItem('garuda_user', JSON.stringify({
          email: 'test@depo.com',
          storeId: 'store-d49b4e1e',
          storeName: 'test',
          token: 'e1852bbd-459c-44f4-8568-c96d391bea2e',
          hasProfile: true,
        }));
      });

      await page.route('**/api/dashboard/metrics', (route) => {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { totalMessages: 10, faqAnswered: 5, aiCostUSD: 0.01 } }) });
      });
      await page.route('**/api/conversations*', (route) => {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
      });
      await page.route('**/api/orders*', (route) => {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
      });
      await page.route('**/api/products/my*', (route) => {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { products: [] } }) });
      });
      await page.route('**/api/profile*', (route) => {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { name: 'test', profilePhotoUrl: null } }) });
      });

      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto('/dashboard');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(5000);

      const disconnectedCta = await page.locator('button:has-text("Hubungkan WhatsApp dulu")').count();
      expect(disconnectedCta).toBeGreaterThan(0);

      const wrongCta = await page.locator('button:has-text("Lihat Percakapan")').count();
      expect(wrongCta).toBe(0);
    });

    // Endpoint returns unified status with gateway field
    test('API /whatsapp/fonnte/status mengembalikan field gateway + phoneNumber', async () => {
      const response = await test.step('fetch status', async () => {
        return await page.request.get('http://localhost/api/whatsapp/fonnte/status', {
          headers: { Authorization: 'Bearer e1852bbd-459c-44f4-8568-c96d391bea2e' },
        });
      });
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty('gateway');
      expect(data.data).toHaveProperty('phoneNumber');
      expect(data.data).toHaveProperty('lastCheckedAt');
    });
  });
});
