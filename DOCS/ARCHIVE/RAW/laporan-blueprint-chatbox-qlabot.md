# BLUEPRINT ARSITEKTUR CHATBOX QLOBOT
## Structured Message + Web Realtime + Human Handoff + Notification
### (Design‑only — tidak mengubah source code, tidak install/migrate/commit)

**Sumber fakta utama:**
- `DOCS/laporan-audit-chatbox-qlabot.md` (audit read‑only chatbox/conversation/message/realtime)
- `DOCS/laporan-review-fonnte-api-implementation.md` (audit Fonnte / WA gateway)
- `apps/api/prisma/schema.prisma`
- `apps/api/src/business/conversation.service.ts`, `message-processor.service.ts`,
  `message-queue.service.ts`, `fallback.service.ts`, `order.service.ts`,
  `conversation-context.service.ts`, `routes/pwa.ts`, `routes/conversations.ts`,
  `routes/webhooks.ts`, `services/fonnte.service.ts`, `adapters/whatsapp/gowa.adapter.ts`
- `apps/pwa/src/components/ChatPage.tsx`, `ChatBubble.tsx`, `services/api.ts`, `App.tsx`
- `apps/dashboard/src/pages/ConversationInbox.tsx`, `contexts/AuthContext.tsx`,
  `services/api.ts`

> Ringkasan asumsi kunci: sebuah Conversation **selalu single‑channel**
> (`channel='web'` ATAU `channel='whatsapp'`). Tidak ada *bridging* web↔WA dalam
> skope dokumen ini. `conversationService.processCustomerMessage()` (dan seluruh
> engine AI) adalah komponen sensitif — tidak boleh di‑refactor menjadi "monster".

---

## 0. NOTASI

- `FILE:LINE:` = anker fakta di kode.
- Decis mendasar ditandai **DECISION**, trade‑off diberi **TRADE‑OFF**, rekomendasi
  akhir ditandai **RECOMMEND**.
- Semua "extension point" bersifat **additive wrapper** — `conversation.service.ts`
  dan engine AI **tidak disentuh**.

---

## 1. TARGET ARCHITECTURE

```
 CUSTOMER (Web)            CUSTOMER (WA)                ADMIN (Dashboard)
      │                         │                            │
      ▼                         ▼                            ▼
  Chatbox PWA              WhatsApp / Fonnte            ConversationInbox
      │                         │                            │
      │  HTTP POST /message     │  webhook POST             │  HTTP POST /reply
      ▼                         ▼                            ▼
 ┌────────────┐          ┌────────────────┐        ┌────────────────────┐
 │            │ WA event │                │        │                    │
 │  Web Real. │◄──────── │  Event /       │◄────── │  Admin Real.       │
 │  (WS/SSE)  │          │  Delivery Sv   │        │  (WS/SSE)          │
 │            │          │  (publish +    │        │                    │
 └────────────┘          │   route)       │        └────────────────────┘
      │                  │                │                  │
      │                  └──────┬─────────┘                  │
      ▼                         ▼                            │
 ┌────────────────────────┐   ┌───────────────────────────────┐ │
 │                        │   │                               │ │
 │  Conversation /        │   │  Conversation / Message Layer │ │
 │  Message Layer         │   │  (conversation_history)       │ │
 │  (conversation_service)│   │  (engine persists here)       │ │
 │                        │   │                               │ │
 └───────────┬────────────┘   └───────────┬───────────────────┘ │
             │                              │                   │
             ▼                              ▼                   │
    ┌─────────────────────────────────────────────────┐        │
    │              CONVERSATION ENGINE               │◄───────┘
    │  (conversationService.processCustomerMessage)   │  command
    │  COMPOSE + PERSIST (shared per channel)         │  (PUT /status,
    │  v1: normalizer→fallback tiers→runOneCall       │   POST /reply)
    │  v2: workspace→reasoning→planActs→validate→     │
    │      composeReply  (engine='v2' via redis,      │
    │      default 'v1')                              │
    └──────────┬───────────────────────────────────────┘
               │
        ┌──────┴───────┐
        ▼              ▼
  ┌─────────┐    ┌─────────────┐
  │  AI     │    │  Order /    │  (cart execution = engine, TIDAK disentuh)
  │(Groq LLM)│   │  Cart       │
  └─────────┘    └─────────────┘

Delivery layer (BARU) — di luar engine:
  message.created ──► Web WS room   /   WA gateway (sendWithPresence)
  conversation.handoff / conversation.updated ──► Dashboard WS + Web customer
  typing.started/stopped ──► lawan belah pihak
  notification.created ──► PWA push (jika terpasang) / Dashboard bell

FAN-OUT?  Tidak. Compose+persistence terjadi **sekali** di engine; delivery
mengikuti `channel` conversation (Web → event/HTTP, WA → gateway). Satu
balasan AI tidak dikirim ke dua channel sekaligus.
```

Komponen baru yang diperlukan:
- `services/realtime.service.ts` — WS server + room/auth + redis‑adapter
- `services/event-bus.service.ts` — thin publisher (atau reuse `messageQueueService`
  hanya untuk mutex; **tidak** untuk event)
- `services/conversation-delivery.service.ts` — wrapper delivery (publish after persist)
- extension `apps/pwa/src/services/api.ts` (WS connect) + `ChatPage.tsx` (subscribe)
- extension `routes/pwa.ts` (envelope `messageId/type/payload`, typing endpoint, WS upgrade)
- extension `routes/conversations.ts` (publish event pada reply + status)
- `apps/dashboard/src/pages/ConversationInbox.tsx` (subscribe)
- `apps/pwa/public/sw.js` (push handler) — tahap notifikasi

---

## 2. BOUNDARY — YANG TIDAK BOLEH disentuh vs BOLEH DIPERLUAS

### TIDAK BOLEH disentuh (engine core + WA compatibility)
| PATH | FUNCTION | SEBAB |
|---|---|---|
| `business/conversation.service.ts` | `processCustomerMessage()` | satu‑satuya compose+persist; jangan jadikan monster |
| `business/conversation.service.ts` | `saveMessage()`, `buildResult()`, `getOrCreateContext()`, `executeCartOps()` | persist + cart |
| `services/chat/interpreter.ts` | `runOneCall()` | SATU LLM call, jangan ganti |
| `services/chat/normalizer.ts` | `normalize()` | 0‑LLM rule |
| `services/chat/composer-v2.ts` | `composeReply()` | v2 compose |
| `business/fallback.service.ts` | `getResponse()` + tiers (cache/faq/order/total/shipping/payment/sop/catalog/product/knowledge) | fallback chain |
| `services/chat/{workspace,reasoning,planner,validator-v2,pendingClarification,fast-path,tier-match}.ts` | — | semua v2/state |
| `business/order.service.ts` | `addConfirmedItemToOrder/syncCartStateToDraftOrder/finalizeDraftOrder/detectDoneOrdering` | order lifecycle |
| `business/conversation-context.service.ts` | `modifyCart/appendMessage/refreshSession/setPendingClarification/atomicCas` | context/cart state |
| `services/message-processor.service.ts` | `processMessage/processWithLock/sendWithPresence/smartRetrySend` | WA pipeline (hanya BOLEH append event publish post‑persist, tidak rubah logika) |
| `services/message-queue.service.ts` | `acquireLock/isDuplicate/bufferMessage` | mutex wajib dipakai ulang (§23) |
| `services/fonnte.service.ts`, `adapters/whatsapp/gowa.adapter.ts` | `sendMessage/sendImage…` | gateway WA |
| `routes/webhooks.ts` | WA inbound + device status `:154` | jangan rusak WA |
| `routes/messages.ts` POST `/handle` | `processCustomerMessage` | jalur non‑pwa |
| `prisma/schema.prisma` (core models) | Conversation/ConversationHistory/Customer/Order | tidak diganti skema krusial |
| `apps/dashboard/src/contexts/AuthContext.tsx` + `services/api.ts` | Bearer auth | jangan rusak auth |

