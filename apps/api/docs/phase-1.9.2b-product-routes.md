# Phase 1.9.2b — Express Routes untuk Product Catalog

## API Overview

Base URL: `http://<host>:3000/api`

Semua response mengikuti format project Garuda (BUKAN `{status: "success"}`):

```json
// Sukses
{ "success": true, "data": { ... } }

// Error validasi (Zod)
{ "error": "Validation failed", "details": [{ "field": "name", "message": "..." }] }

// Error lainnya
{ "error": "Product xxx not found" }
```

## Authentication

- **Admin routes** memakai `Authorization: Bearer <admin_token>` (UUID token dari tabel `admin_auth_tokens`, sama seperti route admin lain di project ini — **bukan JWT**). Di-verifikasi oleh `adminAuthMiddleware` di `src/middleware/adminAuth.ts`.
- **Consumer routes** publik — tanpa auth.

---

## Consumer Routes (Publik)

### 1. GET `/api/stores/:storeId/products`
List produk per toko dengan pagination + sort.

**Query params:**
| Param | Type | Default | Max |
|---|---|---|---|
| `limit` | int | 20 | 100 |
| `offset` | int | 0 | - |
| `sortBy` | `name`\|`price`\|`createdAt` | `name` | - |
| `order` | `asc`\|`desc` | `asc` | - |

**Response 200:**
```json
{
  "success": true,
  "data": {
    "products": [{ "id": "...", "storeId": "...", "name": "Kangkung Segar", "price": 3000, "stock": 50, "sku": "SKU-001", "categoryId": "...", "images": null }],
    "pagination": { "limit": 20, "offset": 0, "total": 150, "hasMore": true }
  }
}
```

**Errors:** 404 `Store not found` · 400 `Validation failed` (limit > 100, sortBy invalid)

### 2. GET `/api/stores/:storeId/products/search`
Full-text search (case-insensitive LIKE pada `name`, `sku`, `description`).

**Query params:** `q` (required, min 2 char), `limit` (max 50, default 10), `offset` (default 0)

**Response 200:**
```json
{
  "success": true,
  "data": {
    "query": "kangkung",
    "results": [{ "id": "...", "name": "Kangkung Segar", "price": 3000 }],
    "pagination": { "total": 5, "returned": 5, "offset": 0, "limit": 10 }
  }
}
```

**Errors:** 400 `q` < 2 char · 404 `Store not found`

### 3. GET `/api/products/:productId`
Detail produk tunggal — termasuk `category` object jika ada.

**Errors:** 404 `Product xxx not found`

---

## Admin Routes (Auth: Bearer admin token)

### 4. POST `/api/admin/stores/:storeId/products`
Buat produk baru.

**Body:**
```json
{
  "name": "Kangkung Segar",       // required, max 100
  "price": 3000,                   // required, >= 0
  "stock": 50,                     // optional, int >= 0, null = unlimited
  "sku": "SKU-001",                // required, unique per store
  "categoryId": "uuid",            // optional, harus milik store
  "description": "...",            // optional, max 1000
  "currency": "IDR",               // optional, default IDR
  "images": [{ "url": "https://...", "alt": "Kangkung" }]  // optional, max 10
}
```

**Response 201:** `{ "success": true, "message": "Product created", "data": { ...product } }`

**Errors:** 400 validasi / SKU duplikat · 401 unauthorized · 404 store/category tidak ada

### 5. PATCH `/api/admin/products/:productId`
Update produk. Semua field opsional. SKU **tidak dapat diubah** (unik per store).

**Errors:** 400 validasi (categoryId harus UUID) · 401 · 404 product/category tidak ada

### 6. DELETE `/api/admin/products/:productId`
Soft-delete produk (`deletedAt` di-set, `isActive=false`). Body opsional `{ "reason": "discontinued" }` untuk audit trail.

**Response 204** (No Content). **Errors:** 401 · 404

---

## Audit Trail

Semua aksi admin (create/update/delete) di-log via `logAction` ke tabel `audit_logs`:
- action: `product_created` / `product_updated` / `product_deleted`
- entity: `Product`, entityId: productId, userId: adminId, ipAddress

---

## Contoh Penggunaan

### curl

```bash
# List produk
curl "http://localhost:3000/api/stores/store-1/products?limit=20&sortBy=price&order=asc"

# Search
curl "http://localhost:3000/api/stores/store-1/products/search?q=kangkung"

# Detail
curl "http://localhost:3000/api/products/<productId>"

# Admin — create
curl -X POST "http://localhost:3000/api/admin/stores/store-1/products" \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Bayam","price":2500,"sku":"BYM-1","categoryId":"<categoryId>"}'

# Admin — update
curl -X PATCH "http://localhost:3000/api/admin/products/<productId>" \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{"price":3500}'

# Admin — delete (soft)
curl -X DELETE "http://localhost:3000/api/admin/products/<productId>" \
  -H "Authorization: Bearer <admin_token>"
```

### Node.js fetch

```js
const res = await fetch(`${BASE}/api/stores/${storeId}/products?limit=20`, {
  headers: { Authorization: `Bearer ${token}` },
});
const { success, data } = await res.json();
```

---

## Pagination Guidelines

- `limit` dibatasi 1–100 (consumer), 1–50 (search). Diluar range → 400.
- `offset` berbasis 0. Total + `hasMore` disediakan di response untuk infinite scroll.
- Default sort: `name` ascending.

## Search Algorithm

Implementasi di `productService.searchProducts()`:
- `LIKE` case-insensitive (`contains` + `mode: 'insensitive'`) pada `name`, `sku`, `description`
- Hanya produk `isActive: true` dan `deletedAt: null`
- Max 20 hasil, diurutkan dengan nama yang diawali query didahulukan
- (No full-text `tsvector` — cukup untuk volume MSME; bisa upgrade ke Postgres FTS nanti)

## Integration Notes

- **Context sync saat order dibuat**: `orderService.createOrder()` otomatis memanggil `conversationContextService.updateExtractedEntities()` — entitas `product` (nama + productId) dan `order` tercatat di `conversation_context.extractedEntities`. Produk yang di-order via API langsung terlihat di konteks percakapan.
- **Order item snapshot**: `order_items.productName` + `unitPrice` disalin saat order dibuat, jadi menghapus/mengubah produk tidak merusak riwayat order.

---

## File yang dibuat/diubah (Phase 1.9.2b)

| File | Status |
|---|---|
| `src/routes/products.ts` | **Baru** — 3 consumer routes |
| `src/routes/admin/products.ts` | **Baru** — 3 admin routes + audit log |
| `src/schemas/index.ts` | Diubah — tambah product schemas (Zod) |
| `src/business/product.service.ts` | Diubah — tambah `getProductsByStore()` pagination, detail include category |
| `src/index.ts` | Diubah — mount `/api/admin` (admin products) + `/api` (consumer products) |
| `src/tests/products-routes.e2e.test.ts` | **Baru** — 18 E2E tests |
| `docs/phase-1.9.2b-product-routes.md` | **Baru** — dokumentasi ini |

## Testing

```bash
cd apps/api
npm run build                       # zero TS error
npx tsx --test --test-force-exit src/tests/products-routes.e2e.test.ts   # 18/18 pass
npx tsx --test --test-force-exit src/business/tests/order-context.integration.test.ts  # 14/14 pass (regression)
```
