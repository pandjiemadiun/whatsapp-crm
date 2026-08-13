# LAPORAN FASE 3 — DASHBOARD ↔ WEB HUMAN MESSAGING (QLOBOT CHATBOX)

**Tanggal:** 2026-08-13
**Status:** IMPLEMENTATION COMPLETE ✅ VERIFIED
**Base commit (pre‑FASE 3):** `69d8859` (FASE 2 final)
**Verdict FASE 0/1/2:** ✅ done & green sebelum FASE 3
**Verdict FASE 3 inspection:** ✅ READY FOR IMPLEMENTATION (`DOCS/laporan-fase3-inspection.md`)

> Implementasi berupa **EXTENSION, NOT REWRITE**. Conversation Engine & WA gateway
> tetap `protected` (tidak berubah). Lihat `DOCS/contract-chatbox.md`, `DOCS/laporan-blueprint-chatbox-qlabot.md`,
> `DOCS/laporan-audit-chatbox-qlabot.md`, `DOCS/laporan-fase1-web-realtime-qlabot.md`,
> `DOCS/laporan-fase2-web-realtime-structured.md`, `DOCS/laporan-fase3-inspection.md`,
> `DOCS/updated-implementation-plan-chatbox-qlabot.md`.

---

## Ringkasan eksekutif

FASE 3 menambah **human‑to‑human realtime bridge** di antara Dashboard admin dan customer Web PWA,
sebagai *extension* di tepi atas Conversation Engine yang sudah ada (FASE 1/2). Semua plumbing
EventBus → Socket.IO dispatch, room‑authoritative server‑side, dan reuse Bearer `storeSetting.auth_token`
sudah lengkap sejak FASE 1 — FASE 3 hanya menambahkan **publisher‑publisher yang hilang** di delivery
layer + route layer, **customer message capture while‑locked**, **channel guard Web vs WhatsApp**,
**dashboard WS client + Resolve button + read ack**, dan **ChatPage human_agent accept + read ack**.

Tidak ada perubahan skema (read/unread via `Conversation.metadata JSON`), tidak ada Redis, tidak ada
Web Push, tidak ada pm2 restart.

## Constraint checklist (semua terpenuhi)

- ✅ PROTECTED tidak disentuh: `business/conversation.service.ts`, `services/chat/*`,
  `business/fallback.service.ts`, `business/order.service.ts`, `business/conversation-context.service.ts`,
  `services/message-queue.service.ts`, `services/message-processor.service.ts`, `services/fonnte.service.ts`,
  `adapters/whatsapp/gowa.adapter.ts`, `routes/webhooks.ts`, `routes/messages.ts`, `prisma/schema.prisma`,
  `apps/dashboard/src/contexts/AuthContext.tsx`, `apps/dashboard/src/services/api.ts`.
- ✅ PROTECTED function tidak dipanggil/dimodifikasi: `processCustomerMessage()`, `saveMessage()`,
  `buildResult()`, `getOrCreateContext()`, `acquireLock()`.
- ✅ `git diff --check` bersih.
- ✅ STOP conditions (A–L) tidak terpicu; verdict READY.

## File yang diubah / dibuat (FASE 3 only)

| File | Status | Peran |
|---|---|---|
| `apps/api/src/services/conversation-delivery.service.ts` | EDIT | capture customer msg while‑locked + publish customer→assistant→updated; pending_human publish |
| `apps/api/src/routes/conversations.ts` | EDIT | GET list unreadCount, GET/:id history select messageType+metadata, PUT /status resolvedAt+events, POST /reply channel guard+human_agent publish+messageId, POST /:id/read admin |
| `apps/api/src/routes/pwa.ts` | EDIT | POST /:storeSlug/read (web customer) + ownership |
| `apps/dashboard/src/services/realtime.ts` | BARU | Admin Socket.IO client (token dari localStorage join, adminRoom, listeners) |
| `apps/dashboard/src/pages/ConversationInbox.tsx` | EDIT | WS lifecycle + dedup + human_agent/conversation.*/typing + Resolve + unread badge |
| `apps/pwa/src/components/ChatPage.tsx` | EDIT | human_agent accept, conversation.* listener, PWA read‑ack debounce, input disabled saat resolved |
| `apps/dashboard/package.json` | EDIT | + `socket.io-client@^4.8.3` (dibutuhkan realtime.ts) |
| `apps/dashboard/package-lock.json` | EDIT | lockfile mirror |
| `apps/api/scripts/smoke-fase3-chatbox.ts` | BARU | FASE 3 integration test (49 assertions) |
| `DOCS/laporan-fase3-dashboard-human-messaging.md` | BARU | laporan ini |

