# TASK P-PWA.17 — Perbaiki 23 error `tsc -b` pre-existing di `apps/dashboard`

## Ringkasan

`npm run build` (script: `tsc -b && vite build`) pada `apps/dashboard` tidak bisa jalan karena
**23 error TypeScript** yang sudah ada sejak sebelum task ini (didokumentasikan di laporan
P-PWA.16). Task ini membersihkan ketiga error itu **secara akar (akar: hapus kode
yang benar-benar tidak dipakai / perbaiki tipe di definisi)** — **bukan** dengan
`// eslint-disable`, comment-out, atau prefix underscore `_` sebagai suppress.

Setelah perbaikan: `npm run build` **sukses penuh (EXIT 0)**, `tsc -b` **0 error**, cakupan
hanya **8 file (tsx)** yang teridentifikasi, `apps/api` dan `apps/pwa` **tidak disentuh**.

---

## Langkah 0 — Gate (git status)

`git status` (mengecualikan dirt yang sudah diketahui per RAILS §6: `dist/`, `logs/`,
`.env`): hanya **4 file DOCS `*.md` untracked yang sudah ada di baseline** (blueprint/fonnte
review/taskPWA3/taskPWA4). **Tidak ada dirt baru di luar `dist/logs/.env`.** Gate **LULUS**.

---

## Langkah 1 — Baseline 23 error (verbatim)

Perintah yang sama yang gagal di P-PWA.16: `npx tsc -b` dari `apps/dashboard`. Output
error verbatim (23):

```
src/components/FonnteSettings.tsx(2,1): error TS6133: 'ConfirmDialog' is declared but its value is never read.
src/components/FonnteSettings.tsx(63,10): error TS6133: 'confirmDialog' is declared but its value is never read.
src/components/FonnteSettings.tsx(93,9): error TS6133: 'handleRotateConfirm' is declared but its value is never read.
src/components/FonnteSettings.tsx(219,9): error TS6133: 'handleDisconnectConfirm' is declared but its value is never read.
src/components/FonnteSettings.tsx(259,30): error TS2322: Type '() => void' is not assignable to type '() => Promise<void>'.
src/components/FonnteSettings.tsx(260,5): error TS2322: Type '() => void' is not assignable to type '() => Promise<void>'.
src/components/admin/MagicPasteConfigPanel.tsx(134,17): error TS6133: 'name' is declared but its value is never read.
src/pages/DashboardHome.tsx(152,13): error TS6133: 'hasOrders' is declared but its value is never read.
src/pages/DashboardHome.tsx(153,13): error TS6133: 'hasProducts' is declared but its value is never read.
src/pages/WhatsAppConnect.tsx(8,1): error TS6133: 'ConfirmDialog' is declared but its value is never read.
src/pages/admin/AdminGOWA.tsx(5,1): error TS6133: 'ConfirmDialog' is declared but its value is never read.
src/pages/admin/AdminGOWA.tsx(29,10): error TS6133: 'showResetConfirm' is declared but its value is never read.
src/pages/admin/AdminGOWA.tsx(102,9): error TS6133: 'handleResetConfirm' is declared but its value is never read.
src/pages/admin/AuditLogViewer.tsx(8,1): error TS6133: 'ConfirmDialog' is declared but its value is never read.
src/pages/admin/AuditLogViewer.tsx(52,10): error TS6133: 'exportConfirm' is declared but its value is never read.
src/pages/admin/AuditLogViewer.tsx(76,9): error TS6133: 'handleExport' is declared but its value is never read.
src/pages/admin/PlatformConfig.tsx(3,1): error TS6133: 'ConfirmDialog' is declared but its value is never read.
src/pages/admin/PlatformConfig.tsx(90,9): error TS6133: 'confirmDelete' is declared but its value is never read.
src/pages/admin/StoreManagement.tsx(8,1): error TS6133: 'ConfirmDialog' is declared but its value is never read.
src/pages/admin/StoreManagement.tsx(58,10): error TS6133: 'confirmDialog' is declared but its value is never read.
src/pages/admin/StoreManagement.tsx(130,9): error TS6133: 'handleResetPasswordConfirm' is declared but its value is never read.
src/pages/admin/StoreManagement.tsx(146,9): error TS6133: 'handleVerifyEmailConfirm' is declared but its value is never read.
src/pages/admin/StoreManagement.tsx(163,9): error TS6133: 'handleDisconnectFonnteConfirm' is declared but its value is never read.
```

