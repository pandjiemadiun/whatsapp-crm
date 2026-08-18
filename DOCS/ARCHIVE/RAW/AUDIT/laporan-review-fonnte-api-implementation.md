# Review Dokumen API Fonnte → Apa yang Perlu Kita Implementasikan?

**Tujuan:** memetakan dokumen API Fonnte resmi ke kode yang **sudah ada** di Garuda,
lalu menandai apa yang belum ada / tersedia tapi belum dipakai / perlu ditambah.
Ini **laporan read‑only** — tidak ada kode yang di‑generate.

Versi dokumen Fonnte tangan‑pertama (yang Anda kirimkan) dicocokkan dengan basis kode
`apps/api` + `apps/dashboard` + `apps/pwa` pada HEAD commit `4785375` (P‑PWA.15).

---

## A. Ringkasan jawaban singkat

**Ada — terutama dua hal** yang langsung relevan dengan keluhan “status WhatsApp tidak realtime”:

1. **Webhook Device Status** (real‑time) → **sudah sampai, tapi di‑ignore** di `webhooks.ts:154`. Ini *akarnya*.
2. **Disconnect Device** → belum dipanggil sama sekali; dashboard “Disconnect” hanya meng‑null‑kan token di DB, WA di Fonnte masih hidup.

 Seleb rest — sebagian sudah ada, sebagian opsional/UX polish.

Berikut peta lengkap.

---

## B. Pemetaan per‑fitur dokumen Fonnte

| # | Fitur dokumen Fonnte | Endpoint / cara pakai | Status di kode | Perlu implementasi? | Catatan |
|---|---|---|---|---|---|
| 1 | **Webhook Device Status** (realtime connect/disconnect) | webhook ke `/api/webhooks/fonnte?secret=…` | `webhooks.ts:130` **menerima, tapi `:154` `ignored`** | **YES — prioritas #1** | Ini penyebab “masih connected setelah HP dimatikan”. |
| 2 | Send Message | `POST https://api.fonnte.com/send` | `fonnte.service.ts:86 sendMessage()` pakai `Authorization: token` | TIDAK — sudah ada & dipakai | sudah ada flag `typing` (line ~98) tapi tidak dipakai secara dinamis. |
| 3 | Get Devices | `POST /get-devices` (Account Token) | **TIDAK ADA** | Opsional | berguna untuk *sync* daftar device per akun (lihat rekomendasi Fase 1 roadmap). |
| 4 | Device Profile | `POST /device` (Device Token) | `fonnte.service.ts:20 getDeviceStatus()` pakai `/device` | TIDAK — sudah dipakai | ini sumber status “connected”. |
| 5 | Add Device | `POST /add-device` (Account Token) | **TIDAK ADA** | — (masuk skema Master Pool) | sesuai kerangka “Fonnte Master Pool” yang Anda kerjakan terpisah. |
| 6 | Update Device | `POST /update-device` | **TIDAK ADA** | Opsional | untuk set webhook/autoread/nama otomatis. |
| 7 | Delete Device | `POST /delete-device` (butuh OTP) | **TIDAK ADA** | **YES — dipakai kill‑switch / disconnect** | **RISK:** dokumen bilang butuh OTP; killer‑switch di framework panggil tanpa OTP → akan gagal. |
| 8 | Order Package | `POST /order` | — | TIDAK | di luar cakupan. |
| 9 | Get QR | (bagian `/login` device) | `whatsapp.ts:121` / `whatsapp.ts:163` pakai `qr_link` | TIDAK — sudah ada | pakai di `/connect`. |
| 10 | Validate Number | — | **TIDAK ADA** | Opsional | validasi nomor sebelum kirim (anti error 400 Fonnte). |
| 11 | Check Message Status (deprecated) | — | — | TIDAK | dideprecated Fonnte. |
| 12 | Get/Update Group List | — | — | TIDAK | tidak pakai grup (WA bisnis, tidak grup). |
| 13 | Rotator / Send by URL / Delete Message / Reschedule | — | — | TIDAK / opsional | hanya jika butuh penjadwalan pesan (saat ini `schedule` belum dipakai). |
| 14 | **Typing API** (simulasi indikator mengetik) | `typing: bool` di `/send` | `fonnte.service.ts:98` punya flag, default `false` | **YES — UX polish** | PWA P‑PWA.14 pakai *simulasi lokal* “mengetik…”; jika True, panggil Typing API ke nomor customer. |
| 15 | **Webhook Incoming Message / Reply** | `/api/webhooks/fonnte` | `webhooks.ts:130` sudah handle pesan masuk → pipeline | TIDAK — sudah ada | memproses ke `messageProcessorService.processMessage(... channel:'whatsapp' ...)`. |
| 16 | Webhook Update Message Status | — | **TIDAK ADA** | Opsional | tracking delivered/read; belum ada tabel message_status. |

---

## C. Penjelasan tiap fitur “perlu” (bukan omong‑kosong)