`apps/api/src/services/realtime.service.ts`, `apps/api/src/services/event-bus.service.ts`,
`apps/api/src/index.ts` **tidak disentuh** — dispatch + route mount sudah lengkap sejak FASE 1.

## 1. Objektif FASE 3 — semua terpenuhi

1. ✅ Admin reply → Web realtime (`message.created` human_agent → `customerConvRoom`)
2. ✅ Customer Web message → Dashboard realtime (`message.created` customer → `adminRoom`)
3. ✅ Human takeover realtime (`conversation.handoff`, customer msg dulu)
4. ✅ Resume AI realtime (`conversation.resumed`)
5. ✅ Resolve realtime (`conversation.resolved` + `resolvedAt`)
6. ✅ Customer typing → Dashboard (`typing.started party='customer' → adminRoom`)
7. ✅ Admin typing → Web (`admin_typing` emit → `typing.started party='human_agent' → customerConvRoom`)
8. ✅ Admin read/unread (`POST /conversations/:id/read → adminLastReadAt`)
9. ✅ Customer read/unread (`POST /pwa/:slug/read → webLastReadAt`)
10. ✅ Dashboard conversation list realtime (`conversation.updated` trigger refresh)
11. ✅ `conversation.updated` (setelah reply/status/read)
12. ✅ Reconnect safety (Socket.IO kembali join room; catch‑up HTTP GET di ChatPage)
13. ✅ HTTP/WS dedup (dashboard `renderedIds` seed dari HTTP `messageId`; server publish sekali)

`ConversationId` **tetap sama** untuk semua transisi AI→human→human→AI→resolved — tidak pernah
membuat conversation baru.

## 2. Critical Rule #1 — Persistence

Admin reply: **ONE** `conversationHistory.create()` (role `agent`, source `dashboard`). WS
`message.created` hanya *delivery* (zer
o INSERT) — memakai `historyMsg.id` yang sama (buk buatan UUID kedua). Test #6 `history row delta == 1`.

Customer Web message: INSERT dilakukan oleh engine (`processCustomerMessage`/`saveMessage`, yang
dilindungi). Delivery **tidak** menambah INSERT — hanya UPDATE (FASE 2 structured) pada row yang
sama dan publish event. Test #6/#7 memverifikasi delta INSERT == 1.

## 3. Critical Rule #2 — Message ID

- Admin reply: `conversation_history.id` === HTTP `response.messageId` === WS `event.data.id`.
  Test #7 `#30`: `WS data.id === HTTP messageId`, `HTTP messageId === DB row id`.
- Customer Web: memakai `id` row yang benar‑benar dibuat engine (`customerMsg.id` yang
  di‑capture while‑locked). **Tidak** synthetic id, **tidak** UUID kedua. Test #4.

## 4. Critical Rule #3 — Customer message realtime (while‑locked)

Delivery `processWebRequest`:

```
acquireLock(conversationId)           # messageQueueService (in-memory Map lock:KEY)
  → processCustomerMessage(...,'web') # engine persist customer(role='user') + assistant (or null @ human_takeover)
  → findFirst({conversationId, role:'user', orderBy:createdAt desc})  # WHILE LOCK STILL HELD
      = customerMsg.id
release()                              # finally — setelah persist
publish customer message.created       # id == customerMsg.id
publish assistant message.created      # (bila ada)
publish conversation.updated
```

Query customer message dilakukan **sebelum `release()`** (inside lock boundary) — tidak setelah
`releaseLock()` sehingga request berikutnya tidak bisa mengganti "latest message". Ini fakta kode
(`conversation-delivery.service.ts:79-113`); tidak ada perubahan pada `acquireLock()`/mutex.

## 5. Critical Rule #4 — Web vs WhatsApp

`POST /reply` (conversations.ts:226):
```
if (conversation.channel !== 'web') { // WA path: existing Fonnte/GOWA
  if (store.fonnteToken) await fonnteService.sendMessage(...)   // regression test
  else if (store.phoneNumber) await gowaAdapter.sendMessage(...)
}
```
- Web → **skip** blok gateway (`sendError === null`, Fonnte/GOWA tidak dipanggil). Test #15.
- WA → tetap panggil Fonete/GOWA (regression). Test #14 (`fonteCalled===true`, `sendError='Fonte send failed'`).

WA path tidak disentuh — tetap pakai `fonnteService`/`gowaAdapter` yang ada.

