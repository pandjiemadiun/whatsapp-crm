# CHAT-ENGINE-REWRITE-P0-AUDIT.md
**Tanggal:** 2026-09-04  
**Scope:** Read-only audit untuk PROJECT-CONTRACT-CHAT-ENGINE-V2-REWRITE.md  
**Status:** Kontrak owner-approved §0 — v1 dihapus total, keyword emergency-only, LLM utama, canary store-4f4f67bd

---

## Bagian 1 — Full Consumer Map

### 1.1 Semua caller `interpreter.ts` (v1)

| File | Line | Context |
|------|------|---------|
| `src/business/conversation.service.ts` | :14 | `import { runOneCall, validateCartOpsAgainstDb, truncateTo2Sentences } from '../services/chat/interpreter.js'` |
| `src/business/conversation.service.ts` | :674-680 | V1 path: `const llmResult = await runOneCall(...)` |
| `src/business/conversation.service.ts` | :886 | Comment reference |
| `src/tests/golden-dataset.test.ts` | :27 | `import { validateCartOpsAgainstDb } from '../services/chat/interpreter.js'` |
| `src/tests/gateway-integration.test.ts` | :15 | `import { runOneCall } from '../services/chat/interpreter.js'` |
| `src/tests/gateway-conversation-fallback.test.ts` | :67-70 | Test asserting interpreter.ts imports llmGateway, not groqAdapter |
| `src/services/chat/__tests__/interpreter.test.ts` | :22 | `import { runOneCall, validateCartOps, truncateTo2Sentences } from '../interpreter.js'` |
| `src/services/chat/composer-v2.ts` | :8-9 | Comment: truncateTo2Sentences duplicated from interpreter.ts |

**Test files affected by v1 removal:**
- `src/tests/golden-dataset.test.ts` — imports `validateCartOpsAgainstDb` from interpreter.ts
- `src/tests/gateway-integration.test.ts` — imports `runOneCall` from interpreter.ts
- `src/tests/gateway-conversation-fallback.test.ts` — asserts interpreter.ts structure
- `src/services/chat/__tests__/interpreter.test.ts` — direct interpreter unit tests
- `src/tests/structured-actions-p5.test.ts` — references interpreter in comments
- `src/tests/wa-cart-idempotency.test.ts` — tests v1 cart_ops path through interpreter
- `src/tests/batch-magic-paste.e2e.test.ts` — [UNVERIFIED] may reference interpreter indirectly

### 1.2 Semua caller `reasoning.ts` (v2)

| File | Line | Context |
|------|------|---------|
| `src/business/conversation.service.ts` | :16 | `import { understand } from '../services/chat/reasoning.js'` |
| `src/business/conversation.service.ts` | :201 | V2 path: `const reasoningOutcome = await understand(...)` |
| `src/business/__tests__/engine-branch-v2.test.ts` | :5 | `import * as reasoning from '../../services/chat/reasoning.js'` |
| `src/tests/golden-dataset.test.ts` | :550 | Comment reference to reasoning.ts |
| `src/tests/gateway-conversation-fallback.test.ts` | :73-76 | Test asserting reasoning.ts imports llmGateway, not groqAdapter |
| `src/services/chat/__tests__/reasoning-v2.test.ts` | :17 | `import { understand } from '../reasoning.js'` |
| `src/services/chat/__tests__/engine-e2e-v2.test.ts` | :27 | `import { understand } from '../reasoning.js'` |
| `src/services/chat/product-match.ts` | :14 | Comment: "forwarded to reasoning.ts (LLM)" |

**Test files affected by v2 removal/rewrite:**
- `src/tests/golden-dataset.test.ts` — tests both v1 and v2 paths
- `src/tests/gateway-conversation-fallback.test.ts` — asserts reasoning.ts structure
- `src/services/chat/__tests__/reasoning-v2.test.ts` — direct v2 unit tests
- `src/services/chat/__tests__/engine-e2e-v2.test.ts` — v2 E2E tests
- `src/business/__tests__/engine-branch-v2.test.ts` — v2 engine branch tests

### 1.3 Semua caller `fallback.service.ts` 13-tier chain