### DIIZINKAN DIPERLUAS (extension points)
| PATH | FUNCTION/COMPONENT | EKSTENSI YANG BOLEH |
|---|---|---|
| `routes/pwa.ts` | GET `/init`, `/history`, POST `/message` | tambahkan `messageId/type/payload` di response; tambah `GET /events` (WS); tambah `POST /typing` |
| `domain/types.ts` | `ConversationMessage` | tambah `StructuredMessage` interface (MAY) |
| `routes/conversations.ts` | PUT `/:id/status`, POST `/:id/reply` | publish event setelah persist (delivery layer) |
| `apps/pwa/src/*` | ChatPage/ChatBubble | full rewrite UI modular (§26) |
| `apps/pwa/public/sw.js` | pass‑through | tambah `push`/`notificationclick` handler |
| `apps/dashboard/src/pages/ConversationInbox.tsx` | inbox/reply | subscribe event real‑time, badge realtime |
| `business/conversation.service.ts` | `saveMessage` | **HANYA** tambahkan post‑persist hook async fire‑and‑forget (lihat §4) — tidak wajib; lebih aman via wrapper delivery |

### Wajib diubah (MUST CHANGE)
- `routes/pwa.ts:240-247` — response envelope: tambahkan `messageId: result.message.id`,
  serta `type` + `payload` (dari structured reply engine).
- `routes/conversations.ts:122-173` — reply route: setelah persist, **publish**
  `conversation.message.created` (delivered ke Web via WS, WA via gateway).
- `apps/pwa/src/components/ChatPage.tsx` — konsumsi event real‑time + message type.
- Baru: `services/conversation-delivery.service.ts` + `services/realtime.service.ts`.

---

## 3. MESSAGE CONTRACT BARU

Fakta basis: kolom DB `conversation_history` sudah memiliki
`messageType String?` (`schema.prisma:176`) **belum dipakai**, dan
`metadata Json?` (`schema.prisma:179`) masih ada. Jadi **tidak perlu schema baru**
untuk mendukung structured message.

### Classifikasi field
```
A. conversation_history.content      (teks utama, selalu terisi)
B. conversation_history.messageType  (existing nullable col, dipakai: text|product|cart|quick_reply|button|order|checkout|image|system|handoff|payment|notification)
C. conversation_history.metadata.json (payload terstruktur)  → {payload:{...}, stagesReached, llmCallCount, ...}
D. response envelope (routes/pwa.ts / events)  → id, conversationId, sender, type, content, payload?, source, createdAt, confidence
E. field DB baru → TIDAKWAJNI diperlukan (pakai B+C)
```

### Trade‑off
- Pakai `metadata` untuk `payload`: **plus** tidak ada migration; **minus** satu
  kolom Json yang "pacang" (tapi sudah ada, cukup).
- Alternatif tambah kolom `payload Json` khusus: lebih bersih, tapi migration.
  **RECOMMEND**: pakai `metadata.messagePayload` dulu (no migration); migrasi ke
  kolom khusus bila volume payload besar.

### Payload per type (contoh JSON response envelope)
```jsonc
// text
{ "id":"uuid","conversationId":"c1","sender":"assistant","type":"text",
  "content":"Mau tambah yang lain?","source":"ai","createdAt":"..."}

// product
{ "type":"product","content":"Untuk *Sosis Goreng* harganya *Rp10.000*...",
  "payload":{"productId":"p1","name":"Sosis Goreng","price":10000,"stock":1,"currency":"IDR","imageUrl":null,"actions":[{"type":"quick_reply","label":"Tambah x1"}]},
  "source":"product"}

// product_list
{ "type":"product_list","content":"Produk yang tersedia:\n- Sosis Goreng Rp10.000\n- Kentang Rp5.000",
  "payload":{"items":[{"id":"p1","name":"Sosis Goreng","price":10000},{"id":"p2","name":"Kentang","price":5000}]}}

// cart
{ "type":"cart","content":"🛒 Keranjang: sosis x1, kentang x1. Total Rp15.000.",
  "payload":{"items":[{"product":"Sosis Goreng","qty":1,"price":10000,"subtotal":10000},
             {"product":"Kentang","qty":1,"price":5000,"subtotal":5000}],
             "total":15000,"currency":"IDR",
             "actions":[{"type":"quick_reply","label":"Checkout"},{"type":"quick_reply","label":"Tambah Produk"}]}}

// quick_reply
{ "type":"quick_reply","content":"Mau pesan apa?","payload":{"options":[
      {"id":"opt_1","label":"Ayam","action":{"type":"send_text","value":"ayam"}},
      {"id":"opt_2","label":"Sosis","action":{"type":"send_text","value":"sosis"}}]}}

// button
{ "type":"button","content":"Aksi:", "payload":{"options":[
      {"id":"chk_1","label":"Checkout","action":{"type":"checkout"}},
      {"id":"admin_1","label":"Bicara dengan Admin","action":{"type":"handoff"}}]}}

// order
{ "type":"order","content":"Pesanan Anda diterima. Total Rp15.000.",
  "payload":{"orderId":"o1","items":[...],"totalPrice":15000,"orderStatus":"waiting_address"}}

// checkout
{ "type":"checkout","content":"Silakan isi alamat & pilih pembayaran.",
  "payload":{"orderId":"o1","totalPrice":15000,"shippingMode":"flat",
      "shippingFee":15000,"paymentMethods":["qris","cod","transfer"],
      "actions":[{"type":"action","label":"Bayar QRIS","action":{"type":"pay_qris"}}]}}

// image (QRIS, dsb.)
{ "type":"image","content":"Berikut QRIS kami","payload":{"imageUrl":"https://...qr.png","alt":"QRIS"}}

// system
{ "type":"system","content":"Pesan diteruskan ke admin, mohon tunggu."}

// handoff
{ "type":"handoff","content":"Baik kak, akan saya sambungkan ke admin toko.",
  "payload":{"to":"human_agent","estimatedWaitSec":null}}
```

> Catatan: `result.message` dari engine (v1 `buildResult` / v2 `composeReply`)
> saat ini selalu string. Untuk type ≠ `text`, `payload` dihasilkan **di tepi
> delivery** (setelah engine kembalikan `result`) — bukan di dalam engine.
> Engine tetap kirim string + metadata; delivery layer memetakan ke type/payload.
> (Prinsip: jangan taruh presentation logic di engine.)

---

## 4. COMPOSE → PERSIST → DELIVERY

### Status kini
- COMPOSE + PERSIST = satu unit di `conversationService.processCustomerMessage()`
  (`conversation.service.ts:59`). Delivery = terpisah (Web HTTP, WA gateway).
- Tidak ada lapisan event.

### Design (extension point terkecil, aman)
**DECISION: jANGAN tambahkan logika ke `conversation.service.ts`.** Ciptakan
wrapper **delivery layer** yang berada *di luar* engine:

```
                        ┌──────────────────────────────┐
 customer message  ───► │ conversationDeliveryService  │   (BARU, wrapper)
 (Web POST /message     │   1. acquireLock (messageQueue)  │   tidak sentuh engine
  | WA webhook)         │   2. result = await              │
                        │      conversationService         │   (ENGINE TIDAK DIUBAH)
                        │      .processCustomerMessage()   │
                        │   3. publish message.created      │
                        │   4. (WA only) sendWithPresence   │   (WA tetap via messageProcessor)
                        │   5. return result                │
                        └──────────────┬───────────────────┘
                                       │ result
                                       ▼
                           ┌──────────────────────┐
                           │  CONVERSATION ENGINE │  (compose+persist, UNTOUCHED)
                           └──────────────────────┘

  Web path : pwa.ts POST /message  ──► deliveryService.processWebMessage
  WA path  : webhooks ──► messageProcessor.processMessage ──► (engine) ──►
            sendWithPresence  [tetap] ; deliveryService.publishEvent(...)  [append, post-persist]

  Admin→customer : routes/conversations.ts POST /reply
            ──► persist(role='agent') ──► deliveryService.publish message.created
            ──► Web: WS event ; WA: gateway.sendMessage
```

- Event **dipublish setelah** `saveMessage` commit + `release()` lock — jadi tidak
  bisa re‑enter processing (§23).
- `conversation.service.ts` tetap satu‑sumber‑kebenaran compose+persist;
  delivery layer hanya *mengamat* hasil `result` dan mengarahkan ke channel.
- WA tetap pakai `messageProcessor.sendWithPresence` (compatibilitas §24).

---

## 5. WEB REALTIME — TRANSPORT

Perbandingan:

| Kriteria | WebSocket | SSE | Polling |
|---|---|---|---|
| Bidirectional | ✅ | ❌ (server→client only) | ✅ (tapi pull) |
| Presence/typing (2 arah) | ✅ | ❌ (perlu channel terpisah) | ❌ |
| Auto‑reconnect | library | ✅ native (EventSource) | ✅ manual |
| Mobile/PWA | ✅ | ✅ | ❌ (drain baterai) |
| Resource (conn) | 1/tab | 1/tab | N req/min |
| VPS Node/Express | butuh lib | native http | native |
| Multi‑tenant rooms | ✅ (auth) | per‑endpoint | per‑endpoint |
| Future scaling (multi‑instance) | redis adapter | redis/leader | — |
| Bundle (PWA client) | sedang | kecil | kecil |

Kebutuhan utama kami: **server→client push** (balasan AI, admin reply, handoff,
typing lawan) **dan sedikit client→server** (typing start/stop, read receipt).
Bidirectional bersih + kebutuhan presence → **WebSocket lebih cocok jangka
panjang**. SSE cukup untuk push‑only tapi kesulitan typing‑bidirection + ack.

**RECOMMEND: WebSocket (Socket.IO v4)** — mengapa:
- Rooms (`store:{storeId}`, `store:{storeId}:conv:{conversationId}`) + auth
  middleware + redis adapter untuk multi‑instance (risiko §33).
- Reconnection + back‑off + offline buffer built‑in.
- Fallback polling bila WS blocked (mobile carrier).
- Dev cepat vs `ws` custom rooms.

**Alternatif ringan:** raw `ws` + room Map + redis adapter — rekomendasi jika
ingin bundle minimal dan tidak butuh fallback. **Tidak rekomend:** polling
(untuk chat interaktif justru‑justru; hanya untuk notifikasi ringan).

Implementasi Express‑native: `http.createServer(app)` + `new Server(io)`; atau
dedicated process `ws-server` di kemudian hari (separation). Pilih: **integrasi
server WS pada process API yang sama** (simplest untuk VPS), beri `path: /ws`.

---

## 6. EVENT MODEL

Hanya event yang dipakai UI/transport; tidak ada event "antek‑antek" mesin.

| EVENT | SOURCE | PAYLOAD | CONSUMER | TUJUAN |
|---|---|---|---|---|
| `message.created` | deliveryService (post‑persist) | `{id,conversationId,sender,type,content,payload,source,createdAt}` | Web WS room (customer + admin), Dashboard | render pesan + history catchup |
| `typing.started` | Web POST `/typing` (customer) / Dashboard | `{conversationId,party:'customer',channel}` | lawan belah pihak | tampilkan "mengetik" |
| `typing.stopped` | sama | `{conversationId,party}` | lawan belah pihak | sembunyikan |
| `conversation.handoff` | PUT `/conversations/:id/status` human_takeover / auto‑escalation `markHumanTakeover` | `{conversationId,status:'human_takeover',humanTakeoverAt}` | Web customer, Dashboard inbox | UI handoff / bell |
| `conversation.resumed` | PUT status 'open' | `{conversationId,status:'open'}` | Web customer, Dashboard | AI kembali |
| `conversation.resolved` | PUT status 'resolved' | `{conversationId,status:'resolved',resolvedAt}` | Web customer, Dashboard | tutup chat |
| `conversation.updated` | admin reply persist / new message | `{conversationId,lastMessageAt,status,aiResponseCount?,...}` | Dashboard inbox list | refresh list + badge |
| `notification.created` | deliveryService (offline party) | `{conversationId,type,messageId,count}` | Dashboard bell + PWA push (jika terpasang & background) | notifikasi |

Catatan: `typing.*` adalah lawan belah channel — *customer* mengetik → dikirim ke
*admin* (Dashboard); *admin* mengetik → dikirim ke *customer* Web. Untuk WA belum
ada (WA device‑pull saja; out of scope).

---

## 7. CUSTOMER → HUMAN  (Web)

```
Customer Web
  │
  │ (ChatPage) POST /pwa/:slug/message  [uid, message]
  ▼
pwa.ts → deliveryService.processWebMessage
  │  → processCustomerMessage(...,'web')   [engine TIDAK disentuh]
  │  → simpan conversation_history (role='user')   [conversation.service.ts:1080]
  │  → hasil: result.message.content  (bisa null bila escalation)
  └─ bila result === null (human_takeover)   [conversation.service.ts:81-95]
        → publish conversation.handoff {conversationId, status:'human_takeover'}
        → Web customer UI: ganti bubble jadi "👤 Kamu sedang terhubung dengan Admin"
  │
  └─ publish message.created {sender:'customer',...}  → Dashboard inbox (badge + list refresh)
        → Dashboard: jika admin belum melihat room → notification.created (in‑app bell)
```
Identity pertemuan tetap `conversationId` (Web = storeId+customerId+channel='web',
pwa.ts:108‑109) — **tidak bikin thread baru** pada ganti AI→human. Status pindah
di `Conversation.status` (`open`↔`human_takeover`↔`resolved`), primary key
conversation tetap.

Trigger handoff (ada 3 di audit):
1. Circuit breaker terbuka — `message-processor.notifyHumanTakeover`
   (WA path).
2. Escalation otomatis — `conversationService.markHumanTakeover`
   (clarification retry >1).
3. Manual — Dashboard "Ambil Alih" PUT `/conversations/:id/status`.

---

## 8. HUMAN → CUSTOMER  (Web realtime; WA tetap gateway)