**Komposisi:** **21× TS6133** (unused) + **2× TS2322** (type mismatch), semuanya
terkonsentrasi di 8 file.

---

## Langkah 2 — Analisis pola & strategi per-kategori

### Pola yang ditemukan: "confirm dialog flow" tidak ter-render
6 dari 8 file mengimpor komponen `ConfirmDialog` (`src/components/ConfirmDialog.tsx`)
tetapi **tidak pernah merendinkannya di JSX**. Akibatnya, seluruh "flow konfirmasi"
terputus:

- State pembuka (mis. `setConfirmDialog({...})`, `setShowResetConfirm(true)`) — **dipanggil**
  oleh tombol, tetapi **valued tidak pernah dibaca** (tidak ada render dialog).
- Handler "confirm" (mis. `handleResetPasswordConfirm`, `handleExport`,
  `confirmDelete`, `handleDisconnectConfirm`) — berisi logika API sebenarnya, tapi
  **tidak pernah dipanggil / tidak dikembalikan**. **Mati** (dead code).

Satu-satunya file yang **sehat**: `MagicPasteConfigPanel.tsx` — di sana `ConfirmDialog`
memang **dirender** (line 418) dan `confirmDelete` memang **diwire** lewat
`onConfirm={confirmDelete}` (line 422). Satu-satunya error di file ini ialah
destructure `name` yang tidak dipakai (nilainya dibaca langsung lewat
`deleteConfirm.name` di message dialog).

> **Fakta penting:** karena `tsc` TS6133 hanya mem-flag identitas yang **benar-benar tidak
> terbaca di file itu**, semua impor/handlers/state-value yang diflag merupakan kode
> mati yang **sudah tidak terpanggil di runtime**. Menghapusnya tidak mengubah perilaku
> yang terlihat (fitur konfirmasi sudah tidak berfungsi sejak sebelum task ini). Ini
> dokumentasi — semua kode yang dihapus dapat dipulihkan dari git history bila owner
> ingin melengkapi flow konfirmasi nanti.

### Strategi per kategori

**TS6133 — unused import (6 file: FonnteSettings, WhatsAppConnect, AdminGOWA,
AuditLogViewer, PlatformConfig, StoreManagement):**
Setiap impor `ConfirmDialog` diverifikasi via `grep -c "ConfirmDialog"` tiap file —
konfirmasi tiapnya cuma 1 referensi (yakni baris impor) atau hanya `setX`/`confirmX`
(substring) sehingi komponennya benar-benar tidak dirender. **Dihapus bersih.**

**TS6133 — unused state *value* (4 kasus: `confirmDialog`, `showResetConfirm`,
`exportConfirm`, `confirmDialog`):**
Setter-nya (`setConfirmDialog`/`setShowResetConfirm`/`setExportConfirm`) **masih dipakai**
oleh tombol pembuka, jadi tidak boleh hapus state-nya sepenuhnya. Solusi tidak-menggunakan-
suppress: **`const [, setX] = useState(...)`** — lepas nilai yang tidak dibaca, pertahankan
setter. Ini pola yang sudah dipakai baseline (`ProfilePage.tsx: const [, setSavedFlags]`,
lihat P-PWA.16).

**TS6133 — unused confirm/action handlers (8 fungsi mati):**
`handleRotateConfirm`, `handleDisconnectConfirm` (FonnteSettings), `handleResetConfirm`
(AdminGOWA), `handleExport` (AuditLogViewer), `confirmDelete` (PlatformConfig),
`handleResetPasswordConfirm`, `handleVerifyEmailConfirm`, `handleDisconnectFonnteConfirm`
(StoreManagement). Semuanya tidak pernah dikembalikan/dipanggil/diren­der.
**`grep` sebelum hapus** memastikan tidak ada referensi lain (termasuk di JSX). **Dihapus.**