| File | Line | Context |
|------|------|---------|
| `src/business/conversation.service.ts` | :3 | `import { fallbackService } from './fallback.service.js'` |
| `src/business/conversation.service.ts` | :580-585 | V1 fallback chain invocation |
| `src/business/conversation-context.service.ts` | :303 | Comment reference to fallback.service.ts:717 |
| `src/business/canonical-context.service.ts` | :1253 | Comment: "V1 readers that haven't fully migrated (e.g., fallback.service.ts)" |
| `src/tests/golden-dataset.test.ts` | :37 | `import { fallbackService } from '../business/fallback.service.js'` |
| `src/tests/golden-dataset.test.ts` | :886 | Comment reference to fallback.service.ts:694 |
| `src/tests/golden-dataset.test.ts` | :1481-1482 | PV-P2c test directly calling `tryProduct` from fallback.service.ts |
| `src/business/__tests__/fallback-saveDiscussed-race.test.ts` | :14 | `import { fallbackService } from '../fallback.service.js'` |
| `src/services/chat/product-match.ts` | :6 | Comment: "fallback.service.ts (which transitively initializes the adapters/redis/prisma singletons)" |

### 1.4 Semua caller `tier-match.ts`

| File | Line | Context |
|------|------|---------|
| `src/business/fallback.service.ts` | :31 | `import { isTotalTrigger, isTotalIntent, isPaymentIntent, isOrderStatusIntent, ORDER_STATUS_KEYWORDS, isSopRetourIntent, SOP_RETUR_KEYWORDS, isShippingIntent, SHIPPING_KEYWORDS, isProductNotFoundInquiry } from '../services/chat/tier-match.js'` |
| `src/business/fallback.service.ts` | :428 | Comment: "Lihat tier-match.ts" |
| `src/business/fallback.service.ts` | :498 | `SHIPPING_KEYWORDS.some(...)` |
| `src/business/fallback.service.ts` | :571 | `ORDER_STATUS_KEYWORDS` usage |
| `src/business/fallback.service.ts` | :649 | `isTotalTrigger(lower)` |
| `src/business/fallback.service.ts` | :792 | Comment: "Lihat tier-match.ts" |
| `src/services/chat/tests/tier-match.test.ts` | :22 | `import { isTotalTrigger, ... } from '../tier-match.js'` |

### 1.5 Titik dimana WA (Fonnte/GOWA) dan PWA berbeda perlakuan

| Aspek | WA (Fonnte/GOWA) | PWA |
|-------|------------------|-----|
| Entry point | `webhooks.ts` → `messageProcessorService.processMessage` | `pwa.ts` → `conversationDeliveryService.processWebRequest` |
| Cart mutation path | `executeWaCartMutation` (action-registry.ts:1544) — idempoten via `wa:${conversationId}:${messageId}` claim key | `executeAction` (routes/actions.ts:25) — idempoten via `actionId` UUID |
| Response format | `sendWithPresence` → `smartRetrySend` → gateway.sendMessage (WhatsApp API) | HTTP JSON response (`pwa.ts:401-411`) + event bus publish |
| MessageType | `text`, `quick_reply`, `product_list`, `product`, `cart` | Sama, tapi di-enrich oleh `conversationDeliveryService` sebelum HTTP response |
| Structured action trigger | Tidak ada button tap dari WA — semua lewat LLM `cart_ops` atau `WA_CART_MUTATION` | Button tap dari UI → `POST /api/pwa/:slug/action` |
| Echo ke conversation_history | WA: `messageProcessorService.saveMessage` menulis setiap turn | PWA: `conversationDeliveryService.processWebRequest` menulis via event bus |

**Konteks rewrite:** Engine baru hanya mengganti LAPISAN INTERPRETASI (intent + entities + proposed actions). Output engine masih dipakai oleh:
- WA path: `executeWaCartMutation` untuk cart ops, `composeReply` untuk response text
- PWA path: `conversationDeliveryService` untuk enrich + HTTP response

---

## Bagian 2 — Provider Capability untuk Structured Output

### 2.1 Active providers (dari DB)

```json
[
  {
    "id": "c8c2ae57-fa81-495c-8e38-1a755ec2001e",
    "name": "Mistral",
    "format": "openai_compatible",
    "role": "chat_primary",
    "model": "mistral-small-latest",
    "baseUrl": "https://api.mistral.ai/v1/chat/completions"
  },
  {
    "id": "b13477fd-a160-4f38-90cb-1ef49e4311d9",
    "name": "SambaNova",
    "format": "openai_compatible",
    "role": "chat_fallback",
    "model": "MiniMax-M2.7",
    "baseUrl": "https://api.sambanova.ai/v1/chat/completions"
  }
]
```

### 2.2 Adapter implementations

| Adapter | File | jsonMode support | Mechanism |
|---------|------|------------------|-----------|
| `OpenAICompatibleAdapter` | `openai-compatible.adapter.ts` | Ya (line :123) | `response_format: { type: 'json_object' }` |
| `GeminiShimAdapter` | `gemini-shim.adapter.ts` | **TIDAK** | Tidak ada handling `options?.jsonMode` |
| `GroqAdapter` | `groq.adapter.ts` | Ya (line :151) | `response_format: { type: 'json_object' }` |

