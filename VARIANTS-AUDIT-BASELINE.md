# VARIANTS-AUDIT-BASELINE.md

AUDIT MURNI — tidak ada perubahan kode. Setiap klaim menyertakan `file:line`.
Repo root: `/home/ubuntu/garuda`. HEAD: `1bd44db`. RAILS §1.3 berlaku
(tidak ada simpulan tanpa file:line).

---

## 1. Schema

### 1.1 Field terkait varian/opsi/customization di `apps/api/prisma/schema.prisma`

- `OrderItem.customizations Json?` — schema.prisma:278
- `Product.sku String?` — schema.prisma:317; unique per store: `@@unique([storeId, sku])` schema.prisma:333
- `Product.weight Int @default(0)` — schema.prisma:320
- `Product.stock Int?` — schema.prisma:318
- `Product.images Json?` — schema.prisma:321
- `Product.name / description / price / currency` — schema.prisma:313–316

Pencarian `variant | option | size | color | attribute | modifier | addon | topping`
di schema.prisma: **tidak ditemukan** field model bernama demikian (hanya substring
`customer*` yang ke-match, bukan field varian). Tidak ada model `ProductVariant`.

### 1.2 Apakah field di atas dipakai di kode (src/)?

- `OrderItem.customizations` (schema.prisma:278): didefinisikan di domain types
  `apps/api/src/domain/types.ts:182` (`customizations: Record<string, unknown> | null;`)
  dan `apps/api/src/domain/types.ts:225` (`OrderItemInput.customizations?`).
  **Ditulis** (tidak dibaca untuk bisnis) di:
  - `apps/api/src/business/order.service.ts:239` (createOrder — `customizations: item.customizations ?? null`)
  - `apps/api/src/business/order.service.ts:262-263` (createOrder orderItems create)
  - `apps/api/src/business/order.service.ts:346-347` (addOrderItem)
  - `apps/api/src/business/order-transition.ts:200` (mapOrderWithItems — mapping pass-through)
  - `apps/api/src/business/order.service.ts:485` (mapOrderWithItems — mapping pass-through)
  **Tidak ada consumer yang membaca/menterjemahkan isinya.** Bahkan di暴露-limit
  test ditegaskan tidak boleh di-expose: `apps/api/src/tests/structured-actions-p5.test.ts:482`
  (`'OrderItem.customizations must not be exposed'`). Tidak ada call `orderService.createOrder`
  / `addOrderItem` dengan `customizations` dari production route (hanya dipakai di test).
  => `customizations` ada di schema + types tapi **effectively orphan** (hanya ada di
  write-path dan mapping, tidak ada pembacaan bisnis / UI).

- `Product.sku` (schema.prisma:317): **dipakai** luas — validasi unik
  `apps/api/src/routes/admin/products.ts:166-172`, generate+retry
  `apps/api/src/business/product.service.ts:1189-1211`, auto-generate saat
  magic-paste `apps/api/src/business/product.service.ts:617,630`, search
  `apps/api/src/business/product.service.ts:121,132`, types
  `apps/api/src/domain/types.ts:156`, schema `apps/api/src/schemas/index.ts:144`.

- `Product.weight` (schema.prisma:320): **dipakai** sebagai gate wajib magic-paste
  `apps/api/src/business/product.service.ts:572`, ditulis `:632`, ekstraksi
  `extractWeightGrams` `apps/api/src/business/product.service.ts:1109-1117`,
  schema wajib `apps/api/src/schemas/index.ts:143,157`.

- `Product.images Json?` (schema.prisma:321): **dipakai** penuh — precedent pola
  semi-terstruktur: tipe `ProductImage[]` ter-definisi `apps/api/src/domain/types.ts:137-143`
  dan `:161`; zod `apps/api/src/schemas/index.ts:147,160`; mutasi
  `apps/api/src/routes/store-products.ts:278-284,308-321`,
  `apps/api/src/routes/admin/products.ts:176-190,239-254`,
  `apps/api/src/business/product.service.service.ts:236-251,281-282` (catatan: file
  sebenarnya `product.service.ts`).

### 1.3 Pattern serupa (Json / semi-terstruktur) sebagai precedent

