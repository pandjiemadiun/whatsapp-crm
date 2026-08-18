# Laporan Audit Task P4.0 — READ ONLY

**`extractAndSaveOrder()` sebagai interpreter kedua (second brain)**
Audit read-only: tidak ada perubahan kode. Fokus: apakah `extractAndSaveOrder()`
mengambil keputusan semantik *sendiri* yang dapat bentrok dengan keputusan v2 yang
sudah diproses, dan seperti apa implikasinya.

- **Tanggal audit:** 10 Agu 2026
- **Auditor:** AI (mode plan, read-only)
- **Scope:** `apps/api/src/business/order.service.ts` (`extractAndSaveOrder`)
  + titik panggilnya di `conversation.service.ts` + perbandingan keputusan v2 di
  `reasoning.ts` (`understand`) dan v1 di `interpreter.ts` (`runOneCall`).
- **Kontrak:** RAILS.md §1.4 (catat bug luar scope, jangan fix) + §3
  (trade-off: I8 sudah *guideline*, bukan hard constraint — sehingga P4 BUKAN
  soal "2 LLM call haram", tapi soal *interpreter kedua yang mengambil keputusan
  semantik sendiri*).

> **Metodologi:** semua klaim di bawah didasari bacaan kode langsung
> `file:line` (bukan dugaan). Semua cuplikan kode adalah *verbatim*.

---

## 0. Executive summary (verdict)

`extractAndSaveOrder()` (order.service.ts:101) **tidak** sekadar persist — ia
membuat **keputusan semantik utuh dari LLM-nya sendiri**: intent `buy|inquiry`,
items `[{product, quantity}]`, dan destination (alamat). Ini terjadi lewat
`attemptExtraction()` → `adapters.ai.generate()` (order.service.ts:77), yaitu
sebuah **pemanggilan LLM ketiga** yang mandiri, dengan *prompt*, *provider*,
dan *config* yang **semuanya berbeda** dari v1 (`groqAdapter`, interpreter.ts:88)
dan v2 (`/shadow`) (`groqAdapter`, reasoning.ts:115).

Titik panggilnya (conversation.service.ts:769) berada **di luar blok
`if (engine === 'v2')`** (tutup: conversation.service.ts:377). Akibatnya:

| Jalur engine | v2 `understand()` dijalankan? | `extractAndSaveOrder()` dijalankan? | Bentrok semantik? |
|---|---|---|---|
| `engine === 'v2'` sukses (return 215/279/357) | ✅ ya (live, line 188) | ❌ **TIDAK** — berada di seksi v1-fallback yang tidak terjangkau | Tidak langsung, tapi *dormant* (lihat §6 — dead code di path v2 berhasil) |
| `engine === 'v2'` lempar **sebelum mutasi** → outer catch (367) → *fall through* ke v1 | ✅ ya (line 188, lalu gagal) | ✅ ya — v1 fallback `runOneCall`(618) + `extractAndSaveOrder`(769) | ✅ **konflik 3-muka** (v2 abandon + v1 execute + extractAndSave persist) |
| `engine === 'v1'` (default, termasuk canary bila `SHADOW_MODE=true`) | hanya bila `shouldRunShadow` (line 690, env `SHADOW_MODE`, default `'false'`) | ✅ ya — **selalu**, unconditional (line 769) | ✅ bila shadow aktif: v1(618) + v2-shadow(695) + extractAndSave(769) = 3 interpreter |

**Verdict:** `extractAndSaveOrder()` **adalah interpreter kedua (atau ketiga)**
yang benar-benar ada di production path (v1, default semua tenant kecuali
store-f7140b5c yang eksplisit `v2`). Keputusannya **tidak pernah diverifikasi
ke DB** (kontras dengan v1 `validateCartOpsAgainstDb` interpreter.ts:144) dan
**bisa menyimpan data salah ke tabel `orders`** yang sama yang dipakai v1/v2 —
tanpa *unique guard* dan dengan bentuk item yang berbeda. Ini melanggar I8
(LLM tambahan, tak ter-akuntansi `llmCallCount`) dan I13 (harga tidak dari DB).

---

## 1. Apa yang `extractAndSaveOrder()` putuskan sendiri (semantic) vs. apa yang hanya persist

Sumber: `apps/api/src/business/order.service.ts` (101–155).

### 1a. Yang DISHUBUNGKAN / *putuskan sendiri* (semantic decision dari LLM)

```ts
// order.service.ts:18-30  — EXTRACTION_PROMPT (prompt mandiri, beda dari v1/v2)
const EXTRACTION_PROMPT = `Anda adalah parser JSON. ...
intent: "buy" jika pelanggan ingin MEMBELI (kata kunci: beli, pesan, mau, ambil, order,
saya ingin <produk>). "inquiry" jika hanya bertanya atau minta info.
items: array produk yang disebutkan. ...
quantity: angka. Default 1 jika tidak disebut.
destination: alamat tujuan jika disebut, string kosong jika tidak.`;
```

