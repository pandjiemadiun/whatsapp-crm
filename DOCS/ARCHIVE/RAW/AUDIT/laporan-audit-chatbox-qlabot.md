# Laporan Audit READ-ONLY — Chatbox / Conversation / Message / Realtime QloBot

**Cakupan:** audit data‑fakta (bukan rekomendasi desain / bukan library).
**Sumber kode:** `apps/api/src` (v5.22 Prisma, Node 22, Express), `apps/pwa/src`
(React 19 + Vite 8), `apps/dashboard/src` (React 19 + Vite).
**Head‑note:** setiap fakta dilengkapi `FILE:LINE`. "TIDAK DITEMUKAN" = tidak ada
di kode sumber (bukan asumsi).

> Semaphore: perintah "JANGAN membuat file / refactor / memperbaiki" berlaku
> untuk **source code**. File ini adalah **laporan dokumentasi** yang
> secara eksplisit diminta pengguna ("buatkan laporan tersedia di DOCS/").
> Tidak ada file sumber yang dimodifikasi.

---

## Ringkasan eksekutif (10 fakta kunci)

1. Chatbox (PWA) hanya **teks** — `apps/pwa/src/components/ChatPage.tsx` +
   `ChatBubble.tsx`. Tidak ada attachment, image, link, quick-reply button,
   product‑card, cart drawer, atau checkout UI.
2. **Web message flow** = langsung: `ChatPage.onSend → POST /api/pwa/:slug/message
   → pwa.ts → conversationService.processCustomerMessage('web') → conversation_history`
   + HTTP JSON kembali ke ChatPage. **Melewati messageProcessor / queue / gateway WA.**
3. **WA inbound flow** = `webhooks.ts → messageProcessor.processMessage →
   processWithLock → conversationService.processCustomerMessage('whatsapp') →
   saveMessage → sendWithPresence → fonnte/gowa sendMessage`.
4. COMPOSE + PERSIST **bersatu** di `conversationService.processCustomerMessage`
   (dipanggil baiWA maupun Web). DELIVERY **terpisah per channel** (Web=HTTP JSON,
   WA=gateway). **Tidak ada fan-out "compose sekali → kirim ke banyak channel".**
5. **Mutex** = `messageQueueService.acquireLock(chatId)` — in‑memory `Set`,
   **bukan Redis**, eksport singleton (reusable). Dipakai WA (message‑processor
   :161) **dan Web** (pwa.ts :214). Key = `lock:${chatId}`≈`conversationId`.
6. **customerPhone fallback** (`conversation.service.ts:75`) =
   `channel === 'web' ? null : customerId`. **Untuk Web → null (bukan webUid).**
7. **conversationService.processCustomerMessage tidak menerima parameter
   customerPhone**; nilainya selalu diturunkan dari `channel`. Tidak ada cara
   explicit‑pass `null`.
8. **Persistence**: `saveMessage()` (`conversation.service.ts:1074`) menulis ke
   tabel `conversation_history` (role/content/source/costUSD/metadata).
9. **Realtime: TIDAK ADA.** Tidak ada WebSocket/SSE/Socket.IO/`setInterval` di
   `apps/api`, `apps/dashboard`, `apps/pwa`. Dashboard fetch satu kali di‑mount;
   PWA tidak poll. WA outbound lewat polling Fonnte (60 s in‑proc cache).
10. **Human handoff ada**, tapi **admin→customer hanya via WA gateway**
    (`conversations.ts:147` fonnte / `157` gowa). Untuk Web (`customerPhone=null`)
    balasan admin **dilewati (skip)**. Chatbox web **satu arah** saat ini.

---

## 1. CHATBOX FRONTEND  (`/apps/pwa`)

Komponen ada di **20 baris** — semua teks/inline styles (Tailwind), tidak ada
library UI manapun (tidak ada assistant‑ui / ChatScope / react‑chat‑widget).

| Elemen | FILE | LINE | FUNGSI | DATA MASUK | DATA KIRIM |
|---|---|---|---|---|---|
| Entry point | `apps/pwa/src/main.tsx` | 6-13 | `createRoot(...).render(<BrowserRouter><App/>)` | — | — |
| Route | `apps/pwa/src/App.tsx` | 4-12 | `<Routes>`: `/c/:slug`→ChatPage, `*`→NotFound | `slug` (param) | — |
| Halaman | `apps/pwa/src/components/ChatPage.tsx` | 56 | komponen utuh chat | `store` (init), `messages` (history) | `input` state |
| Message list | `ChatPage.tsx` | 280-298 | render `messages.map→<ChatBubble>` + isTyping + error | `messages: HistoryMsg[]` | — |
| Message bubble | `apps/pwa/src/components/ChatBubble.tsx` | 10-42 | `role user/assistant/system`, isTyping dot‑pulse | `{role,text,source,isTyping}` | — |
| Input | `ChatPage.tsx` | 302-311 | `<input>` 1‑baris, `Enter` (no‑shift) | `input` state | — |
| Send handler | `ChatPage.tsx:157` `onSend()` | 157-242 | `api.post('/pwa/:slug/message',{uid,message})` | `input` | `{uid,message}` |
| Typing indicator | `ChatBubble.tsx:21-33` + `index.css:11-23` | — | `isTyping`→"mengetik" 3‑dot `.dot-pulse` | `isTyping` (state) | — |
| Loading indicator | `ChatPage.tsx:244-249` | 244 | state `loading`→`<p>Memuat…</p>` | — | — |
| Loading (send) | `ChatPage.tsx:317` | 317 | state `sending`→button "Mengirim…" + input `disabled` | — | — |
| Error / retry | `ChatPage.tsx:294-296` | 294 | state `error`→merah; 429→"Sesi sedang sibanyak, mohon kirim lagi." | `error` (state) | **TIDAK DITEMUKAN** (tidak ada tombol retry; hanya teks) |
| Attachment | — | — | **TIDAK DITEMUKAN** (tidak ada `<input type=file>`, `FormData`, `Blob`, `accept`) |
| Image (pesan) | — | — | **TIDAK DITEMUKAN** (hanya `store.profilePhotoUrl` di header, bukan image pesan) |
| Link | `ChatBubble.tsx:35` | 35 | `whitespace-pre-wrap` — URL/URL tidak diparse; **bukan** `<a>` | — | **TIDAK DITEMUKAN** (link tidak klik‑able) |
| Button / quick reply | — | — | **TIDAK DITEMUKAN** (`ChatBubble` tidak render options; `ClarificationOption` ada di TS backend tapi reply dilipat jadi teks) |
| Product card | — | — | **TIDAK DITEMUKAN** (produk disampaikan teks, lihat §18) |
| Cart UI | — | — | **TIDAK DITEMUKAN** (keranjang disampaikan teks: "🛒 Ditambahkan ke keranjang…") |
| Checkout UI | — | — | **TIDAK DITEMUKAN** (tidak ada tombol checkout di PWA; `orderService.finalizeDraftOrder` hanya dipicu keyword "done ordering", tidak ada UI) |
| Header | `ChatPage.tsx:264-277` | 264 | `store.profilePhotoUrl` img / fallback "Logo" + `store.name` / fallback "Toku" | `data.store` dari GET `/init` | — |
| Store identity | `ChatPage.tsx:105-109` / `pwa.ts:50-71` | 109 | GET `/pwa/:slug/init` → `data.store` | `{name,profilePhotoUrl,description,businessCategory,address,timezone,operatingHours,acceptsQris,acceptsCod,acceptsTransfer,qrisImageUrl,shippingMode,shippingFlatInCity,shippingFlatOutCity}` | — |
| Customer identity | `ChatPage.tsx:88-96` | 90 | `localStorage['garuda_pwa_uid']` = `crypto.randomUUID()` (satu/per browser); dikirim `uid` | — | `{uid, message}` di POST `/message` |