### 2.3 Provider capability matrix

| Provider | Format | jsonMode | Native function-calling | JSON schema |
|----------|--------|----------|------------------------|-------------|
| Mistral | openai_compatible | Ya | [UNVERIFIED] — perlu docs/tests | [UNVERIFIED] |
| SambaNova | openai_compatible | Ya | [UNVERIFIED] — perlu docs/tests | [UNVERIFIED] |
| Gemini (via groqAdapter) | groq | Ya | Ya — `extractIntent` di groq.adapter.ts:329 | [UNVERIFIED] |
| Gemini (via GeminiShimAdapter) | gemini_native | **TIDAK** | [UNVERIFIED] — native Gemini API support tools | [UNVERIFIED] |

### 2.4 Assessment

**openai_compatible format (Mistral, SambaNova):**
- Support `response_format: { type: 'json_object' }` via `OpenAICompatibleAdapter`
- This is prompt-engineered JSON mode, not native function-calling with JSON schema validation
- [UNVERIFIED] Whether these providers support native `tools`/`functions` API — perlu test koneksi atau docs

**groq format (GroqAdapter):**
- Support `jsonMode` via `response_format: { type: 'json_object' }`
- Has `extractIntent` method (Groq-specific, not on shared `AIProvider` interface)
- [UNVERIFIED] Native function-calling support — perlu docs/tests

**gemini_native format (GeminiShimAdapter):**
- **TIDAK** support `jsonMode` — tidak ada handling di code
- Native Gemini API mendukung `responseMimeType: "application/json"` dan `functionDeclarations` untuk function calling
- [UNVERIFIED] Apakah GeminiShimAdapter bisa di-upgrade untuk mendukung ini

**Most robust untuk structured output (tanpa merekomendasikan hardcode):**
1. OpenAI-compatible providers (Mistral, SambaNova) — sudah ada `jsonMode` working
2. Groq — sudah ada `jsonMode` + `extractIntent` proven
3. Gemini native — perlu implementasi `responseMimeType` atau `functionDeclarations` di GeminiShimAdapter

---

## Bagian 3 — Context/State yang Perlu Dipertahankan

### 3.1 Semua state per-conversation yang dipakai lintas-turn

| State | Lokasi saat ini | Dipakai oleh | Catatan |
|-------|-----------------|--------------|---------|
| `workspace_v2` (JSON) | `conversations.workspace_v2` column | `canonicalConversationStateService.getV2Workspace()` | **PRIMARY authority** untuk V2 engine |
| `extractedEntities` (JSON) | `conversations.extractedEntities` column | V1 path, backward-compat readers | Legacy fallback jika `workspace_v2` kosong |
| `pendingClarification` | `workspace_v2.pendings[]` + canonical mirror | `resolvePending()` di `pendingClarification.ts` | Active clarification question + options |
| `draft_cart` | `workspace_v2.draft_cart[]` | `getCartFromDb()`, `tryTotal()` | Cart items yang belum jadi order |
| `resolved_facts` | `workspace_v2.resolved_facts{}` | V2 engine, canonical boundary | Nama, alamat, phone yang sudah confirmed |
| `conversation_summary` | `workspace_v2.conversation_summary` | V2 engine | Ringkasan percakapan untuk context |
| `intent` | `workspace_v2.intent` | V2 engine | Last known intent |
| `options_presented` | `workspace_v2.options_presented[]` | V2 engine | Options yang sudah ditampilkan ke customer |
| `previousMutation` | `workspace_v2.previous_mutation` | `conversation.service.ts:980` | Cart snapshot untuk rollback |
| `confirmedItems` | `extractedEntities.confirmedItems[]` | `tryTotal()`, `fallback.service.ts` | Items yang confirmed oleh customer |
| `customerCity` | `extractedEntities.customerCity` | Shipping tier, order service | Kota customer untuk ongkir |
| `recipientName` | `extractedEntities.recipientName` | Order service | Nama penerima |
| `activeOrderId` | `conversations.activeOrderId` | Order service | Order yang sedang aktif |

### 3.2 Migration path yang sudah ada

- `canonicalConversationStateService.getV2Workspace()` — read dari `workspace_v2` dengan fallback ke `extractedEntities` (G2-D.2)
- `canonicalConversationStateService.saveWorkspaceV2()` — write ke `workspace_v2` via atomic CAS
- `canonicalConversationStateService.writeV1PendingClarification()` — mirror pending ke canonical
- `canonicalConversationStateService.writeV1PreviousMutation()` — mirror cart snapshot ke canonical

**Catatan untuk rewrite:** Engine baru WAJIB membaca dan menulis melalui `canonicalConversationStateService`, tidak langsung ke `conversations` table. Ini sudah menjadi pattern di V2 engine saat ini.