```ts
// order.service.ts:75-98  — attemptExtraction (memanggil LLM nyata)
async function attemptExtraction(text: string, promptTemplate: string): Promise<ParsedOrder | null> {
  const fullPrompt = `${promptTemplate}\n${text}`;
  const result = await adapters.ai.generate(fullPrompt, { temperature: 0.1, maxTokens: 300 }); // ← LLM CALL #1
  ... parse → validateParsedOrder → return ParsedOrder { intent, items:[{product,quantity}], destination }
}
```

```ts
// order.service.ts:111-117  — pemanggilan LLM + retry (retry prompt hanya ganti shape, bukan semantik v1/v2)
let parsed = await attemptExtraction(message, EXTRACTION_PROMPT);          // line 111
if (!parsed) {
  adapters.logger.info('Retrying ...');
  parsed = await attemptExtraction(message, RETRY_PROMPT);                // line 116 — RETRY_PROMPT:32 hanya re-request JSON, tidak bawa konteks v1/v2
}
```

→ **Yang dipilih oleh `extractAndSaveOrder()` sendiri:**
1. `intent` (`'buy'` | `'inquiry'`) — via keyword `'mau'` di EXTRACTION_PROMPT:24.
2. `items[].product` (nama, **string mentah dari LLM, tidak divalidasi katalog/DB**).
3. `items[].quantity` (angka, **default 1 jika LLM tidak meletakkan angka** — order.service.ts:26).
4. `destination` (alamat, string mentah dari LLM).

**Ini adalah interpreter mandiri:** ia menghasilkan `ParsedOrder` penuh dari
satu pesan mentah (`message` = `normalizedMsg`, lihat §2).

### 1b. Yang hanya PERSIST (dan keputusan apa yang TIDAK dilakukan)

```ts
// order.service.ts:124-148  — persist ke tabel orders (HANYA bila intent === 'buy')
if (parsed.intent === 'buy') {
  const items = parsed.items || [];
  await prisma.order.create({                         // ← ORDER ROW BARU di tabel yang SAMA dengan v1/v2
    data: {
      storeId, conversationId, customerId,
      items: items as any,                            // ← items = [{product, quantity}] — TANPA price/unitPrice/productId
      currency: 'IDR',
      orderStatus: 'pending',
      shippingAddress: parsed.destination || null,
      notes: null,
    },
  });
} else {
  adapters.logger.info('Intent is inquiry, skipping order creation', { conversationId }); // line 147 — tidak persist
}
```

→ **Side effect persist tunggal:** `prisma.order.create` (order.service.ts:128),
membuat baris `orders` baru dengan `orderStatus: 'pending'` (schema.prisma:216).

→ **Yang TIDAK dilakukan oleh `extractAndSaveOrder()` (kontras penting):**
- ❌ **Tidak validasi harga/qty ke DB** — tidak ada panggilan
  `validateCartOpsAgainstDb` (interpreter.ts:144) dan tidak ada
  `productService.getProductById`. Harga sepenuhnya dari hasil *parse LLM mentah*.
- ❌ **Tidak update entitas konteks** — tidak ada panggilan
  `conversationContextService.updateExtractedEntities(...)` (kontras `createOrder`
  order.service.ts:426 yang melakukannya). Jadi keputusan `extractAndSaveOrder`
  **tidak masuk ke memori konteks v2** (`workspace_v2`).
- ❌ **Tidak pakai `executeCartOps` / `modifyCart`** — tidak menulis ke
  `confirmedItems`/draft cart yang sama yang dipakai untuk *reply* customer
  (conversation.service.ts:880-884).
- ❌ **Tidak pakai `orderItems` relation / `totalPrice`** — kontras `createOrder`
  (order.service.ts:393-416) yang membuat `orderItems` dengan `unitPrice` dan
  `totalPrice`. Baris `extractAndSaveOrder` punya `totalPrice = null` dan
  `orderItems = []`.
- ❌ **Return value tidak dipakai** — caller (conversation.service.ts:769) pakai
  `void ... .catch(() => {})`, jadi `ParsedOrder` yang dikembalikan
  **dihancurkan/diacuhkan**. Satu-satunya efek yang "bertahan" adalah side
  effect `prisma.order.create`.

**Kesimpulan §1:** `extractAndSaveOrder()` **bukan persist-only**. Ia menggabung
keputusan semantik (LLM parse) **+** persist dalam satu fungsi yang tak terpisah.
Meng-"keep persist-only" memerlukan *refactor*: mengganti LLM-parsenya dengan
menggunakan keputusan yang **sudah** diputuskan v1/v2 (cart_ops / draft_cart_ops).

---

## 2. Tabel titik panggil (call site) `extractAndSaveOrder()`

