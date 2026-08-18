# Laporan Task P-PWA.11 — Scaffold `apps/pwa` (Vite + React + Tailwind v4, koneksi API proxy, tanpa UI chat)

**Scope:** scaffold baru `apps/pwa/` (hanya file baru di dalamnya) + laporan ini.
**Tidak menyentuh** `apps/api` atau `apps/dashboard` sama sekali (bukti:
`git status --short apps/api/src apps/dashboard` = kosong; tidak ada source diff).
**Tidak ada UI chat/katalog** — hanya bukti koneksi (fetch `GET /api/pwa/:slug/init`
lalu render raw JSON).

Lingkungan: repo `/home/ubuntu/garuda`; `apps/api` API berjalan di `localhost:3000`
(pm2, pid `286707`, **tidak direstart / tidak terganggu** oleh task ini).
`apps/pwa` dev pada port `5174` (beda `5173` dashboard).

---

## Langkah 0 — Gate: git status

`git status --short` (mentah) — working tree tidak "bersih", **tapi tidak karena
task ini**:
```
 M .env                                  (non-secret test var PWA_ALLOWED_ORIGINS, hasil P-PWA.9; git-tracked)
 M apps/api/dist/**                      (build artifacts, git-tracked — RAILS §6 hygiene)
 M apps/api/logs/combined.log|error.log  (runtime logs, git-tracked — RAILS §6 hygiene)
?? DOCS/05_PWA_IDENTITY_BLUEPRINT.md     (pre-existing untracked, bukan artifact task ini)
?? DOCS/laporan-taskPWA3..4.md           (pre-existing untracked)
?? apps/api/dist/routes/pwa.*            (build output P-PWA.8, untracked)
?? apps/pwa/                             (yang baru dibuat task ini — diharapkan untracked)
```
- **Dirt yang sudah diketahui** (dist/logs/.env RAILS §6 + pre-existing docs) — semua
  **bukan** dari `apps/pwa`/`apps/api/src`/`apps/dashboard/src`.
- **Verifikasi kunci:** `git status --short apps/api/src apps/dashboard` → **kosong**
  (src dashboard & api bersih, tidak tersentuh). `apps/pwa/` adalah satu-satunya
  penambahan task ini.
- Task ini **read-only terhadap apps/api & apps/dashboard** (hanya data dummy
  throwaway di DB + throwaway script, dibersihkan). Karena tidak ada *source edit*
  di repo yang sudah ada, tidak ada conflation. **Dilanjutkan.**

---

## Langkah 1 — Scaffold (ikuti pola `apps/dashboard`)

### Struktur folder akhir `apps/pwa` (`find -maxdepth 3`, tanpa node_modules/dist/.git)
```
apps/pwa/
  package.json             package-lock.json
  vite.config.ts           .gitignore
  tsconfig.json            tsconfig.app.json         tsconfig.node.json
  index.html
  src/
    main.tsx               App.tsx                   index.css
    services/
      api.ts
```

### `package.json` (deps, scripts, versions terpasang)
```json5
"scripts": {
  "dev": "vite",
  "build": "tsc -b && vite build",
  "preview": "vite preview"
}
"dependencies": {
  "axios": "^1.18.1",
  "react": "^19.2.7",          // terpasang 19.2.8
  "react-dom": "^19.2.7",
  "react-router-dom": "^7.18.1" // routing
}
"devDependencies": {
  "@types/node": "^24.13.2",   // ditambah (lihat di bawah)
  "@types/react": "^19.2.17",
  "@types/react-dom": "^19.2.3",
  "@vitejs/plugin-react": "^6.0.4",
  "@tailwindcss/vite": "^4.3.3",
  "tailwindcss": "^4.3.3",
  "typescript": "~6.0.2",      // terpasang 6.0.3
  "vite": "^8.1.5"             // terpasang 8.2.1
}
```
- Versi (terpasang via `npm install`): React `19.2.8`, Vite `8.2.1`,
  Tailwindcss `4.3.3`, TypeScript `6.0.3`, axios `1.19.0`.
- **Tidak ada** `playwright` / `oxlint` (opsional, dilewati per task:
  "TIDAK perlu playwright/oxlint kecuali mau konsisten (opsional, boleh skip)").
- **Tidak ada** `state-management lib` (redux/zustand) — state pola React Context
  (lihat dashboard), tidak dipakai di scaffold ini.
- **Tidak ada** field `engines` / `.nvmrc` (lihat poin 7).

### `vite.config.ts` (mirror dashboard: port 5174, proxy /api→3000)
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,                       // beda dashboard (5173) — jalan bersamaan
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: true,
    // allowedHosts: [...] — ditentukan saat deploy (bukan scope P-PWA.11)
  },
})
```
- Port dev **5174** (beda 5173 dashboard → tak bentrok saat keduanya jalan).
- Proxy `/api → http://localhost:3000` persis seperti dashboard (`vite.config.ts:8-13`).

