# LAPORAN TASK B4.3 — Perketat tryShipping vs order-intent overlap

**Tanggal:** 10 Agu 2026
**Commit:** `7b71298` — `fix(chat): tighten tryShipping vs order-intent overlap (TASK B4.3)`
**Store canary:** `store-f7140b5c` (Depot Kinasih)
**Branch:** `main`

---

## 1. Konteks & Bug

**Bug (laporan-taskB2.md, `:449` → `:521`):** `tryShipping` memakai keyword substring `shippingKeywords` secara mentah. Risiko **SEDANG**: keyword `'ambil sendiri'` / `'pickup'` ambigu dengan intent order. Contoh: `"mau pesan kangkung"` bisa tersinggung `ambil sendiri` jika ada di query. Audit B2 eksplisit menyatakan "tidak menemukan false-positive kritis yang pasti di canary" — tetap perketat sebagai pencegahan.

**Fix:** Tambah fungsi pure `isShippingIntent(lower, catalogNames)` di `tier-match.ts`. Jika query mengandung nama produk katalog + kata order eksplisit (`'mau'`/`'pesan'`/`'order'`) **tanpa** kata kirim/ongkir eksplisit (`'ongkir'`/`'kirim'`/`'ekspedisi'`/`'kurir'`/nama jasa kirim), berarti ini order bukan tanya ongkir → `false`. Keyword shipping asli tetap berlaku sebagai fallback.

---

## 2. Kode (verbatim)

### 2a. tier-match.ts — fungsi & konstanta baru (baris 288–345)

```typescript
// ── tryShipping: kata kunci shipping ───────────────────────────────────────
// TASK B4.3 — perketat tryShipping vs intent order. Bug (laporan-taskB2.md,
// risiko SEDANG): "ambil sendiri"/"pickup" ambigu dengan intent order.
// "mau pesan kangkung" (produk + kata order) tidak boleh trigger tryShipping
// — itu order, bukan tanya ongkir.

/** Kata order eksplisit: menandakan niat memesan, bukan tanya ongkir. */
const ORDER_EXPLICIT_WORDS: readonly string[] = [
  'mau', 'pesan', 'order',
];

/**
 * Kata kirim/ongkir eksplisit: override gate order. Jika ada di query,
 * berarti memang tanya ongkir/kirim (bukan order biasa) meski ada nama
 * produk + kata order. Termasuk nama jasa kirim.
 */
const SHIPPING_EXPLICIT_SIGNALS: readonly string[] = [
  'ongkir', 'kirim', 'ekspedisi', 'kurir',
  'jne', 'j&t', 'sicepat', 'anteraja', 'gosend', 'grab',
];

/** Keyword shipping asli — tetap berlaku sebagai fallback di isShippingIntent. */
export const SHIPPING_KEYWORDS: readonly string[] = [
  'ongkir', 'kirim', 'pengiriman', 'ekspedisi', 'biaya kirim',
  'berapa ongkos', 'ambil sendiri', 'pickup', 'dikirim', 'ongkos kirim',
  'kurir', 'jne', 'j&t', 'sicepat', 'anteraja', 'gosend', 'grab',
  'bisa diantar', 'diantar', 'pengirimannya',
];

/**
 * TASK B4.3 — Gate cerdas untuk tryShipping.
 *
 * Aturan:
 * - Jika query mengandung nama produk katalog + kata order eksplisit
 *   ('mau'/'pesan'/'order') TANPA kata kirim/ongkir eksplisit
 *   ('ongkir'/'kirim'/'ekspedisi'/'kurir'/nama jasa kirim) → return false
 *   (ini order, bukan tanya ongkir).
 * - Selain itu, keyword shipping asli tetap berlaku sebias sebelumnya.
 *
 * @param lower         query yang sudah trim().toLowerCase()
 * @param catalogNames  nama produk toko (lowercase)
 */
export function isShippingIntent(lower: string, catalogNames: readonly string[]): boolean {
  const product = hasProductName(lower, catalogNames);
  const hasOrderWord = ORDER_EXPLICIT_WORDS.some((w) => lower.includes(w));
  const hasShippingExplicit = SHIPPING_EXPLICIT_SIGNALS.some((w) => lower.includes(w));

  if (product && hasOrderWord && !hasShippingExplicit) {
    return false;
  }

  return SHIPPING_KEYWORDS.some((kw) => lower.includes(kw));
}
```

