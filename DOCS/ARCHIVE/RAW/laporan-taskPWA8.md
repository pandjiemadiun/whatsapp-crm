# Laporan Task P-PWA.8 — Implementasi Web Adapter

**Scope:** 1 file baru (`apps/api/src/routes/pwa.ts`) + perubahan minimal di
`conversation.service.ts` (fix fallback `customerPhone` untuk channel `web`).
**Tidak tersentuh:** `message-processor.service.ts`, `webhooks.ts`, gateway WA,
`sendWithPresence`/gateway kirim WA, circuit breaker / idempotency-key / realtime
(itu Fase 1 lanjutan).

Lingkungan: repo `/home/ubuntu/garuda`; API cwd `/home/ubuntu/garuda/apps/api`;
Node `tsx` + Jest (ESM via `node --experimental-vm-modules`); API jalan di
`localhost:3000` (pm2, pid `285348` pada akhir sesi). DB = PostgreSQL via
`DATABASE_URL` (redacted). Catatan: `tsc`/`npm run build` **harus** dijalankan
dari `apps/api` (root tak ada tsconfig).

---

## Langkah 1 — Fix fallback `customerPhone` (conversation.service.ts:75)

Audit P-PWA.7 menemukan fallback `customerPhone: customerId` yang, bila
`processCustomerMessage(..., 'web')` dipanggil dengan `customerId = webUid`,
akan menaruh `webUid` ke kolom `customerPhone` (bukan nomor WA). Trace audit
memastikan `customerPhone` tidak dipakai buat matching/lookup di file ini
(pakai hanya disimpan/propagated/select — lihat P-PWA.7 poin 2).

Perubahan 1 baris di blok `upsert` create (WA: tetap `customerId` = phone asli;
Web: `null`). Signature `processCustomerMessage` tidak berubah (pakai
parameter `channel` yang sudah ada di line 64).

`apps/api/src/business/conversation.service.ts:75`:
```ts
        customerPhone: channel === 'web' ? null : customerId, // WA: pakai customerId(=phone asli); Web: null (bukan webUid)
```

`git diff` → **hanya** line 75 berubah (1 ins / 1 del), semua usage lain
`customerPhone` (line 41, 1176, 1184, 1278, 1326, 1357) utuh:
```
 apps/api/src/business/conversation.service.ts | 2 +-
-        customerPhone: customerId, // Fallback nilai phone dengan customerId
+        customerPhone: channel === 'web' ? null : customerId, // WA: pakai customerId(=phone asli); Web: null (bukan webUid)
```

Trace 3 caller (dari audit P-PWA.7) — semua tetap kirim `channel='whatsapp'`
(default atau eksplisit), sehingga behavior lama WA **tak berubah**:
- `message-processor.service.ts:257` (`processCustomerMessage(...)` tanpa argumen
  channel → default `'whatsapp'`).
- `routes/messages.ts:39` (WA path, default `'whatsapp'`).
- `tests/golden-dataset.test.ts:235` (eksplisit `'whatsapp'`).

`dist/business/conversation.service.js:27` (setelah build) memuat perbaikan:
`customerPhone: channel === 'web' ? null : customerId`.

Catatan: file ini hanya berinteraksi dengan `customerPhone` untuk
*store/propagate/select* (line 75 create, 1176/1184/1278/1326/1357), **tidak**
dipakai untuk matching/lookup di dalam file ini sendiri — konfirmasi audit
P-PWA-7 poin 2.

---

## Langkah 2 — `routes/pwa.ts` (file baru)

Tiga endpoint sesuai blueprint §3 Fase 2. Import: `prisma`
(`../infrastructure/prisma.js`), `conversationService`
(`../business/conversation.service.js`), `messageQueueService`
(`../services/message-queue.service.js`), `conversationLimiter`
(`../middleware/rate-limiters.js`), `adapters` (`../adapters/container.js`).

### `GET /:storeSlug/init`
- `prisma.store.findUnique({ where: { slug, deletedAt: null }, select: PWA_STORE_PUBLIC_SELECT })`
  (resolver by-slug belum ada sebelumnya; dibuat di sini).
- 404 bila slug null/tak ditemukan.
- `PWA_STORE_PUBLIC_SELECT` memilih **hanya** field publik-aman per blueprint §4:
  `name, slug, profilePhotoUrl, description, businessCategory, address,
  timezone, operatingHours, acceptsQris, acceptsCod, acceptsTransfer,
  qrisImageUrl, shippingMode, shippingFlatInCity, shippingFlatOutCity, isActive`.