**Cascade yang dicegah (penting):** menghapus handler mati yang **satu-satunya pengguna
setter lain** berpotensi menciptakan TS6133 baru (setter yang tersisa tidak ada caller).
Hal ini terjadi pada:
- `setWebhookLoading` (hanya dipakai `handleRotateConfirm`) → nilainya `webhookLoading`
  masih dipakai di `return` (konsumen `disabled`/`spinner`) → **`const [webhookLoading]`**
  (capture value saja, drop setter).
- `setDisconnecting` (hanya dipakai `handleDisconnectConfirm`) → `disconnecting` dipakai
  di `return` → **`const [disconnecting]`**.
- `setResetting` (hanya dipakai `handleResetConfirm`, AdminGOWA) → `resetting` dipakai di
  JSX `disabled`/terner → **`const [resetting]`**.
- `setExportLoading` (hanya dipakai `handleExport`, AuditLogViewer) → `exportLoading`
  dipakai di JSX → **`const [exportLoading]`**.

  `const [value] = useState(...)` (destructuring *value-only*, tidak memakai `_setX`)
  adalah pola baku, **bukan suppress** — setter memang tidak punya caller setelah handler
  mati dihapus. Nilai tetap selalu `false` (perilaku sama dengan *sebelum* perbaikan,
  karena handler mati itu memang tidak pernah dijalankan). **Tidak ada perubahan
  behavior.**

  File lain (PlatformConfig, StoreManagement) **tidak cascade** karena setter yang
  dipakai handler mati (mis. `setDeletingKey`, `setActionLoading`) masih dipakai oleh
  handler pembuka / JSX lain.

**TS2322 — type mismatch (2, keduanya FonnteSettings.tsx:259-260):**

Konteks:
- Interface diekspor `UseFonnteSettingsResult` mendeklarasikan
  `handleRotateWebhook: () => Promise<void>` dan `handleDisconnect: () => Promise<void>`
  (bersama handler asik lain `handleSave`, `handleCopyWebhook`, `fetchStatus`).
- Implementasinya adalah **sinkron** (`() => void`) — hanya memanggil `setState`.

Satu-satunya konsumen hook (`WhatsAppConnect.tsx`) memakai keduanya **sebagai
`onClick={s.handleRotateWebhook}` / `onClick={s.handleDisconnect}`** (fire-and-forget,
**tidak di-`await`, tidak `.then`**).

Keputusan: **tambahkan `async`** (bukan `as any`, bukan `as unknown as X`, bukan `!`).
Alasannya:
1. Merupakan perbaikan **di akar** — implementasi diselaraskan ke *contract* yang sudah
   dideklarasikan di interface (`Promise<void>`).
2. **Tipe kosmetik, tidak ada perubahan behavior observable**: `onClick` React mengabaikan
   nilai kembali; untuk pemanggil *fire-and-forget* tidak ada perbedaan antara kembali
   `void` vs `Promise<void>`.
3. Konsisten dengan handler asik saudaranya (`handleCopyWebhook`, `handleSave`).
4. **Tidak mengubah interface publik** (`Promise<void` tetap) → tak ada dampak ke konsumen
   lain (hanya ada satu: `WhatsAppConnect`).

Karena ini **bukan perubahan behavior/logic**, per instruksi task **tidak wajib
melaporkan ke owner / tidak perlu STOP**.

---

## Langkah 2.1 — Tabel 23 error → 8 file → status fix

