# Laporan Task P-PWA.9 — CORS whitelist origin produksi PWA (env var, bukan hardcode)

**Scope:** HANYA `apps/api/src/index.ts` (konfigurasi CORS) + dokumentasi
`apps/api/.env.example`. Tidak menyentuh route/logic lain; tidak menyentuh
messageProcessor / gateway WA / resolver schema. Lingkungan: repo
`/home/ubuntu/garuda`; API di `localhost:3000` (pm2, pid `286707`).

> ⚠️ P-PWA.9 **membutuhkan env var baru di-set manual di server production
> `.env` asli** sebelum PWA live: **`PWA_ALLOWED_ORIGINS`** (comma-separated).
> Lihat §5.

---

## Langkah 0 — Gate: git status

`git status --short` (mentah) pada awal task — working tree **tidak bersih**:
```
 M apps/api/dist/**           (build artifacts, git-tracked — RAILS §6 hygiene)
 M apps/api/logs/combined.log (runtime logs, git-tracked — RAILS §6 hygiene)
 M apps/api/logs/error.log    (runtime logs, git-tracked — RAILS §6 hygiene)
?? DOCS/05_PWA_IDENTITY_BLUEPRINT.md  (pre-existing untracked, bukan artifact task ini)
?? DOCS/laporan-taskPWA3.md           (pre-existing untracked)
?? DOCS/laporan-taskPWA4.md           (pre-existing untracked)
?? apps/api/dist/routes/pwa.*         (build output P-PWA.8, untracked)
```
- **Source tree (`apps/api/src/`) bersih** — tidak ada uncommitted source change
  yang menumpuk dari task sebelumnya (P-PWA.8 sudah di-commit pada `9782501`).
- Ketidak-bersihan bersumber **hanya** pada *build artifacts* `dist/**` +
  *runtime logs* `logs/*` (keduanya **git-tracked**, RAILS §6 hygiene debt yang
  sama seperti yang terjadi pada P-PWA.8). Ini adalah *known debt*, bukan
  source conflation. Berdasarkan preseden P-PWA.8 (commit hanya stage
  source+report, `dist`/`logs` dibiarkan unstaged), task dilanjutkan.
- **Poin penting baru (ditemukan P-PWA.9):** root `.env` juga **git-tracked &
  tidak di-gitignore** (`git ls-files .env` → `.env`; `git check-ignore .env`
  → not ignored). Berarti repo **sudah** memuat secrets (`DATABASE_URL`,
  `CLOUDFLARE_WORKER_TOKEN`, dst.) di riwayat — *pre-existing* hygine issue,
  **bukan** yang dibuat task ini, dan **di luar scope** ("HANYA index.ts").
  Task ini tidak akan `git add`/`.env`; perubahan `.env` hanya untuk *live
  test* (lihat §3.6) dan tetap **unstaged / tidak ter-commit**.

---

## Langkah 1 — Audit cepat konfigurasi CORS existing

Blok CORS di `apps/api/src/index.ts:75-78` (sebelum perubahan):
```ts
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:4173'],
  credentials: true,
}));
```
**Fakta:** sudah pakai **array whitelist statis** (hanya localhost dev).
**Tidak ada** mekanisme baca dari env var sama sekali — origin produksi PWA
(`qlobot.web.id`) saat ini **ditolak CORS**. Inilah gap yang diperbaiki P-PWA.9.

---

## Langkah 2 — Ubah ke env var + tambah origin produksi

### 2.1 `apps/api/src/index.ts` (hanya blok CORS)
Ganti static array → array yang **digabung** dari localhost dev (konstan, tak
pernah dihapus) + `PWA_ALLOWED_ORIGINS` (env, comma-separated). Pakai **array
form** (bukan function) agar semantik CORS tidak berubah: mencerminkan origin
yang termasuk whitelist, menolak (tanpa header `Access-Control-Allow-Origin`)
yang tak termasuk. **Tidak ada wildcard** (`*`). Jika env unset/kosong →
fallback hanya localhost (tidak pernah open).

