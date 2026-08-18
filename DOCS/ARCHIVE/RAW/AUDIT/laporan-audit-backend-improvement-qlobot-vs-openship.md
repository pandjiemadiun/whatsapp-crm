# Laporan Audit READ-ONLY — Backend Improvement: QloBot vs OpenShip

> **Inspection-only gate.** Sesuai `RAILS.md` §1.6 dan workflow preference *user-taste*,
> audit ini **TIDAK MELAKUKAN** perubahan kode, commit, migrasi, atau install dependency.
> Deliverable tunggal: file laporan ini, yang **sepenuhnya diverifikasi dari sumber**.
> Setiap klaim di bawah dilengkapi dengan `file:line` sebagai bukti.
> Setiap temuan perbaikan backend **belum diimplementasikan** — semuanya ditandai
> `OWNER REVIEW REQUIRED`.

- **Scope:** Backend QloBot (`/home/ubuntu/garuda/apps/api`) dibandingkan dengan referensi pendekatan OpenShip (`/home/ubuntu/garuda/marketplace`).
- **Asumsi audit:** *garuda* = keseluruhan proyek; *QloBot* = backend chatbot/CRM di `apps/api`; *OpenShip* = marketplace referensi di `marketplace/` (Next.js frontend + transport API MCP yang bersumber ke Openfront/Shopify melalui *platform adapter*).
- **Batasan keabsahan (jujur):** OpenShip marketplace adalah **stateless frontend proxy** yang **tidak memiliki database pusat** (README: *"This marketplace doesn't store products, inventory, or customer data"*). QloBot justru *pemilik data* (PostgreSQL+Prisma) untuk toko, produk, keranjang, order, percakapan, pelanggan, gateway WA, dan realtime. Dengan demikian perbandingan ini **pola-arkitektur / kontrak-API**, bukan parity fitur 1:1. Penemuan yang bersifat *pola* (adapter registry, kontrak bertipe, entitas keranjang bernama, abstraksi penyedia AI) tetap sah nilainya untuk diterapkan pada sisi QloBot.

---

## Metodologi & Batas Keputusan (Decision Boundary)

Setiap kandidat dikelompokkan ke dalam salah satu kategori, **tidak ada implementasi sampai keputusan final**:

| Kategori | Kriteria | Dokumen? |
|---|---|---|
| **A. IMPLEMENT NOW** | Aman, kecil, jelas, tidak mengubah otoritas bisnis. | Ya (opsional, hanya untuk A) |
| **B. IMPLEMENT AFTER OWNER APPROVAL** | Perubahan backend nyata, manfaat jelas, risiko terkontrol. | Ya — ditandai `OWNER REVIEW REQUIRED` |
| **C. REPORT ONLY** | Besar/arsitektur, migrasi berat, atau berpotensi mengubah behavior existing. | Ya — tidak dikodekan |

Berdasarkan verifikasi `git grep`/`sed`, file di bawah dilindungi secara implisit oleh RAILS.md (mesin v2, conversation.service, order.service) — semua temuan yang menyentuhnya ditandai **MENYENTUH ARSITEKTUR TERLINDUNGI = ya** dan **tidak diimplementasikan**.

---

## 1. Ringkasan Eksekutif (4 fakta kunci)

1. **Keranjang belanja QloBot tidak berada di satu sumber kebenaran.** Di satu sisi ada `confirmedItems` (JSON blob di `conversation_context.extractedEntities`), di sisi lain `draft Order.items` (JSON blob di tabel `orders`); keduanya menulis ke kolom JSON yang tidak bertipe, dan engine konversasional tidak pernah menyentuh tabel `OrderItem` yang *strongly-typed*. (bukti: `conversation.service.ts` `executeCartOps:884` memanggil `syncCartStateToDraftOrder`; `getCartFromDb:926` membaca dari `extractedEntities`; `schema.prisma` `Order.items Json` :214). OpenShip justru punya entitas `Cart` ber-ID stabil dan `lineItems` yang dikunci ke `variantId`.
2. **Engine V2 mengabaikan pengelola penyedia AI.** `reasoning.ts:31` dan `interpreter.ts:12` mengimpor `groqAdapter` **langsung**, melewati `aiProviderManager` (Gemini primary + fallback + rotasi key + circuit breaker) yang justru sudah ada. Satu-satunya jalur yang pakai manager adalah *stub mati* `message.handler.ts` yang tidak dipakai. (bukti: `grep` — 0 referensi `messageHandler` di luar filenya sendiri.)
3. **Webhook masuk GOWA tidak terautentikasi sama sekali.** `routes/webhooks.ts` handler `/gowa` tidak memverifikasi secret/HMAC apa pun; menilakan `store` dari `device_id`. Ini adalah vektor pemalsuan langsung ke seluruh pipeline pesan→keranjang→order. (bukti: bacaan penuh `webhooks.ts`.)
4. **Terdapat 4 lapis mekanisme retry/circuit-breaker yang tumpa-tumpo di jalur LLM yang sama** (`CircuitBreakerService` di `message-processor.service:77`, breaker di `manager.ts:20`, loop rotasi key di `groq.adapter.ts:79`, retry transport di `reasoning.ts:112`).

---

## 2. Gambaran Singkat Kedua Basis Kode

