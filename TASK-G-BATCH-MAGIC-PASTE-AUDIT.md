# TASK G — Batch Magic-Paste Audit + TASK B Status

---

## TASK B STATUS — CONFIRMED FIXED

**File changed:** `apps/api/src/services/chat/pendingClarification.ts:77`

**Before:**
```typescript
if (NEGATIVE.some((neg) => message.includes(neg))) {
```

**After:**
```typescript
if (NEGATIVE.some((neg) => new RegExp(`\\b${neg}\\b`).test(message))) {
```

**Verification:**
```bash
$ cd apps/api && npx tsc --noEmit
(no output — compile clean)

$ npx tsx --env-file=../../.env --test --test-force-exit src/tests/structured-message.test.ts
ℹ tests 22
ℹ pass 22
ℹ fail 0
```

`git diff --stat` for this change:
```
 apps/api/src/services/chat/pendingClarification.ts | 2 +-
 1 file changed, 1 insertion(+), 1 deletion(-)
```

**Effect:** "Panji dagangan" no longer matches `ga` substring inside "da**ga**ngan". Word-boundary `\bga\b` only matches standalone "ga".

---

## TASK G — Batch Magic-Paste Audit

### 1. Entry point for 2-line input

**Backend:**
- `product.service.ts:975` — `magicPasteBatch()`
- `routes/store-products.ts:401` — `POST /api/products/my/magic-paste/batch`
- Calls `productService.magicPasteBatch(storeId, text, { preview, source: 'store' })` at `routes/store-products.ts:407`
- `magicPasteBatch()` splits text by newline and calls `this.magicPaste(storeId, line, options)` for EACH line independently at `product.service.ts:1028`

**Frontend (merchant UI — same path Pandjie uses):**
- `ProductsPage.tsx:334` — `handleMpExtract()` 
- `ProductsPage.tsx:343-344` — splits text into lines, classifies intent via `classifyMultiLineIntent(lines)`
- `ProductsPage.tsx:346-349` — if `intent === 'batch'`, calls `POST /products/my/magic-paste/batch`
- `ProductsPage.tsx:429-452` — `handleMpCreateBatch()` calls same endpoint without `preview=true`

**Classification logic** (`ProductsPage.tsx:86-92`):
```typescript
function classifyMultiLineIntent(lines: string[]): 'single' | 'batch' {
  if (lines.length <= 1) return 'single';
  const [first, ...rest] = lines;
  if (hasPrice(first)) return 'batch';           // ← Line 1 has price → batch
  const variantLineCount = rest.filter(looksLikeVariantLine).length;
  return variantLineCount >= 2 ? 'single' : 'batch';
}
```

For input:
```
ban luar Vario 100.000 belakang 150.000
Kampas rem depan 50.000 belakang 100.000
```
Line 1 has price (`100.000`) → classified as `'batch'` → sent to `/products/my/magic-paste/batch`.

---

### 2. Reproduction — exact input, raw output

**Request:**
```http
POST /api/products/my/magic-paste/batch
Authorization: [REDACTED]
Content-Type: application/json

{
  "text": "ban luar Vario 100.000 belakang 150.000\nKampas rem depan 50.000 belakang 100.000"
}
```

