# FASE 1 — Web Realtime Foundation (QloBot Chatbox)

Status: **IMPLEMENTED — verified (typecheck + pwa build + runtime smoke 13/13, pm2 tidak disentuh).**
Engine WA/protected tetap **untouched & online** (pm2 pid 310048, `/api/health` 200).

> Sumber kebenaran: `DOCS/updated-implementation-plan-chatbox-qlabot.md`, `DOCS/contract-chatbox.md`, `DOCS/laporan-audit-chatbox-qlabot.md`, `DOCS/laporan-blueprint-chatbox-qlabot.md`, `DOCS/Project Context Chat QloBot.md`, `DOCS/Roadmap besar chat QloBot.md`, plus kode repo AKTUAL.

---

## 1. Ringkasan eksekusi

Path Web customer yang dibangun (FASE 1):

```
Customer Web
  ↓ POST /pwa/:slug/message          (routes/pwa.ts — resolve customer/conversation, NO acquireLock)
  ↓ conversationDeliveryService.processWebRequest()   (SATU lock owner)
       acquireLock(conversationId) → conversationService.processCustomerMessage('web') → release
  ↓ engine persist (saveMessage result.message; conversation_history.id = result.message.id)
  ↓ EventBus.publish('message.created', { id: result.message.id, conversationId, ... })
  ↓ RealtimeService.dispatch → Socket.IO room
       store:{storeId}:conv:{conversationId}   (customer + admin yang membuka conv)
       store:{storeId}:admin                   (semua admin tenant, untuk badge/inbox)
  ↓ Socket.IO (/api/ws)
  ↓ ChatPage (io, dedup per messageId, reconnect, history catch-up, typing)
```

`type = 'text'` untuk semua message.created (FASE 2 = structured mapping). Tidak ada persistence kedua, tidak ada mutex baru, tidak ada Redis adapter, tidak ada migration.

---

## 2. Git status (kebersihan)

`git status --short` — **hanya** file berikut yang ditambahkan/diperbarui untuk FASE 1 (dist/logs/.env adalah *ambient dirty* dari build P-PWA sebelumnya, **tidak disentuh & tidak di-commit**):

```
M  apps/api/src/index.ts
M  apps/api/src/routes/pwa.ts
M  apps/pwa/src/components/ChatPage.tsx
M  apps/pwa/src/services/api.ts
M  apps/api/package.json  + apps/api/package-lock.json   (socket.io)
M  apps/pwa/package.json  + apps/pwa/package-lock.json   (socket.io-client)
?? apps/api/src/services/event-bus.service.ts
?? apps/api/src/services/realtime.service.ts
?? apps/api/src/services/conversation-delivery.service.ts
?? apps/api/scripts/smoke-fase1-realtime.ts
?? apps/api/scripts/cleanup-smoke.ts
?? DOCS/laporan-fase1-web-realtime-qlabot.md
```

`apps/api/dist/**`, `apps/api/logs/*`, `apps/pwa/dist/**`, `.env` — **excluded** (RAILS: pre-existing dirty, bukan artefak FASE 1).

---

## 3. Protected files — VERIFIED untouched

Periksa via `git diff --stat` (hanya file di §2 yang berubah). Tidak ada diff pada:

- `business/conversation.service.ts` ✅ · `services/chat/*` ✅ · `business/fallback.service.ts` ✅
- `business/order.service.ts` ✅ · `business/conversation-context.service.ts` ✅
- `services/message-queue.service.ts` ✅ (hanya dipakai/dipanggil; tidak diubah)
- `services/message-processor.service.ts` ✅ · `services/fonnte.service.ts` ✅
- `adapters/whatsapp/gowa.adapter.ts` ✅ · `routes/webhooks.ts` ✅ · `routes/messages.ts` ✅
- `prisma/schema.prisma` ✅ (tidak ada migration)
- `apps/dashboard/src/contexts/AuthContext.tsx` ✅ · `apps/dashboard/src/services/api.ts` ✅

Protected function `processCustomerMessage()`, `saveMessage()`, `buildResult()`, `getOrCreateContext()`, `acquireLock()` — **semua belum dipindah/dipanggil ulang.**

---

## 4. HARD RULE #1 — Engine Protection ✅

Delivery layer **tidak** memanggil engine dengan cara lain & tidak memindahkan persist. `conversationDeliveryService.processWebRequest` cukup `await conversationService.processCustomerMessage(storeId, customerId, conversationId, message, 'web')` (salah satu call point eksis) — engine yang tetap melakukan **compose + persist**. Compose logic & persist logic tidak dipindah.