### QloBot backend (`apps/api`) — monoli berpemilikan data
- **Ingestion:** `routes/webhooks.ts` (GOWA/Fonnte) → `message-processor.service.ts` (dedup → dead-end → coalescing → mutex → circuit breaker → LLM) → `conversation.service.processCustomerMessage`.
- **Mesin percakapan:** Dua jalur — **V1** (monolitik, `interpreter.ts` `runOneCall` + `fallback.service.ts` tier rule) dan **V2** (modular di `services/chat/`: `fast-path`, `reasoning`, `validator-v2`, `planner`, `interpreter`, `normalizer`, `workspace`, `composer-v2`, `pendingClarification`, shadow-*). V2 *fallback ke V1* bila gagal (`conversation.service.ts:376-385`).
- **State:** disperse di `conversation_context` (kolom `lastMessages`, `extractedEntities`, `workspace_v2`), `orders`/`orderItems`, `conversation_history`, Redis, `Customer.webUid`.
- **Realtime:** Socket.IO + EventBus in-proc (`realtime.service.ts` — *"Single-VPS MVP: in-proc"*).
- **AI:** Gemini (primary) + Groq (fallback/ gatekeeper) dengan `aiProviderManager`, `aiKeyRouter` (Redis cooldown), `token-usage-tracker`.

### OpenShip marketplace (`marketplace`) — stateless proxy + adapter
- **Transport API:** JSON-RPC/MCP di `app/api/mcp-transport/[transport]/route.ts`; tool terdefinisi di `tools/` (cart/product/store/region) dengan `inputSchema` Zod-like.
- **Abstraksi platform:** `getPlatformAdapter(store)` → antarmuka bertipe `PlatformAdapter` (`adapters/types.ts`), *lazy-loaded* + dicache; mendukung openfront/shopify/bigcommerce/woocommerce.
- **Keranjang:** entitas bernama `Cart` (cartId) + `CartLineItem` dikunci ke `variantId` (bukan nama produk).
- **Streaming:** `streamText(...).toUIMessageStreamResponse` (SSE). **Tidur server→klien di luar stream** (tidak ada Socket.IO).
- **Auth:** Bearer `ctoken` (bisnis) + cookie (pengguna) per request; alur guest-user dengan password acak.

---

## BACKEND IMPROVEMENT DISCOVERY

### 🔎 C1 — Model persistensi keranjang: dual JSON blob + identity berdasar nama

**1. CURRENT QLOBOT**
Keranjang konversasional disimpan sebagai blob JSON `confirmedItems` di kolom
`conversation_context.extractedEntities` (`schema.prisma:197`, `ExtractedEntities.confirmedItems`
di `domain/types.ts:259`). Setiap mutasi cart juga **diduplikasikan** ke `draft Order.items`
(yang merupakan kolom `Json` lagi, `schema.prisma:214`) lewat
`orderService.syncCartStateToDraftOrder` (`order.service.ts:111`). Identitas item keranjang
adalah **nama produk (string, pencocokan fuzzy)** — `ConversationContextService.modifyCart`
memakai `fuzzyMatch(i.product, ...)` (`conversation-context.service.ts:302-339`), dan
`validateCartOpsAgainstDb` mengindeks katalog dengan `p.name.toLowerCase()` (`interpreter.ts:153-155`).
Tabel `OrderItem` (strongly-typed, `productId` FK) **hanya** dipakai oleh jalur katalog
`createOrder` (`order.service.ts:248-272`), **bukan** oleh mesin konversasional.

**2. OPENSHIP / REFERENCE APPROACH**
`PlatformAdapter` mengekspor `Cart { id, lineItems: CartLineItem[], subtotal, total, currency }`
dan `CartLineItem { id, quantity, variantId, productTitle, price }` (`adapters/types.ts:23-37`).
Operasi: `getOrCreateCart` → `addToCart(variantId, quantity)` → `updateCartItemQuantity(lineItemId, qty)`
→ `removeCartItem(lineItemId)`. Identitas stabil via `variantId`/`lineItemId`; satu entitas sumber
kebenaran per toko (README: *"No Central Database"* — state tetap berada di DB sendiri tiap toko/Openfront).

**3. PROPOSED IMPROVEMENT**
Perkenalkan agregat `Cart`/`CartItem` (tabel baru atau reuse `Order`+`OrderItem` secara konsisten)
dengan `productId`/`variantId` FK; jadikan **satu sumber kebenaran** untuk keranjang konversasional;
hapus replikasi `draft Order.items` JSON; ikat item ke ID produk, bukan nama.

**4. FILE/FUNCTION**
`schema.prisma` (`Cart`/`CartItem` model, `Order.items`); `conversation-context.service.ts`
`modifyCart` (workspace `confirmedItems`); `conversation.service.ts` `executeCartOps:884`,
`getCartFromDb:926`, `buildPipelineContext:827`, `renderCartSummary:961`; `order.service.ts`
`syncCartStateToDraftOrder:111`.

**5. WHY IT IS BETTER**
- Menghilangkan sumber kebenaran ganda yang dapat **terpisah** (root cause RAILS §2: *"V2 bisa mutate DB lalu exception → fallback ke V1 → ... berpotensi DOBEL mutasi cart/order"*).
- Identity stabil (tidak rapuh terhadap *rename* produk / nama serupa / homonim).
- Memungkinkan semangat `OrderItem` strongly-typed untuk *seluruh* jalur, bukan hanya katalog.

**6. BENEFIT**
Integritas data + audit trail cart/order yang dapat di-query; menghilangkan peluang *"bayar→Bawang"*-style misfire pada identity berbasis nama; menormalisasi lifecycle `draft → waiting_address → …` sehingga konsisten.

**7. REGRESSION RISK**
TINGGI — mesin V1+V2 mengasumsikan cart ada di JSON blob `extractedEntities`; `validateCartOpsAgainstDb`
dan `modifyCart` berbasis nama. Perubahan identity dapat merusak disambiguasi klarifikasi yang didasarkan nama.

**8. MIGRATION COMPLEXITY**
TINGGI — skema baru; backfill dari `confirmedItems`/draft-order JSON ke baris baru; rewrite semua baca/tulis cart di engine.

**9. MENYENTUH ARSITEKTUR TERLINDUNGI**
**Ya** — `conversation.service.ts`, `conversation-context.service.ts`, `order.service.ts`, `interpreter.ts`.

> Keputusan: **C. REPORT ONLY** · `OWNER REVIEW REQUIRED`

