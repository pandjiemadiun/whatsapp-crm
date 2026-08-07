# Phase 1.9.2 — ConversationContext Integration & Product Catalog

## Ringkasan

Implementasi context-aware conversation dan katalog produk untuk Project Garuda.
Mengikuti arsitektur **Express + singleton service** yang sudah ada (BUKAN NestJS —
tidak ada `business.module.ts`/`@Injectable()`; service di-export sebagai singleton).

File yang dibuat/diubah:

| File | Status |
|---|---|
| `apps/api/prisma/schema.prisma` | Diubah — tambah model `ProductCategory`, `Product`, `OrderItem`, relasi baru |
| `apps/api/src/domain/types.ts` | Diubah — tambah 10 tipe baru + `PrismaJsonValue` |
| `apps/api/src/business/conversation-context.service.ts` | **Baru** |
| `apps/api/src/business/product.service.ts` | **Baru** |
| `apps/api/src/business/order.service.ts` | Diubah — tambah CRUD order + integrasi context/product |
| `apps/api/src/business/conversation.service.ts` | Diubah — tambah method context-aware + sinkronisasi context |
| `apps/api/src/business/tests/order-context.integration.test.ts` | **Baru** — 14 integration tests |
| `apps/api/database-verify.sql` | **Baru** — skrip verifikasi DB |

---

## Service Method Signatures

### ConversationContextService

```typescript
initializeContext(input: {
  storeId: string;
  customerId: string;
  conversationId: string;
  sessionExpireMinutes?: number; // default 60
}): Promise<ConversationContextData>

getContext(conversationId: string): Promise<ConversationContextData | null>
// null jika tidak ada atau sesi expired (otomatis dihapus)

updateExtractedEntities(conversationId: string, entities: ExtractedEntity[]): Promise<void>
// Merge + dedup by type:value, confidence tertinggi menang

updateUserIntent(conversationId: string, intent: 'browse' | 'purchase' | 'support' | 'inquiry'): Promise<void>

appendMessage(conversationId: string, message: ConversationMessage): Promise<void>
// Simpan maks 10 pesan terakhir (auto-trim)

refreshSession(conversationId: string, sessionExpireMinutes?: number): Promise<void>

deleteContext(conversationId: string): Promise<void>
```

### ProductService

```typescript
getCategoriesByStore(storeId: string): Promise<ProductCategory[]>
getProductsByCategory(categoryId: string): Promise<Product[]>
searchProducts(storeId: string, query: string): Promise<Product[]>          // limit 20, nama-first
getProductById(productId: string): Promise<Product>                          // throws ApiError ERR_NOT_FOUND
checkStockAvailability(productId: string, quantity: number): Promise<boolean> // stock null = unlimited
createProduct(storeId, categoryId, data: { name, price, currency?, description?, sku?, stock?, images? }): Promise<Product>
updateProduct(productId, data: Partial<Product>): Promise<Product>
deleteProduct(productId: string): Promise<void>                              // soft delete (deletedAt)
listProductsByStore(storeId, filter?: { categoryId? }): Promise<Product[]>
```

### OrderService

```typescript
getOrderById(orderId: string): Promise<OrderWithItems>                       // includes items
getOrdersByConversation(conversationId: string): Promise<OrderWithItems[]>
createOrder(storeId, conversationId, customerId, items: OrderItemInput[]): Promise<OrderWithItems>
// 1) validasi produk + stok  2) hitung total  3) create order + orderItem (snapshot)  4) update context entities
updateOrderStatus(orderId, status: string): Promise<OrderWithItems>          // 'confirmed' -> set confirmedAt
addOrderItem(orderId, productId, quantity, customizations?): Promise<OrderWithItems>
removeOrderItem(orderId, orderItemId): Promise<OrderWithItems>
extractAndSaveOrder(conversationId, customerId, storeId, message): Promise<ParsedOrder | null> // existing
```

### ConversationService

