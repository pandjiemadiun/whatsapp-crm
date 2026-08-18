# IMPLEMENTATION PLAN — QLOBOT CHATBOX
## Structured Message + Web Realtime + Human Handoff + Notification
### (DESIGN / PLAN ONLY — tidak mengedit source, tidak install/migrate/commit)

**Baseline yang disetujui:** `DOCS/laporan-blueprint-chatbox-qlabot.md`
**Fakta verifikasi tambahan (read‑only) terhadap repository:** lihat §1 (discrepancy table) + anker fakta tiap fase.

> Prinsip pelaksanaan: **EXTENSION, bukan REWRITE.** `conversationService.processCustomerMessage()`
> + seluruh engine AI tetap *source of truth* compose+persist; semua penambahan
> berada di *delivery layer* yang berada **di luar** engine. Web path dimiliki penuh
> (`routes/pwa.ts`) sehingga dapat di‑extend tanpa sentuh WA gateway / webhook.

---

## 0. VERIFIED FACT ANCHORS & DISCREPANCY TABLE

Berikut fakta aktual yang **terverifikasi langsung** dari repository (di‑read, tidak dimodifikasi). Semua referensi `FILE:LINE` di tiap fase didasari ini.

### Discrepancy: BLUEPRINT vs ACTUAL

| Concern | BLUEPRINT cited | ACTUAL (verified) | IMPACT on plan |
|---|---|---|---|
| Mutex acquireLock | `message-queue.service.ts:167` | `:167` (`private processingLocks Map` di `:152`) | ✓ exact |
| customerPhone fallback | `conversation.service.ts:75` | `:75` (`customerPhone: channel === 'web' ? null : customerId`) | ✓ exact |
| Device status ignore | `webhooks.ts:154` | `:154` (`if (body.status === 'connect' \|\| 'disconnect')`) | ✓ exact |
| Engine v1 default | `engine-config.ts:22` | `:21-22` (`return config?.engine \|\| 'v1'`) | ✓ exact |
| Conversations reply persist | `conversations.ts:122` | `:122` (`prisma.conversationHistory.create`) | ✓ exact |
| Conversations PUT status | `conversations.ts:74` | `:74-101` | ✓ exact |
| Fonnte send (reply) | `:145` | `conversations.ts:150` | minor line drift — plan ref `:150` |
| GOWA send (reply) | `:157` | `conversations.ts:164` | minor line drift — plan ref `:164` |
| PWA history endpoint | `pwa.ts:97` | `routes/pwa.ts:75` (GET), `:130` (res.json); ChatPage fetch `apps/pwa/src/components/ChatPage.tsx:111` | minor — plan ref `:75/:130/:111` |
| PWA response envelope | `pwa.ts:240-247` | `:240-250` (success), `:232-239` (pending_human), `:222-227` (429) | minor — plan ref `:240-250` |
| Non‑pwa `messageId` | n/a | `routes/messages.ts:57` returns `messageId: result.message.id` | confirms Web gap (Web does NOT return messageId) |
| Typing sim target | ChatPage `~:163` | `ChatPage.tsx:167` (`700 + Math.floor(Math.random()*600)`), delay `:182`, setTimeout `:195`, unmount cleanup `:134` | minor — plan ref `:167/:182/:195/:134` |
| api.ts auth | n/a | `apps/pwa/src/services/api.ts:8-12` (baseURL `/api`, **no** Authorization) | ✓ confirms anon Web |
| Vite base | `/c/` | `apps/pwa/vite.config.ts:25` `base: '/c/'` | ✓ |

### Fakta kunci yang dipakai desain (verified)

- Web send path: ChatPage `onSend` → `api.post('/pwa/${slug}/message', {uid, message})`
  (ChatPage.tsx:176) → `routes/pwa.ts:214` acquireLock →
  `conversationService.processCustomerMessage(store.id, customerId, conversationId, message, 'web')`
  (pwa.ts:222-228) → `res.json({success, conversationId, content, source, confidence, timestamp})`
  (pwa.ts:240-250). Human‑takeover branch return `{success, message:null, status:'pending_human'}`
  (pwa.ts:232-239); lock‑busy return 429 (pwa.ts:222-227, release at `:244` finally).
- `Customer.webUid` unique (schema.prisma — webUid), Web identity = `localStorage['garuda_pwa_uid']`
  (ChatPage.tsx:90-93, crypto.randomUUID).
- Conversation Web id = `findFirst({storeId, customerId, channel:'web'})` (audit: pwa.ts resolve‑or‑create).
- `saveMessage` writes `conversation_history` role/content/source/costUSD/metadata;
  `crypto.randomUUID()` dipakai di banyak tempat tapi **import crypto tidak ada** di
  `conversation.service.ts` (audit §24) → *bug terbuka* (lihat §BUG).
- WA reply to Web: `routes/conversations.ts:147/160` skip bila `customerPhone` null
  (WA path ke Fonete `:150`, GOWA `:164`).
- `messageQueueService.acquireLock(chatId)` in‑memory Map (single instance); dipakai
  WA (`message-processor.service.ts:161`) dan Web (`pwa.ts:214`).
- Fonnte device‑status webhook **ignore** (`webhooks.ts:154`); device cache 60s
  (`fonnte.service.ts:6`).

---

## 1. ENGINE PROTECTION — MUST NOT CHANGE

Berikut daftar file/function yang **dilindungi**. Jika ada kebutuhan menyentuh,
harus lewat *wrapper/extension* dan didokumentasikan di §BUG/§RISK tiap fase.

| PATH | FUNCTION | STATUS |
|---|---|---|
| `business/conversation.service.ts` | `processCustomerMessage`, `saveMessage`, `buildResult`, `getOrCreateContext`, `executeCartOps`, `modifyCart`(via context), `handleHumanReply` | **PROTECTED** — engine SoT |
| `services/chat/interpreter.ts` | `runOneCall` | **PROTECTED** |
| `services/chat/normalizer.ts` | `normalize` | **PROTECTED** |
| `services/chat/composer-v2.ts` | `composeReply` | **PROTECTED** |
| `services/chat/*` (workspace, reasoning, planner, validator-v2, pendingClarification, fast-path, tier-match) | — | **PROTECTED** |
| `business/fallback.service.ts` | `getResponse` + tiers | **PROTECTED** |
| `business/order.service.ts` | `addConfirmedItemToOrder`, `syncCartStateToDraftOrder`, `finalizeDraftOrder`, `getOrdersByConversation` | **PROTECTED** |
| `business/conversation-context.ts` | `modifyCart`, `appendMessage`, `refreshSession`, `setPendingClarification` | **PROTECTED** |
| `services/message-queue.service.ts` | `acquireLock`, `isDuplicate`, `bufferMessage` | **PROTECTED** (mutex reused) |
| `services/message-processor.service.ts` | `processMessage`, `processWithLock`, `sendWithPresence`, `smartRetrySend`, `notifyHumanTakeover` | **PROTECTED** (WA pipeline) |
| `services/fonnte.service.ts`, `adapters/whatsapp/gowa.adapter.ts` | `sendMessage`, `sendImage…` | **PROTECTED** (WA gateway) |
| `routes/webhooks.ts` | Fonnte/GOWA webhook inbound + device status (`:154`) | **PROTECTED** |
| `routes/messages.ts` | POST `/handle` | **PROTECTED** |
| `prisma/schema.prisma` | Conversation/ConversationHistory/Customer/Order/Store | **PROTECTED** (no migration for foundation) |
| `apps/dashboard/src/contexts/AuthContext.tsx`, `services/api.ts` | Bearer auth | **PROTECTED** |

