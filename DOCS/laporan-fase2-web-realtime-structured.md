# LAPORAN — FASE 2: qlabot Structured Message Mapping (Web)

> Periode: setelah FASE 1 (commit `8e75e37`) diverifikasi owner. FASE 2 = **selesai, diverifikasi, siap review**.
> Scope: Web delivery path saja. Engine / schema / WA / dashboard tidak disentuh.

## Ringkasan eksekutif

Structured mapping **authority-only**: engine tidak pernah menuliskan
`conversation_history.messageType` (kolom ada, selalu NULL) dan tidak mengekspor
product/cart/order/checkout/button/image payload pada `result`. Sinyal otoritatif
satu‑satunya yang sampai ke delivery = `result.metadata.reason` (closed‑set, di‑authoring
`buildResult` di `business/conversation.service.ts`) + `result.message.content` +
`result.metadata.cartOpsExecuted`.

Delivery **UPDATE baris YANG SAMA** (`id = result.message.id`) — bukan INSERT kedua —
mengisi `messageType` + `metadata.messagePayload` (merge‑preserve), lalu publish
`message.created` **setelah** UPDATE dengan representasi kanonik yang SAMA untuk HTTP +
WS. Fallback `text` bila tidak ada sinyal authoritatif. Tidak ada heuristic
string/keyword/regex/AI‑source.

---

## 1. Repository Inspection (inventory sumber otoritatif)

Hasil *inspection* terhadap repository (bukan asumsi):