Fungsi `hasProductName` dan `tokenize` adalah helper yang sudah ada di file yang sama (dipakai juga oleh `isTotalIntent`/`isOrderStatusIntent`).

### 2b. fallback.service.ts — wiring tryShipping (baris 453–468)

```typescript
// Import (baris 28):
import { isTotalTrigger, isTotalIntent, isPaymentIntent, isOrderStatusIntent,
  ORDER_STATUS_KEYWORDS, isSopRetourIntent, SOP_RETUR_KEYWORDS,
  isShippingIntent, SHIPPING_KEYWORDS } from '../services/chat/tier-match.js';

// tryShipping method (baris 453–468):
private async tryShipping(context: ConversationContext, query: string, ...): Promise<ResponseOption | null> {
  const lower = query.trim().toLowerCase();

  // TASK B4.3 — keyword gate cepat pakai SHIPPING_KEYWORDS (di tier-match.ts).
  const matched = SHIPPING_KEYWORDS.some((kw) => lower.includes(kw));
  if (!matched) return null;

  try {
    // TASK B4.3 — refined gate: produk + kata order ('mau'/'pesan'/'order')
    // tanpa kata kirim/ongkir eksplisit → ini order, bukan tanya ongkir.
    const catalogNames = (await productService.listActiveProducts(context.storeId)).map((p) =>
      p.name.toLowerCase()
    );
    if (!isShippingIntent(lower, catalogNames)) return null;

    const store = await prisma.store.findUnique({ ... });
    ...
```

---

## 3. Scope (git diff --stat)

```
 apps/api/src/business/fallback.service.ts               | 22 ++++----
 apps/api/src/services/chat/tests/tier-match.test.ts   | 51 +++++++++++++++++++
 apps/api/src/services/chat/tier-match.ts              | 58 ++++++++++++++++++++++
```

Hanya 3 file source yang berubah — **strict scope** sesuai kontrak TASK:
- `tier-match.ts` — tambah konstanta + `isShippingIntent`
- `tier-match.test.ts` — tambah 9 test case
- `fallback.service.ts` — **HANYA** bagian `tryShipping` (baris 453–468)

Orchestrator (`conversation.service.ts`) **tidak tersentuh** — diverifikasi via `git diff --stat -- conversation.service.ts` (kosong).

---

## 4. Build & Type Check

```
$ npx tsc --noEmit
EXIT_CODE=0

$ npm run build
> tsc
EXIT_CODE=0
```

---

## 5. Unit Test (tier-match.test.ts)

Runner: `npx tsx --env-file=../../.env --test --test-force-exit src/services/chat/tests/tier-match.test.ts`

```
ℹ tests 40
ℹ suites 5
ℹ pass 40
ℹ fail 0
```

### Test case TASK B4.3 — isShippingIntent (9 case)

| # | Query | catalogNames | Expected | Actual | Status |
|---|-------|-------------|----------|--------|--------|
| 1 | `"berapa ongkir ke Jaksel?"` | noDB (empty) | `true` | `true` | PASS (regresi) |
| 2 | `"kurier pakai JNE ya?"` | noDB (empty) | `true` | `true` | PASS (regresi) |
| 3 | `"mau pesan kangkung"` | CATALOG | `false` | `false` | PASS (pencegahan) |
| 4 | `"berapa ongkir kangkung?"` | CATALOG | `true` | `true` | PASS |
| 5 | `"mau pesan kangkung, berapa ongkir?"` | CATALOG | `true` | `true` | PASS |
| 6 | `"mau ambil sendiri kangkung"` | CATALOG | `false` | `false` | PASS |
| 7 | `"ambil sendiri"` | noDB (empty) | `true` | `true` | PASS (regresi keyword) |
| 8 | `"mau order kangkung via jne"` | CATALOG | `true` | `true` | PASS |
| sanity | `SHIPPING_KEYWORDS` includes `ongkir`, `kirim`, `jne`, `ambil sendiri` | — | — | — | PASS |

CATALOG = `['ayam', 'es teh manis', 'es jeruk manis', 'brambang', 'kentang', 'wortel', 'kangkung']` (canary store-f7140b5c).

---

## 6. Full Test Suite (npm run test:chat)

```
Test Suites: 2 failed, 21 passed, 23 total
Tests:       1 failed, 238 passed, 239 total
```