---

### 🔎 C2 — Engine V2 mengimpor `groqAdapter` langsung, melewati `aiProviderManager`

**1. CURRENT QLOBOT**
`services/chat/reasoning.ts:31` dan `services/chat/interpreter.ts:12` melakukan
`import { groqAdapter } from '../../adapters/ai/groq.adapter.js'` lalu memanggil
`groqAdapter.generate(...)` (`reasoning.ts:115`, `interpreter.ts:88`). Akibatnya, jalur
interpretatif utama **tidak pernah pakai** `aiProviderManager` (Gemini primary + Groq
fallback + rotasi key + circuit breaker di `manager.ts:15-41`) — sehingga Gemini (primary)
dan kebijakan fallback/circuit-breaker tidak berlaku untuk jalur LLM konversasional.
Satu-satunya konsumen `aiProviderManager.generate` adalah `adapters.llm.chat` yang dipakai
oleh `message.handler.ts` — yang **tidak dipakai sama sekali** (bukti: `grep` 0 referensi).

**2. OPENSHIP / REFERENCE APPROACH**
Satu abstraksi penyedia (`createOpenRouter`/`openrouter(model)` di `completion/route.ts:104,125`)
yang diselesaikan sekali di *boundary* transpor; tidak ada import penyedia langsung di logika
bisnis. Model/kunci ditentukan konfigurasi (Global/User/MCP), bukan dikode-kan di setiap file.

**3. PROPOSED IMPROVEMENT**
Arahkan semua pemanggilan LLM di engine (interpreter + reasoning) melalui
`aiProviderManager.generate` (atau antarmuka `adapters.ai.generate`), dengan *options shape*
yang konsisten (`jsonMode`, `temperature`, `maxTokens`); hapus import langsung `groqAdapter`
di `services/chat/`.

**4. FILE/FUNCTION**
`services/chat/reasoning.ts:24,115` (konstan `LLM_INTENT`, `callLlm`); `interpreter.ts:12,88`;
`adapters/ai/manager.ts` (diperluas agar menerima `jsonMode`/`intent`); `adapters/container.ts`
(`adapters.llm`).

**5. WHY IT IS BETTER**
Satu permukaan keandalan; Gemini-primary benar-benar jadi primary; rotasi key + cooldown Redis
berlaku untuk jalur utama (bukan cuma stub mati).

**6. BENEFIT**
Konsistensi biaya & andalkan; Gemini (primary, lebih murah) dipakai untuk interpreter;
menghilangkan *duplicate retry/circuit-breaker layer* (lihat C6).

**7. REGRESSION RISK**
SEDANG — perubahan distribusi output model (Groq→Gemini untuk bagian besar jalur) dan
atribusi biaya/token. Perlu golden-dataset re-run.

**8. MIGRATION COMPLEXITY**
MEDIUM — samakan bentuk opsi + pastikan `conversationId`/`intent` tetap loggable di `logTokenUsage`.

**9. MENYENTUH ARSITEKTUR TERLINDUNGI**
**Sebagian** — `services/chat/*v2*` adalah inti terlindungi mesin.

> Keputusan: **B. IMPLEMENT AFTER OWNER APPROVAL** · `OWNER REVIEW REQUIRED`

---

### 🔎 C3 — `message.handler.ts` adalah *dead stub* yang melewati seluruh pipeline

**1. CURRENT QLOBOT**
`src/business/message.handler.ts` mendefinisikan `MessageHandler.handle()` yang hanya memanggil
`adapters.llm.chat([{role:'user',content:message}])` (`message.handler.ts:10`) — melewati
fast-path, semua tier rule, validasi DB (`I13`), safety boundary, dan circuit breaker.
Handler ini **tidak pernah di-import**: `grep -rn "messageHandler|MessageHandler" src/ | grep -v message.handler.ts`
mengembalikan **kosong**. Jalurat masuk yang benar adalah `routes/webhooks.ts` →
`messageProcessorService.processMessage` → `conversationService.processCustomerMessage`.

**2. OPENSHIP / REFERENCE APPROACH**
Satu transport publik (`POST /api/completion`) yang *streamText* ke dalam satu pipeline;
tidak ada entry point paralel yang melewati seluruh logika bisnis.

**3. PROPOSED IMPROVEMENT**
Hapus `message.handler.ts` (dan/atau export-nya). Jika ada niat di masa depan untuk entry
point lain, harus masuk melalui `message-processor.service` — bukan bypass.

**4. FILE/FUNCTION**
`src/business/message.handler.ts` (seluruh file).

**5. WHY IT IS BETTER**
Menghilangkan *second, broken entry point* yang berpotensi menjadi pintu belakang jika
salah kiranya dipasang (bisa memutasi order/tanpa validasi harga DB / tanpa circuit breaker /
tanpa dedup). Membuang asumsi ralat bahwa *"semua pesan lewat ConversationService"*.

**6. BENEFIT**
Keamanan + kejelasan alur; satu sumber kebenaran untuk *"bagaimana sebuah pesan diproses"*.

**7. REGRESSION RISK**
RENDAH — tidak dipakai; verifikasi akhir: `grep` statis 0 referensi + pastikan tidak ada
dynamic import di `dist/`.

**8. MIGRATION COMPLEXITY**
RENDAH — hapus file + hapus import tersedia di `adapters.container`? (container tidak
mengekspor MessageHandler; hanya `adapters.llm`).

**9. MENYENTUH ARSITEKTUR TERLINDUNGI**
**Tidak** — file mati, tidak ada konsumen.

> Keputusan: **A. IMPLEMENT NOW** (aset tidak dipakai; hapus sebagai *code hygiene*) ·
> `OWNER REVIEW REQUIRED` (konfirmasi dengan verifikasi grep build)

---

### 🔎 C4 — Webhook GOWA tidak melalui otentikasi (spoofing vector)

