# CHAT-ENGINE-V2-DESIGN-P1.md
**Tanggal:** 2026-09-04  
**Status:** DRAFT — untuk owner review, BUKAN otorisasi implementasi.  
**Scope:** Desain schema LLM output + prompt untuk chat engine rewrite (PROJECT-CONTRACT-CHAT-ENGINE-V2-REWRITE.md).  
**Basis:** P0 audit (CHAT-ENGINE-REWRITE-P0-AUDIT.md), RAILS.md §2/§6, kontrak §0 yang owner-approved.

---

## Ringkasan 3-5 Keputusan Utama

1. **SATU panggilan LLM per pesan** — combined call producing structured intent/entities/actions DAN natural reply text dalam satu JSON. Tidak di-split menjadi 2 call. Alasan: contract §0.4 menyatakan token cost bukan constraint, dan split architecture memperkenalkan risiko inconsistency antara intent classification dan reply generation. Single call memastikan intent dan reply adalah from the same reasoning pass.
2. **JSON schema versioned (`v1`)** — output LLM dibungkus dalam schema yang jelas, dengan field `reply_text` untuk natural response. Field `reply_text` WAJIB diisi untuk setiap response (kecuali escalation/handoff). Ini memastikan naturalness tidak dikorbankan untuk structuredness.
3. **Context assembly: sliding window (10 turn terakhir) + workspace_v2 state injection** — bukan full history, bukan hanya summary. Window 10 turn ≈ 20 messages (user+assistant) cukup untuk 95%+ percakapan commerce. Untuk conversation yang lebih panjang, workspace_v2.conversation_summary + resolved_facts menjembatani gap.
4. **Emergency fallback: ALL providers exhausted** — keyword-tier hanya aktif jika SEMUA provider di role yang relevan (primary + fallback) gagal setelah retry + cooldown. Bukan "LLM ragu" atau "confidence rendah". Fallback reply jujur: "Maaf Kak, sistem sedang sibuk. Bisa diulang sebentar?" — tidak pura-pura paham.
5. **Minimal few-shots (4 contoh)** — hanya untuk edge cases yang sering salah (variant, remove-from-cart, total, clarification false-positive). Tidak akumulasi seperti sistem lama. Few-shots di-review tiap bulan, bukan grow indefinitely.

---

## Part 1 — LLM Call Architecture

### Decision: SINGLE combined call

**Alternative yang dipertimbangkan:**
- **Option A: Split call** — classification call (intent/entities/actions) + separate response-generation call
- **Option B: Combined call** — satu panggilan LLM yang menghasilkan structured fields + natural reply text dalam satu JSON

**Option A ditolak karena:**
1. **Consistency risk:** Intent classification dan response generation bisa contradictory. Contoh: LLM classify sebagai "add_to_cart" tapi replynya "Maaf, produk tidak tersedia" — atau sebaliknya, classify "product_inquiry" tapi replynya "Sudah ditambahkan ke keranjang". Dalam single call, ini impossible karena satu reasoning pass menghasilkan kedua-duanya.
2. **Latency ganda:** 2x latency untuk customer-facing response. Contract §0.4 mengatakan token cost bukan constraint, tapi latency tetap user experience issue.
3. **Complexity tanpa manfaat:** Menambah state machine untuk "tunggu classification, lalu generate response" — tambah layer yang tidak ada benefit yang jelas.

**Option B dipilih karena:**
1. **Single source of truth:** Intent, entities, proposed actions, dan reply text berasal dari reasoning pass yang sama. Tidak bisa mismatch.
2. **Naturalness terjaga:** LLM yang classify intent juga yang generate reply — sehingga reply bisa natural DAN sesuai intent classification.
3. **Token cost bukan constraint:** Contract §0.4 eksplisit — optimize token SETELAH kualitas stabil, bukan dari awal.

### Output schema shape

```json
{
  "schema_version": "v1",
  "intent": "string (fixed enum)",
  "confidence": 0.0-1.0,
  "entities": [],
  "proposed_actions": [],
  "reply_text": "string — natural reply in Indonesian",
  "needs_clarification": false,
  "clarification_question": "string or null",
  "summary_update": "string or null",
  "uncertainty_signals": []
}
```

**Key design:** `reply_text` adalah field wajib di setiap response. LLM tidak boleh mengeluh "saya hanya classifier" — ia harus selalu memberikan natural reply. Ini memaksa naturalness sebagai first-class citizen, bukan afterthought.

### Multi-provider constraint handling

**Constraint:** Hanya Mistral + SambaNova yangconfirmed support `jsonMode` via `response_format: { type: 'json_object' }`. Gemini via Groq juga support. Gemini native via GeminiShimAdapter TIDAK support jsonMode.