### Satu exception yang harus dibahas (WA inbound → real‑time dashboard)
Untuk mem‑push `message.created` (customer baru) ke Dashboard secara real‑time
pada jalur WA, satu‑satunya titik akurat adalah **setelah** `processCustomerMessage`
+ `sendWithPresence` di-`message-processor.service.ts`. Wrapper di luar
(`conversationDeliveryService.processWainbound`) tidak dapat mengetahui `message.id`
WA yang baru saja disimpan tanpa query tambahan — *workable tapi menambah query*
dan berpotensi race bila ada queue. Oleh karena itu, **hanya pada FASE 6**
(opsional) kami rencanakan **append‑only publish** di `message-processor.service.ts`
(setelah `saveMessage`+`sendWithPresence` sukses), bukan refactor. Jika tim memilih
tidak me‑realtime‑kan WA inbound→dashboard, WA tetap lewat polling/refresh
(compat penuh, zero touch).

---

## 2. SHARED CONTRACTS (FASE 0 final)

### StructuredMessage (frontend + event)
```ts
type Sender = 'customer' | 'assistant' | 'human_agent'
type MessageType = 'text'|'product'|'product_list'|'cart'|'quick_reply'|'button'|
  'order'|'checkout'|'image'|'system'|'handoff'|'payment'|'notification'
interface StructuredMessage {
  id: string            // = conversation_history.id (uuid), untuk dedup
  conversationId: string
  sender: Sender
  type: MessageType
  content: string       // fallback text (selalu ada; accessibility)
  payload?: Record<string, any>   // {items,total,actions,options,checkoutUrl,...}
  source?: 'ai'|'dashboard'|'customer'|'system'
  confidence?: number | null
  createdAt: string
  updatedAt?: string
}
```
- `type` berasal dari `conversation_history.messageType` (existing nullable col,
  `schema.prisma` belum dipakai → pakai). `payload` berasal dari
  `metadata.messagePayload` (sub‑key di existing `metadata Json`). **Tidak migration.**

### ResponseEnvelope (pwa.ts) — BERUBAH (MUST)
```
GET /api/pwa/:slug/init        → { success:true, data:{ store } }   (existing :66)
GET /api/pwa/:slug/history?uid= → { success:true, data:{ history:StructuredMessage[] } }
POST /api/pwa/:slug/message  →
   429                       → { success:false, error:'...', conversationId }
   pending_human             → { success:true, message:null, status:'pending_human', conversationId }
   success                   → { success:true, messageId:<uuid>, conversationId, type, content,
                                 payload?, source, confidence, timestamp }
POST /api/pwa/:slug/typing   → { success:true }
WS /ws                       → authenticated upgrade
```
- `type` untuk AI‑text = `'text'`; untuk AI‑structured (product/cart/…) dipetakan
  oleh delivery layer. `messageId` = `result.message.id` (WA‑path sudah ada di
  `messages.ts:57`; Web belum → ditambah, WAJIB, untuk dedup).

### EventEnvelope
```ts
interface EventEnvelope {
  event: 'message.created'|'typing.started'|'typing.stopped'|
         'conversation.handoff'|'conversation.resumed'|'conversation.resolved'|
         'conversation.updated'|'notification.created'|
         'device.status.changed'   // WA device (FASE 6)
  storeId: string
  data: any
  ts: number
}
```

### EventType (subset — tidak bikin event "antek‑antek")
`message.created`, `typing.started`, `typing.stopped`, `conversation.handoff`,
`conversation.resumed`, `conversation.resolved`, `conversation.updated`,
`notification.created`, (`device.status.changed` FASE 6).

### Room naming (Socket.IO)
- `store:{storeId}` — broadcast toko
- `store:{storeId}:conv:{conversationId}` — customer + admin + human (satu konvo)
- `store:{storeId}:admin` — semua admin store
- Naming **selalu diawali `store:{storeId}`** → isolasi multi‑tenant.

### WS authentication
- Web: query `?slug=<slug>&uid=<webUid>`; server resolve storeId via slug
  (`pwa.ts:50` `store.findBySlug`); verifikasi `Customer.webUid` milik storeId.
- Admin: query `?token=<Bearer>` ATAU header `Authorization`; verify via auth
  middleware (`routes/conversations.ts:14 authMiddleware`).
- Tolak → close(4401 unauthorized).

### Dedup contract (§22 plan)
- Server selalu assign `id` = `result.message.id` (uuid) pada persist; sama
  di HTTP response (`messageId`) dan di event `data.id`.
- Client simpan `Map<messageId, StructuredMessage>`; skip insert bila ada.

### Read state contract (§16 plan)
- Simpan di `Conversation.metadata Json` (existing `schema.prisma`) key
  `webLastReadAt` / `adminLastReadAt` (ISO string). **No migration.**
- `unreadCount` dihitung query: `count(history WHERE createdAt > lastReadAt)`.
- `GET /history` dan `GET /conversations` (dashboard) return `unreadCount` +
  `lastReadAt`.

### Typing contract (§14 plan)
- Web customer: `POST /pwa/:slug/typing {uid, conversationId, typing:bool}`
  → throttle 1/2s → emit `typing.started/stopped {conversationId, party:'customer'}`.
- Admin (Dashboard): lewat WS send ke room conversation.
- AI: tetap **local simulated** (ChatPage.tsx:167 target 700‑1300ms) — tidak
  emit typing event (kurangi event).

---

## 0b. EVENTBUS vs SOCKET.IO REDIS ADAPTER — BOUNDARY

Dua mekanisme pub/sub yang **tidak tumpang‑tindih**:

- **EventBus (in‑proc, `services/event-bus.service.ts`)** — publish/subscribe
  **di dalam proses API satu**. Bertugas: engine/delivery layer memberi tahu
  *delivery layer lokal* bahwa sebuah message.conversation.* terjadi
  (`publish('message.created', …)` → lokal `realtime.service.emit(room,…)`).
  Hanya `EventEmitter` / `Map` sederhana. **Satu proses.**
- **Socket.IO Redis Adapter** — hanya untuk **meng‑sosialisasikan room WS**
  (join/leave + `io.to(room).emit`) **antar proses/worker** bila API dijalankan
  lebih dari satu (multi‑instance VPS). **Bukan** pengganti EventBus; EventBus tetap
  jalan di tiap proses, WS‑emit ke Socket.IO lokal, lalu adapter menyiarkan ke
  proses lain.

**Single VPS (MVP):** proses API tunun­gi → **tidak perlu redis adapter**.
EventBus in‑proc + WS server in‑proc cukup. Redis adapter **opsional**, di‑enable
hanya bila `--workers > 1` (scaling). Key: jangan pakai redis pub/sub untuk
*domain events* (redundan dengan EventBus).

---

## FASE 0 — Architecture / contract foundation

### 1. Objective
Finalisasi kontrak (`StructuredMessage`, `ResponseEnvelope`, `EventEnvelope`,
`MessageType`, `EventType`, room naming, WS auth, dedup, read state, typing) sebagai
dokumen tunggal; setujui baseline agar FASE 1‑5 konsisten.

### 2. Prerequisite
Audit read‑only + blueprint yang disetujui; fakta repositori terverifikasi (§0).

### 3. Files yang akan diubah
**Tidak ada** (design only). Hanya menghasilkan kontrak di dokumen ini +
`domain/types.ts` **draft** (opsional, hanya interface — tidak compile‑time enforced
sampai fase implementasi).

### 4. Files baru
- `DOCS/implementation-plan-chatbox-qlabot.md` (dokumen ini)
- (opsional) `apps/api/src/domain/structured-message.types.ts` — draft interface
  (MAY, tidak di‑compile pada FASE 0)

### 5. Function/component disentuh
- Draft `StructuredMessage` type.

### 6. Function/component TIDAK boleh disentuh
- `conversationService.processCustomerMessage`, `services/chat/*`,
  `message-queue.service.ts` (mutex), `routes/webhooks.ts`, gateway WA.

### 7. Data flow sebelum
- pwa.ts respon `{success, conversationId, content, source, confidence, timestamp}`
  (pwa.ts:240‑250); **tidak ada** `messageId`/`type`/`payload`; **tidak ada** realtime;
  histori fetch `GET /history` (pwa.ts:75, ChatPage:111).

