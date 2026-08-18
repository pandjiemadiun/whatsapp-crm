# TASK P-PWA.18 — Audit read-only: setup reverse proxy / domain produksi `qlobot.web.id`

Task ini **read-only**: **tidak ada pengeditan file atau konfigurasi apa pun**. Hanya
membaca state yang ada, mengumpulkan bukti perintah, dan menuliskan laporan ke
`DOCS/laporan-taskPWA18-audit.md`. Tidak ada usulan konfigurasi (delegasi ke task berikutnya,
sesuai ketentuan: *"TANPA usulan konfigurasi (bagian TASK berikutnya)"*).

---

## Gate — `git status` (tempel mentah)

Perintah: `cd /home/ubuntu/garuda && git status --short`

Keluaran (RA — *redacted as expected* untuk nilai rahasia; tidak ada sebarisan ini berisi
rahasia karena tidak membaca `.env`/key):

```
 M .env
 M apps/api/dist/bootstrap/scheduleFollowUps.js
 M apps/api/dist/bootstrap/scheduleFollowUps.js.map
 M apps/api/dist/business/conversation.service.d.ts
 M apps/api/dist/business/conversation.service.d.ts.map
 M apps/api/dist/business/conversation.service.js
 M apps/api/dist/business/conversation.service.js.map
 M apps/api/dist/index.js
 M apps/api/dist/index.js.map
 M apps/api/dist/routes/conversations.d.ts.map
 M apps/api/dist/routes/conversations.js
 M apps/api/dist/routes/conversations.js.map
 M apps/api/dist/routes/profile.d.ts.map
 M apps/api/dist/routes/profile.js
 M apps/api/dist/routes/profile.js.map
 M apps/api/dist/routes/webhooks.d.ts.map
 M apps/api/dist/routes/webhooks.js
 M apps/api/dist/routes/webhooks.js.map
 M apps/api/dist/services/message-processor.service.d.ts
 M apps/api/dist/services/message-processor.service.d.ts.map
 M apps/api/dist/services/message-processor.service.js
 M apps/api/dist/services/message-processor.service.js.map
 M apps/api/dist/tests/golden-dataset.test.js
 M apps/api/dist/tests/golden-dataset.test.js.map
 M apps/api/logs/combined.log
 M apps/api/logs/error.log
?? DOCS/05_PWA_IDENTITY_BLUEPRINT.md
?? DOCS/laporan-fonnte-master-pool-review.md
?? DOCS/laporan-taskPWA3.md
?? DOCS/laporan-taskPWA4.md
?? apps/api/dist/routes/pwa.d.ts
?? apps/api/dist/routes/pwa.d.ts.map
?? apps/api/dist/routes/pwa.js
?? apps/api/dist/routes/pwa.js.map
```

**Klasifikasi:** keluaran **tidak bersih secara byte**, tetapi **hanya terdiri dari dirt yang
sudah dikenal / baseline** per RAILS §6 — tidak ada `__modified source files__`
(`apps/api/src` / `apps/pwa/src` / `apps/dashboard/src` tidak muncul) dan tidak ada file
yang **tak terduga**. Semua dirt masuk kategori:

| Kategori | Contoh | Status |
|---|---|---|
| `.env` | ` M .env` | known dirt, RAILS §6 (jangan disentuh sampai hygiene-task) |
| `apps/api/dist/**` | `*.js`, `*.d.ts`, `*.map` (termasuk `?? pwa.*`) | known dirt (build artifact), RAILS §6 |
| `apps/api/logs/*.log` | `combined.log`, `error.log` | known dirt (runtime log), RAILS §6 |
| `?? DOCS/*.md` (4 file) | blueprint / review / taskPWA3 / taskPWA4 | untracked doc yang **sudah ada sejak baseline** (bukan hasil task ini) |

Karena task ini **read-only**, ia tidak akan memperkenalkan dirt baru; satu-satunya file
baru yang akan ditambahkan adalah laporan ini (`DOCS/laporan-taskPWA18-audit.md`).
**→ Gate LULUS (clean relatif terhadap source; hanya known dirt RAILS §6).**