**Solution:** 
- Engine menggunakan provider resolver (`aiProviderResolver`) untuk role `chat_primary` dan `chat_fallback`
- System prompt secara eksplisit instruct LLM: "Output HANYA JSON valid. Jangan sertakan teks di luar JSON."
- Untuk provider yang TIDAK support jsonMode (GeminiShimAdapter saat ini), system prompt berperan sebagai **forced JSON via prompt engineering** — bukan relying on provider feature
- [UNVERIFIED] Perlu test: apakah Gemini native sebenarnya respect `responseMimeType: "application/json"`? Jika ya, GeminiShimAdapter bisa di-upgrade tanpa ganti architecture

**Risk:** Jika LLM output invalid JSON (terutama dengan Gemini native yang belum tested), parser harus handle gracefully → fallback ke emergency response + log incident. Ini bagian dari error handling di Part 4.

---

## Part 2 — Output Schema (Concrete, Versioned)

### Schema versioning

```typescript
export const V2_SCHEMA_VERSION = 'v1'; // increment when schema breaks

export interface V2EngineOutput {
  schema_version: typeof V2_SCHEMA_VERSION;
  intent: V2Intent;
  confidence: number; // 0.0 - 1.0, overall
  entities: V2Entity[];
  proposed_actions: V2ProposedAction[];
  reply_text: string; // REQUIRED — natural Indonesian reply
  needs_clarification: boolean;
  clarification_question?: string;
  summary_update?: string;
  uncertainty_signals: V2UncertaintySignal[];
}
```

### Intent classification: Fixed enum, NOT free-form

**Alternative yang dipertimbangkan:**
- **Free-form intent + confidence** — LLM bebas menulis intent apapun, lalu di-parse oleh system
- **Fixed enum** — intent dibatasi ke daftar yang jelas, LLM pilih salah satu

**Fixed enum dipilih karena:**
1. **Predictable routing:** System bisa decide action berdasarkan intent tanpa interpretive layer kedua.
2. **No drift:** Free-form intent menimbulkan drift — "add to cart", "tambah keranjang", "beli", "ambil" harusnya sama intent, tapi free-form bisa beda-beda.
3. **Testable:** Golden dataset bisa verify intent classification secara eksplisit.

**Intent enum (dasar, bisa ditambah saat P3/P4 jika diperlukan):**

```typescript
export const V2_INTENTS = {
  PRODUCT_INQUIRY: 'product_inquiry',
  ADD_TO_CART: 'add_to_cart',
  DONE_ORDERING: 'done_ordering',
  MODIFY_CART: 'modify_cart',
  PAYMENT_INQUIRY: 'payment_inquiry',
  SHIPPING_INQUIRY: 'shipping_inquiry',
  ORDER_STATUS: 'order_status',
  CANCEL_ORDER: 'cancel_order',
  SMALLTALK: 'smalltalk',
  CLARIFICATION: 'clarification',
  ESCALATION: 'escalation',
  UNKNOWN: 'unknown',
} as const;

export type V2Intent = typeof V2_INTENTS[keyof typeof V2_INTENTS];
```

**Catatan:** `CANCEL_ORDER` dan `MODIFY_CART` adalah aksi eksplisit yang akan di-validate sebelum dieksekusi — bukan langsung jalankan. `CANCEL_ORDER` = batalkan seluruh pesanan. `MODIFY_CART` dengan `REMOVE_FROM_CART` = hapus satu produk dari keranjang. Ini reinforcement contract §0.6.

### Entities

```typescript
export interface V2Entity {
  type: 'product' | 'quantity' | 'price' | 'variant' | 'customer_name' | 'customer_address' | 'customer_phone' | 'payment_method' | 'shipping_method' | 'order_status' | 'negation' | 'rollback' | 'greeting' | 'other';
  value: string;
  confidence: number;
  metadata?: Record<string, unknown>; // e.g., { variant: "merah size L" }
}
```

**Design rationale:**
- `type` menggunakan fixed enum untuk predictable extraction
- `variant` disimpan di `metadata.variant` (bukan field terpisah) untuk konsistensi dengan DraftCartOp yang sudah ada
- `negation`/`rollback` adalah entity khusus — bukan intent. Ini memungkinkan "ga jadi" di tengah percakapan tanpa mengubah intent utama

### Proposed actions (LLM proposes, domain executes)

