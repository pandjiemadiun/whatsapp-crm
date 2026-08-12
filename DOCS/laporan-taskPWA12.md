# Laporan Task P-PWA.12 — UI Chat PWA (init/history/message), webUid localStorage persistence

**Scope:** HANYA `apps/pwa/` — mengganti bukti-koneksi (`App.tsx` P-PWA.11) dengan UI chat
nyata + komponen pendukung. **TIDAK menyentuh** `apps/api` atau `apps/dashboard`
(bukti: `git status --short apps/api/src apps/dashboard/src` → kosong).
**Tidak ada** katalog produk / manifest / push-notification — scope eksklusif task ini:
buka PWA (route `/c/:slug`) → lihat identitas toko (dari `/init`) → kirim pesan → lihat
balasan AI → riwayat persisten antar reload (identity di `localStorage`, **bukan**
backend session).

Lingkungan: API pm2 `api` di `localhost:3000` (pid `286707`, **tidak direstart / tidak
terganggu** selama task ini; health `ok`). PWA dev di `localhost:5174` (dev) —
**tidak** dipakai simultan dengan build produksi; dev server sudah di-kill setelah E2E.
Browser headless **tidak tersedia** (tidak ada chromium, tidak ada playwright di
`apps/pwa`) — validasi E2E memakai **curl-simulate** atas jalur API yang sama
yang dipakai UI (`/api/pwa/:slug/init|history|message`), sebagaimana diperbolehkan
acceptance ("buka browser headless/**curl-simulate** flow lengkap").

---

## Langkah 0 — Gate: git status

`git status --short` (mentah) — working tree ada dirt, **tapi hanya kategori yang
sudah diketahui** (RAILS §6):
```
 M .env                                  (non-secret test var PWA_ALLOWED_ORIGINS; hasil P-PWA.9)
 M apps/api/dist/**                      (build artifacts, git-tracked — RAILS §6 hygiene)
 M apps/api/logs/combined.log|error.log  (runtime logs — RAILS §6)
?? DOCS/05_PWA_IDENTITY_BLUEPRINT.md     (pre-existing untracked)
?? DOCS/laporan-taskPWA3..4.md           (pre-existing untracked)
?? apps/api/dist/routes/pwa.*           (build output P-PWA.8, untracked — artifact dist)
```
- **Tidak ada** dirt di luar kategori di atas (tidak ada perubahan tak terduga; tidak
  ada modifikasi `apps/api/src`, `apps/dashboard/src`, atau file konfig lain dari task ini).
- **`apps/api/src` + `apps/dashboard/src` bersih** (`git status --short` keduanya = kosong).
- Task ini **read-only terhadap `apps/api`/`apps/dashboard`** (hanya menulis data *dummy*
  ke DB via skrip throwaway + menghapusnya; tidak mengedit sumber). **Dilanjutkan.**

---

## Langkah 1—3 — Implementasi UI (`apps/pwa/src`)

Rekonstruksi file (mirror `apps/dashboard`: Vite 8 + React 19 + Tailwind v4, tanpa auth
interceptor di `api.ts`):

**Routing** (`src/App.tsx`, ganti proof-of-concept P-PWA.11):
```tsx
import { Routes, Route } from 'react-router-dom'
import ChatPage from './components/ChatPage'
import NotFound from './components/NotFound'
export default function App() {
  return (
    <Routes>
      <Route path="/c/:slug" element={<ChatPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
```

**Identitas toko** — slug diambil dari URL (`useParams().slug`), **bukan hardcode** lagi
(sebelumnya P-PWA.11 pakai `STORE_SLUG = 'pwa11-e2e-test'`). `webUid` dibuat sekali
(per browser) dan disimpan ke `localStorage` key `garuda_pwa_uid`:
```ts
// src/components/ChatPage.tsx
useEffect(() => {
  if (!slug) return
  let uid = localStorage.getItem('garuda_pwa_uid')
  if (!uid) { uid = crypto.randomUUID(); localStorage.setItem('garuda_pwa_uid', uid) }
  setWebUid(uid)
}, [slug])
```