> API client PWA (`apps/pwa/src/services/api.ts:1-13`): axios baseURL `/api`,
> **tanpa** interceptor Authorization (beda dashboard yang Bearer). Dev via Vite
> proxy `/api → localhost:3000`; `base: '/c/'` di `vite.config.ts:15`.

---

## 2. ACTUAL MESSAGE FLOW  (contoh: customer ketik "aku mau sosis dan kentang")

### Jalur Web (yang jalan di chatbox PWA)
```
ChatPage.onSend()                                          ChatPage.tsx:157
  → api.post('/pwa/:slug/message', { uid: webUid, message })   pwa/src/services/api.ts:7 ; ChatPage.tsx:176-179
  → POST /api/pwa/:storeSlug/message                              routes/pwa.ts:140  (conversationLimiter)
       resolve store by slug (pwa.ts:152)
       resolve-or-create Customer by webUid, phone=null         pwa.ts:165-186
       resolve-or-create Conversation ch='web', customerPhone=null pwa.ts:189-207
       acquireLock(conversationId) via messageQueueService       pwa.ts:214  (429 bila terkunci)
       → conversationService.processCustomerMessage(store.id, customerId, conversationId, message, 'web')  pwa.ts:222-228
            getOrCreateContext (rolling last 10)                  conversation.service.ts:107→1029
            getStoreEngine(storeId) → default 'v1'                engine-config.ts:19-23
            ├─ V1 fast-path: normalize(normalizedMsg, productDictionary)      normalizer.ts:142 ; conversation.service.ts:596
            ├─ fallbackService.getResponse(normalizedMsg, pipelineCtx)        fallback.service.ts:74 ; conversation.service.ts:614
            │     tier urut: cache→FAQ→order_status→total→shipping→payment→sop→catalog→product(tryProduct)→knowledge→HUMAN
            │     (sosis/kentang mungkin termasuk katalog/knowledge; bila miss→)
            ├─ interpreter.runOneCall(normalizedMsg, pipelineCtx)  (SATU panggilan Groq)  interpreter.ts:46 ; conversation.service.ts:627
            │     → intent='buy', cart_ops [{add sosis},{add kentang}]
            ├─ validateCartOpsAgainstDb(cart_ops, storeId)         interpreter.ts:144 ; conversation.service.ts:637  (harga dari DB)
            ├─ executeCartOps(valid, pipelineCtx, normalizedMsg)  conversation.service.ts:884-921
            │     → conversationContextService.modifyCart('add')  conversation-context.service.ts:287
            │     → orderService.syncCartStateToDraftOrder(...)    order.service.ts:111
            ├─ reply: bila LLM reply_draft ada → truncateTo2Sentences(buildResult AI) ; bila hanya add → renderCartSummary  conversation.service.ts:662-680
            ├─ saveMessage(customerMessage)                          conversation.service.ts:1074  (→ conversation_history role='user')
            ├─ saveMessage(result.message)                         conversation.service.ts:763  (→ conversation_history role='assistant')
            ├─ conversationContextService.appendMessage x2 + refreshSession
            └─ return result
       release() ; → res.json({ success, conversationId, content, source, confidence, timestamp })   pwa.ts:240-247
  ← res.data { success:true, content:"🛒 Ditambahkan ke keranjang: sosis x1 …" }   (atau pending_human)
ChatPage onSend (catch)                                          ChatPage.tsx:198-230
  → body.status==='pending_human' ? system bubble "Pesan diteruskan ke admin, mohon tunggu"  :230-297
  → else body.content!=null → isTyping(max(700-1300ms,elapsed)) → setTimeout 0ms | timer → append <ChatBubble role='assistant' content={body.content}>
```

Contoh balasan Web untuk "aku mau sosis dan kentang" (v1, add executed, reply_draft kosong) →
`renderCartSummary` (conversation.service.ts:961-986) menghasilkan **teks**:
`Keranjang belanja Kakak sudah diperbarui ya.` + `*Keranjang sekarang:* • sosis x1 — Rp … • kentang x1 — Rp …` +
`Mau tambah yang lain atau sudah cukup Kak? 😊`. **Bukan** structured payload.

### Jalur WA inbound (untuk kontras)
```
Fonnte/GOWA webhook POST /api/webhooks/fonnte|gowa           routes/webhooks.ts:129 / :60
  → messageProcessorService.processMessage(input)              message-processor.service.ts:96
       isDuplicate(messageId)  (LRU 5 m, Set Map)              message-queue.service.ts:179
       isDeadEndWithContext   (regex)                          message-queue.service.ts:119
       priority = isUrgent                    ; bufferMessage (coalesce 5-15s)  message-queue.service.ts:135/227
       acquireLock(chatId)                    (in-mem Set)      message-queue.service.ts:167 / mp:161
       processWithLock → conversationService.processCustomerMessage(...,'whatsapp')  mp:256-263 ; conversation.service.ts:59
       sendWithPresence(input, result.message.content)         mp:299
            presenceSimulatorService.simulateResponse (85% presence)  mp:338 / presence-simulator.service.ts
            sleep(effectiveDelay)
            smartRetrySend(phone, content, config, gateway)     mp:373 → gateway.sendMessage (fonnte/gowa)  mp:463
```

---

## 3. CONVERSATION ENGINE  (komponen terkait)

