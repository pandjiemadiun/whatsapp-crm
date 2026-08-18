# Contract Foundation — QloBot Chatbox (FASE 0)
## Design / contract ONLY — tidak ada runtime, tidak ada source code change

**Tujuan:** FASE 0 = **contract escrow + runtime verification + typecheck**.
Tidak ada Socket.IO / WebSocket server / event publisher / UI / migration.
Relevan untuk review owner sebelum FASE 1.

**Sumber (terverifikasi ke repository):**
- `apps/api/src/prisma/schema.prisma` — Conversation, ConversationHistory,
  ConversationContext, Customer, Order/OrderItem, Store
- `apps/api/src/domain/types.ts:18` `ConversationMessage`, `:18` `ResponseSource`,
  `:48` `ResponseResult`, `:103` `ConversationContextData`
- `apps/api/src/routes/pwa.ts:66` init, `:75` history GET, `:130` history res,
  `:222-250` message POST response (429/:232 pending_human/:240 success)
- `apps/api/src/routes/conversations.ts:14` authMiddleware, `:74` PUT status,
  `:122` reply persist, `:147/:160` customerPhone skip, `:150/:164` fonnte/gowa
- `apps/api/src/middleware/auth.ts:5-37` `AuthenticatedRequest.user{storeId,email}`
- `apps/api/src/services/message-queue.service.ts:167` `acquireLock`
- `apps/api/src/services/chat/engine-config.ts:21-22` `getStoreEngine` default `'v1'`
- `apps/pwa/src/services/api.ts:7-12` base `/api`, no Authorization
- `apps/pwa/src/components/ChatPage.tsx:90-93` webUid, `:111` history fetch,
  `:167` typing target, `:176` message POST, `:240` (res envelope reference)
- `apps/pwa/src/App.tsx:5` route `/c/:slug`
- `apps/pwa/vite.config.ts:25` `base: '/c/'`

---

## 0. Runtime verification — crypto.randomUUID
- **Node version:** `v24.19.0`
- **PM2 process:** `api` (pid 310048, fork_mode, interpreter `node`,
  node.js version `24.19.0`, node env `production`, exec cwd
  `/home/ubuntu/garuda/apps/api`, `/proc/310048/exe -> /usr/local/bin/node`)
- **Command:** `node -e "console.log(crypto.randomUUID())"` →
  `b70e5186-7ca6-424f-b784-a226199643a2` (sukses)
  `node -e "const c=require('crypto'); console.log(typeof c.randomUUID)"` → `function`
- **Conclusion: NO SOURCE CHANGE REQUIRED.** Runtime global `crypto.randomUUID`
  tersedia pada Node 24 (production PM2). `conversation.service.ts` (saveMessage
  di `:1080`) dapat pakai `crypto.randomUUID()` tanpa import tambahan.
  (`apps/api/tsconfig.json` lib hanya `ES2020` — global `crypto` tidak di‑type‑check
  tapi **tersedia runtime**, jadi tidak error di Node 24.)

---

## 1. StructuredMessage
```ts
type Sender = 'customer' | 'assistant' | 'human_agent'   // == ConversationMessage.sender (:21)

type MessageType =
  | 'text'
  | 'product'
  | 'product_list'
  | 'cart'
  | 'quick_reply'
  | 'button'
  | 'order'
  | 'checkout'
  | 'image'
  | 'system'
  | 'handoff'
  | 'payment'
  | 'notification'

interface StructuredMessage {
  id: string                    // conversation_history.id (uuid) — identity
  conversationId: string        // conversation_history.conversationId
  sender: Sender
  type: MessageType             // dari messageType (existing nullable col)
  content: string               // conversation_history.content (selalu ada — aksesibilitas)
  payload?: Record<string, any> // metadata.messagePayload (sub‑key metadata Json)
  source?: ResponseSource       // REUSE enum domain/types.ts:18 (lihat DISCREPANCY §15)
  confidence?: number | null    // dari result.confidence
  createdAt: string             // ISO — transport layer; persisten Date (ConversationMessage.createdAt: Date)
  updatedAt?: string
}
```
**NOTE:** `ConversationMessage` (`domain/types.ts:18`) sudah hampir identik;
kontrak ini adalah **transport/event envelope**. Pada FASE implementasi, cukup
**extend** `ConversationMessage` dengan `type?` dan `payload?` — **jangan duplicate**.
`createdAt` persisten = `Date` → di‑serialize ke ISO string pada WS/HTTP response.

---

## 2. MessageType — authoritative source per type (HARD RULE, §5 plan)

Delivery **tidak boleh** menandakan type dari string matching. Setiap type
hanya bila ada sumber authoritative; bila ragu → `'text'`.