Hanya **satu** titik panggil di *source* (produksi):

| No | File:Line | Konteks | Engine path | Pesan masuk | Fire-and-forget? | Terhitung I8? |
|---|---|---|---|---|---|---|
| 1 | `conversation.service.ts:769` | `void orderService.extractAndSaveOrder(conversationId, customerId, storeId, normalizedMsg).catch(() => {})` | **v1-fallback section** (di luar `if (engine==='v2')` :111–:377) — dijalankan bila `engine==='v1'` ATAU `engine==='v2'` lempar sebelum mutasi (outer catch :367 → fall through :379) | `normalizedMsg` (hasil `normalize(customerMessage)`, conversation.service.ts:587) | ✅ ya (`void … .catch`) | ❌ **tidak** — tak increment `llmCallCount` (:402/:616) dan tak push ke `stagesReached` |

Mock di test (bukan panggilan produksi, tapi **bukti bahwa tim sadar ini = real LLM**):

| File:Line | Apa | Bukti implisit |
|---|---|---|
| `golden-dataset.test.ts:15` | komentar: `orderService.extractAndSaveOrder → no-op (prevents *real LLM* in order extraction)` | Menegaskan `extractAndSaveOrder` memanggil LLM secara default di production |
| `golden-dataset.test.ts:60` | `const originalExtractOrder = OrderProto.extractAndSaveOrder;` | Disimpan agar restore bisa dilakukan — berarti ini *behavior* yang ingin diisolasi |
| `golden-dataset.test.ts:251-253` | `OrderProto.extractAndSaveOrder = async () => null;` | **DMock agar tidak memanggil LLM** — artinya tanpa mock, test akan *menyinkron ke LLM nyata dan/atau menulis order ke DB* |
| `golden-dataset.test.ts:271` | restore original | — |

→ **Tidur benar: tidak ada satu pun test yang mengeksekusi `extractAndSaveOrder`
secara *real*.** Perilaku LLM-parsanya dan efek persistnya adalah *blind spot*
terhadap seluruh suite. Tidak ada unit test, tidak ada golden test, tidak ada
shadow-comparison.

---

## 3. Bukti verbatim: keputusan v2 (`understand`) vs keputusan `extractAndSaveOrder`

### 3a. v2 — satu-sumber-kebenaran (semantic authority, P1 selesai)

`reasoning.ts:188` (jalur produksi `engine==='v2'`):
```ts
const reasoningOutcome = await understand(                       // reasoning.ts:188
  customerMessage, workspace, catalog, history, fallbackService, storeId, conversationId
);
```
`understand()` (reasoning.ts:224) lakukan **fast-path (0 LLM)** atau **single-pass
LLM** (`callLlm`, reasoning.ts:106-137) pakai `groqAdapter.generate`
(reasoning.ts:115) dengan `temperature: 0.2`, `maxTokens: 250`, **`jsonMode: true`**,
plus **validator v2** (`validate`, reasoning.ts:293) yang membetulkan/menolak hasil,
plus **retry dengan feedback validator** (reasoning.ts:354-358). Hasil akhir
`draft_cart_ops: DraftCartOp[]` (types-v2.ts:135) dengan `action:'add'|'remove'`,
`product`, `qty`, `qty_source:'explicit'|'default'`, `status:'confirmed'|'needs_clarification'`.

Di v2 produksi, cart ops kemudian divalidasi harga dari DB sebelum mutasi:
```ts
const { valid: dbValid } = await validateCartOpsAgainstDb(ops, storeId);  // conversation.service.ts:232 (v2 resolved)
await this.executeCartOps(dbValid, …);                                      // conversation.service.ts:316 (v2 reasoned)
```

### 3b. v1 produksi (`runOneCall`) — juga divalidasi DB

`interpreter.ts:88`: `groqAdapter.generate(prompt, { temperature:0.2, maxTokens:250, jsonMode:true, intent:'conversation-interpreter' })`.
Hasil `cart_ops` divalidasi harga dari DB di
`validateCartOpsAgainstDb` (conversation.service.ts:628) **sebelum**
`executeCartOps` (conversation.service.ts:630) menulis ke `orders` lewat
`syncCartStateToDraftOrder` (order.service.ts:255) / `addConfirmedItemToOrder`
(order.service.ts:183) — yang menyimpan `ConfirmedItem` lengkap
`{product, qty, price, unit, mentionedAt, confirmedAt}` (domain/types.ts:237-251)
dan `totalPrice` (order.service.ts:282).

### 3c. `extractAndSaveOrder()` — interpreter mandiri, TANPA validasi DB

```ts
const result = await adapters.ai.generate(fullPrompt, { temperature: 0.1, maxTokens: 300 }); // order.service.ts:77
```
- Provider: `adapters.ai.generate` → `aiProviderManager.generate` (container.ts:30 →
  manager.ts:63) — **primary = Gemini**, fallback = Groq (manager.ts:34-36).
