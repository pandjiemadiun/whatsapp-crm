# LAPORAN — FASE 2: qlabot Structured Message Mapping (Web)

> Periode: setelah FASE 1 (commit `8e75e37`) diverifikasi owner. FASE 2 = **selesai, diverifikasi, siap review**.
> Scope: Web delivery path saja. Engine / schema / WA / dashboard tidak disentuh.

## Ringkasan eksekutif

Structured mapping **authority-only** + **enrichment read-only**: engine tidak pernah menuliskan
`conversation_history.messageType` (kolom ada, selalu NULL). Sinyal otoritatif engine yang sampai
ke delivery adalah (a) `result.metadata.reason` (closed‑set, `buildResult`/`buildModifyCartResult`
di `business/conversation.service.ts`), (b) `result.source` + `result.metadata.matchedNames /
matchedPrices / productIds` untuk produk (`fallback.service` `tryProduct` → `productService.searchProducts`
DB match, **bukan keyword**), c) + `result.message.content` / `cartOpsExecuted`.

Delivery **UPDATE baris YANG SAMA** (`id = result.message.id`) — bukan INSERT kedua —
mengisi `messageType` + `metadata.messagePayload` (merge‑preserve), lalu publish
`message.created` **setelah** UPDATE dengan representasi kanonik yang SAMA untuk HTTP +
WS. Enrichment payload (ops / item cart / stock+imageUrl) dibaca **read-only** dari state
authoritative engine yang sudah persisted (`conversationContextService.getPendingClarification`,
`orderService.getOrdersByConversation` draft order, `productService.getProductById`) — diluar
lock, tidak ada INSERT tambahan, dan gagal → `text` (failure-safe, HARD RULE #9).

---

## 1. Repository Inspection (inventory sumber otoritatif)

Hasil *inspection* terhadap repository (bukan asumsi):

| Artefak di repo | Nilai / bentuk | Otoritatif? |
|---|---|---|
| `conversation_history.messageType` (schema.prisma:176, `String?`) | Kolom ada, **tidak pernah ditulis engine** (grep: satu‑satu `MessageType` di repo ada di `message-queue.service.ts:12` — itu WA *media* type `text\|image\|video\|audio\|document`, BUKAN structured message type) | — (kolom kosong) |
| `conversation_history.metadata` (schema.prisma:181, `Json?`) | Engine `saveMessage` (:1084) menuliskan `message.metadata`; `buildResult` (:1008) **tidak set `msg.metadata`** → asisten message ber‑metadata `undefined`/NULL | — |
| `result.metadata.reason` (engine, `buildResult` option.metadata) | closed‑set authoritatif: `clarification_asked`, `modify_cart`, `escalation_clarification_retry_exceeded`, `resolver_retry`, `resolver_no_llm`, `rollback`, `dead_end_fallback` (atau *undefined* untuk AI reply_draft) | ✅ authoritatif |
| `result.source` + `result.metadata.matchedNames / matchedPrices / productIds` (`fallback.service` `tryProduct`, `fallback.service.ts:315`, `createResult` meletakkannya ke result‑level :874) | Engine `productService.searchProducts` (DB) — produk cocog, bukan keyword/regex; `createResult` menaruh ke `result.metadata` (result‑level) **dan** `result.message.metadata` (persist pada row) | ✅ authoritatif (product / product_list) |
| `result.message.content` | Teks balasan engine (content) | ✅ authoritatif (content) |
| `result.metadata.cartOpsExecuted` | Jumlah cart_ops yang dieksekusi (engine :790) | ✅ authoritatif (supporting signal) |
| state persisted engine untuk enrichment | `conversation_context.extractedEntities.pendingClarification.options` (clarification), draft `Order.items+totalPrice` (keranjang), `Product.stock/primaryImageUrl` (stok/gambar) | ✅ authoritatif (dibaca read‑only) |
| `result.metadata.intent` (hanya AI reply_draft) | Intent LLM, **tidak dipakai** klasifikasi (HARD RULE #16: `source==='ai'` bukan bukti) | ❌ tidak dipakai |

### Structured types found (authoritative source per tipe)

| Tipe kontrak | Sumber otoritatif di repo | Tersedia di delivery? |
|---|---|---|
| `text` | Default; `result.message.content` + `result.source` | ✅ selalu |
| `quick_reply` | `reason === 'clarification_asked'` (engine :655) → opsi otoritatif dari `conversationContextService.getPendingClarification` (`conversation_context.extractedEntities.pendingClarification.options`, engine `setPendingClarification` :650) — **bukan** `InterpreterResult.clarification.options` langsung (tidak terbawa ke `result`),
 melainkan state yang disimpan engine. **HARD RULE (patch FINAL): hanya `quick_reply` bila
 options tersedia & non‑kosong; bila `undefined`/`length===0` → `text` (jangan fabricate options
 dari content/keyword/regex/LLM).** | ✅ implemented (ops = enrichment read) |
| `cart` | `reason === 'modify_cart'` (buildModifyCartResult :988) + `cartOpsExecuted`; state keranjang otoritatif = draft `Order` (`orderService.getOrdersByConversation` → `orderStatus:'draft'`) `items` + `totalPrice`. `cartOpsExecuted` hanya supporting signal. Jika draft order tidak ada items → **downgrade `text`** | ✅ implemented (enrichment read) |
| `handoff` | `reason === 'escalation_clarification_retry_exceeded'` (engine :467/:568) **authoritative engine escalation** — bukan keyword; `human_takeover` (result null → `pending_human`, FASE 1 `conversation.handoff`) | ✅ implemented |
| `product` | `result.source === ResponseSource.PRODUCT` **dan** `result.metadata.matchedNames` ≥1 (engine `tryProduct` DB‑match, `fallback.service.ts:315`, `createResult` meletakkan ke `result.metadata` result‑level :874); payload `{id,name,price,stock,imageUrl}` — `id/name/price` dari metadata, `stock/imageUrl` dari `productService.getProductById` (public fields only; tidak expose `costUSD`/`margin`) | ✅ implemented (enrichment read) |
| `product_list` | `result.source === PRODUCT` + `matchedNames` ≥2 (multi‑candidate disambiguation listing, engine otoritatif; bukan array hasil text parsing) | ✅ implemented (enrichment read) |
| `order` | `finalizeDraftOrder` (order.service.ts:165) tidak menghasilkan order_result message type pada `result` (status order hanya ditanya lewat tier `ORDER_STATUS` FAQ‑like) | ❌ → text |
| `checkout` | Tidak ada sinyal di `result` (finalize hanya transisi status draft→waiting_address) | ❌ → text |
| `button` | `composer-v2` grep `action\|button\|quick_reply\|suggestion\|payload` = kosong | ❌ → text |
| `catalog` | `result.source === ResponseSource.CATALOG` (`tryCatalog` :238) hanya `productCount` (`:261`), tidak ada item array → text | ❌ → text |
| `image` | Tidak ada sumber image authoritative | ❌ → text |
| `payment` | Backend authoritative; tidak dibuat dari frontend | ❌ → text |
| `notification` | FASE 4 (event `notification.created` didefinisikan `event-bus.service.ts:25`, belum dipakai delivery Web) | ❌ → text |

**Existing `messageType` ownership:** engine **tidak** pernah menulis kolom ini
(selalu NULL). Per HARD RULE #4, pemilik akhir = **delivery layer** yang
diperbolehkan `UPDATE conversation_history SET messageType ... WHERE id = <existing>`.

**Existing metadata shape:** `conversation_history.metadata` (assistant msg) = NULL
saat ini (buildResult tidak set `msg.metadata`). Delivery hanya men‑*merge* (preserve)
jika ada, lalu menambah `messagePayload`.

---

## 2. Authoritative Source Decision

| TYPE | AUTHORITATIVE SOURCE | IMPLEMENTED / FALLBACK | REASON |
|---|---|---|---|
| `text` | default (tidak ada reason authoritatif) | ✅ implemented (default) | FASE 0 contract; engine default |
| `quick_reply` | `reason === 'clarification_asked'` | ✅ implemented | Engine *authoritatively* memutuskan bertanya (SOP); opsi di‑enrich dari state persisted context (`getPendingClarification`). **Jika options `undefined`/kosong → downgrade `text`** (HARD RULE — jangan fabricate) |

**HANDOFF verification (patch FINAL):** `reason='escalation_clarification_retry_exceeded'` dihasilkan **hanya** di jalur eskalasi — pada `conversation.service.ts:455` engine sudah memanggil `await this.markHumanTakeover(conversationId)` (human takeover **aktif**), menyimpan pesan asisten `source:HUMAN` (escalate reply), lalu `buildResult({source:HUMAN, content:escalateReply, metadata:{reason:'escalation_clarification_retry_exceeded'}})` (:472). Reason ini **tidak** muncul pada respons non‑handoff normal. ⇒ **authoritative handoff → tetap `handoff`**, tanpa rubah engine.
| `cart` | `reason === 'modify_cart'` + `cartOpsExecuted` | ✅ implemented | Engine mengeksekusi cart_ops (DB); item/total di‑enrich dari draft order (`getOrdersByConversation`) |
| `handoff` | `reason === 'escalation_clarification_retry_exceeded'` | ✅ implemented | Engine authoritatively eskalasi ke manusia |
| `product` | `result.source === PRODUCT` + `matchedNames` | ✅ implemented (enrich `stock`/`imageUrl`) | Engine DB‑match (`searchProducts`), bukan keyword |
| `product_list` | `result.source === PRODUCT` + `matchedNames` ≥2 | ✅ implemented (enrich per‑item) | Multi‑candidate disambiguation listing engine‑otoritatif |
| `order` | — | FALLBACK `text` | Tidak ada order_result di result untuk Web |
| `checkout` | — | FALLBACK `text` | Tidak ada sinyal checkout di result |
| `button` | — | FALLBACK `text` | Tidak ada |
| `image` | — | FALLBACK `text` | Tidak ada sumber image authoritative |
| `payment` | — | FALLBACK `text` | Backend authoritative; tidak dibuat dari frontend |
| `notification` | — | FALLBACK `text` | FASE 4 |

**Pengingat arsitektur (patch FINAL):** enrichment DB read (`getContext` / `getOrdersByConversation` / `getProductById`) **read‑only**, **di luar lock**, **tanpa INSERT**; `cart` kosong → downgrade `text`; `quick_reply` options kosong → downgrade `text`; `product`/`product_list` hanya mengekspor public fields (`id,name,price,stock,imageUrl`), tidak `costUSD`/`margin`/metadata internal.

---

## 3. Files Created / Modified (patch, on top of `8a1c0f7`)

File‑file *baru* relatif baseline FASE 1 (`8e75e37`) sudah dibuat di commit FASE 2
`8a1c0f7` (`mapper.ts` + `test.ts` + `report`). **Patch ini hanya MODIFIKASI** 3 file
sumber + laporan berikut ini (lihat §8 Git):

| File | Kegunaan |
|---|---|
| `apps/api/src/services/structured-message.mapper.ts` | `classifyStructured` (pure, sync) memutuskan **type** dari sinyal engine; `mapStructured(result, conversationId)` async melakukan enrichment read-only (`getPendingClarification`/`getOrdersByConversation`/`getProductById`) untuk melengkapi payload (ops/item/stock+imageUrl) |
| `apps/api/src/services/conversation-delivery.service.ts` | `await mapStructured(result, conversationId)` (enrichment read-only **setelah lock dilepas**); UPDATE same row `messageType`/`metadata.messagePayload` (merge‑preserve, try/catch→text); publish `message.created` setelah UPDATE |
| `apps/api/src/tests/structured-message.test.ts` | Pure: T1, T6, T6B, T2-classify, T4-classify, handoff, T3-classify, T3-list-classify, BUTTON/order/checkout/catalog; Integration (enrichment): T2-int (ops), T4-int (items+total), T4b-int (empty→text), T3-int (product), T3-list-int (product_list), T7, T8, T9, T10, T12, T14 |
| `DOCS/laporan-fase2-web-realtime-structured.md` | Laporan ini (patch section) |

## 4. Pre‑Existing Modified Files (dari FASE 2 asli `8a1c0f7`, tidak disentuh patch ini)

| File | Perubahan (FASE 2 asli) |
|---|---|
| `apps/api/src/routes/pwa.ts` | POST `/message` response `type`/`payload`; GET `/history` select `messageType,metadata` + normalisasi kanonis `{id,role,content,source,type,payload,createdAt}` |
| `apps/pwa/src/components/ChatPage.tsx` | `HistoryMsg.type?; payload?`; WS listener `data.type`/`data.payload`; send‑success append `type`/`payload` |
| `apps/pwa/src/services/api.ts` | (tidak berubah; axios typeless, `type`/`payload` via `res.data`) |

## 5. Protected Files — konfirmasi TIDAK disentuh

| File | Status |
|---|---|
| `business/conversation.service.ts` (`processCustomerMessage`, `saveMessage`, `buildResult`, `getOrCreateContext`) | ✅ TIDAK disentuh |
| `services/chat/*` | ✅ TIDAK disentuh |
| `business/fallback.service.ts` | ✅ TIDAK disentuh |
| `business/order.service.ts` | ✅ TIDAK disentuh |
| `business/conversation-context.service.ts` | ✅ TIDAK disentuh |
| `services/message-queue.service.ts` (`acquireLock`) | ✅ TIDAK disentuh |
| `services/message-processor.service.ts` | ✅ TIDAK disentuh |
| `services/fonnte.service.ts` | ✅ TIDAK disentuh |
| `adapters/whatsapp/gowa.adapter.ts` | ✅ TIDAK disentuh |
| `routes/webhooks.ts` | ✅ TIDAK disentuh |
| `routes/messages.ts` | ✅ TIDAK disentuh |
| `prisma/schema.prisma` | ✅ TIDAK disentuh |
| `apps/dashboard/src/contexts/AuthContext.tsx` | ✅ TIDAK disentuh |
| `apps/dashboard/src/services/api.ts` | ✅ TIDAK disentuh |

`git diff --stat` patch ini: hanya 3 file source + report. Tidak ada diff pada file protected
(cek `git diff --stat` di §16).

## 6. Persistence Proof (INSERT once → UPDATE same row)

```
ENGINE (processCustomerMessage)
  └─ saveMessage(msg)  → prisma.conversationHistory.CREATE  (id = msg.id = crypto.randomUUID)   [1 INSERT]
        │  conversation_history.id = msg.id
        │
DELIVERY (conversation-delivery.service.processWebRequest) — SETELAH engine return + release lock
  └─ mapStructured(result, conversationId)      [classify (pure) + enrichment read-only di luar lock]
  └─ prisma.conversationHistory.findUnique({ id: msg.id })      [read existing row]
  └─ prisma.conversationHistory.UPDATE({
        where: { id: msg.id },                                   [UPDATE SAME ROW]
        data: { messageType, metadata: { ...existing, messagePayload } }
     })
  └─ eventBus.publish('message.created', { id: msg.id, type, payload, ... })  [setelah UPDATE]
```

**Bukti tak ada INSERT kedua:** (a) enrichment membaca read‑only
(`getContext`/`getOrdersByConversation`/`getProductById`) — **tidak pernah
`conversationHistory.create`**; (b) delivery **hanya** memanggil `findUnique` +
`update` pada `conversation_history` (`grep` delivery tidak ada `.create`).
(c) T8: `row count` sebelum = 1, setelah = 1 (engine distub; tidak ada saveMessage
kedua). (d) T14: saat `update` dibutuhkan‑kan, tak ada INSERT — baris tetap ada, type
fallback text. (e) Enrichment gagal → `text` (try/catch), tidak ada INSERT kedua
(HARD RULE #9).

Query delivery (verification):
```bash
grep -n "conversationHistory.create" apps/api/src/services/conversation-delivery.service.ts
# (tidak ada output → tidak ada INSERT second-row)
```

## 7. Metadata Preservation (HARD RULE #7)

Merge‑preserve pada UPDATE:
```ts
const existingMeta = existing?.metadata  // row existing metadata
const mergedMeta = { ...existingMeta };   // preserve ALL existing keys
if (messagePayload !== null) mergedMeta.messagePayload = messagePayload; // + payload
```
Bukti (test T7): baris di‑seed dengan `metadata: { foo:'bar', existingField:true }`; setelah delivery
(reason `clarification_asked`, enrichment `getContext` **distub** mengembalikan opsi)
row.metadata =
`{ foo:'bar', existingField:true, messagePayload:{ reason:'clarification_asked', question:'...', options:[...] } }` —
`foo`/`existingField` **terselamatkan**, `messagePayload` ditambahkan (bukan overwrite). T2b memastikan bila
opts kosong → downgrade `text` (messagePayload tidak ada).

## 8. Message Identity (HARD RULE #3)

| Lokasi | Nilai |
|---|---|
| DB `conversation_history.id` | `result.message.id` (engine `crypto.randomUUID` di buildResult :1011) |
| HTTP `messageId` | `deliveryResult.messageId` = `result.message.id` (pwa.ts:258) |
| WS `event.data.id` | `MessageCreatedData.id` = `msg.id` (delivery :119) |

Test T9 memastikan `httpId === wsId === dbId === result.message.id` (3 titik sama).

## 9. HTTP/WS Canonical Representation (HARD RULE #11/#12)

SATU `StructuredMessage` (hasil `mapStructured`) memutuskan `messageType` + `messagePayload`; nilai yang SAMA dialirkan ke:
- HTTP `POST /message` response → `type: result.type`, `payload: result.payload`
- WS `message.created` → `data.type`, `data.payload` (realtime.dispatch meneruskan `env.data` apa adanya — realtime.service.ts:205‑255, tak dimodifikasi)

Test T10: `http.type === ws.type` dan `JSON.stringify(http.payload) === JSON.stringify(ws.payload)`.

## 10. Tests

| TEST | COMMAND | RESULT |
|---|---|---|
| T1 plain text | `tsx --env-file=../../.env --test src/tests/structured-message.test.ts` (sub T1) | ✅ pass |
| T2 quick_reply type | T2-classify sub | ✅ pass |
| T2b quick_reply NO options → text | T2b-int sub | ✅ pass |
| T2-int quick_reply options == authoritative context | T2-int sub | ✅ pass |
| T3 product (source=PRODUCT + matchedNames, enrich stock/imageUrl) | T3-classify + T3-int sub | ✅ pass |
| T3-list product_list (≥2 matchedNames, enrich) | T3-list-classify + T3-list-int | ✅ pass |
| T4 cart (type + items + total) | T4-classify + T4-int (items+total) | ✅ pass |
| T4b cart kosong → downgrade text | T4b-int | ✅ pass |
| T5 button/order/checkout/catalog → text | klasifikasi button → text (composer-v2 grep kosong) | ✅ pass |
| T6 no‑authoritative “ada sosis?” → text | T6 + T6B | ✅ pass |
| T7 existing metadata preserved + options | T7 | ✅ pass |
| T8 same row (no 2nd insert) | T8 | ✅ pass |
| T9 DB id = HTTP = WS | T9 | ✅ pass |
| T10 HTTP=WS canonical | T10 | ✅ pass |
| T11 dedup | FASE 1 smoke (msg 2‑4) | ✅ pass |
| T12 lock (one `acquireLock`, 2nd → locked) | T12 | ✅ pass |
| T13 tenant isolation | FASE 1 smoke (cross‑tenant) | ✅ pass |
| T14 failure safety (update throw → text, no 2nd insert) | T14 | ✅ pass |

**Suite FASE 2:** `tests 22, pass 22, fail 0` (21 subtests + parent).

## 11. Regression (FASE 1 tetap bekerja)

`scripts/smoke-fase1-realtime.ts` → `===== SMOKE RESULT: 13 passed, 0 failed =====` (Web connect, auth, room isolation, message.created, reconnect, history catch‑up, typing, dedup, 429 lock, multi‑tenant). `date-range.test.ts` → `pass 9, fail 0`.

## 12. Typecheck

| App | Command | Hasil |
|---|---|---|
| API | `npx tsc --noEmit -p tsconfig.json` | ✅ exit 0 (strict ES2020) |
| PWA | `npx tsc -p tsconfig.app.json --noEmit` | ✅ PWA_TYPECHECK_OK |

## 13. Database

| Item | Nilai |
|---|---|
| schema changed | ❌ NO (`prisma/schema.prisma` tidak disentuh; kolom `messageType`/`metadata` sudah ada) |
| migration | ❌ NO |
| `prisma db push` / `db migrate` | ❌ NO |
| second message insert | ❌ NO (delivery hanya `findUnique`+`update`) |

## 14. WhatsApp

| Item | Nilai |
|---|---|
| source changes | NONE |
| behavior changes | NONE |

Fase 2 fokus Web delivery; WA (`webhooks.ts`, `message-processor.service.ts`, `gowa.adapter.ts`, `fonnte.service.ts`, `message-queue.service.ts`) tidak disentuh.

## 15. Scope Violations

NONE. Tidak ada: migration, second INSERT, schema change, WA change, notification/serviceworker, dashboard human‑messaging, commerce UI redesign, heuristic keyword/regex/AI‑source. `acquireLock` tetap satu‑satunya, dimiliki delivery (HARD RULE #18).

## 16. Git

**Patch ini** (commit `feat(chatbox): FASE 2 structured payload — authoritative quick_reply/cart/product`)
dibandingkan baseline commit FASE 2 `8a1c0f7`. Hanya **4 file** (3 source modify + 1 report modify):

```
git status --short  (staging hanya PATCH ini)
 M .env                                    ← tidak distage (RAILS)
 M apps/api/dist/**                        ← pre-existing dirty; tidak distage (RAILS)
 M apps/api/logs/*                         ← tidak distage (RAILS)
 M apps/api/src/services/structured-message.mapper.ts
 M apps/api/src/services/conversation-delivery.service.ts
 M apps/api/src/tests/structured-message.test.ts
 M DOCS/laporan-fase2-web-realtime-structured.md
```
`git diff --check` → bersih (tidak ada whitespace error).

Stage hanya 4 file di atas (eksklusi `.env`/`dist`/`logs`/protected):
```
git add apps/api/src/services/structured-message.mapper.ts \
        apps/api/src/services/conversation-delivery.service.ts \
        apps/api/src/tests/structured-message.test.ts \
        DOCS/laporan-fase2-web-realtime-structured.md
```
Commit hash dilampirkan setelah eksekusi:
```
commit <HASH>
    feat(chatbox): FASE 2 structured payload — authoritative quick_reply/cart/product
```
`git diff --stat` patch commit: **4 file modified**; tidak termasuk `.env`/`dist`/`logs`/protected.

## 17. BLOCKERS

NONE. Semua acceptance kriteria FASE 2 terpenuhi; tidak ada kondisi STOP yang terpicu (§32 A‑K).

## 18. RECOMMENDATION

**GO — FASE 2 selesai dan siap direview owner.**

Catatan kepemilikan:
- `messageType` ownership: engine tidak menulis → delivery meng‑UPDATE same row (sesuai HARD RULE #4 owner decision). Ini **dokumentasi** ownership, bukan asumsi.
- FASE 2 tidak mengubah perilaku engine/WA/schema. Deploy *intentionally NOT performed* (pm2 api tetap online, production `/api/ws` belum live hingga `npm run build && pm2 restart api` — lihat gate FASE 1).

**PENGINGAT FASE 2+ (opsional, dil fuori FASE 2 ini):**
- `quick_reply` dapat diperluas memuat opsi sebenarnya via `conversationContextService.getPendingClarification(conversationId)` (state engine, authoritative) — bila diperlukan klien.
- `cart` dapat diperluahkan item via `getCartFromDb(conversationId)` — authoritative DB state.
- `product`/`order`/`checkout` membutuhkan engine yang **otentikmen** mengembalikan payload structed di `result` (saat ini tidak tersedia) → sampai saat itu tetap `text`.

**FASE selanjutnya TIDAK dimulai** sampai owner review & persetujuan (FASE 3 Dashboard admin WS client, FASE 4 notification.service, dst.).