### `tsconfig*.json` (mirror dashboard — composite refs)
- `tsconfig.json`: `files:[]` + `references: [{path:./tsconfig.app.json},{path:./tsconfig.node.json}]`
- `tsconfig.app.json`: `target:es2023`, `lib:[ES2023,DOM]`, `module:esnext`,
  `moduleResolution:bundler`, `noEmit:true`, `jsx:react-jsx`, `noUnusedLocals/Parameters:true`.
- `tsconfig.node.json`: `"types":["node"]`, `module:nodenext`, `include:["vite.config.ts"]`.

### Tailwind v4 (CSS-based, seperti dashboard)
`src/index.css`:
```css
@import "tailwindcss";
@custom-variant dark (&:where(.dark, .dark *));
@theme { --color-brand: #1B53F5; }
```
- `@import "tailwindcss"` + `@custom-variant` + `@theme` → **Tailwind v4** (bukan v3;
  tidak ada `tailwind.config.*`). Pipeline lewat plugin `@tailwindcss/vite`.

### `src/services/api.ts` — axios, `baseURL: '/api'`, **TANPA interceptor auth**
```ts
import axios from 'axios'
const api = axios.create({ baseURL: '/api', headers: { 'Content-Type': 'application/json' } })
export default api
```
- **Polos** (beda dashboard yang ada interceptor `Authorization: Bearer` dari
  `localStorage.garuda_user`). PWA publik/no-auth → tidak perlu token.
- `baseURL: '/api'` relatif → dev via Vite proxy (`localhost:3000`), prod same-origin
  (host `qlobot.web.id` → `/api` ke backend). **Tidak ada `VITE_*`/`import.meta.env`**
  (grep `src/` kosong) — konsisten dashboard.

### `src/App.tsx` — pembukti koneksi (fetch + raw JSON, BUKAN UI akhir)
```tsx
import { useEffect, useState } from 'react'
import api from './services/api'
const STORE_SLUG = 'pwa11-e2e-test'
// api.get(`/pwa/${STORE_SLUG}/init`)  -> baseURL '/api' -> /api/pwa/:slug/init
```
Render: `loading` state → `{JSON.stringify(data)}` atau error di `<pre>`.

### `src/main.tsx` (mirror dashboard)
```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'; import App from './App'
createRoot(document.getElementById('root')!).render(<StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>)
```

---

## Catatan build: `@types/node` ditambah (perbaikan kecil)
`tsconfig.node.json` memakai `"types": ["node"]` (mirror dashboard). Pada build pertama,
`tsc -b` error:
```
error TS2688: Cannot find type definition file for 'node'.
  Entry point of type library 'node' specified in compilerOptions
```
Akibat `@types/node` belum terpasang (dashboard punya `@types/node ^24.13.2` di
devDeps). **Fix:** tambahkan `@types/node: ^24.13.2` ke `devDependencies` + `npm install`
(menginstal 2 package). Setelah itu `tsc -b` lulus. Versi terpasang: TypeScript
`6.0.3` (setara dashboard `~6.0.2`). Ini **hanya** dev-type dependency, tidak
menyentuh source/logic.

---

## Langkah 2 — Bukti koneksi jalan (bukan UI final)

`App.tsx` melakukan `api.get('/pwa/pwa11-e2e-test/init')` (baseURL `/api`) dan
menampilkan `JSON.stringify(res.data)` mentah di `<pre>`. Bukti koneksi melalui
**Vite dev proxy** (`localhost:5174` → `localhost:3000`) diberikan di §3.5.

---

## Langkah 3 — Validasi (acceptance RAILS §5)

### 3.1 `npm install` sukses
```
added 2 packages, and audited 74 packages in 1s
found 0 vulnerabilities   (exit 0)
```
(Dua paket tambahan = `@types/node` + dependensinya.)

### 3.2 `npm run dev` → jalan di port 5174, tidak crash
```
 VITE v8.2.1  ready in 580 ms
 ➜  Local:   http://localhost:5174/
 ➜  Network: use --host to expose
```

### 3.3 `tsc --noEmit -p tsconfig.app.json` → **0 error**
```
tsc --noEmit exit: 0
```

### 3.4 `npm run build` (`tsc -b && vite build`) → **sukses, hasilkan `dist/`**
```
> pwa@0.0.0 build
> tsc -b && vite build
vite v8.2.1 building client environment for production...
✓ 78 modules transformed.
dist/index.html                   0.38 kB │ gzip:  0.26 kB
dist/assets/index-B2dIVjm1.css    5.41 kB │ gzip:  1.84 kB
dist/assets/index-BaIT9qGn.js   275.54 kB │ gzip: 90.56 kB
✓ built in 714ms
build exit: 0
```
`dist/` (git-ignored oleh `.gitignore`) berisi `index.html` + `assets/*`.