### 8. Data flow setelah
- **Target kontrak** (lihat §2). Engine tidak berubah; delivery layer
  memetakan hasil ke contract.

### 9. API contract yang berubah
- pwa.ts: tambahkan `messageId` + `type` + `payload` di response (setelah FASE 2
  diperlakukan; FASE 0 hanya finalisasi kontrak). Endpoint baru `POST /typing`,
  WS `/ws` — direalisasikan FASE 1.

### 10. Event contract yang dibuat
- Daftar di §2 (in‑process EventBus). Event tidak dipublikasikan sampai FASE 1.

### 11. Database impact
- **Tidak ada** (gunakan `messageType`, `metadata` existing).

### 12. Dependency / package impact
- Rencana dependensi (belum ter‑install — design only): `socket.io` +
  `socket.io-redis-adapter` (server), `socket.io-client` (PWA). Alternatif
  zero‑dep: `ws` (server). Dipilih FASE 1.

### 13. Security impact
- WS auth query `?token=` akan jadi Bearer‑only pada produksi; jelaskan di FASE 1.
- Web uid anon — cukup untuk chatbox (tidak ada data pribadi).

### 14. Multi‑tenant impact
- Semua room diawali `store:{storeId}`; server verifikasi storeId pada connect.

### 15. Backward compatibility
- Response lama tetap bisa (field tambahan bersifat additive; field
  `messageId`/`type`/`payload` opsional di client lama — teks tetap muncul).
- Endpoint `/history` shape sama (`{success,data:{history}}`); tiap history item
  ditambah `id`/`type`/`payload` (additive).

### 16. Failure/reconnect behavior
- Ditentukan di FASE 1.

### 17. Tests yang harus dibuat
- Contract unit test: `StructuredMessage` shape + envelope mapping.
- Dedup test: `messageId` sama di HTTP + WS → render 1× (lihat TEST di §32 plan).

### 18. Acceptance criteria
- Kontrak escrow di `DOCS/contract-*.md`; tim backend/frontend + dashboard setuju.
- Draft type diekspor, compile check (tsc no‑error) bila di‑compile.

### 19. Rollback strategy
- Kontrak belum diterapkan di kode → rollback = jangan implement FASE 1.

### 20. Risiko
- Scope creep pada contract; mitigasi: finalisasi + tandatangani baseline.

---

## FASE 1 — Web realtime foundation

### 1. Objective
WebSocket server (Socket.IO) dengan room/auth/reconnect; event `message.created`
ke Web customer; dedup HTTP+WS via `messageId`. History tetap SoT (tidak bikin
persistence baru).

### 2. Prerequisite
FASE 0 contract final; pwa.ts masih memanggil `processCustomerMessage` langsung.

### 3. Files yang akan diubah
- `routes/pwa.ts:214-250` — setelah `processCustomerMessage` sukses, **also**
  publish `message.created` ke room `store:{storeId}:conv:{conversationId}` (via
  delivery wrapper `services/conversation-delivery.service.ts`). Response tambah
  `messageId` (`:240`). 429 path tetap (`:222`). pending_human tetap (`:232`).
- `routes/pwa.ts` tambah WS upgrade + `POST /typing`.
- `services/conversation-delivery.service.ts` (BARU) — wrapper: lock→engine→persist
  observe→publish event; **tidak** pindahkan logika ke conversation.service.
- `app index.ts` (`:134 pm2 / api:3000`) — mount WS server pada HTTP server yang
  sama (atau proses terpisah; rekomendasi sama untuk VPS).
- `apps/pwa/src/services/api.ts:8` — tambah WebSocket connect helper (query
  `?slug=&uid=`); cleanup on unmount.
- `apps/pwa/src/components/ChatPage.tsx` — subscribe WS; pada
  `message.created` insert (dedup by `messageId`); handle 429 retry; read
  `webLastReadAt` update pada fokus/scroll.

### 4. Files baru
- `services/realtime.service.ts` — Socket.IO server, rooms, auth, redis adapter.
- `services/event-bus.service.ts` — EventBus in‑proc (Node EventEmitter) +
  publish/subscribe by room; redis adapter bila multi‑instance.

### 5. Function/component disentuh
- `pwa.ts` route handler (delivery wrapper di luar engine).
- `realtime.service.ts` `init(httpServer)`, `emit(room, event, data)`,
  `join(storeId, convId)`, `authGuard`.
- `event-bus.service.ts` `publish(EventType, storeId, data)`,
  `subscribe(room, cb)`.
- ChatPage WS lifecycle.

### 6. Function/component TIDAK boleh disentuh
- `conversationService.processCustomerMessage`, `services/chat/*`,
  `message-queue.service.ts` (mutex tetap via `acquireLock` di pwa.ts:214 —
  dipakai ulang, tidak diganti), `routes/webhooks.ts`, WA gateway.

### 7. Data flow sebelum
```
ChatPage → POST /pwa/:slug/message → pwa.ts → acquireLock → processCustomerMessage → res.json
(history via GET /history, satu kali, tidak realtime)
```

### 8. Data flow setelah
```
ChatPage: WS connect ?slug+uid → /ws  (auth→room store:{id}:conv:{convId})
LOCK OWNER (FINAL): hanya ada SATU acquireLock() per web request.
```
ChatPage: WS connect ?slug+uid → /ws  (auth→room store:{id}:conv:{convId})
ChatPage → POST /pwa/:slug/message → pwa.ts
  → conversationDeliveryService.processWebRequest  (wrapper, bukan engine)
        ├─ acquireLock(conversationId)               [LOCK OWNER — messageQueueService]
        ├─ processCustomerMessage (ENGINE UNTOUCHED)
        ├─ saveMessage persist (conversation_history.id = uuid)
        ├─ UPDATE conversation_history SET messageType/payload  (FASE 2)
        ├─ publish message.created → store:{id}:conv:{convId}
        ├─ res.json {messageId, content, type, …}    [SAME messageId]
        └─ releaseLock()
ChatPage recv WS message.created  (dedup by messageId)
  elif HTTP sudah masuk → skip
      else → setMessages push
```

#### LOCK OWNER
- **Owner:** `conversationDeliveryService.processWebRequest()` — SATU‑SATU
  acquireLock per web request. `pwa.ts` route handler **tidak** memanggil
  `acquireLock` lagi; ia *meneruskan* ke delivery service.
- **Mutex:** `messageQueueService.acquireLock(chatId)` (`message-queue.service.ts:167`)
  — **dipakai ulang**, tidak diganti. Lock key = conversationId.
- **Kontrak:** `acquireLock` mengembalikan `release: ()=>void | null`; release
  dipanggil di `finally` setelah persist + publish selesai. Bila `null` → 429
  (pwa.ts:222-227). **Tidak ada double‑lock** karena lock ada hanya di wrapper,
  bukan di pa.ts sekaligus engine.
- WA path (`message-processor.service.ts:161`) tetap owner masing‑nya — tidak
  terpengaruh (jalur berbeda).
```

### 9. API contract yang berubah
- `POST /pwa/:slug/message` respon tambah `messageId` (**MUST**); tambah `type`.
- `POST /pwa/:slug/typing {uid, conversationId, typing}` (baru).
- `WS /ws` upgrade (baru).

### 10. Event contract
- `message.created` → room `store:{id}:conv:{convId}` (customer + admin).
- `typing.started/stopped` → room conversation dari customer → `store:{id}:admin`.

### 11. Database impact
- **Tidak ada.** `conversation_history.id` (uuid dari `crypto.randomUUID`
  di `saveMessage` — lihat §BUG) jadi `messageId`. `webLastReadAt` nanti via
  `Conversation.metadata`.

### 12. Dependency / package impact
- `socket.io`, `socket.io-redis-adapter` (server); `socket.io-client` (PWA).
- Alternatif `ws` (zero‑dep) bila tolak backend bundle.