```diff
 // Middleware JSON & CORS
 app.use(express.json());
+// CORS whitelist: localhost dev TETAP dipakai; origin produksi PWA ditambahkan
+// via env var PWA_ALLOWED_ORIGINS (comma-separated). Jika env var kosong/unset,
+// fallback hanya ke localhost (tidak pernah open/*). Lihat .env.example.
+const LOCALHOST_ORIGINS = ['http://localhost:5173', 'http://localhost:4173'];
+const envOrigins = (process.env.PWA_ALLOWED_ORIGINS || '')
+  .split(',')
+  .map((o) => o.trim())
+  .filter((o) => o.length > 0);
+const corsAllowedOrigins = [...new Set([...LOCALHOST_ORIGINS, ...envOrigins])];
 app.use(cors({
-  origin: ['http://localhost:5173', 'http://localhost:4173'],
+  origin: corsAllowedOrigins,
+  credentials: true,
 }));
```
- `new Set(...)` → dedup (mis. env kirim ulang localhost, atau duplikat).
- `credentials: true` **tetap** → cors **tidak boleh** memakai `*` (karena
  credential), sehingga whitelist eksplisit wajib — konsisten dengan desain.

### 2.2 `apps/api/.env.example` (tambahan; value = domain publik, bukan secret)
```diff
 R2_PUBLIC_BASE_URL=
+
+# ============================================
+# CORS — Web Adapter (PWA) origin whitelist
+# ============================================
+# Comma-separated daftar origin yang diperbolehkan mengakses endpoint publik
+# PWA (/api/pwa/*). Domain ini HARUS eksplisit (JANGAN pakai wildcard "*" —
+# wildcard tidak aman bila credentials:true). Set di server production .env asli
+# sebelum PWA diluncurkan; jika kosong/unset hanya localhost dev yang diizinkan.
+# Contoh nilai: https://qlobot.web.id,https://www.qlobot.web.id
+PWA_ALLOWED_ORIGINS=https://qlobot.web.id
```
- Nilai contoh `https://qlobot.web.id` adalah **domain publik** (bukan secret),
  jadi aman dimasukkan ke `.env.example`. Nilai **asli** (production) tetap harus
  diisi manual di `.env` server produksi (lihat §5).

> `.env.example` sudah **git-tracked** sebelumnya, sehingga perubahan ini masuk
> commit (sesuai acceptance §3.4: "index.ts (+.env.example)").

---

## Langkah 3 — Validasi (acceptance RAILS §5)

### 3.1 `tsc --noEmit` (cwd `apps/api`) → **0 error**
```
=== tsc --noEmit ===
tsc errors: 0
```

### 3.2 `npm run build` (`tsc`) → **exit 0**
`dist/index.js` mengandung logika `corsAllowedOrigins` (line 77, 79):
```
77:const corsAllowedOrigins = [...new Set([...LOCALHOST_ORIGINS, ...envOrigins])];
79:    origin: corsAllowedOrigins,
```

### 3.3 Full test suite (`npm run test:chat`) → **tidak ada regresi**
```
Test Suites: 2 failed, 21 passed, 23 total
Tests:       1 failed, 260 passed, 261 total
```
Identik dengan baseline (stashed src) dan dengan akhir P-PWA.8:
- 2 failed suites = `reasoning-v2.test.ts` + `engine-config-v2.test.ts`
  (pre-existing; RAILS §6: I-V2-6 label mismatch + circular-dep redisAdapter).
- 1 failed test = `✕ Validator reject terminal (low confidence) → fallback, llmCalls=1, JANGAN retry`
  (pre-existing, tidak berkaitan CORS).
- Suite chat **tidak** mengimport `index.ts`/CORS — perubahan 11 baris CORS
  tidak bisa memengaruhi test. ✅

### 3.4 `git diff --stat` (committed, `--cached`) → **HANYA index.ts + .env.example**
```
 apps/api/src/index.ts     | 11 ++++++++++-
 apps/api/.env.example     | 10 ++++++++++
 2 files changed, 20 insertions(+), 1 deletion(-)
```
(`dist/**`, `logs/*`, dan `.env` sengaja **tidak** di-stage; mereka tetap
unstaged/dirty sebagaimana P-PWA.8.)