- **Beda provider** dari v1/v2 yang pakai `groqAdapter.generate` *langsung*
  (interpreter.ts:88 / reasoning.ts:115).
- **Beda config**: temp `0.1` vs `0.2`; maxTokens `300` vs `250`; **`jsonMode` tidak
  diset** → default `false` (groq.adapter.ts:104). Akibatnya output LLM sering
  bukan JSON murni, sehingga kode harus *salvage* lewat `cleanJsonString`/`
  extractJsonFromText` (order.service.ts:38-98) — **lain mekanisme validasi parse
  v1/v2 yang pakai `jsonMode:true` + `JSON.parse` langsung** (interpreter.ts:96,
  reasoning.ts:121).
- **Tidak melewati validator v2 / `validateCartOpsAgainstDb`** — items disimpan
  apa adanya: `items: items as any` = `[{product, quantity}]` (order.service.ts:133),
  tanpa `price`, tanpa `productId`, tanpa `orderItems`, `totalPrice=null`
  (schema.prisma:214 `totalPrice Float?`).

---

## 4. Skenario konkret: bentrok v2 vs `extractAndSaveOrder`

### Skenario A — "phantom `pending` order" menyaingi draft order (TINGGI)

1. Pesan customer: `"mau 3 ayam goreng"`.
2. v1 path (`engine==='v1'`, default): `runOneCall` (conversation.service.ts:618)
   → `cart_ops:[{add, ayam goreng, qty:3}]` → `validateCartOpsAgainstDb`
   (interpreter.ts:144, harga dari DB Rp 12.000) → `executeCartOps` (line 859)
   → `modifyCart` + `syncCartStateToDraftOrder` (order.service.ts:255)
   → **draft order** `status='draft'`, items `ConfirmedItem` lengkap, `totalPrice`
   terisi. Customer balas *" ayam goreng ×3 — Rp 36.000 "* (renderCartSummary
   conversation.service.ts:946-956). ✅ konsisten.
3. Kemudian (line 769) `extractAndSaveOrder` berjalan — **LLMnya mem-parsing
   ulang** dan bisa saja salah:
   - `quantity` salah baca → `items:[{product:'ayam goreng', quantity:1}]`
     (default 1, order.service.ts:26),
   - atau `intent:'buy'` walau memang order (ini benar) tapi **qty berbeda (1 vs 3)**.
4. `extractAndSaveOrder` kemudian `prisma.order.create` (order.service.ts:128) →
   **baris order `status='pending'` baru** di tabel yang SAMA (`orders`),
   `@@index([conversationId])` schema.prisma:230 — **bukan `@@unique`** → tidak
   ada *guard* duplikat. Baris baru ini punya `items=[{product:'ayam goreng',
   quantity:1}]`, `totalPrice=null`, `orderItems=[]`.
5. **Efek:** satu `conversationId` kini punya ≥2 baris order: `draft` (qty 3,
   harga jelas) + `pending` (qty 1, tidak ada harga). Pada *turn berikutnya*,
   `activeOrder` lookup (conversation.service.ts:829) memilih **terbaru**
   (`orderBy:{createdAt:'desc'}`, `orderStatus:{notIn:['shipped','delivered','cancelled']}`)
   → justru **memilih baris `pending` hasil `extractAndSaveOrder`** (terbaru, lolos
   filter `notIn`). Maka:
   - `pipelineCtx.activeOrder` (conversation.service.ts:847) = baris
     *phantom*, dan isi `items`-nya (shape `{product, quantity}`, tanpa `price`)
     disulihkan ke prompt v1 di `interpreter.ts:66-70`:
     ```ts
     // interpreter.ts:66-70
     const orderInfo = ctx.activeOrder
       ? `status=${ctx.activeOrder.orderStatus}, items=${ctx.activeOrder.items
           .map((i: any) => i.product || i.productName)   // ← akan baca phantom pending row
           .join(', ')}` : 'tidak ada order aktif';
     ```
     → **konteks LLM tersensori** dengan state order yang salah.
   - `fallback.service.ts:649-661` (tier `tryTotal`) jika `confirmedItems` kosong
     akan *fallback* ke `lastOrder` terbaru = baris phantom, lalu
     `items = JSON.parse(lastOrder.items)` (fallback.service.ts:660) →
     `ConfirmedItem[]` dengan `qty` *undefined* (karena fieldnya `quantity`
     bukan `qty`) → `renderCartSummary` conversation.service.ts:949
     `Number(i.qty||0)>0` → semua **terfilter kosong** → pelanggan lihat
     *"Keranjang kosong"* padahal baru saja order 3 ayam goreng. **Data salah
     tersimpan yang konsumen bisa lihat.**

   Paralelnya, `getOrdersByConversation`/`getRecentConversations`
   (conversation.service.ts:1139, :1231 → `mapConversationWithContext`, :1261)
   **mengekspor seluruh baris order termasuk phantom** ke dashboard owner —
   owner melihat order `pending` palsupati dengan item tidak lengkap & tak
   berharga.