### 13. Security impact
- **Web customer:** anon — *connection query* `?slug=<slug>&uid=<webUid>` → server
  resolve storeId via slug (`pwa.ts:55` `store.findBySlug`) + verifikasi
  `Customer.webUid` milik storeId. Cukup untuk chatbox anon.
- **Admin Dashboard:** pakai **Socket.IO `auth` middleware + Bearer** yang sama dengan
  `authMiddleware` (`routes/conversations.ts:14`). Client kirim
  `auth: { token: <Bearer dari garuda_user> }`; server verify → storeId.
  **Tidak pakai query token di produksi** (query bocor ke log/proxy).
- Room key hanya bisa join bali `storeId` match; customer hanya dapat
  conversation milik `webUid`-nya (`Customer.findFirst({storeId, webUid})`).
- `message.created` ke customer hanya berisi message dari conversation yang
  sama → tidak bocorkan conversation lain.

### 14. Multi‑tenant impact
- Room naming `store:{storeId}:…` + auth guard → customer/store A tidak dapat
  event store B. Redis adapter broadcast hanya ke room yang tepat.

### 15. Backward compatibility
- HTTP response lama tetap (additive field). WS hanya *tambahan* — klien lama
  (tanpa WS) tetap pakai polling/manual refresh.

### 16. Failure/reconnect behavior
- WS `reconnect` exponential backoff (Socket.IO built‑in).
- Saat offline: ChatPage tetap pakai optimistic bubble + HTTP fallback; ketika
  WS reconnect, fetch `GET /history?uid=<webUid>` catchup.
- WS disconnect berarti hanya **notifikasi real‑time** tidak sampai — **bukan**
  pesan hilang (semua persist di `conversation_history`, sumber kebenaran HTTP).

### 17. Tests
- T1 (realtime): balasan AI muncul via WS + HTTP respon → 1× (dedup messageId).
- T9 (reconnect): mati internet → reconnect → catchup history → tidak duplikat.
- T11 (cross‑tenant): store A tidak terima WS event store B.
- T14 (regression): engine flow lama tetap 200 + persist.

### 18. Acceptance
- `pm2 api` tetap online; WS `/ws` ter‑accept; room ter‑auth.
- ChatPage dapat `message.created` realtime; tidak ada bubble duplikat.

### 19. Rollback
- Matikan mount WS di `index.ts`; pwa.ts kembali hanya `res.json` (revert tambahan
  `messageId`/`type` boleh tetap — additive, tidak mengganggu).

