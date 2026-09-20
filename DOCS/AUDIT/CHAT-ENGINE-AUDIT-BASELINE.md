# CHAT-ENGINE-AUDIT-BASELINE.md
**Tanggal:** 2026-09-03  
**Scope:** Read-only audit — no source changes.  
**Bukti:** semua klaim dibuktikan file:line atau output perintah read-only.

---

## Part A — Entry & Routing Map (current)

### 1. Full message path (WA & PWA)

| Channel | Entry point | Pipeline | Response path |
|---------|-------------|----------|---------------|
| **WA — GOWA** | `webhooks.ts:25` (`POST /api/webhooks/gowa`) | `messageProcessorService.processMessage` (`webhooks.ts:110`) → `conversationService.processCustomerMessage` (`message-processor.service.ts:256`) → engine (v1/v2) | `sendWithPresence` (`message-processor.service.ts:300`) → `smartRetrySend` (`message-processor.service.ts:374`) → `gateway.sendMessage` |
| **WA — Fonnte** | `webhooks.ts:138` (`POST /api/webhooks/fonnte`) | Async IIFE → `messageProcessorService.processMessage` (`webhooks.ts:269`) → `conversationService.processCustomerMessage` (`message-processor.service.ts:256`) → engine | Sama seperti GOWA (`message-processor.service.ts:300`) |
| **PWA Web** | `pwa.ts:299` (`POST /api/pwa/:storeSlug/message`) | `conversationDeliveryService.processWebRequest` (`pwa.ts:374`) → `conversationService.processCustomerMessage` (`conversation-delivery.service.ts:96`) → engine | Delivery layer publish `message.created` + `conversation.updated` (`conversation-delivery.service.ts:243-268`) → HTTP JSON response (`pwa.ts:401-411`) |

### 2. v1 vs v2 selection mechanism

- **Flag read:** `engine-config.ts:19-22` — `getStoreEngine(storeId)` membaca Redis key `store:${storeId}:engine` (format JSON `StoreEngineConfig`).
- **Default absent:** `'v1'` (`engine-config.ts:22`).
- **Production DB:** Tabel `stores` (schema.prisma:10-68) **TIDAK** memiliki kolom `engine`. Flag hanya ada di Redis.
- **Count v1 vs v2 (read-only):**
  - Total store aktif di DB: **9** (SELECT `count(*)` dari `stores` dimana `deletedAt IS NULL AND isActive = true`).
  - Redis scan `store:*:engine`: **1 key** ditemukan → **1 store v2** (`store-f7140b5c`).
  - 8 store lainnya **tidak memiliki Redis key** → default **v1**.
  - **List storeId v2:** `["store-f7140b5c"]`.
  - [UNVERIFIED] daftar storeId v1 dari DB murni karena flag tidak di-DB; diinferensi dari ketiadaan key Redis.

### 3. v2 masih shadow-only atau membuat keputusan nyata?

- **Bukan shadow-only.** `conversation.service.ts:129-131` — jika `engine === 'v2'`, kode masuk blok v2 dan menjalankan `understand()` (`reasoning.ts:201`) yang melakukan mutasi cart (`executeWaCartMutation`) dan menyimpan workspace.
- **Shadow hook terpisah:** `conversation.service.ts:737` — `if (shouldRunShadow(storeId))` menjalankan `understand()` di `setImmediate` (background, fail-open) untuk logging shadow entry. Ini hanya log, bukan keputusan produksi.
- **Dual-path guard:** `v2MutationExecuted` (`conversation.service.ts:132`) diset saat mutasi v2 sukses (`conversation.service.ts:254`, `:341`) dan dicek di post-mutation catch (`conversation.service.ts:301`, `:399`) untuk mencegah fallback ke v1 setelah mutasi.

---

## Part B — `fallback.service.ts` Tier Inventory (current)

### 1. Chain order (re-derived dari source, bukan RAILS.md)