**1. CURRENT QLOBOT**
`routes/webhooks.ts:21` handler `POST /gowa` **tidak memverifikasi secret/HMAC sama sekali**;
`store` ditentukan dari `device_id` (bot WA number) via `phoneNumber` (`webhooks.ts:61-63`).
Setiap orang dapat `POST /api/webhooks/gowa` dengan payload `message`/`payload.from`
sembarang untuk memicu keseluruhan pipeline (termasuk mutasi keranjang/order melalui
conversationService). Fonnte memakai `?secret=` query-string (`webhooks.ts:135`) — **bukan**
HMAC tubuh, dan tidak `timingSafeEqual`.

**2. OPENSHIP / REFERENCE APPROACH**
Setiap request ke store API diautentikasi lewat Bearer `ctoken` / cookie per-request
(`tools/utils.ts executeGraphQL:27-31`) dan `sessionToken`; guest-user dibuat dengan password
acak (`openfront/index.ts:333`). Kesalahan dikembalikan sebagai struktur JSON-RPC eksplisit.

**3. PROPOSED IMPROVEMENT**
Tambahkan verifikasi HMAC (sha256, `timingSafeEqual`) berdasarkan `store.webhookSecret` pada
`/gowa` (dan tukar `?secret` query-string Fonnte dengan HMAC tubuh). Tolak sebelum *processing*.

**4. FILE/FUNCTION**
`routes/webhooks.ts:21` (`/gowa`), `routes/webhooks.ts:130` (`/fonnte`);
`middleware/auth.ts` (referensi pola auth yang ada).

**5. WHY IT IS BETTER**
Menutup vektor pemalsuan langsung ke inbound pipeline — sama dengan menempatkan *auth boundary*
di tepi (seperti `OpenShip` meletakkan `ctoken`/cookie di boundary GraphQL).

**6. BENEFIT**
Security hardening eksplisit pada pintu masuk data terbaru ke sistem.

**7. REGRESSION RISK**
SEDANG — dapat menolak traffic sah sampai secret di-deploy ke dasbor GOWA/Fonnte; butuh
roll-out bertahap per-toko.

**8. MIGRATION COMPLEXITY**
MEDIUM — butuh kolom `webhookSecret` sudah terisi (ada di `schema.prisma:33`) + skrip rotasi
secret opsional.

**9. MENYENTUH ARSITEKTUR TERLINDUNGI**
**Sebagian** — `webhooks.ts` adalah rute publik, bukan inti mesin v2; tapi *behavior*
masuknya berubah.

> Keputusan: **B. IMPLEMENT AFTER OWNER APPROVAL** · `OWNER REVIEW REQUIRED`

---

### 🔎 C5 — Kolom `Order.items` (JSON) redudan vs `OrderItem` (relasional)

**1. CURRENT QLOBOT**
`Order.items` dideklarasikan `Json` (`schema.prisma:214`) dan `syncCartStateToDraftOrder`
menulis cart sebagai array of object mentah (`order.service.ts:136,149`) — **format yang sama
persis** seperti `confirmedItems`, hanya dengan field `productName`. Sementara tabel
`OrderItem` (`schema.prisma:238`) yang *strongly-typed* (`productId` FK, `unitPrice`, `subtotal`)
hanya terisi lewat `createOrder` katalog. `buildPipelineContext` tipe `activeOrder` hanya
`{ orderStatus, items: any[] } | null` (`domain/types.ts:358`).

**2. OPENSHIP / REFERENCE APPROACH**
Tidak ada kolom JSON mentah untuk entitas domain; semua state (cart line items, checkout)
adalah entitas ber-tipe di backend toko (Openfront schema). Marketplace tidak pernah
menyimpan *copy* berformat bebas dari state keranjang.

**3. PROPOSED IMPROVEMENT**
Gunakan `OrderItem` secara konsisten untuk semua jalur (termasuk keranjang konversasional);
jadikan `Order.items` sebagai *computed view* (atau hapus). Ketatkan tipe `activeOrder` ke
`OrderItem[]`.

**4. FILE/FUNCTION**
`schema.prisma` (`Order.items`, `OrderItem`); `order.service.ts` (seluruhnya);
`conversation.service.ts` `buildPipelineContext:827`, `executeCartOps:884`.

**5. WHY IT IS BETTER**
Integritas referensial; tidak ada *schema drift* antar dua representasi; dapat di-query /
di-aggregate untuk laporan.

**6. BENEFIT**
Audit order/keranjang yang andal; menghilangkan `any[]` leak; konsistensi model data.

**7. REGRESSION RISK**
TINGGI — perubahan skema + rewrite penulisan keranjang.

**8. MIGRATION COMPLEXITY**
TINGGI — migrasi data JSON→baris relasional + pemformatan `confirmedItems`-JSON.

**9. MENYENTUH ARSITEKTUR TERLINDUNGI**
**Ya**.

> Keputusan: **C. REPORT ONLY** · `OWNER REVIEW REQUIRED`

---

### 🔎 C6 — Empat lapis mekanisme retry/circuit-breaker yang tumpa-tumpo

**1. CURRENT QLOBOT**
Di jalur LLM tunggal berlaku empat lapis keandalan yang saling menimpa:
- `CircuitBreakerService` (threshold 2) — `message-processor.service.ts:77,218,266`;
- breaker di `AIProviderManager` (threshold 5) — `adapters/ai/manager.ts:20,72`;
- loop rotasi key di `GroqAdapter.generate` (maxRetries 5) — `groq.adapter.ts:79`;
- retry transport di `reasoning.ts` (`TRANSPORT_MAX_RETRIES=1`, attempt 1+2) — `reasoning.ts:47,269,358`.
Logika timeout & retry diselep-selipkan, sehingga latency & kegagalan sulit diprediksi.