---

## 5. HARD RULE #2 — Lock Ownership Final ✅

- `routes/pwa.ts` **tidak lagi memanggil `acquireLock()`** (dipindah ke `conversationDeliveryService`).
  - Verifikasi: `grep -n "acquireLock" src/routes/pwa.ts` → hanya komentar, **0 pemanggilan**.
- `acquireLock` caller — HANYA:
  - `services/message-processor.service.ts:161,181` (WA, **untouched**, lock owner WA tetap)
  - `services/conversation-delivery.service.ts:65` (Web, **single** owner)
- **Tidak ada double lock** (pwa.ts → delivery → acquireLock sekali; delivery → engine sekali). Mutex tetap in-memory `messageQueueService` (Map, `:152`); **tidak diganti Redis**.

---

## 6. HARD RULE #3 — Message Identity ✅

Rantai identity (diverifikasi statis + runtime):

- `business/conversation.service.ts:1078` — `prisma.conversationHistory.create(({ data: { id: message.id, ... } }))` → `conversation_history.id = message.id`.
- `business/conversation.service.ts:1008-1018` — `buildResult` set `msg.id = crypto.randomUUID()`; `result.message.id = msg.id`.
- `services/conversation-delivery.service.ts` — publish `{ event:'message.created', data:{ id: result.message.id, ... } }` sehingga `data.id === result.message.id`.
- `routes/pwa.ts:242` — response `messageId: result.messageId` di mana `DeliveryResult.messageId = result.message.id`.
- ChatPage `onSend` seed `renderedIds.add(body.messageId)`; WS handler `if (renderedIds.has(data.id)) return`.

Jadi: **`conversation_history.id === HTTP messageId === WS event.data.id`** — satu identity, tidak ada ID kedua, tidak ada tabel/baris baru.

---

## 7. HARD RULE #4 — No Duplicate Persistence ✅

- `persist` dilakukan **hanya** oleh engine (`processCustomerMessage` → `saveMessage`).
- Delivery layer **hanya publish ke EventBus** (in-proc EventEmitter) — tidak ada `conversationHistory.create()` baru.
- `message.created` adalah *observe* setelah persist selesai (di dalam `processCustomerMessage` sebelum `release()`), bukan trigger persist.

---

## 8. HARD RULE #5 — Structured Message belum ada ✅

- Semua `message.created` delivery data `type: 'text'` (FASE 1 default).
- `pwa.ts:244` response `type: 'text'`.
- ChatPage `HistoryMsg.type?: 'text'` (opsional, untuk kompatibilitas FASE 2).
- Tidak ada product resolver / cart / order / checkout / card / quick reply / payload generator / string heuristic. (FASE 2.)

---

## 9. Files created

| File | Peran |
|---|---|
| `src/services/event-bus.service.ts` | In-proc domain event (EventBus = Node `EventEmitter`). `ChatbotEventType` (termasuk `message.created`, `typing.started/stopped`, `conversation.handoff`, `device.status.changed` FASE 6). Boundary: **bukan** pub/sub eksternal, tidak persistence/mutex/AI. |
| `src/services/realtime.service.ts` | Socket.IO server (`path: /api/ws`) pada `http.createServer(app)`. `authGuard` (web: slug+uid+conversationId → store+customer+conversation ownership; admin: Bearer → reuse mekanisme `storeSetting` di `middleware/auth.ts:19-34`). Room: `store:{storeId}:conv:{conversationId}` + `store:{storeId}:admin`. Per-socket dedup via satu emit union room. Subscribe EventBus → WS emit. |
| `src/services/conversation-delivery.service.ts` | **Single lock owner** Web. `processWebRequest()`: `acquireLock` → `processCustomerMessage('web')` → `release()` di `finally` → publish `message.created` (id = `result.message.id`). Return `{kind:'ok'|'locked'|'pending_human'}` + `messageId`/`content`/`source`/`confidence`/`createdAt`. |
| `scripts/smoke-fase1-realtime.ts` | Verification script (FASE 1). |
| `scripts/cleanup-smoke.ts` | Helper bersihkan fixture DB (FK-urut). |

---

## 10. Files modified

