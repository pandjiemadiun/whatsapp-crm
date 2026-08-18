# Laporan Task P-PWA.10 — Audit read-only struktur `apps/dashboard` (referensi scaffold `apps/pwa`)

**Scope:** HANYA baca & laporkan. **Tidak ada edit file source dan tidak ada file baru** kecuali laporan ini.
Lingkungan: repo `/home/ubuntu/garuda`; `apps/dashboard` ada & **src bersih**
(`git status --short apps/dashboard` = kosong). Node `v24.19.0`.

---

## Langkah 0 — Gate: git status (mentah)

`git status --short` penuh (pasting mentah):
```
 M .env
 M apps/api/dist/**         (build artifacts, git-tracked — RAILS §6 hygiene)
 M apps/api/logs/combined.log
 M apps/api/logs/error.log
?? DOCS/05_PWA_IDENTITY_BLUEPRINT.md     (pre-existing untracked)
?? DOCS/laporan-taskPWA3.md              (pre-existing untracked)
?? DOCS/laporan-taskPWA4.md              (pre-existing untracked)
?? apps/api/dist/routes/pwa.*            (build output P-PWA.8, untracked)
```
- **Working tree tidak "bersih"** — tapi **seluruhnya** build artifacts
  `dist/**`, runtime log `logs/*`, var env test non-secret `.env`
  (`PWA_ALLOWED_ORIGINS=https://qlobot.web.id`, hasil P-PWA.9), serta DOCS
  pre-existing yang tidak berkaitan.
- **Tidak ada source tree yang kotor/konflik dari task sebelumnya**:
  `apps/api/src/**` dan `apps/dashboard/src/**` tidak muncul di `git status`
  (clean).
- Ini adalah **audit read-only** — tidak ada edit source, sehingga tidak ada
  risiko *conflation* perubahan. Dirt yang ada adalah *known RAILS §6 hygiene
  debt* (dist/logs/.env git-tracked) yang sama seperti P-PWA.9; dibiarkan apa
  adanya, konsisten progres task sebelumnya.

---

## 1. Struktur folder `apps/dashboard` (find -maxdepth 4, tanpa node_modules/.git/dist)

Direktori utama: `src/` (dengan sub `assets/`, `components/{admin,analytics}`,
`contexts/`, `hooks/`, `lib/`, `pages/{admin}`, `services/`, `tests/{e2e,screenshots}`,
`types/`, `utils/`) + `public/`, `audit-visual/`, `dist/`.

Entry point & config level:
```
apps/dashboard/
  package.json            vite.config.ts              index.html
  tsconfig.json           tsconfig.app.json           tsconfig.node.json
  .gitignore              .npmrc                      .oxlintrc.json
  playwright.config.ts    playwright.verify.config.ts README.md
  public/favicon.svg      public/icons.svg
  src/main.tsx            src/App.tsx                 src/index.css
  src/services/api.ts     src/services/api_new.ts     src/services/adminApi.ts  src/services/magicPasteService.ts
  src/contexts/AuthContext.tsx      src/contexts/AdminAuthContext.tsx
  src/components/ProtectedRoute.tsx  src/components/admin/AdminProtectedRoute.tsx  src/components/DashboardLayout.tsx ...
  src/hooks/useDashboardMetrics.ts  src/hooks/useMagicPaste.ts  src/hooks/useMissionControl.ts ...
  src/pages/DashboardHome.tsx ... (admin+store pages) ... src/pages/admin/*
```
Temuan: komponen terkelompok jelas (components/pages/hooks/services/contexts).
Terdapat **duplikat `_new`** (`api_new.ts`) — lihat poin 5.

---

## 2. `package.json` — deps, devDeps, scripts

`apps/api/.../apps/dashboard/package.json` (35 baris):