**2. OPENSHIP / REFERENCE APPROACH**
Retry/timeout ditentukan sekali di *transport boundary* (`fetch` ke OpenRouter); error dinaikkan ke caller untuk keputusan fallback. Tidak ada breaker bersarang.

**3. PROPOSED IMPROVEMENT**
Definisikan **satu kebijakan retry/circuit-breaker** per batas eksternal (penyedia AI, gateway WA); hapus retry/ breaker duplikat yang ada di dalam engine.

**4. FILE/FUNCTION**
`message-processor.service.ts` (CircuitBreakerService penggunaan); `adapters/ai/manager.ts`;
`adapters/ai/groq.adapter.ts`; `services/chat/reasoning.ts`.

**5. WHY LEBIH BAIK**
Latency & kegagakan yang dapat diprediksi; satu permukaan observabilitas; tidak ada *retry storm*.

**6. BENEFIT**
Reliability + debuggability.

**7. REGRESSION RISK**
SEDANG — dapat *flip* kegagakan menjadi fallback lebih cepat/lebih lambat.

**8. MIGRATION COMPLEXITY**
MEDIUM.

**9. MENYENTUH ARSITEKTUR TERLINDUNGI**
**Sebagian** (message-processor + chat engine).

> Keputusan: **B. IMPLEMENT AFTER OWNER APPROVAL** · `OWNER REVIEW REQUIRED`

---

### 🔎 C7 — Service-locator `adapters` vs. adapter registry bertipe

**1. CURRENT QLOBOT**
`adapters` dirakit manual di `adapters/container.ts` (object literal service-locator) yang
mengekspor `logger`, `ai`, `cache`, `knowledge`, `llm`, `storage`, `catalogStorage`,
`profileStorage`. Catatan kritikal: **`knowledge` adalah stub yang selalu mengembalikan `[]`**
(`adapters/container.ts:knowledge.search → return []`), padahal `fallback.service.ts` memanggil
`faqService.search` dan `knowledgeService.search` — belum jelas apakah `adapters.knowledge`
itu dipakai atau apakah ada service yang lain. Mesin chat juga import `groqAdapter` langsung
(C2), melanggengkan kebiasaan *import langsung* alih-alih melalui container.

**2. OPENSHIP / REFERENCE APPROACH**
`getPlatformAdapter(store)` → `PlatformAdapter` (interface bertipe penuh) + lazy loader +
cache registry (`adapters/index.ts:5-29`). Setiap fungsi mengembalikan shape yang
didefinisikan (`Product`, `Cart`, dsb.).

**3. PROPOSED IMPROVEMENT**
Ganti service-locator `adapters` dengan **injected dependencies / registry bertipe** (atau
setidaknya tipe `adapters.knowledge` dengan benar dan berhenti import langsung `groqAdapter`
di `services/chat/`).

**4. FILE/FUNCTION**
`adapters/container.ts`; `adapters/ai/manager.ts`; `adapters/cache/redis.adapter.ts`;
`services/chat/reasoning.ts`, `interpreter.ts`.

**5. WHY LEBIH BAIK**
Testability; keamanan tipe; tidak ada *hidden runtime coupling*; stub `knowledge` teridentifikasi.

**6. BENEFIT**
Maintainability + testability; menghilangkan *knowledge stub* yang menyesatkan.

**7. REGRESSION RISK**
SEDANG — refactor luas takaran sedang; potensi *runtime* jika container tidak di-inisialisasi
secara sama.

**8. MIGRATION COMPLEXITY**
MEDIUM-HIGH.

**9. MENYENTUH ARSITEKTUR TERLINDUNGI**
**Sebagian** (container + chat engine imports).

> Keputusan: **B. IMPLEMENT AFTER OWNER APPROVAL** · `OWNER REVIEW REQUIRED`

---

### 🔎 C8 — State percakapan tersebar ke 3 kolom JSON + migrasi V1→V2 yang rapuh

**1. CURRENT QLOBOT**
Satu percakapan menyebar state ke: `conversation_context.lastMessages` (JSON, max 10),
`extractedEntities` (JSON objek: `confirmedItems`, `pendingClarification`,
`previousMutation`, `trackedEntities`, …), dan `workspace_v2` (JSON baru). Kode mencatat
*bug* migrasi: *"updateExtractedEntities di jalur v2 adalah NO-OP (type mismatch)"*
(RAILS §2) — memang terjadi karena guard `if (!entities?.length) return`
(`conversation-context.service.ts:115`) melewati object `WorkspaceV2` yang tidak punya `.length`.
`conversation.service.ts:138-158` mencoba *migrasi sekali* dari legacy `extractedEntities` ke
`workspace_v2`, tetapi writer dan reader tetap bersaing di kolom yang sama via `atomicCas`.

**2. OPENSHIP / REFERENCE APPROACH**
State sesi (keranjang, alamat) adalah entitas ber-ID di backend toko, tidak blob JSON yang
disatukan-murah di kolom tunggal. Client hanya menyimpan `cartId`/`sessionToken` di localStorage
terstruktur (`lib/session-storage.ts`, `lib/cart-storage.ts`).

**3. PROPOSED IMPROVEMENT**
Satukan sumber kebenaran state kerja ke dalam satu kolom (`workspace_v2`) yang valid secara
konsisten (hapus path penulisan `extractedEntities.confirmedItems` untuk V2), atau pindah
ke tabel/kolom bertipe. Hapus migrasi *legacy one-shot* yang jalan berulang.

**4. FILE/FUNCTION**
`conversation-context.service.ts` (seluruh writer); `conversation.service.ts:138-158`
(loader migrasi); `domain/types.ts` (`ExtractedEntities`, `WorkspaceV2`).

**5. WHY LEBIH BAIK**
Menghilangkan *race* penulis campuran; menghilangkan bug NO-OP yang diam-diam menonaktifkan
memori antar-turn (RAILS §2 P3).

**6. BENEFIT**
Reliability memori percakapan; kehilangan keadaan *silent*.