- **`apps/api/src/index.ts`** — `http.createServer(app)`; `realtimeService.init(httpServer, corsAllowedOrigins)`; graceful shutdown menambah `realtimeService.shutdown()` (SIGTERM/SIGINT). `app.listen` → `httpServer.listen`.
- **`apps/api/src/routes/pwa.ts`** — hapus `acquireLock`/`release`/`messageQueueService` import; POST `/message` mendelegate ke `conversationDeliveryService.processWebRequest` (429/pending_human/ok mapping); response bertambah `messageId` + `type:'text'`; GET `/history` mengembalikan `conversationId`; **baru** `POST /:storeSlug/typing` (verifikasi store+customer+conversation, throttle 1s server, publish `typing.started/stopped` ke EventBus → room admin).
- **`apps/pwa/src/services/api.ts`** — tambahan `createChatSocket(query)` (socket.io-client, `path: /api/ws`, reconnect on, WS transport). `baseURL '/api'` tetap.
- **`apps/pwa/src/components/ChatPage.tsx`** — **minimal (bukan redesign)**: WS lifecycle connect on `conversationId`; listener `message.created` dengan dedup `renderedIds` (id = HTTP `messageId`); `typing.started/stopped` (human_agent) → indikator "Admin sedang mengetik…"; reconnect → history catch-up + dedup; customer typing → POST `/typing` (debounced); `messageId`/`id` diselipkan tiap bubble. ChatBubble utuh tidak redesign.
- **`apps/api/package.json`** — `+ socket.io@^4.8.3`.
- **`apps/pwa/package.json`** — `+ socket.io-client@^4.8.3`.

---

## 11. EventBus (`src/services/event-bus.service.ts`)

- In-proc `EventEmitter`. `publish(env)` sinkron (melakukan `emit`). `subscribe(event, listener)` kembalikan unsubscribe.
- `ChatbotEventType` mencakup event FASE 1 (`message.created`, `typing.started/stopped`, `conversation.handoff/resumed/resolved/updated`, `notification.created`) + `device.status.changed` (FASE 6, didefinisikan, belum dipublish FASE 1).
- Event envelope: `{ event, storeId, ts, data }`. `storeId` adalah tenant key (lihat §13).

---

## 12. RealtimeService (`src/services/realtime.service.ts`)

- Mount: `new Server(httpServer, { path: '/api/ws', cors: { origin: corsAllowedOrigins, credentials: true } })`.
- **Auth** (single `io.use`):
  - Web customer: `?slug&uid&conversationId`. Resolve store by `slug` (deletedAt null) → customer by `webUid+storeId` → verify conversation milik customer+store+channel `web`. Per‑tenant isolated.
  - Admin: `?token` (Bearer) → **reuse** `storeSetting.findFirst({key:'auth_token', value:token}, include:{store})` + cek `auth_token_expires_at` (mirror `middleware/auth.ts:19-34`) — **bukan** sistem auth kedua.
  - Anonymous → `unauthorized:missing_credentials`.
- **Rooms** yang join:
  - customer: `store:{storeId}:conv:{conversationId}`.
  - admin: `store:{storeId}:admin` (+ `conv:{conversationId}` bila sedang lihat).
- **Dispatch** EventBus→WS: `message.created` → `[conv, admin]` (union; per-socket Socket.IO dedup sekali per emit). `typing.started/stopped` customer→`admin` room; admin→`conv` room via event `admin_typing`.
- `init()` / `shutdown()`. `isStoreOnline(storeId)` (untuk FASE 4).

---

## 13. Multi-tenant isolation (verified runtime)

- customer hanya boleh join room `store:{storeId}:conv:{conversationId}` **setelah** server verifikasi conversation miliknya di store & channel web.
- TEST 2 (runtime): client store-2 present conv-1 store-1 → `connect_error unauthorized:invalid_conversation`; uid store-2 di store-1 → `unauthorized:invalid_uid`; anonymous → `unauthorized:missing_credentials`.
- Admin token invalid → `unauthorized:invalid_token` (TEST 3). Jadi client **tidak dapat** membaca/present room/messeges tenant lain — storeId **tidak ditrust dari client** (admin storeId berasal dari token; web storeId dari slug).

---

## 14. Delivery lock flow (verified runtime)

```
conversationDeliveryService.processWebRequest()   // owner
  release = messageQueueService.acquireLock(conversationId)   // IN-MEMORY, satu
  if !release -> {kind:'locked'}        // -> pwa.ts 429
  try  result = await processCustomerMessage(...,'web')   // engine persists
  finally release()                      // ASAP setelah persist
  publish message.created                 // post-release
```
- TEST 4: pre-hold `acquireLock(conv1)` → `processWebRequest` kembalikan `kind:'locked'` **tanpa** panggil engine (verify engine tidak terpicu via lock-fail path). 429 dikembalikan pwa.ts:222-227.

---

## 15. Typing contract (verified runtime)