```typescript
export interface V2ProposedAction {
  action_type: 'ADD_TO_CART' | 'REMOVE_FROM_CART' | 'UPDATE_CART_QUANTITY' | 'CANCEL_ORDER' | 'OPEN_CATALOG' | 'OPEN_CART' | 'SHOW_RELATED_PRODUCTS' | 'CONTACT_ADMIN' | 'NONE';
  payload: Record<string, unknown>;
  confidence: number;
  requires_validation: boolean; // true = harus through domain authority, false = safe auto-execute
}
```

**Key boundary (contract §0.6 reinforcement):**
- `requires_validation: true` untuk semua aksi yang mutate state (ADD_TO_CART, REMOVE_FROM_CART, CANCEL_ORDER, UPDATE_CART_QUANTITY)
- `requires_validation: false` HANYA untuk read-only/informational actions (OPEN_CATALOG, OPEN_CART, SHOW_RELATED_PRODUCTS, CONTACT_ADMIN)
- LLM TIDAK PERNAH langsung eksekusi — hanya propose. Domain authority (CartAuthority, orderService) yang decide execute/tidak.

### Confidence/uncertainty signal

```typescript
export interface V2UncertaintySignal {
  type: 'ambiguous_entity' | 'missing_context' | 'contradiction' | 'low_confidence' | 'out_of_scope';
  description: string;
}
```

**Usage:**
- `ambiguous_entity` → trigger clarification flow
- `missing_context` → trigger clarification flow
- `contradiction` → trigger clarification flow atau escalate
- `low_confidence` → if overall confidence < 0.5, ask clarification; if < 0.3, escalate
- `out_of_scope` → polite refusal + offer human handoff

**Decision boundary:**
- `confidence >= 0.7` → act directly
- `0.4 <= confidence < 0.7` → ask clarification (fill `needs_clarification: true`, `clarification_question`)
- `confidence < 0.4` → escalate to human (fill `intent: 'escalation'`, `reply_text` with handoff message)

### Natural reply text (reply_text)

**This is the field that solves the "robotic/stiff" complaint.**

- `reply_text` harus dalam Bahasa Indonesia natural, sesuai tone Bengkel Didik transcript (Lampiran B)
- JANGAN template kaku: "Halo, ada yang bisa saya bantu?" — gunakan variations seperti "Halo Kak! Ada yang bisa saya bantu malam ini?" atau "Sore juga, ada yang bisa saya bantu?"
- Panjang: 1-2 kalimat untuk simple response, max 3 kalimat untuk complex explanation
- JANGAN include harga/stock di `reply_text` — harga selalu dari DB (I13), di-enrich oleh domain layer setelah LLM propose
- Untuk `SMALLTALK` dan `ESCALATION`, `reply_text` adalah primary output — tidak ada action yang dijalankan

### Schema validation

LLM output di-validate menggunakan Zod schema (atau equivalent) SEBELUM masuk ke domain layer. Invalid JSON → emergency fallback + log incident.

```typescript
export const V2EngineOutputSchema = z.object({
  schema_version: z.literal('v1'),
  intent: z.nativeEnum(V2_INTENTS),
  confidence: z.number().min(0).max(1),
  entities: z.array(V2_ENTITY_SCHEMA),
  proposed_actions: z.array(V2_PROPOSED_ACTION_SCHEMA),
  reply_text: z.string().min(1).max(500),
  needs_clarification: z.boolean(),
  clarification_question: z.string().optional(),
  summary_update: z.string().optional(),
  uncertainty_signals: z.array(V2_UNCERTAINTY_SCHEMA),
});
```

---

## Part 3 — Context Management ("Nyambung" / Continuity)

### Problem

Owner's explicit complaint: chat feels disconnected. "Should feel like chatting with me right now" — natural, warm, context-aware. Documented in RAILS.md §2: "V2 kehilangan memori antar-turn secara diam-diam" (updateExtractedEntities NO-OP).

### Solution: Layered context assembly

**Tiga layer context yang di-merge sebelum LLM call:**

#### Layer 1: Recent turns (sliding window)

```typescript
const MAX_TURNS = 10; // 5 pairs user+assistant = 10 messages
const recentHistory = history.slice(-MAX_TURNS);
```

**Rationale:** 10 turn terakhir cukup untuk 95%+ percakapan commerce. Percakapan yang lebih panjang biasanya bergerak ke fase baru (misal dari product inquiry ke checkout), dan workspace_v2 summary + resolved_facts sudah menangkap context lama.

**Token budget:** 10 turn × ~100 tokens per message = ~1000 tokens untuk history. Masih sangat aman di bawah context window semua model yang aktif (Mistral 128K, SambaNova 8K-32K, Groq 8K).

#### Layer 2: Workspace_v2 state injection