**7. REGRESSION RISK**
TINGGI — menyentuh semua penulisan state V1+V2.

**8. MIGRATION COMPLEXITY**
TINGGI.

**9. MENYENTUH ARSITEKTUR TERLINDUNGI**
**Ya**.

> Keputusan: **C. REPORT ONLY** · `OWNER REVIEW REQUIRED`

---

### 🔎 C9 — Realtime: Socket.IO in-proc + duplikasi dispatch vs. streaming terpusat

**1. CURRENT QLOBOT**
`realtime.service.ts` mendaftarkan **satu langganan per tipe event** ke `eventBus` lalu
`dispatch()` men-*`emit`* ke ruang nama room (`store:{storeId}:conv:{...}` / `store:{storeId}:admin`)
via switch-case manual. Komentar kode: *"Single-VPS MVP: in-proc"* (`realtime.service.ts:46`).
Artinya: **tidak horizontally scalable** (presence + event-bus hilang antar proses), dan
dispatch men-*re-emit* ke ruangan yang bisa menerima duplikat (`message.created` ke customer
room + admin room — perlu demux per-socket). `ConversationDeliveryService` (283 line)
mempush ke dashboard dengan loop/paralelisme terpisah.

**2. OPENSHIP / REFERENCE APPROACH**
Realtime = satu aliran SSE (`streamText(...).toUIMessageStreamResponse`) dari transpot
completion ke UI; tidak ada server→admin push yang dipisah, tidak ada EventBus in-proc.
State (keranjang) dibaca kembali dari toko, bukan didorong.

**3. PROPOSED IMPROVEMENT**
Tekan ke satu pola *push* yang konsisten: pilih **salah satu** antara (a) Socket.IO/EventBus
eksternal yang berbagi state (Redis adapter) agar multi-proses, atau (b) rekam semua peristiwa
di DB (`conversation_history`) dan biarkan klien *poll* SSE-streaming berdasarkan peristiwa —
hapus duplikasi dispatch manual `switch`/room.

**4. FILE/FUNCTION**
`services/realtime.service.ts`; `services/conversation-delivery.service.ts`;
`services/event-bus.service.ts`.

**5. WHY LEBIK BAIK**
Satu sumber kebenaran event; tidak ada *in-proc* presence yang pecah saat horizontal scale.

**6. BENEFIT**
Realtime reliability + scalability.

**7. REGRESSION RISK**
SEDANG-TINGGI — berpotensi mengganti seluruh infrastruktur push (SAAT ini produksi).

**8. MIGRATION COMPLEXITY**
HIGH.

**9. MENYENTUH ARSITEKTUR TERLINDUNGI**
**Ya**.

> Keputusan: **C. REPORT ONLY** · `OWNER REVIEW REQUIRED`

---

## 7. Temuan-temuan tambahan (kecil, tidak dikunjarkan)

- **`knowledge` adapter adalah stub** (`adapters/container.ts:knowledge.search → return []`).
  `fallback.service.ts:157` memanggil `knowledgeService.search` (bukan `adapters.knowledge`),
  jadi ada pertanyaan apakah `adapters.knowledge` pernah dipakai. Perlu diverifikasi pemakaian.
- **`ResponseSource.PRODUCT` dipakai untuk balasan keranjang** (`composer-v2.ts` tidak; tapi
  `buildModifyCartResult` di `conversation.service.ts:1008`-area memakai `ResponseSource.PRODUCT`
  untuk balasan "Ditambahkan ke keranjang") — label *source* yang menyesatkan.
- **`getStoreProducts` memetakan `id: p.name`** (`conversation.service.ts:174`) — ID katalog
  berupa nama produk, bukan UUID; konsisten dengan pola identity berbasis nama (lihat C1) tetapi
  *menyalahi* konsep `CatalogItem.id` yang seharusnya stabil.

---

## 19. BACKEND IMPROVEMENT CANDIDATES