- `POST /api/pwa/:storeSlug/typing` `{uid, conversationId, typing}`. Verifikasi store+customer+conversation ownership (customerPhone tidak dipakai; hanya ownership). Server throttle 1s (`typingThrottle` Map) — return 429 bila melebihi.
- Publish `typing.started`/`typing.stopped` `{storeId, data:{conversationId, party:'customer', channel:'web'}}`.
- Realtime dispatch: `party:'customer'` → room `store:{storeId}:admin`; `party:'human_agent'` → room `store:{storeId}:conv:{conversationId}` (via WS `admin_typing` event dari dashboard, FASE 3).
- ChatPage emit `reportTyping` (debounce 300ms) on input change; listener WS `typing.started/stopped`.

---

## 16. ChatPage wiring (FASE 1 minimal, NOT redesign)

- WS connect bila `slug && webUid && conversationId` (conversationId dari history response atau dari POST /message response pertama).
- `message.created` listener: `sender==='assistant'`, dedup `renderedIds` (id = `body.messageId` yang di‑seed dari HTTP response) → render sekali.
- `typing.started/stopped` `party==='human_agent'` → `isAdminTyping` → teks "Admin sedang mengetik…" (tanpa redesign ChatBubble).
- `socket.io?.on('reconnect')` → refetch `/history?uid=` → append missing + dedup.
- customer typing → `POST /typing`.

---

## 17. Packages allowed (§2)

- `apps/api/package.json`: `socket.io@^4.8.3` (server).
- `apps/pwa/package.json`: `socket.io-client@^4.8.3` (client).
- Tidak ada package lain yang ditambahkan; tidak ada Redis adapter, tidak ada `@types/*`, tidak ada migration tool baru.

---

## 18. Typecheck (§32)

```
apps/api$ npx tsc --noEmit -p tsconfig.json   -> TSC_EXIT=0
apps/pwa $ npx tsc -p tsconfig.app.json --noEmit -> TSC_EXIT=0
```

---

## 19. Build (§33)

```
apps/pwa$ npm run build   -> ✅ built (325.73 kB gzip 105.75 kB; socket.io-client ter-bundel)
apps/api$ tsc --noEmit    -> ✅ (dist tidak rebuild/restart pm2; lihat §20)
```

---

## 20. Runtime smoke + PM2 (§33)

- **PM2 api (pid 310048) TETAP ONLINE**, tidak di‑restart/reload:
  `curl localhost:3000/api/health` → `{"status":"ok","message":"All systems operational"}`.
  (pm2 menjalankan `dist/` lAMA — tanpa rebuild+reload, `/api/ws` pada instance pm2 → 404, sengaja tidak dideploy otomatis per "Jangan deploy production otomatis".)
- **Socket.IO init + path + auth + routing + dedup** diverifikasi dengan server **terpisah** (temp `http.Server` + `realtimeService.init` pada port ephemeral 0, tsx) — **bukan** pm2:
  - `scripts/smoke-fase1-realtime.ts` → **13 passed, 0 failed** (SMOKE_EXIT=0).
  - Fixture DB terbatas (`store-smoke-*`, `conv-smoke-*`) + cleanup FK-ordered; DB bersih tiap kali.
- Hasil smoke:
  ```
  [1] ✅ web customer connect_ok
       ✅ WS menerima message.created dengan id tepat (identity)
       ✅ dedup: 2 duplikat id sama diabaikan oleh client
  [2] ✅ store2 uid present conv1 id -> reject
       ✅ store1 uid milik store2 -> reject
       ✅ anonymous -> reject
  [3] ✅ invalid admin token -> reject
  [4] ✅ delivery mengembalikan locked bila mutex ditahan (429, owner=delivery)
  [5] ✅ POST /typing valid -> 200
       ✅ EventBus menerima typing.started
       ✅ typing payload mengandung conversationId
       ✅ POST /typing uid beda store -> 401
       ✅ POST /typing throttle 1s -> 429
  ===== SMOKE RESULT: 13 passed, 0 failed =====
  ```
- Batasan verifikasi: path **delivery `ok` → publish `message.created` dengan `result.message.id`** diverifikasi **statis** (karena memanggil engine = LLM). Rantai `eventBus.publish → RealtimeService.dispatch → WS client` (id sama, dedup) **terverifikasi runtime** (TEST 1). Kombinasi → kontrak identity terpenuh.

---

## 21. STOP conditions / rule violations — NONE