```
Admin Dashboard  (ConversationInbox.handleSend)
  │
  │ POST /conversations/:id/reply {message}
  ▼
routes/conversations.ts:107
  │  → sanitizeMessage
  │  → prisma.conversationHistory.create({ role:'agent', content, source:'dashboard' })   [:122]
  │  → prisma.conversation.update({status:'human_takeover', humanTakeoverAt, lastMessageAt})  [:127]
  │  → publish message.created {sender:'human_agent', type:'text', ...}  → Web WS room customer
  │  → bila conversation.channel==='web' → delivery via WS  (baru)
  │  → bila 'whatsapp' → fonnteService/gowaAdapter.sendMessage(customerPhone)  [:145-167]  (tetap)
  ▼
Delivery layer pastikan **satu** baris history (role='agent') — jangan duplikat.
  (WA gateway kirim teks terpisah; itu bukan "history duplicate", itu delivery.)
```
Key: **persist dulu sekali** (role='agent'), **baru publish event**; WS hanya
push (bukan simpan ulang). Untuk WA, gateway send tidak menyentuh history lagi.

---

## 9. AI → CUSTOMER  (engine tidak diganti)

```
deliveryService / messageProcessor
  │
  │  result = await conversationService.processCustomerMessage(...)   [:59]  (ENGINE UNTOUCHED)
  │     ├─ dalam engine: saveMessage(role='assistant') → conversation_history  [:763]
  │     └─ mengembalikan ResponseResult { message:{content,...}, source, confidence, ... }
  │
  ├─ Web : response envelope {success,conversationId,content,source,confidence,timestamp}
  │        + publish message.created {sender:'assistant', type, payload?} → WS customer room
  │
  └─ WA  : sendWithPresence(input, result.message.content)          [message-processor:299]
           (tetap via fonnte/gowa; plus smartRetry + presence)
```
- `type`/`payload` untuk teks AI = `type:'text'`. Untuk hasil structured di
  layar customer (product/cart), delivery layer memetakan `result.metadata`
  (stagesReached, cartOpsExecuted, dll) atau hasil interpreter/cart state →
  type yang sesuai **tanpa sentuh engine**. (Rencana di §10/11.)
- Jika `result === null` (human_takeover guard `:81`) → jangan publish
  message.created; cukup publish conversation.handoff.

---

## 10. STRUCTURED PRODUCT UI

Prinsip: **AI/engine tidak menghasilkan HTML.** Engine tetap hasilkan teks
(fallback tryProduct :339, catalog :250, interpreter reply_draft). Data produk
diperoleh **server‑side** dari katalog yang sama engine pakai
(`productService.searchProducts/listActiveProducts`, `PipelineContext.storeProducts`
di `conversation.service.ts:807-812`).

Rencana:
- Engine me‑return teks (current). **Delivery layer** tambahan:
  - bila `metadata.matchedNames/matchedPrices` ada (fallback tryProduct
    `:355` menyimpan `metadata.productIds/matchedNames/matchedPrices`) →
    delivery dapatkan detail via `productService.getProductById` → bentuk
    `type:'product'` + `payload`.
  - untuk `reply_draft` cart (composer‑v2 `:82` `🛒 Ditambahkan...`) → pasangkan
    dengan `executed CartOp[]` (result.metadata.cartOpsExecuted? belum ada —
    audit: hanya count `:790`). Perlu **metadata cartOpsExecuted detail** ( MAY
    CHANGE: conversation.service.ts tambahkan array, bukan logic baru).
- Frontend: renderer `ProductMessage`/`ProductListMessage` (§26) — presentasional.

Trade‑off: memetakan ke product card membutuhkan backend me‑fetch detail (1 query
ekstra) atau engine menyertakan `matchedNames`. Rekomendasi: engine sertakan
`matchedNames`/`matchedPrices` di metadata (sudah ada untuk tryProduct); delivery
resolver → payload. Tidak perlu engine baru.

---

## 11. CART UI

Cart execution **tetap di engine** (`conversationContextService.modifyCart`,
`orderService.syncCartStateToDraftOrder/finalizeDraftOrder`). UI hanyalah *view*.

```
Customer: "aku mau sosis dan kentang"
  → interpreter.runOneCall → cart_ops[{add sosis},{add kentang}]
  → validateCartOpsAgainstDb → executeCartOps → modifyCart + syncCartStateToDraftOrder
  → engine return result (reply_draft atau renderCartSummary)
  → delivery layer baca cart state via orderService.getOrdersByConversation
    (conversation_id) atau dari result.metadata → bentuk type:'cart' payload
  → publish message.created {type:'cart', payload:{items,total,actions:[Checkout,Tambah]}}
  → Web ChatPage render <CartMessage/>
```
- `Order.items` Json (schema.prisma:226) berisi snapshot item;
  `totalPrice` (Float) → total. Cukup untuk view. Tidak perlu state cart baru.
- Checkout button → kirim action `checkout` ke backend →
  `orderService.finalizeDraftOrder` (draft→waiting_address) atau buat
  `checkout` flow (alamat/pembayaran) — tahap lanjutan.

---

## 12. QUICK REPLY / BUTTON

- `quick_reply`: hasil dari clarification options (`InterpreterResult.clarification.options`
  interpreter.ts:33, `PendingClarification.options` types-v2.ts:88) — sama sekali
  **teks** sekarang. Delivery layer dapat options → wrapper
  `type:'quick_reply'`/`'button'`.
- Action dikembalikan ke engine lewat endpoint `POST /pwa/:slug/message` dengan
  `action`/`value` (mis. pilih "sosis" → kirim teks "sosis"). Engine proses
  sebagai pesan customer normal → aman (ter‑validate lewat pipeline). **Tidak ada
  command tak tervalidasi.**
- `button` (Checkout / Bicara dengan Admin):
  - `Checkout` → `POST /pwa/:slug/checkout` (baru) → finalizeDraftOrder + payment link.
  - `Bicara dengan Admin` → `PUT /conversations/:id/status {human_takeover}` (reuse).

---

## 13. HUMAN HANDOFF UI

State Conversation.status (`schema.prisma`: `default 'open'`;
`human_takeover`; `resolved`). **Tidak perlu status baru.**

| status | Chatbox customer UI | Dashboard |
|---|---|---|
| `open` (AI aktif) | "🤖 QloBot" sedang menjawab | Dijawab bot |
| `human_takeover` | "👤 Kamu sedang terhubung dengan Admin" (replace bubble, non‑teks) | Perlu kamu |
| `resolved` | badge "Selesai"; composer disabled | Selesai |

- Web customer menerima event `conversation.handoff`/`conversation.resumed`/
  `conversation.resolved` via WS → update UI state.
- Ambil Alih / Lanjutkan AI: reuse `PUT /conversations/:id/status` (conversations.ts:74),
  cukup **publish event** tambahan (delivery layer).

---

## 14. TYPING INDICATOR

Hibrida (rekomen):
- **Local simulated** (P‑PWA.14): tetap untuk AI (delay natural 700‑1300 ms di
  ChatPage) — tidak perlu kirim ke server.
- **Server‑side realtime typing**: hanya untuk **human↔human/channel** (customer↔admin),
  lewat WS `typing.started/stopped`. AI tidak kirim typing event (AI "menyetel" lewat
  simulasi lokal customer sisi). Bedakan:
  - AI sedang berpikir → local simulated (customer side).
  - Admin mengetik → WS `typing.started {party:'human_agent'}` → Web customer.
  - Customer mengetik → WS `typing.started {party:'customer'}` → Dashboard.

