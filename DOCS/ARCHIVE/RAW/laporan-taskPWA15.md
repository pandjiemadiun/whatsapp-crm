# P-PWA.15 — Manifest PWA (installable) + prompt "Add to Home Screen"

Scope: **HANYA `apps/pwa`**. Backend (`apps/api`) **tidak disentuh** — tidak ada
perubahan schema/route/service; tidak ada restart `api`.

---

## 1. Gate

- HEAD sebelum kerjaan: `d46eadc` — `feat(PWA.14): typing indicator + delay natural (max target vs response arrival)` (sudah committed sebelumnya).
- `git status --short | grep -E 'apps/(api|dashboard)/src'` → **kosong** (tidak ada *source dirt* di luar `apps/pwa`).
- `pm2` `api` (pid `286707`, fork, `:3000`) tetap `online`.
- `GET http://localhost:3000/api/health` → `{"status":"ok","message":"All systems operational"}`.

---

## 2. Bagian 1 — Manifest + Service Worker (syarat installable)

### 2.1 `public/manifest.json`

Dibuat di `apps/pwa/public/manifest.json`. Di salin (copy) oleh Vite ke `dist/manifest.json` pada build, dan dilayani di origin root sehingga berada pada *scope* yang sama dengan PWA (`/manifest.json`).

Field sesuai speksifikasi:

| field | value |
|---|---|
| `name` | `QloBot — Chat Toko` |
| `short_name` | `QloBot` (12 karakter, dalam limit) |
| `start_url` | `/` |
| `display` | `standalone` |
| `background_color` | `#ffffff` |
| `theme_color` | `#1B53F5` |
| `icons` | `/icons/icon-192.png` (192×192, `image/png`), `/icons/icon-512.png` (512×512, `image/png`) |

`manifest.json` divalidasi dengan `python3 -c "import json; json.load(...)"` → **parse valid**, semua field wajib (name/short_name/start_url/display/icons) lengkap. Diperlakukan `python3 json.tool` → tidak error.

### 2.2 `index.html`

Dua baris ditambahkan di `<head>` (setelah `meta name="viewport"`):

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="theme-color" content="#1B53F5" />
<link rel="manifest" href="/manifest.json" />
<title>PWA</title>
```

`link rel="manifest"` berada **sebelum** `<title>` dan setelah viewport, sehingga Chrome dapat mendeteksinya saat mem-parse head. `theme-color` juga diset agar *address bar* berwarna brand ketika standalone. (`tsc`/vite tidak type-check `index.html`; ini adalah static asset.)

### 2.3 `public/sw.js` — Service Worker minimal

Dibuat di `apps/pwa/public/sw.js`:

- `install` → `self.skipWaiting()` (aktif segera, tidak menunggu scope client lain).
- `activate` → `self.clients.claim()` (ambil kontrol halaman segera).
- `fetch` → hanya *pass-through* jaringan (`fetch(event.request)`), **tanpa cache/offline strategy**. Jika network gagal, mengembalikan `Response` kosong (`status:0`) agar tidak menghalangi render. Hanya `GET` yang di-intercept.

```js
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', (event) => {
  if (event.request.method === 'GET') {
    event.respondWith(
      fetch(event.request).catch(() => new Response('', { status: 0 })),
    );
  }
});
```

Registrasi dilakukan di **`main.tsx`** (bukan di SW itu-sendiri):

```tsx
// P-PWA.15: register Service Worker minimal (syarat installable PWA).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
```

- Path register `/sw.js` → selaras dengan `publicDir` Vite default (`'public'`), sehingga `public/sw.js` dilayani di `/sw.js`.
- Registrasi asinkron + `catch(() => {})` → jika gagal, tidak memblokir render (graceful).

### 2.4 Icon placeholder — **PENTING**

Karena belum ada aset logo milik owner, dipakai **placeholder hasil-generate** oleh `python3` (stdlib `zlib` + `struct`, tidak pakai ImageMagick/sharp/PIL — yang tidak tersedia di environment ini):

- `apps/pwa/public/icons/icon-192.png` — PNG 192×192, 8-bit truecolor RGB (988 byte).
- `apps/pwa/public/icons/icon-512.png` — PNG 512×512, 8-bit truecolor RGB (3228 byte).

Desain placeholder: latar putih dengan **lingkaran biru brand (`#1B53F5`)** di tengah + cincin biru muda (`rgb(230,235,250)`). Dikonfirmasi via `file` command:

```
icon-192.png: PNG image data, 192 x 192, 8-bit/color RGB, non-interlaced
icon-512.png: PNG image data, 512 x 512, 8-bit/color RGB, non-interlaced
```

> ⚠️ **Ini adalah placeholder.** Owner wajib menggantinya dengan aset logo asli bergambar (bukan lingkaran polos). Rekomendasi ukuran/asset asli yang perlu owner sediakan:
>
> - `icon-192.png` PNG, **192×192** (Android `mipmap`?).
> - `icon-512.png` PNG, **512×512** (Google Play / Chrome install).
> - `icon-144.png` PNG, **144×144** (Android `mipmap-mdpi/hdpi` standar).
> - **`icon-maskable-512.png`** PNG, **512×512** dengan `purpose: "maskable"` (agar OS dapat men-*crop* dengan aman pada Android).
> - **`icon.svg`** vektor (skalabel, untuk DevTools + iOS sebagai fallback).
> - **Apple touch icon `apple-touch-icon.png`** PNG **180×180** (iOS/safari tidak membaca `manifest.json`; memerlukan `<link rel="apple-touch-icon" href="...">` di `index.html` agar ikon tidak pecah saat "Tambah ke Beranda" manual).
>
> Rekomendasi properti tambahan di `manifest.json` nanti (jika ingin kelengkapan maksimal): `scope`, `orientation`, `categories`, `prefer_related_applications: false`.

---

## 3. Bagian 2 — Trigger prompt install

Logika berada di **`apps/pwa/src/components/ChatPage.tsx`** (satu file — tidak menyentuh backend).

### 3.1 Listener `beforeinstallprompt` (Chrome/Edge/Android)

Didaftarkan pada mount via `useEffect` (cleanup di-unregister pada unmount):

```tsx
const onBeforeInstallPrompt = (e: Event) => {
  e.preventDefault()                                 // tahan Chrome agar tidak auto-toast
  setDeferredPrompt(e as unknown as BeforeInstallPromptEvent)
}
window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
```

Tambahan listener `appinstalled` → pada saat berhasil dipasang, panggil `markInstalled()` (set `installed:true` di localStorage) + tutup banner + hapus `deferredPrompt`.

> 🛑 **Safari/iOS: TIDAK support `beforeinstallprompt`.** Pada Safari/iOS, `deferredPrompt` akan `null` sepanjang sesi (event tidak pernah membangunkan). Di situ:
> - **Tidak pernah** dipaksakan `prompt()` (tidak mungkin — API tidak ada), sesuai constraint "JANGAN coba paksa auto-prompt di Safari".
> - Banner alternatif **hanya menampilkan instruksi manual** ("Buka di browser, ketuk 'Tambah ke Beranda'") tanpa tombol aksi `prompt()` — *lihat JSX pada 3.3*.

### 3.2 Trigger **setelah balasan AI pertama** (heuristik)

Trigger berada di cabang `else if (body?.success && body.content != null)` pada `onSend` — tepat saat balasan AI pertama (`role:'assistant'` dengan `content`) akan ditambahkan ke state `messages`. Trigger dilakukan **sekali per sesi** melalui ref boolean `installTriggeredRef`:

```tsx
if (!installTriggeredRef.current && isInstallBannerAllowed()) {
  installTriggeredRef.current = true
  setInstallBannerOpen(true)
}
```