| Type | Authoritative source (existing) |
|---|---|
| `text` | `result.message.content` (domain/types.ts:48 `ResponseResult`) |
| `system` | `human_takeover` guard return null (conversation.service.ts:81) |
| `handoff` | `result===null` guard (conversation.service.ts:81) |
| `product`/`product_list` | `metadata.matchedNames`/`matchedPrices` (fallback.service.ts — audit `:355`) |
| `cart` | `orderService.getOrdersByConversation` → `Order.items` Json (schema.prisma) |
| `quick_reply` | `InterpreterResult.clarification?.options` (interpreter.ts:33) |
| `order`/`checkout` | `orderService` `Order.orderStatus`/`totalPrice` |
| `image` | explicit imageUrl di payload (mis. QRIS) |
| `button` | action set eksplisit engine (checkout/handoff/tambah) |
| `payment`/`notification` | sistem |

FASE 0 **tidak** membuat heuristic. Mapping logic teknis → FASE 2.

---

## 3. EventEnvelope + EventType
```ts
type EventType =
  | 'message.created'
  | 'typing.started'
  | 'typing.stopped'
  | 'conversation.handoff'
  | 'conversation.resumed'
  | 'conversation.resolved'
  | 'conversation.updated'
  | 'notification.created'
  | 'device.status.changed'   // FASE 6 — tidak diimplementasikan/dipublish FASE 0

interface EventEnvelope {
  event: EventType
  storeId: string            // boundary wajib
  data: any
  ts: number                  // epoch ms
}
```
**FASE 0 = definisi saja.** Tidak ada `publish()`/`emit()`/Socket.IO server.

---

## 4. Room naming (final)
```
store:{storeId}
store:{storeId}:conv:{conversationId}
store:{storeId}:admin
```
Rules:
1. **WAAJIB** diawali `store:{storeId}` → isolasi tenant.
2. Tidak ada global room tanpa `store:` namespace.
3. Conversation room selalu mengandung `conversationId`.
4. Admin room hanya per store.
5. Tidak ada room naming alternatif.

FASE 0 = kontrak. Tidak membuat `io`/`net` server.

---

## 5. Web auth contract
- Identity anon: query `?slug=<slug>&uid=<webUid>` (ChatPage.tsx:90-93 uid =
  `localStorage['garuda_pwa_uid']`; `api.ts` anon/non‑auth).
- Server (FASE 1 implement): resolve store via `pwa.ts:59` `store.findBySlug`;
  verify `Customer.webUid` berada pada storeId.
- Join room hanya `store:{storeId}` yang sesuai.

FASE 0: **hanya mendokumentasikan/menetapkan type**, tidak auth implementation.

---

## 6. Admin auth contract
- Pakai **existing** `authMiddleware` (`middleware/auth.ts:9-37`) +
  `AuthenticatedRequest.user{storeId,email}` (`auth.ts:5`).
- Transport: `Authorization: Bearer <token>` (header) — **production rule**.
- FASE 0 **tidak** mengubah `AuthContext.tsx`/`dashboard api.ts`.

**DISCREPANCY (lapor, tidak diam‑diam):** implementation plan menyebutkan
`?token=<signed>` sebagai *compatibility option*. FASE 0 memutuskan:
**production = Bearer/header saja; query token tidak dipakai.**

---

## 7. Message identity / dedup (final)
Satu arah:
```
conversation_history.id  =  HTTP response.messageId  =  WS event.data.id
```
- ID asal: `messageQueueService` / `crypto.randomUUID()` di `saveMessage`
  (conversation.service.ts:1080; runtime verified §0).
- Client (FASE 1): `Map<messageId, StructuredMessage>`; render 1×.
- History (`GET /pwa/:slug/history` pwa.ts:130) = source of truth catchup.
- FASE 0: **hanya kontrak**, tidak ChatPage dedup impl.

---

## 8. Read state contract
- Persist di `Conversation.metadata Json` (existing schema) key:
  `webLastReadAt` / `adminLastReadAt` (ISO string).
- `unreadCount = count(history WHERE createdAt > lastReadAt)`.
- **Tidak** ada tabel read baru / migration / row per message.

---

## 9. Typing contract
- Web: `POST /pwa/:slug/typing {uid, conversationId, typing:boolean}`
  → throttle 1‑2s → emit `typing.started/stopped {conversationId, party:'customer'}`.
- Admin: via WS `typing.*` → room conversation.
- AI: tetap **local simulated** (ChatPage.tsx:167 target 700‑1300ms) — tidak
  emit event.
- FASE 0: **hanya kontrak endpoint + event**, tidak runtime.

---

## 10. Tenant isolation (acceptance rule)
- `storeId` = boundary utama pada setiap event + room.
- Server **tidak pernah percaya** `storeId` dari client; selalu resolve dari
  `slug` (Web) / Bearer token storeId (Admin) → `storeId` server‑side.