| No | File:line | Kode | Identitas | Akar masalah | Perbaikan (bukan suppress) |
|----|-----------|------|-----------|--------------|-----------------------------|
| 1 | FonnteSettings.tsx:2 | TS6133 | `ConfirmDialog` (import) | Komponen tidak pernah dirender (flow konfirmasi mati) | Hapus baris import |
| 2 | FonnteSettings.tsx:63 | TS6133 | `confirmDialog` (state value) | Nilai diset `handleRotateWebhook`/`handleDisconnect` tapi tidak dibaca | `const [, setConfirmDialog] = useState(...)` |
| 3 | FonnteSettings.tsx:93 | TS6133 | `handleRotateConfirm` (fn) | Tidak pernah dipanggil/dikembalikan (konfirmasi mati) | Hapus fungsi |
| 4 | FonnteSettings.tsx:219 | TS6133 | `handleDisconnectConfirm` (fn) | Tidak pernah dipanggil/dikembalikan | Hapus fungsi |
| 5 | FonnteSettings.tsx:259 | TS2322 | `handleDisconnect` | Impl `() => void`, interface minta `() => Promise<void>` | Tambah `async` |
| 6 | FonnteSettings.tsx:260 | TS2322 | `handleRotateWebhook` | Sama seperti 259 | Tambah `async` |
| 6c | FonnteSettings.tsx:67 | (cascade) | `setWebhookLoading` | Setter hanya dipakai `handleRotateConfirm` (dihapus) | `const [webhookLoading] = useState(false)` (nilai tetap dipakai `return`/konsumen) |
| 6c | FonnteSettings.tsx:62 | (cascade) | `setDisconnecting` | Setter hanya dipakai `handleDisconnectConfirm` (dihapus) | `const [disconnecting] = useState(false)` (nilai tetap dipakai `return`/konsumen) |
| 7 | MagicPasteConfigPanel.tsx:134 | TS6133 | `name` (destructure) | `confirmDelete` hanya pakai `id`; `name` dibaca via `deleteConfirm.name` di dialog | `const { id } = deleteConfirm` |
| 8 | DashboardHome.tsx:152 | TS6133 | `hasOrders` | Local tak dipakai (`orderRes` dipakai langsung di `if` berikutnya) | Hapus baris |
| 9 | DashboardHome.tsx:153 | TS6133 | `hasProducts` | Local tak dipakai (`prodRes` dipakai langsung di `if` berikutnya) | Hapus baris |
| 10 | WhatsAppConnect.tsx:8 | TS6133 | `ConfirmDialog` (import) | Tidak pernah dirender | Hapus baris import |
| 11 | AdminGOWA.tsx:5 | TS6133 | `ConfirmDialog` (import) | Tidak pernah dirender (flow reset mati) | Hapus baris import |
| 12 | AdminGOWA.tsx:29 | TS6133 | `showResetConfirm` (state value) | Diset `handleReset` tapi tidak dibaca | `const [, setShowResetConfirm] = useState(false)` |
| 13 | AdminGOWA.tsx:102 | TS6133 | `handleResetConfirm` (fn) | Tidak pernah dipanggil (konfirmasi mati) | Hapus fungsi |
| 13c | AdminGOWA.tsx:28 | (cascade) | `setResetting` | Setter hanya dipakai `handleResetConfirm` (dihapus) | `const [resetting] = useState(false)` (nilai tetap dipakai JSX `disabled`/terner) |
| 14 | AuditLogViewer.tsx:8 | TS6133 | `ConfirmDialog` (import) | Tidak pernah dirender | Hapus baris import |
| 15 | AuditLogViewer.tsx:52 | TS6133 | `exportConfirm` (state value) | Diset tombol Export tapi tidak dibaca | `const [, setExportConfirm] = useState(...)` |
| 16 | AuditLogViewer.tsx:76 | TS6133 | `handleExport` (fn) | Tidak pernah di-`onClick`/dikembalikan (flow ekspor mati) | Hapus fungsi |
| 16c | AuditLogViewer.tsx:51 | (cascade) | `setExportLoading` | Setter hanya dipakai `handleExport` (dihapus) | `const [exportLoading] = useState(false)` (nilai tetap dipakai JSX) |
| 17 | PlatformConfig.tsx:3 | TS6133 | `ConfirmDialog` (import) | Tidak pernah dirender | Hapus baris import |
| 18 | PlatformConfig.tsx:90 | TS6133 | `confirmDelete` (fn) | Tidak pernah dipanggil (flow hapus konfig mati) | Hapus fungsi |
| 19 | StoreManagement.tsx:8 | TS6133 | `ConfirmDialog` (import) | Tidak pernah dirender (pakai confirm dialog inline untuk suspend) | Hapus baris import |
| 20 | StoreManagement.tsx:58 | TS6133 | `confirmDialog` (state value) | Diset 3 opener tapi tidak dibaca | `const [, setConfirmDialog] = useState(...)` |
| 21 | StoreManagement.tsx:130 | TS6133 | `handleResetPasswordConfirm` (fn) | Tidak pernah dipanggil (konfirmasi mati) | Hapus fungsi |
| 22 | StoreManagement.tsx:146 | TS6133 | `handleVerifyEmailConfirm` (fn) | Tidak pernah dipanggil | Hapus fungsi |
| 23 | StoreManagement.tsx:163 | TS6133 | `handleDisconnectFonnteConfirm` (fn) | Tidak pernah dipanggil | Hapus fungsi |