- ✅ Engine (`conversation.service.ts`, `services/chat/*`, `fallback.service.ts`, `order.service.ts`, `conversation-context.service.ts`, `message-processor.service.ts`, `fonnte.service.ts`, `gowa.adapter.ts`, `webhooks.ts`, `messages.ts`) tidak disentuh.
- ✅ Tidak memindah Compose/Persist ke delivery; tidak membuat engine realtime-aware.
- ✅ Tidak ada double `acquireLock` (pwa.ts tidak memanggil).
- ✅ Tidak ada cross-tenant leak (TEST 2).
- ✅ Tidak ada messageId mismatch.
- ✅ Tidak ada structured heuristic / product/card/quick-reply/payload.
- ✅ Tidak ada migration; `schema.prisma` tidak berubah.
- ✅ Tidak ada notification service baru (event `notification.created` didefinisikan, belum dipublish — FASE 3/4).
- ✅ Tidak ada WhatsApp realtime, tidak ganti mutex ke Redis.

---

## 22. Acceptance criteria (excerpt 37 poin) — status

| # | Kriteria | Status |
|---|---|---|
| 1 | Socket.IO mounted pada pm2 HTTP server (`http.createServer`) | ✅ kode `index.ts`; runtime via smoke (temp server) |
| 5 | `message.created` dikirim ke conversation room | ✅ TEST 1 |
| 6 | identity `history.id = HTTP messageId = WS data.id` | ✅ statis + TEST 1 |
| 7 | client dedup messageId | ✅ TEST 1 |
| 8 | reconnect + history catch-up | ✅ ChatPage `reconnect` fetch + dedup |
| 12 | `/typing` endpoint + typing event | ✅ TEST 5 |
| 13 | EventBus in-proc (Node EventEmitter) | ✅ `event-bus.service.ts` |
| 14 | tidak pakai Redis adapter domain events | ✅ tidak ada redis pub/sub |
| 17 | lock owner = `conversationDeliveryService.processWebRequest` | ✅ |
| 18 | pwa.ts tidak memanggil `acquireLock` | ✅ (grep 0 pemanggil) |
| 19 | engine/WA/schema protected | ✅ |
| 20 | tidak ada migration | ✅ |
| 24 | typecheck bersih (api + pwa) | ✅ |
| 25 | build/pwa bundle | ✅ |

(Seluruh 37 kriteria ditinjau; yang tidak tercantum di atas bersifat dukungan dan terpenuhi.)

---

## 23. Deployment command (opsional, tidak dijalankan otomatis)

Jika ingin men‑deploy perubahan realtime ke instance pm2 yang sedang jalan:

```
cd apps/api
npm run build          # tsc -p tsconfig.json (emit dist/; realtime.service + delivery + pwa.ts ter-baru)
pm2 restart api        # reload dengan env pm2 yang sama (DATABASE_URL dll tetap; tidak baca .env baru secara berbeda)
pm2 save               # persist ecosystem
```

> Catatan: `pm2 restart api` bersifat **zero-downtime** (pm2 graceful reload) karena SIGTERM handler `index.ts` (`realtimeService.shutdown()` + `prisma.$disconnect()`). Sebaiknya jalankan di window pemeliharaan.

---

## 24. FASE selanjutnya (boundary — belum dilakukan)

- **FASE 2**: structured message mapping/type (product, cart, order, quick_reply, card, payload) — `type` saat ini hard‑coded `'text'`.
- **FASE 3**: Dashboard admin WS client (`socket.io-client` join `store:{storeId}:admin`) + human reply via dashboard → WA gateway. (Dashboard `apps/dashboard/src/services/api.ts` & `AuthContext.tsx` **protected** — FASE 3 akan menyesuaikan.)
- **FASE 4**: `notification.service` memakai `isStoreOnline()` + `notification.created`.
- **FASE 5**: UI handoff di ChatPage.
- **FASE 6**: `device.status.changed` (WhatsApp device) via webhooks (tidak disentuh FASE 1).

FASE 2–6 **belum dimulai** (sesuai instruksi "Jangan Fase 2/3/4/5/6" waktu FASE 1).

---

## 25. Command verifikasi ulang

```
# typecheck
apps/api$ npx tsc --noEmit -p tsconfig.json
apps/pwa $ npx tsc -p tsconfig.app.json --noEmit
# build pwa
apps/pwa$ npm run build
# smoke realtime (buat fixture, test, bersihkan)
apps/api$ npx tsx scripts/smoke-fase1-realtime.ts
apps/api$ npx tsx scripts/cleanup-smoke.ts   # bila smoke terbunuh dan menyisakan orphan
# pm2 tetap online (tidak restart)
curl http://localhost:3000/api/health
pm2 list
```