### Skenario B — `intent:'buy'` palsu dari pertanyaan (TINGGI)

`EXTRACTION_PROMPT` (order.service.ts:24) memicu `'buy'` untuk kata `'mau'`:
> `intent: "buy" jika pelanggan ingin MEMBELI (kata kunci: beli, pesan, mau, ambil, order, saya ingin <produk>)`.

- Pesan: `"mau tanya ayam goreng ada stok?"` (pertanyaan stok, **bukan order**).
- v1 `runOneCall` → `intent:'product_info'`, `cart_ops:[]` (tidak eksekusi).
- v2 `understand()` (shadow) → `draft_cart_ops:[]`, intent termasuk `product_info`.
- `extractAndSaveOrder` → kata kunci `'mau'` → `intent:'buy'`, items
  `[{product:'ayam goreng', quantity:1}]` → **`prisma.order.create` baris
  `pending` palsu** untuk produk yang tidak disuburnasikan, tak ada harga,
  tak ada validasi stok/produk. → **phantom order** yang mewujiuk.

### Skenario C — quantity mismatch (Sedang)

- Pesan: `"mau ayam goreng dan nasi goreng, masing-masing 2"`.
- v1/v2: `ayam goreng ×2`, `nasi goreng ×2`.
- `extractAndSaveOrder` (LLM mandiri, temp 0.1, tanpa jsonMode, prompt sederhana)
  dapat parse `masing-masing` dengan cara berbeda → mis.
  `[{product:'ayam goreng', quantity:2},{product:'nasi goreng', quantity:1}]`
  atau default 1. → qty berbeda dari yang terkonfirmasi ke customer / dikeranjang
  v1/v2. (Rentan karena tidak ada contoh *few-shot* / konteks keranjang / katalog
  di `EXTRACTION_PROMPT` — kontras v1 `runOneCall` yang sertakan
  `productCatalog`, `cartSummary`, `orderInfo`, `FEW_SHOT`.)

### Skenario D — destination (alamat) lepas (Sedang)

- `extractAndSaveOrder` menulis `shippingAddress: parsed.destination` (order.service.ts:136)
  dari *parse LLM mentah* — tidak ada validasi. Jika customer sebut alamat sebagian
  (`"kirim ke jakarta"`), atau sama sekali tidak, alamat order bisa kosong/`null`
  atau salah. v1/v2 menentukan alamat lewat *tier* `tryShipping`/`trySop` + context
  `shippingAddress` kolom konteks (domain/types.ts:262) — sumber berbeda, bisa
  bentrok. Order `pending` di schema.prisma:217 (`shippingAddress String?`) punya
  alamat yang berbeda dari yang lain.

---

## 5. Efek samping di luar keputusan semantik

`extractAndSaveOrder()` memiliki **satu satu-satunya side effect persist**:
`prisma.order.create` (order.service.ts:128) ketika `intent==='buy'`. Detail:

| Aspek | `extractAndSaveOrder` (order.service.ts) | v1 persist (order.service.ts) | v2 persist |
|---|---|---|---|
| Tabel | `orders` (schema.prisma:208) | `orders` (draft) | `orders` (draft) via `executeCartOps`→`syncCartStateToDraftOrder` |
| `orderStatus` | `'pending'` (125/135) | `'draft'` (202) `/ 'pending'` (createOrder:401) | `'draft'` |
| `items` shape | `[{product, quantity}]` mentah (133) — **tanpa price/unitPrice/productId** | `ConfirmedItem` + `orderItems` relasi (393-416) | `ConfirmedItem` lewat `modifyCart` |
| `totalPrice` | `null` (tidak diset) | terhitung dari DB (282) | terhitung dari DB |
| Validasi harga DB | ❌ tidak ada | ✅ `validateCartOpsAgainstDb` (interpreter.ts:144) | ✅ `validateCartOpsAgainstDb` |
| Sync ke konteks v2 (`workspace_v2`) | ❌ tidak ada | v1 → `extractedEntities` (legacy) | ✅ (via modifyCart pada workspace) — *tapi* RAILS §2: workspace persist masih ada masalahnya (lihat STATUS-V2.md:171-189) |
| `orderItems` relation | ❌ kosong | ✅ diisi (createOrder:402) | n/a |

→ **Satu-satunya side effect persist adalah pembuatan baris `orders` *pending*.**
Tidak ada sinkronisasi ke `workspace_v2`, tidak ada update entitas konteks, tidak
ada `orderItems`, tidak ada `totalPrice`, tidak ada validasi harga DB. Return
value (`ParsedOrder`) oleh caller **dihdescart** (`void … .catch`, :769).