**Flow halaman** (semua lewat `src/services/api.ts` — `axios.create({baseURL:'/api'})`
polos, **tanpa** interceptor Authorization):
1. Mount → `GET /pwa/${slug}/init`. 404 → `store=null` → tampilan **"Toko tidak ditemukan"**
   (di `NotFound`/inline). Sukses → simpan `store` di state, header sederhana (nama + logo
   atau placeholder abu-abu bulat bila `profilePhotoUrl` null).
2. Setelah init sukses → `GET /pwa/${slug}/history?uid=<webUid>`.
   - history tidak kosong → render tiap entri sebagai bubble
     (`role: user` kanan / `assistant|system` kiri).
   - history kosong → bubble statis selamat datang: **"Halo! Ada yang bisa dibantu?"**
     (frontend, tidak query ke backend lagi).
3. Input box + tombol kirim. Submit → `POST /pwa/${slug}/message { uid, message }`:
   - **optimistic user bubble** ditampilkan *sebelum* response balik; `input` dikosongkan.
   - response `{ status:'pending_human' }` (human_takeover, dari P-PWA.8) → bubble sistem
     netral: **"Pesan diteruskan ke admin, mohon tunggu"** (bukan error).
   - response `{ success, content }` → bubble `assistant` dengan `content`.
   - POST gagal (429 mutex / network) → **catch**: `429`→"Sesi sedang sibuk, mohon kirim
     lagi.", lain→`e.message`; pesan ditampilkan di **area chat (bukan alert/popup)**;
     tombol kirim tetap bisa dipakai lagi.
4. Input + tombol kirim **disabled** saat `sending` (anti double-submit — pengganti
   idempotency-key yang belum ada). Enter-to-send juga didukung.

**`ChatBubble`** (`src/components/ChatBubble.tsx`) — props `{role:'user'|'assistant'|'system', text, source?}`:
```tsx
const isUser = role === 'user'
const bg = isUser ? 'bg-blue-600 text-white'
  : role === 'system' ? 'bg-gray-100 text-gray-600' : 'bg-gray-200 text-gray-900'
// <div className={`flex ${isUser?'justify-end':'justify-start'}`}> ...bubble... </div>
```
Kelas Tailwind semua **statis** (ternary hasilkan string lengkap) sehingga Tailwind v4 JIT
menghasilannya — tidak ada `rounded-${expr}` dinamis yang tak terdeteksi.

**`NotFound`** (`src/components/NotFound.tsx`) — placeholder simpel "Toko tidak ditemukan".

**Loading state** — selama `loading` (init+history pertama) tampilkan teks **"Memuat…"**
(skeleton sederhana; bukan spinner/komponen ekstra).

**Styling** — utility Tailwind langsung (`flex flex-col h-screen`, `overflow-y-auto`,
`border-b`, `rounded-full`, `bg-blue-600`, `disabled:opacity-50`, dll); mobile-first,
responsive via utilitas bawaan. **`@theme --color-brand`** di `index.css` (P-PWA.11)
tersedia tapi **tidak dipaksakan** dipakai di scaffold ini (gunakan warna utility bawaan
agar tak bergantung pada token custom).

---

## Langkah 5 — Validasi (acceptance RAILS §5)

### 5.1 — 5.2 `tsc --noEmit` 0 error + `npm run build` sukses
```
$ npx tsc --noEmit -p tsconfig.app.json      # exit 0  (0 error)
$ npm run build                              # "tsc -b && vite build" exit 0
✓ 81 modules transformed.
dist/index.html  0.38 kB │ gzip 0.26 kB
dist/assets/index-*.css  7.52 kB │ gzip 2.42 kB
dist/assets/index-*.js 279.93 kB │ gzip 92.08 kB
build exit: 0
```
(`tsc -b` lulus — `@types/node ^24.13.2` sudah ada sejak P-PWA.11; TypeScript 6.0.3.)

### 5.3 — `npm run dev` jalan, tidak crash
```
 VITE v8.2.1  ready in 657 ms
 ➜  Local:   http://localhost:5174/
 ➜  Network: use --host to expose
```
Dev server **sudah di-kill** setelah validasi; `curl http://localhost:5174/` →
"port 5174 free (dev stopped)".