```typescript
const workspaceState = {
  conversation_summary: workspace.conversation_summary,
  resolved_facts: workspace.resolved_facts,
  draft_cart: workspace.draft_cart,
  active_pendings: workspace.pendings.filter(p => p.status === 'active'),
  options_presented: workspace.options_presented.slice(-3), // max 3 terakhir
  last_bot_message_type: workspace.last_bot_message_type,
};
```

**Rationale:** 
- `conversation_summary` = "rolling summary" yang di-update tiap turn (1-2 kalimat). Ini jembatan untuk context yang sudah keluar dari sliding window.
- `resolved_facts` = fakta yang sudah confirmed (nama, alamat, phone, kota). Tidak perlu tanya ulang.
- `draft_cart` = cart yang sedang dibangun. LLM tahu apa yang sudah di-add tanpa harus count dari history.
- `active_pendings` = clarification yang masih menunggu jawaban. LLM tahu harus apa yang ditanya.
- `options_presented` = opsi yang sudah ditampilkan. LLM tahu jangan ulang opsi yang sama.

#### Layer 3: Customer message

Plain text pesan customer, di-place di akhir prompt sebagai `Current message:`.

### Context assembly format

```typescript
function buildLLMContext({
  recentHistory,
  workspace,
  customerMessage,
}: {
  recentHistory: HistoryTurn[];
  workspace: WorkspaceV2;
  customerMessage: string;
}): string {
  const parts: string[] = [];

  // Layer 2: Workspace state
  parts.push(`=== STATE PERCAKAPAN (lupakan pesan lama, ini yang penting) ===`);
  if (workspace.conversation_summary) {
    parts.push(`Ringkasan: ${workspace.conversation_summary}`);
  }
  if (Object.keys(workspace.resolved_facts).length > 0) {
    parts.push(`Fakta yang sudah diketahui: ${JSON.stringify(workspace.resolved_facts)}`);
  }
  if (workspace.draft_cart.length > 0) {
    parts.push(`Keranjang saat ini: ${JSON.stringify(workspace.draft_cart)}`);
  }
  const activePendings = workspace.pendings.filter(p => p.status === 'active');
  if (activePendings.length > 0) {
    parts.push(`Clarification aktif: ${activePendings.map(p => p.question).join('; ')}`);
  }
  if (workspace.options_presented.length > 0) {
    parts.push(`Opsi yang sudah ditampilkan: ${JSON.stringify(workspace.options_presented.slice(-3))}`);
  }

  // Layer 1: Recent history
  parts.push(`=== PERCAKAPAN TERBARU (max 10 turn) ===`);
  for (const turn of recentHistory) {
    parts.push(`${turn.role === 'user' ? 'Customer' : 'Assistant'}: ${turn.content}`);
  }

  // Layer 3: Current message
  parts.push(`=== PESAN SEKARANG ===`);
  parts.push(`Customer: ${customerMessage}`);

  return parts.join('\n');
}
```

**Design rationale:**
- State di-place SEBELUM history → LLM membaca state sebagai "ground truth" terlebih dahulu, kemudian history sebagai konfirmasi
- "Lupakan pesan lama, ini yang penting" instruction → mengurangi hallucination dari history yang sudah outdated
- Max 10 turn history → batas atas yang jelas, tidak unlimited

### Preventing "forgetting" without blowing context

**Technique: Summary injection + fact extraction**

1. **Per-turn summary update:** LLM menghasilkan `summary_update` (1-2 kalimat) yang di-merge ke `conversation_summary` di workspace_v2. Summary di-update setiap turn, bukan cuma di akhir.
2. **Resolved facts permanen:** Setiap kali customer confirm sesuatu (nama, alamat, phone), disimpan ke `resolved_facts`. Ini tidak pernah di-overwrite kecuali ada explicit correction.
3. **Draft cart snapshot:** Cart state disimpan di `draft_cart` — LLM tidak perlu hitung dari history.
4. **Sliding window + summary = hybrid:** Conversation yang pendek (< 10 turn) bergantung pada history. Conversation yang panjang (> 10 turn) bergantung pada summary + resolved_facts + draft_cart.

**Boundary:** Jika conversation mencapai 50+ turn, trigger `conversation_summary` regeneration (ringkasan komprehensif dari semua resolved_facts + options_presented + intent history). Ini prevent context window overflow di long conversations.

---

## Part 4 — Emergency Fallback Boundary (Contract §0.2)

### When does keyword-tier activate?

**PRECISELY when ALL providers in the role fail after full retry cycle.**