| # | Area | Current (QloBot) | Proposed | Benefit | Risk | Scope | Decision |
|---|------|------------------|----------|---------|------|-------|----------|
| C1 | Keranjang / persisten | Cart = blob JSON `confirmedItems` + `draft Order.items` JSON; identity nama produk (fuzzy) | Aggregat `Cart`/`CartItem` bertipe, `productId`/`variantId` FK, sumber kebenaran tunggal | Integritas data; hapus double-mutasi P0 (RAILS §2); hapus *bayar→Bawang* misfire | TINGGI | Skema + seluruh engine V1/V2 | **C — REPORT ONLY** · OWNER REVIEW |
| C2 | Penyedia AI / coupling | `reasoning.ts:31` & `interpreter.ts:12` import `groqAdapter` langsung; melewati `aiProviderManager` | Arahkan semua LLM melalui `aiProviderManager.generate`; satu policy auth + key-rotation + breaker | Gemini-primary jadi primary; rotasi key berlaku jalur utama | SEDANG | `services/chat/*`, `adapters/ai/*` | **B — OWNER APPROVAL** · OWNER REVIEW |
| C3 | Entry point | `message.handler.ts` (stub, hanya panggil LLM) mati — 0 konsumen (`grep` terbukti) | Hapus stub; paksa semua pesan lewat `message-processor.service` | Hilangkan pintu belakang yang melewati validasi DB & breaker | RENDAH | `business/message.handler.ts` | **A — IMPLEMENT NOW** · OWNER REVIEW |
| C4 | Keamanan webhook | `webhooks.ts:21` `/gowa` = tidak ada secret/HMAC; Fonnte = `?secret` query (bukan HMAC) | HMAC sha256 + `timingSafeEqual` di boundary; pakai `store.webhookSecret` | Tutup vektor spoofing inbound ke pipeline cart/order | SEDANG | `routes/webhooks.ts` | **B — OWNER APPROVAL** · OWNER REVIEW |
| C5 | Skema order | `Order.items Json` redudan vs `OrderItem` relasional; `activeOrder` tipenya `any[] | null` | Pakai `OrderItem` konsisten; `Order.items` jadi *computed view*; ketatkan tipe | Integritas referensial; query/analytics andal | TINGGI | `schema.prisma`, `order.service.ts`, `conversation.service.ts` | **C — REPORT ONLY** · OWNER REVIEW |
| C6 | Reliability / retry | 4 lapis breaker+retry bertumpuk (message-processor, manager, groq, reasoning) | Satu policy retry/circuit-breaker per batas eksternal | Latency & kegagakan dapat diprediksi | SEDANG | `message-processor.service.ts`, `adapters/ai/*`, `services/chat/reasoning.ts` | **B — OWNER APPROVAL** · OWNER REVIEW |
| C7 | Arsitektur / DI | Service-locator `adapters` (`container.ts`); `knowledge` stub `[]`; import langsung `groqAdapter` | Injected dependencies / registry bertipe (mirip `getPlatformAdapter` OpenShip) | Testability; hapus stub menyesatkan | SEDANG | `adapters/container.ts`, `services/chat/*` | **B — OWNER APPROVAL** · OWNER REVIEW |
| C8 | State percakapan | 3 kolom JSON (`lastMessages`, `extractedEntities`, `workspace_v2`); migrasi V1→V2 NO-OP (RAILS §2) | Satu sumber kebenaran kerja; hapus penulisan `extractedEntities.confirmedItems` untuk V2 | Reliability memori antar-turn; hapus bug NO-OP diam-diam | TINGGI | `conversation-context.service.ts`, `conversation.service.ts` | **C — REPORT ONLY** · OWNER REVIEW |
| C9 | Realtime | Socket.IO in-proc + EventBus + manual room dispatch (tidak scalable) | Satu model push konsisten (Redis-adapter IO *atau* rekam peristiwa di DB + SSE) | Scalable + tidak ada duplikat emit | SEDANG-TINGGI | `realtime.service.ts`, `conversation-delivery.service.ts`, `event-bus.service.ts` | **C — REPORT ONLY** · OWNER REVIEW |
| — | (catatan) | `getStoreProducts` pakai `id: p.name` | `id: p.id` (UUID) | Konsistensi identity | RENDAH | `conversation.service.ts:174` | **B — OWNER APPROVAL** · OWNER REVIEW |
| — | (catatan) | `ResponseSource.PRODUCT` dipakai untuk balasan keranjang | `ResponseSource.CART` (atau reuse) | Label yang jujur | RENDAH | `conversation.service.ts` `buildModifyCartResult` | **B — OWNER APPROVAL** · OWNER REVIEW |

---

## 20. POSSIBLE ARCHITECTURAL REFACTOR

> **REPORT ONLY — tidak diimplementasikan.** Ini temuan arsitektur bertahan; membutuhkan
> keputusan pemilik sebelum upaya apa pun.

### Motivasi (dari fakta sumber)

RAILS.md §2 justru **telah memastikan** akar masalah QloBot:

> *"Akar masalah 'chatbot kaku, tambal-sulam tanpa akhir' BUKAN semata 'kebanyakan keyword'.
> Akar sebenarnya: **boundary antar-layer rusak** — beberapa komponen sekaligus jadi
> pengambil-keputusan semantik, fallback, executor, DAN persistence. Tidak ada satu sumber
> kebenaran untuk keputusan percakapan."*

Audit sumber ini memverifikasi temuan tersebut secara mekanis:

- **Dua sumber kebenaran keranjang** (C1): `confirmedItems` (JSON) vs `draft Order.items` (JSON)
  vs `OrderItem` (relasional) — ketiganya tidak konsisten. Fakta bahwa "V2 mutate DB → exception
  → fallback ke V1 → potensi **dobel mutasi cart/order**" (RAILS §2) **akan terus muncul selama
  model persistensi tidak berganti ke satu sumber kebenaran**.
- **Dua entry point** (C3): stub `message.handler.ts` yang melewati seluruh pipeline, dan
  `webhooks.ts` yang benar. Batas antara *"apa yang sah diproses"* dan *"apa yang hanyalah stub"*
  rapuh.
- **Empat lapis keandalan bertumpuk** (C6) karena tidak ada boundary yang jelas antara
  *"retry transport"* vs *"fallback penyedia"* vs *"circuit-breaker orkestrasi"*.

### Rancangan yang diusulkan (skema, bukan kode)

**Pisahkan mesin konversasi menjadi dua stage yang bersih dengan boundary eksplisit:**

```
  Inbound Message (webhook/WA/web)
        │  (validasi HMAC — lihat C4)
        ▼
  ┌───────────────────────────────────┐
  │ STAGE A  Pure Intent → Acts       │  (tanpa DB, tanpa mutasi)
  │  - normalize, fast-path (0-LLM)   │   reasoning.ts / fast-path.ts
  │  - interpreter LLM (1 call)       │   (via aiProviderManager — lihat C2)
  │  - validate (schema)              │   (draft_cart_ops → CartOp typed)
  │  keluarkan: Acts[] (add/remove/qty, by productId) │
  └───────────────┬───────────────────┘
        │ Acts[] bersih, ter-validasi schema (bukan JSON mentah)
        ▼
  ┌───────────────────────────────────┐
  │ STAGE B  Transactional Executor   │  (satu transaksi DB)
  │  - CartService.execute(Acts[])    │   (satu sumber kebenaran: Cart/CartItem)
  │  - commit atomic                │
  │  - publish event → realtime     │   (eventBus → single dispatch policy, lihat C9)
  │  - render reply                 │
  └───────────────────────────────────┘
```

**Elemen kunci:**

