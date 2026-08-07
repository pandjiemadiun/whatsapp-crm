# Phase 1.9.3 — Magic Paste: Auto-Create Product dari Teks Bebas

## Overview

Endpoint `POST /api/admin/products/magic-paste` — admin paste teks tidak terstruktur (mis. dari chat WhatsApp, catatan, pesan supplier), lalu backend:
1. **LLM extract** struktur produk (name, price, stock, category, unit, description, confidence)
2. **Fuzzy match** kategori ke DB (threshold ≥ 0.75)
3. **Generate SKU unik** `AUTO-{6charStore}-{timestamp}` dengan retry 5x
4. **Create product** dengan `source = 'magic_paste'`
5. Return produk + `extractedEntities` + `warning[]` (max 3)

Jika LLM gagal/unavailable → **fallback regex parser** tetap jalan (deterministik, tanpa dependency eksternal).

---

## Request

```http
POST /api/admin/products/magic-paste
Authorization: [REDACTED]
Content-Type: application/json

{
  "storeId": "b2c3d4e5-2222-4333-9444-555566667777",  // UUID valid
  "text": "Kangkung segar 5000 per ikat, stok 100, kategori sayuran hijau"
}
```

**Validasi (Zod):**
| Field | Rule |
|---|---|
| `text` | min 10, max 2000 chars, trimmed |
| `storeId` | UUID valid |

---

## Response

### Success 201

```json
{
  "success": true,
  "data": {
    "product": {
      "id": "6637bd9c-...",
      "storeId": "b2c3d4e5-...",
      "name": "Kangkung segar",
      "price": 5000,
      "stock": 100,
      "categoryId": "a3bc3e2e-...",
      "sku": "AUTO-B2C3D4-1785487476776",
      "source": "magic_paste",
      "createdAt": "2026-07-31T08:44:36.780Z"
    },
    "extractedEntities": {
      "name": "Kangkung segar",
      "price": 5000,
      "stock": 100,
      "categoryHint": "sayuran hijau",
      "categoryId": "a3bc3e2e-...",
      "description": "per ikat",
      "unit": "ikat",
      "confidence": 0.95
    },
    "warning": null
  }
}
```

### Success dengan warning 201

```json
{
  "success": true,
  "data": {
    "product": { "...": "..." },
    "extractedEntities": { "...": "..." },
    "warning": [
      "Stock ambiguous (unit-based: ikat) — set to null",
      "Category 'sayuran hijau' not found in DB — set to uncategorized",
      "Extraction confidence low (0.68) — please review extracted data"
    ]
  }
}
```

### Errors

| Status | Code | Kapan |
|---|---|---|
| 400 | `ERR_MAGIC_PASTE_PARSE` | Tidak bisa extract name/price; LLM error; missing required |
| 400 | `ERR_PRICE_INVALID` | Harga < 1 atau > 10.000.000 |
| 400 | `ERR_SKU_GENERATION_FAILED` | 5x retry SKU semua bentrok |
| 401 | `ERR_UNAUTHORIZED` | Token admin invalid/absent |
| 404 | `ERR_STORE_NOT_FOUND` | Store tidak ada |
| 500 | `ERR_INTERNAL_SERVER_ERROR` | DB error |

---

## Supported Price Formats

| Input | Hasil |
|---|---|
| `5000` | 5000 |
| `5.000` / `5,000` | 5000 |
| `5K` / `5 ribu` / `5rb` | 5000 |
| `1 juta` / `1jt` / `1M` | 1000000 |
| `Rp 5000` / `Rp5000` / `IDR 5000` | 5000 |
| `Rp 5.000` | 5000 |

**Bounds:** `1 <= price <= 10.000.000` (di luar → 400 `ERR_PRICE_INVALID`).

## Stock Handling

| Teks | Hasil |
|---|---|
| `stok 100` / `100 pcs` | stock = 100 |
| `per ikat` / `per kg` / `per dus` | stock = null + warning "Stock ambiguous" |
| `1/4 kg` | stock = null + warning |
| tidak disebutkan | stock = null (OK) |

## Category Fuzzy Matching