```typescript
// Pseudocode — untuk design doc, bukan implementation
async function llmFirstEngine(message, conversationId) {
  const providers = await aiProviderResolver.getProvidersForRole('chat_primary');
  const fallbackProviders = await aiProviderResolver.getProvidersForRole('chat_fallback');
  const allProviders = [...providers, ...fallbackProviders];
  
  let lastError: Error | null = null;
  for (const provider of allProviders) {
    for (let attempt = 0; attempt < MAX_RETRIES_PER_PROVIDER; attempt++) {
      try {
        const response = await provider.generate(prompt, { jsonMode: true });
        return parseAndValidate(response);
      } catch (error) {
        lastError = error;
        // Register cooldown for this provider
        await registerProviderCooldown(provider, error);
        continue; // next attempt or next provider
      }
    }
  }
  
  // ALL providers exhausted
  return emergencyFallback(message, lastError);
}
```

**Concrete failure conditions:**
1. Semua provider di `chat_primary` role gagal setelah `MAX_RETRIES_PER_PROVIDER` (default: 2) retry
2. Semua provider di `chat_fallback` role gagal setelah retry
3. Ada cooldown active untuk semua provider (rate-limit habis)
4. Total waktu tunggu exceeds `FALLBACK_ACTIVATION_TIMEOUT` (default: 15 detik)

**TIDAK aktif untuk:**
- LLM return invalid JSON (ini → emergency response, bukan keyword fallback)
- LLM return low confidence (ini → clarification atau escalate, bukan keyword fallback)
- Single provider gagal, yang lain masih healthy (ini → retry next provider, bukan fallback)
- Timeout di ONE provider tapi yang lain responsive

### Emergency fallback behavior

**Reply text (WA + PWA sama):**
```
Maaf Kak, sistem sedang sibuk banget. Bisa diulang sebentar? 
Kami pastikan pesan Kakak tidak hilang. 🙏
```

**Tidak ada keyword-tier fallback yang coba "tebak" intent.**
Alasan: Contract §0.2 menyatakan keyword-tier adalah emergency-only. Jika LLM gagal total, jawaban yang jujur lebih baik daripada tebakan yang salah — terutama karena Bengkel Didik case menunjukkan "false cancel" lebih merusak kepercayaan daripada "maaf, coba lagi".

**Logging:** Setiap emergency fallback di-log dengan:
- `conversationId`
- `lastError` (category, message)
- `failedProviders` (list)
- `timestamp`
- `customerMessage` (untuk audit)

### Keyword-tier preservation (jika diperlukan)

Keyword-tier (`fallback.service.ts` 13-tier chain) TIDAK dihapus dari codebase — hanya di-disable sebagai default. Disimpan untuk:
1. Emergency fallback jika LLM gagal total (diimplementasikan sebagai fallback chain yang lebih singkat, bukan 13-tier penuh)
2. Test coverage untuk edge cases yang LLM masih kesulitan (bisa di-run sebagai regression test)

**Short emergency fallback chain (max 3 tier):**
1. `tryTotal` — customer tanya total. Implementasi WAJIB reuse fungsi `isTotalTrigger()` + `tryTotal()` dari `tier-match.ts` (post-B3 fix, bukan substring naive).
2. `tryOrderStatus` — customer tanya status order. Implementasi WAJIB reuse `isOrderStatusIntent()` + `tryOrderStatus()` dari `tier-match.ts` (post-B4.1 fix, bukan substring naive).
3. `tryProduct` — customer tanya produk (single match only, tidak ambiguous). Implementasi WAJIB reuse `tryProduct()` dengan confidence gate yang sudah diperbaiki di B1.

**CRITICAL:** Emergency fallback TIDAK boleh menggunakan naive substring matching (seperti `message.includes('ga')` yang menyebabkan false-positive ROLLBACK di Bengkel Didik). Semua matcher harus reuse versi post-B3/B4 yang sudah ada confidence gating + word-boundary + context-aware matching di `tier-match.ts`.

Fungsi yang WAJIB di-reuse:
- `isTotalTrigger()` — `tier-match.ts:123-132` (post-B3 fix)
- `isOrderStatusIntent()` — `tier-match.ts:207-219` (post-B4.1 fix)
- `isProductNotFoundInquiry()` — `tier-match.ts:349-391` (post-B4.5 fix)
- `tryProduct()` — `fallback.service.ts:273-380` (post-B1 confidence gate)

Tier yang di-drop dari emergency fallback: `tryPayment`, `tryShipping`, `trySop`, `tryFAQ`, `tryKnowledge`, `tryProductNotFound` — karena ketiganya membutuhkan context yang lebih dalam, dan jika LLM gagal, kemungkinan besar context juga missing.

---

## Part 5 — Prompt Draft (Actual Text)

### System prompt