- Field terlarang (`phoneNumber, whatsappPhoneId, fonnteToken, fonnteNumber,
  webhookSecret, email`, plus `config/responseTemplate/...`) **tidak** termasuk
  via `select`.

### `GET /:storeSlug/history?uid=<webUid>`
- Resolve Store by slug; 404 bila tak ketemu.
- Resolve Customer by `webUid` + `storeId` (pola baru — belum ada di kode
  existing, lihat audit P-PWA.5).
- Bila Customer / Conversation tidak ada → kembalikan `history: []`
  (**bukan** 404; visitor pertama kali kondisi normal).
- `findFirst` Conversation `channel='web'`, lalu
  `prisma.conversationHistory.findMany({ where: { conversationId }, orderBy:
  { createdAt: 'asc' } })` — pola sama `routes/conversations.ts:41-51`,
  channel-agnostic karena sudah difilter by `conversationId`.

### `POST /:storeSlug/message` — body `{ uid, message }`
- `conversationLimiter` (rate limit publik).
- Validate `{ uid, message }`; 400 bila kosong.
- `prisma.store.findUnique({ where: { slug } })` → 404 bila tak ketemu.
- **Resolve-or-create Customer** by `webUid`+`storeId` (`findFirst` → `create`
  dengan `phone: null`). Race P2002 (`Customer.webUid @unique` di schema) ditangkap
  → re-fetch (visitor lama reuse record). `phone` tetap `null`.
- **Resolve-or-create Conversation**: `findFirst` `channel='web'` untuk
  `Customer+Store`; hanya `create` bila belum ada. Web memakai UUID
  (default Prisma), **bukan** pola `storeId:customerPhone` (itu pola WA).
  `create` dengan `channel: 'web'`, `customerPhone: null`, `status: 'open'`.
- **Mutex per-conversation SEBELUM engine** — pola PERSIS
  `message-processor.service.ts:161-171`:
  ```ts
  const release = messageQueueService.acquireLock(conversationId);
  if (!release) return res.status(429).json({ error: 'Conversation is being processed, please retry', conversationId });
  try { const result = await conversationService.processCustomerMessage(store.id, customerId, conversationId, message, 'web'); ... }
  finally { release(); }
  ```
- Memanggil `conversationService.processCustomerMessage(...)` secara langsung —
  **bukan** lewat `messageProcessorService` / gateway WA / `sendWithPresence`.
- Response JSON berisi `conversationId`, `content` (result.message.content),
  `source`, `confidence`, `timestamp`. Bila `result` null →
  `{ success: true, message: null, status: 'pending_human' }` (bukan 500).
- Terakhir `finally { release(); }` melepaskan lock.

---

## Langkah 3 — Registrasi route

`apps/api/src/index.ts`:
```ts
import pwaRouter from './routes/pwa.js';          // line 40
...
// Web Adapter (P-PWA.8) — public endpoints, no auth, CORS untouched (blueprint §5)
app.use('/api/pwa', pwaRouter);                    // setelah productsRouter mount (line ~124)
```
Route dipasang **public** (tidak melewati `authMiddleware`); konfigurasi CORS
(`index.ts:74-77`) disengaja **tidak** disentuh (lihat Known Limitations).

---

## Langkah 4 — Acceptance gate (RAILS §5)

### 4a. `tsc --noEmit` (cwd `apps/api`) → **0 error**
```
=== tsc errors: 0 ===
```
Catatan: awalnya 1 error `Cannot find module '../services/rate-limiters.js'`
(dipindah ke `../middleware/rate-limiters.js` — lokasi sebenarnya
`src/middleware/rate-limiters.ts`). Setelah perbaikan → 0 error.

### 4b. `npm run build` (`tsc`, cwd `apps/api`) → **exit 0**
`dist/routes/pwa.js` ada; `dist/index.js` mengandung `pwaRouter` (import +
`app.use('/api/pwa', pwaRouter)` — 2 referensi). `dist/business/conversation.service.js:27`
memuat `customerPhone: channel === 'web' ? null : customerId`.

### 4c. Tests (`npm run test:chat`) — **tidak ada regresi**
`conversation.service.ts` change adalah *web-only*; suite chat **tidak import**
`conversation.service.ts` (diverifikasi via grep). `pwa.ts` juga tidak di-import
oleh suite chat. Baseline (src di-stash) vs. setelah perubahan — identik:

