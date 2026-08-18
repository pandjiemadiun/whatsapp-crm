# QloBot Baseline Audit — Source-of-Truth Only
Generated: 2026-08-17 | Author: Kilo (forensic read-only audit)
Semua klaim berbasis file:line atau command output verbatim. Dokumen .md lama tidak dianggap sebagai sumber kebenaran.

---

## 1. STRUKTUR REPO

```
apps/
  api/        — Express API (TypeScript, tsx, Prisma/Postgres)
  pwa/        — React PWA (Vite, React 19, Socket.IO client)
  dashboard/  — React Dashboard (Vite, React 19, Playwright e2e)
```

**package.json tiap app:**
- `apps/api/package.json`: name `garuda-api`, main `src/index.ts`, scripts utama: `dev` (tsx watch), `build` (tsc), `start` (node dist/index.js), `test:chat` (jest), `test:golden` (node:test).
- `apps/pwa/package.json`: name `pwa` (private), scripts utama: `dev` (vite), `build` (tsc -b && vite build).
- `apps/dashboard/package.json`: name `dashboard` (private), scripts utama: `dev` (vite), `build` (tsc -b && vite build), `test:e2e` (playwright).

**Workspace/monorepo tool:** TIDAK ADA. Root `package.json` hanya berisi `devDependencies: { "@playwright/test" }`, tidak ada field `workspaces`, tidak ada `turbo.json`, `lerna.json`, `pnpm-workspace.yaml`, atau `nx.json`.

---

## 2. ENTRY POINT & FLOW UTAMA

**API entry:** `apps/api/src/index.ts` — `const PORT = process.env.PORT || 3000` (:71), `httpServer.listen(PORT, ...)` (:191).

**Flow WA (pesan masuk → balasan keluar):**
```
POST /api/webhooks/gowa|fonnte
  → routes/webhooks.ts (handlers :55, :131)
  → messageProcessorService.processMessage() (:96)
    → dedup, dead-end, priority, coalescing, mutex, circuit-breaker
    → conversationService.processCustomerMessage() (:62)
      → engine branch:
        v1 (default): fallbackService.getResponse() [0 LLM] → interpreter.runOneCall() [1 LLM, :88] → cart ops → saveMessage
        v2 (Redis flag): understand() [1 LLM, reasoning.ts :115] → cart ops → saveMessage
    → sendWithPresence() → smartRetrySend() → gateway.sendMessage()
```

**Flow Web (PWA → API → balasan):**
```
ChatPage.tsx onSend()
  → POST /api/pwa/:storeSlug/message (routes/pwa.ts :275)
  → conversationDeliveryService.processWebRequest() (services/conversation-delivery.service.ts)
    → acquireLock (1x) → conversationService.processCustomerMessage() (:62)
      → engine v1/v2 (sama seperti WA)
    → release lock → mapStructured() → UPDATE conversation_history same row
    → eventBus.publish(message.created, conversation.updated)
  → HTTP JSON response → ChatPage renders bubble
```

---

## 3. AUTHORITY PER DOMAIN

**Cart:** `apps/api/src/business/cart-authority.ts` (class `CartAuthority`).
- SATU-SATUNYA active writer ke `OrderItem` rows + `Order.items` JSON + `Order.totalPrice`.
- Diimpor dan dipakai oleh: `order.service.ts:13` (checkout), `action-registry.ts:8` (executeAction), `conversation.service.ts` (executeCartOps).
- Metode legacy `order.service.ts` `addConfirmedItemToOrder` (:42) dan `syncCartStateToDraftOrder` (:114) tidak memiliki pemanggil aktif (dead code, bukan dual-write).

**Order:** `apps/api/src/business/order.service.ts` + `order-transition.ts`.
- `order.service.ts` Create/Update `Order` (create :55, :134, :304; update :89, :149, :389, :435).
- Transisi status didelegasikan ke `transitionOrder()` di `order-transition.ts` (dipanggil dari `cartAuthority.checkout`).
- `fallback.service.ts:1091` melakukan `prisma.order.updateMany` untuk append notes (tambahan, bukan status machine).

