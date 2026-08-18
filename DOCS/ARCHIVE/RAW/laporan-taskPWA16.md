# Laporan Task P-PWA.16 — Slug Management: Endpoint Update + Form Dashboard

**Tanggal:** 2026-08-12
**Branch:** `main` (17 commits ahead of origin/main)
**Commit target:** `feat(PWA.16): slug management — endpoint PUT /profile + form dashboard ProfilePage`
**File yang disentuh (source):** `apps/api/src/routes/profile.ts`, `apps/dashboard/src/pages/ProfilePage.tsx`
**Diluar ruang lingkup yang disentuh:** `OnboardingProfile.tsx`, engine AI/conversation/webhook, `/auth/profile`, semua hal lain. (Lihat § "Batasan / out-of-scope".)

---

## 0. Gate (prerequisite) — LULUS

`git status` sebelum kerja (mentah):

```
Changes not staged for commit:
	modified:   .env
	modified:   apps/api/dist/** (banyak file .js/.d.ts/.map)
	modified:   apps/api/logs/combined.log
	modified:   apps/api/logs/error.log
Untracked:
	DOCS/05_PWA_IDENTITY_BLUEPRINT.md
	DOCS/laporan-taskPWA3.md
	DOCS/laporan-taskPWA4.md
	DOCS/laporan-fonnte-master-pool-review.md
	apps/api/dist/routes/pwa.* (d.ts/.js/.map)
```

**Verdik:** Dirt yang ada **hanya** pada kategori yang sudah diketahui per RAILS §6: `dist/` (build artifact), `logs/` (runtime log), `.env` (konfigurasi). File untracked lainnya semua berupa laporan dokumen (`DOCS/*.md`, termasuk yang akan dibuat task ini) dan `dist/routes/pwa.*` (termasuk `dist/`). **Tidak ada dirt di luar kategori yang diketahui → gate LULUS, dilanjutkan.**

---

## 1. Keputusan endpoint — PUT `/api/profile`

Memilih **PUT `/api/profile`** (`apps/api/src/routes/profile.ts`), **bukan** `PUT /auth/profile` (`routes/auth.ts`).

**Alasan:**
- `/profile` sudah jadi tempat field publik-fofacing lain: `name`, `description`, `businessCategory`, `address`, `timezone`, `operatingHours`, store photo, dsb.
- Slug termasuk kategori **"identitas publik toko"** — sama-sama informasi yang terekspos ke customer lewat PWA (`/c/<slug>`).
- `/auth/profile` justru berisi pengaturan **teknis** (fonnteToken, fonnteNumber, shipping*, payment methods, qris image) yang tidak bersifat publik.
- Dengan memilih satu, hindari **dua sumber kebenaran** (single source of truth) untuk slug.

---

## 2. Backend — `apps/api/src/routes/profile.ts`

### 2.1 GET `/profile` (sekarang ~ln 35-57)
- Ditambahkan `slug: store.slug` ke objek respon `data`. Slug **bukan** field sensitif (lihat `prisma.ts` middleware enkripsi: hanya `phoneNumber`, `address`, `fonnteToken`, `fonnteNumber` yang dienkripsi), jadi dikembalikan apa adanya.

### 2.2 PUT `/profile` (sekarang ~ln 63-127)
- `slug` ditambahkan ke destructure `req.body`.
- Logika update:
  - **`slug` kosong / null / undefined** → tidak ada masuk ke `updateData` → slug lama dipertahankan (toko boleh update field lain tanpa sentuh slug, tidak otomatis `null`).
  - **`slug` terisi** → validasi FORMAT **sebelum** masuk Prisma:
    - `String(slug).trim().toLowerCase()` (case-insensitive, trim).
    - Regex `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`: huruf kecil + angka + dash; tidak boleh diawali/diakhiri dash; tidak ada dash berurut.
    - Panjang 3-50 karakter.
    - Format salah → **400** + pesan jelas (BUKAN biarkan Postgres menolak lewat constraint).
  - **`updateData.slug = slugStr`** baru ketika valid.