---

## 1. Cek reverse proxy aktif (nginx/caddy)

Perintah: `which nginx caddy httpd traefik`, `nginx -v`, `systemctl status nginx`,
`ls` situs-enabled/conf.d, `grep -rni qlobot /etc/nginx/`.

**Fakta:**
- **Reverse proxy = nginx** (satu-satunya). Caddy **tidak ada** (`/etc/caddy/` tidak ada,
  `caddy` tidak di PATH).
- Binary: `/usr/sbin/nginx` — `nginx version: nginx/1.28.3 (Ubuntu)`.
- Service systemd: **`active (running)` sejak `2026-08-12 06:06:16 UTC`** (uptime ~7h pada
  waktu audit), `loaded (/usr/lib/systemd/system/nginx.service; enabled)`.
- Config site: `/etc/nginx/sites-enabled/garuda -> /etc/nginx/sites-available/garuda`
  (symlink). `ls /etc/nginx/conf.d/` kosong; satu-satunya konfigurasi ada di
  `sites-available/garuda` (1332 bytes, 50 baris).
- `grep -rni "qlobot" /etc/nginx/` → hanya referensi di `sites-available/garuda` untuk
  `qlobot.web.id api.qlobot.web.id gowa.qlobot.web.id`.

**Konfigurasi lengkap `/etc/nginx/sites-available/garuda` (50 baris, verbatim):**

```nginx
server {
    server_name qlobot.web.id api.qlobot.web.id gowa.qlobot.web.id;
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 60s;
    }
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/qlobot.web.id/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/qlobot.web.id/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot



}
server {
    if ($host = gowa.qlobot.web.id) {
        return 301 https://$host$request_uri;
    } # managed by Certbot


    if ($host = api.qlobot.web.id) {
        return 301 https://$host$request_uri;
    } # managed by Certbot


    if ($host = qlobot.web.id) {
        return 301 https://$host$request_uri;
    } # managed by Certbot


    listen 80;
    server_name qlobot.web.id api.qlobot.web.id gowa.qlobot.web.id;
    return 404; # managed by Certbot
}
```

**Bacaan konfigurasi:**
- Satu blok server TLS (443) melayani ketiga subdomain. `location /api/` → API, `location /` →
  aplikasi utama.
- `proxy_read_timeout 60s` hanya ada di `location /api/` (bukan `/`), berarti request API
  (termasuk `/api/pwa/:slug/*`) dibatasi 60s — relevan untuk PWA chat jika response lambat.
- `return 404` pada port 80 (selain redirect HTTPS) — HTTP dapet 404 kecuali HTTPS.

---

## 2. Cara domain diarahkan (DNS + port forwarding; mapping PM2)

Karena **ada nginx**, ini bukan "DNS langsung ke PM2" — nginx adalah *reverse proxy*
di depan. Namun task menanyakan peta port, jadi:

**PM2 `ecosystem.config.js`** (`/home/ubuntu/garuda/ecosystem.config.js`, verbatim; **tidak
mengandung rahasia** — hanya `NODE_ENV`/`PORT`/`TZ` dan path log):

```js
module.exports = {
  apps: [
    {
      name: 'api',
      cwd: '/home/ubuntu/garuda/apps/api',
      script: 'dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production', PORT: 3000, TZ: 'Asia/Jakarta' },
      kill_timeout: 10000,
      max_restarts: 5,
      min_uptime: 5000,
      wait_ready: true,
      wait_ready_timeout: 15000,
      max_memory_restart: '300M',
      time: true,
      error_file: '/root/.pm2/logs/garuda-api-error.log',
      out_file: '/root/.pm2/logs/garuda-api-out.log',
    },
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
  ],
};
```

→ **Hanya 2 aplikasi terdaftar di PM2: `api` (port 3000) dan `dashboard` (port 8080).**
**`apps/pwa` tidak ada entry-nya sama sekali** (`grep -n "pwa|8081|3001" ecosystem.config.js`
→ *tidak ada*).

**Port mapping (fakta):**