Algoritma (`fuzzyMatchCategory`):
1. Ambil semua kategori aktif store
2. Skor: exact = 1 · substring = 0.85 · token-prefix match = 0.8 · bigram Dice similarity = 0–1
3. Threshold **≥ 0.75** → pakai categoryId
4. `< 0.75` → categoryId = null + warning "Category not found"

Contoh: `"sayur hijau"` → kategori `"Sayuran"` (token `sayur` prefix-match) → match.

## SKU Generation & Retry

- Format: `AUTO-{storeId.slice(0,6).toUpperCase()}-{Date.now()}`
- Pada collision (SKU unique per store), timestamp di-increment 1ms per attempt
- Max 5 attempts → `ERR_SKU_GENERATION_FAILED` dengan daftar SKU yang dicoba

---

## Contoh Penggunaan

### curl

```bash
curl -X POST http://localhost:3000/api/admin/products/magic-paste \
  -H "Authorization: Bearer {ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "storeId": "{STORE_ID}",
    "text": "Kangkung segar 5000 per ikat, stok 100, kategori sayuran hijau"
  }'
```

### Node.js fetch

```js
const res = await fetch(`${BASE}/api/admin/products/magic-paste`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ storeId, text: 'Beras 15000 per kg, stok 200' }),
});
const { success, data } = await res.json();
if (data.warning) console.warn(data.warning); // tampilkan ke admin
```

---

## LLM System Prompt

Embedded di `product.service.ts` (konstanta `MAGIC_PASTE_SYSTEM_PROMPT`). Menangani: format harga Indonesia, stock unit-based → null, category hint, confidence scoring, response JSON ketat. LLM dipanggil via `adapters.ai.generate()` (Groq primary → Gemini fallback, via AIProviderManager).

**Fallback regex** (`regexFallbackExtraction`) menjamin endpoint tetap berfungsi jika LLM down: parse harga (rb/ribu/k/juta), `stok N`, `per {unit}`, `kategori {nama}`.

---

## Audit Trail

Aksi `product_magic_paste` di-log ke `audit_logs` (entity=Product, entityId=productId, changes berisi name/sku/confidence/warnings).

---

## Testing

```bash
cd apps/api
npm run build                                          # 0 errors
npx tsx --test --test-force-exit src/tests/products-magic-paste.e2e.test.ts        # 38/38
npx tsx --test --test-force-exit src/tests/products-routes.e2e.test.ts             # 18/18 (regression)
npx tsx --test --test-force-exit src/business/tests/order-context.integration.test.ts  # 14/14 (regression)
```

**Total: 70 tests hijau.**

## Files (Phase 1.9.3)

| File | Status |
|---|---|
| `src/business/product.service.ts` | Diubah — `magicPaste()`, `fuzzyMatchCategory`, `generateUniqueSKU`, `normalizePriceText`, `regexFallbackExtraction`, prompt LLM |
| `src/routes/admin/products.ts` | Diubah — route `POST /products/magic-paste` |
| `src/schemas/index.ts` | Diubah — `magicPasteSchema` |
| `src/constants/errorCodes.ts` | Diubah — `ERR_MAGIC_PASTE_PARSE`, `ERR_PRICE_INVALID`, `ERR_SKU_GENERATION_FAILED` |
| `src/domain/types.ts` | Diubah — `Product.source` |
| `prisma/schema.prisma` | Diubah — kolom `source` (default `'api'`) + `db push` |
| `src/tests/products-magic-paste.e2e.test.ts` | **Baru** — 38 tests |
| `docs/phase-1.9.3-magic-paste.md` | **Baru** — dokumentasi ini |

## Changelog / Edge Cases

- ✅ Price normalization 12+ format Indonesia
- ✅ Price bounds 1–10M (400 ERR_PRICE_INVALID)
- ✅ Stock unit-based → null + warning
- ✅ Category fuzzy match ≥ 0.75 (exact/substring/token/bigram)
- ✅ SKU retry 5x + collision handling
- ✅ Warning system (max 3): low confidence, category not found, stock ambiguous, price normalized
- ✅ LLM parse error → fallback regex (endpoint tidak pernah 500 karena LLM)
- ✅ `source='magic_paste'` di DB untuk audit
- ✅ Auth 401, store 404, validasi 400