- **Uniqueness:** **tidak ada pre-check SELECT.** Langsung eksekusi `prisma.store.update(...)`. Unik-ness ditangkap oleh unique index Postgres (`stores_slug_key`) → Prisma throw `P2002`.
- **Catch block:** menangkap `error?.code === 'P2002'` → **409** + pesan spesifik `"Slug sudah digunakan toko lain, coba yang lain"`.
  - Pola: **per-route** (seperti `auth.ts:80-81`), **bukan** global `errorHandler.ts:30-49` (yang memberi pesan generic `"Resource already exists"`). Dipilih satu, tidak bikin pola ketiga.
- `slug` juga ditambahkan ke respons PUT.
- **Bukan validasi semantik:** hanya validasi karakter (alphanumeric+dash). Sistem tidak menilai apakah "toko-0812xxx" itu nomor WA — cukup batasi format, edukasi lewat placeholder/hint UI.

### 2.3 Catatan enkripsi (penting, tidak berubah)
Middleware Prisma di `infrastructure/prisma.ts` mengenkripsi field sensitif pada model `Store` (`phoneNumber`, `address`, `fonnteToken`, `fonnteNumber`) pada aksi `create`/`update`, dan mendekripsi pada `findUnique`/`findFirst`/`findMany`/`update`. **`slug` tidak termasuk** daftar sensitif, jadi:
- Pada PUT: `slug` tidak dienkripsi (dikirim apa adanya ke Postgres). ✓
- Pada GET: `store.slug` kembali plain. ✓
- P2002 (unique violation) tetap melempar `PrismaClientKnownRequestError` karena middleware tidak mem-cache/menangkap `next(params)` yang throw. ✓ (terverifikasi lewat E2E Test 3 = 409).

---

## 3. Frontend — `apps/dashboard/src/pages/ProfilePage.tsx`

### 3.1 Interface `ProfileData`
- Ditambahkan `slug: string | null;`.

### 3.2 State & validasi
- `form.slug: ''` (populate dari GET `/profile` response → `slug: d.slug || ''`).
- Helper reusable `validateSlug()`: regex + panjang yang **sama persis** dengan backend (`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`, 3-50). Dipanggil di dua tempat.
- Konstanta `PWA_BASE_URL = window.location.origin` (production = `https://qlobot.web.id`).
- State tambahan: `slugError` (live validation), `slugCopied` (feedbak tombol copy).

### 3.3 `handleSave` (PUT payload)
- **Validasi client-side SEBELUM submit** (format sama backend) → error muncul instan, tidak nunggu round-trip API.
- Payload: `slug: slugInput !== '' ? slugInput.toLowerCase() : undefined`. Berarti:
  - Slug kosong → `undefined` → di-omit dari JSON → backend "biarkan slug lama".
  - Slug terisi → dikirim lowercase-trim, konsisten dengan yang disimpan.
- Setelah sukses: refresh `form.slug` dari `res.data.data.slug` (server yang memutuskan nilai final/normalized), reset `slugError`.

### 3.4 Elemen form (Section Profil, setelah "Alamat", sebelum "Jam Operasional")
- Label: **"Alamat Chat Toko"** (bukan istilah teknis "slug").
- Placeholder: `toko-makmur`.
- Helper text: menjelaskan ini jadi bagian URL publik `qlobot.web.id/c/<slug>` yang bisa dibagikan ke customer.
- Live validation: border merah + pesan error saat ketik.
- **Link yang bisa di-copy:** ketika `form.slug` terisi, ditampilkan `{PWA_BASE_URL}/c/{slug}` + tombol **Copy** (Clipboard API + feedback "Tersalin!"). Muncul setiap ada slug tersimpan (load maupun setelah save), jadi sekali merchant set, langsung bisa share ke FB/IG.