### 1. Webhook Device Status (PRIORITAS TERUTAMA — langsung selesaikan “status tidak realtime”)
Kondisi sekarang (`webhooks.ts:129‑157`):

```ts
// POST /api/webhooks/fonnte
if (body.status === 'connect' || body.status === 'disconnect') {
  adapters.logger.info('Fonnte device status event ignored', { status: body.status });
  return res.status(200).json({ status: 'ignored' });
}
```

Ini berarti **Fonnte sudah *push* status device ke kami secara real‑time, tapi kami membuangnya.** Akibatnya:
- `deviceStatusCache` (Map in‑process, 60 s — `fonnte.service.ts:6,16`) tidak pernah *flush* saat HP dimatikan.
- Redis cache `wa:wa-connection:{storeId}` (30 s — `whatsapp-connection.service.ts:21,76`) tidak pernah *flush*.
- Dashboard *fetch‑once* di mount (`FonnteSettings.tsx:179`) kemudian menampilkan “connected” sampai halaman di‑refresh + cache expired.

**Yang perlu diubah (ringkas, 1 file `webhooks.ts`):**
- Pada `body.status === 'disconnect'`: panggil `invalidateDeviceCache(store.fonnteToken)` (fonnte.service.ts:56) **+** hapus Redis `wa:wa-connection:{storeId}` (`del` key). → Sekali ini, request user berikutnya / polling langsung dapat “disconnected”.
- Pada `body.status === 'connect'`: invalidate cache juga (force refresh).
- Auth webhook ini sudah via `secret` query (`?secret=`) dan diverifikasi ke `store.webhookSecret` (webhooks.ts:135‑149) — aman.

> Catatan: ini *membuka jalan* agar cache tak tersangkut 30/60 s. Agar benar‑benar **langsung realtime ke UI**, lihat poin 2 & 4 (polling/visibilitychange di dashboard).

Lokasi kode: `apps/api/src/routes/webhooks.ts:154` (hapus blok `ignored`) +
`apps/api/src/services/whatsapp-connection.service.ts` (tambahkan `invalidateConnectionCache(storeId)` yang `del`s Redis) +
`apps/api/src/services/fonnte.service.ts:56` (invalidateDeviceCache, sudah ada).

### 2. Disconnect Device (RISK + kebutuhan)
- Dashboard “Disconnect / Remove” (`FonnteSettings.tsx:219 handleDisconnectConfirm`) hanya `PUT /auth/profile` → `fonnteToken:null, fonnteNumber:null` (line 225‑229). **Tidak memberi tahu Fonnte**, jadi device WA tetap terhubung sampai kadaluarsa/timeout Fonnte.
- Dukungan: dokumen Fonnte ada `POST /disconnect-device`.
- **Rekomendasi:** tambahkan endpoint `POST /api/whatsapp/disconnect-fonnte` → panggil Fonnte `disconnect-device` pakai `deviceToken`/account token, lalu baru null‑kan token di DB.
- **RISK (butuh keputusan):** dokumen bilang `delete-device` butuh OTP. Jika memakai `delete-device` untuk kill‑switch, kita perlu alur “minta OTP → konfirm di UI admin”. Sarankan pakai `disconnect-device` dulu (mungkin lebih ringan) untuk disconnect; `delete-device`+OTP baru untuk “hapus total”.

Lokasi kode: tambah di `apps/api/src/routes/whatsapp.ts:212` (route `disconnect` sekarang cuma delete GOWA device) + panggil dari `FonnteSettings.tsx:219`.

### 3. Polling / visibilitychange di Dashboard (supaya UI realtime)
- `grep` dashboard untuk `setInterval / useInterval / polling` → **kosong** (`useFonnteSettings` cuma `fetch` sekali di mount, `FonnteSettings.tsx:179`).
- **Rekomendasi:** tambahkan (a) *refresh otomatis tiap 15 s* atau (b) lebih hemat — *re‑fetch* pada `visibilitychange`/`focus` + *long‑poll 15 s*. Ini konsumsi kecil dan tidak perlu WebSocket.

Lokasi kode: `apps/dashboard/src/components/FonnteSettings.tsx` (di dalam hook `useFonnteSettings`).

### 4. Update Device (autoread / webhook / nama) — Opsional
- `update-device` (dokumen) belum dipakai. Dashboard sudah punya `handleRotateWebhook` (`POST /messages/rotate-webhook-secret`) tapi tidak menulis webhook ke Fonnte lewat `/update-device`. Jika ingin *webhook otomatis* ke Fonnte (agar Fonnte kirim ke benar), butuh panggil `update-device` untuk set `webhook URL` + `autoread`. Bisa digabung dengan alur *Add Device* Master‑Pool.

### 5. Typing API — polish UX
- `fonnte.service.ts:98` punya `typing: config.typing ?? false`. PWA `ChatPage.tsx` P‑PWA.14 pakai *simulasi lokal* (`isTyping` + delay). Jika inginkan indikator mengetik **di WhatsApp lawan**, kirim Typing API ke nomor target sebelum balasan AI. Butuh `sendMessage(..., { typing:true })` pada path WA. (Web channel tidak butuh — lawan adalah browser.)