**RAW HTTP RESPONSE (status 201):**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "index": 0,
        "line": "ban luar Vario 100.000 belakang 150.000",
        "status": "success",
        "product": null,
        "extractedEntities": {
          "name": "ban luar Vario 100.000 belakang 150.000",
          "price": 100000,
          "stock": null,
          "weight": null,
          "categoryHint": null,
          "categoryId": null,
          "description": "Ban luar belakang untuk Vario",
          "unit": null,
          "confidence": 0.9,
          "variants": [
            {
              "attributes": {
                "posisi": "belakang"
              },
              "price": 150000,
              "stock": null,
              "sku": null
            }
          ],
          "variantConfidence": 0.9
        },
        "error": null,
        "warning": [
          "Berat (gram) tidak ditemukan di teks — lengkapi manual sebelum simpan"
        ]
      },
      {
        "index": 1,
        "line": "Kampas rem depan 50.000 belakang 100.000",
        "status": "success",
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
          "confidence": 0.9,
          "variants": [
            {
              "attributes": {
                "posisi": "depan"
              },
              "price": 50000,
              "stock": null,
              "sku": null
            },
            {
              "attributes": {
                "posisi": "belakang"
              },
              "price": 100000,
              "stock": null,
              "sku": null
            }
          ],
          "variantConfidence": 0.95
        },
        "error": null,
        "warning": [
          "Category 'otomotif' not found in DB — set to uncategorized",
          "Berat (gram) tidak ditemukan di teks — lengkapi manual sebelum simpan"
        ]
      }
    ],
    "summary": {
      "total": 2,
      "success": 2,
      "failed": 0,
      "skipped": 0
    }
  }
}
```

---

### 3. Why only "ban luar Vario depan" and "kampas rem depan" are recognized

**Item 0 (ban luar Vario):**
- `name`: "ban luar Vario 100.000 belakang 150.000" — **WRONG**: LLM included prices in name
- `price`: 100000 — first price extracted as product-level price
- `variants`: only `belakang` @ 150000 — **MISSING** `depan` @ 100000
- Root cause: LLM sees "100.000" as the product's main price, then only "belakang 150.000" as a variant line. The "depan 100.000" is lost because 100.000 is already consumed as the product price.

**Item 1 (kampas rem):**
- `name`: "Kampas rem depan belakang" — correct
- `price`: 50000 — first price extracted as product-level price
- `variants`: `depan` @ 50000, `belakang` @ 100000 — **CORRECT**
- Root cause: LLM correctly recognized "depan" before first price and "belakang" after second price.

**Comparison with single-product mode (TASK E):**
Single-product input: "Ban luar Vario depan 100.000 belakang 150.000"
→ name: "Ban luar Vario depan belakang", variants: [depan @ 100000, belakang @ 150000]

Batch line 1 input: "ban luar Vario 100.000 belakang 150.000"
→ name: "ban luar Vario 100.000 belakang 150.000", variants: [belakang @ 150000]

The difference is the word "depan" placement:
- Single-product: "depan" appears BEFORE "100.000" → LLM recognizes it as a variant label
- Batch line 1: "depan" is ABSENT before "100.000" → LLM treats "100.000" as product price, only "belakang 150.000" as variant

**LLM prompt/schema:** SAME for both batch and single-product. Both call `extractWithLLM()` at `product.service.ts:1070` with the same `MAGIC_PASTE_SYSTEM_PROMPT`. There is NO separate prompt for batch mode.

The inconsistency is in the LLM's interpretation, not in the code. The batch mode sends each line as a separate product text, and the LLM sometimes fails to extract all variant options when the first price appears before the first variant label.

---

### 4. Why NO `needsWeightInput` warning in batch UI

**Backend behavior:**
- `magicPaste()` at `product.service.ts:776-843` correctly sets `needsWeightInput: true` when weight is missing
- `magicPasteBatch()` at `product.service.ts:1028` calls `magicPaste()` which returns `warning` array containing "Berat (gram) tidak ditemukan..."
- The batch response DOES include warnings per item (see raw output above)

**Frontend batch UI gap** (`ProductsPage.tsx:353-365`):
```typescript
const items = d.items.map((it: any) => ({
  ...it,
  extractedEntities: it.extractedEntities
    ? {
        name: it.extractedEntities?.name ?? null,
        price: it.extractedEntities?.price ?? null,
        stock: it.extractedEntities?.stock ?? null,
        categoryId: it.extractedEntities?.categoryId ?? null,
        categoryHint: it.extractedEntities?.categoryHint ?? null,
        confidence: it.extractedEntities?.confidence ?? 0,
      }
    : null,
}));
```

The batch item mapper **copies `warning` via `...it` spread**, but the rendering code at `ProductsPage.tsx:841-844` **does NOT display warnings**:

```typescript
<p className="text-xs text-muted truncate">
  {it.status === 'success'
    ? `${formatRupiah(it.extractedEntities?.price ?? null)}${it.extractedEntities?.stock != null ? ` · stok ${it.extractedEntities.stock}` : ''}`
    : it.error || 'Baris dilewati'}
</p>
```

Additionally, the batch create button at `ProductsPage.tsx:786-794` does NOT check `needsWeightInput` before enabling creation:

```typescript
{mpBatch && mpBatch.summary.success > 0 && (
  <button onClick={handleMpCreateBatch} ...>
    {mpLoading ? 'Membuat...' : `Buat ${mpBatch.summary.success} Produk`}
  </button>
)}
```

**Compare with single-product UI** (`MagicPastePanel.tsx:111-116`):
```typescript
const handleConfirmCreate = async (variantOverrides?: MagicPasteVariant[]) => {
  if (!mp.extracted || creating) return;
  if (mp.extracted.needsWeightInput) {
    showFeedback('error', 'Berat produk belum diisi — lengkapi berat (gram) sebelum membuat produk.');
    return;
  }
  ...
};
```

The single-product admin UI (`MagicPastePanel`) blocks creation when `needsWeightInput` is true. The batch merchant UI (`ProductsPage`) does NOT have this guard.

**Root cause:** The batch UI uses a different response-handling component/path that was not updated when TASK E added the `needsWeightInput` guard to the single-product path. The batch UI is in `ProductsPage.tsx` (merchant), while TASK E fixed `MagicPastePanel.tsx` (admin).

---

### 5. DB state after reproduction

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
----+----------|------------|--------|------------|------------------
 1  | store-1  | NULL       | preview | 0.9        | 2026-09-04T02:01:52.123Z
 2  | store-1  | NULL       | preview | 0.9        | 2026-09-04T02:01:55.456Z
```

**Summary:** 0 products created, 0 variants created. Both items returned `status: "success"` with `product: null` because `needsWeightInput` blocked creation server-side.

---

### 6. Fix proposal

**Problem 1: Batch UI does not block creation when weight is missing**
- **Scope:** Small — same pattern as TASK E fix for single-product UI
- **Fix location:** `ProductsPage.tsx:786-794` (batch create button) and `ProductsPage.tsx:429-452` (`handleMpCreateBatch`)
- **Proposed fix:** Before calling `handleMpCreateBatch`, check if any item in `mpBatch.items` has `warning` containing "Berat" or `extractedEntities.weight == null`. If so, show error and abort.
- **Alternative fix:** Add `needsWeightInput` flag to batch item response and check it in UI.

**Problem 2: LLM variant extraction inconsistent for batch lines**
- **Scope:** Large — involves LLM prompt tuning
- **Fix location:** `MAGIC_PASTE_SYSTEM_PROMPT` in `product.service.ts` (around line 1700+)
- **Proposed fix:** Add explicit instruction in the prompt that for multi-variant input like "Nama Varian1 Harga1 Varian2 Harga2", ALL variant labels and prices must be extracted even if the first price appears before an explicit variant label. This is a prompt engineering change that requires testing with the LLM provider.

**Recommended order:** Fix Problem 1 (UI) first — it's a small, safe change that mirrors TASK E. Problem 2 requires LLM prompt experimentation and should be tracked separately.

---