Mekanisme anti‑spam: throttle (mis. kirim `typing.started` sekali per 1‑2 s,
`stopped` pada blur/timeout 3 s).

---

## 15. NOTIFICATION

| Skenario | Kemampuan teknis | Solusi | Catatan |
|---|---|---|---|
| Customer terbuka chat, admin balas | foreground PWA | WS push + badge `unreadCount` | langsung |
| Customer tidak terbuka, PWA terbuka di background tab | visibilitychange | WS tetap connected (atau reconnect) → buffe‑r event → badge | |
| Customer tidak terbuka, PWA terpasang (homescreen) | service worker + Push API | push message ke SW → `self.registration.showNotification` | butuh VAPID + subscription (BARU, tahap notifikasi) |
| Browser ditutup / PWA terpasang | push eksternal | Web Push (FCM/VAPID) | butuh server push + user grant |
| Admin Dashboard tidak fofoya room | in‑app | WS room `store:{storeId}:admin` + bell badge | |

`apps/pwa/public/sw.js` sekarang pass‑through (P‑PWA.15) — **belum ada** handler
`push`/`notificationclick`. Rekomendasi: notifikasi **foreground = WS badge**
(cepat, no grant); **PWA terpasang/background = Web Push** (VAPID) — tahap terpisah.
Jangan gunakan WA sebagai notifikasi customer (bukan channel deliverynya).

---

## 16. UNREAD STATE

**RECOMMEND (paling sederhana + kuat):** conversation‑level, per‑party,
disimpan di `Conversation.metadata Json` (kolom existing `schema.prisma:203`,
nullable — **tanpa migration**).

- `webLastReadAt` — customer Web membaca sampai kapan (update pada focus + scroll
  bottom / interval).
- `adminLastReadAt` — admin membuka conversation di Dashboard.
- `unreadCount` di‑compute: `count(history WHERE createdAt > lastReadAt AND role='user')`
  (untuk customer) / `count(... role='assistant'|'agent'...)` (untuk admin).
- `DashboardLayout` badge (Bell) = jumlah conversation dengan `unreadCustomer > 0`
  (query via `getRecentConversations`/new aggregate, bukan client‑side count).

**Tidak pakai message‑level read state** (overkill; WA sendiri tak ada delivered‑read di Web).
`lastReadAt` → cukup. `notification state` = `unreadCount > 0` (boolean turunan).

---

## 17. MESSAGE READ

Untuk Web: **hanya `read` (lastReadAt)**. `sent`/`delivered` tidak perlu —
HTTP 200 = diterima; fokus pada customer membuka chat = `read`. Simpel & tidak
meniru WA berlebihan. (`typing` dan `read` berbagi WS.)

---

## 18. CUSTOMER IDENTITY (Web)

Pertahatankan `garuda_pwa_uid` (ChatPage.tsx:90-96, localStorage,
crypto.randomUUID) dipetakan ke `Customer.webUid` (schema.prisma:216, `@unique`).
Ini layak — cukup untuk sesi per browser.

Implikasi (dipertimbangkan):
- Browser/device berbeda → `webUid` baru → Customer baru → conversation baru (sengaja; web anon).
- Clear storage → baru → conversation baru.
- PWA install → localStorage tetap (same origin) → `webUid` persisten ✓.
- Tidak ada login customer (sesuai prinsip).
- Conversation recovery: `GET /history?uid=` by webUid — sudah ada (pwa.ts:97).

`humanAgentId` (schema.prisma:152) ada tapi **TIDAK DITEMUKAN** dipakai — jangan
reli pada kolom itu untuk assignment manual; gunakan `humanTakeoverAt` + logika
`status`.

---

## 19. MULTI‑TENANT ISOLATION (event)

- Room WS: `store:{storeId}` (umum), `store:{storeId}:conv:{conversationId}`
  (per conversation), `store:{storeId}:admin` (per toko admin).
- Auth koneksi WS:
  - Web customer: query `?slug=xxx&uid=yyy` → resolve storeId via slug, verify
    webUid milik store (pwa.ts pola). Masuk room conversation‑channel‑web.
  - Dashboard admin: Bearer token (garuda_user) → verify storeId; masuk room
    `store:{storeId}` + `store:{storeId}:admin`.
- Server tolak (403/close) bila token tidak match storeId → **cek cross‑tenant**.
- Redis adapter (multi‑instance) ruanggilannya rooms otomatis ter‑isolasi per key.

---

## 20. AUTHORIZATION

- **Web customer:** `webUid + storeId` (dari slug). Cukup untuk anon chatbox.
  Tidak butuh login. (Jika suatu hari butuh akun customer — luar skop.)
- **Dashboard:** tetap Bearer `garuda_user` (AuthContext.tsx). WS auth pakai token
  yang sama. Jangan ganti.
- Command (reply/status): tetap `authMiddleware` (routes/conversations.ts:14) —
  owner hanya manipulasi conversation milik storeId-nya. Tambah `authorization`
  room WS.

---

## 21. RECONNECT / OFFLINE (PWA mobile‑first)

- WS klien: `reconnect` dengan exponential back‑off (1s→30s), `onclose` auto‑reconnect.
- Saat offline: Queue pesan kirim (optimistic bubble tetap). `onSend` simpan
  draft lokal; retry ketika online (`navigator.onLine` listener + `beforeunload`).
- Reconnect: client kirim `lastAckMessageId` (atau `GET /history?since=<last>`) →
  server kirim missed events (catch‑up) atau client fetch `/history`.
- **Deduplication** di client (§22) aman karena `message.id` UUID.
- Background tab: WS mungkin disconnect (browser throttle) → gunakan
  `beforeunload`/reconnect + fetch catchup on focus.

---

## 22. DUPLICATION / IDEMPOTENCY

Skenario: HTTP response + WS event bisa double‑render.

**Solusi:**
1. API `POST /message` response **serukan `messageId`** (= `result.message.id`,
   UUID) — saat ini **TIDAK ADA** di pwa.ts:240 (hanya conversationId/content).
   **[MUST CHANGE] tambahkan `messageId`.**
2. Client store `messages` keyed by `id`; saat WS `message.created` datang, skip
   bila `id` sudah ada. Untuk HTTP response (synchronous), simpan langsung; WS
   event yang bersangkutan (sender='assistant', sama `id`) akan di‑skip.
3. ID generator: tetap `crypto.randomUUID()` (client) / server‑assigned pada
   persist. Untuk balasan AI, `messageId` = server (result.message.id).

---

## 23. EXISTING MUTEX (harus dipakai ulang)

`messageQueueService.acquireLock(chatId)` — `message-queue.service.ts:167`:
in‑memory `Map<string,boolean>`, key `lock:${chatId}`≈`conversationId`; singleton
ekspor; dipakai WA (`message-processor.service.ts:161/181`) **dan Web**
(`routes/pwa.ts:214`). **JANGAN diganti.**

Interaksi dengan realtime:
- Mutex hanya menutup **processing** (satu `processCustomerMessage` per conversation
  per‑time). WS delivery terjadi **setelah** `release()` lock — tidak menambah race.
- Event publish di‑luar lock (post‑release). `message.created` tidak memicu
  re‑processing.
- Jika ingin ekstrak mutex ke Redis (multi‑instance §33): **MAY CHANGE** future,
  API tetap `acquireLock(chatId): ()=>void | null` — tidak ganti kontrak.