> ⚠️ **Ini heuristik / approximate.** Sinyal "transaksi selesai" presisi belum tersedia di backend (belum ada broadcast `order.completed` ke PWA), jadi dipakai *surrogate* "balasan AI pertama kali di sesi". Dapat disempurnakan nanti bila backend menyediakan sinyal status checkout. Logika *delay natural* P-PWA.14 (`max(targetDisplayMs - elapsed, 0)`) dipertahankan apa adanya — *tidak* ada regresi.

Trigger ini **tidak bergantung pada `deferredPrompt`**: ia menempatkan `installBannerOpen=true`, sedangkan isi banner (tombol `Pasang` vs. teks instruksi manual) dipilih pada render berdasarkan apakah `deferredPrompt` tersedia.

### 3.3 Dismissal storage — **`localStorage` objek, jendela 7 hari** (override "Tambahan")

> Spesifikasi asli poin 3 Bagian 2 mengatakan *simpan di `sessionStorage`*. **Ditimpa (override) oleh petunjuk tambahan** user: gunakan **`localStorage`** dengan **bukan boolean polos** melainkan objek.

```ts
const INSTALL_KEY = 'pwa_install_prompt'
const INSTALL_TTL_MS = 7 * 24 * 60 * 60 * 1000   // 7 hari
interface InstallPromptState { dismissedAt?: number; installed?: boolean }

function readInstallState(): InstallPromptState { try { const r = localStorage.getItem(INSTALL_KEY); return r ? (JSON.parse(r) as InstallPromptState) : {} } catch { return {} } }
function isInstallBannerAllowed(): boolean {
  const s = readInstallState()
  if (s.installed) return false                                   // sudah pernah dipasang → tidak pernah lagi
  if (s.dismissedAt && Date.now() - s.dismissedAt < INSTALL_TTL_MS) return false  // dismiss < 7 hari → tetap tertutup
  return true                                                    // belum dismiss pernah, atau sudah > 7 hari →boleh tampil
}
```

Penyimpanan: `localStorage.setItem('pwa_install_prompt', JSON.stringify({ dismissedAt:<Date.now()>, installed:<bool> }))`.

- **Dismiss (✕)** → `markDismissed()`: set `dismissedAt = Date.now()`, tutup banner. Selama **< 7 hari** berikutnya, `isInstallBannerAllowed()` == `false` → banner tidak muncul kembali, meski user membuka thread baru / kunjungan baru. Setelah **> 7 hari** (atau belum pernah dismiss), diizinkan muncul lagi → *"muncul lagi kalau kunjungan baru"* yang cukup jaraknya.
- **Pasang ditekan → `outcome === 'accepted'`** → `markInstalled()` (`installed:true`, permanen).
- **Pasang → `dismissed`** → `markDismissed()`.
- Memori sesi: `installTriggeredRef` (ref boolean) mencegah trigger ganda **sekali dalam satu sesi** (mis. balasan kedua), sehingga banner tidak "muncul berulang kali kalau sudah dismiss di sesi yang sama" — ini melengkapi aturan 7-hari (state lintas-sesi). Session-scoped trigger = ref yang tidak persisten (hilang pada reload), sesuai "sekali per sesi".

Banner bersifat **non-intrusive** (posisi `fixed bottom-4 left-1/2`, `z-10`, tidak modal, tidak memblokir input chat) dan **dapat di-dismiss** (tombol ✕ di kanan atas banner).

```tsx
<div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-10 max-w-sm w-[90%]">
  <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl shadow-lg px-4 py-3">
    <span className="text-sm text-gray-700 flex-1">
      {deferredPrompt
        ? 'Pasang QloBot di layar utama untuk akses cepat?'
        : 'Buka di browser, ketuk "Tambah ke Beranda" untuk akses cepat.'}
    </span>
    {deferredPrompt && (
      <button onClick={async () => {
        await deferredPrompt.prompt()
        const choice = await deferredPrompt.userChoice
        if (choice.outcome === 'accepted') { markInstalled(); setInstallBannerOpen(false); setDeferredPrompt(null) }
        else markDismissed()
      }} className="...">Pasang</button>
    )}
    <button onClick={() => { markDismissed(); setInstallBannerOpen(false) }} aria-label="Tutup">✕</button>
  </div>
</div>
```