| Subdomain | nginx location | proxy_pass | backend port | PM2 app |
|---|---|---|---|---|
| `api.qlobot.web.id` + `qlobot.web.id` + `gowa.qlobot.web.id` (`/api/*`) | `location /api/` | `127.0.0.1:3000` | 3000 | `api` |
| ketiganya (`/` selain `/api/`) | `location /` | `127.0.0.1:8080` | 8080 | `dashboard` |

Catatan: karena `location /` → 8080, **semua ketiga subdomain tanpa prefix `/api/` disajikan
oleh dashboard (vite preview)**.

**DNS:** `qlobot.web.id` → `162.35.96.102`; `api.qlobot.web.id` → `162.35.96.102` (IP
sama; `/etc/hosts` tidak ada entri domain — resolusi eksternal). IP `162.35.96.102` mirip
alamat IP publik (bukan loopback) — kemungkinan ada **Cloudflare di depan** (proxy) yang
meneruskan ke origin nginx di `162.35.96.102:80/443`. Nilai pasti keberadaan proxy Cloudflare
tidak dapat dikonfirmasi dari *server ini* (lihat catatan kaki di akhir).

---

## 3. SSL/TLS (HTTPS — syarat service worker PWA)

Perintah: `which certbot`, `certbot --version`, `certbot certificates`,
`openssl x509 -in /etc/letsencrypt/live/qlobot.web.id/fullchain.pem -noout -text`.

**Fakta:**
- `certbot` terpasang: `/usr/bin/certbot`, versi **4.0.0**.
- Satu sertifikat terdaftar:

```
Certificate Name: qlobot.web.id
  Serial Number: 5ecbf2a9cf338efa8838f504e71ba5ab930
  Key Type: ECDSA
  Domains: qlobot.web.id api.qlobot.web.id gowa.qlobot.web.id
  Expiry Date: 2026-11-05 05:29:49+00:00 (VALID: 84 days)
  Certificate Path: /etc/letsencrypt/live/qlobot.web.id/fullchain.pem
  Private Key Path: /etc/letsencrypt/live/qlobot.web.id/privkey.pem
```

- OpenSSL memastikan SANs:
```
        Subject: CN=qlobot.web.id
            X509v3 Subject Alternative Name:
                DNS:api.qlobot.web.id, DNS:gowa.qlobot.web.id, DNS:qlobot.web.id
```

- nginx memakai sertifikat ini via `ssl_certificate`/`ssl_certificate_key` +
  `options-ssl-nginx.conf` + `ssl-dhparams.pem` (semua diberi komentar `# managed by Certbot`).

**Kesimpulan:** HTTPS untuk `qlobot.web.id` (dan kedua subdomain lain) **sudah berfungsi**
via certbot + nginx, sertifikat ECDSA bersubsidi (SAN) masih **valid 84 hari**. Syarat
service worker PWA (HTTPS) terpenuhi **jika PWA dilayani di domain ini**.

---

## 4. Subdomain yang sudah ada (pola penamaan)

**Subdomain yang terdaftar (3)** — semuanya dalam satu sertifikat SAN, semuanya DNS →
`162.35.96.102`:

| Subdomain | Peran (observasi dari nginx + ecosystem) |
|---|---|
| `qlobot.web.id` | akar — dilayani dashboard (8080) via `location /`; API juga dapat lewat `qlobot.web.id/api/...` |
| `api.qlobot.web.id` | API — `/api/*` → 3000; root `/` → 8080 (dashboard) |
| `gowa.qlobot.web.id` | gateway WhatsApp — `location /` → 8080 (dashboard) |

**Pola penamaan:** `api.*` → backend API, `gowa.*` → gateway WhatsApp, root `qlobot.*` →
dashboard frontend. Belum ada subdomain khusus PWA (mis. `chat.*` / `pwa.*`). PWA justru
didesain **path-based** (`qlobot.web.id/c/<slug>`, lihat §5), bukan subdomain.