```
Kamu adalah QloBot, asisten toko yang ramah dan natural. Kamu berbicara dalam Bahasa Indonesia dengan gaya santai dan hangat, seperti berbicara dengan teman.

=== ATURAN PENTING ===

1. Output HANYA JSON valid sesuai schema. Jangan sertakan teks, markdown, atau penjelasan di luar JSON.

2. Kamu adalah classifier + responder dalam SATU langkah. Kamu TIDAK hanya mengisi intent — kamu juga harus memberikan balasan alami (reply_text) yang sesuai dengan intent tersebut.

3. reply_text WAJIB diisi untuk setiap response. Panjang 1-2 kalimat. Gaya: santai, hangat, natural. Contoh: "Halo Kak! Ada yang bisa saya bantu malam ini?" atau "Oke, Busi motor sudah ditambahkan ke keranjang ya! Mau lanjut belanja atau checkout sekarang?"

4. JANGAN masukkan harga/stok/varian ID di reply_text. Harga dan stok akan di-enrich sistem setelah kamu propose action. Kamu hanya sebut nama produk dan qty secara umum.

5. Intent classification menggunakan enum yang DIKETAHUI. Pilih SALAH SATU yang paling tepat. Jangan buat intent baru.

6. confidence adalah angka 0.0-1.0 yang menggambarkan seberapa yakin kamu dengan intent classification. 
   - >= 0.7: cukup yakin, eksekusi langsung
   - 0.4 - 0.69: kurang yakin, tanya clarification
   - < 0.4: sangat ragu, escalate ke human

7. Jika customer mengkonfirmasi/menjawab clarification yang sedang aktif, isi entities sesuai jawaban. Jangan buat clarification baru.

8. Jika customer menyebut produk beserta varian (warna/ukuran, misal "merah", "size L", "merah size L"), simpan deskripsi varian di entities[].metadata.variant. Jangan masukkan ke unmatched_mentions.

9. Pembatalan satu produk di keranjang menggunakan intent `modify_cart` dengan `action_type: 'REMOVE_FROM_CART'`. Contoh: "eh wortel ga jadi" → intent modify_cart, entities: [{type: 'product', value: 'wortel'}], proposed_actions: [{action_type: 'REMOVE_FROM_CART', payload: {product: 'wortel'}}]. Untuk batalkan seluruh pesanan, gunakan intent `cancel_order`.

10. Jika user hanya menyapa (halo, sore, pagi) atau melakukan smalltalk, gunakan intent 'smalltalk', proposed_actions=[], dan berikan balasan ramah di reply_text.

11. summary_update: 1-2 kalimat ringkasan state percakapan setelah pesan ini. Contoh: "Customer menambahkan Ban dalam ke keranjang, sekarang total Rp 65.000. Menunggu konfirmasi nama/alamat untuk checkout."

12. JANGAN hallucinate produk/harga yang tidak ada di katalog. Jika tidak yakin, gunakan intent 'product_inquiry' dengan confidence rendah, atau 'unknown'.

=== INTENT YANG DIKENALI ===

- product_inquiry: Tanya produk, harga, ketersediaan, varian
- add_to_cart: Ingin menambah produk ke keranjang
- done_ordering: Selesai menambah item, siap checkout/total
- modify_cart: Ubah/kurangi/hapus item di keranjang
- payment_inquiry: Tanya metode pembayaran, rekening, QRIS
- shipping_inquiry: Tanya ongkir, lokasi pengiriman, estimasi
- order_status: Tanya status pesanan (sudah dikirim? sampai mana?)
- cancel_order: Batalkan pesanan
- smalltalk: Sapaan, small talk, tidak ada intent bisnis
- clarification: Menjawab/menolak clarification yang sedang aktif
- escalation: Minta bantuan manusia/admin
- unknown: Tidak dapat diklasifikasikan

=== CONTOH (FEW-SHOT) ===

Contoh 1 — Add to cart dengan varian
Customer: "Saya mau beli sepatu warna merah size L"
Intent: add_to_cart
Entities: [{type: 'product', value: 'sepatu'}, {type: 'variant', value: 'merah size L', metadata: {variant: 'merah size L'}}]
Proposed actions: [{action_type: 'ADD_TO_CART', payload: {product: 'sepatu', variant: 'merah size L', qty: 1}, confidence: 0.9, requires_validation: true}]
Reply text: "Oke, sepatu warna merah size L sudah ditambahkan ke keranjang! Mau lanjut belanja atau checkout sekarang?"
Confidence: 0.9

Contoh 2 — Hapus satu produk dari keranjang (modify_cart)
Customer: "Eh, wortelnya ga jadi deh"
Intent: modify_cart
Entities: [{type: 'product', value: 'wortel'}]
Proposed actions: [{action_type: 'REMOVE_FROM_CART', payload: {product: 'wortel'}, confidence: 0.95, requires_validation: true}]
Reply text: "Oke, wortel sudah dihapus dari keranjang. Ada yang ingin ditambahkan lagi?"
Confidence: 0.95

Contoh 3 — Tanya total
Customer: "Totalnya berapa?"
Intent: done_ordering
Entities: []
Proposed actions: [{action_type: 'OPEN_CART', payload: {}, confidence: 0.85, requires_validation: false}]
Reply text: "Ini rekap keranjang Kakak ya —"
Confidence: 0.85

=== SYSTEM-ENRICHMENT STEP (setelah LLM output) ===
LLM menghasilkan:
  - intent: done_ordering
  - proposed_actions: [{action_type: 'OPEN_CART'}]

Domain layer (CartAuthority) membaca cart dari DB → menghasilkan price breakdown:
  - Ban depan Matic (1x): Rp 150.000
  - Subtotal: Rp 150.000

System menggabungkan:
  FINAL_REPLY = LLM reply_text + "\n\n" + price_breakdown_from_domain

Hasil akhir ke customer:
  "Ini rekap keranjang Kakak ya —

  GRAND TOTAL: Rp 150.000

  Rincian:
  - Ban depan Matic (1x): Rp 150.000
  - Subtotal: Rp 150.000"

CATATAN: Harga dan breakdown SEPENUHNYA di-compose oleh domain layer setelah LLM propose OPEN_CART. LLM TIDAK tahu harga dan TIDAK menyertakan angka di reply_text.

Contoh 4 — Klarifikasi nama+alamat dengan substring negation false positive (regression: Bengkel Didik "Panji dagangan")
Customer: "Panji dagangan" (jawaban untuk "Siapa nama Kakak dan alamat pengirimannya?")
Intent: clarification
Entities: [{type: 'customer_name', value: 'Panji'}, {type: 'customer_address', value: 'dagangan'}]
Proposed actions: [{action_type: 'NONE', payload: {}, confidence: 0.95, requires_validation: false}]
Reply text: "Oke Kak, sudah tercatat. Sekarang lanjut ke pembayaran ya."
Confidence: 0.95

=== KONTEKS KONFIRMASI ===
- Ada clarification aktif: "Siapa nama Kakak dan alamat pengirimannya?"
- "Panji dagangan" mengandung substring "ga" di dalam kata "dagangan"
- LLM TIDAK boleh mengklasifikasikan ini sebagai rollback/cancel/negation
- LLM harus memahami konteks: ini adalah jawaban untuk clarification, bukan pembatalan
- Hasil: clarification di-resolve, nama/alamat tersimpan, order lanjut ke checkout

CATATAN REGRESI: Ini adalah exact incident dari Bengkel Didik (2 Sep 2026). Sistem lama menggunakan substring match ('ga' ⊂ 'dagangan') → false positive ROLLBACK → bot bilang "sudah saya batalkan ya" padahal customer hanya menjawab nama+alamat. Design baru HARUS menangani ini dengan benar.

=== STATE PERCAKAPAN ===
${workspaceState}

=== PERCAKAPAN TERBARU ===
${recentHistory}

=== PESAN SEKARANG ===
Customer: ${customerMessage}
```