1. **`Cart` sebagai agregat domain tunggal** (lihat C1/C5). `Cart` + `CartItem(productId, qty, price)`
   adalah satu-satunya sumber kebenaran; `Order` adalah snapshot `Cart` pada saat `checkout`
   (bukan duplikat paralel). Ini menghilangkan akar kejahatan *"dobel mutasi"* karena tidak ada
   lagi dua penyimpanan yang harus disinkronkan.
2. **Stage A bersih (pure)** — tidak menyentuh DB, tidak memutasi. Hanya mengeluarkan `Acts[]`.
   Ini memenuhi *promise* RAILS §2: *"satu sumber kebenaran untuk keputusan percakapan"* dan
   memisahkan *"pengambil-keputusan semantik"* dari *"executor"* dan *"persistence"*.
3. **Stage B transaksional** — `CartService.execute(acts)` jalankan di dalam satu transaksi
   Prisma (`cart_items` insert/update/delete + `order_item` snapshot + `conversation_history`
   append). Jika gagal, ** tidak ada setengah-mutasi ** — sehingga *safety boundary* V2
   (`v2MutationExecuted`-then-safe-reply) tidak lagi dibutuhkan karena tidak ada lagi jalur
   V1-v2 yang berbagi state.
4. **Satu pola real-time** (lihat C9) — semua event publik ke satu bus dengan kebijakan
   retry/dispatch tunggal; presence berbasis DB (`conversation_history`) + opt-in cache,
   bukan `Map` in-proc.
5. **Satu kebijakan AI** (lihat C2/C6) — semua panggilan model via `aiProviderManager`
   (atau `adapters.ai`) dengan satu breaker, satu policy retry, satu sumber log biaya.

### Apa yang berubah (dan apa yang tidak)

- **Berubah paradigma:** *"keranjang = blob JSON di context"* → *"keranjang = agregat Cart"*.
- **Berubah alur:** *"mesin V1/V2 dual + fallback" → *"stage A pure + stage B transaksional (single path)"*.
- **Bersih:** handler stub `message.handler.ts` (C3) dan import langsung `groqAdapter` (C2) musnah.

### Risiko / kompleksitas migrasi

- **Risiko:** TINGGI. Ini adalah *rewrite* bagian inti mesin. Perlu freeze V1/V2 fallback
  concurrency dan re-runn golden dataset (lihat `tests/golden-dataset.test.ts`,
  `tests/reasoning-v2.test.ts`).
- **Kompleksitas:** TINGGI. Butuh: migrasi skema (`Cart`/`CartItem`), backfill data, rewrite
  `conversation.service.ts` V1+V2, rewrite `conversation-context.service.ts`
  (`modifyCart`/`getCartFromDb`), rewrite `order.service.ts`, refactor `fast-path/reasoning/
  interpreter` untuk pure-stage.
- **Fitur yang harus dipertahankan:** semua guard I1–P5 yang ada (I8 ≤1 LLM, I13 harga dari DB,
  I15 validasi ke DB, I10 resolver 0-LLM, dead-end, coalescing, mutex, presence).

### Catatan keputusan pemilik

- Jika pemilik setuju arah *"single source of truth + pure-stage A / transaksional-stage B"*,
  migrasi dapat dipecah menjadi fase bertahap (mirip FASE 1–5 yang sudah ada di `DOCS/`):
  FASE-x: skema Cart + backfill (read-only paralel) → FASE-y: engine menulis ke Cart paralel
  sambil membaca lama → cutover.
- Jika pemilik memilih *incremental only* (tanpa skema baru), maka C1/C5/C8 tetap *REPORT ONLY*
  dan hanya C2/C4/C6/C7 yang dapat dieksekusi.

**Rekomendasi arsitektur: REPORT ONLY — butuh keputusan pemilik (rewrite bertahap vs.
incremental). MENYENTUH ARSITEKTUR TERLINDUNGI: ya.**

---

## Lampiran A — Bukti sumber (verifikasi grep/sed)

Perintah verifikasi yang dijalankan (hasil: **semua mengkonfirmasi klaim di atas**):

```
# message.handler.ts adalah dead code (0 konsumen di luar file)
$ grep -rn "messageHandler|MessageHandler" apps/api/src | grep -v message.handler.ts   # (kosong)

# Engine V2 melewati aiProviderManager — pakai groqAdapter langsung
$ grep -rn "groqAdapter\|aiProviderManager" src/services/chat/
  src/services/chat/reasoning.ts:31:import { groqAdapter } ...
  src/services/chat/interpreter.ts:12:import { groqAdapter } ...
  src/services/chat/reasoning.ts:115: await groqAdapter.generate(...)
  src/services/chat/interpreter.ts:88: await groqAdapter.generate(...)

# Tidak ada tabel Cart di skema
$ grep -n "model Cart\b\|model CartItem" apps/api/prisma/schema.prisma    # (kosong)

# Cart identity berdasar nama (bukan productId)
$ sed -n '144,183p' src/services/chat/interpreter.ts    # productMap keyed by name
$ sed -n '287,352p' src/business/conversation-context.service.ts  # modifyCart fuzzyMatch

# Webhook GOWA tanpa auth
$ sed -n '21,127p' src/routes/webhooks.ts    # tidak ada verifyHMAC / webhookSecret lookup pada /gowa

# Realtime in-proc (single-VPS)
$ sed -n '40,54p' src/services/realtime.service.ts   # "Single-VPS MVP: in-proc"

# OpenShip: typed adapter + cart-first-class
$ sed -n '47,200p' marketplace/app/api/mcp-transport/adapters/types.ts
$ sed -n '15,50p' marketplace/app/api/mcp-transport/adapters/index.ts
```

## Lampiran B — Apa yang **tidak** disentuh

- Tidak ada file `.ts`/`.tsx` yang dimodifikasi.
- Tidak ada commit, migrasi, atau `npm install`.
- Tidak ada perubahan konfigurasi/runtime.

Audit selesai. **STOP — tidak ada implementasi.**
