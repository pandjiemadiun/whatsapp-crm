# FASE 3 — Pre-Implementation Inspection Report
**Target:** DASHBOARD ↔ WEB HUMAN MESSAGING (qlabot chatbox)
**Mode:** READ-ONLY (inspection only). Tidak ada source code diubah, tidak ada file dibuat di lugi ini, tidak install, tidak migration, tidak commit, tidak restart PM2.
**Tanggal:** 2026-08-13

## ⚠️ Verdict: ✅ READY FOR IMPLEMENTATION (extension, not rewrite)

Bukan BLOCKED — tidak ada kondisi hentikan A-L yang terpenuhi. Lihat bagian 15 & lampiran.

---

## 0. Lingkup & asumsi
- Repo: `/home/ubuntu/garuda`. API di `apps/api` (TS + Prisma 5.10, Node v24, socket.io 4.8). PWA di `apps/pwa` (Vite+React). Dashboard di `apps/dashboard`.
- `git status` baseline bersih kecuali `dist/`/`logs/`/`.env` (RAILS — tidak disentuh). HEAD FASE-2 = `69d8859` (final).
- Kontrak kanonis: `message.id` = `conversation_history.id` = HTTP `messageId` = WS `event.data.id`; `MessageCreatedData.sender: 'assistant'|'customer'|'human_agent'` (conversation-delivery.service.ts:30).