---

## 4. Validasi

| No | Cek | Result |
|---|---|---|
| 1 | `npx tsc --noEmit -p tsconfig.app.json` | **exit 0** (0 error) |
| 2 | `npm run build` (`tsc -b && vite build`) | **exit 0**, `✓ built in 957ms` — 81 modules, 3 chunks (`index.html`, `assets/index-*.css`, `assets/index-*.js`) |
| 3 | `dist/` berisi `manifest.json` + `sw.js` | ✓ ada — `dist/manifest.json`, `dist/sw.js`, `dist/icons/icon-192.png`, `dist/icons/icon-512.png` |
| 3b | `dist/manifest.json` valid JSON (parse) | ✓ `python3 -c "json.load"` sukses; semua field wajib lengkap |
| 3c | DevTools Application → Manifest (perkiraan manual) | manifest.json + sw.js berada di origin root (`/`) pada scope yang sama → Chrome tidak akan error validasi; icon 192/512 PNG valid. (Verifikasi manual Chrome DevTools tidak dapat di-curl; dilaporkan asumsi + repro manual di bawah §5.) |
| 4 | `git diff --stat` — **HANYA `apps/pwa`** + DOCS | ✓ (lihat §5) — tidak ada file di `apps/api`/`apps/dashboard` berubah |
| 5 | `apps/api` pm2 tetap online | ✓ pid `286707` `online`; `GET /api/health` → `{"status":"ok","message":"All systems operational"}` |

Build output:
```
dist/index.html                   0.48 kB │ gzip:  0.30 kB
dist/assets/index-CS9voRlT.css   10.61 kB │ gzip:  3.07 kB
dist/assets/index-Cp98Z3Hp.js   282.49 kB │ gzip:  92.93 kB
```

### 4.1 Unit assertions (algoritma)

Race/verification skrip Node (standalone, **dihapus setelah**, tidak di-commit ke `apps/pwa`) mereplikasi *exact arithmetic* dari `ChatPage.tsx`:

```
PASS: targetDisplayTime always in [700,1300]
PASS: AI cepat(400ms) target 900 -> tunggu sampai 900 (delay 500), timer terpakai
PASS: AI lambat(1500ms) target 900 -> langsung, delay=0, tak ada timer, tak over-target
PASS: elapsed == target -> delay 0, langsung
PASS: tidak ada delay di atas target (cepat) maupun di atas arrival (lambat)
PASS: error path -> tak ada timer, tampil error langsung
PASS: dismissal gate {dismissedAt, installed, 7d window} sesuai (Tambahan)
ALL P-PWA.14/15 ALGORITHM ASSERTIONS PASSED
```

Memastikan logika P-PWA.14 (delay `max(targetDisplayMs - elapsed, 0)`, range 700–1300, error-immediate, unmount-clear) **tidak regression**, dan *dismissal gate* 7-hari `+` objek `{dismissedAt, installed}` berperilaku sesuai (override spec).

### 4.2 Smoke dev server

`npm run dev` → Vite `ready` di `:5174`:

```
GET http://localhost:5174/                       -> HTTP 200   (index.html dilayani, <link rel="manifest"> ada)
GET http://localhost:5174/manifest.json          -> HTTP 200   (manifest terjangkauan di origin root via public/)
GET http://localhost:5174/api/pwa/__nope__/init -> HTTP 404 {"error":"Store not found"} (proxy axios -> api:3000 + route slug resolve OK)
```