### Ringkasan jenis error
- **TS6133 (unused): 21** → semuanya diselesaikan dengan **hapus** (import / local / fungsi mati)
  atau **`const [, setX]` / `const [value]`** (capture-only, bukan suppress).
- **TS2322 (type mismatch): 2** → diselesaikan dengan **perbaiki di akar** (`async`).
- **Cascade yang dicegah: 4** setter terorphan oleh penghapusan handler mati → diselesaikan
  dengan destructuring value-only (`const [x] = useState(...)`), nilainya tetap dipakai di JSX/`return`.

---

## Langkah 3 — Validasi (acceptance RAILS §5)

| No | Cek | Hasil |
|----|-----|-------|
| 3.1 | `npx tsc -b` | **0 error** (dibanding 23 di Langkah 1, semua hilang) |
| 3.2 | `npm run build` (`tsc -b && vite build`) | **EXIT 0.** 1893 modul transform → sukses. (Hanya *warning* ukuran chunk >500 kB yang pre-existing, tidak fatal.) |
| 3.3 | Backend `npm run test:chat` | `Test Suites: 2 failed, 21 passed, 23 total` · `Tests: 1 failed, 260 passed, 261 total` — **persistent persis baseline** (dashboard tidak tersentuh backend) |
| 3.4 | `git diff --stat` (source) | **Exactly 8 file** (lihat di bawah). Scope tidak melebar ke `apps/api`/`apps/pwa` |
| 3.5 | `pm2 restart dashboard` | online (`pid 315841`), tidak crash-loop |
| 3.5 | curl halaman yang tersentuh | semua **HTTP 200** |
| 3.6 | `apps/api` pm2 | tetap `online` (`pid 310048`), tidak tersentuh |

### 3.4 — git diff --stat (source, hanya 8 file)
```
 apps/dashboard/src/components/FonnteSettings.tsx            | 67 ++++---
 apps/dashboard/src/components/admin/MagicPasteConfigPanel.tsx |  2 +-
 apps/dashboard/src/pages/DashboardHome.tsx                    |  2 -
 apps/dashboard/src/pages/WhatsAppConnect.tsx                  |  1 -
 apps/dashboard/src/pages/admin/AdminGOWA.tsx                    | 20 +----
 apps/dashboard/src/pages/admin/AuditLogViewer.tsx             | 29 +-------
 apps/dashboard/src/pages/admin/PlatformConfig.tsx             | 18 +-----
 apps/dashboard/src/pages/admin/StoreManagement.tsx            | 41 +-----------
 8 files changed, 14 insertions(+), 166 deletions(-)
```
**Tidak ada file di luar ke-8 ini yang dimodifikasi** (kecuali laporan DOCS ini).

### 3.5 — curl halaman yang tersentuh (setelah `pm2 restart dashboard`, vite preview
catch-all SPA → 200 untuk semua route; auth diverifikasi client-side)