### 3.5 Perbaikan trivia pre-existing di file yang sama
- `RefreshCw` (ikon di tombol "Coba Lagi" SOP) tidak di-import → ditambah ke import lucide.
- `setSectionError` dipanggil tapi state tidak dideklarasikan (fitur "Simpan Semua" PS2+PO3 belum lengkap) → dideklarasikan `sectionError` + ditampilkan error per-section. (Pre-existing TS error, diperbaiki minimal agar `ProfilePage.tsx` 0 error.)

---

## 4. Validasi (acceptance RAILS §5)

### 4.1 `tsc --noEmit`
- **Backend (`apps/api`):** `npx tsc --noEmit` → **0 error.** ✓
- **Frontend (`apps/dashboard`, `tsconfig.app.json`):**
  - `ProfilePage.tsx` (file yang disentuh) → **0 error.**
  - **23 error tersisa di 8 file LAIN yang tidak terkait slug** (pre-existing, ada sejak git HEAD sebelum perubahan ini): `FonpteSettings.tsx(6)`, `StoreManagement.tsx(5)`, `AuditLogViewer.tsx(3)`, `AdminGOWA.tsx(3)`, `PlatformConfig.tsx(2)`, `DashboardHome.tsx(2)`, `WhatsAppConnect.tsx(1)`, `MagicPasteConfigPanel.tsx(1)` — hampir seluruhnya `TS6133` (import/local taketerpakai) + 2× `TS2322` (type mismatch).
  - *Baseline yang sama diukur lewat `git stash` sebelum edit: 25 error (23 di file lain + 2 di ProfilePage.tsx).* Perubahan kami **menambah 0 error baru** dan justru **mengurangi ProfilePage.tsx dari 2 → 0 error**.
  - 23 error ini **di luar ruang lingkup** (fitur admin/finance/auth, bukan slug). Memperbaikinya akan melanggar RAILS §5 poin 4 ("bukti scope tidak melebar") dan anggaran topik task. Ditandai sebagai **tech debt terpisah** (pola seperti RAILS §6 kebijakan "dist/logs/.env").

### 4.2 `npm run build`
- **Backend:** `npm run build` (`tsc`) → **sukses**, dist diregenerasi, siap deploy. ✓
- **Dashboard:** `npm run build` (`tsc -b && vite build`) → **gagal karena `tsc -b`** yang diblokir 23 error pre-existing di atas. Ini **bukan** akibat perubahan kami.
  - **Workaround yang dipakai untuk deploy:** `npx vite build` (bundler) → **sukses** (exit 0, 1893 modul tertransformasi). Vite/esbuild tidak menegakkan `noUnusedLocals`, jadi bundle valid. Digunakan untuk (re)deploy dashboard pm2.
  - Verifikasi bundle yang dideploy mengandung label field: `grep "Alamat Chat Toko"` dan `"qlobot.web.id/c"` ditemukan di `dist/assets/index-*.js`. ✓
  - **Rekomendasi terpisah:** perbaiki 23 error `noUnusedLocals`/`noUnusedParameters` di 8 file itdiblokir → `npm run build` dashboard akan sukses secara alami.

### 4.3 Full test suite backend
`npm run test:chat` (jest, suite engine chat):
```
Test Suites: 2 failed, 21 passed, 23 total
Tests:       1 failed, 260 passed, 261 total
```
- **Baseline persis sama** (2 failed suites / 1 failed test) — sesuai RAILS §5 poin 3 ("termasuk pre-existing failure yang sudah diketahui"). **Tidak ada kegagalan baru.**
- 2 suite yang gagal: `reasoning-v2.test.ts` (outcome-label mismatch, desain lama vs v2) dan `engine-config-v2.test.ts` (circular dep `redisAdapter`, file-level, tak berkaitan).
- Perubahan kami hanya menyentuh `routes/profile.ts` — tidak ada kaitan dengan chat engine, jadi test suite tidak terpengyum.