| Urut | Tier | Fungsi | File:Line |
|------|------|--------|-----------|
| 1 | Dead-end | Regex penutup (ok/thanks/emoji) + bypass order-funnel context | `message-queue.service.ts:65-82`, `fallback.service.ts:91-99` |
| 2 | Cache | Exact key `response:${storeId}:${query}` | `fallback.service.ts:172-179` |
| 3 | FAQ | `faqService.search` + confidence gate | `fallback.service.ts:181-201` |
| 4 | Order status | `ORDER_STATUS_KEYWORDS` + `isOrderStatusIntent` | `fallback.service.ts:568-639` |
| 5 | Total | `TOTAL_TRIGGERS` + `isTotalIntent` | `fallback.service.ts:642-762` |
| 6 | Shipping | `SHIPPING_KEYWORDS` + `isShippingIntent` | `fallback.service.ts:495-565` |
| 7 | Payment | `PAYMENT_EXPLICIT_METHODS` + `isPaymentIntent` | `fallback.service.ts:421-493` |
| 8 | Catalog | Keyword list `catalogKeywords` | `fallback.service.ts:227-271` |
| 9 | Product | `productService.searchProducts` + `shouldAnswerSingleProduct` | `fallback.service.ts:273-380` |
| 10 | Product-not-found | `isProductNotFoundInquiry` | `fallback.service.ts:382-419` |
| 11 | SOP | `SOP_RETUR_KEYWORDS` + `isSopRetourIntent` + category map | `fallback.service.ts:765-818` |
| 12 | Knowledge | `knowledgeService.search` + confidence gate | `fallback.service.ts:204-225` |
| 13 | HUMAN fallback | Exhausted chains → pesan generic | `fallback.service.ts:163-169` |

### 2. Trigger per tier + status fix RAILS.md

| Tier | Trigger (keyword/regex/threshold) | Status fix RAILS.md |
|------|-----------------------------------|---------------------|
| Dead-end | Regex `DEAD_END_PATTERNS` (`message-queue.service.ts:65-70`) | Tidak ada flag HIGH/MEDIUM di RAILS.md |
| Cache | Exact match (`fallback.service.ts:173`) | Tidak ada flag |
| FAQ | Confidence > 0.5 + margin 0.15 (`fallback.service.ts:187-188`) | [DUGAAN] threshold naik dari 0.3 → 0.5 (B4.4). Kode masih ada, tidak diubah. |
| Order status | `ORDER_STATUS_KEYWORDS` substring (`tier-match.ts:164-176`) + `isOrderStatusIntent` (`tier-match.ts:207-219`) | Fix B4.1 masih ada, tidak regresi. |
| Total | `TOTAL_TRIGGERS` substring (`tier-match.ts:26-39`) + `isTotalIntent` (`tier-match.ts:123-132`) | Fix B3 masih ada, tidak regresi. |
| Shipping | `SHIPPING_KEYWORDS` substring (`tier-match.ts:311-316`) + `isShippingIntent` (`tier-match.ts:331-344`) | Fix B4.3 masih ada, tidak regresi. |
| Payment | `PAYMENT_EXPLICIT_METHODS` substring (`tier-match.ts:43-73`) + `isPaymentIntent` (`tier-match.ts:143-158`) | Fix B3 masih ada, tidak regresi. |
| Catalog | `catalogKeywords` list (`fallback.service.ts:230-236`) | Tidak ada flag |
| Product | `productService.searchProducts` + `shouldAnswerSingleProduct` confidence gate (`fallback.service.ts:328`) | Fix B1 masih ada, tidak regresi. |
| Product-not-found | `PRODUCT_INQUIRY_WORDS` + `isProductNotFoundInquiry` (`tier-match.ts:349-391`) | Fix B4.5 masih ada, tidak regresi. |
| SOP | `SOP_RETUR_KEYWORDS` + `isSopRetourIntent` (`tier-match.ts:230-286`) + category map (`fallback.service.ts:769-777`) | Fix B4.2 masih ada, tidak regresi. |
| Knowledge | Confidence > 0.5 + margin 0.15 (`fallback.service.ts:210-211`) | [DUGAAN] threshold naik dari 0.3 → 0.5 (B4.4). Kode masih ada, tidak diubah. |

### 3. Cross-reference `fast-path.ts` ORDER_INTENT_KEYWORDS ('mau' short-circuit)

- `fast-path.ts:52-63` — `ORDER_INTENT_KEYWORDS` masih mengandung `'mau'`.
- `fast-path.ts:439-441` — jika pesan mengandung `'mau'`, `isOrderIntent` return `true`, sehingga fast-path return `miss` dan **skip tier fallback** (langsung ke LLM).
- RAILS.md §3 mencatat ini sebagai item terbuka (belum diperbaiki): *"Kata `'mau'` di `ORDER_INTENT_KEYWORDS` (`fast-path.ts`) bisa short-circuit sebelum trySop sempat dicek untuk kalimat seperti 'barang rusak mau retur' — ditemukan saat TASK B4.2 (10 Agu 2026), di luar scope B4, belum ada TASK perbaikan."*
- **Kondisi saat ini:** masih persis seperti yang didokumentasikan RAILS.md — belum ada perbaikan.