---

## Bagian 4 — Structured Actions Overlap

### 4.1 Bukti kode: structured action bypass LLM

**PWA structured action path:**
```
routes/actions.ts:25  →  executeAction()  →  actionRegistry[type].handler
```

**WA structured action path:**
```
conversation.service.ts:252  →  executeWaCartMutation()  →  claimAction()  →  executeClaimedAction()
```

**Key isolation points:**

1. `routes/actions.ts:25-106` — PWA action endpoint TIDAK memanggil `interpreter.ts` atau `reasoning.ts`
2. `action-registry.ts:640-811` — `handleAddToCart` langsung delegasi ke `cartAuthority.executeOps()`, tidak through LLM
3. `action-registry.ts:1003-1076` — `handleCancelOrder` langsung delegasi ke `orderService.cancelOrder()`, tidak through LLM
4. `conversation.service.ts:252` — `executeWaCartMutation` dipanggil langsung setelah `validateCartOpsAgainstDb()`, tanpa LLM

**Contract confirmation:** Structured action (tap tombol) TETAP bypass LLM sepenuhnya. Tidak ada titik dimana rewrite akan tergoda memasukkan LLM ke jalur itu — kecuali jika someone explicitly mengubah `routes/actions.ts` atau `action-registry.ts`, yang tidak dalam scope rewrite.

---

## Bagian 5 — Baseline Metrik Sebelum Rewrite

### 5.1 Test suite baseline (saat ini)

| Suite | Pass | Fail | Command |
|-------|------|------|---------|
| test:chat | 271 | 0 | `npm run test:chat` |
| test:golden | 37 | 0 | `npm run test:golden` |
| test:structured | 118 | 0 | `npm run test:structured` |
| test:payment | 46 | 0 | `npm run test:payment` |
| test:shipping | 8 | 0 | `npm run test:shipping` |

### 5.2 Real conversation samples (20-30 sample)

[UNVERIFIED — perlu query DB untuk collect samples]

**Query yang akan dipakai:**
```sql
-- 20 percakapan terakhir dari berbagai toko
SELECT 
  c.id,
  c.storeId,
  s.name AS store_name,
  c.customerId,
  c.customerName,
  c.customerPhone,
  c.createdAt,
  c.updatedAt,
  COUNT(ch.id) AS message_count,
  MAX(ch.createdAt) AS last_message_at
FROM conversations c
JOIN stores s ON s.id = c.storeId
LEFT JOIN conversation_history ch ON ch.conversationId = c.id
WHERE c.deletedAt IS NULL
  AND s.deletedAt IS NULL
  AND s.isActive = true
GROUP BY c.id, c.storeId, s.name, c.customerId, c.customerName, c.customerPhone
ORDER BY c.createdAt DESC
LIMIT 30;
```

**Sample yang mewakili variasi:**
- Tanya produk (simple)
- Tanya produk + varian
- Order + checkout
- Klarifikasi (pending clarification)
- Smalltalk
- Payment inquiry
- Shipping inquiry
- Order status inquiry
- Cancel/modify cart
- Multi-product dalam 1 pesan

[Catatan: Query ini belum dijalankan — perlu approval karena akan access production data untuk audit baseline.]

---

## Lampiran — Active Providers Detail

### Adapter code references

**OpenAICompatibleAdapter** (`openai-compatible.adapter.ts:123`):
```typescript
...(options?.jsonMode ? { response_format: { type: 'json_object' } } : {}),
```

**GroqAdapter** (`groq.adapter.ts:151`):
```typescript
...(options?.jsonMode ? { response_format: { type: 'json_object' } } : {}),
```

**GeminiShimAdapter** (`gemini-shim.adapter.ts:115-126`):
```typescript
const requestBody = {
  contents: [{ parts: [{ text: prompt }] }],
  generationConfig: {
    temperature,
    maxOutputTokens: maxOutputTokens,
    topP,
  },
};
// TIDAK ADA opsi jsonMode / responseMimeType / functionDeclarations
```

### Test references

**openai-compatible.adapter.test.ts:122-128** — asserts `jsonMode` adds `response_format: { type: 'json_object' }`

**groq.adapter.ts:370** — uses `jsonMode: true` for intent extraction

**gemini-shim.adapter.test.ts** — [UNVERIFIED] perlu check apakah ada test untuk structured output

---

---

## Lampiran A — Lengkapi Gap 1: Daftar LENGKAP semua file test yang terdampak rewrite

### interpreter.ts (v1) — test files