`Json?` ada di 16 lokasi schema (schema.prisma:29,42,163,189,204-206,222,278,321,
348-349,368,433,494-495). Precedent konkret yang sudah dipakai produksi:
- `Product.images` (schema.prisma:321) → `ProductImage[]` typed + zod array.
- `Store.config Json?` (schema.prisma:42), `ConversationContext.extractedEntities`
  (schema.prisma:205), `Order.items Json` (schema.prisma:222) — semua disimpan
  mentah dan di-map manual tanpa tipe ketat.
- `OrderItem.customizations Json?` (schema.prisma:278) — sudah pakai tipe
  `Record<string, unknown>` (types.ts:182) sebagai precedent field generik.

---

## 2. CartAuthority — item identity

File: `apps/api/src/business/cart-authority.ts`.

### 2.1 Dedup / "item sama" sekarang — quote exact

`addLine` (cart-authority.ts:179): mencari existing item **hanya by `productId`**:
```
cart-authority.ts:230-235
      const existingItem = await tx.orderItem.findFirst({
        where: {
          orderId: order.id,
          productId: productId,
        },
      });
```
Lalu jika ketemu → increment qty (cart-authority.ts:246-257); else create baru
(cart-authority.ts:258-271). **Key identity = `productId` saja** (tidak ada
komponen lain).

`executeOps` (cart-authority.ts:506): dedupe di array in-memory **hanya by `productId`**:
```
cart-authority.ts:566
          const existing = items.find((i: any) => i.productId === productId);
```
dan remove:
```
cart-authority.ts:612
            const toRemove = items.filter((i: any) => i.productId === result.productId);
```

`removeLine` (cart-authority.ts:297): identity item = **`lineItemId`**
(OrderItem.id), bukan productId:
```
cart-authority.ts:306-311  orderItem.findUnique({ where: { id: lineItemId }, ... })
```

`updateQuantity` (cart-authority.ts:342): identity item = **`lineItemId`** juga
(cart-authority.ts:354-357).

`checkout` stock loop: key by `item.productId` (cart-authority.ts:461-462, 463-471).

`itemsToJson` (cart-authority.ts:1094-1102): per item menyimpan
`{ product, qty, price, productItemId, productId }` — tidak ada field varian.

`CartLine` type (cart-authority.ts:44-51) hanya `{ id, productId, productName,
quantity, unitPrice, subtotal }`.

### 2.2 Titik yang HARUS berubah bila identity perlu komponen tambahan (varian)

Berdasarkan file (tanpa rekomendasi desain):
- `addLine` find-existing `where: { orderId, productId }` — cart-authority.ts:230-235
  (dan branch increment cart-authority.ts:246-257).
- `executeOps` `.find` / `.filter` by `productId` — cart-authority.ts:566, 612, 616.
- `removeLine` / `updateQuantity` keyed by `lineItemId` — cart-authority.ts:306-311, 354-357
  (perlu diputuskan apakah lineItemId tetap cukup atau butuh sub-identitas).
- `CartLine` interface — cart-authority.ts:44-51.
- `itemsToJson` shape — cart-authority.ts:1094-1102.
- `mapOrderItems` — cart-authority.ts:1105-1114.
- `cartLinesToConfirmedItems` / `orderItemsToConfirmedItems` (key by productName
  saja, tidak productId) — cart-authority.ts:1117-1136.
- `checkout` stock loop `item.productId` — cart-authority.ts:461-471.

---

## 3. Magic-paste weight extraction

File utama: `apps/api/src/business/product.service.ts`.

### 3.1 Persisnya weight di-extract bagaimana

Tiga jalur, urutan di `extractWithLLM` (product.service.ts:793-844):
1. **Pattern library (regex)** dulu — `tryPatternExtraction` product.service.ts:965-1016.
   `weight` **TIDAK diambil dari `fieldMappings`** (loop mapping hanya tangani
   name/price/stock/categoryName, product.service.ts:989-1001); weight diset hard-coded
   via `this.extractWeightGrams(text)` product.service.ts:985.
2. **LLM** — `extractWithLLM` product.service.ts:809-838: prompt +
   `adapters.ai.generate(prompt, { temperature: 0.1, maxTokens: 200 })` product.service.ts:812;
   hasil `JSON.parse` product.service.ts:818; bila LLM return string weight →
   `this.extractWeightGrams(parsed.weight)` product.service.ts:832-834.