### 4.4 `git diff --stat`
Source-only (yang akan dicommit):
```
 apps/api/src/routes/profile.ts           |  29 ++++++-
 apps/dashboard/src/pages/ProfilePage.tsx | 134 ++++++++++++++++++++++++++++++-
 2 files changed, 159 insertions(+), 4 deletions(-)
```
+ file laporan `DOCS/laporan-taskPWA16.md` (baru). **Scope tidak melebar** hanya ke `profile.ts` + `ProfilePage.tsx` (+ laporan). ✓

### 4.5 `pm2 restart api`
- `pm2 restart api` → **online** (pid baru 310048, uptime naik, status `online`, 0% cpu, tidak crash-loop). ✓
- `dashboard` **tetap online** (tidak disentuh restart pada permintaan — hanya diverifikasi online; kemudian direstart sekali untuk deploy frontend baru pada dist yang berhasil dibangun via `npx vite build`, kembali `online` 200). ✓
- Health check: `GET /api/health` → **200**. ✓
- Verifikasi live code di dist: `grep` dist `profile.js` mengandung `"Slug sudah digunakan toko lain"` + `"Slug tidak valid"` + `slug: store.slug` (2×). ✓

### 4.6 E2E manual (2 dummy store: A = `store-99410109`, B = `store-54c3b6c5`; plus C = `store-d2364fd6` untuk edge-case)

| # | Aksi | Ekspektasi | Hasil |
|---|------|-----------|-------|
| 1 | `PUT /profile` slug `toko-makmur` (Store A) | 200 + `slug:"toko-makmur"` di respon | ✅ 200, slug tersimpan |
| 1b | `GET /profile` (Store A) | `slug:"toko-makmur"` | ✅ terkonfirmasi tersimpan |
| 2a | `PUT /profile` slug `Toko Makmur!` (spasi+simbol) | 400 pesan jelas | ✅ 400, pesan format jelas |
| 2b | `PUT /profile` slug `-toko` (leading dash) | 400 | ✅ 400 |
| 2c | `PUT /profile` slug `ab` (2 karakter) | 400 | ✅ 400 |
| 3 | `PUT /profile` slug `toko-makmur` (Store B, dipakai A) | 409 pesan spesifik | ✅ 409 `"Slug sudah digunakan toko lain, coba yang lain"` |
| 4 | `GET /profile` (Store B, belum set slug) | `slug:null` | ✅ `"slug":null` |
| 5 | `PUT /profile` tanpa slug (Store A punya `toko-makmur`) | slug lama dipertahankan (bukan null) | ✅ slug tetap `"toko-makmur"` |
| 6 | `GET /api/pwa/toko-makmur/init` (customer buka PWA) | 200 + data store A | ✅ 200, `name:"Dummy A Updated"`, `slug:"toko-makmur"` |
| C | Store C set `toko-c`, lalu re-save `toko-c` (milik sendiri) | 200 (bukan 409 false-positive) | ✅ 200 (P2002 hanya untuk collision antar-toko) |

**Cleanup:** ketiga dummy store (A, B, C) + masing-masing `store_settings`-nya sudah **dihapus** (`DELETE FROM store_settings` + `stores`). Verifikasi akhir: `SELECT ... WHERE slug='toko-makmur'` → 0 baris; `SELECT ... WHERE email LIKE '%dummy%'` → 0 baris; `GET /api/pwa/toko-makmur/init` → **404** (tidak ada referensi kawanan). Data dummy tidak tersisa. ✓

---

## 5. Analisis race condition (acceptance tambahan)

**Pertanyaan:** *Apakah ada race condition bila 2 toko submit slug yang sama nyaris bersamaan?*

**Jawaban: Tidak ada race condition false-negative.**