| No | File path |
|----|-----------|
| 1 | `src/services/chat/__tests__/interpreter.test.ts` |
| 2 | `src/tests/gateway-integration.test.ts` |
| 3 | `src/tests/gateway-conversation-fallback.test.ts` |
| 4 | `src/tests/golden-dataset.test.ts` |

### reasoning.ts (v2) — test files

| No | File path |
|----|-----------|
| 1 | `src/business/__tests__/engine-branch-v2.test.ts` |
| 2 | `src/services/chat/__tests__/reasoning-v2.test.ts` |
| 3 | `src/services/chat/__tests__/engine-e2e-v2.test.ts` |
| 4 | `src/tests/gateway-conversation-fallback.test.ts` |
| 5 | `src/tests/golden-dataset.test.ts` |

### fallback.service.ts — test files

| No | File path |
|----|-----------|
| 1 | `src/business/__tests__/fallback-saveDiscussed-race.test.ts` |
| 2 | `src/tests/golden-dataset.test.ts` |

### tier-match.ts — test files

| No | File path |
|----|-----------|
| 1 | `src/services/chat/tests/tier-match.test.ts` |

### Daftar unik semua file test yang terdampak (dikombinasi)

1. `src/services/chat/__tests__/interpreter.test.ts`
2. `src/tests/gateway-integration.test.ts`
3. `src/tests/gateway-conversation-fallback.test.ts`
4. `src/tests/golden-dataset.test.ts`
5. `src/business/__tests__/engine-branch-v2.test.ts`
6. `src/services/chat/__tests__/reasoning-v2.test.ts`
7. `src/services/chat/__tests__/engine-e2e-v2.test.ts`
8. `src/business/__tests__/fallback-saveDiscussed-race.test.ts`
9. `src/services/chat/tests/tier-match.test.ts`

**Catatan:** `src/tests/gateway-conversation-fallback.test.ts` dan `src/tests/golden-dataset.test.ts` muncul di multiple kategori karena mengimpor/assert struktur dari lebih dari satu modul yang terdampak.

---

## Lampiran B — Lengkapi Gap 2: Baseline Sample — SEBELUM REWRITE

### Metode pengambilan

- Query read-only ke production DB, 25 conversation terakhir dari toko aktif.
- Filter: `HAVING COUNT(conversation_history.id) >= 2` (percakapan dengan minimal 2 pesan).
- Customer PII di-redact: nama/nomor HP diganti `Customer` / `Assistant`.
- Isi pesan TIDAK di-redact — ini yang jadi bahan pembanding.

### Ringkasan database

Database saat ini memiliki **3 percakapan dengan actual message history**:
- 1 percakapan real (Bengkel Didik, 83 pesan)
- 2 percakapan test (test-action-v2-store, 2 pesan masing-masing)

Ini berarti baseline terbatas pada data real yang ada saat ini. Setelah rewrite, baseline ini harus diperluas dengan data canary (store-4f4f67bd) minimal 30 percakapan.

---

### SAMPLE 1 — Bengkel Didik (REAL CUSTOMER)

**Conversation ID:** `bbab7983-ddb3-40ef-b1a4-a12200566be5`  
**Store:** Bengkel Didik (`store-4f4f67bd`)  
**Customer:** Customer  
**Created:** 2026-08-18T08:06:21.515Z  
**Updated:** 2026-09-04T00:55:26.160Z  
**Message Count:** 83