Artinya bila ingin *"pertahankan persist-only"*, fungsi ini **harus di-refactor
total**: buang `attemptExtraction`/LLM, ganti dengan menuliskan keputusan yang
**sudah** ada (v1 `cart_ops` pasca-`validateCartOpsAgainstDb`, atau v2
`draft_cart_ops`/`plannedActs`). Saat ini *persist* dan *keputusan* tidak
terpisahkan — tidak ada cara untuk "keep persist, drop interpreter" tanpa
menulis ulang.

---

## 6. Klasifikasi risiko

Fokus RAILS P4: kapan hasil *dobel-keputusan* ini menyimpan **DATA SALAH**
(harga/qty/produk berbeda dari yang sudah dikonfirmasi ke customer di v2/v1).

| # | Risiko | Klasifikasi | File:line | Bukti / mekanisme |
|---|---|---|---|---|
| R1 | **Phantom `pending` order** menyaingi draft order + **dipolar ke `activeOrder`/`tryTotal` pada turn berikutnya** → qty/harga/produk **yang disampaikan ke customer** di turn+1 tidak konsisten dengan order yang dikonfirmasi | **TINGGI** | conv:829 (`activeOrder` orderBy desc, notIn [shipped/delivered/cancelled] → pilih `pending` phantom), conv:67 (prompt LLM baca `items` phantom), fallback:649-661 (tryTotal fallback ke `lastOrder.items` phantom), fallback:660 parse tanpa `price`/`qty` field name), renderCartSummary:949 (`Number(i.qty\|0)>0` filter semua phantom item karena fieldnya `quantity` bukan `qty`) | §4 Skenario A |
| R2 | **I13 terlanggar:** order hasil `extractAndSaveOrder` menyimpan harga `null`, items `{product,quantity}` tanpa unitPrice dari DB — beda (salah) dari harga yang terkonfirmasi customer di v1/v2 | **TINGGI** | order.service.ts:133 (`items: items as any` mentah), :135 (`orderStatus:'pending'`), :136 (`shippingAddress`), schema.prisma:214 (`totalPrice Float?`, tidak diset), :213 (`items Json` takterstruktur); kontras interpreter.ts:144 + conversation.service.ts:628 (harga WAJIB dari DB) | §1b, §5 |
| R3 | **Phantom `buy` order dari inquiry** — kata kunci `'mau'` (EXTRACTION_PROMPT:24) memicu `'buy'`/`prisma.order.create` untuk pesan bertanya, padahal v1/v2 mengatai *inquiry/product_info* | **TINGGI** | order.service.ts:24 (`mau` termasuk buy keyword), :125 (`if (parsed.intent==='buy')`), :128 (`prisma.order.create`) | §4 Skenario B |
| R4 | **Drift provider + config**: `extractAndSaveOrder` pake Gemini (via manager) temp 0.1/maxTokens 300/**tanpa jsonMode**; v1/v2 pake Groq langsung temp 0.2/maxTokens 250/jsonMode:true → output parse sistematik berbeda → sempurna alasan qty/destination bermain (Skenario C/D) | **SEDANG** | order.service.ts:77 (`adapters.ai.generate`, no jsonMode), container.ts:30→manager.ts:63 (primary=gemini:34), interpreter.ts:88 + reasoning.ts:115 (`groqAdapter.generate`, jsonMode:true), groq.adapter.ts:104 (default jsonMode false) | §3c |
| R5 | **Disagreemen v2-shadow (log-only) vs `extractAndSaveOrder` (persist)** bila `SHADOW_MODE=true` di toko v1: v2 `understand()` putuskan satu hal, diekspor ke log; `extractAndSaveOrder` putuskan lain, ditulis ke DB — **tak terobservasi** (hanya beda di log shadow) | **SEDANG** | conversation.service.ts:690 (shadow gate env `SHADOW_MODE`, default `'false'`, shadow-config.ts:8), :695 (v2 shadow `understand`), :769 (extractAndSaveOrder persist) | §0 tabel |
| R6 | **Violasi I8 tidak tercatat:** pemanggilan LLM ke-3 (`adapters.ai.generate`) tidak increment `llmCallCount` (:402/:616) dan tidak push stage — cost & kuota tak terukur | **SEDANG** | order.service.ts:77 vs conversation.service.ts:402,616 (hanya `llmCallCount=1` untuk runOneCall) | §1a |
| R7 | **Retry `RETRY_PROMPT` (order.service.ts:32/116) hanya memaksa bentuk JSON**, tidak bawa konteks/kontak v1/v2 → tidak mengurangi (bisa memperlebar) divergence | **RENDAH** | order.service.ts:32-36 (`RETRY_PROMPT`: hanya "Kembalikan HANYA JSON…"), :116 | §1a |
| R8 | **Return value `ParsedOrder` dibuang** (`void … .catch`, conv:769) — keputusan semantik hanya "bertahan" lewat side effect persist yang tidak terkait apa pun | **RENDAH** | conversation.service.ts:769 | §5 |
| R9 | **Dormant / dead code di path v2 sukses:** ketika `engine==='v2'` berhasil return (215/279/357), `extractAndSaveOrder`(769) **tidak tercapai** → persist tujuanannya (`order` row) *juga* terlewat di path v2. berarti tidak konsisten antar path | **RENDAH** | conversation.service.ts:111-377 (v2 block, semua return 215/279/357/283/361), :769 (hanya di v1-fallback section) | §0 tabel + §2 |

> **REN.** R1+R2+R3 → TINGGI karena **data order palsu / salah harga / salah qty
> ditulis ke `orders`**, dan pada R1 kasusnya justru **dipilih sebagai order
> aktif berikutnya** — bisa mentrigger *wrong* harga/qty ke customer di turn+1.
> I8/I13 keduanya terkena. Ini persis pola RAILS §2 "boundary antar-layer
> rusak — beberapa komponen sekaligus jadi pengambil-keputusan semantik,
> fallback, executor, DAN persistence."

---

## 7. Rekomendasi (tidak dieksekusi — read-only)

Tiga opsi, dengan rekomendasi utama:

### Opsi 1 — **Hapus total** ✅ *direkomendasikan*
Hapus panggilan `void orderService.extractAndSaveOrder(...)` (conversation.service.ts:769)
dan fungsi `extractAndSaveOrder` + `attemptExtraction` + `EXTRACTION_PROMPT`/`RETRY_PROMPT`
(order.service.ts:32-98, 101-155). Alasan:
- Di path v2 sukses **sudah tidak dipanggil** (R9) → bukan sumber kebenaran apa pun.
- Di path v1, fungsi **persist**nya (order row `pending`) **duplikat / bentrok** dengan
  draft order yang benar (v1 `syncCartStateToDraftOrder`/`addConfirmedItemToOrder`,
  conversation.service.ts:630/893) — lihat R1, bukan sekadar "ganti harga".
- **Persist-schemanya tidak valid I13** (tanpa price/unitPrice, schema.prisma:213-214) —
  memperbaiki "persist-only" butuh menuliskan *keputusan v1/v2 yang sudah divalidasi DB*,
  bukan menuliskan hasil parse LLM mentah.
- Setiap *turn* di path v1 memicu **LLM ke-3** (Gemini) yang tidak terakuntansi I8 (R6).

### Opsi 2 — **Pertahankan sebagai persist-only** (perlu refactor, tidak bisa tanpa kode)
Jika ada **konsumen eksternal** yang spesifik butuh baris `orders` dengan
`orderStatus='pending'` + `extractedAt` sebagai jejak audit "ekstraksi order dari
chat", maka refactor: ganti isi `extractAndSaveOrder` agar **tidak ada LLM/tidak ada
parse**; gunakan keputusan yang sudah ada:
- v1: `llmResult.cart_ops` setelah `validateCartOpsAgainstDb` (conversation.service.ts:627-633,
  item dengan `price` dari DB).
- v2: `plannedActs`/`draft_cart_ops` yang sudah divalidasi (conversation.service.ts:290-328).

Namun harus **dedup + sinkron field**: tuliskan ke kolom yang sama `items`
berisi `ConfirmedItem[]` (dengan `price` dari DB), isi `totalPrice`, dan/atau tandai
baris ini sebagai *extraction snapshot* (bukan order operasional) agar
`activeOrder` lookup (conv:829) dan `tryTotal` fallback (fallback:649) **tidak
menyelipkannya**.

→ **Peringatan:** saya belum menemukan *consumer* yang spesifik butuh row
`pending` dari `extractAndSaveOrder` ini (lihat §8 — `getOrdersByConversation`
hanya expose semua order secara generik; tidak ada query `orderStatus='pending'`
khusus untuk "ekstraksi chat" di routes/orders.ts maupun analytics). Sehingga
argumen "harus kebali persist" **lemah**; cukup dengan *remove*.

### Opsi 3 — **Lainnya: ganti dengan persist-from-v2-decision (pilihan P4 sempit)**
Bila tetap ingin *audit trail* order di `orders`, lakukan **setelah** v2 produksi
memutuskan & memutasi, bukan lewat LLM ketiga. Tapi ini **di luar scope P4
(read-only)** — cukup catat sebagai rekomendasi.

---

## 8. Catatan temuan terkait — untuk STATUS-V2.md "Ditemukan saat kerja, belum ditangani"

Berikut bug **di luar scope P4** yang ditemui saat audit (RAILS §1.4) — dicatat,
**tidak diperbaiki**, rekomendasi mereka dialihkan ke TASK terpisah:

1. **I13 violation eksplisit di `extractAndSaveOrder`** (R2): baris `orders` yang
   dibuatnya tidak ada `unitPrice`/`totalPrice`, tidak lolos
   `validateCartOpsAgainstDb`. `orders.items` (schema.prisma:213 `Json`) menyimpan
   `{product, quantity}` sempurna tanpa harga dari DB. → butuh TASK terpisah (bukan P4).
2. **Provider/config drift I8**: `adapters.ai.generate` (container.ts:30) memakai
   `aiProviderManager` (primary=Gemini, manager.ts:34) sedangkan v1/v2 pakai
   `groqAdapter.generate` langsung. Ini berarti **jutaan token Gemini** bisa
   terpakai tiap turn hanya untuk ekstraksi order — perlu keputusan arsitekon
   provider yang konsisten. → TASK terpisah.
3. **I8 accounting gap**: `extractAndSaveOrder` tidak tercatat di `llmCallCount`/
   `stagesReached` audit (conversation.service.ts:402/616) — cost & kuota tidak
   terukur. → TASK terpisah (audit instrumentation).
4. **`activeOrder` / `tryTotal` memilih order terbaru tanpa membedakan `draft`
   (operasional) vs `pending` (ekstraksi)**: conversation.service.ts:829 &
   fallback.service.ts:649 tidak diskriminatif. Jika tetap menyimpan row ekstraksi
   di `orders`, harus ada pemisah status/flag agar lookup ini tidak mentas
   order palsu. → TASK terpisah (data model).
5. **Tidak ada test apa pun yang menjalankan `extractAndSaveOrder` secara
   *real*** (golden-dataset.test.ts:253 mem-mock-nya ke no-op). Blind spot
   eksistensi. → TASK terpisah (test coverage).

---

## 9. Lampiran — jejak kode (file:line) inti

- Definisi `extractAndSaveOrder`: `order.service.ts:101-155`
- `EXTRACTION_PROMPT`: `order.service.ts:18-30` (keyword `'mau'` buy → :24)
- `RETRY_PROMPT`: `order.service.ts:32-36`
- `attemptExtraction` (panggil LLM + retry): `order.service.ts:75-98` (LLM via `adapters.ai.generate` :77)
- Persist `prisma.order.create` (tanpa price): `order.service.ts:128-139`
- Panggilan produksi: `conversation.service.ts:769` (`void … .catch`)
- Blok `if (engine === 'v2')` — tempat `extractAndSaveOrder` **tidak berada**: `conversation.service.ts:111-377` (return 215/279/357; outer catch fall-through 367-376)
- Outer catch (v2→v1 fallback) + fall-through ke v1 logic: `conversation.service.ts:367-379`
- v2 shadow `understand`: `conversation.service.ts:690-745` (gate `shouldRunShadow` conv:690/shad-config:8; `understand` shadow :695; log-only `logShadowEntry` shadow-logger:189-195)
- v1 `runOneCall` + `validateCartOpsAgainstDb`: `conversation.service.ts:618`, `interpreter.ts:46-137` (groq generate :88), `interpreter.ts:144`
- v2 `understand` produksi: `reasoning.ts:224` (groq generate di `callLlm` :115, jsonMode:true), `validate`/`validateCartOpsAgainstDb` conv:232/316
- `adapters.ai` → `aiProviderManager.generate` (primary=gemini): `adapters/container.ts:30` → `adapters/ai/manager.ts:63` (gemini primary :34)
- `groqAdapter.generate` (v1/v2): `interpreter.ts:88`, `reasoning.ts:115`; `jsonMode` default false: `adapters/ai/groq.adapter.ts:104`
- `Order` schema (no unique di conversationId; index :230; totalPrice Json? :214; shippingAddress :217; orderStatus default 'pending' :216; extractedAt default now :219): `prisma/schema.prisma:208-235`
- `activeOrder` lookup (pilih terbaru, tidak diskriminatif draft vs pending): `conversation.service.ts:829-837`
- `tryTotal` fallback ke `lastOrder.items`: `fallback.service.ts:649-661`
- `renderCartSummary` filter `qty`: `conversation.service.ts:949-953`
- `ConfirmedItem`/`DiscussedItem` shape (`price`,`qty`,`product`): `domain/types.ts:237-251`
- Mock test (bukti tim sadari ini = real LLM): `tests/golden-dataset.test.ts:15,60,251-253,271`
- RAILS §2 I8 & P4: `RAILS.md:82-121`; prinsip trade-off §3: `RAILS.md:127-131`; STATUS-V2.md P4: `STATUS-V2.md:201-202`

**Akhir laporan.** Read-only — tidak ada berkas sumber yang dimodifikasi untuk perbaikan. Temuan luar scope (§8) dicatat untuk ditulis ke `STATUS-V2.md` bagian "Ditemukan saat kerja, belum ditangani".