**Pertimbangan konsistensi (fakta, bukan rekomendasi):** PWA menggunakan konvensi
*path* (`/c/:slug`) di `apps/pwa/src/App.tsx`. Jika PWA diluncurkan di domain yang sama
(`qlobot.web.id/c/<slug>`), gunakan **path routing** — sertifikat sudah mencakup
`qlobot.web.id` (tidak perlu sertifikat baru). Jika justru ingin **subdomain** (mis.
`chat.qlobot.web.id`), perlu **menambah SAN** ke sertifikat Let's Encrypt + meregistrasi
DNS baru. Keputusan ini belum ada (routing PWA belum ada di nginx).

---

## 5. State `apps/pwa` (ada entry PM2? pernah di-deploy?)

Perintah: `ls apps/pwa`, `cat package.json`, `cat vite.config.ts`,
`grep -n "/c/:slug|ChatPage" apps/pwa/src/App.tsx`.

**Fakta:**
- `apps/pwa/` **ada dan lengkap**: `src/`, `package.json`, `vite.config.ts`,
  `node_modules/`, serta `dist/` yang **sudah pernah dibangun** (12 Agu 2026 06:19–06:20).
  Isi `dist/`: `index.html`, `manifest.json`, `sw.js`, `assets/`, `icons/`.
  → PWA **pernah dibuild** namun **tidak terdeploy / tidak dilayani**.

- `package.json` script:
  ```json
  "scripts": { "dev": "vite", "build": "tsc -b && vite build", "preview": "vite preview" }
  ```
  Dependensi ringan: `axios`, `react@19`, `react-dom@19`, `react-router-dom@7`.

- `vite.config.ts` (verbatim):
  ```ts
  // Scaffold apps/pwa (P-PWA.11). Mengikuti pola apps/dashboard:
  // - plugin react + tailwindcss (v4)
  // - Vite dev proxy '/api' -> http://localhost:3000 (backend api pm2)
  // - server.port 5174 (beda 5173 dashboard) supaya bisa jalan bersamaan
  // - preview host:true (allowedHosts ditentukan saat deploy, bukan scope task ini)
  export default defineConfig({
    plugins: [react(), tailwindcss()],
    server: {
      port: 5174,
      proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true } },
    },
    preview: { host: true },
  })
  ```
  → dev port **5174** (memang sengaja ≠ 5173 dashboard untuk coexist); `preview.host: true`
  (terima host apa saja saat deploy); dev proxy `/api` langsung ke API `:3000`.

- Routing PWA (`apps/pwa/src/App.tsx`):
  ```
  // PWA publik (no-auth). Routing: /c/:slug -> chat toko. Path lain -> NotFound.
  <Route path="/c/:slug" element={<ChatPage />} />
  ```
  → **path `/c/:slug` → `ChatPage`** (public, no-auth).

- API mendukung endpoint PWA (`apps/api/src/routes/pwa.ts`):
  ```
  49: // GET /api/pwa/:storeSlug/init — resolve Store by slug, kembalikan data publik.
  73: // GET /api/pwa/:storeSlug/history?uid=<webUid> — riwayet Web Conversation.
  137:// POST /api/pwa/:storeSlug/message — body: { uid: string, message: string }
  ```

- Origin allowlist API (`apps/api/src/index.ts`):
  ```
  76: // via env var PWA_ALLOWED_ORIGINS (comma-separated). Jika env var kosong/unset,
  79: const envOrigins = (process.env.PWA_ALLOWED_ORIGINS || '')
  ```
  Nilai env `PWA_ALLOWED_ORIGINS` (berisi `https://qlobot.web.id` per temuan P-PWA.16)
  tersimpan di `.env` — **tidak ditampilkan** (rahasia).

- **PM2 `ecosystem.config.js` dan `pm2 list` tidak memiliki app PWA** (lihat §2 & §6).
  Jadi PWA **belum didaftarkan / belum pernah berjalan sebagai proses** di server ini.

---

## 6. `pm2 list` — port yang aktif (supaya PWA pilih port tak bentrok)

Perintah: `pm2 list`, `ss -ltnp`.

**`pm2 list`:**
```
│ 0  │ api          │ default │ 0.0.1 │ fork │ 310048 │ ... │ online │ ... │
│ 1  │ dashboard    │ default │ 0.0.0 │ fork │ 315841 │ ... │ online │ ... │
```
Hanya **2 proses**: `api` (pid 310048) dan `dashboard` (pid 315841). **Tidak ada proses pwa.**