**dependencies (runtime):**
```json5
"axios": "^1.18.1",
"lucide-react": "^1.27.0",
"react": "^19.2.7",
"react-dom": "^19.2.7",
"react-router-dom": "^7.18.1"
```
- **React 19.2.7** (React DOM 19.2.7).
- **Vite 8.1.5** (dev).
- **Tailwind `tailwindcss` ^4.3.3** + **`@tailwindcss/vite` ^4.3.3** → **Tailwind v4** (poin 4).
- **`axios` 1.18.1** = HTTP client.
- **`react-router-dom` 7.18.1** = routing (RRv7).
- `lucide-react` = ikon.
- **Tidak ada state-management library** (redux/zustand/jotai) — state pakai
  **React Context** (`AuthContext`, `AdminAuthContext`) + hooks (lihat poin 5).

**devDependencies:** `@playwright/test ^1.62.1` (e2e), `@vitejs/plugin-react ^6.0.4`,
`@types/*`, `oxlint ^1.71.0`, `typescript ~6.0.2`, `vite ^8.1.5`, `pg`/`@types/pg`
(SQL helper, tidak dipakai browser).

**scripts:**
```json5
"dev": "vite",            // vite dev server (port default 5173 — lihat poin 3)
"build": "tsc -b && vite build",
"lint": "oxlint",
"preview": "vite preview",
"test:e2e": "playwright test"
```
- **Tidak ada `engines`** → tidak ada constraint versi Node di package.json.

---

## 3. `vite.config.ts` — port, alias, plugin

`apps/dashboard/vite.config.ts` (20 baris), kutipan utuh:
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: true,
    allowedHosts: ['qlobot.web.id', 'api.qlobot.web.id'],
  },
})
```
- **Plugin:** `@vitejs/plugin-react` (SWC/Rollup React refresh) + `@tailwindcss/vite`
  (Tailwind v4 pipeline).
- **Port dev:** tidak ada field `server.port` → Vite **default 5173**.
- **Proxy dev:** `/api` → `http://localhost:3000` (API), `changeOrigin: true`.
  Ini **mechanisme utama** agar dashboard dev (`localhost:5173`) dapat ke API
  tanpa hardcode base URL — karena `api.ts` memakai `baseURL: '/api'` (relative).
- **Preview prod:** `host: true` (0.0.0.0), `allowedHosts: ['qlobot.web.id', 'api.qlobot.web.id']`
  → **domain produksi = `qlobot.web.id`** (dan subdomain api).
- **Alias:** **tidak ada** (`resolve.alias` absent; `tsconfig*.json` juga tak
  ada `paths`/`baseUrl`) — semua import relatif.

---

## 4. Konfigurasi Tailwind

**Tailwind v4.** Bukan konfigurasi. Bukti:
- `package.json` devDeps: `"@tailwindcss/vite": "^4.3.3"`, `"tailwindcss": "^4.3.3"`.
- Tidak ada file `tailwind.config.*` / `tailwind.config.js`/`ts` di mana saja
  (`find` tidak menemukannya) — *expected* untuk v4 (konfigurasi via CSS, bukan
  `tailwind.config.*`).
- `vite.config.ts:3` `import tailwindcss from '@tailwindcss/vite'` + `plugins: [react(), tailwindcss()]`.
- `src/index.css:2` `@import "tailwindcss";` (v4 CSS entry).
- `src/index.css:4` `@custom-variant dark (&:where(.dark, .dark *));`
- `src/index.css:6-24` `@theme { --font-sans: ...; --color-brand: #1B53F5; ... }`
  → custom properties diklaim di CSS (v4 style).

(v3 sebalumnya pakai `@tailwind base; @tailwind components; @tailwind utilities;`
di `index.css` + berkas `tailwind.config.{js,ts}` — **tidak** ada pola ini.)

---

## 5. Cara dashboard fetch ke backend API

File aktif: **`src/services/api.ts`** (di-import oleh semua halaman/komponen
hooks/contexts — `DashboardLayout`, `FonnteSettings`, `ConversationInbox`,
`AiSettings`, `KnowledgeManager`, `FaqManager`, `ProductsPage`, `OrderManager`,
`Login`, `ProfilePage`, `AnalyticsPage`, `DashboardHome`, `AuthContext`, dll.).