Inventaris file mesin chat: `apps/api/src/services/chat/` (17 file) +
`apps/api/src/business/fallback.service.ts` (tier),
`conversation.service.ts` (orchestrator), `order.service.ts`.

**A. Fungsi yang menerima pesan customer**
- `conversationService.processCustomerMessage(storeId, customerId, conversationId, customerMessage, channel='whatsapp')` — `apps/api/src/business/conversation.service.ts:59`
  (WA lewat `messageProcessor.processMessage` :96; Web lewat `pwa.ts` :222 langsung ke sini).

**B. Fungsi yang membangun context/history**
- `conversationService.getOrCreateContext(storeId,customerId,conversationId,newMessage)` — `conversation.service.ts:1029` (baca `conversationHistory` ORDER BY createdAt asc, slice(-10)).
- `conversationContextService.getContext(conversationId)` — `conversation-context.service.ts:66` (baca `conversation_context`, cek sessionExpire).
- `conversationService.buildPipelineContext(...)` — `conversation.service.ts:819` (gabungan cart activeOrder storeProducts entities).

**C. Fungsi yang memanggil AI**
- `interpreter.runOneCall(normalizedMsg, pipelineCtx)` — SATU panggilan Groq (temp 0.2, jsonMode, maxTokens 250) — `services/chat/interpreter.ts:46` (dipanggil conversation.service.ts:627).
- `fallbackService.getResponse(normalizedMsg, pipelineCtx)` — 0‑LLM tier — `business/fallback.service.ts:74`.
- (v2): `reasoning.untern()` → `planActs` → `validator.validate` → `composer.composeReply` — `conversation.service.ts:132-341` (engine v2, default OFF; `getStoreEngine` mengembalikan `'v1'` bila tidak ada Redis config — `engine-config.ts:22`).

**D. Fungsi yang menyimpan message**
- `conversationService.saveMessage(message)` — `conversation.service.ts:1074` → `prisma.conversationHistory.create({role,content,source,costUSD,metadata,createdAt})`.
- `conversationService.appendMessageWithContext(conversationId, role, content)` — `conversation.service.ts:1205` (simpan + sync context).

**E. Fungsi yang mengirim message ke channel/gateway**
- WA: `messageProcessor.sendWithPresence(input, content)` — `message-processor.service.ts:323` →
  `smartRetrySend(phone, content, config, gateway)` :463 → `gateway.sendMessage(phone, content, config)`
  (fonnte `fonnteService` :86 / gowa `gowaAdapter` :44). Delivery = WA gateway saja.
- Web: **TIDAK ADA fungsi kirim ke gateway.** Delivery = HTTP response (`pwa.ts:240`).
- Note: pwa.ts memanggil `acquireLock` (`message-queue.service.ts:167`) **secara langsung**,
  melewati `messageProcessor` — pola yang sama, key = `lock:${conversationId}`.

**F. Fungsi yang mengirim response kembali ke Chatbox**
- Web: `res.json({ success, conversationId, content, source, confidence, timestamp })` — `routes/pwa.ts:240`;
  atau `{ success:true, message:null, status:'pending_human', conversationId }` — `pwa.ts:232` (human_takeover).
- Admin→customer: `fonnteService.sendMessage(conversation.customerPhone, ...)` /
  `gowaAdapter.sendMessage(...)` — `routes/conversations.ts:150/164`. **Untuk Web (customerPhone null) → di‑skip** (`:147/:160` guard).

---

## 4. COMPOSE vs PERSIST vs DELIVERY  (topologi sebenarnya)

```
conversationService.processCustomerMessage()          business/conversation.service.ts:59
├── COMPOSE   (shared):  V1: fallbackService.getResponse (0-LLM tiers)        fallback.service.ts:74
│                        ├─ jika miss → interpreter.runOneCall (1 Groq)      interpreter.ts:46
│                        V2: workspace → reasoning → planActs → composeReply  conversation.service.ts:132-341
├── PERSIST   (shared):  saveMessage(customer) + saveMessage(assistant)        conversation.service.ts:756-763
│                        appendMessage (context lastMessages) + refreshSession + updateConversationStats
└── DELIVERY  (DIVERGEN):
        Web  → HTTP response (res.json)                                         routes/pwa.ts:240         [bypass messageProcessor]
        WA   → messageProcessor.sendWithPresence → presenceSimulator →           mp:299
               smartRetrySend → gateway.sendMessage(fonnte|gowa)

conversationService.processCustomerMessage()
  → memanggil getOrCreateContext, getStoreEngine, fallbackService, runOneCall,
    saveMessage (prisma.conversationHistory), orderService (executeCartOps),
    conversationContextService (appendMessage/refreshSession)
  → TIDAK memanggil messageQueueService.acquireLock / sendWithPresence / gateway
    (itu milik messageProcessor, yang hanya dipakai channel WA).

messageProcessorService.processMessage()               message-processor.service.ts:96
  → memanggil messageQueueService.isDuplicate/bufferMessage/acquireLock,
    circuitBreaker, conversationService.processCustomerMessage,
    sendWithPresence (→ gateway.sendMessage), notifyHumanTakeover,
    healthMonitorService.updateQueueDepth

messageQueueService                    message-queue.service.ts:151  (singleton eksport)
  → processingLocks: Map<string,boolean>  (key `lock:${chatId}`)   :167 acquireLock
  → dedupeCache: Map<string,number> (LRU 5 m)                         :179 isDuplicate
  → textBuffers/mediaBuffers (coalesce timer)                         :227 bufferMessage

fonnnteService / gowaAdapter           implements IWhatsAppGateway  (whatsapp-gateway.interface.ts:9)
```

**Fakta:** tidak ada lapisan "DELIVERY" tundukal yang menerima sekali compose lalu
meng‑fan‑out ke banyak channel. Compose+persistence sudah ter‑coupling ke channel
(lewat `channel` flag + `customerPhone` fallback), tapi **delivery mekanisme tetap
berbeda** — Web via HTTP, WA via gateway. `messageQueueService` (mutex/dedupe/
coalesce) dipakai WA‑inbound dan juga di‑reuse Web (pwa.ts:214) untuk mutex‑nya‑send.

---

## 5. ACTUAL MESSAGE SCHEMA