### 3.5 `pm2 restart api` → **online, tidak crash-loop**
```
│ 0 │ api │ fork │ pid 286707 │ uptime 100s+ │ 72 ↺ │ online │ 0% │ 181.4mb │
```
`GET /api/health` → `{"status":"ok","message":"All systems operational"}`.

### 3.6 CORS manual test (live, `localhost:3000`) — `PWA_ALLOWED_ORIGINS=https://qlobot.web.id` (di-set di root `.env`)

Pengujian via `curl -H "Origin: <X>"` terhadap `/api/health` (200):

| Origin yang dikirim | Header `Access-Control-Allow-Origin` | Hasil |
|---|---|---|
| `https://qlobot.web.id` (prod, sudah di-env) | `https://qlobot.web.id` | ✅ Diizinkan, *reflected* |
| `http://localhost:5173` (dev existing) | `http://localhost:5173` | ✅ Tidak regresi |
| `https://evil.example.com` (acak, tak terdaftar) | *(tidak ada header)* | ✅ **Ditolak** (CORS block) |

Bukti (raw, dari `curl -D -`):
```
[https://qlobot.web.id]   HTTP/1.1 200 OK  Access-Control-Allow-Origin: https://qlobot.web.id
[http://localhost:5173]   HTTP/1.1 200 OK  Access-Control-Allow-Origin: http://localhost:5173
[https://evil.example.com] HTTP/1.1 200 OK   (tanpa header ACAO → ditolak browser)
```
- Origin yang dikirim **tepat** (exact match, `credentials:true` melarang `*`).
- Origin tak terdaftar **hilang ACAO-nya** → whitelist membatasi, bukan dekoratif.
- Origin produksi muncul **karena** env var — memperlihati desain *env var*
  bekerja (jika `PWA_ALLOWED_ORIGINS` tidak diset, `qlobot.web.id` akan ikut
  terblokir seperti `evil.example.com`).

---

## §5 — Kebutuhan env var di production (WAJIB dibaca owner)

✅ **Ya, harus di-set manual di `.env` asli server production sebelum PWA live.**

- **Nama var:** `PWA_ALLOWED_ORIGINS`
- **Format:** comma-separated, **eksplisit per origin** (tidak pernah wildcard `*`
  karena `credentials: true`).
- **Contoh:** `PWA_ALLOWED_ORIGINS=https://qlobot.web.id,https://www.qlobot.web.id`
- **Fallback aman:** jika tidak di-set / kosong → hanya `localhost:5173` &
  `localhost:4173` yang diizinkan (dev). Prod origin **akan terblokir** sampai
  var ini di-set.
- **Catatan file:** var ini **tidak boleh** hanya tersimpan di `.env.example` —
  `.env.example` ialah template; nilai **asli** production harus ada di
  `.env` yang diload pm2 (`dist/index.js` → `dotenv.config({ path: ../../../.env })`
  = `/home/ubuntu/garuda/.env`).
- **Diperhatikan:** root `.env` saat ini **git-tracked & tidak di-.gitignore**
  (pre-existing RAILS §6). Sebaagaimana tidak dalam scope task ini, tidak dilakukan
  `git rm --cached .env` di sini — ini harus diselesaikan tersendiri (tambahkan
  `.env` ke `.gitignore` + hapus dari index). Jangan sampai nilai production
  berakhir ter-commit.

---

## Known Limitations (diluar scope P-PWA.9, tidak diredesain)

1. **CORS hanya *allowlist* origin**, belum ada *preflight caching* (`maxAge`)
   / vary header tambahan — cukup untuk kebutuhan PWA saaat ini.
2. Root `.env` git-tracked (pre-existing) — lihat §5; rekomendasi pisahkan
  `.env` dari tracking di task higini terpisah.
3. `dist/**` dan `logs/*.log` git-tracked (pre-existing; RAILS §6 hygiene) —
  tidak disentuh/di-commit dalam task ini.