- Event `message.created`/`conversation.*` selalu mengandung `storeId`
  (EventEnvelope) → subscriber filter.

---

## 11. EventBus vs Redis boundary (final)
- **EventBus** = in‑process domain event (Node EventEmitter) antar
  `engine/delivery` → `realtime delivery` **within satu proses**.
- **Socket.IO Redis Adapter** = *hanya* sinkronisasi room WS antar worker/proses
  bila multi‑instance. **Bukan pengganti EventBus.**
- **Single‑VPS MVP:** EventBus in‑proc + Socket.IO in‑proc cukup. Redis adapter
  **opsional**, enable bila `--workers > 1`.
- FASE 0: tidak install/aktifkan redis adapter. (`ioredis` ^5.11.1 sudah ada di
  deps api — tersedia, tapi tidak dipakai sampai scaling.)

---

## 12. FASE 0 → FASE 1 boundary (apa yang TIDAK dilakukan FASE 0)
FASE 0 **tidak** menghasilkan:
- Socket.IO / WebSocket server
- `/ws` runtime / WS upgrade
- `publish()`/`emit()` runtime (EventBus + delivery wrapper)
- ChatPage subscribe / dedup impl
- service worker push handler
- structured mapping impl / payload builder
- migration / schema change
- dependency install (`socket.io`, `socket.io-client`, `web-push`, dsb.)

FASE 0 hanya: runtime verify + contract artifact + typecheck.

---

## 13. Typecheck
- **Command:** `cd apps/api && npx tsc --noEmit -p tsconfig.json`
- **tsconfig:** `target/module ES2020, lib ES2020, strict, skipLibCheck true,
  rootDir src, outDir dist` (apps/api/tsconfig.json).
- **Result:** `TSC_EXIT=0` — **semua clean**, tidak ada error pre‑existing maupun
  baru. (FASE 0 tidak menambah source, jadi tak ada error baru.)

---

## 14. Files protected (konfirmasi FASE 0)
`conversation.service.ts`, `services/chat/*`, `fallback.service.ts`,
`order.service.ts`, `conversation-context.ts`, `message-queue.service.ts`,
`message-processor.service.ts`, `fonnte.service.ts`, `gowa.adapter.ts`,
`routes/webhooks.ts`, `routes/messages.ts`, `prisma/schema.prisma`,
`apps/dashboard/src/{AuthContext,services/api}.ts`.
**FASE 0 menyentuh: NONE dari ini.** Hanya `DOCS/contract-chatbox.md` baru.

---

## 15. Discrepancy log (lapor — tidak diam‑diam memilih)

| # | Contract plan | Actual repo | Decision |
|---|---|---|---|
| 1 | `source?: 'ai'\|'dashboard'\|'customer'\|'system'` | `ResponseSource` enum `domain/types.ts:18` (`cache\|faq\|knowledge\|ai\|human\|fallback\|dead_end\|product\|catalog\|payment\|shipping\|sop\|order_status\|total`) | **adopt actual `ResponseSource`** (jangan narrowing). `result.source` (pwa.ts:241, messages.ts:63) sudah pakai ResponseSource → konsisten. |
| 2 | `createdAt: string` (ISO transport) | `ConversationMessage.createdAt: Date` (persist) | **OK** — Date persisten → serialize ISO pada transport. |
| 3 | plan sebut `messageId` di response Web | pwa.ts:240 **tidak ada** `messageId` | **kontrak butuh penambahan** (FASE 1 MUST); sumber `result.message.id` tersedia (`messages.ts:57`). |
| 4 | plan `?token=` compat option | — | **ditolak** — production Bearer‑only (lihat §6). |

---

## 16. Acceptance criteria FASE 0
- [x] `crypto.randomUUID` verified pada PM2 runtime (Node 24.19.0, pid 310048) — NO SOURCE CHANGE.
- [x] `StructuredMessage`, `MessageType`, `Sender` final (reuses `ConversationMessage`/`ResponseSource`).
- [x] `EventEnvelope`, `EventType` final (termasuk `device.status.changed` FASE 6).
- [x] room naming final (`store:{storeId}:…`).
- [x] Web auth (slug+uid) / Admin auth (Bearer via authMiddleware) final.
- [x] dedup contract (`conversation_history.id` = HTTP `messageId` = WS `id`).
- [x] read state (`Conversation.metadata` `webLastReadAt`/`adminLastReadAt`) — no migration.
- [x] typing contract (`POST /typing` + `typing.*`) final; AI tetap lokal.
- [x] tenant isolation rule final.
- [x] EventBus/Redis boundary final.
- [x] typecheck `tsc --noEmit` exit 0.
- [x] Engine/WA/schema **unchanged**; no migration; no install; no runtime WS/event.

**FASE 0 = SELAMAT.** Menunggu approval untuk FASE 1 (WebSocket foundation).