---

## D. Apa yang **sudah** lengkap (jangan diubah)

- **Send Message** (`fonnte.service.ts:86`) — sudah pakai `Authorization: token`, `target`, `message`, `inboxid`, `nostyle`. Cukup.
- **Device Profile / getDeviceStatus** (`fonnte.service.ts:20`) — sumber status “connected”. Cukup (setelah cache invalidate).
- **Get QR** (`whatsapp.ts:121`) — sudah dipakai di `/connect`.
- **Incoming webhook message** (`webhooks.ts:130`) — sudah ada + secret-validation + pipeline `processMessage(..., gateway:'fonnte', channel:'whatsapp', token)`. Cukup robust.
- **Route mount** — `whatsappRouter` di `index.ts:108`; `webhooksRouter` di `index.ts:105`. Auth: `authMiddleware` Bearer‑token → `StoreSetting(auth_token)` (`middleware/auth.ts:9`).

---

## E. RISK & trade‑off (perhatian sebelum kode)

1. **OTP `delete-device`** — jika memakai `delete-device` untuk kill‑switch (reset slot), butuh OTP. Solusi: pakai `disconnect-device` untuk kill‑switch (ringan), reservasikan `delete-device` untuk aksi manual admin yang meng‑input OTP.
2. **Race condition kapasitas master** — pool allocator harus atomic (`UPDATE … WHERE usedCapacity < max ORDER BY usedCapacity LIMIT 1` / Redis lock), contoh pola mutex ada `messageQueueService.acquireLock` (message-queue.service.ts / message-processor.service.ts:161).
3. **Webhook idempotency** — Fonnte bisa *resend*; counter invalidate tidak idempotent problematik (invalidate sifatnya *safe*), tapi kalau nanti counter `chatCount` untuk kill‑switch butuh dedup `message_id` (pipeline sudah ada konsep dedup `message-processor.service.ts:110 isDuplicate`, 5 menit TTL).
4. **Latency Fonnte** — setiap `add-device`/`update-device`/`delete-device` call eksternal; perlu **backoff + circuit breaker** (sudah ada `CircuitBreakerService` di `message-processor.service.ts:77`).
5. **Migrasi data existing** — toko lama punya `Store.fonnteToken` (schema.prisma:24). Jika beralih ke pool device, butuh *migration script* atau *lazy enroll*; selama peralihan, dual‑mode (legacy single‑token vs pool). RISK: duplikat device.
6. **Auth webhook Fonnte** — sekarang pakai `?secret=` query, aman. Jika pakai signature (HMAC) di masa depan, perlu tambahkan validasi (bisa jadi hardening).

---

## F. Rekomendasi urutan eksekusi (tanpa refactor masal)

1. **Fase “realtime status” (perbaiki keluhan utama):**
   - `webhooks.ts:154` → jangan lagi `ignored`; pada disconnect/connect → invalidate cache (fonnte.service.ts:56 + hapus Redis key).
   - `FonnteSettings.tsx` → tambahkan `visibilitychange` re‑fetch + interval 15 s.
   - `whatsapp-connection.service.ts` → ekspor helper `invalidateConnectionCache(storeId)` (agaknya dipakai webhook).
   - **Estimasi:** < 1 file route + 1 helper service + 1 hook dashboard.

2. **Fase “Disconnect benar‑benar”:**
   - Tambahkan `POST /api/whatsapp/disconnect-fonnte` → Fonnte Disconnect Device; dashboard panggil ini sebelum null‑kan token.

3. **Fase Master‑Pool (Add/Update/Get Devices + quota):** sudah ada blueprint Anda — lanjutkan, reuse `acquireLock` pattern + `CircuitBreakerService`.

4. **Fase Typing API + Update Device options:** polish / fitur lanjutan.

---

## G. Kesimpulan

**Ya — ada yang perlu diterapkan, dan duanya langsung berelasi dengan “status tidak realtime” yang kamu rasakan:**

- **`Webhook Device Status`** — sudah sampai, **tapi justru di‑ignore** di `webhooks.ts:154`. Buka kembali blok itu dan *invalidate cache* di `fonnte.service.ts` + Redis. Ini *penyumbang terbesar* pada perbaikan.
- **`Disconnect Device`** — belum dipanggil sama sekali; dashboard disconnect cuma bersihkan DB.

Fitur‑fitur lain (Send, Get Devices, Get QR, Incoming webhook, Typing API) sebagian sudah ada; **selanjutnya** (Master Pool, Update Device, Validate Number) bersifat opsional / bagian dari roadmap Master‑Pool Anda.

Dokumen ini sudah saya simpan ke `DOCS/laporan-review-fonnte-api-implementation.md` untuk referensi tim. Jika kamu ingin, saya lanjutkan ke **Fase 1 (buka webhook device‑status + invalidate cache + dashboard visibilitychange)** — itu perubahan minimal dan langsung memperbaiki keluhan. Mau saya jadwalkan?