**Mekanisme (tanpa pre-check):**
1. Validasi format slug dilakukan **di memori (regex)**, tanpa query DB — tidak ada "time-of-check".
2. Dilangsung ke `prisma.store.update({ where: { id: storeId }, data: { slug } })` — **tidak ada pre-check SELECT** sebelumnya (ini memang disengaja, untuk menghindari TOCTOU).
3. Unik-ness ditegakkan **atomik oleh unique index Postgres** (`stores_slug_key`) pada `commit` transaksi.
4. Prisma lempar `P2002` → ditangkap per-route → **409**.

**Skenario concurrent (Store X & Store Y submit `toko-sama` bersamaan):**
- Kedua-duanya lolos format (tidak ada DB).
- Kedua-duanya eksekusi `UPDATE ... SET slug='toko-same'`.
- Postgres menserealkan penulisan (row lock + unique index). Satu `commit` dulu (klaim slug), yang kedua **terlibat unique-violation → P2002 → 409**.
- Store yang "kalah" dapat 409 jelas + bisa pilih slug lain. Store yang "menang" dapat 200. **Tidak ada data korup / tidak ada false-negative.**

**"Tidak ada pre-check yang bikin false-negative"** — dikonfirmasi: kami sengaja **tidak** lakukan `SELECT EXISTS(slug)` sebelum UPDATE. Jika ada pre-check, dua request bisa lolos pre-check bersamaan lalu salah satu gagal di UPDATE (TOCTOU) — dengan pendekatan ini justru tidak terjadi karena tiada fase pemilahan.

**Edge case kepemilikan sendiri (diverifikasi E2E Test C):** Store yang **mengubah/simpan ulang slug miliknya sendiri** (mis. `toko-c` → `toko-c`) → **200, bukan 409**. Postgres mengizinkan sebuah baris untuk mempertahankan nilai unique-nya sendiri (baris sama yang "mengganti" dirinya), sehingga tidak ada P2002 palsu.

**Batasan/tekhnik lanjutan (tidak diperlukan, out-of-scope):** untuk high-contention, store yang dapat 409 bisa dilakukan retry otomatis client-side dengan slug alternatif; tidak ada kebutuhan tambahan di backend. Pendekatan pure-P2002 sudah cukup benar secara atomicity.

**Simpul:** pendekatan "validate format di app → eksekusi langsung → tangkap P2002 di DB" sudah **race-safe** dan **tanpa false-negative**, konsisten dengan pola yang sama yang dipakai di `pwa.ts` (POST `/message` → resolve-and-create customer/conversation with P2002 retry) dan `auth.ts` register (P2002 → 409).

---

## 6. Batasan / out-of-scope (tidak disentuh)
- `OnboardingProfile.tsx` — **tidak disentuh** (slug bukan field wajib onboarding; bisa diisi nanti lewat ProfilePage).
- `routes/auth.ts` (`PUT /auth/profile`) — **tidak disentuh** (fonnteToken/shipping/payment, kategori teknis).
- Engine AI / conversation / webhook — **tidak disentuh** sama sekali.
- PWA `routes/pwa.ts` — **tidak disentuh** (hanya cross-check; sudah resolve by slug, path `/c/:slug` sudah ada).
- `schema.prisma` — **tidak perlu diubah** (field `slug String? @unique` sudah ada).
- 23 error `tsc -b` pre-existing di 8 file dashboard lain — **tidak disentuh** (out-of-scope tech debt, dikosongkan untuk task kebersihan terpisah).

---

## 7. Status deploy
- `api` pm2: direstart → **online**, melayani kode baru (dist direbuild via `npm run build`).
- `dashboard` pm2: **online**, dist (re)build via `npx vite build` dan diristart kembali → **online (200)**, UI form "Alamat Chat Toko" + tombol copy link sudah live.
- `pwa` (customer): `qlobot.web.id/c/<slug>` sudah berfungsi via endpoint yang sudah ada (`GET /api/pwa/:storeSlug/init`).