| | Sebelum (stashed) | Sesudah akhir |
|---|---|---|
| Suites | 2 failed, 21 passed, 23 total | 2 failed, 21 passed, 23 total |
| Tests  | 1 failed, 260 passed, 261 total | 1 failed, 260 passed, 261 total |

- 2 failed suites = `reasoning-v2.test.ts` + `engine-config-v2.test.ts`
  (pre-existing per RAILS §6: I-V2-6 label mismatch + circular-dep redisAdapter).
- 1 failed test = `✕ Validator reject terminal (low confidence) → fallback, llmCalls=1, JANGAN retry`
  di `reasoning-v2` (pre-existing, tidak berkaitan web adapter).

> ⚠️ Invocation yang ditolak: `npx jest --config jest.config.cjs` langsung gagal
> semua suite (ESM/babel). Harus `npm run test:chat` =
> `node --experimental-vm-modules ./node_modules/.bin/jest`.

### 4d. `git diff --stat` (source saja, kecuali `dist`)
```
 apps/api/src/business/conversation.service.ts | 2 +-
 apps/api/src/index.ts                         | 4 ++++
```
(`pwa.ts` baru — untracked, akan di-`add` di commit.) `git diff --stat` (unstaged)
**tidak** termasuk `dist/**` / `logs/*` — dibiarkan unstaged (lihat §Hygiene).

### 4e. `pm2 restart api` → **online, tidak crash-loop**
```
│ 0 │ api │ fork │ pid 285348 │ uptime 10s+ │ ↺ 71 │ online │ 166.5mb │
```
`GET /api/health` → `{"status":"ok","message":"All systems operational"}`.

### 4f. E2E manual (live, `localhost:3000`, dummy store `pwa8-e2e-test`)

**GET /init** → 200, body mengandung **hanya** field publik (dikompilasi dari
`PWA_STORE_PUBLIC_SELECT`): `name, slug, profilePhotoUrl, description,
businessCategory, address, timezone, operatingHours, acceptsQris, acceptsCod,
acceptsTransfer, qrisImageUrl, shippingMode, shippingFlatInCity,
shippingFlatOutCity, isActive` — **tidak ada** field terlarang
(`phoneNumber/whatsappPhoneId/fonnteToken/fonnteNumber/webhookSecret/email`).

**POST /message** `{"uid":"web_pwa8_e2e2","message":"Halo, ada diskon kopi?"}` → 200:
```json
{ "success": true,
  "conversationId": "d96cc770-1811-41b9-bbfe-e9d21d9d73fa",
  "content": "Apakah Anda ingin mengetahui informasi tentang kopi atau produk lainnya?",
  "source": "sop",
  "confidence": 0.85,
  "timestamp": "2026-08-11T23:59:16.350Z" }
```

**DB readback** (`pwa8-verify2.ts`, Prisma query langsung):
```
CUSTOMER={"id":"dfcbcc6d-638d-4a8b-8684-513a2618c576","phone":null,"webUid":"web_pwa8_e2e2","name":null}
CONVERSATION={"id":"d96cc770-1811-41b9-bbfe-e9d21d9d73fa","customerPhone":null,"channel":"web","status":"open","customerId":"dfcbcc6d-..."}
HISTORY_COUNT=2
HISTORY=[{"role":"user","content":"Halo, ada diskon kopi?","source":null,...},
         {"role":"assistant","content":"Apakah Anda ingin mengetahui informasi tentang kopi atau produk lainnya?","source":"sop",...}]
```
Bukti: `customerPhone: null` (bukan `webUid`) untuk channel `web`; `channel: web`;
`phone: null` pada Customer. ✅

**GET /history?uid=web_pwa8_e2e2** → 200, 2 pesan (user + assistant, source sop),
diurutkan `createdAt asc`:
```json
{ "success": true, "data": { "history": [
  {"id":"d8fb53e1-...","role":"user","content":"Halo, ada diskon kopi?","source":null,"createdAt":"...:350Z"},
  {"id":"a1d6a1d2-...","role":"assistant","content":"Apakah Anda ingin mengetahui...","source":"sop","createdAt":"...:350Z"}
] } }
```

### Mutex / race analysis (Langkah 4e — carry-over dari P-PWA.7 poin 1)