```typescript
getConversationWithContext(conversationId): Promise<ConversationWithContext | null>
createConversation(storeId, customerId, customerPhone, customerName?): Promise<ConversationWithContext>
appendMessageWithContext(conversationId, role, content): Promise<void>  // save + appendMessage + refreshSession
updateConversationStatus(conversationId, status): Promise<void>         // 'resolved' -> set resolvedAt
getRecentConversations(storeId, limit? = 50): Promise<ConversationWithContext[]> // status open, max 100
processCustomerMessage(...)                                             // existing — sekarang sinkron context otomatis
```

---

## Contoh Penggunaan

```typescript
import { conversationContextService } from '../business/conversation-context.service.js';
import { productService } from '../business/product.service.js';
import { orderService } from '../business/order.service.js';
import { conversationService } from '../business/conversation.service.js';

// 1. Buat percakapan + context
const conv = await conversationService.createConversation('store-1', 'cust-1', '+62812345678', 'Budi');

// 2. Cari produk
const products = await productService.searchProducts('store-1', 'es teh');

// 3. Buat pesanan dari katalog
const order = await orderService.createOrder('store-1', conv.id, 'cust-1', [
  { productId: products[0].id, quantity: 2, customizations: { es: 'sedikit' } },
]);

// 4. Konfirmasi pesanan
await orderService.updateOrderStatus(order.id, 'confirmed');

// 5. Lihat konteks percakapan (entities ter-update otomatis)
const fullConv = await conversationService.getConversationWithContext(conv.id);
console.log(fullConv.context.extractedEntities);
// [{ type: 'product', value: 'Es Teh', confidence: 1, metadata: { productId, quantity: 2 } },
//  { type: 'order', value: '<orderId>', confidence: 1 }]
```

---

## ERD (text-based)

```
stores 1 ───< product_categories N (storeId)
stores 1 ───< products N (storeId)
product_categories 1 ───< products N (categoryId)   [categoryId nullable]
stores 1 ───< conversations N (storeId)
conversations 1 ─── 0..1 conversation_context (conversationId, unique)
conversations 1 ───< conversation_history N (conversationId)
conversations 1 ───< orders N (conversationId)
stores 1 ───< orders N (storeId)
orders 1 ───< order_items N (orderId)
products 1 ───< order_items N (productId)           [productId nullable — snapshot tetap disimpan]
```

Soft delete: `deletedAt` pada stores, products, product_categories, orders, conversations.
`order_items.productName` + `unitPrice` adalah **snapshot** — aman walau produk diedit/dihapus.

---

## Error Scenarios

| Skenario | Error |
|---|---|
| Product tidak ada / sudah di-soft-delete | `ApiError ERR_NOT_FOUND` (404) |
| Category tidak milik store | `ApiError ERR_NOT_FOUND` |
| Stok tidak cukup | `ApiError ERR_VALIDATION` "Insufficient stock..." |
| Order tidak ditemukan | `ApiError ERR_NOT_FOUND` |
| OrderItem tidak ditemukan | `ApiError ERR_NOT_FOUND` |
| Tambah/hapus item pada order non-pending | `ValidationError` |
| `createOrder` tanpa items / qty < 1 | `ValidationError` |
| Produk dari store lain di `createOrder` | `ApiError ERR_VALIDATION` |
| Context expired | `getContext()` return `null` (row auto-delete) |
| DB failure | `ApiError ERR_DB` (500) |

Semua operasi DB di-log via `adapters.logger` (Winston, JSON, sensitive-masked).

---

## Deployment Checklist

1. `cd apps/api && npx prisma generate && npx prisma db push` (sudah dijalankan)
2. `npm run build` — zero TS error ✅
3. Jalankan test: `npx tsx --test --test-force-exit src/business/tests/order-context.integration.test.ts` ✅ (14/14)
4. Restart service API (pm2/forever sesuai setup env)
5. Jika produksi: jalankan `database-verify.sql` untuk memastikan struktur sama
6. Tambahkan index tambahan jika volume data besar (sudah ada: products.storeId, products.categoryId, order_items.orderId, order_items.productId, conversation_context.conversationId unique)