**DB — tabel `conversation_history` (`prisma/schema.prisma:171`):**
| FIELD | TYPE | FUNGSI | DIPAKAI DI |
|---|---|---|---|
| id | String @id (uuid) | PK message | conversation.service.ts:1078 (saveMessage) |
| conversationId | String (FK) | thread‑binding | conversation-history.repo |
| role | String | 'user' / 'assistant' / 'agent' | conversation.service.ts:1080 (`customer→user`, lain→`assistant`); conversations.ts:126 (admin reply = `agent`) |
| content | String | teks balasan / pertanyaan | saveMessage, getOrCreateContext |
| messageType | String? (nullable) | **TIDAK DITEMUKAN** di kode — kolom ada tapi tidak ditulis dibaca |
| source | String? (nullable) | ResponseSource (cache/faq/ai/human/…) | conversationHistory select (routes/conversations.ts:47) |
| aiModel | String? | **TIDAK DITEMUKAN** — kolom tidak ditulis |
| costUSD | Float @default(0 | | biaya (harga/1000) | conversation-history repo ; ConversationStats (conversation.service.ts:1306) |
| responseTime | Int? | **TIDAK DITEMUKAN** — kolom tidak ditulis |
| metadata | Json? | entities / stagesReached / llmCallCount / finalIntent / cartOpsExecuted | conversation.service.ts:785-791 ; :1084 |
| createdAt | DateTime @default(now()) | urutan / rolling window | getOrCreateContext ORDER BY createdAt |
| updatedAt | DateTime @updatedAt | — | — |

**TS type `ConversationMessage` (`domain/types.ts:18-27`):**
`{ id, conversationId, sender:'customer'|'assistant'|'human_agent', content, source?:ResponseSource, cost?, metadata?, createdAt }`.
- Perbedaan DB↔TS: DB `role`='user'/'assistant'/'agent' vs TS `sender`='customer'/'assistant'/'human_agent'; DB `costUSD` vs TS `cost`; kolom DB `messageType`,`aiModel`,`responseTime` **tidak ada** di TS.
- Mapping 'agent'→TS tidak ada (getOrCreateContext:599 memetakan hanya `'user'?customer:assistant`, jadi balasan admin 'agent' terbaca sebagai 'assistant').

**API response envelope (Web):**
- init: `{ success:true, data:{ store } }` — `pwa.ts:66`
- history: `{ success:true, data:{ history:[] } }` — `pwa.ts:130` (history item select: id,role,content,source,createdAt)
- message: `{ success:true, conversationId, content, source, confidence, timestamp }` — `pwa.ts:240`; atau `{ success:true, message:null, status:'pending_human', conversationId }` — `pwa.ts:232`.

> ⚠️ Observasi teknis (resolusi runtime **tidak dikonfirmasi**): `saveMessage`
> (`conversation.service.ts:1074`) dan `buildResult` `:1008` memakai
> `crypto.randomUUID()` (:83/:212/:280/:362/:1010/:1078,…). Di file ini
> **tidak ditemukan** pernyataan `import crypto` (kontras: `auth.ts:2`,
> `messages.ts:2`, `conversation-context.service.ts:1` semuanya meng‑import).
> tsconfig `lib: ["ES2020"]` (tidak ada DOM → tidak ada global `crypto` tipografi).
> Ak dampak belum dipastikan pada audit ini.

---

## 6. CONVERSATION SCHEMA  (`/apps/api/prisma/schema.prisma:140`)

Model `Conversation`:
`id (uuid) | storeId | customerId | customerName? | customerPhone? | status (default 'open') | channel (default 'whatsapp') | lastMessageAt? | aiResponseCount | faqResponseCount | humanTakeoverAt? | humanAgentId? | resolvedAt? | notes? | metadata Json? | createdAt | updatedAt | deletedAt`
+ relasi `store`, `history[]`, `context?`, `orders[]`. Relasi ke `Customer` lewat `customerId` (bukan FK Prisma‑level, lookup manual).

**Identitas conversation:**
- Web: `prisma.conversation.findFirst({ where:{ storeId, customerId, channel:'web', deletedAt:null } })` — `routes/pwa.ts:108-109`
- WA: `conversationId` = `chatId` (dari `fromJid`/sender di webhook) — `webhooks.ts:106`; `customerId: customerPhone` — `webhooks.ts:104`.
- `customerPhone` **nullable**; untuk Web selalu `null` (pwa.ts:203, conversation.service.ts:75).
- `status` nilai yang dipakai: `open` (aktif AI), `human_takeover` (ambil alih admin / circuit‑breaker / eskalasi), `resolved` (manual / via `updateConversationStatus`).

Model terkait: `ConversationHistory` (:171), `ConversationContext` (:193 —
`lastMessages Json? | extractedEntities Json? | sessionKey | sessionExpireAt | userIntent | workspace_v2 Json?`), `Customer` (:207), `Order` (:219), `OrderItem` (:233).

---

## 7. CUSTOMER IDENTITY

Customer (`schema.prisma:207`):
`id (uuid) | storeId | phone? | webUid? @unique | name? | originCity? | nameSource? | visitCount (default 0) | firstSeenAt | lastSeenAt | notes? | deletedAt`.
Unique: `[storeId, phone]`; `webUid` **global** `@unique`.

**Anon/pWA (Web):**
- Tidak ada login, tidak ada token (PWA `api.ts:1-13` sengaja tak ada Authorization).
- Identitas = `garuda_pwa_uid` di `localStorage`, di‑seed `crypto.randomUUID()` di
  browser — `apps/pwa/src/components/ChatPage.tsx:90-96` (satu per browser; reload reuse,
  browser baru → baru). Dikirim sebagai field `uid` (bukan `customerId`).
- Backend resolve: `prisma.customer.findFirst({ where:{ webUid, storeId } })` — `pwa.ts:97-100/165-168`;
  create bila belum ada (`{ storeId, webUid, phone: null }`) — `pwa.ts:171-173` (race P2002 → retry findFirst — `pwa.ts:175-181`).
- Web customer **tidak punya phone** — `customerPhone` tetap `null`.

**WA:** `customerId` = nomor WA (string), `customerPhone` = nomor WA — `webhooks.ts:104-105`.
Customer dicari/dibuat lewat fonnte service (phone).

---

## 8. PWA CHATBOX — state & lifecycle (ChatPage.tsx)

- Mount urutan: (1) `webUid` dari localStorage — `:88-96`; (2) `GET /pwa/:slug/init`
  → `setStore` — `:105-109`; (3) `GET /pwa/:slug/history?uid=` → `setMessages` — `:110-114`;
  (4) `bottomRef.scrollIntoView` tiap ganti `messages` — `:129-131`; (5) listener
  `beforeinstallprompt` + `appinstalled` — `:139-155` (P‑PWA.15).
- Send: `setSending(true)`, `setIsTyping(true)` (optimistic), `setMessages` user
  bubble, lalu `await api.post` — `:157-179`.
- Natural delay (P‑PWA.14): `targetDisplayMs = 700+random(600)` dihitung saat kirim
  — `:165`; balasan muncul `max(target, elapsed)` via `setTimeout` — `:184/208-220`;
  cleanup `useEffect(()=>clearTypingTimer, [])` — `:134`.
- Error: `catch` langsung — `:231-241` (429 → "Sesi sedang sibanyak..."; lain
  `e.message`). **Retry otomatis: TIDAK DITEMUKAN.**

---

## 9. ACTUAL MESSAGE TRANSPORT  (Web)

- **HTTP request/response (axios), bukan streaming.** `pwa/src/services/api.ts:7`;
  `POST /api/pwa/:slug/message` — `pwa.ts:140`; `res.json` — `pwa.ts:240`.
- **Bukan Server‑Sent Events / WebSocket / long‑poll.** (lihat §11 — semua
  `setTimeout`/`setInterval` di apps/api hanyalah timer abort/middleware; tidak
  ada loop fetch di PWA/Dashboard.)
- Balasan AI = **satu response tunggal** berisi `content` (string). ChatPage
  men‑append **satu** `ChatBubble` — `:212`/`:191`.
- 429 path: `pwa.ts:214` `acquireLock` gagal → `res.status(429)` →
  ChatPage `:236` tampilkan "Sesi sedang sibanyak, mohon kirim lagi." (client tidak
  retry otomatis).

---

## 10. COMPOSE vs DELIVERY — Web  (detail kontrak)

Web delivery adalah **HTTP response**, bukan gateway:
```
pwa.ts:222  conversationService.processCustomerMessage(store.id, customerId, conversationId, msg, 'web')
pwa.ts:240  res.json({ success, conversationId, content: result.message.content, source, confidence, timestamp })
```
- `messageProcessor` / `messageQueueService` (di luar mutex `acquireLock` :214) **tidak**
  menjadi bagian delivery Web.
- `saveMessage` tetap dipanggil (di dalam `processCustomerMessage`) — sehingga
  sejarah tetap ter‑persist.
- `source` (ResponseSource) dikirim kembali → ChatBubble render badge `source` —
  `ChatBubble.tsx:37-39`.

---

## 11. REALTIME  (WebSocket / SSE / polling / push)

**TIDAK DITEMUKAN.** `grep -rniE "new WebSocket|EventSource|socket\.io|sse|setInterval"`
di `apps/api/src`, `apps/dashboard/src`, `apps/pwa/src` → hanya hasil false
positive (`setTimeout` abort timer di groq/gemini adapter; `analyticsService` dsb).
- Dashboard `ConversationInbox` fetch sekali di mount:
  `api.get('/conversations')` `:113` dan `GET /conversations/:id` `:133` —
  **tidak ada polling** (konfirmasi: tidak ada `setInterval/setTimeout/WebSocket`
  di file tersebut). `DashboardLayout` fetch sekali mount via
  `Promise.allSettled` (`:86-111`).
- Admin melihat pesan baru **hanya setelah refresh/navigate‑ulang** — tidak ada
  push ke dashboard.
- WA outbound "realtime" hanya pada level device (Fonnte), bukan push ke klien.

**Delivery WA via polling/queue, bukan push client:** coalesce timer (5‑15 s) di
`message-queue.service.ts:278` + smart‑retry `setTimeout` di message‑processor
(:364/481). Ini timer server‑side, bukan transport klien.

---

## 12. CUSTOMER ↔ HUMAN / ADMIN  (2‑arah)

**Trigger human_takeover** (3 jalur, semua set `status='human_takeover'` +
`humanTakeoverAt`):
1. Circuit breaker terbuka → `messageProcessor.notifyHumanTakeover`
   — `message-processor.service.ts:505` (dipanggil :222/:271).
2. Esclalasi otomatis → `conversationService.markHumanTakeover`
   — `conversation.service.ts:1133` (clarification retry >1 — `conversation-context.service.ts:397`).
3. Manual → dashboard "Ambil Alih".

**Dashboard inbox UI** — `apps/dashboard/src/pages/ConversationInbox.tsx`:
- List: `GET /conversations` (→ `findAllByStore` — semua non‑deleted, **tidak
  difilter status**) — `:113`; `openConversation(id)` → `GET /conversations/:id`
  (history: id,role,content,source,createdAt) — `:127-134`.
- "Ambil Alih": `PUT /conversations/:id/status {status:'human_takeover'}` —
  `:160` → `routes/conversations.ts:74` → update status — `:94`.
- "Lanjutkan AI": `PUT … {status:'open'}` — `:174` → reset `humanTakeoverAt` —
  `conversations.ts:90-92`.
- Reply: `POST /conversations/:id/reply {message}` — `:188` →
  `routes/conversations.ts:107` → `sanitizeMessage` + `conversationHistory.create({role:'agent'})` —
  `:122-129`, lalu kirim WA.

**Delivery balasan admin ke kustomer:**
- `routes/conversations.ts:145-173`: bila `store.fonnteToken` →
  `fonnteService.sendMessage(conversation.customerPhone, ...)`; else bila
  `store.phoneNumber` → `gowaAdapter.sendMessage(...)`.
- Guard: `if (!conversation.customerPhone) skip + warn` — `:147`/:160.
- **Akibat:** untuk conversation Web (`customerPhone=null`) → balasan admin
  **dilewati**, tidak pernah sampai ke chatbox PWA. **2‑arah hanya berfungsi WA.**

`humanAgentId` (`schema.prisma:152`) ada di skema tapi **TIDAK DITEMUKAN** di
kodifikasi (tidak ada assignment / pembacaan). 149 hasil grep "human_takeover"
— kebanyakan log/audit, bukan assignment agent.

---

## 13. INBOX / CONVERSATION LIST UI  (dashboard)

- File halaman: `apps/dashboard/src/pages/ConversationInbox.tsx` (221+ baris;
  dibaca 1‑221). Nav link: `DashboardLayout.tsx:18` (`/dashboard/conversations`,
  ikon `Inbox`).
- List item fields yang ditampilkan (dari response `findAllByStore` select
  `:1322-1331`): `id, customerId, customerName, customerPhone, status,
  lastMessageAt, aiResponseCount, faqResponseCount` — **tidak ada preview isi
  pesan terakhir** (select tidak termasuk `content`).
- Filter tab client‑side: `all | needs_me | bot_answered | resolved` —
  `ConversationInbox.tsx:41/237` (filter `status === 'human_takeover'` dsb.).
- Auto‑switch tab ke `needs_me` bila ada `human_takeover` — `:120-125`.
- **Skeleton** (`SkeletonRow`/`:70`, `SkeletonBubble`/`:70`) untuk loading.
- Pagination: `visibleCount` state `:99` (infinite scroll sederhana).

---

## 14. ADMIN REPLY FLOW  (routed through ConversationInbox)

```
ConversationInbox.handleSend()  :184
  → api.post('/conversations/:id/reply', { message })   DashboardLayout api.ts:4
  → routes/conversations.ts:107  POST /:id/reply  (authMiddleware)
       prisma.conversation.findFirst({ where:{ id, storeId, deletedAt:null }})  :112
       sanitizeMessage(message)                                                   :121
       prisma.conversationHistory.create({ role:'agent', content, source:'dashboard' })  :122
       prisma.conversation.update({ status:'human_takeover', humanTakeoverAt, lastMessageAt })  :127
       store.fonnteToken ? fonnteService.sendMessage(customerPhone, content, {token})   :145-153
       else store.phoneNumber ? gowaAdapter.sendMessage(customerPhone, content, {deviceId})  :157-167
       (customerPhone null → skip, warn)                                         :147/160
```
- Balasan **tidak dikirim ke Web chatbox** (lihat §12). Untuk WA customer menerima
  balasan via WA gateway + Fonnte footer `Powered by Garuda CRM`
  (`fonnteService.sendMessage` men‑append footer — `fonnte.service.ts:92-93`).

---

## 15. MESSAGE SCHEMA (ringkasan DB, lihat §5)

Tabel pesan yang dipakai: **`conversation_history`** (bukan tabel `messages`).
Conversation table = metadata thread. Lihat §5 untuk kolom penuh. Inti:
`id, conversationId, role, content, source, costUSD, metadata, createdAt`.

---

## 16. NOTIFICATION / REALTIME NOTIFICATION

**TIDAK DITEMUKAN** (lihat §11).
- `DashboardLayout.tsx:234-323`: Bell ikon + dropdown; badge `notificationCount =
  humanCount + pendingCount + lowStockCount` dihitung dari fetch mount
  `Promise.allSettled` — `:86-111`. **Bukan push.**
- `apps/pwa/public/sw.js` (P‑PWA.15) = pass‑through install/fetch saja —
  **tidak ada handler `'push'`/`'notificationclick'`**; tidak ada Web Push /
  `PushManager` / VAPID / FCM.
- Tidak ada `new Notification(...)`, `Notification.requestPermission`, `new Audio`,
  `getBattery`/`setBadge` di sumber mana pun (grep konfirmasi).
- WA: status device Fonnte **di‑ignore** (`webhooks.ts:154` `body.status`
  connect/disconnect → `ignored`), jadi dashboard WA status bergantung pada poll
  `GET /whatsapp/fonnte/status` (Fonnte device API, 60 s cache —
  `fonnte.service.ts:22-24`). Ini akar penyebab stale WA status, sesuai
  `DOCS/laporan-review-fonnte-api-implementation.md`.
- Fonnte **typing** flag tersedia (`fonnte.service.ts:98` `typing: config.typing ??
  false`) tapi **tidak pernah diset true**.

---

## 17. TRANSPORT RINGKASAN

| Layer | Web customer | WA customer | Admin/dashboard |
|---|---|---|---|
| Inbound | `POST /api/pwa/:slug/message` (HTTP) | Fonnte/GOWA webhook (`POST /api/webhooks/...`) | — |
| Transport | axios JSON (dev proxy `/api→:3000`; prod same‑origin) | webhook JSON | axios JSON |
| Delivery balasan | `res.json` (tunggal, blocking) — `pwa.ts:240` | gateway `sendMessage` (fonnte/gowa) w/ retry 10s‑30s‑2m | — |
| Realtime | **TIDAK ADA** (fetch‑on‑load saja) | device‑level (Fonnte) | **TIDAK ADA** fetch‑on‑mount sekali |

API mount: `app.use('/api', …)`; `pwaRouter` @ `/api/pwa` — `index.ts:134`.
CORS: whitelist `LOCALHOST_ORIGINS` + `PWA_ALLOWED_ORIGINS` env (comma) —
`index.ts:75-88`.

---

## 18. PRODUK / KERANJANG / ORDER — apakah structured payload?

**TIDAK DITEMUKAN.** Semua produk/keranjang/checkout disampaikan sebagai **teks**,
bukan payload terstruktur ke klien.
- Produk: `fallbackService.tryProduct` — `business/fallback.service.ts:339`
  (`Halo Kak! Untuk *X* harganya *Rp …* …`); `tryCatalog` `:250` (daftar teks).
- Keranjang: `conversationService.renderCartSummary` —
  `conversation.service.ts:961-986` (teks `• X x1 — Rp …`); `composer-v2.composeReply` —
  `services/chat/composer-v2.ts:82` (`🛒 Ditambahkan ke keranjang: …`).
- Draft order: `orderService.addConfirmedItemToOrder/syncCartStateToDraftOrder/
  finalizeDraftOrder` — `business/order.service.ts:111/165` (state DB `orders.items
  Json`, `orderStatus` draft→waiting_address). `detectDoneOrdering` keyword heuristic
  `:28` → tidak ada UI checkout.
- Interpreter **v2 memiliki** `draft_cart_ops` (terstruktur) — `types-v2.ts:67` —
  tapi **hanya dipakai server‑side** oleh `conversation.service` (executeCartOps →
  DB), **tidak pernah dikirim ke klien**. `InterpreterResult.reply_draft` (v1) juga
  string. Client menerima **hanya `content: string`**.

Artinya: product‑card / quick‑reply button / cart drawer / checkout UI **memerlukan
field baru** (`type`, `options[]`, `cart{}`, `checkoutUrl`) yang tidak ada.

---

## 19. COMPOSE ENGINE — file & tanggung jawab

| File | Peran |
|---|---|
| `services/chat/normalizer.ts` | `normalize(message, productDictionary)` pure/sync, I12 product‑guard |
| `services/chat/interpreter.ts` | `runOneCall` (1× Groq), `validateCartOpsAgainstDb`, `validateCartOps`, `truncateTo2Sentences` |
| `services/chat/composer-v2.ts` | `composeReply`, `composeEscalateReply`, `escalateStatusUpdate` (dipakai engine v2 :341; buildResult v1 :1008) |
| `services/chat/workspace.ts` | load/save `workspace_v2`, deferredTurns, auto‑drop |
| `services/chat/reasoning.ts` | `understand(...)` (shadow v3.2) |
| `services/chat/planner.ts` | `planActs` |
| `services/chat/validator-v2.ts` | `validate` |
| `services/chat/pendingClarification.ts` | `resolvePending` (BAGIAN 2) |
| `services/chat/fast-path.ts` | `ResolvedPayload`, tier‑match |
| `services/chat/tier-match.ts` | keyword tier skor |
| `business/fallback.service.ts` | tier 0‑LLM chain: cache→FAQ→order_status→total→shipping→payment→sop→catalog→product→knowledge→HUMAN |
| `business/conversation.service.ts` | orkestrator utuh (processCustomerMessage) |
| `business/order.service.ts` | draft order lifecycle + checkout |
| `business/conversation-context.service.ts` | context/session/cart entity (atomicCas optimistic lock) |
| `services/message-processor.service.ts` | WA orkestrator (dedup/coalesce/mutex/cb/presence/sendretry) |
| `services/message-queue.service.ts` | mutex Set / dedupe LRU / coalesce timer |

---

## 20. PWA CHATBOX — UI KOMPONEN  (inventory file)

- `apps/pwa/src/main.tsx` — render + **SW register `/c/sw.js`** (P‑PWA.15) `:21-25`.
- `apps/pwa/src/App.tsx` — routing `/c/:slug` / `*`.
- `apps/pwa/src/components/ChatPage.tsx` — seluruh logika chat (368 br).
- `apps/pwa/src/components/ChatBubble.tsx` — bubble presentasional (44 br).
- `apps/pwa/src/components/NotFound.tsx` — "Toko tidak ditemukan" (8 br).
- `apps/pwa/src/services/api.ts` — axios `/api`, no auth interceptor.
- `apps/pwa/src/index.css` — Tailwind + `.dot-pulse` (typing).
- `apps/pwa/public/manifest.json` — PWA install (name/short_name/icons 192+512).
- `apps/pwa/public/sw.js` — minimal install + pass‑through fetch.
- `apps/pwa/public/icons/icon-192.png`, `icon-512.png` — placeholder PNG.
- `apps/pwa/index.html` — `<link rel="manifest" href="/c/manifest.json">` + theme‑color.

> Tidak ada komponen `attachment` / `product card` / `quick reply` / `cart drawer` /
> `checkout` / `ChatScope` / `assistant‑ui` / `react‑chat‑widget` di mana pun
> dalam `apps/pwa` (konfirmasi `grep`).

---

## 21. DASHBOARD — admin/UI komponen (ringkasan)

Routing + layout (bukan fokus chat, tapi relevan untuk human flow):
- `apps/dashboard/src/App.tsx:37-84` — route tree; `AuthProvider` +
  `AdminAuthProvider`; owner `/dashboard/*` (ProtectedRoute, Bearer token
  `garuda_user`), admin `/admin/*` (AdminProtectedRoute, super_admin).
- `DashboardLayout.tsx` — header Bell (notification dropdown), dark toggle,
  user avatar, nav `Inbox/orders/products/analytics/faq/knowledge/whatsapp/ai-settings/profile`.
- `pages/ConversationInbox.tsx` — inbox + detail + reply (lihat §12‑14).
- `pages/WhatsAppConnect.tsx` — koneksi WA (Fonnte).
- `pages/OnboardingProfile.tsx` — onboarding toko.
- Auth: `contexts/AuthContext.tsx` (owner: email/password, Bearer token);
  `contexts/AdminAuthContext.tsx` (admin/super_admin).
- API client: `services/api.ts` — axios `/api` + Bearer `Authorization`
  interceptor + 401→redirect login.

Admin produk: `ProductsPage`, `pages/admin/AdminProductsPage`, `MagicPastePage`,
`ProductDetailPage` — terhubung ke `/api/products/my`, `/api/store-products`.
Order: `pages/OrderManager` → `/api/orders`.
Analytics: `pages/AnalyticsPage` / `pages/admin/AnalyticsDashboard` →
`/api/analytics`.

---

## 22. MUTEX / LOCK  (read‑only — reproduksi §1 P‑PWA.7)

`messageQueueService.acquireLock(chatId)` — `message-queue.service.ts:167`:
```
acquireLock(chatId: string): (() => void) | null {
  const key = `lock:${chatId}`;
  if (this.processingLocks.get(key)) return null;
  this.processingLocks.set(key, true);
  return () => { this.processingLocks.delete(key); };
}
```
- `processingLocks: Map<string, boolean>` — **in‑memory Set‑like**, **bukan Redis**
  — `:152`.
- Key = `lock:${chatId}` di mana `chatId = input.conversationId` — lihat
  `message-processor.service.ts:98` (`const chatId = input.conversationId`) dan
  pemanggilan `:161`/`:181`.
- **Exported singleton**, reusable: `export const messageQueueService = new
  MessageQueueService()` — `:415`; dipanggil **langsung** oleh `pwa.ts:214`
  (Web path, melewati `messageProcessor`). Jadi **sudah reusable** sebagai utility
  — tidak perlu ekstrak.
- Catatan serupa: `customerPhone: msg.customerId` (WA path) —
  `message-processor.service.ts:190` — ini *fallback* yang aman untuk WA karena
  di sana `customerId` memang = nomor WA (`webhooks.ts:104`).

---

## 23. FALLBACK `customerPhone: customerId`  (read‑only — reproduksi §2 P‑PWA.7)

`business/conversation.service.ts:75` (di dalam `upsert` Conversation):
```
customerPhone: channel === 'web' ? null : customerId, // WA: pakai customerId(=phone asli); Web: null (bukan webUid)
```
- `processCustomerMessage(storeId, customerId, conversationId, customerMessage,
  channel = 'whatsapp')` — signature **tidak menerima `customerPhone`**, nilainya
  diturunkan dari `channel`. **Tidak ada parameter eksplisit `customerPhone: null`.**
- Untuk Web (`channel='web'`): `customerPhone = null` — **benar‑benar** bukan
  `webUid`, sehingga *fallback* tidak memuhi `webUid` ke kolom phone.
- Konsisten dengan `pwa.ts:196-206` yang create Conversation dengan
  `customerPhone: null` + komentar "konsisten dengan fix conversation.service.ts:75".

**Logic lain yang membaca `customerPhone`:**
- `routes/conversations.ts:147` / `:160` (admin reply): `if (!conversation.customerPhone)
  → skip send + warn`. Untuk Web, nilai `null` → admin reply **tidak terkirim ke
  WA/gowa** (bukan "salah" — memang memilih tidak kirim). Ini jalur delivery
  admin, bukan matching/lookup customer.
- `message-processor.processWithLock:242` hanya validasi `customerPhone` untuk
  channel `'whatsapp'`; Web memvalidasi `webUid` — `:247`. Jadi `customerPhone`
  tidak dipakai matching untuk Web.
- Ringkasan: tidak ada logic **lookup/matching** yang menggunakan `customerPhone`
  untuk Web (Web resolve lewat `webUid`‑>Customer‑>Conversation). Kolom ini hanya
  dipakai (a) sebagai identitas WA, (b) guard kirim admin‑reply WA.

---

## 24. TEMUAAN KRITIS  (fakta, bukan rekomendasi)

1. **Tidak ada realtime apa pun** (WebSocket/SSE/Socket.IO/polling) di ketiga apps.
   Dashboard & PWA fetch‑on‑mount sekali; admin melihat pesan baru hanya lewat refresh.
2. **Human handoff 2‑arah hanya berlaku WA.** Admin reply (`POST /conversations/:id/reply`)
   mengirim via `fonnteService`/`gowaAdapter` yang butuh `customerPhone`; untuk
   conversation Web `customerPhone=null` → **dilewati**. Chatbox web *satu arah*
   kecuali diberi delivery channel baru (mis. broadcast ke web client).
3. **Semua UI produk/keranjang/checkout adalah TEKS.** Tidak ada payload terstruktur
   (`type`/`options`/`cart`/`checkoutUrl`) ke PWA/Dashboard. Product card / quick
   reply / cart drawer / checkout memerlukan field baru di response.
4. **Mutex sudah reusable** (`messageQueueService.acquireLock`, in‑mem Set, ekspor
   singleton) — dipakai WA (mp:161) dan Web (pwa.ts:214). Key = `lock:${conversationId}`.
5. **customerPhone fallback sudah "fixed" per channel**: Web→null, WA→phone diri.
   Tidak ada cara explicit‑pass; signature tidak punya param customerPhone.
6. **Persistence hanya ke `conversation_history`** (bukan tabel `messages`); `saveMessage`
   try/catch men‑swallow error → bila `crypto.randomUUID()` gagal resolve, history
   **diam‑diam tidak tersimpan** (observasi §5; belum dipastikan runtime).
7. **v1 = default engine** (`getStoreEngine`→`'v1'` bila tidak ada Redis config);
   v2 (workspace+composer+reasoning) adalah canary/opt‑in.
8. **WA outbound punya retry 10s‑30s‑2m + presence sim + circuit breaker**; Web
   tidak (langsung response). Jadi SLA/behaviour outbound tidak simetris per channel.
9. **CORS PWA belum pasti** (hanya `localhost` + `PWA_ALLOWED_ORIGINS` env) —
   `index.ts:75-88`; origin produksi harus ditambahkan env.
10. **Fonnte device‑status webhook di‑ignore** (`webhooks.ts:154`) → status WA
    dashboard bergantung polling 60 s cache; akar stale‑status (lihat review doc).
11. **PWA manifest/sw sudah terpasang** (P‑PWA.15) tapi `sw.js` pass‑through saja
    (offline cache = task berikutnya); **tidak ada push handler** → notifikasi push
    Web **TIDAK DITEMUKAN**.

---

## 25. KEPUTUSAN ARSITEKTUR — fakta yang menentukan desain chatbox

Berdasar fakta di atas, faktor penentu redesign library‑UI vs custom vs ChatScope:

- **Jika tetap pakai UI sekarang:** cukup ganti `ChatPage.tsx`+`ChatBubble.tsx`
  (kontrak backend **hanya 2 endpoint + response envelope** lihat §1/§10).
  `ChatBubble` pure presentasional — swap tanpa sentuh backend.
  *Syarat yang harus dipertahankan bila ganti:* optimistic bubble, typing indicator
  natural delay (target 700‑1300 ms, `useEffect` cleanup), 429 handling, cabang
  `pending_human`, webhook SW register.
- **Library UI (assistant‑ui/ChatScope/dll):** bisa dipasang, **tapi** kartu tidak
  akan kaya karena backend **tidak kirim structured payload** (§18). Untuk
  product‑card / quick‑reply / cart drawer / checkout, **perlu tambahan field di
  `pwa.ts` response** (`type`, `options[]`, `cart{}`, `checkoutUrl`).
- **Realtime 2‑arah ke Web:** membutuhkan transport baru (WebSocket/SSE) yang
  **TIDAK ADA** — bukan sekadar ganti UI. Backend delivery Web saat ini hanya
  HTTP response; admin→Web belum ada jalurnya (§12/§14).
- **Human routing:** sudah ada mekanisme `human_takeover` (circuit breaker +
  eskalasi + manual) + dashboard inbox/reply — tapi reply kirim **WA‑only**.
  Agar Web juga 2‑arah, butuh **delivery channel Web** (push/WS) baru.

---

## 26. INVENTARIS — apa yang ADA vs TIDAK DITEMUKAN

| Butuh | ADA | TIDAK DITEMUKAN |
|---|---|---|
| Teks chat | ✅ ChatPage/ChatBubble | — |
| Typing indicator | ✅ ChatBubble isTyping (dot‑pulse) | — |
| Loading | ✅ "Memuat…" (init) ; "Mengirim…" (send) | — |
| Error UI | ✅ teks merah + 429 pesan | Retry otomatis |
| Attachment / image upload | — | ❌ |
| Link klik‑able | — | ❌ (plain text) |
| Quick reply button | — | ❌ (reply = teks) |
| Product card | — | ❌ (teks harga) |
| Cart UI (drawer/list) | — | ❌ (teks ringkasan) |
| Checkout UI | — | ❌ (keyword → draft order) |
| WebSocket / SSE / push | — | ❌ (semua apps) |
| Polling dashboard | — | ❌ (fetch sekali) |
| Admin→Web delivery | — | ❌ (WA‑only) |
| Web Push notification | — | ❌ (sw.js pass‑through) |
| Audio/sound notifikasi | — | ❌ |
| structured cart/order payload ke klien | — | ❌ (teks semua) |
| PWA manifest + SW | ✅ (P‑PWA.15) | — |
| Install prompt (A2HS) | ✅ after 1st AI reply, 7‑day localStorage | — (Safari = instruksi manual) |
| human_agent assignment | schema `humanAgentId` | ❌ (kolom kosong, tidak ditulis dibaca) |

---

*Laporan ini bersifat **read‑only / faktual**. Tidak ada file sumber yang
dimodifikasi, tidak ada paket terpasang, tidak ada rekomendasi library.*