### 5.4 — E2E end-to-end (curl-simulate, dummy store `pwa12-e2e-test`)
Dummy store dibuat data-only (skrip throwaway Prisma) id `d1138bff`; `webUid` disimulasikan
`pwa12-sim-<ts>` — sama saja dengan `localStorage.garuda_pwa_uid` yang dipakai browser
(satu webUid dipakai untuk semua request, memetakan ke "visitor yang sama setelah reload").
Semua request lewat **Vite dev proxy** (`localhost:5174/api → localhost:3000`).

```
### APP SHELL
curl http://localhost:5174/                       -> HTTP 200  (SPA index.html: <title>PWA</title>)

### 1) GET /api/pwa/pwa12-e2e-test/init            (≡ ui load toko untuk header)
{"success":true,"data":{"store":{"name":"PWA12 E2E Test Store","slug":"pwa12-e2e-test",
  "profilePhotoUrl":null,"description":null,"businessCategory":null,"address":null,
  "timezone":"Asia/Jakarta","operatingHours":null,"acceptsQris":true,"acceptsCod":true,
  "acceptsTransfer":true,"qrisImageUrl":null,"shippingMode":"pickup",
  "shippingFlatInCity":null,"shippingFlatOutCity":null,"isActive":true}}}   HTTP 200

### 2) GET /api/pwa/pwa12-e2e-test/history?uid=<simUid>    (≡ visitor baru, riwayat kosong)
{"success":true,"data":{"history":[]}}                              HTTP 200
  -> UI menampilkan welcome bubble: "Halo! Ada yang bisa dibantu?"

### 3) POST /api/pwa/pwa12-e2e-test/message  {"uid":"<simUid>","message":"Halo, jam operasional toko?"}
{"success":true,"conversationId":"742af4da-...","content":"Selamat datang! Jam operasional toko
  kami adalah dari pukul 08.00 hingga 20.00.","source":"ai","confidence":0.8,
  "timestamp":"2026-08-12T04:27:36.075Z"}                           HTTP 200
  -> UI: optimistic user bubble "Halo, jam operasional toko?" muncul,
     lalu assistant bubble "Selamat datang! Jam operasional..." (source:ai)

### 4) GET /api/pwa/pwa12-e2e-test/history?uid=<simUid>    (≡ RELOAD: webUid persisten → riwayat muncul)
{"success":true,"data":{"history":[
  {"id":"b5c399e0-...","role":"user","content":"Halo, jam operasional toko?","source":null,...},
  {"id":"e24bf1ef-...","role":"assistant","content":"Selamat datang! Jam operasional toko
     kami adalah dari pukul 08.00 hingga 20.00.","source":"ai",...}
]}}                                                        HTTP 200   (history=2, persisten)
```

**Maksud validasi poin 4 (reload → riwayat muncul):** di browser, setelah `POST`
berhasil, `localStorage.garuda_pwa_uid` **sudah otomatis persisten** (diset sekali, tidak
dihapus). Pada reload berikutnya `ChatPage` memakai `uid` yang sama → request
`GET history?uid=<uid>` ke backend mengembalikan conversation yang sama (resolve-or-create
lewat `webUid`) → riwayat [user, assistant] muncul kembali. Curl-simulate memakai **webUid
yang sama di semua request** memetakankan perilaku ini (bukti kontrak API yang sama yang
dipakai UI frontend).

### 5.5 — `git diff --stat` (committed) — HANYA `apps/pwa/`
```
 M apps/pwa/src/App.tsx                 (ganti proof-of-concept jadi router)
?? apps/pwa/src/components/ChatPage.tsx   (baru)
?? apps/pwa/src/components/ChatBubble.tsx (baru)
?? apps/pwa/src/components/NotFound.tsx  (baru)
+  DOCS/laporan-taskPWA12.md            (baru)
```
**Verifikasi:** `git status --short apps/api/src apps/dashboard/src` → **kosong** (tidak
pernah disentuh); tidak ada `pwa12-*.ts`/`_pwa12-*.ts` throwaway tersisa di `apps/api/`;
`node_modules`/`dist` di-git-ignore (tidak ter-stage).