3. **Regex fallback** — `regexFallbackExtraction` product.service.ts:1022-1077;
   weight via `this.extractWeightGrams(normalized)` product.service.ts:1056.

`extractWeightGrams` (product.service.ts:1109-1117): regex
`/(\d+(?:[.,]\d+)?)\s*(kg|kilogram|gram|grams|gr|g)\b/i`, kg×1000, null bila
tidak ada satuan berat eksplisit (JANGAN nebak).

**Field wajib di schema output:** weight BUKAN field wajib ekstraksi LLM
(`MagicPasteExtraction.weight?: number | null` product.service.ts:1262-1263,
komentar "undefined/null = TIDAK disebut di teks"). Tapi weight **wajib untuk create**:
gate `if (raw.weight == null || raw.weight <= 0)` → return preview + `needsWeightInput`
product.service.ts:572-614.

### 3.2 Apakah arsitekturnya generic / bisa extend, atau hardcoded khusus weight?

**Sebagian hardcoded khusus weight:**
- `MAGIC_PASTE_SYSTEM_PROMPT` (product.service.ts:1297-1353) adalah string statis
  dengan 8 rule nomor tetap; rule 6 (product.service.ts:1331-1336) khusus WEIGHT.
  Output JSON shape di-hardcode di prompt product.service.ts:1350
  (`{"name","price","stock","categoryName","unit","weight","description","confidence"}`).
  Tambah field baru = ubah prompt statis + `MagicPasteExtraction` interface
  (product.service.ts:1253-1266).
- Pattern library `fieldMappings: [{ field, group }]` (product.service.ts:978-916
  default, interface product.service.ts:1278-1287) memang **generic** (bisa map
  field apa pun ke group regex). TAPI `weight` sengaja **dikecualikan** dari loop
  mapping (product.service.ts:989-1001) dan di-handle terpisah via
  `extractWeightGrams` (product.service.ts:985). Jadi field baru yang dimasukkan
  ke `fieldMappings` akan otomatis ter-extract, tapi weight punya jalur khusus
  sendiri.
- `maxTokens: 200` (product.service.ts:812) membatasi panjang JSON output LLM —
  relevant bila menambah banyak field.

---

## 4. Structured Actions — ADD_TO_CART request shape

File: `apps/api/src/business/action-registry.ts`.

### 4.1 Schema sekarang (bukan kontrak §5.2 lama)

`AddToCartRequestSchema` (action-registry.ts:44-52):
```ts
export const AddToCartRequestSchema = z.object({
  actionId: z.string().uuid(),
  type: z.literal('ADD_TO_CART'),
  payload: z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().positive(),
  }),
});
```
**Field persis:** `actionId`, `type`, `payload.productId`, `payload.quantity`.
Tidak ada field lain (tidak ada `variants`, `customizations`, `options`, dll).

### 4.2 Apakah sudah berubah sejak P6-1?

- Git `-L 44,53` history untuk block ini → hanya 1 commit:
  `fe1ed2f checkpoint: commit structured actions P0-P5 foundation`.
  Artinya `AddToCartRequestSchema` **TIDAK berubah** sejak foundation (P6-1 hanya
  mengubah internal `CartOp.productId?` + `handleAddToCart`, bukan request schema).
- Schema TIDAK pakai `.strict()`/`.passthrough()` (action-registry.ts:45-52) →
  Zod default **strip** unknown keys (tidak error, tidak diteruskan).

### 4.3 Pemakaian payload

- `handleAddToCart` membaca `payload.productId` + `payload.quantity`
  (action-registry.ts:599-600, 651, 664-669) lalu bangun `CartOp`
  `{ type:'add', productId, product, qty }` (action-registry.ts:664-669) →
  `cartAuthority.executeOps` (action-registry.ts:672).
- Response shape `AddToCartResponseSchema` (action-registry.ts:57-81) items:
  `{ id, productId, productName, quantity, unitPrice, subtotal }` — tidak ada varian.
- Route `POST /api/pwa/:storeSlug/action` (apps/api/src/routes/actions.ts:25-70)
  menerima `body.action` apa pun, lalu `executeAction(actionType, action, ctx)`.
