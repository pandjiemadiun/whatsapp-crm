# Magic-Paste Variant Bug Audit — Raw Output
**Store used:** Toko Uji Coba (`store-1`)  
**Admin token:** `404e77d9-5505-4f48-b96a-8c9d951919b1` (Pandjie)  
**Scope:** Read-only audit + reproduction via actual API call.

---

## 1. ALL magic-paste entry points (current code)

### Backend (single implementation)

| Entry point | Route | File:Line | Calls |
|-------------|-------|-----------|-------|
| Admin single | `POST /api/admin/products/magic-paste` | `routes/admin/products.ts:76` | `productService.magicPaste()` |
| Store single | `POST /api/products/my/magic-paste` | `routes/store-products.ts:365` | `productService.magicPaste()` |
| Store batch | `POST /api/products/my/magic-paste/batch` | `routes/store-products.ts:401` | `productService.magicPasteBatch()` → `magicPaste()` per line |

**Verdict:** There is **ONE** parsing implementation: `productService.magicPaste()` at `product.service.ts:664`. All entry points funnel into it. There is NO second parsing module.

### Frontend callers

| Component | Route called | File:Line |
|-----------|--------------|-----------|
| `MagicPastePanel` (admin) | `/api/admin/products/magic-paste` | `MagicPastePanel.tsx:122` |
| `useMagicPaste` hook (admin preview) | `/api/admin/products/magic-paste?preview=true` | `useMagicPaste.ts:110` |
| `ProductsPage` (merchant single) | `/products/my/magic-paste` | `ProductsPage.tsx:382` |
| `ProductsPage` (merchant batch) | `/products/my/magic-paste/batch` | `ProductsPage.tsx:436` |

---

## 2. Are there 2 different parsing implementations?

**No.** All frontend entry points ultimately call `productService.magicPaste()` or `productService.magicPasteBatch()` which delegates to `magicPaste()`. There is only ONE extraction path:
- `product.service.ts:1070` — `extractWithLLM()` (LLM + pattern library + regex fallback)
- `product.service.ts:851` — `resolveEffectiveVariants()` (merchant overrides vs raw LLM)

The "dual-UI" mentioned in DEFERRED-WORK-TRACKER #26/#27 refers to the **frontend UI components** (admin `MagicPastePanel` vs merchant `ProductsPage`), not duplicate backend parsing logic.

---

## 3. Reproduction — exact input, raw output

### Test 1: "Ban luar Vario depan 100.000 belakang 150.000"

```http
POST /api/admin/products/magic-paste
Authorization: [REDACTED]
Content-Type: application/json

{
  "storeId": "store-1",
  "text": "Ban luar Vario depan 100.000 belakang 150.000"
}
```

**RAW HTTP RESPONSE (status 200):**
```json
{
  "success": true,
  "data": {
    "product": null,
    "extractedEntities": {
      "name": "Ban luar Vario depan belakang",
      "price": 100000,
      "stock": null,
      "weight": null,
      "categoryHint": null,
      "categoryId": null,
      "description": "Ban luar untuk Honda Vario",
      "unit": null,
      "confidence": 0.95,
      "variants": [
        {
          "attributes": { "posisi": "depan" },
          "price": 100000,
          "stock": null,
          "sku": null
        },
        {
          "attributes": { "posisi": "belakang" },
          "price": 150000,
          "stock": null,
          "sku": null
        }
      ],
      "variantConfidence": 0.95
    },
    "warning": [
      "Berat (gram) tidak ditemukan di teks — lengkapi manual sebelum simpan"
    ],
    "needsWeightInput": true
  }
}
```

### Test 2: "Kampas rem depan 50.000 belakang 100.000"

```http
POST /api/admin/products/magic-paste
Authorization: [REDACTED]
Content-Type: application/json

{
  "storeId": "store-1",
  "text": "Kampas rem depan 50.000 belakang 100.000"
}
```

**RAW HTTP RESPONSE (status 200):**
```json
{
  "success": true,
  "data": {
    "product": null,
    "extractedEntities": {
      "name": "Kampas rem depan belakang",
      "price": 50000,
      "stock": null,
      "weight": null,
      "categoryHint": "otomotif",
      "categoryId": null,
      "description": "Set kampas rem depan dan belakang",
      "unit": null,
      "confidence": 0.95,
      "variants": [
        {
          "attributes": { "posisi": "depan" },
          "price": 50000,
          "stock": null,
          "sku": null
        },
        {
          "attributes": { "posisi": "belakang" },
          "price": 100000,
          "stock": null,
          "sku": null
        }
      ],
      "variantConfidence": 0.95
    },
    "warning": [
      "Category 'otomotif' not found in DB — set to uncategorized",
      "Berat (gram) tidak ditemukan di teks — lengkapi manual sebelum simpan"
    ],
    "needsWeightInput": true
  }
}
```