---

## 24. WHATSAPP COMPATIBILITY

- WA inbound **tetap**: `routes/webhooks.ts` → `messageProcessorService.processMessage`
  → `conversationService.processCustomerMessage(...,'whatsapp')` → `saveMessage` →
  `sendWithPresence` → `fonnteService/gowaAdapter.sendMessage`. **Tidak berubah.**
- Hanya **append**: setelah `saveMessage` commit + `sendWithPresence` sukses,
  `deliveryService` publish `message.created` ke WS room admin (supaya dashboard
  realtime) — WA outbound tetap via gateway.
- `human_takeover` WA path (`notifyHumanTakeover` mp:505) tetap; cukup publish
  `conversation.handoff`.
- WA tidak perlu `typing`/Web push (out of scope).

---

## 25. FONNTE DEVICE STATUS (terpisah dari customer message realtime)

Audit Fonnte: `routes/webhooks.ts:154` **ignore** `status`
`connect`/`disconnect` → `TIDAK memperbarui` device status; `Disconnect Device`
tidak pernah dipanggil; `fonnteService.getDeviceStatus` pakai cache 60 s
(`fonnte.service.ts:6`) — akibat status WA dashboard **stale**.

**DECISION: ini EVENT DOMAIN BEDA** — jangan dicampur `message.created`.
Rekomendasi (task terpisah, lihat rencana Fonnte):
- Handler webhook device status → `invalidateDeviceCache(token)` (fonnte.service.ts:56)
  + publish `device.status.changed {storeId, connected, phoneNumber}` ke room
  `store:{storeId}:admin` (Dashboard WA badge langsung update).
- Tetap pakai cache 60 s untuk UI anggota.

---

## 26. FRONTEND ARCHITECTURE (modular, React 19 + Vite)

```
ChatPage.tsx   (controller: state, WS, send, install banner, typing sim)
├── ChatHeader          store (init) + conversation status badge (handoff badge)
├── ConversationStatus  open / human_takeover / resolved (warna + label)
├── MessageList         messages[] → type‑dispatch renderer
│     ├── TextMessage      (role+content+source)
│     ├── ProductMessage   (image/name/price/stock → "Tambah" quick_reply)
│     ├── ProductListMessage
│     ├── CartMessage      (items, total, [Checkout][Tambah])
│     ├── QuickReplyMessage (options → chips)
│     ├── ButtonMessage     (actions)
│     ├── SystemMessage     (pending_human / handoff)
│     ├── HandoffMessage    (human agent masuk/keluar)
│     └── TypingIndicator (dot‑pulse, lokal AI sim + WS human)
├── Composer            (input + send + file? + quick‑reply chips + read receipt on focus)
└── InstallBanner       (P‑PWA.15, tetap)
```
- `ChatBubble.tsx` (44 br, presentasional) → **ganti** jadi type‑dispatch
  (`MessageList` memilih komponen per `type`). `isTyping` tetap.
- WS lifecycle: connect di `useEffect` (auth via slug+uid / Bearer), cleanup on unmount.
- Semua state lokal + WS store; history fetch on mount (catchup offline).

---

## 27. LIBRARY UI

| Aspek | Custom UI | assistant‑ui | ChatScope |
|---|---|---|---|
| React 19 + Vite 8 | ✅ native | ⚠️ asumsi React 18 (adapter needed) | ⚠️ dependensi berat |
| Current API contract (`content` string) | ✅ cocok, mudah extend | ❌ butuh adapter message part → risk | ⚠️ mapping effort |
| Structured msg (`type/payload`) | ✅ kontrol penuh | ⚠️ harus map part → custom part type | ⚠️ map ke ChatScope message |
| Realtime (WS) | ✅ bebas | ⚠️ butuh plugin/bridge | ⚠️ butuh integration |
| PWA (manifest/sw/19.2.7) | ✅ | ⚠️ bundle besar | ⚠️ bundle besar |
| Bundle size | kecil (20 br basis) | besar | besar |
| QloBot identity (id/tema) | ✅ penuh kontrol | terbatas | terbatas |
| Maintenance | tim kami | komunitas | komunitas |
| Indonesian locale + non‑western UX | ✅ | ❌ (desain asumsi west) | ⚠️ effort lokal |

**OPTION A — Custom UI (RECOMMEND).** Alasan: contract kami spesifik (type/payload,
id, Indonesian, QloBot identity), ChatPage/ChatBubble sudah 20 br, React 19 native,
bundle kecil, dan kami butuh kontrol penuh atas `payload` renderer + install banner
+ typing sim yang sudah ada. assistant‑ui/ChatScope dapat mempercepat prototyping
teks tapi akan menambah friction adaptasi message part + menambah bundle +
membatasi identitas; cocok hanya bila tim ingin standar terlebih dahulu.

---

## 28. DATA FLOW FINAL

```
=== WEB CUSTOMER → AI ===
Customer ──POST /message──► pwa.ts ──► deliveryService.processWebMessage
   ──processCustomerMessage('web')──► engine [persist conversation_history]
   ──publish message.created ───────► Web WS room
   ──res.json {content,...} ────────► ChatPage (dedup by messageId)
   ──render TextMessage

=== WEB CUSTOMER → HUMAN ===
Customer ──POST /message──► pwa.ts ──► deliveryService
   ──engine (human_takeover guard:81) ──► result=null
   ──publish conversation.handoff ─────► Dashboard + Web customer (badge)
   ──Web customer UI: "👤 terhubung dengan Admin"

=== HUMAN → WEB CUSTOMER ===
Dashboard ──POST /conversations/:id/reply──► conversations.ts:107
   ──persist role='agent' ──► conversation_history
   ──publish message.created ──► Web WS room (customer)
   ──jika WA channel ──► gateway.sendMessage(customerPhone)

=== CUSTOMER → WHATSAPP ===
WhatsApp ──webhook──► webhooks.ts → messageProcessorService
   ──dedup/coalesce/mutex/cb ──► processCustomerMessage('whatsapp')
   ──persist ──► sendWithPresence ──► fonnte/gowa gateway
   ──(append) publish message.created ──► Dashboard WS (admin)

=== AI → WEB + WA ===
engine (1×) ──persist (role='assistant') ──► delivery
   ├── Web: WS event + HTTP res        (channel='web')
   └── WA : sendWithPresence           (channel='whatsapp')
   FAN-OUT? TIDAK — satu conversation satu channel.
```

---

## 29. DATABASE IMPACT

| Model/Table | Existing | Change? | Why / catatan |
|---|---|---|---|
| Conversation | ada (id,storeId,customerId,customerPhone?,status,channel,lastMessageAt,ai/human,resolvedAt,notes,metadata,created/updated/deleted, humanAgentId?) | **tidak wajib** | pakai `metadata Json` untuk `webLastReadAt`/`adminLastReadAt` + `humanTakeoverAt`/`status` existing |
| ConversationHistory | ada (id,conversationId,role,content,messageType?,source?,aiModel?,costUSD,metadata?,created/updated) | **tidak wajib** | `messageType` existing (belum dipakai) → pakai; `metadata.messagePayload` untuk structured |
| Customer | ada (id,storeId,phone?,webUid? @unique,name?,originCity?,nameSource?,visitCount,firstSeenAt,lastSeenAt,notes,deleted) | **tidak** | webUid sudah ada |
| ConversationContext | ada (conversationId,lastMessages,extractedEntities,sessionKey,sessionExpireAt,userIntent,workspace_v2) | **tidak** | workspace_v2 ada untuk cart state |
| Order | ada (id,storeId,conversationId,customerId,items Json,totalPrice,currency,orderStatus,shippingAddress,notes,extractedAt,confirmedAt,created/updated,deleted, orderItems) | **tidak** | cart/order sudah Json; cukup untuk CartMessage payload |