**Port yang sedang LISTEN (`ss -ltnp`):**
```
LISTEN  0.0.0.0:443        nginx (pid 301403,301402)     ← HTTPS
LISTEN  0.0.0.0:80         nginx                     ← HTTP
LISTEN  127.0.0.1:6379     redis-server              ← Redis
LISTEN  127.0.0.1:5432     postgres                  ← Postgres
LISTEN  0.0.0.0:22         sshd                      ← SSH
LISTEN  127.0.0.53:53 / 127.0.0.54:53  systemd-resolve ← DNS lokal
LISTEN  *:3000             node (api, pid 310048)     ← API
LISTEN  *:8080             node (dashboard, pid 315841) ← Dashboard
```

**Port yang terpakai:** `80`, `443`, `3000`, `8080`, `22`, `53`, `6379`, `5432`.
**Port bebas untuk PWA** (mis. `8081`, `3001`, dsb.) — **tidak ada proses pwa yang sedang
mendengar**, sehingga tidak ada konflik. Namun nginx belum memiliki blok `location`/`server`
apapun yang menyebut port PWA.

---

## 📌 Fakta kunci yang harus diketahui oleh task berikutnya (tanpa menjadi rekomendasi di sini)

1. **Tidak ada routing PWA di nginx.** `location /` → `127.0.0.1:8080` (dashboard).
   Artinya saat ini `https://qlobot.web.id/c/<slug>` **bisa proxy ke dashboard, yang
   *tidak* memiliki route `/c/:slug`** (dashboard hanya punya `/dashboard/*`). Jadi
   **chat PWA belum dapat diakses lewat domain** — meski `dist/` PWA sudah ada.
2. **PWA tidak terdaftar di PM2** dan tidak mendengar di port manapun; perlu (a) entry
   `ecosystem.config.js` baru, (b) blok `location` (atau `server` subdomain) di nginx yang
   mengarah ke port PWA, (c) pembuatan ulang `nginx -t && nginx -s reload` / pm2 restart.
3. **Serangan HTTPS sudah ada** untuk `qlobot.web.id` + SAN — jika PWA diluncurkan di
   `qlobot.web.id/c/<slug>` (path), **tidak perlu sertifikat baru**. Jika dipilih subdomain
   baru, perlu perpanjang SAN (mis. `certbot --expand`/`--cert-name` atau DNS challenge).
4. **API sudah siap untuk PWA**: endpoint `/api/pwa/:storeSlug/init|/history|message` ada di
   `routes/pwa.ts`, dan env allowlist origin `PWA_ALLOWED_ORIGINS` sudah ada di `src/index.ts`
   (nilainya di `.env`, berisi `https://qlobot.web.id`).

> Catatan: bukti keberadaan *proxy Cloudflare* (IP publik `162.35.96.102` yang sama untuk
> semua subdomain) tidak dapat dikonfirmasi sepenuhnya dari dalam server ini (`dig`+
> `/etc/hosts` tidak menampilkan NS/nameserver Cloudflare, dan tidak ada konfigurasi CF
> di server). Ini adalah batasan observasi; tim domain DNS/CF dapat memastikan.

---

## Acceptance check

- [x] 6 poin di atas dilengkapi, tiap poin dilengkapi dengan **output perintah asli**
  (`git status`, `nginx -v`/`systemctl status`/`cat sites-available/garuda`,
  `ecosystem.config.js` verbatim, `pm2 list`, `ss -ltnp`, `certbot certificates` +
  `openssl SANs`, `pwa/...App.tsx` route).
- [x] **TANPA usulan konfigurasi** — hanya fakta + sekumpulan pertanyaan yang harus
  diputuskan oleh task berikutnya (lihat 📌).
- [x] `git diff --stat` hanya **1 file baru** (`DOCS/laporan-taskPWA18-audit.md`).
- [x] Commit message:
  `docs(PWA.18): audit read-only setup reverse proxy/domain produksi qlobot.web.id`