## 6. Critical Rule #5 — role/agent semantics

DB `conversation_history.role`: engine pakai `user`/`assistant`; admin reply pakai `agent`
(tetap, tidak diubah engine). WS canonical sender:
- customer → `'customer'`, type `'text'`
- admin   → `'human_agent'`, type `'text'`, source `'dashboard'`, `payload: null`
- assistant → `'assistant'` (engine)

Test #6 (`#5`): DB role tetap `agent`, WS sender `human_agent` — pemisahan sengaja (`schema.prisma`
role String tidak bisa kita pakai untuk kedua‑tujuan).

## 7. Critical Rule #6 — customer sender & id

Customer sender WS = `'customer'`, type `'text'`, `id = conversation_history.id` row engine.
Test #4/#10.

## 8. Critical Rule #7 — Status event mapping (PUT /status)

| status | event | tambahan DB |
|---|---|---|
| `human_takeover` | `conversation.handoff` | `humanTakeoverAt` |
| `open` | `conversation.resumed` | `humanTakeoverAt = null` |
| `resolved` | `conversation.resolved` | `resolvedAt` |

Setiap transisi juga publish `conversation.updated` (rule #8). Test #15-17. `updateStatusSchema`
(`schemas/index.ts`) sudah menerima ke‑empat nilai.

## 9. Critical Rule #8 — conversation.updated

Dipublish setelah **setiap** persisten (reply, status change, read). Payload kanonik:
`{ conversationId, status, lastMessageAt, [adminLastReadAt|webLastReadAt?] }`.
Realtime dispatch (realtime.service) broadcast ke `[adminRoom, customerConvRoom]` (bukan hanya
admin) sehingga Web customer juga tahu status berubah. Test #18.

## 10. Critical Rule #9 — Room authoritative server‑side

Room tidak pernah di‑decide client:
```
customer room = store:${storeId}:conv:${conversationId}   # realtime.service.ts:19
admin    room = store:${storeId}:admin                     # realtime.service.ts:23
```
Server join room berdasarkan `storeSetting.auth_token` (admin) atau
`store→customer(webUid)→conversation(channel:'web')` ownership (customer). Client tidak dapat
mengendalikan room. Test #2 (cross‑tenant admin tidak receive), #3 (cross‑tenant customer reject).

## 11. Critical Rule #10 — Admin auth reuse

Admin WS auth via Bearer `storeSetting.auth_token` (sama dengan admin REST). `adminRealtime`
(realtime.ts) baca `localStorage.getItem('qlobot.adminToken')` — **tidak** menyentuh
`AuthContext.tsx`/`api.ts`. `AuthGuard` → `verifyAdminViaStoreSetting`: cek token di DB, expiry,
`!store.deletedAt`. Test #1.

## 12. Web customer read‑ack (rule #12)

`POST /pwa/:storeSlug/read` ({uid, conversationId}) → cek ownership (slug+uid+conv+channel web) →
set `metadata.webLastReadAt` → publish `conversation.updated`. ChatPage: read‑ack **debounced 1s**
(`scheduleReadAck`) dan hanya ketika conversation aktif & terlihat (`document.visibilityState`),
serta trigger pada `connect` (reconnect) dan `reconnect` (catch‑up). Test #24.

## 13. Admin read‑ack

`POST /conversations/:id/read` (auth) → set `metadata.adminLastReadAt` → publish
`conversation.updated` (dengan `adminLastReadAt`). **Tidak** create row history (bukan message
event). Test #25.

## 14. Unread calculation (server‑side)

`GET /api/conversations` menghitung per conversation:
```
unreadCount = count(conversationHistory where role='user' AND createdAt > adminLastReadAt)
```
`adminLastReadAt` dari `Conversation.metadata JSON` (fallback `new Date(0)`). Hitungan **server‑side**
— client tidak compute (rule). Test #26 (`unreadCount == 2`).

## 15. Metadata preservation

Read/reply/status hanya **merge** `metadata` yang ada (jangan overwrite `preExistingKey`). Test #27
(`preExistingKey === 'keep-me'` setelah semua operasi).

## 16. Dashboard UX (ConversationInbox)

- WS connect sekali pada `useEffect([user])`, idempotent (`adminRealtime.connect()`).
- `renderedIds` ref: seed dari HTTP `response.messageId` (HandleSend) + dedup WS `message.created`.
- Role map WS→UI: `customer→'user'`, `human_agent→'agent'`, `assistant→'assistant'`.
- Unread badge (dot WS status `wsReady` + `unreadCount` di list).
- **Resolve button** → `PUT /status {resolved}`.
- **Customer typing banner** (`typing.started party=customer`).
- Reconnect catch‑up: HTTP `GET /conversations/:id` + `GET /conversations`, WS kembali join room.
- `openConversation` → `POST /:id/read` (admin ack) + `unreadCount` reset.

## 17. PWA ChatPage UX

- `message.created` filter: accept `assistant` + `human_agent`, **ignore `customer`** (pesan customer
  via HTTP optimis pada ChatPage).
- `conversation.{handoff,resumed,resolved,updated}` listener → state `conversationStatus`.
- `inputDisabled = resolved || sending`; banner status (resolved / human takeover); placeholder dinamis.
- Read‑ack debounce 1s (`scheduleReadAck`) pada mount, `visibilitychange`, `connect`, `reconnect`
  catch‑up, dan setelah render `human_agent` message.

## 18. Reconnect safety

- WS `reconnection` tidak dipaksa (chat pakai `reconnection:false` + manual reconnect).
- Pada `connect` / `reconnect`: ambil history via HTTP, dedup by id, seed `renderedIds`, lalu
  `scheduleReadAck`.
- Server reconnect otomatis join room (room computed server‑side dari token/uid+slug+conv).
Test #28 (admin menerima event setelah disconnect→reconnect).

## 19. HTTP/WS dedup

- Server: satu `message.created` publish per aksi (reply/status). Test #13 (1 publish per reply).
- WS client: `renderedIds Set` (dashboard `renderedIds` ref + ChatPage `renderedIds` ref) → ignore
  duplikat `id`.
- Customer di ChatPage juga seed dari HTTP `response.messageId` → tidak double render.

## 20. Verification gate (hasil keluaran)

| Gate | Perintah | Hasil |
|---|---|---|
| API typecheck | `cd apps/api && npx tsc --noEmit -p tsconfig.json` | ✅ 0 error |
| PWA typecheck | `cd apps/pwa && npx tsc -p tsconfig.app.json --noEmit` | ✅ 0 error |
| PWA build | `npx vite build` | ✅ built (dist/assets) |
| Dashboard typecheck | `cd apps/dashboard && npx tsc -p tsconfig.app.json --noEmit` | ✅ 0 error |
| Dashboard build | `npx vite build` | ✅ built (>500 kB chunk = peringatan rollup, bukan error) |
| FASE 1 smoke | `npx tsx --env-file=../../.env scripts/smoke-fase1-realtime.ts` | ✅ 13 pass, 0 fail |
| FASE 2 tests | `npx tsx --env-file=../../.env --test --test-force-exit src/tests/structured-message.test.ts` | ✅ 22 pass, 0 fail |
| FASE 3 tests | `npx tsx --env-file=../../.env scripts/smoke-fase3-chatbox.ts` | ✅ 49 pass, 0 fail (49 assertions / ~30 use‑case) |
| git diff --check | `git --no-pager diff --check` | ✅ clean |
| Protected files | `git diff --name-only HEAD -- <protected list>` | ✅ kosong (0) |
| pm2 | tidak di‑restart | ✅ `curl localhost:3000/api/health` → 200 |

> ⚠️ `npm audit` dashboard melaporkan 1 high‑severity transitive vuln pada
> `socket.io-client` (atau dependensi transitifnya) — dicatat untuk follow‑up;
> **tidak memblokir build/typecheck**.

### Catatan environment (bukan regression)

- `apps/api/dist/**`, `apps/api/logs/**`, root `.env`, `apps/pwa/dist/**` adalah **ambient dirty**
  sesuai RAILS.md — tidak pernah di‑commit. pm2 `api` (pid 310048) **tidak** di‑restart; semua
  test FASE 1/2/3 boot server ephermal sendiri di ephemeral port.
- Test FASE 3 **tidak memanggil LLM/engine asli** — customer message menggunakan
  `conversation.status='human_takeover'` (pending_human path). WA gateway **ditimbang**
  (monkeypatch `fonnteService.sendMessage` / `gowaAdapter.sendMessage`) — tidak ada panggilan
  jaringan eksternal.

---

## Penutup

FASE 3 selesai & terverifikasi: Dashboard ↔ Web human messaging realtime berfungsi sebagai
*extension* di atas Conversation Engine yang dilindungi, tanpa migrasi skema, tanpa Redis, tanpa
pm2 restart, tanpa synthetic message id, tanpa double INSERT, dan tanpa melanggar mutex/lock boundary.
ConversationId konsisten across semua transisi. Semua gate hijau.