**Conversation state/context:** DUAL-WRITE aktual.
- `conversation-context.service.ts` menulis `lastMessages`, `sessionExpireAt`, `extractedEntities` ke tabel `conversation_context` (upsert :40, update :146, :170, :186, delete :297).
- `canonical-context.service.ts` menulis `workspace_v2` + canonical fields ke tabel yang SAMA (updateMany :949, :1390).
- Bukti dual-write dalam 1 request path: `conversation.service.ts` `storePreviousMutation()` (:946-970) memanggil `canonicalConversationStateService.writeV1PreviousMutation()` (primary) lalu `conversationContextService.atomicCasExtractedEntities()` (mirror) secara berurutan. Di path v2, `saveWorkspaceV2()` (:249, :340) lalu `appendMessage()` (:~750) keduanya menulis row yang sama.

**Product/catalog:** `apps/api/src/business/product.service.ts`.
- SATU-SATUNYA business authority (listActiveProducts :57, create :242, update :300, create/update via magic paste :604).
- Namun `routes/store-products.ts` melakukan direct `prisma.product.update` untuk image mutation (upload :271, delete :307), BYPASS `productService`. Ini adalah secondary writer untuk kolom `images`/`primaryImageUrl`.

---

## 4. AI/LLM PIPELINE

**Provider aktif:**
- Primary: Gemini (`gemini-2.0-flash`)
- Fallback: Groq (`openai/gpt-oss-120b`)
- Konfigurasi: `apps/api/src/adapters/ai/ai-config.ts` (FALLBACKS constant :10, :13, :14) + `configService` membaca dari DB (`ai.model.primary`, `ai.model.fallback`).
- Gateway: `apps/api/src/adapters/ai/llm-gateway.ts` — konstruktor :52 menerima `primary=geminiAdapter`, `fallback=groqAdapter`, `gatekeeper=groqAdapter`.

**Titik pemanggilan LLM per pesan masuk (hot path):**
- `apps/api/src/services/chat/interpreter.ts:88` — jalur v1 (Stage 4, SATU call).
- `apps/api/src/services/chat/reasoning.ts:115` — jalur v2 (fungsi `callLlm`, SATU call per attempt, `TRANSPORT_MAX_RETRIES=1` :47).
- Non-per-message: `product.service.ts:791` (magic paste), `learning.service.ts:142` (background), `scheduleFollowUps.ts:279` (background).

Maksimal 1 LLM call berhasil per pesan masuk. Dua call site di hot path tergantung engine aktif (v1 default via Redis `getStoreEngine` `engine-config.ts`, fallback `'v1'`).

---

## 5. STRUCTURED ACTIONS

**ADA.**

**Route:** `POST /api/pwa/:storeSlug/action` (`apps/api/src/routes/actions.ts` :22).
**Registry:** `apps/api/src/business/action-registry.ts` — mendefinisikan schema dan handler untuk:
- `ADD_TO_CART` (:36)
- `SHOW_RELATED_PRODUCTS` (:74)
- `OPEN_CATALOG` (:103)
- `OPEN_CART` (:130)
- `OPEN_ORDER_HISTORY` (:162)

**Dipanggil dari PWA nyata:** Ya. `apps/pwa/src/components/ChatPage.tsx` memanggil endpoint action via `api.post('/pwa/${slug}/action', ...)`.

---

## 6. CHANNEL & IDENTITY

**WA vs Web di kode:**
- Field `Conversation.channel` (schema.prisma :147) — `'whatsapp'` (default) atau `'web'`.
- WA: `Customer.phone` unik per `storeId+phone` (:411), `Conversation.customerPhone` diisi nomor telepon.
- Web: `Customer.webUid` unik per `storeId+webUid` (:398), `Conversation.customerPhone` diisi `null`.

**Skema Customer (field penting):**
```
model Customer {
  id            String   @id @default(uuid())
  storeId       String
  phone         String?
  webUid        String?  @unique
  pushSubscription Json?
  name          String?
  nameSource    String?  // 'self_stated' | 'pushname'
  visitCount    Int      @default(0)
  firstSeenAt   DateTime @default(now())
  lastSeenAt    DateTime @default(now())
  notes         String?
  deletedAt     DateTime?
  store         Store    @relation(...)
  @@unique([storeId, phone])
  @@index([storeId])
  @@map("customers")
}
```

**Skema Conversation (field penting):**
```
model Conversation {
  id                    String   @id @default(uuid())
  storeId               String
  customerId            String
  customerName          String?
  customerPhone         String?
  status                String   @default("open")
  channel               String   @default("whatsapp")
  lastMessageAt         DateTime?
  aiResponseCount       Int      @default(0)
  faqResponseCount      Int      @default(0)
  humanTakeoverAt       DateTime?
  humanAgentId          String?
  resolvedAt            DateTime?
  notes                 String?
  metadata              Json?
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
  deletedAt             DateTime?
  store                 Store    @relation(...)
  history               ConversationHistory[]
  context               ConversationContext?
  orders                Order[]
  @@index([storeId])
  @@index([customerId])
  @@index([status])
  @@map("conversations")
}
```