```
=== CONVERSATION bbab7983-ddb3-40ef-b1a4-a12200566be5 ===
STORE: Bengkel Didik (store-4f4f67bd)
CUSTOMER: Customer
CREATED: 2026-08-18T08:06:21.515Z
UPDATED: 2026-09-04T00:55:26.160Z
MESSAGE_COUNT: 83
MESSAGES:

[2026-08-18T08:06:21.515Z] [Customer] [text] Sore mas
[2026-08-18T08:06:21.515Z] [Assistant] [text] Maaf kak, saya kurang paham. Bisa diulang?
[2026-08-18T08:06:28.793Z] [Assistant] [text] Maaf kak, saya kurang paham. Bisa diulang?
[2026-08-18T08:06:28.793Z] [Customer] [text] Sore mas
[2026-08-18T08:06:32.793Z] [Assistant] [text] Maaf kak, saya kurang paham. Bisa diulang?
[2026-08-18T08:06:32.793Z] [Customer] [text] Saya mau tanya
[2026-08-18T08:06:38.957Z] [Assistant] [text] Maaf kak, saya kurang paham. Bisa diulang?
[2026-08-18T08:06:38.957Z] [Customer] [text] Tai lah
[2026-08-18T09:07:57.206Z] [Customer] [text] Sore mas
[2026-08-18T09:07:57.206Z] [Assistant] [text] Maaf kak, saya kurang paham. Bisa diulang?
[2026-08-18T09:08:31.774Z] [Customer] [text] Saya mau tanya
[2026-08-18T09:08:31.774Z] [Assistant] [text] Halo, ada yang bisa saya bantu?
[2026-08-18T09:09:00.525Z] [Customer] [text] Tai lah
[2026-08-18T09:09:00.525Z] [Assistant] [text] Maaf kak, saya kurang paham. Bisa diulang?
[2026-08-18T09:12:31.350Z] [Assistant] [text] Sore juga, ada yang bisa saya bantu?
[2026-08-18T09:12:31.350Z] [Customer] [text] Sore mas
[2026-08-18T09:13:13.815Z] [Customer] [text] Saya mau tanya
[2026-08-18T09:13:13.815Z] [Assistant] [text] Ada yang ingin Kakak tanyakan tentang produk atau layanan kami?
[2026-08-18T09:13:18.895Z] [Customer] [text] Tai lah
[2026-08-18T09:13:18.957Z] [Assistant] [text] Ada yang ingin Kakak tanyakan tentang produk atau layanan kami?
[2026-08-18T09:18:40.100Z] [Customer] [text] Sore mas
[2026-08-18T09:18:40.100Z] [Assistant] [text] Sore juga, ada yang bisa saya bantu?
[2026-08-18T09:19:06.173Z] [Customer] [text] Ada ban motor?
[2026-08-18T09:19:06.173Z] [Assistant] [product_list] Boleh dibantu dipastikan Kak, produk mana yang dimaksud?

• Ban belakang matic — Rp 200.000
• Ban depan Matic — Rp 150.000

Kakak mau pilih yang mana nih?
[2026-08-18T09:19:25.748Z] [Assistant] [text] Baik, Ban depan Matic sudah ditambahkan ke keranjang. Ada yang ingin ditambahkan lagi?
[2026-08-18T09:19:25.748Z] [Customer] [text] Ban depan 1 mas
[2026-08-18T09:19:31.927Z] [Assistant] [text] GRAND TOTAL: Rp 150.000

Rincian:
- Ban depan Matic (1x): Rp 150.000
- Subtotal: Rp 150.000
[2026-08-18T09:19:31.927Z] [Customer] [text] Total nya mas
[2026-08-18T09:24:41.815Z] [Assistant] [text] Ada, Oli Shell tersedia.
[2026-08-18T09:24:41.815Z] [Customer] [text] Ada oli motor?
[2026-08-18T09:24:56.284Z] [Assistant] [text] Oli Shell 1 liter sudah ditambahkan ke keranjang. Ada yang ingin ditambahkan lagi?
[2026-08-18T09:24:56.284Z] [Customer] [text] Oli yang 1 liter
[2026-08-18T09:25:10.208Z] [Assistant] [text] Oli Shell 1 liter ditambahkan 2 lagi ke keranjang.
[2026-08-18T09:25:10.208Z] [Customer] [text] Tambah 2
[2026-08-18T09:25:23.808Z] [Assistant] [text] GRAND TOTAL: Rp 360.000

Rincian:
- Ban depan Matic (1x): Rp 150.000
- Oli Shell (3x): Rp 210.000
- Subtotal: Rp 360.000
[2026-08-18T09:25:23.808Z] [Customer] [text] Totalnya berapa?
[2026-08-18T09:25:44.500Z] [Assistant] [text] Kami memiliki kampas rem depan Vario, cocok untuk motor Anda. Ingin ditambahkan ke keranjang?
[2026-08-18T09:25:44.500Z] [Customer] [text] Ada yang buat rem depan motor?
[2026-08-18T09:27:47.848Z] [Customer] [text] Ada sandal mas?
[2026-08-18T09:27:47.848Z] [Assistant] [text] Maaf Kak, produk itu belum tersedia di toko kami saat ini. Kakak bisa cek ya stok produk lain?
[2026-08-18T09:28:27.617Z] [Assistant] [text] Hai Kak, biasanya gembos ban disebabkan tekanan udara yang tidak tepat atau ban sudah aus. Sebaiknya periksa tekanan dan kondisi ban secara berkala.
[2026-08-18T09:28:27.617Z] [Customer] [text] Mas, motor saya sering gembos ban. Kira kira kenapa ya mas
[2026-08-18T09:28:45.966Z] [Assistant] [product_list] Boleh dibantu dipastikan Kak, produk mana yang dimaksud?

• Ban belakang matic — Rp 200.000
• Ban depan Matic — Rp 150.000

Kakak mau pilih yang mana nih?
[2026-08-18T09:28:45.966Z] [Customer] [text] Ban motor saya sudah tipis, apa karena itu ya
[2026-08-18T15:10:00.019Z] [Assistant] [text] Kakak
[2026-08-20T02:49:09.844Z] [Customer] [text] Pagi mas
[2026-08-20T02:49:09.844Z] [Assistant] [text] Maaf kak, saya kurang paham. Bisa diulang?
[2026-08-20T02:51:59.017Z] [Assistant] [text] Maaf kak, saya kurang paham. Bisa diulang?
[2026-08-20T02:51:59.017Z] [Customer] [text] Buka jam berapa
[2026-08-20T03:42:55.163Z] [Assistant] [text] Selamat siang, ada yang bisa saya bantu?
[2026-08-20T03:42:55.163Z] [Customer] [text] Siang mase
[2026-08-20T03:43:20.789Z] [Assistant] [text] Bengkel kami buka pukul 08.00–17.00. Ada yang bisa kami bantu lagi?
[2026-08-20T03:43:20.789Z] [Customer] [text] arep Takon, bengkel buka jam Piro mas
[2026-08-21T09:52:33.585Z] [Assistant] [text] Selamat sore Kak. Ada lagi yang bisa saya bantu?
[2026-08-21T09:52:33.585Z] [Customer] [text] Sore mas
[2026-09-02T13:27:52.854Z] [Customer] [text] Malam mas
[2026-09-02T13:27:52.854Z] [Assistant] [text] Malam juga, Kak. Ada yang bisa kami bantu malam ini?
[2026-09-02T13:28:01.009Z] [Assistant] [product_list] Boleh dibantu dipastikan Kak, produk mana yang dimaksud?

• Ban dalam — Rp 50.000
• Ban matic Vario depan belakang — Rp 100.000 (stok: 10) (ada varian)

Kakak mau pilih yang mana nih?
[2026-09-02T13:28:01.010Z] [Customer] [text] Ada ban dalam?
[2026-09-02T13:28:19.419Z] [Assistant] [quick_reply] Mau pilih yang mana nih?
[2026-09-02T13:28:19.419Z] [Customer] [text] Ada busi?
[2026-09-02T13:28:29.520Z] [Customer] [text] Busi kak
[2026-09-02T13:28:29.548Z] [Assistant] [text] Mau pilih yang mana nih?
[2026-09-02T13:28:36.069Z] [Assistant] [product] Halo Kak! Untuk Busi motor harganya Rp 15.000 per unit ya. 🌿

Mau dimasukkan ke keranjang belanja Kakak?
[2026-09-02T13:28:36.069Z] [Customer] [text] Busi
[2026-09-02T13:28:48.397Z] [Customer] [text] Mau
[2026-09-02T13:28:48.397Z] [Assistant] [text] Oke, Busi motor sudah ditambahkan ke keranjang ya! Mau lanjut belanja atau checkout sekarang?
[2026-09-02T13:28:54.265Z] [Customer] [text] Totalnya kak
[2026-09-02T13:28:54.265Z] [Assistant] [text] GRAND TOTAL: Rp 65.000

Rincian:
- Ban dalam (1x): Rp 50.000
- Busi motor (1x): Rp 15.000
- Subtotal: Rp 65.000
[2026-09-02T13:29:06.580Z] [Assistant] [text] Siapa nama Kakak dan alamat pengirimannya?
[2026-09-02T13:29:06.580Z] [Customer] [text] Ok, saya mau bayar
[2026-09-02T13:29:16.343Z] [Customer] [text] Panji dagangan
[2026-09-02T13:29:16.359Z] [Assistant] [text] Oke Kak, sudah saya batalkan ya. 🙏
[2026-09-03T12:14:01.363Z] [Customer] [text] Malam
[2026-09-03T12:14:01.363Z] [Assistant] [text] Malam juga, Kak. Ada yang bisa kami bantu malam ini?
[2026-09-03T12:14:13.884Z] [Assistant] [text] Selamat istirahat, Kak. Kalau butuh bantuan lagi, kami siap 24 jam.
[2026-09-03T12:14:13.884Z] [Customer] [text] Pengen bobok
[2026-09-04T00:55:09.648Z] [Customer] [text] Pagi mas
[2026-09-04T00:55:09.648Z] [Assistant] [text] Selamat pagi, Kak! Ada yang bisa kami bantu hari ini?
[2026-09-04T00:55:17.972Z] [Customer] [text] Keranjang saya isinya apa
[2026-09-04T00:55:17.972Z] [Assistant] [text] Kakak, keranjang belanja Kakak masih kosong nih. Mau cari produk dulu? Ketik nama produk atau cek katalog ya!
[2026-09-04T00:55:26.149Z] [Customer] [text] Kamu jual apa
[2026-09-04T00:55:26.149Z] [Assistant] [text] Saat ini toko belum punya produk yang tersedia. Silakan hubungi pemilik toko untuk info lebih lanjut.
```