### 3.5 E2E — dummy store + permintaan melewati proxy
Dummy store dibuat (data-only, throwaway script) slug `pwa11-e2e-test`:
```
STORE_CREATED={"id":"b2475659-e733-4fd2-a50c-b27d033b3019","slug":"pwa11-e2e-test","name":"PWA11 E2E Test Store"}
```
Permintaan **dari dev server PWA (5174) yang dialihkan lewat Vite proxy ke API (3000)** —
ini jalur yang sama `api.get('/pwa/:slug/init')` di `App.tsx` gunakan:
```
curl http://localhost:5174/api/pwa/pwa11-e2e-test/init
```
Respons **HTTP 200** + JSON (hanya field publik — **tidak ada** `phoneNumber`,
`whatsappPhoneId`, `fonnteToken`, `fonnteNumber`, `webhookSecret`, `email`):
```json
{ "success": true, "data": { "store": { "name":"PWA11 E2E Test Store", "slug":"pwa11-e2e-test",
  "profilePhotoUrl":null, "description":null, "businessCategory":null, "address":null,
  "timezone":"Asia/Jakarta", "operatingHours":null, "acceptsQris":false, "acceptsCod":false,
  "acceptsTransfer":false, "qrisImageUrl":null, "shippingMode":"pickup",
  "shippingFlatInCity":null, "shippingFlatOutCity":null, "isActive":true } } }
```
- App shell juga terlayani: `curl http://localhost:5174/` → HTML `<title>PWA</title>`,
  `<div id="root"></div>`, `<script type="module" src="/@vite/client">`.
- **Artinya** chain lengkap berfungsi: Vite dev (5174) → proxy `/api` → API pm2
  (3000) → router `pwa.ts` → `prisma.store.findUnique({slug, select:public})` → DB.

Cleanup dummy (throwaway script, data-only):
```
CLEANUP before=1 deleted=1 after=0
CLEANUP_OK
```
Script throwaway (`pwa11-setup.ts`, `pwa11-cleanup.ts`, letak `apps/api/`, tidak
di-`src/`) sudah **dihapus**; tidak tersimpan di git.

### 3.6 `git diff --stat` — **HANYA file baru di `apps/pwa/`
```
?? apps/pwa/   (seluruh isi — baru)
```
`git status --short apps/api/src apps/dashboard` → **kosong** (tidak tersentuh).
Perubahan P-PWA.11 terbatas eksklusif pada `apps/pwa/` (ditambah `DOCS/laporan-taskPWA11.md`).

### 3.7 `apps/api` pm2 **online, tidak terganggu**
Sewaktu dev server `apps/pwa` (5174) berjalan & E2E, `apps/api` pm2 **tidak
direstart**:
```
│ 0 │ api │ fork │ pid 286707 │ uptime ~55m │ 72 ↺ │ online │
{"status":"ok","message":"All systems operational"}
```
(Scaffold `apps/pwa` hanya *mengkonsumsi* API lewat HTTP/proxy — tidak
menulis/merestart backend.)

---

## Acceptance tambahan

- **Struktur folder akhir** — lihat §1 (find -maxdepth 3 di atas).
- **Laporan** — file ini (`DOCS/laporan-taskPWA11.md`).

---

## Ringkasan commit

Stage **hanya**: seluruh isi `apps/pwa/` (kecuali `node_modules`/`dist` yang
git-ignored) + `DOCS/laporan-taskPWA11.md`.
```
git add apps/pwa/ DOCS/laporan-taskPWA11.md
git commit -m "feat(PWA.11): scaffold apps/pwa (Vite+React+Tailwind v4, koneksi API proxy, tanpa UI chat)"
```
Pesan commit: `feat(PWA.11): scaffold apps/pwa (Vite+React+Tailwind v4, koneksi API proxy, tanpa UI chat)`.

### Catatan produksi (.env asli)
Untuk menghidupkan / memperbarui `apps/pwa` di produksi, **tidak perlu** env var
baru — PWA publik **no-auth** (tidak pakai token). Satu-satunya kebutuhan backend
adalah **whitelist origin PWA** (`PWA_ALLOWED_ORIGINS`, lihat P-PWA.9) yang sudah
ada di root `.env` (`https://qlobot.web.id`). Deploy `apps/pwa` mengikuti pola
dashboard: `npm run build` → `vite preview --host --port <port>` via PM2 (port
bisa sama 8080 atau berbeda; `allowedHosts` di `vite.config.ts preview` harus
sisi `qlobot.web.id`).