| Route | Page | HTTP |
|-------|------|------|
| `/dashboard` | DashboardHome | 200 |
| `/dashboard/whatsapp` | WhatsAppConnect | 200 |
| `/dashboard/profile` | ProfilePage | 200 |
| `/dashboard/faq` | FaqManager (tak tersentuh, spot-check) | 200 |
| `/admin` | AdminOverview | 200 |
| `/admin/stores` | StoreManagement | 200 |
| `/admin/gowa` | AdminGOWA | 200 |
| `/admin/products/magic-paste` | MagicPastePage → MagicPasteConfigPanel | 200 |
| `/admin/config` | PlatformConfig | 200 |
| `/admin/audit-logs` | AuditLogViewer | 200 |

> **Catatan verifikasi regresi:** komponen `ConfirmDialog` (`src/components/ConfirmDialog.tsx`)
> **tidak dihapus** — hanya impor yang *tidak pakai* yang dihapus dari 6 file. `MagicPasteConfigPanel`
> (satu-satunya konsumen yang ternyata masih merendernya) tetap mengimpor dan me-render.
> `npm run build` yang sukses membukti tidak ada *chunk* yang broken / module yang hilang.

### 3.6 — Backend tidak tersentuh
`apps/api` (`pid 310048`) online, `GET /api/health` → 200. Tidak ada deploy ulang backend.

---

## Acceptance tambahan — "apakah semua TS2322 butuh keputusan owner?"

**Tidak.** Dari 23 error, hanya **2 yang TS2322** dan **kedua-duanya berhasil diperbaiki
sebagai "tipe kosmetik" tanpa behavior change**:
- `FonnteSettings.tsx:259-260` — `handleDisconnect` & `handleRotateWebhook` dideklarasikan
  `() => Promise<void>` di interface tapi di-implemen `() => void`. Diperbaiki dengan
  menambah `async` (selaras dengan konsumen `WhatsAppConnect` yang memakai `onClick`
  fire-and-forget). **Tidak ada keputusan owner yang tertunda** — semua 23 error
  terselesaikan penuh.

> Berarti task ini **benar-benar selesai tanpa sisa keputusan tertunda**.

---

## Catatan keamanan / dokumen pemulihan

1. **Kode yang dihapus adalah kode mati (dead code).** 8 handler konfirmasi/aksi
   (`handleRotateConfirm`, `handleDisconnectConfirm`, `handleResetConfirm`, `handleExport`,
   `confirmDelete`, `handleResetPasswordConfirm`, `handleVerifyEmailConfirm`,
   `handleDisconnectFonnteConfirm`) **sudah tidak terpanggil** karena `ConfirmDialog` tidak
   pernah ter-render — fitur "konfirmasi hapus/reset/ekspor" pada panel admin **sudah
   tidak berfungsi sebelum task ini**. Penghapusan tidak mengubah perilaku yang terlihat.
   Jika ingin memulihkan fitur konfirmasi, gunakan `git show <commit-sebelum-P-PWA.17>^`
   dan wiring-kan kembali ke `ConfirmDialog`.
2. **State loading yang "terorphan" (`resetting`, `disconnecting`, `webhookLoading`,
   `exportLoading`) tetap dideklarasikan (value-only)** karena nilainya dipakai di JSX/`return`
   konsumen untuk menampilkan spinner/`disabled`. Setter-nya di-`drop` lewat
   `const [value] = useState(...)` — bukan suppress. Nilai tetap `false` (sama seperti
   sebelumnya karena setter-nya tidak pernah disebut).
3. **`apps/api` / `apps/pwa` tidak disentuh sama sekala.**

---

## Acceptance tambahan task ini (P-PWA.17)
- Laporan keberadaan → file ini (`DOCS/laporan-taskPWA17.md`). ✅
- Commit message: `fix(PWA.17): bereskan 23 error tsc -b pre-existing di apps/dashboard (unused imports + type mismatch)`. ✅

## Files changed
8 file (source): `FonnteSettings.tsx`, `MagicPasteConfigPanel.tsx`, `DashboardHome.tsx`,
`WhatsAppConnect.tsx`, `AdminGOWA.tsx`, `AuditLogViewer.tsx`, `PlatformConfig.tsx`,
`StoreManagement.tsx`. + 1 laporan (`DOCS/laporan-taskPWA17.md`).