`src/services/api.ts` (40 baris), kutipan:
```ts
import axios from 'axios';                              // line 2
const api = axios.create({
  baseURL: '/api',                                       // line 4  — RELATIVE
  headers: { 'Content-Type': 'application/json' },
});
// Attach auth token from localStorage to every request
api.interceptors.request.use((config) => {               // line 9
  try {
    const stored = localStorage.getItem('garuda_user');  // line 11
    if (stored) {
      const user = JSON.parse(stored);
      if (user.token) {
        config.headers.Authorization = `Bearer ${user.token}`; // line 15
      }
    }
  } catch {}
  return config;
});                                                       // line 20
```
- **HTTP client:** `axios`.
- **Base URL:** **`'/api'` (relative/hardcoded)** — tidak ada `VITE_*` env var
  dan tidak ada `import.meta.env` di seluruh `src/` (grep konfirmasi kosong).
  Makna: di *dev*, Vite proxy `/api → localhost:3000` (`vite.config.ts:8-13`);
  di *prod*, dashboard dan API served same-origin (atau via reverse proxy) sehingga
  `/api` menembung ke API yang sama host-nya.
- **Auth token handling (admin):** interceptor kirim `Authorization: Bearer
  <token>` dari `localStorage.garuda_user.token`. 401 non-auth → hapus token +
  redirect `/`. (Ini pola **admin** — **tidak dipakai PWA publik**.)
- Admin API terpisah: `src/services/adminApi.ts` → `baseURL: '/api/admin'`,
  token dari `localStorage.garuda_admin`.
- **Duplikat:** `src/services/api_new.ts` (dan sepertinya `adminApi_new.ts`) adalah
  **salinan identik `api.ts` yang tidak di-import oleh mana pun**
  (`grep -rn "services/api_new"` → tidak ada importer) — *leftover refactor
  stub*. Untuk scaffold PWA gunakan `api.ts` (atau bikin versi tanpa auth
  interceptor).

**Implikasi untuk `apps/pwa`** (public, no-auth per blueprint §2):
- Gunaan pola yang sama: **axios + `baseURL: '/api'`** + Vite `/api`→localhost:3000
  proxy (vite.config) — **tapi lewati/strip interceptor `Authorization`** karena
  PWA publik tidak butuh token. (Auth untuk dashboard adalah concern terpisah.)

---

## 6. Cara deploy / jalankan production

`/home/ubuntu/garuda/ecosystem.config.js` (PM2) — dua app. Kutipan penuh blok
`dashboard`:
```js
{
  name: 'dashboard',
  cwd: '/home/ubuntu/garuda/apps/dashboard',
  script: 'node_modules/.bin/vite',
  args: 'preview --host --port 8080',
  instances: 1,
  exec_mode: 'fork',
  env: { NODE_ENV: 'production' },
  kill_timeout: 10000,
  max_restarts: 5,
  min_uptime: 5000,
  max_memory_restart: '300M',
  time: true,
  error_file: '/root/.pm2/logs/dashboard-error.log',
  out_file: '/root/.pm2/logs/dashboard-out.log',
},
```
dan blok `api` (untuk konteks):
```js
{ name: 'api', cwd: '/home/ubuntu/garuda/apps/api', script: 'dist/index.js',
  env: { NODE_ENV: 'production', PORT: 3000, TZ: 'Asia/Jakarta' }, ...
  out_file: '/root/.pm2/logs/garuda-api-out.log', ... }
```
Fakta:
- **Dashboard di-deploy via `vite preview --host --port 8080`** yang dijalankan
  PM2 (fork mode, `NODE_ENV=production`), logs di `/root/.pm2/logs/dashboard-*.log`.
  Berarti dashboard = **static build (`npm run build` → `dist/`) di-serve oleh
  `vite preview`** — bukan nginx, bukan serverless. Port 8080.