### User prompt template

```
=== STATE PERCAKAPAN ===
Ringkasan: ${conversation_summary}
Fakta yang sudah diketahui: ${resolved_facts}
Keranjang saat ini: ${draft_cart}
Clarification aktif: ${active_pendings}
Opsi yang sudah ditampilkan: ${options_presented}

=== PERCAKAPAN TERBARU ===
${recentHistory}

=== PESAN SEKARANG ===
Customer: ${customerMessage}
```

### Prompt engineering notes

**Tone/persona:**
- "QloBot" — asisten toko yang ramah, tidak formal
- Gunakan "Kak" untuk addressing customer (sesuai transcript Bengkel Didik)
- Emoji sparingly — tidak di setiap message, hanya untuk confirmation/success
- Jangan mulai dengan "Halo, ada yang bisa saya bantu?" setiap kali — variations: "Sore juga, ada yang bisa saya bantu?", "Malam juga, Kak. Ada yang bisa saya bantu malam ini?", "Hai Kak! Mau belanja apa hari ini?"

**Few-shot management:**
- HANYA 4 contoh (add_to_cart dengan varian, modify_cart/remove, total/OPEN_CART, clarification false-positive)
- Contoh dipilih dari edge cases yang sering salah di history (variant, remove-from-cart, total, Panji dagangan substring false-positive)
- Tidak akumulasi — setiap bulan review: apakah contoh masih relevan? Apakah ada edge case baru yang perlu ditambah? Jika ya, replace, don't add.
- Contoh di-inject secara dinamis berdasarkan conversation state (misal: jika ada pending clarification, inject contoh clarification)