`acquireLock` (`apps/api/src/services/message-queue.service.ts:167-176`) adalah
**public method** pada class `MessageQueueService` yang **exported & di-instantiate
sebagai singleton** (`messageQueueService` di `message-queue.service.ts:415`).
- Storage: in-memory `Map<string, boolean>` (`processingLocks`, line 152) — **bukan**
  Redis.
- Key: `lock:${chatId}` di mana `chatId = input.conversationId`
  (`message-processor.service.ts:96-98`).
- **Reusable**: tidak private method di `MessageProcessorService`; dapat dipanggil
  langsung via singleton `messageQueueService` (itu yang dilakukan `pwa.ts`). → "sudah
  reusable" (bisa pakai langsung; bukan standalone utility function, tapi singleton
  service yang diekspor).

Race test — 2 request POST `/message` **paralel**, uid+conversationId sama
(`uid=web_pwa8_e2e2`, conversationId sudah ada `d96cc770-...`):
```
REQ1 -> HTTP 200  {"success":true,"conversationId":"d96cc770-...","content":"...","source":"sop","confidence":0.85,...}
REQ2 -> HTTP 429  {"error":"Conversation is being processed, please retry","conversationId":"d96cc770-..."}
```
**Interpretasi:** `acquireLock(conversationId)` (pola `message-processor.service.ts:161-171`)
mencegah race — REQ1 memegang lock selama `processCustomerMessage`, REQ2 gagal
`acquireLock` → `null` → 429 (tidak sampai memproses ganda). **Mutex berhasil mencegah
race condition** untuk concurrent request yang sama. ✅

> Catatan teknis (tidak ada redesign): di implementasi *minimal* yang dipilih,
> `acquireLock` pada `conversationId` adalah satu-satunya mutex di jalur web
> (tidak ada resolve-lock terpisah). Ini sengaja **tidak** menambahkan
> idempotency-key/circuit-breaker (diluar scope, Fase 1). Dua request *new-uid*
> yang nyaris bersamaan (belum ada Conversation) tetap memiliki race
> double-create pada Conversation (tidak ada `@@unique` di schema untuk
> `(storeId,customerId,channel)`); hal ini adalah *known limitation*, dikerjakan
> oleh Client retry + `P2002` catch pada Customer (`webUid @unique`), dan akan
> diselesaikan di Fase 1 (idempotency-key) — **tidak** disarankan desain baru
> di laporan ini.

---

## Cleanup

DB dummy (`store` slug `pwa8-e2e-test` → `storeId=store-pwa8-e2e`) dihapus dalam
urutan `conversationHistory → conversationContext → order → conversation →
customer → store`, lalu diverifikasi 0 tersisa:
```
CLEANUP before: history=0 conversation=2 customer=2 (storeId=store-pwa8-e2e)
CLEANUP after:  history=0 ctx=0 order=0 conversation=0 customer=0 store=0
CLEANUP_OK
```
Skrip throwaway (`pwa8-probe.ts, pwa8-setup.ts, pwa8-verify.ts, pwa8-verify2.ts,
pwa8-cleanup.ts, race-test.js`) sudah **dihapus**; tidak ada yang dilacak oleh git.

---

## Known Limitations (diluar scope TASK ini, tidak diredesain)

1. **CORS whitelist** (`index.ts:74-77`) tidak diperluas untuk origin produksi
   PWA — endpoint akan error CORS dari origin produksi sampai dikonfigurasi
   terpisah (blueprint §5). Disengaja tidak disentuh.
2. **Hygiene git**: `apps/api/dist/**` (termasuk `dist/routes/pwa.js`) dan
   `apps/api/logs/*.log` **sudah terlacak** sebelumnya (RAILS §6) dan **tidak
   akan disertakan** dalam commit ini — dibiarkan unstaged.
3. **Double-create race new-uid** (lihat Mutex/race analysis) — dikerjakan di
   Fase 1 (idempotency-key); bukan scope P-PWA.8.

---

## Ringkasan commit

Stage **hanya**: `apps/api/src/routes/pwa.ts` (baru),
`apps/api/src/business/conversation.service.ts` (1 line),
`apps/api/src/index.ts` (import+mount), `DOCS/laporan-taskPWA8.md` (baru).
Pesan commit:
`feat(PWA.8): Web Adapter — routes/pwa.ts (init/history/message) + fix customerPhone fallback untuk channel web`