**2 pre-existing failure yang sama (tidak berubah dari baseline):**
1. `reasoning-v2.test.ts` — outcome label mismatch (`'fallback_reasoning_failed'` vs `'reasoned'`, I-V2-6) — **pre-existing** (dokumentasi di RAILS.md §4)
2. `engine-config-v2.test.ts` — circular dep `redisAdapter` (file-level) — **pre-existing**

**Tidak ada failure baru.** Semua tier-match.test.ts (40/40) pass.

---

## 7. pm2 Restart

```
$ pm2 restart api
[PM2] [api](0) ✓
status: online  pid: 201207  uptime: 3s  (no crash loop)
```

---

## 8. E2E curl Production (regresi check WAJIB)

**Endpoint:** `POST http://localhost:3000/api/webhooks/fonnte?secret=12b11e175e472db3e0a86ab422f86bc71e914c6eadc41a23`

**Request body:**
```json
{
  "sender": "6281231944200",
  "message": "berapa ongkir ke Jaksel?",
  "device": "6289658888008",
  "name": "TestUser",
  "message_id": "test-b43-001"
}
```

**Response HTTP:** `200 {"status":"ok"}`

**Log engine v2:**
```json
{"message":"Engine v2 active","outcome":"tier","llmCalls":0,"storeId":"store-f7140b5c"}
{"message":"Sending Fonnte message","target":"6281231944200"}
```

**Reply content (dari conversation_history di DB):**

| role | content |
|------|---------|
| user | `berapa ongkir ke Jaksel?` |
| assistant | `Berikut biaya pengiriman flat:` + `\n• Dalam kota: Rp 15.000` + `\n• Luar kota: Rp 40.000` |

✅ **Regresi terhindar** — query `"berapa ongkir ke Jaksel?"` tetap menghasilkan shipping response yang benar:
- Rp 15.000 (sesuai `shippingFlatInCity=15000`)
- Rp 40.000 (sesuai `shippingFlatOutCity=40000`)
- `outcome: "tier"` + `llmCalls: 0` (0-LLM fast-path, tidak ada LLM call yang sia-sia)

---

## 9. Logika Decision-Flow (ringkasan)

`isShippingIntent(lower, catalogNames)` memutuskan apakah query adalah pertanyaan ongkir/kirim:

1. **`hasProductName`** — apakah ada nama produk katalog di query? (substring match, dari helper yang sudah ada)
2. **`hasOrderWord`** — apakah ada kata order eksplisit (`'mau'`/`'pesan'`/`'order'`)? Ini kata yang menandakan "mau memesan", bukan "mau tanya ongkir".
3. **`hasShippingExplicit`** — apakah ada kata kirim/ongkir eksplisit (`'ongkir'`/`'kirim'`/`'ekspedisi'`/`'kurir'`/nama jasa kirim)? Ini kata yang mengalahkan (override) gate order.

**Keputusan:**
- Jika **produk + order word + TANPA shipping explicit** → `false` (ini order, bukan tanya ongkir)
- Jika tidak, jatuh ke keyword shipping asli (`SHIPPING_KEYWORDS`) — sama seperti sebelumnya

**Contoh trace:**
- `"berapa ongkir ke Jaksel?"` → tidak ada product → lewat ke keyword check → `'ongkir'` match → `true` ✅
- `"mau pesan kangkung"` → ada `'kangkung'` + `'mau'`/`'pesan'` + tidak ada `'ongkir'`/`'kirim'`/dll → `false` ✅ (order, bukan shipping)
- `"mau ambil sendiri kangkung"` → ada `'kangkung'` + `'mau'` + tidak ada shipping explicit (`'ambil sendiri'` bukan eksplisit) → `false` ✅ (order, bukan shipping)
- `"mau pesan kangkung, berapa ongkir?"` → ada `'kangkung'` + `'mau'` TAPI ada `'ongkir'` → gate tidak tembus → keyword check → `true` ✅

---

## 10. CATATAN

- Store `shippingMode="flat"` dengan `shippingFlatInCity=15000`, `shippingFlatOutCity=40000` — shipping response di E2E sesuai harapan.
- `askIdentity` parameter di `tryShipping` tetap tidak dipakai (legacy, tidak disentuh).
- Perubahan `dist/` dan `logs/` adalah build artifact + runtime log hasil test; ter-commit per instruksi `git add -A`.