**Anti-pattern yang dihindari (dari RAILS.md §2/§6):**
- Tidak ada instruction "jangan gunakan harga dari LLM" — karena harga tidak ada di LLM output sama sekali (hanya di `reply_text` sebagai placeholder yang di-enrich sistem)
- Tidak ada keyword matching di prompt — intent classification sepenuhnya di LLM
- Tidak ada "if X then Y" rules yang ribuan — cukup 12 aturan eksplisit di system prompt

**Provider-agnostic instruction:**
- System prompt tidak mention provider name — bisa jalan di Mistral, SambaNova, Groq, atau Gemini
- Instruction "Output HANYA JSON valid" work untuk semua provider yang support jsonMode atau bisa di-forced via prompt
- [UNVERIFIED] Untuk Gemini native yang belum support jsonMode, perlu test apakah instruction ini cukup untuk force JSON output

---

## Open Questions for Owner (must approve before P2)

1. **Apakah 10-turn sliding window cukup?** Atau owner ingin experiment dengan 15/20 turn untuk conversation yang lebih kompleks? Token budget masih aman, tapi lebih banyak history = lebih banyak noise.
2. **Apakah few-shot 4 contoh cukup?** Atau owner ingin mulai dengan 5 (tambahkan payment + shipping examples)?
3. **Apakah emergency fallback reply "Maaf Kak, sistem sedang sibuk" sudah cukup, atau owner ingin opsi yang lebih detail?**
4. **Apakah keyword-tier 3-tier emergency fallback (total/order_status/product) sudah cukup singkat, atau owner ingin di-cut further?**
5. **Apakah `confidence < 0.4 → escalation` threshold sudah tepat, atau owner ingin adjust ke 0.3/0.5?**
6. **GeminiShimAdapter jsonMode support:** Perlu investigate apakah Gemini native API mendukung `responseMimeType: "application/json"` atau `functionDeclarations`. Jika ya, bisa ditambahkan sebagai provider option. Jika tidak, Gemini terbatas ke prompt-engineered JSON mode. Owner approve risk ini?

---

## Lampiran — Current State Schema Reference

### WorkspaceV2 (saat ini)

```typescript
export interface WorkspaceV2 {
  schema_version: string;
  conversation_summary: string;
  pendings: PendingV2[];
  draft_cart: DraftCartOp[];
  resolved_facts: Record<string, unknown>;
  last_bot_message_type?: string;
  options_presented: string[][];
}
```

### CanonicalConversationState (canonical boundary)

```typescript
export interface CanonicalConversationState {
  schema_version: string;
  conversation_summary: string;
  pendings: PendingV2[];
  resolved_facts: Record<string, unknown>;
  intent: string | null;
  options_presented: string[][];
  last_bot_message_type?: string;
  cart_ref: CanonicalCartRef;
  _compat?: CanonicalCompatState;
}
```

### Current InterpreterResultV2 (yang akan di-replace)

```typescript
export interface InterpreterResultV2 {
  acts: ActV2[];
  quantifier?: QuantifierV2;
  unmatched_mentions: string[];
  topic_switch: boolean;
  draft_cart_ops: DraftCartOp[];
  clarification?: ClarificationV2;
  reply_draft?: string;
  confidence: ConfidenceV2;
  summary_update?: string;
}
```

**Catatan:** Schema baru (V2EngineOutput) akan menggantikan `InterpreterResultV2`. Field `reply_draft` di-replace oleh `reply_text` (wajib, bukan optional). Field `clarification` di-replace oleh `needs_clarification` + `clarification_question` (sederhana). Field `confidence` di-simplifikasi dari `ConfidenceV2` object menjadi single number.

---

## Kesimpulan

Design ini memilih:
1. **Single combined LLM call** — bukan split, untuk konsistensi intent+reply
2. **Fixed intent enum** — bukan free-form, untuk predictable routing
3. **reply_text sebagai first-class citizen** — naturalness di-mandate, bukan di-hope
4. **Sliding window + workspace injection** — context management yang scalable
5. **Emergency fallback sebagai LAST resort** — honest degradation, bukan keyword tebakan
6. **Minimal few-shots** — 4 contoh, review bulanan, tidak akumulasi

Semua design decision mematuhi contract §0 (v1 dihapus, LLM utama, token bebas, structured action bypass LLM, CartAuthority tetap domain authority) dan menghindari pola-pola lama yang didokumentasikan di RAILS.md §2/§6 (keyword collision, boundary violation, false positive substring match, robotic generic replies).