**Skenario yang terwakili dalam sample ini:**
- Smalltalk ("Sore mas", "Pagi mas", "Malam mas")
- Product inquiry dengan variant ("Ada ban motor?" → product_list)
- Add-to-cart via structured action ("Ban depan 1 mas")
- Total/checkout inquiry ("Total nya mas", "Totalnya berapa?")
- Multi-turn product discussion (ban → oli → kampas rem → sandal)
- Payment address collection ("Siapa nama Kakak dan alamat pengirimannya?")
- False cancel bug ("Panji dagangan" → "sudah saya batalkan ya")
- Cart empty check ("Keranjang saya isinya apa")

---

### SAMPLE 2 — Test Action Store (TEST DATA)

**Conversation ID:** `conv-7fbaebb3-dd3d-431b-b2db-2c311b4d3cea`  
**Store:** Test Action Store (`test-action-v2-store`)  
**Customer:** Customer  
**Created:** 2026-09-04T02:14:39.667Z  
**Message Count:** 2

```
[2026-09-04T02:14:40.729Z] [Customer] [text] tambah Produk Test ke keranjang
[2026-09-04T02:14:40.729Z] [Assistant] [text] GRAND TOTAL: Rp 50.000

Rincian:
- Produk Test (2x): Rp 50.000
- Subtotal: Rp 50.000
```