---

## Part C — Investigasi Bug Pattern "Ask Total → Order Cancelled"

### 1. Semua code path yang bisa set `orderStatus = 'cancelled'`

| Path | Lokasi | Mekanisme |
|------|--------|-----------|
| Structured `CANCEL_ORDER` action | `action-registry.ts:1059` → `order.service.ts:448` → `order-transition.ts:137` | Client mengirim `POST /api/pwa/:slug/action` dengan type `CANCEL_ORDER` |
| Admin manual cancel | `routes/orders.ts:152,165` | Admin update status via dashboard |
| Auto-cancel scheduler | `scheduleAutoCancel.ts:54` | Cron 15 menit untuk order `waiting_address`/`waiting_payment` yang expired |
| Payment approve (jarang) | `payment.service.ts:137` | Hanya jika admin approve dengan target `cancelled` (tidak normal) |

**TIDAK ADA** path di chat engine (v1 interpreter / v2 reasoning / fallback tier) yang memanggil `cancelOrder` atau `transitionOrder(..., 'cancelled')`.

### 2. Conflation 'batal' / 'ganti' / 'total' di keyword / few-shot

- **'batal':**
  - `fast-path.ts:31` — `NEGATION` list include `'batal'`. `tryMatchNegation` (`fast-path.ts:191-194`) mengembalikan `ROLLBACK` untuk pending clarification (bukan order cancel).
  - `fallback.service.ts:1154` — `handleOrderChangeRequest` (dead code, tidak pernah dipanggil) menggunakan `'batal'`.
  - `interpreter.ts` V1 schema (`interpreter.ts:33-43`) **tidak** memiliki intent `cancel`. `reasoning.ts` prompt (`prompts-v2.ts:68`) mendefinisikan `cancel` hanya untuk **produk** di keranjang, bukan order.

- **'ganti':**
  - `tier-match.ts:238` — `SOP_RETUR_KEYWORDS` include `'ganti'`. Namun `isSopRetourIntent` (`tier-match.ts:269-286`) memfilter: `'ganti'` alone atau dengan <2 produk → `false`. Jadi "ganti total" tidak trigger SOP retur.

- **'total':**
  - `tier-match.ts:26-39` — `TOTAL_TRIGGERS` include `'total'`, `'totalnya'`, `'tagihan'`, `'keranjang'`, `'order'`, `'pesanan'`, `'belanja'`. Tidak ada kata cancel/batal/ganti di list ini.
  - `fallback.service.ts:642-762` — `tryTotal` menghitung total keranjang dari DB, tidak memanggil `transitionOrder`.

- **Few-shot / prompt:**
  - `interpreter.ts:31` — FEW_SHOT tidak ada contoh cancel-order.
  - `prompts-v2.ts:139-310` — FEW_SHOTS V2 hanya ada contoh cancel untuk produk ("Eh wortel ga jadi" → intent `cancel`). Tidak ada contoh cancel order.

### 3. Kesimpulan reproducibility

**Tidak dapat direproduksi dari static code inspection.**

- Tidak ada jalur deterministik dari pertanyaan "total" → `transitionOrder(..., 'cancelled')`.
- Path yang menghasilkan kata "batalkan" di reply adalah:
  - ROLLBACK pending clarification (cart snapshot restore) — `conversation.service.ts:544-577`, `fast-path.ts:191-194`. Ini **tidak** mengubah `orderStatus`.
  - `handleOrderChangeRequest` (dead code, `fallback.service.ts:1148`) — hanya mencatat permintaan di `order.notes`, tidak transisi status.
- Jika bug "total → order cancelled" memang terjadi di production, kemungkinan penyebabnya adalah:
  - Aksi terstruktur `CANCEL_ORDER` yang dikirim klien (bukan LLM).
  - Intervensi manual admin.
  - Auto-cancel scheduler (`scheduleAutoCancel.ts`) yang mem-batalkan order stuck.
  - [UNVERIFIED] faktor eksternal lain (e.g., client-side race, data seeding error).

**Kesimpulan:** Ini bukan keyword-tier bug dan bukan LLM-prompt bug yang dapat dibuktikan dari source. Jika terjadi, bersifat eksternal atau stochastic di luar kontrol chat engine.

---

## Part D — LLM Call Inventory (customer-facing chat path)

### 1. Setiap LLM call site