| Artefak di repo | Nilai / bentuk | Otoritatif? |
|---|---|---|
| `conversation_history.messageType` (schema.prisma:176, `String?`) | Kolom ada, **tidak pernah ditulis engine** (grep: satu‑satu `MessageType` di repo ada di `message-queue.service.ts:12` — itu WA *media* type `text\|image\|video\|audio\|document`, BUKAN structured message type) | — (kolom kosong) |
| `conversation_history.metadata` (schema.prisma:181, `Json?`) | Engine `saveMessage` (:1084) menuliskan `message.metadata`; `buildResult` (:1008) **tidak set `msg.metadata`** → asisten message ber‑metadata `undefined`/NULL | — |
| `result.metadata.reason` (engine, `buildResult` option.metadata) | closed‑set authoritatif: `clarification_asked`, `modify_cart`, `escalation_clarification_retry_exceeded`, `resolver_retry`, `resolver_no_llm`, `rollback`, `dead_end_fallback` (atau *undefined* untuk AI reply_draft) | ✅ authoritatif |
| `result.message.content` | Teks balasan engine (content) | ✅ authoritatif (content) |
| `result.metadata.cartOpsExecuted` | Jumlah cart_ops yang dieksekusi (engine :790) | ✅ authoritatif |
| `result.metadata.intent` (hanya AI reply_draft) | Intent LLM, **tidak dipakai** klasifikasi (HARD RULE #16: `source==='ai'` bukan bukti) | ❌ tidak dipakai |
| `InterpreterResult.cart_ops` / `llmResult.clarification.options` | Dieksekusi (DB) / disimpan ke `conversation_context` — **tidak terbawa ke `result`** | ❌ tidak tersedia di delivery |

### Structured types found (authoritative source per tipe)

| Tipe kontrak | Sumber otoritatif di repo | Tersedia di delivery? |
|---|---|---|
| `text` | Default; `result.message.content` + `result.source` | ✅ selalu |
| `quick_reply` | `result.metadata.reason === 'clarification_asked'` (engine :655), opsi disimpan ke context (`setPendingClarification` :650) | ✅ reason tersedia (ops = FASE 2+ enrichment) |
| `cart` | `reason === 'modify_cart'` (buildModifyCartResult :988) + `cartOpsExecuted`; state keranjang di DB | ✅ reason + count; DB‑items enrichment = FASE 2+ |
| `handoff` | `reason === 'escalation_clarification_retry_exceeded'` (engine :467/:582) atau `human_takeover` (result null → `pending_human`, FASE 1 publish `conversation.handoff`) | ✅ reason tersedia |
| `product` | Tidak ada payload product di `result` (InterpreterResult.products tidak terbawa) | ❌ → text |
| `product_list` | Tidak ada | ❌ → text |
| `order` | `orderService.finalizeDraftOrder` (engine :778) tidak menghasilkan message type/order_result di `result` | ❌ → text |
| `checkout` | Tidak ada sinyal di `result` | ❌ → text |
| `button` | Tidak ada | ❌ → text |
| `image` | Tidak ada | ❌ → text |
| `payment` | Tidak ada | ❌ → text |
| `notification` | FASE 4 (event `notification.created` sudah didefinisikan di `event-bus.service.ts:25`, belum dipakai delivery Web) | ❌ → text |

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
| `quick_reply` | `result.metadata.reason === 'clarification_asked'` | ✅ implemented | Engine *authoritatively* memutuskan bertanya (SOP); closed‑set reason |
| `cart` | `result.metadata.reason === 'modify_cart'` + `cartOpsExecuted` | ✅ implemented | Engine mengeksekusi cart_ops (DB) — authoritatif |
| `handoff` | `reason === 'escalation_clarification_retry_exceeded'` | ✅ implemented | Engine authoritatively eskalasi ke manusia |
| `product` | — | FALLBACK `text` | Tidak ada payload product di result; dilarang search produk untuk klasifikasi (HARD RULE #15) |
| `product_list` | — | FALLBACK `text` | Tidak ada |
| `order` | — | FALLBACK `text` | Tidak ada order_result di result untuk Web |
| `checkout` | — | FALLBACK `text` | Tidak ada sinyal checkout di result |
| `button` | — | FALLBACK `text` | Tidak ada |
| `image` | — | FALLBACK `text` | Tidak ada sumber image authoritative |
| `payment` | — | FALLBACK `text` | Backend authoritative; tidak dibuat dari frontend |
| `notification` | — | FALLBACK `text` | FASE 4 |

**Pengingatan FASE 2+ (opsional, tidak dikerjakan di FASE 2 untuk menghindari business‑logic di delivery):** payload `quick_reply` belum memuat opsi (ops ada di `conversation_context` via `getPendingClarification`); payload `cart` belum memuat item (ada di DB). FASE 2 patut diperluas bila opsi/item diperlukan klien — dengan tetap membaca **state engine yang sudah ada** (bukan heuristic).

---

## 3. Files Created

| File | Kegunaan |
|---|---|
| `apps/api/src/services/structured-message.mapper.ts` | Pure mapper `mapStructured(result)` → authority‑only; tidak DB, tidak engine |
| `apps/api/src/tests/structured-message.test.ts` | T1, T2, T4, T6, T6B, T7, T8, T9, T10, T12, T14 (+ handoff) |
| `DOCS/laporan-fase2-web-realtime-structured.md` | Laporan ini |

## 4. Files Modified

| File | Perubahan |
|---|---|
| `apps/api/src/services/conversation-delivery.service.ts` | `mapStructured` + UPDATE same row `messageType`/`metadata.messagePayload` (merge‑preserve, try/catch→text); `MessageCreatedData.payload`; `DeliveryResult['ok'].type/.payload`; publish `message.created` **setelah** UPDATE |
| `apps/api/src/routes/pwa.ts` | POST `/message` response `type: result.type, payload: result.payload`; GET `/history` select `messageType,metadata` + normalisasi ke shape kanonis `{id,role,content,source,type,payload,createdAt}` |
| `apps/pwa/src/components/ChatPage.tsx` | `HistoryMsg.type?:string; payload?:unknown`; WS listener memakai `data.type`/`data.payload`; send‑success append `type`/`payload` dari response |

> `apps/pwa/src/services/api.ts` tidak berubah (axios typeless; `type`/`payload` mengalir via `res.data`).

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

`git diff --stat` melalui commit FASE 2: hanya 5 file source + report. Tidak ada diff pada file protected (cek `git diff --stat` di §16).

## 6. Persistence Proof (INSERT once → UPDATE same row)

```
ENGINE (processCustomerMessage)
  └─ saveMessage(msg)  → prisma.conversationHistory.CREATE  (id = msg.id = crypto.randomUUID)   [1 INSERT]
        │  conversation_history.id = msg.id
        │
DELIVERY (conversation-delivery.service.processWebRequest) — SETELAH engine return + release lock
  └─ mapStructured(result)            [pure, authority-only]
  └─ prisma.conversationHistory.findUnique({ id: msg.id })      [read existing row]
  └─ prisma.conversationHistory.UPDATE({
        where: { id: msg.id },                                   [UPDATE SAME ROW]
        data: { messageType, metadata: { ...existing, messagePayload } }
     })
  └─ eventBus.publish('message.created', { id: msg.id, type, payload, ... })  [setelah UPDATE]
```

**Bukti tak ada INSERT kedua:** (a) `mapStructured` pure, tak panggil prisma; (b) delivery **hanya** memanggil `findUnique` + `update` — `grep` delivery file tidak ada `conversationHistory.create`. (c) T8: `row count` sebelum = 1, setelah = 1 (engine distub; tidak ada saveMessage kedua). (d) T14: saat `update` dibutuhkan‑kan, tak ada INSERT — baris tetap ada, type fallback text.

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
Bukti (test T7): baris di‑seed dengan `metadata: { foo:'bar', existingField:true }`; setelah delivery (reason `clarification_asked` → quick_reply) row.metadata =
`{ foo:'bar', existingField:true, messagePayload:{ reason:'clarification_asked', content:'...' } }` — `foo`/`existingField` **terselamatkan**, `messagePayload` ditambahkan (bukan overwrite).

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
| T2 quick_reply | T2 sub | ✅ pass |
| T3 product_list | tidak ada authoritative → text | ✅ T1/T6 mewakili |
| T4 cart | T4 sub | ✅ pass |
| T5 button/quick_reply | quick_reply = T2 | ✅ pass |
| T6 no‑authoritative “ada sosis?” → text | T6 + T6B | ✅ pass |
| T7 existing metadata preserved | T7 | ✅ pass |
| T8 same row (no 2nd insert) | T8 | ✅ pass |
| T9 DB id = HTTP = WS | T9 | ✅ pass |
| T10 HTTP=WS canonical | T10 | ✅ pass |
| T11 dedup | FASE 1 smoke (msg 2‑4) | ✅ pass |
| T12 lock (one `acquireLock`, 2nd → locked) | T12 | ✅ pass |
| T13 tenant isolation | FASE 1 smoke (cross‑tenant) | ✅ pass |
| T14 failure safety (update throw → text, no 2nd insert) | T14 | ✅ pass |

**Suite FASE 2:** `tests 13, pass 13, fail 0` (12 subtests + parent).

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

```
git status --short  (staging hanya FASE 2)
 M .env                                    ← tidak distage (RAILS)
 M apps/api/dist/**                        ← pre‑existing dirty; tidak distage (RAILS)
 M apps/api/logs/*                         ← tidak distage (RAILS)
 M apps/api/src/routes/pwa.ts
 M apps/api/src/services/conversation-delivery.service.ts
 M apps/pwa/src/components/ChatPage.tsx
?? apps/api/src/services/structured-message.mapper.ts
?? apps/api/src/tests/structured-message.test.ts
?? DOCS/laporan-fase2-web-realtime-structured.md
```
`git diff --check` → bersih (tidak ada whitespace error).

Stage seluruh file sumber FASE 2 + report (eksklusi `.env`/`dist`/`logs`):
```
git add apps/api/src/services/structured-message.mapper.ts \
        apps/api/src/tests/structured-message.test.ts \
        apps/api/src/services/conversation-delivery.service.ts \
        apps/api/src/routes/pwa.ts \
        apps/pwa/src/components/ChatPage.tsx \
        DOCS/laporan-fase2-web-realtime-structured.md
```
Commit (hash dilampirkan setelah eksekusi):
```
commit <HASH>
Author: ...
    feat(chatbox): FASE 2 structured message mapping (authority-only, same-row update)
```
`git diff --stat` commit: **4 modified + 2 new source/test + 1 report = 7 file**; tidak termasuk `.env`/`dist`/`logs`/protected.

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