---

## 7. TEST & CI

**Test runner yang benar-benar jalan:**
- `npm run test:chat` — Jest (`node --experimental-vm-modules ./node_modules/.bin/jest --config jest.config.cjs`).
- `npm run test:golden` — Node.js `node:test` (`tsx --env-file=../../.env --test --test-force-exit src/tests/golden-dataset.test.ts`).

**Command satu-satunya yang valid untuk verifikasi:**
`cd apps/api && npm run test:golden`
— 17 test case, toleransi 0 (CI mensyaratkan 17/17 hijau). File: `apps/api/src/tests/golden-dataset.test.ts` (grep `^test(` menghasilkan 17 buah).

`test:chat` memiliki baseline toleransi 2 failed suites / 1 failed test pre-existing (berdasarkan `.github/workflows/test.yml`), bukan gate ketat.

---

## 8. GIT STATE

```
$ git log --oneline -15
ebc704f G2-E.3.3: add visual report (CartSummary receipt)
2d186d3 G2-E.3.3: CartSummary visual -> mockup receipt structure
e57bbab docs(G2-E.3.2): finalize §16 audit
9787f79 G2-E.3.2: multi-tenant data integrity, cart authority, menu/avatar corrections
9a6bfc1 fix(pwa): resolve 5 critical chat UI bugs
29293ce feat(chatbox): FASE 4 web push notification
12fd702 fix(chatbox): complete FASE 3 admin typing
5090b2f docs(fase3): re-verification report
4bd59d8 docs(fase3): record FASE 3 commit hash & stat in report
467ecef feat(chatbox): FASE 3 dashboard human messaging
69d8859 feat(chatbox): FASE 2 structured payload
a1c0f7 feat(chatbox): FASE 2 structured message mapping
8e75e37 feat(chatbox): FASE 1 Web realtime foundation
74dd0f4 fix(PWA.20): baca response envelope {success,data:{store|history}}
```

**Branch aktif:** `main` (ahead of `origin/main` by 36 commits).

**Working tree:** kotor — banyak `modified` (termasuk `apps/api/src/` dan `apps/pwa/src/`) dan `untracked` (termasuk `apps/api/src/business/action-registry.ts`, `apps/api/src/routes/actions.ts`, migration baru, benchmark, tests baru).

---

## KONTRADIKSI DENGAN DOKUMEN LAMA

Dokumen `RAILS.md` dan `STATUS-V2.md` (tanggal Aug 11) ada di repo root. Berdasarkan timestamp git dan source code:
- Source code telah berubah signifikan setelah Aug 11 (mis. penambahan `action-registry.ts`, `routes/actions.ts`, dual-write canonical-context, engine v2 branch).
- Klaim di dokumen .md lama TIDAK dipertimbangkan sebagai sumber kebenaran untuk baseline ini.
- Sumber tunggal kebenaran: `schema.prisma`, `apps/api/src/`, `apps/pwa/src/`, output git.

---

## KLASIFIKASI DOKUMEN DI DOCS/

| Dokumen | Tanggal | Relevan untuk baseline |
|---|---|---|
| `DOCS/G2-A-baseline-report.md` | Aug 14 | Obsolete — audit lama, tidak mencerminkan source terbaru (action-registry, v2 engine, dual-write canonical) |
| `DOCS/G2-E.3.2-AUDIT.md` | Aug 15 | Obsolete — hanya berlaku untuk milestone spesifik |
| `DOCS/G2-E.3.3-CARTSUMMARY.md` | Aug 15 | Obsolete — milestone spesifik |
| Semua `laporan-*.md` di `DOCS/` | Aug 14 | Obsolete — laporan fase/task historis |
| `RAILS.md` (root) | Aug 11 | TIDAK RELEVAN — eksplisit diabaikan per instruksi |
| `STATUS-V2.md` (root) | Aug 11 | TIDAK RELEVAN — eksplisit diabaikan per instruksi |

**Hanya source code (`.ts`, `.prisma`, `.json` schema, git state) yang dianggap valid untuk baseline ini.**