### 20. Risiko
| RISK | SEVERITY | MITIGATION |
|---|---|---|
| Rekoneksi drop pesan | Medium | history catchup + `messageId` dedup |
| Memory leak room (multi‑instance) | Medium | redis adapter + leave‑on‑disconnect |
| Auth bypass cross‑tenant | High | room prefix `store:{} + guard strict |

---

## FASE 2 — Structured message

### 1. Objective
Delivery layer memetakan hasil engine (teks + metadata) → `type` + `payload`;
persistence via `messageType` + `metadata.messagePayload` existing (no migration);
ChatPage render type‑dispatch.

### 2. Prerequisite
FASE 1 (realtime + `messageId`).

### 3. Files yang akan diubah
- `routes/pwa.ts:240-250` — mapping type/payload dari `result` sebelum res.json.
- `services/conversation-delivery.service.ts` — helper `buildStructuredMessage(result)`
  (bukan di engine).
- `apps/pwa/src/components/ChatPage.tsx` — ganti `HistoryMsg` type →
  `StructuredMessage`; dispatch render.
- `apps/pwa/src/components/ChatBubble.tsx` — prop bertambah `type`, `payload`,
  `createdAt`; tetap fallback `text`.

### 4. Files baru
- `apps/pwa/src/components/messages/*` — `TextMessage`, `ProductMessage`,
  `ProductListMessage`, `CartMessage`, `QuickReplyMessage`, `ButtonMessage`,
  `SystemMessage`, `HandoffMessage`.

### 5. Function/component disentuh
- delivery `buildStructuredMessage` (lihat §9).
- Fallback service **`metadata.matchedNames/matchedPrices`** di‑baca (sudah ada di
  `fallback.service.ts` sebagian — audit `:355`); delivery resolver detail produk
  via `productService.getProductById`.
- Cart payload dari `orderService.getOrdersByConversation(conversationId)`
  (existing) → `Order.items` (JSON) + `totalPrice`.

### 6. TIDAK boleh disentuh
- `business/fallback.service.ts` (logic tiers tetap; hanya **baca** metadata yang
  sudah dia‑write). `order.service.ts`, `conversation.service.ts`, `services/chat/*`.

### 7. Data flow sebelum
- Engine return `reply_draft` teks, `renderCartSummary` teks, kartu produk teks —
  semua lewat `content:string`; pwa.ts kirim `content` saja.

### 8. Data flow setelah
```
engine result.message.content  (teks, tetap — satu sumber)
engine result.metadata.{matchedNames,cartOpsExecuted,stagesReached} (existing/read-only)
        │
delivery.buildStructuredMessage(result)
  ├─ text      → type:'text', payload:undefined
  ├─ product   → type:'product', payload:{productId,name,price,stock,imageUrl}
  ├─ cart      → type:'cart', payload:{items,total,actions}  (dari orderService)
  ├─ quick_reply→ type:'quick_reply', payload:{options}  (dari clarification options)
  └─ system/handoff → type, content
  │
PERSISTENSI CLARIFICATION (jangan bikin row kedua):
  - saveMessage (engine, :1080) INSERT baris PERTAMA → id=uuid, role, content, source, costUSD
  - delivery layer UPDATE baris YANG SAMA:
        SET messageType = <type>,
            metadata = { ...metadata, messagePayload: <payload> }
    → **TIDAK ada INSERT kedua.** message.id tetap sama → dedup/history reload konsisten.
  ├─ publish message.created {id, type, content, payload} → WS + HTTP response
  │
  ├─ ChatPage render <ProductMessage/> / <CartMessage/> / dsb.
```

### 8.1 Structured mapping safety — HARD RULE
**Hard rule:** delivery layer **tidak boleh** menandakan `type` structured
hanya dari *string matching* pada `content`. Setiap `type` hanya di‑set bila
ada **sumber data authoritative eksplisit**; bila ragu → `type:'text'` (fallback
safe). Ini mencegah payload korup / render broken & mencegah hallucinasi UI.

| Type | Authoritative source (bukti) | Delivery action | Jika tidak ada sumber |
|---|---|---|---|
| `text` | seluruh `result.message.content` | type='text' | — (default) |
| `product` | `metadata.matchedNames`+`matchedPrices` (fallback service `:355`) **atau** `result` explicit product flag | resolver `productService.getProductById` → payload | → `text` |
| `product_list` | toko dengan >1 matched product (fallback product tier `:339`) | map semua | → `text` |
| `cart` | `orderService.getOrdersByConversation(conversationId)` mem‑load order dengan item `Order.items` (schema.prisma:226, total `totalPrice`) | payload {items,total} | → `text` |
| `quick_reply` | `InterpreterResult.clarification?.options` (interpreter.ts:33) | payload {options} | → `text` |
| `button` | `composer‑v2` explicit action suggestions **atau** static UI action set (Checkout/Bicara Admin/Tambah) | payload {options} | → `text` |
| `order` | `Order.orderStatus` + `Order.totalPrice` (orderService) | payload {orderId,status,total} | → `text` |
| `checkout` | `finalizeDraftOrder` result / checkout URL (payment gateway) | payload {orderId,checkoutUrl,paymentMethods} | → `text` |
| `image` | explicit {imageUrl} (mis. QRIS) di result/payload | payload {imageUrl,alt} | → `text` |
| `system` | balasan sistem (human_takeover guard `:81`, atau pending) | content sistem | — |
| `handoff` | `result === null` (human_takeover) atau flag eksplisit | payload {to:'human_agent'} | — |

> Catatan: `cartOpsExecuted` detail **belum** ada di metadata engine; delivery
> layer **membaca state order** (`orderService`) — baca‑only terhadap engine,
> tidak perlu engine menulis array. `cart` type hanya muncul bila order benar‑benar
> ada item (`Order.items` non‑empty).

### 9. Mapping detail (engine metadata → payload) — TANPA ganti engine logic

| Output engine | metadata engine (existing/akan‑dibaca) | delivery mapping |
|---|---|---|
| fallback `tryProduct` (`:339`) | `metadata.matchedNames`, `matchedPrices` (`:355`) | type:`product`/`product_list`, payload dari `productService.getById` |
| `renderCartSummary` (`:961`) | `Order.items` (schema.prisma) | type:`cart`, payload:{items,total} — fetch via `orderService.getOrdersByConversation` |
| `composer‑v2 composeReply` `:82` cart draft teks | (belum ada array detail) | delivery baca order state → cart payload |
| `InterpreterResult.clarification.options` (interpreter.ts:33) | options teks | type:`quick_reply`, payload:{options} |
| `result.message.content` umum | — | type:`text` |
| handoff guard (`:81` return null) | — | type:`system`/`handoff`, content sistem |

> **Catatan:** bila `cartOpsExecuted` detail belum ada di metadata, delivery
> layer **membaca state order** (`orderService`) — tidak perlu engine menulis
> array baru. Ini *read‑only* terhadap engine.

### 10. API contract berubah
- Response envelope pwa.ts: `type` + `payload` (additive). History response juga
  kembalikan `type`/`payload` per item.

### 11. Database impact
- `messageType` (existing nullable, belum dipakai) + `metadata.messagePayload`
  (sub‑key metadata Json existing). **No migration.**

### 12. Dependency impact
- Frontend: komponen message‑type baru (bundle +kecil). Backend: pemanggilan
  `productService`/`orderService` (sudah ada) pada delivery layer.

### 13. Security impact
- Payload produk: hanya field publik (`name`,`price`,`stock`,`imageUrl`) —
  jangan exposes `costUSD`/`margin` ke client.

### 14. Multi‑tenant impact
- Produk/cart selalu scoped storeId (via conversation → order → store).

### 15. Backward compat
- Teks fallback → `text`; klien lama tetap dapat `content`.

### 16. Failure/reconnect
- Jika mapping gagal → fallback ke `text` (degrade gracefully).

### 17. Tests
- T2 (cart): "aku mau sosis dan kentang" → tipe `cart`, items+total benar.
- Produk card payload memiliki id/name/price/stock.
- quick_reply options = clarification options engine.

### 18. Acceptance
- Semua tipe render; tidak ada HTML dari LLM; engine logika tidak berubah.

### 19. Rollback
- delivery mapping boleh lepas (non‑aktif → semua `text`). Engine tidak sentuh.

### 20. Risiko
| RISK | SEVERITY | MITIGATION |
|---|---|---|
| N+1 query detail produk | Medium | cache `entityCacheService` (audit ada) |
| mapping salah (payload kosong) | Low | fallback ke teks + log |

---

## FASE 3 — Dashboard ↔ Web human messaging

### 1. Objective
2‑arah real‑time: admin reply → Web customer realtime; human takeover/resume/resolved;
typing admin→web + customer→admin; unread/read state; **conversationId tetap sama**.

### 2. Prerequisite
FASE 1 (WS + room), FASE 2 (structured).

### 3. Files yang akan diubah
- `routes/conversations.ts:107-186` — setelah persist `role:'agent'` + kirim WA
  gateway, **publish** `message.created {sender:'human_agent'}` ke room
  `store:{storeId}:conv:{conversationId}` (Web) — **bukan** dobel history.
  Jika channel `whatsapp` → tetap gateway (`:150/:164`); jika `web` → **jangan**
  panggil gateway (skip), cukup WS event.
- `routes/conversations.ts:74-99` — setelah update status, **publish**
  `conversation.handoff`/`conversation.resumed`/`conversation.resolved` ke room
  conversation + admin.
- `routes/conversations.ts:17-69` — tambah `unreadCount` + `lastReadAt` di list.
- `apps/dashboard/src/pages/ConversationInbox.tsx` — WS connect (Bearer token)
  room `store:{storeId}:admin`; render badge realtime; handle reply realtime.
- `apps/pwa/src/components/ChatPage.tsx` — render `human_agent` message
  (HandoffMessage), subscription event conversation.*.

### 4. Files baru
- (opsional) `apps/dashboard/src/components/MessageList.tsx` — Dashboard message
  list realtime (MAY).

### 5. Function/component disentuh
- reply route, status route, inbox subscribe, ChatPage handoff UI.

### 6. TIDAK boleh disentuh
- `conversationService`, gateway WA, mutex, engine.

### 7. Data flow sebelum
- Admin reply → `conversations.ts:122` persist role=agent → WA gateway (`:150/:164`).
  Web conversation (customerPhone null `:147/:160`) → **di‑skip** (tidak sampai).
  Tidak ada realtime; Dashboard fetch sekali.

### 8. Data flow setelah
```
Dashboard → POST /conversations/:id/reply {message}
  → persist conversationHistory.create({role:'agent'})  (:122)  [1×]
  → publish message.created {sender:'human_agent', id, content}
      ├─ Web  room → WS → ChatPage render (role:'human_agent')
      └─ WA room  → fonnte/gowa sendMessage  (:150/:164)   [existing]
  → update Conversation.lastMessageAt + adminLastReadAt=null  (:127 area)

Customer → "Bicara dengan Admin" (button) → PUT /status human_takeover
  → publish conversation.handoff → Dashboard inbox (badge) + Web (HandoffMessage)

Admin "Ambil Alih"/"Lanjutkan AI":
  PUT /status → publish conversation.handoff/resumed → WS semua room

Unread/read:
  Web fokus+render selesai → POST /pwa/:slug/read  → Conversation.metadata.webLastReadAt
  Dashboard open conv → Conversation.metadata.adminLastReadAt
  unreadCount = count(history WHERE createdAt > lastReadAt)
```

### 9. API contract berubah
- `POST /conversations/:id/reply` — **tambahan** publish event (behavior baru; response
  sama `{success,...}`). Untuk channel `web` **skip** WA gateway.
- `PUT /conversations/:id/status` — **tambahan** publish `conversation.*`.
- `GET /conversations` — tambah `unreadCount`, `lastReadAt`.
- `POST /pwa/:slug/read {uid, conversationId}` (baru) — update `webLastReadAt`.

### 10. Event contract
- `message.created` (sender human_agent) → room conversation.
- `conversation.handoff`/`resumed`/`resolved` → room conversation + admin.
- `conversation.updated` → room admin (list refresh + badge).

### 11. Database impact
- `Conversation.metadata` (existing Json) tambah `webLastReadAt`/`adminLastReadAt`.
  **No migration.** `humanTakeoverAt`/`status` existing sudah dipakai (`:88-94`).

### 12. Dependency impact
- Dashboard: `socket.io-client`. Backend: WS sudah ada (FASE 1).

### 13. Security impact
- Admin reply hanya dapat conversation milik storeId (auth middleware `:14` +
  `findFirst where:{id, storeId}` `:80`). Web customer hanya dapat
  conversation milik webUid‑nya.

### 14. Multi‑tenant
- Event room `store:{storeId}:…`; dashboard hanya join `store:{storeId}:admin`.

### 15. Backward compat
- Admin reply WA tetap bekerja (jalur fonnte/gowa). Web yang sebelumnya "skip"
  kini dapat via WS — **penambahan**, tidak rusak.

### 16. Failure/reconnect
- WS drop saat admin reply → customer akan dapat via `GET /history` catchup;
  history tetap 1× (persist sekali).

### 17. Tests
- T3 (customer→human): "Bicara dengan Admin" → UI "👤 terhubung dengan Admin",
  Dashboard dapat notifikasi.
- T4 (admin→web): reply muncul realtime Web.
- T6 (admin→WA): reply ke WA via gateway, history 1×.
- T13 (AI resume): "Lanjutkan AI" → AI balas lagi.
- T8 (WA inbound→human): circuit breaker → takeover.

### 18. Acceptance
- Admin reply ke Web sampai realtime; tidak duplikat history; conversationId sama;
  WA kompatibel.

### 19. Rollback
- Non‑aktifkan WS publish pada conversations.ts; Web kembali tidak realtime (refresh).
  Persist WA tetap.

### 20. Risiko
| RISK | SEVERITY | MITIGATION |
|---|---|---|
| Duplicate history (web+WA balik) | High | persist **sekali**, channel switch delivery; unit test count=1 |
| Admin dapat conversation tenant lain | High | guard storeId pada setiap query |
| Typing echo (admin lihat balon sendiri) | Low | kecualikan sender di room |

---

## FASE 4 — Notification / PWA push

### 1. Objective
Foreground = WS badge; background/PWA‑installed = Web Push (VAPID) via SW;
**bukan** transport utama message.

### 2. Prerequisite
FASE 1 realtime, FASE 3 delivery.

### 3. Files yang akan diubah
- `apps/pwa/public/sw.js` — tambah `push` handler, `notificationclick` handler
  (pass‑through → extend).
- `routes/pwa.ts` — `POST /pwa/:slug/subscribe` (store PushSubscription).
- `apps/pwa/src/main.tsx:21` (register SW) + ChatPage permission request.
- `services/conversation-delivery.service.ts` / event‑bus — publish
  `notification.created` bila lawan belah pihak offline.
- `.env.example` (existing, `apps/api/.env.example:1-10`) — tambah `VAPID_PUBLIC_KEY`,
  `VAPID_PRIVATE_KEY`, `PWA_ALLOWED_ORIGINS`.

### 4. Files baru
- `services/notification.service.ts` — Web Push (libsodium/vapid) + subscribe store.

### 5. Function/component disentuh
- SW push/notificationclick; subscribe; permission; foreground badge via WS.

### 6. TIDAK boleh disentuh
- Engine, gateway, mutex, schema.

### 7. Data flow sebelum
- SW pass‑through; tidak ada notifikasi.

### 8. Data flow setelah
```
Customer offline (tab tutup/PWA bg) & admin balas
  → delivery publish message.created → WS room (tidak sampai, koneksi drop)
  → notification service cek: customer online? (WS connected flag di realtime.service)
        tidak → publish notification.created
        → Web Push ke SW (subscription) → self.registration.showNotification(...)
        → klik notification → fokus/refresh tab / open /c/:slug

Admin baru (conversation belum dibuka)
  → conversation.handoff / new message.created → store:{storeId}:admin
        → Dashboard bell badge (in‑app)
        → jika dashboard tab tidak aktif → push (VAPID) ke admin device (jika support)
```

### 9. API contract berubah
- `POST /pwa/:slug/subscribe` (baru) — body PushSubscription (web).
- `.env` tambah VAPID keys (design only; generate di tahap deploy).
- WS `connected` flag (realtime.service tracks per `storeId:convId`).

### 10. Event contract
- `notification.created {storeId, conversationId, type, sender}` → notification service.

### 11. Database impact
- `pushSubscription` **harus persisten** (bukan memory‑only) agar bertahan
  PM2 restart / VPS reboot. Simpan per `storeId + webUid`.
- `Customer` belum ada kolom subscription. Jadi:
  **DATABASE MIGRATION: YES** (design only — tidak dieksekusi di sini).
  - Opsi A (disarankan, satu kolom): `Customer.pushSubscription Json?` —
    cocok karena 1 customer ↔ ≤1 subscription browser. Key natural
    `storeId+webUid` (webUid @unique).
  - Opsi B (lebih fleksibel): tabel baru `PushSubscription { id, storeId, webUid, subscription Json, userAgent, createdAt, updatedAt }` — untuk kasus multi‑device.
  - Rekomendasi Opsi A untuk MVP (customer anon = 1 device/browser). Kolom Json
    cukup; query via `Customer.webUid` (unique) + `storeId`.
- VAPID keys simpan di `.env` (design only). Subscription JSON kadang‑kadang
  expired → refresh on SW activate.

### 12. Dependency impact
- `web-push` (server). Client JS native `PushManager`/`Notification`.

### 13. Security impact
- Subscription hanya bind ke `storeId` + `webUid`; verify store ownership.

### 14. Multi‑tenant
- Push subscription ter‑index `storeId:convId/webUid`; tidak cross‑tenant.

### 15. Backward compat
- PWA tanpa notif tetap pakai WS badge; push hanya bila grant + terpasang.

### 16. Failure/reconnect
- Push gagal → tetap ada in‑app bell (WS/online) + history catchup.
- Tidak sekalikan message delivery — push hanya *signal*, bukan payload penuh
  (buka chat → fetch history).

### 17. Tests
- T12 (background notification): admin balas saat PWA background/terpasang → notif muncul.

### 18. Acceptance
- Customer offline tetap dapat notifikasi via push; foreground via badge; tidak
  menampilkan payload penuh di notifikasi (privacy).

### 19. Rollback
- Non‑aktifkan SW push handler + endpoint subscribe; kembali WS badge saja.

### 20. Risiko
| RISK | SEVERITY | MITIGATION |
|---|---|---|
| Permission ditolak browser | Medium | fallback in‑app badge |
| Web Push battery | Low | throttle, max 1 push/conversation |
| Subscription kadaluarsa | Medium | refresh on reconnect |

---

## FASE 5 — Chatbox UI redesign + commerce UI

### 1. Objective
Custom Chatbox UI modular (React 19 + Vite) dengan renderer type‑dispatch +
Handoff/Typing UX + mobile PWA.

### 2. Prerequisite
FASE 2 (structured message), FASE 3/4 (realtime/notif).

### 3. Files yang akan diubah
- `apps/pwa/src/components/ChatPage.tsx` — kontroler WS + state + render dispatch.
- `apps/pwa/src/components/ChatBubble.tsx` — presentasional, prop
  `{role, type, content, payload, source, isTyping, createdAt}`.
- `apps/pwa/src/components/ChatPage.tsx:288-290` area `MessageList` → dispatch.

### 4. Files baru
- `apps/pwa/src/components/layout/ChatHeader.tsx`
- `apps/pwa/src/components/layout/ConversationStatus.tsx`
- `apps/pwa/src/components/layout/Composer.tsx` (input + quick‑reply chips)
- `apps/pwa/src/components/layout/MessageList.tsx`
- `apps/pwa/src/components/messages/TextMessage.tsx`
- `apps/pwa/src/components/messages/ProductMessage.tsx`
- `apps/pwa/src/components/messages/ProductListMessage.tsx`
- `apps/pwa/src/components/messages/CartMessage.tsx`
- `apps/pwa/src/components/messages/QuickReplyMessage.tsx`
- `apps/pwa/src/components/messages/ButtonMessage.tsx`
- `apps/pwa/src/components/messages/SystemMessage.tsx`
- `apps/pwa/src/components/messages/HandoffMessage.tsx`
- `apps/pwa/src/components/messages/TypingIndicator.tsx`
- (install banner tetap — P‑PWA.15 ChatPage:21‑54)

### 5. Function/component disentuh
- Semua di atas (presentasional + dispatch). ChatPage WS lifecycle.

### 6. TIDAK boleh disentuh
- Engine, gateway, mutex, schema. Struktur rute `/c/:slug`
  (`apps/pwa/src/App.tsx:5`) tetap — tidak ganti routing.

### 7. Data flow sebelum
- ChatPage teks‑only (`HistoryMsg` ChatPage:11); ChatBubble role/text/source/isTyping.

### 8. Data flow setelah
```
store = GET /init {data:{store}}        (pwa.ts:66)
history = GET /history {data:{history:StructuredMessage[]}}  (pwa.ts:75,130; ChatPage:111)
WS /ws connect ?slug+uid → room conv
onSend → POST /message {uid,message} → res {messageId,type,content,payload}
   + WS message.created (dedup)
render: type dispatch → <ProductMessage payload/> / <CartMessage payload/> ...
Composer: quick_reply chip → onSend(text=value); button Checkout → POST /checkout
```

### 9. API contract berubah
- History response item kini punya `id/type/payload` (additive).
- Button `Checkout` di UI → **klik → `POST /pwa/:slug/checkout`** (baru).

#### 9.1 Checkout scope — DIPISAT (UI vs Backend)
Checkout UI dan checkout business flow adalah **dua fase berbeda**; jangan
pernyataan "checkout selesai" hanya karena tombol ada.

- **FASE UI (FASE 5):**
  - Render `CartMessage` dengan tombol `Checkout` (payload dari `orderService`
    `Order.items` + `Order.totalPrice`).
  - Klik → kirim action `checkout`; UI tunjukkan state `awaiting_address`
    (form alamat) + payment method list.
  - UI **tidak** memutuskan `orderStatus`; hanya presentasi state backend.

- **FASE BACKEND CHECKOUT (FASE terpisah, setelah FASE 5):**
  - `POST /pwa/:slug/checkout {uid, orderId?, shippingAddress?, paymentMethod?}`
    → `orderService.finalizeDraftOrder` (protected, `order.service.ts`)
    → ubah `Order.orderStatus` (draft→waiting_address→waiting_payment→paid…).
  - Generate payment link / QRIS → kembalikan `checkoutUrl` → UI render
    `type:'image'` QRIS / payment button.
  - Engine (`orderService`) tetap owner business logic; UI hanya konsumen state.

> **Hard rule:** tombol Checkout di UI hanyalah *trigger*; `orderStatus` dan
> payment flow dikendalikan backend. Jika backend belum ada, tombol dapat
> dinon‑aktif (`disabled`) dengan label "checkout belum tersedia".

### 10. Event contract
- WS `message.created` (render), `conversation.*` (handoff UI),
  `typing.*` (TypingIndicator).

### 11. Database impact
- Tidak ada baru (pakai contract FASE 2). `GET /checkout` memanggil engine
  `finalizeDraftOrder` (protected) → `Order.orderStatus` (existing schema).

### 12. Dependency impact
- UI: React 19, react‑router‑dom 7 (sudah ada). Tidak butuh dep baru kecuali
  checkout/payment gateway (di luar skop UI ini).

### 13. Security impact
- Payload produk hanya field publik. Checkout total di‑verify server.

### 14. Multi‑tenant
- Semua fetch scoped `?slug` → storeId.

### 15. Backward compat
- `content` teks selalu ada → fallback aksesibel.

### 16. Failure/reconnect
- UI fallback ke teks bila payload tidak valid; WS reconnect catchup.

### 17. Tests
- T2 (cart), T12 (notif), UI regression (teks tetap muncul).

### 18. Acceptance
- Semua tipe UI ada; mobile scrollable; install banner tidak regresi.

### 19. Rollback
- Ganti render dispatch ke `text` saja (fallback existing).

### 20. Risiko
| RISK | SEVERITY | MITIGATION |
|---|---|---|
| Bundle bloat | Low | komponen granular, code‑split per type |
| Mobile perf (panjang list) | Medium | virtual scroll (MAY, belum diperlukan skop awal) |

---

## FASE 6 — Fonnte device status realtime (terpisah)

### 1. Objective
Device status (connect/disconnect) → WS event `device.status.changed` ke room
`store:{storeId}:admin` — **TERPISAH** dari customer message event.

### 2. Prerequisite
FASE 1 (WS + room + admin subscription).

### 3. Files yang akan diubah
- `routes/webhooks.ts:154` — saat ini **ignore**. Proposal **append‑only** (setelah
  ignore, log + publish `device.status.changed` ke `store:{storeId}:admin`).
- `services/fonnte.service.ts:6/56` — `invalidateDeviceCache` (existing).
- `routes/conversations.ts` / Dashboard — tampilkan device badge di ConversationInbox.

### 4. Files baru tidak ada (reuse realtime.service).

### 5. Function/component disentuh
- handler webhook device status.

### 6. TIDAK boleh disentuh
- WA inbound message flow (`webhooks.ts` sampai `:153` — *message* path tetap).
  Hanya **append** pada `status` branch (`:154`).

### 7. Data flow sebelum
- `webhooks.ts:154` → `res.json({status:'ignored'})`; cache device 60s
  (`fonnte.service.ts:6`); dashboard WA status stale.

### 8. Data flow setelah
```
Fonnte webhook POST {status:'connect'|'disconnect'}
  → webhooks.ts:154 branch (tetap return 200)
  → invalidateDeviceCache(storeId)  (fonnte.service.ts:56)
  → realtime.publish(device.status.changed, storeId)
  → store:{storeId}:admin (Dashboard) → WA device badge realtime
```

### 9. Event contract
- `device.status.changed {storeId, phoneNumber, connected, ts}` → room admin.

### 10. Database impact
- Tidak ada.

### 11. Dependency
- Sama (Socket.IO sudah FASE 1).

### 12. Risk vs message realtime
- **Ini DOMAIN EVENT BERBEDA** — tidak boleh dicampur `message.created`. Device
  status bukan message delivery; jangan trigger `message.created` atau
  `conversation.*`.

---

## 33. CRITICAL RISKS (global)

| RISK | SEVERITY | WHY | MITIGATION |
|---|---|---|---|
| Engine regression | Kritis | semua jalur lewat processCustomerMessage | DO NOT TOUCH + regression test FASE 0 |
| Duplicate history (HTTP+WS / web+WA) | Tinggi | response + event sama | messageId dedup (FASE 1) + persist sekali (FASE 3 §8) |
| Cross‑tenant leak | Kritis | WS room/event | room prefix `store:{storeId}` + auth guard |
| Mutex in‑mem (single instance) | Tinggi (masa depan) | acquireLock Map | reuse tidak diganti; redis mutex → FASE future (may change) |
| Web reconnect/mobile | Sedang | throttle background | backoff + history catchup |
| SW pass‑through belum push | Sedang | FASE 4 | fallback badge (WS) |
| customerPhone null = no WA delivery | Tinggi (gap Web) | conversations.ts:147/160 | FASE 3: Web via WS, bukan gateway |
| crypto.randomUUID imported? (lihat §9 VERIFY) | Medium | conversation.service.ts tidak import crypto | VERIFY runtime dulu; bila gagal → one‑line fix post‑approval |

---

## 9. VERIFY: crypto.randomUUID di conversation.service.ts — BUKAN bug sampai diverifikasi

```
FILE: business/conversation.service.ts
FUNCTION: saveMessage (:1080), buildResult, getOrCreateContext — memakai crypto.randomUUID()
ACTUAL: `import crypto` / `import { randomUUID }` TIDAK ada di conversation.service.ts
        (audit §24: imports 1‑35 — tidak ada crypto); semua file sejajar
        (auth.ts:2, messages.ts:2, conversation-context.service.ts:1) ADA import crypto.
        tsconfig lib ES2020 (tidak ada DOM global randomUUID).
IMPACT: bila runtime Node tidak expose global `crypto` — panggilan randomUUID
        melempar ReferenceError → conversationService gagal persist/reply buat
        SEMUA channel (web + WA). Bisa menghambat FASE 1 (messageId baru) + semua
        persist.
```

**DECISION (owner‑approved rule):** jangan anggap ini bug otomatis.
- **VERIFY RUNTIME FIRST** sebelum FASE 1:
  `node -e "console.log(crypto.randomUUID())"` pada environment pm2 yang sama
  (`apps/api`, pid 286707, api:3000).
- **Jika berhasil** (Node 22+ expose global `crypto`): `NO SOURCE CHANGE` —
  tidak tersentuh; jalankan FASE 1 normal. ID tetap berasal dari `crypto.randomUUID`
  di `saveMessage` (`conversation.service.ts:1078`).
- **Jika gagal** (ReferenceError): **ONE‑LINE FIX ONLY** setelah approval owner —
  tambahkan `import { randomUUID } from 'node:crypto'` di `conversation.service.ts`
  dan ganti panggilan ke `randomUUID()` (atau prefix `crypto.`). Ini satu‑satunya
  *engine‑adjacent touch* yang diperbolehkan. Laporkan hasil verifikasi ke owner
  sebelum implementasi.

> Catatan: karena ini berpotensi blocker, jadwalkan verifikasi ini di **FASE 0
> (task pertama)**, sebelum lock‑owner / messageId dibut. Jika butuh perbaikan,
> perbaiki duluan, baru lanjut fase.

---

## ENGINE PROTECTION — daftar akhir (tidak disentuh)

`conversation.service.ts`, `services/chat/*` (interpreter/normalizer/composer‑v2/
workspace/reasoning/planner/validator‑v2/pendingClarification/fast-path/
tier-match/engine‑config), `business/fallback.service.ts`, `business/order.service.ts`,
`business/conversation-context.service.ts`, `services/message-queue.service.ts`
(mutex), `services/message-processor.service.ts` (WA pipeline; *append‑only
publish* bila FASE 6 real‑time WA inbound—optional), `services/fonnte.service.ts`,
`adapters/whatsapp/gowa.adapter.ts`, `routes/webhooks.ts` (WA inbound message path;
hanya *append* device‑status), `routes/messages.ts`, `prisma/schema.prisma`,
`apps/dashboard/src/{contexts/AuthContext,services/api}.tsx`.

---

## PHASE SEQUENCE — klarifikasi urutan

Urutan **FASE 0→1→2→3→4→5→6** **disesuaikan** karena:
- FASE 0 contract harus final sebelum kode apa pun (foundation).
- FASE 1 realtime harus ada sebelum event delivery (FASE 2 publish).
- FASE 2 structured message sebelum UI render (FASE 5) dan sebelum admin reply
  mengirim structured payload (FASE 3).
- FASE 4 notifikasi butuh WS (FASE 1) + delivery (FASE 3).
- FASE 5 UI paling akhir (butuh semua kontrak).
- FASE 6 device status terpisah — boleh jalan paralel FASE 3‑5 (dependeks:
  hanya WS admin room). **Tidak mengubah urutan utama.**

---

## DELIVERABLE

Satu berkas: `DOCS/implementation-plan-chatbox-qlabot.md` (ini). **Tidak ada
file source yang diubah/dibuat, tidak ada dependency ter‑install, tidak ada
migration dieksekusi, tidak ada commit, tidak ada deploy.** (Dokumen design/plan
only — revisi berdasarkan review owner, tidak mengubah source.)

Berhenti pada dokumen ini — menunggu review & approval sebelum FASE 0
dieksekusi.

---

## OWNER REVIEW PATCH
Ringkasan keputusan hasil review owner terhadap plan, dengan jejak ke putusan
di atas. Setiap item mencantumkan DECISION / WHY / AFFECTED PHASE.

### 1. Lock ownership
- **DECISION:** SATU `acquireLock()` per web request, dimiliki oleh
  `conversationDeliveryService.processWebRequest()` (wrapper di luar engine).
  `pwa.ts` route handler tidak lagi memanggil `acquireLock` secara langsung;
  hanya meneruskan ke wrapper. WA path (`message-processor.service.ts:161`)
  tetap owner sendiri.
- **WHY:** mencegah double‑lock / lock‑leak; mutex (`messageQueueService.acquireLock`
  `:167`) dipakai ulang tanpa diganti kontraknya.
- **AFFECTED PHASE:** FASE 0 (contract), FASE 1 (flow), FASE 2 (persist order).

### 2. Structured persistence
- **DECISION:** engine `saveMessage` INSERT baris **sekali**; delivery layer
  **UPDATE** baris yang sama — `SET messageType=<type>, metadata.messagePayload=<payload>`.
  **Tidak ada INSERT kedua.** `message.id` (uuid) tetap sama → history reload
  merekonstruksi UI identik.
- **WHY:** hindari duplicate history; `message.created` (response + event) +
  history reload tetap konsisten; pakai kolom existing `messageType`+`metadata`
  (no migration).
- **AFFECTED PHASE:** FASE 2.

### 3. Structured fallback
- **DECISION:** hard rule — delivery **tidak** set `type` structured dari string
  matching; hanya bila ada authoritative source (tabel di §8.1). Bila ragu →
  `type:'text'`.
- **WHY:** cegah hallucinasi UI / payload korup; audit membuktikan engine masih
  kirim teks + metadata terbatas.
- **AFFECTED PHASE:** FASE 2, FASE 5 (renderer).

### 4. WS authentication
- **DECISION:** Web customer anon via `slug+webUid` di *connection query*; Admin
  via **Socket.IO `auth` middleware + Bearer** yang sama `authMiddleware`
  (`routes/conversations.ts:14`). **Tidak pakai query token di produksi.**
- **WHY:** query token bocer ke log/proxy; konsisten dengan Bearer auth dashboard
  yang sudah ada.
- **AFFECTED PHASE:** FASE 1.

### 5. Push storage
- **DECISION:** `pushSubscription` **persist** (bukan memory‑only). **Migration
  YES (design only):** kolom `Customer.pushSubscription Json?` (MVP, 1 device/browser)
  atau tabel `PushSubscription` (multi‑device). Rekomendasi Opsi A.
- **WHY:** harus bertahan PM2 restart / VPS reboot — memory cache tidak cukup.
- **AFFECTED PHASE:** FASE 4.

### 6. EventBus / Redis boundary
- **DECISION:** EventBus (in‑proc) = domain event *within process*; Socket.IO
  Redis Adapter = *room synchronization* hanya bila multi‑instance. Pada **single
  VPS MVP tidak perlu redis adapter.** Bukan dua pub/sub yang tumpang tindih.
- **WHY:** hindari arsitektur ganda yang overlap; scaling dikerjakan Redis adapter
  saja.
- **AFFECTED PHASE:** FASE 1, §0b, FASE 4.

### 7. Checkout scope
- **DECISION:** UI tombol `Checkout` (FASE 5) **terpisah** dari backend
  `finalizeDraftOrder` / payment flow (FASE backend terpisah). UI hanya presentasi
  state `orderStatus`; backend tetap owner. Jika backend belum ada, tombol disabled.
- **WHY:** `orderService` protected; jangan pernyataan "checkout selesai" dari UI.
- **AFFECTED PHASE:** FASE 5, FASE backend terpisah.

### 8. crypto verification
- **DECISION:** **VERIFY RUNTIME FIRST** (jalankan di pm2 environment) sebelum
  FASE 1. Jika `crypto.randomUUID()` bekerja di Node 22 → **NO SOURCE CHANGE**.
  Jika gagal → **ONE‑LINE FIX ONLY** (`import { randomUUID } from 'node:crypto'`)
  setelah approval owner.
- **WHY:** jangan angggap engine broken secara automatis; bisa jalan normal.
- **AFFECTED PHASE:** FASE 0 (task pertama), FASE 1.

---

### Discrepancy catatan (owner review)
Tidak ada discrepancy fungsional baru setelah verifikasi ulang; semua anker
(`pwa.ts:222-250`, `conversations.ts:74/122/147/160/150/164`, `webhooks.ts:154`,
`message-queue.service.ts:167`, `engine-config.ts:22`, `conversation.service.ts:81/1080`,
`messages.ts:57`, `apps/pwa/*` ChatPage:111/167/176) **match** kode aktual — line
drift kecalian (beberapa `:145→:150`, `:157→:164`) sudah dikoreksi di atas.