- `vite.config.ts` `preview: { host: true, allowedHosts: ['qlobot.web.id', 'api.qlobot.web.id'] }` →
  host public = `qlobot.web.id`; di production sepetinya ada reverse proxy
  (Cloudflare Tunnel / nginx) yang memetakan `qlobot.web.id` → `localhost:8080`
  (dashboard) dan path `/api` → `localhost:3000` (api).
- `.gitignore` dashboard: `dist`, `node_modules`, `logs`, `*.log` **di-ignore**
  (berbeda dengan `apps/api` yang `dist/`+`logs/` terlacak — RAILS §6).

---

## 7. Versi Node

- `node -v` → **`v24.19.0`**.
- **Tidak ada `.nvmrc`** di root, `apps/api`, atau `apps/dashboard`.
- Tidak ada field `engines` di `package.json` dashboard (atau API).
- `typescript ~6.0.2` (dashboard devDep) memerlukan Node ≥ 20.19 / 22+; `v24.19.0` kompatibel.
- **Implikasi `apps/pwa`:** gunakan Node yang sama dengan server (saat ini `v24.19.0`);
  tidak ada constraint eksplisit, tapi pastikan kompatibel dengan TypeScript
  target yang dipilih (Vite template memakai `target: "es2023"`, `module: "esnext"`,
  `moduleResolution: "bundler"` — lihat `tsconfig.app.json`).

---

## Fakta relevan untuk referensi scaffold `apps/pwa` (fakta, bukan rekomendasi desain)

- Stack yang sama tersedia: Vite 8, React 19.2.7, Tailwind v4.3.3 (`@tailwindcss/vite`),
  react-router-dom 7, axios 1.18.1, oxlint, TypeScript ~6.0.2.
- TS project: konfigurasi composite (`tsconfig.json` → refs ke `tsconfig.app.json`
  + `tsconfig.node.json`), `tsc -b && vite build`.
- Fetch layer aktif = `src/services/api.ts`: `axios.create({ baseURL: '/api' })`
  (relative/hardcoded) + Vite dev proxy `/api → http://localhost:3000`
  (`vite.config.ts:8-13`). Tidak ada `VITE_*` env / `import.meta.env` di `src/`.
- Auth interceptor ada di `api.ts` (Bearer `localStorage.garuda_user`). PWA publik
  tidak memakai `garuda_user`/`garuda_admin` (no-auth per blueprint §2) — perbedaan
  fakta, bukan rekomendasi.
- Prod domain: `allowedHosts: ['qlobot.web.id', 'api.qlobot.web.id']`
  (`vite.config.ts:17`); origin ini juga harus masuk whitelist CORS backend
  (`PWA_ALLOWED_ORIGINS`, lihat P-PWA.9) agar request dari produksi tidak diblok.
- Serve prod: `vite preview --host --port 8080` via PM2 (`ecosystem.config.js`);
  `dist/` git-ignored (berbeda `apps/api` yang `dist/`+`logs/` terlacak / RAILS §6).
- Dev port default Vite = **5173** (tidak override di `vite.config.ts`).
- Node: tidak ada `.nvmrc`/`engines` di mana pun; server pakai **v24.19.0**.

---

## Known limitations / asumsi (audit read-only)

- `api_new.ts` / `adminApi_new.ts` adalah *unused duplicates* — tidak dipakai
  (tidak ada importer), kemungkinan leftover refactor; tidak dipertimbangkan sebagai
  pola aktif. Untuk scaffold PWA, fakta di atas berasal dari `api.ts`.
- Tidak ada dokumentasi deploy di README (`apps/dashboard/README.md` = boilerplate
  Vite template); seluruh fakta deploy berasal dari `ecosystem.config.js`.
- Koneksi domain→port (CF Tunnel/Nginx) tidak terlihat di repo (konfigurasi luar
  repo) — disimpulkan dari `allowedHosts` + port 8080 / 3000.
- Laporan ini **hanya fakta + kutipan kode + file:line**, tidak ada rekomendasi
  desain (sesuai scope audit read-only).