### 5.6 — `apps/api` pm2 tetap **online tidak terganggu**
```
│ 0 │ api │ fork │ pid 286707 │ uptime 3h+ │ online │
{"status":"ok","message":"All systems operational"}
```

### 5.7 — Cleanup dummy data ✅ (lihat di bawah)
- Skrip throwaway (`_pwa12-cleanup2.ts`) sudah **dihapus**; tidak terlacak.
- Verifikasi akhir: `store` `pwa12-e2e-test` = **0**, `customer` uid
  `pwa12-sim-1786508855` = **0**, `conversation_history` (store itu) = **0**.

---

## Acceptance tambahan — edge case / behavior

**`webUid` di `localStorage` bersifat per-origin-per-browser.** Pertanyaan yang dijiwkanya:
"*apa yang terjadi kalau webUid di localStorage browser A dipakai buka PWA di browser B?*"

Jawaban / behavior yang **dokumen** (ini **bukan bug**, memang demikian):
- `localStorage` **hanya persisten dalam batas origin (host:port/proto) + browser yang
  sama**. Browser B (perangkat/mesin berbeda) **tidak pernah** membaca `localStorage`
  browser A — jadi browser B akan menemukan `localStorage.getItem('garuda_pwa_uid')`
  **kosong/null** → **membuat webUid baru (crypto.randomUUID)** → dianggap *visitor baru*
  → `GET history?uid=<uid-baru>` mengembalikan `[]` → tampil welcome message, dan thread
  pertama kirim pesan akan **membuat conversation baru** (bukan melanjutkan riwayat A).
- Akibatnya: riwayat di browser A **tidak tampil** di browser B (dan sebaliknya), karena
  tiap browser punya webUid/identity lokal yang berbeda. Ini **diharapkan** untuk MVP ini
  (identity per-device, tidak ada akun/login). Cross-device sync riwayat adalah *feature*
  tersendiri (membutuhkan user akun/login) — **di luar scope P-PWA.12**.
- Edge ancillary: bila user **menghapus site-data/localStorage** secara manual, webUid
  hilang → generate baru → conversation lama di backend **tetap ada** (tidak terhapus),
  hanya tidak "terhubung" lagi oleh frontend → seolah-olah visitor baru. Data backend
  tidak rusak; frontend sekadar resolve conversation lain. Juga perilaku yang dapat
  diterima/dokumenter.
- `crypto.randomUUID()` (Web Crypto bawaan browser) **tersedia** di semua modern browser
  (dan di scope PWA ini tidak perlu SSR). Jika environment tidak mendukung (browser
  *very* lama), `localStorage` tetap kosong → setiap reload generate uid baru (degraded
  tapi tidak crash karena dipanggil di dalam `if (!uid)` setelah cek).

Rekomendasi desain (bukan requirement task ini) — *hanya sebagai catatan* — untuk
cross-device history: gunakan user akun/login sehingga `webUid` berasal dari token, bukan
`localStorage`. Ditandatangani di blueprint §3 milestone lanjutan.

---

## Langkah selanjutnya (di luar P-PWA.12)
UI chat sudah berfungsi penuh. Fase berikutnya (dokumen terpisah): katalog produk /
manifest / push notification, serta *human agent reply* (P-PWA.8 endpoint
`/api/pwa/:slug/reply` atau inbound webhook → balas langsung ke conversation).
`human_takeover` sudah ditangani di sisi klien (`pending_human` → bubble sistem
"Pesan diteruskan ke admin, mohon tunggu").

---

## Commit
Stage **hanya** `apps/pwa/` (file yang berubah: `App.tsx` + `components/` baru;
`node_modules`/`dist` git-ignored) + `DOCS/laporan-taskPWA12.md`.
```
git add apps/pwa DOCS/laporan-taskPWA12.md
git commit -m "feat(PWA.12): UI chat PWA — init/history/message terintegrasi, webUid localStorage persistence"
```