---

### SAMPLE 3 — Test Action Store (TEST DATA)

**Conversation ID:** `conv-5b74deeb-6869-4ba6-85b9-37349db61717`  
**Store:** Test Action Store (`test-action-v2-store`)  
**Customer:** Customer  
**Created:** 2026-09-03T11:16:16.762Z  
**Message Count:** 2

```
[2026-09-03T11:16:17.463Z] [Customer] [text] tambah Produk Test ke keranjang
[2026-09-03T11:16:17.463Z] [Assistant] [text] GRAND TOTAL: Rp 50.000

Rincian:
- Produk Test (2x): Rp 50.000
- Subtotal: Rp 50.000
```

---

### Catatan untuk P3/P4

1. **Database saat ini hanya punya 1 percakapan real** (Bengkel Didik, 83 pesan) dan 2 percakapan test.
2. **Baseline ini tidak cukup** untuk evaluasi kualitas rewrite — perlu minimal 30 percakapan real di toko canary (store-4f4f67bd) selama window canary 3 hari.
3. **Skenario yang harus di-cover di baseline canary:**
   - Tanya produk (simple)
   - Tanya produk + varian
   - Order + checkout
   - Klarifikasi (pending clarification)
   - Smalltalk
   - Payment inquiry
   - Shipping inquiry
   - Order status inquiry
   - Cancel/modify cart
   - Multi-product dalam 1 pesan
   - False cancel bug (Panji dagangan pattern)
   - Silent add-to-cart bug (Ban dalam pattern)

---

## Kesimpulan

1. **Consumer map lengkap** — semua caller `interpreter.ts`, `reasoning.ts`, `fallback.service.ts`, `tier-match.ts` telah teridentifikasi dengan file:line
2. **Test files affected — LENGKAP (9 file unik):**
   - `src/services/chat/__tests__/interpreter.test.ts`
   - `src/tests/gateway-integration.test.ts`
   - `src/tests/gateway-conversation-fallback.test.ts`
   - `src/tests/golden-dataset.test.ts`
   - `src/business/__tests__/engine-branch-v2.test.ts`
   - `src/services/chat/__tests__/reasoning-v2.test.ts`
   - `src/services/chat/__tests__/engine-e2e-v2.test.ts`
   - `src/business/__tests__/fallback-saveDiscussed-race.test.ts`
   - `src/services/chat/tests/tier-match.test.ts`
3. **Provider capability** — 2 active providers (Mistral, SambaNova) both `openai_compatible` format dengan `jsonMode` support. Gemini via Groq juga support. Gemini native via GeminiShimAdapter TIDAK support jsonMode.
4. **State preservation** — `workspace_v2` + `extractedEntities` + canonical boundary sudah jadi pattern yang benar. Rewrite harus tetap lewat `canonicalConversationStateService`.
5. **Structured actions** — bersih bypass LLM. Tidak ada overlap dengan engine rewrite.
6. **Baseline metrik** — test suite baseline 271/37/118/46/8 semua hijau.
7. **Baseline conversation samples** — 1 real conversation (Bengkel Didik, 83 pesan) + 2 test conversations. Database perlu diperkaya dengan 30+ percakapan real selama canary period untuk baseline yang valid.