**Trade‑off akhir:** semua kebutuhan (type, payload, lastReadAt, handoff) muat di
kolom existing → **migration tidak wajib**. Migrasi ke kolom khusus / index baru
bisa jadi fase lanjutan bila volume butuh query‑optimisasi.

---

## 30. FILE IMPACT MAP

### MUST CHANGE
| PATH | FUNCTION/COMPONENT | REASON |
|---|---|---|
| `routes/pwa.ts:240-247` | POST /message response | tambah `messageId`, `type`, `payload` |
| `routes/pwa.ts` (baru) | GET /events?token/ws | WS upgrade |
| `routes/pwa.ts` (baru) | POST /typing | typing event |
| `routes/conversations.ts:122-173` | POST /reply | publish message.created (Web WS) setelah persist |
| `routes/conversations.ts:74-104` | PUT /status | publish conversation.handoff/resumed/resolved |
| `apps/pwa/src/components/ChatPage.tsx` | controller | WS subscribe + type dispatch + read receipt |
| `apps/pwa/src/components/ChatBubble.tsx` | (ganti) | type‑dispatch renderers |
| (baru) `services/conversation-delivery.service.ts` | wrapper | compose observe + event publish |
| (baru) `services/realtime.service.ts` | WS server | rooms + auth + redis adapter |
| (baru) `services/event-bus.service.ts` | pub | publish/subscribe in‑proc (Redis pub/sub jika multi‑instance) |
| `apps/pwa/public/sw.js` | push handler | `push`/`notificationclick` (notif tahap nanti) |
| (baru) `apps/pwa/src/components/*` | Message types | Text/Product/Cart/QuickReply/Button/System/Handoff |

### MAY CHANGE
| PATH | REASON |
|---|---|
| `domain/types.ts` | tambah `StructuredMessage` interface |
| `business/conversation.service.ts` | **opsional** post‑persist hook (lebih aman via delivery wrapper, jadi MAY) |
| `business/fallback.service.ts` | sertakan `matchedNames`/`matchedPrices` di metadata (sudah sebagian ada :355) |
| `apps/dashboard/src/pages/ConversationInbox.tsx` | WS subscribe inbox/reply realtime |
| `apps/dashboard/src/components/DashboardLayout.tsx` | badge realtime dari event |
| `message-processor.service.ts` | **append‑only** publish WA event post‑deliver (hati‑hati, jangan ganti logika) |

### DO NOT TOUCH
| PATH | REASON |
|---|---|
| `business/conversation.service.ts` processCustomerMessage/saveMessage/buildResult/getOrCreateContext/executeCartOps | ENGINE — satu sumber compose+persist |
| `services/chat/*` (interpreter/normalizer/composer-v2/workspace/reasoning/planner/validator/pendingClarification/fast-path/tier-match) | AI logic |
| `business/order.service.ts` | cart/order execution |
| `business/conversation-context.service.ts` (modifyCart/appendMessage/refreshSession/atomicCas) | context/cart state |
| `business/fallback.service.ts` tiers logika | 0‑LLM tiers |
| `services/message-queue.service.ts` acquireLock/isDuplicate/bufferMessage | mutex wajib dipakai ulang |
| `services/message-processor.service.ts` WA pipeline logic | WA compatibility |
| `services/fonnte.service.ts`, `adapters/whatsapp/gowa.adapter.ts` | WA gateway |
| `routes/webhooks.ts` | WA inbound + device status (extend device status terpisah) |
| `routes/messages.ts` | jalur non‑pwa |
| `prisma/schema.prisma` core models | tidak perlu migration |
| `apps/dashboard/src/{contexts/AuthContext,services/api}.tsx` | auth Bearer |

---

## 31. IMPLEMENTATION PHASES

### FASE 0 — Architecture contract + message envelope
- Finalkan `StructuredMessage` type; setujui envelope di §3; setujui transport §5.
- File: `domain/types.ts` (draft), dokumen ini.
- Risiko: scope creep. *Jangan sentuh engine.* Dependency: audit.

### FASE 1 — Web realtime foundation
- WS server (`realtime.service.ts` + event‑bus), room per store/conversation,
  auth slug+uid / Bearer. Mount di `routes/pwa.ts` WS upgrade.
- `POST /message` tetap (HTTP) — **tambah `messageId`** di response; publish
  `message.created` ke room customer. ChatPage connect + subscribe + dedup.
- Mutex: reuse `acquireLock` (pwa.ts:214 tetap).
- Risiko: cross‑tenant room leak → validasi auth. Dependency: FASE 0.

### FASE 2 — Structured message contract
- Delivery layer memetakan result.metadata / cart state → type/payload; persist
  via `messageType` + `metadata.messagePayload` (no migration). ChatPage renderer
  modular (Text/Product/Cart/QuickReply).
- Extension pwa.ts response. Risiko: n+1 query detail produk → cache via
  existing `entityCacheService` (entity-cache). Dependency: FASE 1.

### FASE 3 — Dashboard ↔ Web human messaging (2‑arah)
- `PUT /status` + `POST /reply` publish event ke room admin + customer Web.
- ConversationInbox subscribe; Web ChatPage render HandoffMessage + SystemMessage.
- WA tetap (reply via gateway). Risiko: duplikat reply WA+Web → persist sekali,
  kirim beda channel. Dependency: FASE 1.

### FASE 4 — Notification / PWA push
- SW `push`/`notificationclick` handler + VAPID + subscription endpoint.
- Foreground = WS badge (FASE 1); background = Web Push. Risiko: browser grant
  permission; fallback in‑app. Dependency: FASE 3.

### FASE 5 — Chatbox UI redesign + product/cart/checkout UI
- Ganti ChatPage/ChatBubble → modular (§26). Render product card/cart/checkout
  dari payload. Checkout → endpoint baru (finalizeDraftOrder). Quick reply →
  re‑send sebagai message. Risiko: regresi UX lama. Dependency: FASE 2,4.

### FASE 6 — Fonnte device status realtime (terpisah)
- Handler `webhooks.ts:154` → invalidateDeviceCache + publish
  `device.status.changed` ke room admin. JANGAN campur message event.
- Dependency: FASE 1 (room admin).

Setiap fase **tidak sentuh engine**; delivery layer berada di luar.

---

## 32. TEST STRATEGY (acceptance)