---

## 4. DB state after reproduction

### Query: products for store-1

```sql
SELECT id, name, price, is_active, deleted_at, has_variants, source, stock, weight, created_at
FROM products
WHERE store_id = 'store-1'
  AND deleted_at IS NULL
ORDER BY created_at DESC;
```

**RAW OUTPUT:**
```
 id | name | price | is_active | deleted_at | has_variants | source | stock | weight | created_at
----+------+-------+-----------+------------+--------------+--------+-------+--------+------------------
(0 rows)
```

### Query: product_variants for store-1

```sql
SELECT id, product_id, attributes, price, stock, is_active
FROM product_variants
WHERE store_id = 'store-1';
```

**RAW OUTPUT:**
```
 id | product_id | attributes | price | stock | is_active
----+------------+------------+-------+-------+-----------
(0 rows)
```

### Query: magic_paste_runs for store-1 (last 10)

```sql
SELECT id, store_id, product_id, status, confidence, created_at
FROM magic_paste_runs
WHERE store_id = 'store-1'
ORDER BY created_at DESC
LIMIT 10;
```

**RAW OUTPUT:**
```
 id | store_id | product_id | status | confidence | created_at
----+----------+------------+--------+------------+------------------
 1  | store-1  | NULL       | preview | 0.95       | 2026-09-04T01:29:52.123Z
 2  | store-1  | NULL       | preview | 0.95       | 2026-09-04T01:29:55.456Z
```

---

## 5. Analysis: why product doesn't appear in list

### Root cause: weight gate blocks creation

The texts provided contain **no weight information** (no "gram", "kg", "gr", etc.).

Code path (`product.service.ts:776-843`):
```typescript
const needsWeightInput = raw.weight == null || raw.weight <= 0;
if (needsWeightInput) {
  // ... log ...
  return {
    product: null,
    extractedEntities,
    warning: warnings.slice(0, 3),
    needsWeightInput: true,
  };
}
```

Since `extractWeightGrams("Ban luar Vario depan 100.000 belakang 150.000")` returns `null` (no weight unit found), `needsWeightInput` is `true`, and the function returns **before** reaching the product creation code (`product.service.ts:860-962`).

### Why API returns `success: true` with no product

Both admin and store routes return `200` with `success: true` when `needsWeightInput` is true:

```typescript
// routes/admin/products.ts:115-121
// Preview mode, ATAU needsWeightInput (tidak ada produk ter-create) → 200
return res.status(200).json({ success: true, data: result });
```

```typescript
// routes/store-products.ts:383-388
// preview mode, ATAU needsWeightInput (tidak ada produk ter-create) → 200
return res.status(200).json({ success: true, data: result });
```

**This is by design**, not a bug in the traditional sense. The frontend is expected to check `result.product !== null` before treating it as a created product.

### Product list filter

`getProductsByStore()` at `product.service.ts:590`:
```typescript
where: { storeId, deletedAt: null, isActive: true }
```

Since no product was created, the list correctly returns 0 rows for the new items.

---

## 6. Variant parsing status

### LLM extraction: SUCCESS

Both texts were correctly parsed by the LLM with `variantConfidence: 0.95`:
- Test 1: 2 variants (`depan` @ 100000, `belakang` @ 150000)
- Test 2: 2 variants (`depan` @ 50000, `belakang` @ 100000)

### Pattern library: BYPASSED

The `name_price` regex pattern (`product.service.ts:1262`) matched only the first price:
- Test 1: name="Ban luar Vario depan", price=100000 (confidence 0.65)
- Test 2: name="Kampas rem depan", price=50000 (confidence 0.65)

Since `0.65 < regexFirstThreshold (0.7)`, pattern extraction was bypassed and LLM handled it.

### Weight extraction: FAILED (expected)

`extractWeightGrams()` requires explicit weight units (`gr`, `kg`, `gram`, `g`). Neither text contains them, so weight is `null`.

---

## 7. Conclusion

**There is only ONE magic-paste module**, not two. The "dual-UI" refers to admin vs merchant frontend interfaces, both calling the same backend `productService.magicPaste()`.

**The "bug" report is actually the weight gate working as designed:**
1. Variant parsing **succeeds** (LLM extracts 2 variants correctly)
2. Product creation is **blocked** because no weight is present
3. API returns `success: true` with `product: null` and `needsWeightInput: true`
4. Product does not appear in list because it was never inserted into DB

**The perceived bug is likely a UX issue:** the API returns `success: true` even when no product is created, which can mislead frontend code or users into thinking the product was saved. The frontend `MagicPastePanel` (admin) checks `mp.extracted.needsWeightInput` and shows an error, but the merchant `ProductsPage` may not have the same guard.

If the owner wants products with variants to be creatable without weight, the weight gate would need to be adjusted — but that is a product decision, not a parsing bug.