- PWA client mengirim persis `{ productId, quantity }`:
  `apps/pwa/src/components/ChatPage.tsx:501`
  (`sendAction('ADD_TO_CART', { productId: product.id, quantity: 1 })`),
  dibungkus `apps/pwa/src/components/ChatPage.tsx:478-481`.

---

## 5. PWA / WA product display

### 5.1 PWA — titik render product card (file:line)

- Komponen kartu: `apps/pwa/src/components/ProductCard.tsx`
  - definisi props `ProductCardProps` ProductCard.tsx:4-16
  - render utama `ProductCard` ProductCard.tsx:81; destructure `{ name, price, stock, imageUrl }` ProductCard.tsx:82;
    tampil `name` ProductCard.tsx:105, `formatPrice(price)` ProductCard.tsx:106, `stock` ProductCard.tsx:107;
    tombol "+ Keranjang" → `onAddToCart` ProductCard.tsx:118-123.
- Pemanggilan `ProductCard`:
  - `apps/pwa/src/components/MessageRenderer.tsx:67-73` (variant `conversation`, dari payload `product`)
  - `apps/pwa/src/components/ProductList.tsx:32,61,77` (grid)
  - `apps/pwa/src/components/EmptyState.tsx:87`
  - `apps/pwa/src/components/ProductDiscovery.tsx:117`
- Tipe payload `ProductPayload` hanya `{ id, name, price, stock, imageUrl }`:
  `apps/pwa/src/types/chat.ts:56-62`.
- Detail sheet: `apps/pwa/src/components/ProductDetailSheet.tsx:25,48-50,174-181`
  (name + price + category; tidak ada varian).
- Cart summary PWA: `apps/pwa/src/components/CartSummary.tsx:27,61`
  (`item.productName × item.quantity`; tidak ada field varian).

### 5.2 WA — representasi produk di reply (file:line)

- Composer utama: `apps/api/src/services/chat/composer-v2.ts`
  - cart add reply: `🛒 Ditambahkan ke keranjang: ${op.product} x${displayQty}`
    composer-v2.ts:82 (hanya product name + qty).
  - fallback cart acts: composer-v2.ts:97 (entity `e.value` = product name).
- Catalog list (WA/engine) → `apps/api/src/business/fallback.service.ts`
  - `tryCatalog` bangun `items: [{ id, name, price }]` fallback.service.ts:254-258
    (TIDAK ada varian/options).
  - ambiguity list: `• *${p.name}* — ${formatPrice(p.price)} (stok: ${p.stock})`
    fallback.service.ts:310-311.
  - single product reply: fallback.service.ts:343-352 (name + price + stock).
- Interpreter (katalog ke LLM): `apps/api/src/services/chat/interpreter.ts:65-67`
  (`- ${p.name} (Rp ${p.price}, stok: ${p.stock ?? 0})`).
- Cart summary reply (WA): `apps/api/src/business/conversation.service.ts:1005-1013`
  (`• ${i.product} x${qty} — Rp ...`; hanya product name + qty + price).
- Structured WA→PWA enrichment (authoritative): `apps/api/src/services/structured-message.mapper.ts`
  - `enrichProduct` hanya kembalikan `{ id, name, price, stock, imageUrl }`
    structured-message.mapper.ts:247-258 (TIDAK ada varian).
  - `classifyStructured` product/product_list hanya pakai `id, name, price`
    structured-message.mapper.ts:124-158.

---

## Ringkasan temuan kunci (fakta, bukan rekomendasi)

1. Tidak ada model/field `variant|option|size|color|attribute` di schema.
   Hanya `OrderItem.customizations Json?` (schema.prisma:278) yang orphan
   (ada di write-path + types, tidak ada pembacaan bisnis/UI).
2. Cart item identity hari ini = `productId` saja (addLine/executeOps) atau
   `lineItemId` (removeLine/updateQuantity). Lihat §2.1.
3. Weight extraction ter-hardcode-khusus (prompt rule 6 + `extractWeightGrams`),
   bukan generic seperti `fieldMappings`. Lihat §3.2.
4. `AddToCartRequestSchema` hanya `{ productId, quantity }`, tidak berubah sejak
   P0/P6-1. Lihat §4.1–4.2.
5. Display produk (PWA card + WA reply) hanya membawa `{ id, name, price, stock, imageUrl }`;
   tidak ada slot varian. Lihat §5.

(end of audit)