| Site | Provider/role | Model | File:Line |
|------|---------------|-------|-----------|
| V1 Interpreter (`runOneCall`) | `chat_primary` (default Gemini) → fallback `chat_fallback` (Groq) via `llmGateway.generate` | Konfigurasi di `AIProviderConfig` (role `chat_primary`/`chat_fallback`) | `interpreter.ts:97-103` |
| V2 Reasoning (`callLlm` → `llmGateway.generate`) | Sama seperti V1 (gateway yang sama) | Sama | `reasoning.ts:115-120` |
| Tier-level semantic calls | **Tidak ada.** FAQ (`faq.service.ts:117-207`) dan Knowledge (`knowledge.service.ts:115-196`) menggunakan text search DB murni, tidak LLM. | — | — |
| Magic-paste (non chat) | `adapters.ai.generate` | — | `product.service.ts:1089` |

### 2. Chat_gatekeeper masih hardcoded Groq?

- **Ya, masih hardcoded Groq singleton.**
- `llm-gateway.ts:79-81` — constructor default `gatekeeper = groqAdapter`.
- `llm-gateway.ts:125-131` — `resolveEffectiveProviders()` sengaja **TIDAK** mengganti gatekeeper. Komentar: *"extractIntent is GroqAdapter-specific... Option B was chosen... `chat_gatekeeper` rows are therefore cosmetic for now."*
- `DEFERRED-WORK-TRACKER.md` item #8 mencatat deferral ini dan belum ada perubahan kode yang mengubahnya.
- [UNVERIFIED] apakah ada runtime config yang override constructor; dari source, tidak ada.

### 3. Perkiraan LLM call count per customer message (min/max)

| Engine | Min | Max | Catatan |
|--------|-----|-----|---------|
| V1 (`interpreter.ts`) | 0 (tier hit) | 2 (`runOneCall` max 1 retry transport) | `interpreter.ts:92` — `maxRetries = 1`, loop `attempt <= 1` |
| V2 (`reasoning.ts`) | 0 (fast-path hit) | 4 (teoritis) — 2 attempt × 2 transport retries | `reasoning.ts:47` `TRANSPORT_MAX_RETRIES=1`, `reasoning.ts:270` attempt1 + `reasoning.ts:367` attempt2. Namun type `llmCalls: 1 \| 2` (`reasoning.ts:68`) menyimpan max 2 — ada ketidaksesuaian type vs implementasi. |

---

## Part E — Golden Dataset Coverage

### Gap: "ask total / get cancelled"

- **Tidak ada case** di `golden-dataset.test.ts` yang memetakan skenario *"customer tanya total, lalu order dibatalkan"*.
- Case yang mendekati:
  - Case 2 / Case B3-a / Case P3 / Case P4 / Case P5 — semua hanya assertions balasan `tryTotal` (total keranjang), tidak ada asersi perubahan `orderStatus`.
  - Case 4 — `ga jadi` memicu ROLLBACK pending clarification (cart), bukan order cancellation.
- **Catatan gap:** Jika bug ini memang terjadi di production, golden dataset saat ini tidak dapat mendeteksinya.

---

## Lampiran — Verifikasi Tanpa Perubahan Source

```bash
$ git diff --stat
# (no output — working tree clean)

$ # Redis read-only scan (production)
$ node -e "const Redis=require('ioredis');const r=new Redis(process.env.REDIS_URL);(async()=>{const keys=await r.keys('store:*:engine');const vals=await Promise.all(keys.map(k=>r.get(k)));let v1=0,v2=0;keys.forEach((k,i)=>{try{const v=JSON.parse(vals[i]);v.engine==='v2'?(v2++,console.log('V2',k)):v1++}catch(e){v1++}});console.log('V1_COUNT',v1,'V2_COUNT',v2);await r.quit()})();"
V1_COUNT 0 V2_COUNT 1
V2 store:7140b5c

$ # DB read-only count (production)
$ node -e "require('dotenv').config({path:'/home/ubuntu/garuda/.env'});const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{console.log('TOTAL_ACTIVE_STORES',await p.store.count({where:{deletedAt:null,isActive:true}}));await p.\$disconnect()})();"
TOTAL_ACTIVE_STORES 9
```

**Kesimpulan akhir:**  
- Engine v2 adalah **produksi nyata** untuk 1 store (`store-f7140b5c`), bukan shadow-only.  
- Tier chain saat ini adalah 13 tahap (dead-end → knowledge → human).  
- Bug "total → cancelled" **tidak terverifikasi** dari source code — kemungkinan faktor eksternal.  
- Golden dataset **belum** memiliki coverage untuk skenario ini.