→ manifest terdeteksi oleh DevTools (file ada di origin root), SW register path `/sw.js` valid (asal di `public/`). Proxy + Web Adapter `pwa.ts:140` (`POST /message`) masih berfungsi (tidak disentuh).

---

## 5. Repro manual (untuk reviewer)

Karena environment ini tidak ada browser headless (Chromium tidak terpasang — lihat tolak P-PWA.12), validasi interaktif hanya dapat dilaporkan sebagai repro manual:

1. Build: `cd apps/pwa && npm run build`.
2. Preview: `npx vite preview` (atau serve `dist/`).
3. Buka di **Google Chrome (Android/desktop)**:
   - DevTools → **Application → Manifest**: seharusnya menampilkan nama `QloBot — Chat Toko`, `display: standalone`, warna, dan 2 icon (192 + 512). Tidak ada error validation.
   - DevTools → **Application → Manifest → "Install"**: tombol "Install" aktif saat manifest + SW terpenuhi.
   - DevTools → **Application → Service Workers**: `sw.js` terdaftar, status `activated`.
   - Ketik pesan → dapatkan balasan AI pertama → banner install **non-intrusive** muncul di bawah-layar; tombol ✕ menutup + menyimpan `{dismissedAt, installed:false}` (7 hari block); tombol **Pasang** memicu `beforeinstallprompt.prompt()`.
4. **iOS Safari** (iPhone): karena `beforeinstallprompt` tidak ada, banner hanya menampilkan teks instruksi manual ("Buka di browser, ketuk 'Tambah ke Beranda'"). **Tidak ada prompt otomatis.** (Dapat ditambahkan `<link rel="apple-touch-icon">` + `<meta name="apple-mobile-web-app-capable">` di `index.html` di task lanjutan bila mau dukungan iOS installer — luar cakupan P-PWA.15 karena Safari/iOS tidak membaca Web App Manifest.)

---

## 6. File yang berubah (hanya `apps/pwa` + DOCS)

```
apps/pwa/index.html            (+2: <meta name="theme-color">, <link rel="manifest">)
apps/pwa/src/main.tsx          (+: register Service Worker /sw.js on load)
apps/pwa/src/components/ChatPage.tsx (+: beforeinstallprompt listener, install banner,
                                    dismissal gate {dismissedAt, installed} 7 hari,
                                    trigger sekali after balasan AI pertama;
                                    P-PWA.14 typing/delay logic dipertahankan)
apps/pwa/public/manifest.json  (BARU)
apps/pwa/public/sw.js          (BARU)
apps/pwa/public/icons/icon-192.png (BARU — placeholder, harus diganti aset asli)
apps/pwa/public/icons/icon-512.png (BARU — placeholder, harus diganti aset asli)
DOCS/laporan-taskPWA15.md      (BARU)
```

---

## 7. Catatan / technical debt (lapor, tidak diperbaiki dalam task ini)

- `apps/api/.env` di repo-root masih ter-track (RAILS §6) — **tidak disentuh** pada task ini (P-PWA.15 frontend-only). Biarkan seperti adanya.
- Icon placeholder (lingkaran biru di atas putih) adalah **placeholder semata**; owner wajib ganti dengan aset logo vektor/raster asli (lihat rekomendasi §2.4), termasuk Apple touch icon 180×180 bila ingin dukungan iOS install.
- Trigger banner masih heuristik "balasan AI pertama"; presisi butuh sinyal backend `order.completed` / transaksi-selesai yang belum ada.
- Safari/iOS: belum ada `<link rel="apple-touch-icon">`/`apple-mobile-web-app-capable` (iOS tidak membaca manifest) — luar cakupan P-PWA.15 karena tidak support `beforeinstallprompt`; dapat ditambah di task lanjutan untuk dukungan "Tambah ke Beranda" iOS.
- SW hanya *pass-through* (tanpa offline cache) — disengaja, offline-capable = task terpisah.