## 1. Backend: `routes/conversations.ts` — perilaku eksak
- **Auth:** `router.use(authMiddleware)` (line 14) → `req.user{storeId,email}` dari Bearer token = `storeSetting.auth_token` (middleware/auth.ts:19-34). **Satu mekanisme auth** untuk HTTP + WS admin. ✓ multi-tenant.
- **GET /** (lines 17-27): `conversationService.findAllByStore(storeId)` → `{success,data:[]}`. Store-scoped. ✓
- **GET /:id** (lines 30-71): ownership via `where {id, storeId, deletedAt:null}` (line 34). History select: `{id,role,content,source,createdAt}` (lines 44-50) — **tidak termasuk `messageType`/`metadata`** (beda `pwa.ts` GET /history yang select keduanya). **Gap #4**.
- **PUT /:id/status** (lines 74-104): `validateRequest(updateStatusSchema)`. Set `status` + `humanTakeoverAt` hanya untuk `human_takeover`/`open` (lines 88-92; `resolved`/lain tak set timestamp). **`resolvedAt` tidak pernah di-set** — gap. **Tidak publish EventBus** (tidak ada import `event-bus`) → tidak ada `conversation.handoff`/`resumed`/`resolved`/`updated`. **Gap #3**. Response `{success,message}`.
- **POST /:id/reply** (lines 107-184): `authMiddleware` + `validateRequest(replyMessageSchema)`. Ownership `where{id,storeId,deletedAt:null}` (line 113). **Persist single INSERT** `conversationHistory.create({role:'agent',source:'dashboard',content:sanitized})` (lines 122-129). `role='agent'` (bukan `'human_agent'` — mapping dilakukan publisher WS nanti). Lalu `conversation.update({lastMessageAt, status:'human_takeover', humanTakeoverAt})` (lines 132-139) — **SELALU kejar-human takeover, tidak ada per-channel** (untuk Web sempat berguna, untuk WA butuh). Lalu **unconditional Fonnte->GOWA fallback on `conversation.customerPhone`** (lines 141-173): hanya skip via `if(!conversation.customerPhone) warn` — **tidak ada cabang `channel==='web'`**; untuk Web phone null → keduanya skip, `sendError='No WhatsApp gateway configured'` atau null. Response `{success,message:'Reply sent',sendError}` — **tidak mengembalikan `messageId`** (**Gap #1**; PWA butuh untuk dedup). `messageQueueService.acquireLock` **tidak dipakai** di route ini (admin reply tidak panggil engine, tidak butuh lock engine-mutex; acceptable).

## 2. Backend: `services/realtime.service.ts` — Socket.IO foundation
- **Init:** `WS_PATH='/api/ws'` (line 9); mount `init(httpServer,corsOrigins)` (line 50). `io` instance.
- **Auth:** admin via `verifyAdminViaStoreSetting` (lines 26-38) — reuse `middleware/auth.ts` (storeSetting auth_token + expires). Web via query `slug+uid+conversationId` (lines 114-156): resolve store->customer(by webUid, store-scoped)->conversation(ownership, channel='web' verified lines 140-149). ✓ isolate per-store & per-conversation.
- **Rooms:** `store:${storeId}:conv:${conversationId}` (customer, line 19) & `store:${storeId}:admin` (line 23). Admin join `adminRoom`; customer join `customerConvRoom`. **Isolation tenant** via `${storeId}:*` prefix + authGuard storeId binding. ✓
- **Lifecycle:** `socket.on('connect')` (158); admin_typing emit ke customer conv room (186-195); `disconnect` decrement `onlineByStore` (197-201). Reconnection dikelola socket.io-client (reconnectionAttempts=10, backoff 1-5s) — server tidak simpan state.
- **dispatch (EventBus->WS)** (lines 205-255): routing lengkap:
  - `message.created` -> [customerConvRoom, adminRoom]
  - `typing.started/stopped` party=customer -> [adminRoom]; party=human_agent -> [customerConvRoom] (via `admin_typing` handler)
  - `conversation.handoff/resumed/resolved/updated` -> [adminRoom, customerConvRoom]
  - `notification.created` -> [adminRoom, customerConvRoom]
  -> **Plumbing WS sudah lengkap untuk semua 13 objective**. Gap bukan di sini — di publisher yang belum fire + client yang belum dengar.

## 3. Backend: `services/event-bus.service.ts` — EventBus in-proc
- **Tipe:** `ChatbotEventType = 'message.created'|'typing.started'|'typing.stopped'|'conversation.handoff'|'conversation.resumed'|'conversation.resolved'|'conversation.updated'|'notification.created'|'device.status.changed'` (9 tipe).
- **publish:** `EventEmitter` (in-proc), synchronous `emit` (lines 43-45). `subscribe(ev,handler)` returns unsubscribe (lines 48-55).
- **Listeners saat ini:** `realtime.service.ts` subscribe 8 tipe (lines 60-74) -> `dispatch`. `device.status.changed` tidak di-subscribe — minor.
- **Bagaimana `message.created` sampai ke Socket.IO:** `eventBus.subscribe('message.created', env => this.dispatch(env))` -> dispatch ke `customerConvRoom`+`adminRoom`. Jalan. Tapi sekarang hanya delivery publisher yang ada (assistant only).

## 4. Backend: `services/conversation-delivery.service.ts` — delivery layer
- **processWebRequest** (lines 75-201): SATU lock owner `messageQueueService.acquireLock(conversationId)` (line 79) — **reusable mutex** (msgproc pakai `messageQueueService.acquireLock(chatId)` line 161; singleton yang sama). Engine `processCustomerMessage(...,'web')` (lines 88-94) -> release (98) -> publish.
- **Publish saat ini:**
  - `!result || !result.message?.content` -> publish `conversation.handoff` `{conversationId,status:'human_takeover'}` + return `pending_human` (lines 102-112). ✓
  - else -> `mapStructured` UPDATE same row (FASE 2) -> publish `message.created` sender=`'assistant'` (lines 163-183). ✓
- **Gap kritis #5:** **tidak publish `message.created` untuk customer message** (engine `saveMessage` simpan `role='user'` tapi `processCustomerMessage` return hanya `result.message` = assistant reply — **customerMsgId tidak dikembalikan**). Jadi admin tidak terima customer message realtime (hanya typing). Delivery *bisa* read latest customer message via prisma (read-only, allowed) dan publish sender=`'customer'` ke `adminRoom` — **solusi tanpa sentuh engine**.
- **Gap:** tidak publish `conversation.updated` (lastMessageAt/reply) setelah publish message.created → dashboard list tidak realtime update.
- **Tidak publish `conversation.resumed`/`resolved`/`message.created`(human_agent)** — itu di route-side (conversations.ts), bukan di sini.

## 5. Backend: `services/structured-message.mapper.ts` & `chat/*` — dilindungi (tidak disentuh)
- `classifyStructured` (pure) + `mapStructured(result,conversationId)` async enrichment (product/cart/quick_reply, read-only) → `{messageType, messagePayload}`.
- **Protected list:** `services/chat/*` (interpreter, types-v2, composer-v2, normalizer, engine-config). **Tidak boleh di-edit.** FASE 3 tidak butuh perubahan mapper — structured message hanya untuk AI reply, bukan admin reply (admin reply = text biasa).
- `quick_reply` downgrades to `text` bila options kosong (patch 69d8859 FINAL).

## 6. Backend: `routes/pwa.ts` — Web Adapter (public)
- **GET /init** (lines 50-71): store public select (`PWA_STORE_PUBLIC_SELECT`, line 30) — meng-exclude credential kolom. ✓ anonim.
- **GET /history** (lines 75-154): resolve customer by `webUid` + store (lines 97-104); conversation by `channel='web'` (line 109). History select **termasuk** `messageType`+`metadata` (lines 121-129). Normalisasi ke shape kanonis `type`/`payload` (lines 134-147) — sama WS `message.created`. ✓
- **POST /message** (lines 159-276): resolve-or-create customer + Web conversation (`customerPhone:null`, `channel:'web'`, line 222) — **tepat satu conversation**, conversationId reuse. `conversationLimiter` (line 159); `eventBus` import tapi **hanya dipakai delivery** (processWebRequest, line 234). **HARUS tidak memanggil `acquireLock`** (line 230 comment) — delivery yang lock. Response `messageId=result.message.id=conversation_history.id` (line 263, HARD RULE #3), `type`/`payload`/`content`/`source`/`confidence`/`timestamp`; 429 `locked` (lines 241-246); `pending_human` (lines 248-256). ✓
- **POST /typing** (lines 284-340): throttle in-memory 1s/server (`typingThrottle` Map, lines 282-283). Publish `typing.started/stopped` party=`'customer'` channel=`'web'` (lines 329-334) -> EventBus -> dispatch -> `adminRoom`. ✓ customer typing -> admin (jika dashboard dengar).
- **Gap:** pwa.ts **tidak publish customer `message.created`** (delivery yang publish assistant-only lihat §4) — admin tak lihat customer message realtime.

## 7. Dashboard: `pages/ConversationInbox.tsx` — current flow (HTTP-only)
- **Conversation list (lines 112-117):** `GET /conversations` -> `res.data.data`; `setConversations`. **Polling/refresh manual** — `handleSend`/`handleTakeOver`/`handleResumeAI` *reload* list via GET (lines 163-164, 177, 193-194). **Tidak ada WS client** (import hanya `api` axios, line 7). **Gap #6**.
- **Selected conversation (lines 127-140):** `GET /conversations/:id` -> `detail.history`. Render `role==='user'`->customer bubble, `role==='agent'` atau selain->agent/assistant (lines 441-442, 465). History select dari `conversations.ts` -> **tidak ada `messageType`/`payload`** (structured tidak tersedia dashboard). **Gap #9**.
- **Reply composer (lines 184-198):** `POST /conversations/:id/reply {message}` -> reload. **Take Over (lines 156-168):** `PUT status:'human_takeover'`. **Resume AI (lines 170-182):** `PUT status:'open'`. **Tidak ada tombol Resolve (`'resolved'`)** — hanya filter `resolved` di tab (line 241) tapi tidak ada aksi set-resolved. **Gap #8**.
- **Unread:** tidak ada indikator unread / `lastReadAt` (grep §12). `aiResponseCount`/`faqResponseCount` ditampilkan tapi bukan unread. **Gap #7**.
- **Status rendering (lines 214-234):** `open`->"Dijawab bot", `human_takeover`->"Perlu kamu", else->"Selesai" (resolved). Konsisten schema. ✓

## 8. Dashboard: `contexts/AuthContext.tsx` & `services/api.ts` — auth contract (protected, tidak disentuh)
- **AuthContext:** `localStorage 'garuda_user'` (User{email,storeId,storeName,token,hasProfile}); `login`->`POST /auth/login`->`data.token`; simpan token. `Bearer` token = `storeSetting.auth_token`.
- **api.ts:** axios `baseURL:'/api'`; interceptor inject `Authorization: Bearer {user.token}` (lines 9-19); 401 -> clear + redirect `/`. **Protected — tidak boleh di-edit.** Berarti dashboard WS client harus **reuse token via query param** (Socket.IO client `auth`/query `token`), bukan interceptor (karena socket.io-client tidak otomatis bawa axios interceptor).
- **Kontrak auth dashboard = WS admin** (`verifyAdminViaStoreSetting` realtime.service.ts:26-38) — satu token, satu mekanisme. ✓

## 9. PWA: `components/ChatPage.tsx` — current WS lifecycle
- **Init:** `createChatSocket({slug,uid,conversationId})` pada mount bila ada ketiganya (lines 153-156). `socket.io` reconnection (lines 30-34 pwa api.ts).
- **connect (158):** kosong.
- **message.created (lines 161-186):** filter **`if (data.sender !== 'assistant') return;`** (line 172) -> **men-drop `human_agent`** (admin reply). Dedup `renderedIds` (173). Seed set dari history (128). type/payload default (180-181). **Gap kritis #2**.
- **typing (lines 189-194):** `party==='human_agent'` -> `setIsAdminTyping(true)` ("Admin sedang mengetik...", line 413). ✓ admin typing -> customer. Customer typing tidak diterima via WS (hanya HTTP /typing -> admin room).
- **reconnect catch-up (lines 203-213):** `socket.io.on('reconnect')` -> `GET /history`, append missing (dedup by id). ✓
- **onSend (lines 258-359):** optimistic user bubble (no id, line 273) -> `POST /message {uid,message}` -> seed `messageId` ke `renderedIds` (lines 289-291); 700-1300ms natural delay (lines 265-266, 293-338); `pending_human` -> system bubble "Pesan diteruskan ke admin" (lines 298-310); 429 -> error. **Tidak ada read state.**
- **Gap:** ChatPage tidak kirim `webLastReadAt` (read ack) — Gap #7.

## 10. PWA: `services/api.ts` — WS client factory (boleh di-edit)
- `api` axios no-auth public. `createChatSocket(query)` -> `io(origin,{path:'/api/ws',transports:['websocket'],reconnection:true,reconnectionAttempts:10,reconnectionDelay:1000,reconnectionDelayMax:5000,timeout:10000,query})`. ✓ query-auth.
- **Catatan constraint:** jangan pakai `autoUpgrade` (TS2353); jangan import `socket.io-client` dari `apps/api` (forbidden). Dashboard harus import dari `apps/dashboard` — **cek dependency** (`socket.io-client` harus ada di `apps/dashboard/package.json`).

## 11. Auth & tenant isolation — verifikasi
- Bearer token = `storeSetting.auth_token` (middleware/auth.ts:19-34) -> `storeId`. WS admin `verifyAdminViaStoreSetting` realtime.service.ts:26-38 **reuse kode sama**. ✓
- Tenant isolation: query `WHERE storeId = ?` di `conversations.ts` (lines 34, 80, 113), `pwa.ts` (findFirst storeSlug -> `store.id` -> query storeId), `realtime.service` (room prefix `store:${storeId}:*` + authGuard). `conversation` ownership via `customerId`+`storeId`+`channel`. `customer` by `webUid`+`storeId` (pwa.ts:97, 197). ✓
- Web auth query `slug+uid+conversationId` diverifikasi melawan store (realtime.service.ts:114-156). `conversationId` milik `storeId`+`customerId`+`channel='web'`. ✓ cross-tenant aman.

## 12. Read/unread state — temuan (grep kosong)
- `grep -rn "webLastReadAt|adminLastReadAt|unreadCount|lastReadAt" src/ apps/` -> **kosong (0 hasil)**. Tidak ada kolom/index khusus.
- `Conversation.metadata Json?` tersedia (schema.prisma:46) -> bisa nyimpan `webLastReadAt`/`adminLastReadAt` keys — **tanpa migration**.
- `ConversationHistory.role` = `String` (schema.prisma:174, `@@index([role])`) — nilai: `user`(customer), `assistant`(AI), `agent`(human admin via conversations.ts:125).
- `Conversation.status` default `'open'`; nilai `open`/`human_takeover`/`resolved`; `resolvedAt`/`humanTakeoverAt` kolom ada. `channel` default `'whatsapp'` (schema.prisma:21) — Web conversation `channel='web'` konsisten.
- => **Tidak ada schema change** yang dibutuhkan.

## 13. WhatsApp branch — verifikasi terisolasi
- WA ingress: `routes/webhooks.ts` POST `/gowa` & `/fonnte` -> `messageProcessorService.processMessage({channel:'whatsapp',gateway,customerPhone,...})` (lines 109-110, 249-270) -> `sendWithPresence` -> `fonnteService.sendMessage`/`gowaAdapter.sendMessage(phone,text,config)` (fonnte.service.ts:86, gowa.adapter.ts:44) — **hanya bila `customerPhone` ada**. ✓
- WA egress (reply to WA customer): hanya via gateway (`customerPhone` wajib, msgproc guard line 241-243). Web tidak nyentuh gateway.
- `processCustomerMessage` (engine, jalur Web) — grep `sendWithPresence|gateway|fonnte|gowa|smartRetrySend` di `business/conversation.service.ts` -> **kosong (0 hasil)**. Engine **tidak pernah kirim via gateway** untuk Web. ✓ Web reply = HTTP response.
- `conversations.ts POST /reply` Fonnte/GOWA: dipanggil **unconditional** tapi `if(!conversation.customerPhone) skip` (lines 147, 160). Untuk Web `customerPhone=null` -> skip — tapi **tidak ada channel guard** (akan selalu ke sini meski channel='web'). Gap: perlu `if channel==='web'` -> lewati ke WS. **Tidak perlu ganti WA gateway** (B tidak terpenuhi).

## 14. Event flow proposal (pustaka kebutuhan, tanpa desain rinci)
Ringkasan siapa yang harus **publish** apa (EventBus sudah ada + dispatch sudah rute):

| Trigger | Publisher | Event | Data | Tujuan |
|---|---|---|---|---|
| Customer kirim (Web) | delivery (prosesWebRequest) — tambahan | `message.created` sender=`customer` | `{id:customerMsgId,content,createdAt}` | Admin lihat customer message realtime |
| Customer kirim (Web) | delivery existing | `conversation.updated` | `{lastMessageAt,...}` | Dashboard list refresh |
| Assistant reply (Web) | delivery (sudah ada) | `message.created` sender=`assistant` | — | PWA render |
| Admin reply (dashboard) | conversations.ts POST /:id/reply — tambah | `message.created` sender=`human_agent` | `{id:history.id,content,...}` | PWA render |
| Admin Take Over | conversations.ts PUT /:id/status — tambah | `conversation.handoff` | `{conversationId,status:'human_takeover'}` | sinkronisasi |
| Admin Resume AI | conversations.ts PUT /:id/status — tambah | `conversation.resumed` | `{conversationId,status:'open'}` | — |
| Admin Resolve | conversations.ts PUT /:id/status — tambah | `conversation.resolved` | `{conversationId,status:'resolved',resolvedAt}` | — |
| Status change | conversations.ts PUT /:id/status — tambah | `conversation.updated` | `{conversationId,status}` | list refresh |
| Admin/Customer typing | sudah ada | `typing.started/stopped` | — | dua-arah |
| Read ack | pwa POST /read baru + dashboard scroll marker | `conversation.updated` (metadata.lastReadAt) | — | unread badge |

**Catatan teknis penting:**
- `human_agent` vs `agent`: DB role=`agent` (conversations.ts:125), tapi WS `MessageCreatedData.sender` harus `'human_agent'` (MessageCreatedData type conversation-delivery.service.ts:33) -> publisher (POST /reply) set `sender:'human_agent'` pada publish, **bukan** nilai role DB.
- Customer message.publish: delivery harus read latest customer `ConversationHistory` (read-only prisma) lalu publish — **tidak perlu sentuh `processCustomerMessage`/`saveMessage`**.
- `PUT /:id/reply` Fonnte/GOWA perlu **channel guard**: `if (conversation.channel === 'whatsapp') { ...existing gateway send... }` (Web -> WS; phone tetap null).
- Dashboard WS client: import `socket.io-client` di `apps/dashboard` — **cek dependency**.
- Read/unread: pakai `Conversation.metadata Json` (`webLastReadAt`/`adminLastReadAt`); tidak perlu migration.

## 15. Daftar gap & file yang perlu diperlakukan (INSPECTION ONLY — tidak di-edit)

**CRITICAL**
1. `conversations.ts:175-179` — POST /reply tidak kembalikan `messageId` -> PWA tidak bisa seed dedup. **Perlu:** sertakan `messageId: historyRow.id` di response.
2. `pwa.ts ChatPage.tsx:172` — filter `sender !== 'assistant'` men-drop admin reply (`human_agent`). **Perlu:** ubah jadi terima `human_agent` + render sebagai agent bubble.
3. `conversations.ts:141-173` — POST /reply kirim Fonnte/GOWA tanpa channel guard. **Perlu:** `channel==='web'` -> lewati ke WS; `channel==='whatsapp'` tetap.
4. `conversations.ts:73-104` — PUT /status tidak publish `conversation.*`. **Perlu:** import `eventBus`, publish berdasarkan status; `resolved` set `resolvedAt`.
5. `conversation-delivery.service.ts:102-183` — tidak publish customer `message.created`. **Perlu:** read latest `ConversationHistory` role=`user`, publish sender=`customer` + `conversation.updated`.
6. **Dashboard belum WS client** (`ConversationInbox.tsx`). **Perlu:** client baru join `adminRoom`, dengar event; pastikan `socket.io-client` di `apps/dashboard/package.json`.

**IMPORTANT**
7. **Read/unread belum ada** (grep kosong). **Perlu:** `Conversation.metadata {webLastReadAt, adminLastReadAt}`; endpoint `POST /conversations/:id/read` (admin) + PWA read ack; badge di dashboard.
8. `ConversationInbox` **tidak ada tombol Resolve**. **Perlu:** aksi `PUT status:'resolved'` + UI.
9. `conversations.ts:44-50` — GET /:id history tidak select `messageType`/`metadata`. **Perlu:** tambahkan select.

**MINOR / opsional FASE 3**
10. `PUT /:id/status` tidak set `humanAgentId` (kolom schema.prisma:49 tersedia tapi tidak diisi).
11. `device.status.changed` type ada tapi tidak disubscribe — tidak relevan FASE 3.

## File dilindungi (TIDAK disentuh)
`business/conversation.service.ts` (termasuk `processCustomerMessage`, `saveMessage`, `buildResult`, `getOrCreateContext`), `services/chat/*` (interpreter, types-v2, composer-v2, normalizer, engine-config), `business/fallback.service.ts`, `business/order.service.ts`, `business/conversation-context.service.ts`, `services/message-queue.service.ts` (termasuk `acquireLock`), `services/message-processor.service.ts`, `services/fonnte.service.ts`, `adapters/whatsapp/gowa.adapter.ts`, `routes/webhooks.ts`, `routes/messages.ts`, `prisma/schema.prisma`, `apps/dashboard/src/contexts/AuthContext.tsx`, `apps/dashboard/src/services/api.ts`.

## Protected functions (tidak di-edit)
`processCustomerMessage()`, `saveMessage()`, `buildResult()`, `getOrCreateContext()`, `acquireLock()`.