| TEST | Skenario |
|---|---|
| 1 | Customer Web kirim teks → AI balas, muncul TextMessage, `message.created` dipublish, tidak duplikat (messageId dedup) |
| 2 | Customer Web "aku mau sosis dan kentang" → `type:'cart'` muncul, total benar, items dari DB (bukan LLM) |
| 3 | Web customer kirim pesan saat status `human_takeover` → tidak ada balasan AI, muncul SystemMessage handoff |
| 4 | Admin reply via Dashboard → persist role='agent' sekali, `message.created` ke Web WS (bukan gateway karena channel web) |
| 5 | Web customer offline tutup chat, admin balas → pada reconnect/fetch history muncul 1× (dedup messageId) |
| 6 | Admin reply conversation WA → fonnteService.sendMessage dipanggil, history 1 baris |
| 7 | WA webhook inbound → processCustomerMessage → persist + sendWithPresence (tetap) + publish ke Dashboard |
| 8 | WA inbound, circuit breaker terbuka → human_takeover, notifyHumanTakeover, `conversation.handoff` ke Dashboard |
| 9 | Customer mati internet, kirim, reconnect → catchup via GET /history?uid (atau lastAckMessageId) |
| 10 | WS `message.created` + HTTP response yang sama `messageId` → client render 1× (keyed by id) |
| 11 | Customer store A tidak menerima event store B (room auth tolak cross‑tenant) |
| 12 | PWA background, admin balas → Web Push notifikasi (grant permission) muncul |
| 13 | Admin "Lanjutkan AI" (PUT status 'open') → `conversation.resumed`, AI balas lagi |
| 14 | Snapshot engine: skenario lama (tanpa WS) tetap beri‑respon 200 + persist sama (regression — processCustomerMessage tidak berubah) |

---

## 33. CRITICAL RISKS

| RISK | SEVERITY | WHY | MITIGATION |
|---|---|---|---|
| Race condition 2 request sama | Tinggi | mutex in‑mem (messageQueue, single instance) | reuse `acquireLock`; 429 bila terkunci; WS publish post‑release |
| Duplicate messages (HTTP+WS) | Tinggi | response + event sama | `messageId` UUID + client keyed‑by‑id dedup (§22) |
| Lost messages | Sedang | WS disconnect saat offline | catchup `GET /history` + `lastAckMessageId`; persist sebelum publish |
| Unauthorized subscription / cross‑tenant | Kritis | room leak antar toko | auth room di server (slug+uid/Bearer→storeId); tolak mismatch |
| Web reconnect (mobile) | Sedang | throttle background | exponential backoff WS + fetch catchup; visibilitychange |
| Service worker (PWA) | Sedang | SW pass‑through, belum push | tambah `push`/`notificationclick` separat; fallback in‑app |
| Multi‑instance VPS | Tinggi (masa depan) | mutex in‑mem + rooms in‑mem tidak scale | redis‑adapter WS + (opsional) redis mutex; kontrak tetap sama |
| DB migration | Rendah | desain pakai kolom existing | tidak wajib migration; migrasi opsional nanti |
| Existing WA behavior | Tinggi | jangan break sendWithPresence/retry/cb | WA path **tetap**; delivery wrapper **append‑only** publish |
| Conversation Engine regression | Kritis | semua flow lewat sana | **DO NOT TOUCH** engine; wrapper di luar; test regression FASE 0 |
| Memory usage WS (in‑mem rooms) | Sedang | banyak room/conn | gunakan redis adapter; room cleanup on disconnect |
| Admin→Web delivery (saat ini TIDAK ADA) | Tinggi (feature gap) | customerPhone null → reply di‑skip | §8 delivery via WS, bukan gateway, untuk channel web |

---

## 34. FINAL RECOMMENDATION

| Pertanyaan | Jawaban | Alasan (fakta) |
|---|---|---|
| Ganti Conversation Engine? | **TIDAK** | `processCustomerMessage` sudah modular (compose+persist); cukup bungkus delivery di luar (§4). |
| Ganti Chatbox UI? | **YA** | UI 20 br, teks‑only, tidak dapat structured UI/product/cart/checkout/quick‑reply (§1,§10‑12). Ganti penuh ke modular renderer. |
| Structured message contract? | **YA** | saat ini hanya `content:string` (pwa.ts:240; pwa.ts:240 tidak ada type/payload). Perlu untuk product/cart/button/quick_reply. |
| Web realtime? | **YA** | tidak ada WS/SSE/polling (audit §11). Diperlukan delivery admin→web + notification. |
| Delivery/event layer? | **YA** | compose+persist terikat HTTP/WS/gateway secara inline; dipisahkan agar engine tidak jadi monster (§4). |
| Human handoff bisa dipakai ulang? | **YA (sebagian)** | `human_takeover` + PUT /status + POST /reply ada (§7,§8,§12); tapi **delivery Web belum ada** (admin reply skip karena customerPhone null). Tambah WS delivery untuk web channel. |
| DB migration wajib? | **TIDAK** | kolom existing (`messageType`, `metadata Json`, `humanTakeoverAt`, `workspace_v2`) cukup (§29). |
| Library UI terbaik | **OPTION A — Custom** | contract spesifik + React 19 native + identity lokal + bundle kecil; assistant‑ui/ChatScope butuh adapter + bundle + kurang cocok UX lokal (§27). |
| Transport realtime | **WebSocket (Socket.IO)** | bidirectional + presence + room auth + redis adapter + reconnect; SSE polling terbatas (§5). |
| Extension point utama | **`conversationDeliveryService`** wrapper + `message.created` event pub/sub — engine tetap `processCustomerMessage` (§4, §30). |

---

## 35. HARD RULE

- Dokumen ini **design / architecture saja**.
- **Tidak** mengedit source, tidak membuat file source, tidak install package,
  tidak migrate DB, tidak refactor `conversationService`/engine, tidak commit,
  tidak deploy.
- Semua keputusan berbasis fakta di audit (`laporan-audit-chatbox-qlabot.md`)
  dan review Fonnte (`laporan-review-fonnte-api-implementation.md`).
- Setelah persetujuan, baru dibuat *implementation plan* terpisah (bukan di sini).

---

### Lampiran — anker fakta utama yang dipakai

- Mutex in‑memory + reusable: `message-queue.service.ts:167` (`acquireLock`,
  `processingLocks Map<string,boolean>`, key `lock:${chatId}`); dipakai
  `message-processor.service.ts:161` (WA) dan `routes/pwa.ts:214` (Web).
- customerPhone fallback per channel: `conversation.service.ts:75`
  (`channel==='web' ? null : customerId`); WA path fallback juga ada di
  `message-processor.service.ts:190` (`customerPhone: msg.customerId`, aman untuk
  WA karena customerId=phone di sana).
- Web response (kini text‑only): `routes/pwa.ts:240-247`
  (`{success,conversationId,content,source,confidence,timestamp}` — **tidak ada
  `messageId`/`type`/`payload`**).
- human_takeover guard: `conversation.service.ts:81-95` (return `null`).
- Admin reply WA‑only: `routes/conversations.ts:145-173` (skip kalau
  `customerPhone` null `:147/:160`).
- Persist message: `conversation.service.ts:1074-1091` →
  `prisma.conversationHistory.create` (role/content/source/costUSD/metadata).
- Engine default: `getStoreEngine` → `'v1'` bila tidak ada redis config
  (`engine-config.ts:22`); v2 pakai `workspace`/`composer-v2`/`reasoning`.
- Fonnte device status ignore: `routes/webhooks.ts:154`; cache 60 s
  (`fonnte.service.ts:6`); `invalidateDeviceCache` (`fonnte.service.ts:56`).
- WA outbound: `sendWithPresence` (`message-processor.service.ts:323`) →
  `smartRetrySend` (`:463`, retry 10s/30s/2m) → `getGateway` →
  `fonnteService.sendMessage`/`:86` atau `gowaAdapter.sendMessage`/`:44`.
- PWA manifest/SW: `apps/pwa/public/manifest.json`, `sw.js` pass‑through,
  register di `main.tsx:21-25`.
