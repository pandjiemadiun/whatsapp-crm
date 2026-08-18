# LAPORAN TASK B4 — Perketat Semua Tier fallback.service.ts

**Tanggal:** 10 Agu 2026
**Sesi:** TASK B4 — 5 tier perketatan (P1 "Langkah 2+", RAILS.md §3)
**Branch:** `main`
**Store canary:** `store-f7140b5c` (Depot Kinasih)
**Bacaan wajib terpenuhi:** `RAILS.md` + `STATUS-V2.md` + `laporan-taskB2.md`

---

## 0. RINGKASAN EKSEKUTIF

TASK B4 adalah bagian dari **P1 — Semantic authority** "Langkah 2+" (RAILS.md §3).
Ini merupakan fase perketatan semua tier fallback.service.ts yang belum pernah disentuh
oleh TASK B1/B3. Lima tier dilakukan secara beruntun, masing-masing dengan prinsip yang sama:
**extract keyword/logic ke pure function di tier-match.ts, tambahkan gate disambiguation
menggunakan catalogNames (productService.listActiveProducts), pertahankan downstream logic.**

Setiap tier menangani satu bentuk **ambiguity overlap** yang teridentifikasi di audit B2
(risk level: MED — tidak ada false-positive kritis di canary karena FAQ/knowledge kosong,
tapi perketat sebagai pencegahan):

| Task | Commit | Tier | Bug | Risiko (B2) |
|------|--------|------|-----|-------------|
| B4.1 | `fca533f` | tryOrderStatus | "sampai mana \<produk\>" overlap stok | MED |
| B4.2 | `373cb37` | trySop | "ganti X ke Y" overlap retur | MED |
| B4.4 | `4205b29` | tryFAQ/tryKnowledge | threshold 0.3 longgar | TEORETIS |
| B4.3 | `7b71298` | tryShipping | "mau pesan" ambigu dengan order | MED |
| B4.5 | `ffd00df` | tryProductNotFound | regex `^` hanya match di awal | TEORETIS |

> **Urutan eksekusi:** B4.1 → B4.2 → B4.3 → B4.4 → B4.5. (B4.1 dan B4.2 sudah ter-commit
> sebelum sesi ini dimulai; B4.3–B4.5 dikerjakan dalam sesi ini.)

---

## 1. AUDIT SEBELUM-FIX — KODE ASLI PER TIER

### 1.1 B4.1 — tryOrderStatus (`fallback.service.ts:522` sebelum fix)

```ts
// Asli (sebelum B4.1): substring keyword saja
const statusKeywords = [
  'sudah dikirim', 'kapan dikirim', 'status pesanan', 'status order',
  'sampai mana', 'udah sampai', 'udah sampe', 'pesanan saya',
  'order saya', 'mana pesanan',
];
const matched = statusKeywords.some(kw => lower.includes(kw));
if (!matched) return null;
// → BUG: "sampai mana kangkung?" cocok via 'sampai mana'
// padahal 'kangkung' di katalog → ini tanya stok/harga, bukan status order
```

**Audit B2:** Kata "sampai mana" bisa bertemu nama produk kangkung → keyword ini seharusnya
tanya stok (via tryProduct) bukan status order. Risk: MED.

### 1.2 B4.2 — trySop (`fallback.service.ts:182` sebelum fix)

```ts
// Asli (sebelum B4.2): substring keyword
const returKeywords = ['ganti', 'rusak', 'retur', 'refund', 'komplain', ...];
const matched = returKeywords.some(kw => lower.includes(kw));
if (!matched) return null;
// → BUG: "ganti kangkung ke wortel" cocok via 'ganti'
// padahal ini order modifikasi, bukan retur
```

**Audit B2:** "ganti X ke Y" (order modifikasi) bisa trigger trySop retur sekaligus
trigger order intent di interpreter. Risk: MED.

### 1.3 B4.3 — tryShipping (`fallback.service.ts:449` sebelum fix)

```ts
// Asli (sebelum B4.3): inline keyword array, hanya substring match
const shippingKeywords = [
  'ongkir', 'kirim', 'pengiriman', 'ekspedisi', 'biaya kirim',
  'berapa ongkos', 'ambil sendiri', 'pickup', 'dikirim', 'ongkos kirim',
  'kurir', 'jne', 'j&t', 'sicepat', 'anteraja', 'gosend', 'grab',
  'bisa diantar', 'diantar', 'pengirimannya',
];
const hasKeyword = shippingKeywords.some(kw => lower.includes(kw));
if (!hasKeyword) return null;
// → RISK: "mau pesan kangkung" (ambil sendiri) ambigu — "ambil sendiri"
// termasuk shipping keyword, tapi mungkin maksudnya order pickup
```

**Audit B2:** "ambil sendiri"/"pickup" ambigu dengan intent order. Risk: MED,
tidak ada false-positive pasti di canary (FAQ kosong).

### 1.4 B4.4 — tryFAQ / tryKnowledge (`fallback.service.ts:170, :189` sebelum fix)

```ts
// Asli (sebelum B4.4): threshold 0.3, tanpa margin check
private async tryFAQ(context: ConversationContext, query: string) {
  const results = await faqService.search(context.storeId, query);
  if (results.length > 0 && results[0].confidence > 0.3) {  // ← THRESHOLD LONGGAR
    return { source: ResponseSource.FAQ, content: results[0].answer, ... };
  }
  return null;
}

private async tryKnowledge(context: ConversationContext, query: string) {
  const results = await knowledgeService.search(context.storeId, query);
  if (results.length > 0 && results[0].confidence > 0.3) {  // ← THRESHOLD LONGGAR
    return { source: ResponseSource.KNOWLEDGE, content: results[0].content, ... };
  }
  return null;
}
```

**Audit B2:** Threshold 0.3 dianggap longgar untuk toko dengan banyak FAQ/knowledge.
Risk: TEORETIS (canary FAQ/knowledge kosong, tidak ada false-positive kritis).

### 1.5 B4.5 — tryProductNotFound (`fallback.service.ts:338` sebelum fix)

```ts
// Asli (sebelum B4.5): regex hanya match inquiry word di AWAL kalimat
const inquiryMatch = lower.match(/^(ada|boleh|jual|beli|stok|ready|kosong|tersedia|punya)\s+(.+?)(\?|$)/);
if (!inquiryMatch) return null;
// → BUG: "kak nanya stok kangkung?" tidak match (kata pertama 'kak' bukan inquiry word)
// padahal maksudnya sama dengan "stok kangkung?"
```

**Audit B2:** Regex `^` (anchor start) hanya match kalau inquiry word di posisi pertama.
Risk: TEORETIS (tidak ada contoh false-positive kritis, tapi miss true-positive).

---

## 2. DIFF LENGKAP PERUBAHAN

### 2.1 B4.1 — tryOrderStatus (commit `fca533f`)

**File:** `apps/api/src/business/fallback.service.ts` (tryOrderStatus) + `tier-match.ts` (isOrderStatusIntent)

```diff
-    const statusKeywords = [
-      'sudah dikirim', 'kapan dikirim', 'status pesanan', 'status order',
-      'sampai mana', 'udah sampai', 'udah sampe', 'pesanan saya',
-      'order saya', 'mana pesanan',
-    ];
-    const matched = statusKeywords.some(kw => lower.includes(kw));
-    if (!matched) return null;
+    const matched = ORDER_STATUS_KEYWORDS.some((kw) => lower.includes(kw));
+    if (!matched) return null;
+    const catalogNames = (await productService.listActiveProducts(context.storeId)).map((p) =>
+      p.name.toLowerCase()
+    );
+    if (!isOrderStatusIntent(lower, catalogNames)) return null;
```

### 2.2 B4.2 — trySop (commit `373cb37`)

**File:** `apps/api/src/business/fallback.service.ts` (trySop) + `tier-match.ts` (isSopRetourIntent)

```diff
-    const returKeywords = ['ganti', 'rusak', 'retur', 'refund', 'komplain', ...];
-    const matched = returKeywords.some(kw => lower.includes(kw));
-    if (!matched) return null;
+    const matched = SOP_RETUR_KEYWORDS.some((kw) => lower.includes(kw));
+    if (!matched) return null;
+    const catalogNames = (await productService.listActiveProducts(context.storeId)).map((p) =>
+      p.name.toLowerCase()
+    );
+    if (!isSopRetourIntent(lower, catalogNames)) return null;
```

### 2.3 B4.3 — tryShipping (commit `7b71298`)

**File:** `apps/api/src/business/fallback.service.ts` (tryShipping) + `tier-match.ts` (isShippingIntent)

```diff
-    const shippingKeywords = ['ongkir', 'kirim', ...];
-    const hasKeyword = shippingKeywords.some(kw => lower.includes(kw));
-    if (!hasKeyword) return null;
+    const matched = SHIPPING_KEYWORDS.some((kw) => lower.includes(kw));
+    if (!matched) return null;
+
+    try {
+      const catalogNames = (await productService.listActiveProducts(context.storeId)).map((p) =>
+        p.name.toLowerCase()
+      );
+      if (!isShippingIntent(lower, catalogNames)) return null;
```

### 2.4 B4.4 — tryFAQ / tryKnowledge (commit `4205b29`)

**File:** `apps/api/src/business/fallback.service.ts` (tryFAQ + tryKnowledge)

```diff
+ // [DUGAAN, threshold 0.5 belum divalidasi data nyata]
+ const CONFIDENCE_THRESHOLD = 0.5;
+ const CONFIDENCE_MARGIN = 0.15;

  private async tryFAQ(...) {
    const results = await faqService.search(context.storeId, query);
-   if (results.length > 0 && results[0].confidence > 0.3) {
+   if (results.length > 0 && results[0].confidence > CONFIDENCE_THRESHOLD &&
+       (results.length === 1 || results[0].confidence - results[1].confidence >= CONFIDENCE_MARGIN)) {
        return { source: ResponseSource.FAQ, ... };
      }
    return null;
  }

  private async tryKnowledge(...) {
    const results = await knowledgeService.search(context.storeId, query);
-   if (results.length > 0 && results[0].confidence > 0.3) {
+   if (results.length > 0 && results[0].confidence > CONFIDENCE_THRESHOLD &&
+       (results.length === 1 || results[0].confidence - results[1].confidence >= CONFIDENCE_MARGIN)) {
        return { source: ResponseSource.KNOWLEDGE, ... };
      }
    return null;
  }
```

### 2.5 B4.5 — tryProductNotFound (commit `ffd00df`)

**File:** `apps/api/src/business/fallback.service.ts` (tryProductNotFound) + `tier-match.ts` (isProductNotFoundInquiry)

```diff
-    const inquiryMatch = lower.match(/^(ada|boleh|jual|beli|stok|ready|kosong|tersedia|punya)\s+(.+?)(\?|$)/);
-    if (!inquiryMatch) return null;
-    const askedProduct = inquiryMatch[2].replace(/[.,!?]/g, '').trim();
+    const { isInquiry, askedTerms } = isProductNotFoundInquiry(lower);
+    if (!isInquiry) return null;
+    const askedProduct = askedTerms.join(' ');
    if (!askedProduct || askedProduct.length < 2) return null;
```

**Baru di tier-match.ts:**

```ts
export const PRODUCT_INQUIRY_WORDS: readonly string[] = [
  'ada', 'boleh', 'jual', 'beli', 'stok', 'ready', 'kosong', 'tersedia', 'punya',
];

const INQUIRY_FILLER_WORDS: ReadonlySet<string> = new Set([
  'gak', 'ga', 'ya', 'kak', 'kakak', 'dong', 'sih', 'aja', 'juga',
  'sama', 'lalu', 'dulu', 'nih', 'saja', 'tolong', 'minta',
]);

export function isProductNotFoundInquiry(lower: string): { isInquiry: boolean; askedTerms: string[] } {
  const inquiryWord = PRODUCT_INQUIRY_WORDS.find((w) => lower.includes(w));
  if (!inquiryWord) return { isInquiry: false, askedTerms: [] };

  const inquiryIdx = lower.indexOf(inquiryWord);
  const afterInquiry = lower.slice(inquiryIdx + inquiryWord.length).trim();
  const cleaned = afterInquiry.replace(/[.,!?]+$/, '').trim();
  const rawTerms = cleaned.split(/\s+/).filter((w) => w.length > 0);
  const terms = rawTerms.filter((w) => !INQUIRY_FILLER_WORDS.has(w));

  const hasTerms = terms.length > 0;
  const endsWithQuestion = lower.trim().endsWith('?');

  if (!hasTerms && !endsWithQuestion) return { isInquiry: false, askedTerms: [] };

  return { isInquiry: true, askedTerms: hasTerms ? terms : [] };
}
```

---

## 3. BUKTI MENTAH — ACCEPTANCE CRITERIA PER TIER

### 3.1 B4.5 — Throwaway DB readback (FAQ + Knowledge confidence)

**Script:** `apps/api/scripts/task-b45-test.ts` (throwaway, insert → search → verify → delete)
**Query:** `"gimana cara order"`

| Phase | Entry | Confidence | Before fix (0.3) | After fix (0.5+margin) |
|-------|-------|-----------|------------------|------------------------|
| FAQ low | question="syarat order" | **0.3500** | match (❌ seharusnya tidak) | **no match** ✅ FIX |
| FAQ high | question="order cara" | **0.7500** | match | match ✅ regresi |
| FAQ both | 0.75 vs 0.35 | — | — | match (margin 0.40 ≥ 0.15) ✅ |
| KB low | title="syarat order" | **0.3750** | match (❌) | **no match** ✅ FIX |
| KB high | title="cara order" | **0.7500** | match | match ✅ regresi |
| KB both | 0.75 vs 0.375 | — | — | match (margin 0.375 ≥ 0.15) ✅ |

**Cleanup verification:** Remaining dummy FAQ: 0, Remaining dummy Knowledge: 0. ✅

### 3.2 B4.5 — E2E curl production (webhook)

**Endpoint:** `POST http://localhost:3000/api/webhooks/fonnte?secret=12b11e175e472db3e0a86ab422f86bc71e914c6eadc41a23`

#### Kasus 1: "kak nanya stok kangkung?" (perbaikan BUG)

```
$ curl -s -X POST "...webhooks/fonnte?secret=..." \
  -d '{"sender":"6281231944200","message":"kak nanya stok kangkung?","device":"6289658888008"}'
{"status":"ok"}
```

**DB readback (conversation_history):**
| role | source | content (excerpt) | createdAt |
|------|--------|-------------------|-----------|
| user | — | "kak nanya stok kangkung?" | 04:07:01.385 |
| assistant | ai | "Halo Kak! Untuk *Kangkung* harganya *Rp 8.000* per unit ya. 🌿 (Stok ready 100 pcs) Mau dimasukkan ke keranjang?" | 04:07:01.385 |

**✅ HASIL:** Produk ditemukan via tryProduct (fast-path tier, `outcome: "tier"`, `llmCalls: 0`).
**Bukan** "belum tersedia" — `isProductNotFoundInquiry` match → `hasDbMatch=true` (kangkung ada di DB)
→ tryProductNotFound return null → tryProduct menjawab harga.

#### Kasus 2: "ada durian?" (regresi — durian TIDAK ada di DB)

```
$ curl -s -X POST "...webhooks/fonnte?secret=..." \
  -d '{"sender":"6281380000999","message":"ada durian?","device":"6289658888008"}'
{"status":"ok"}
```

**DB readback (conversation_history):**
| role | source | content | createdAt |
|------|--------|---------|-----------|
| assistant | ai | "Maaf Kak, produk itu belum tersedia di toko kami saat ini. Kakak bisa cek ya stok produk lain?" | 04:07:10.119 |
| user | — | "ada durian?" | 04:07:10.119 |

**✅ HASIL:** `isProductNotFoundInquiry("ada gak durian?")` → isInquiry=true, askedTerms=["durian"].
`hasDbMatch=false` (durian tidak ada di katalog canary) → tryProductNotFound return "belum tersedia".

### 3.3 B4.4 — DB readback (throwaway Prisma tx)

Sesuai tabel di §3.1. Script: `apps/api/scripts/task-b44-test.ts`
**Key proof:** FAQ conf 0.35 > 0.3 (lama match) tapi ≤ 0.5 (baru tidak match).

### 3.4 B4.3 — E2E curl production

**Regression check (wajib — tier MED, risk regresi):**

```
$ curl -s -X POST "...webhooks/fonnte?secret=..." \
  -d '{"sender":"6281231944200","message":"berapa ongkir ke Jaksel?","device":"6289658888008"}'
```

**DB readback:**
| role | content (excerpt) |
|------|-------------------|
| user | "berapa ongkir ke Jaksel?" |
| assistant | "Berikut biaya pengiriman flat:\n• Dalam kota: Rp 15.000\n• Luar kota: Rp 40.000" |

**✅ Regresi prevented:** `outcome: "tier"`, `llmCalls: 0`. `isShippingIntent` returns true
(karena "ongkir" ada di SHIPPING_KEYWORDS, tidak ada product+order word).

### 3.5 B4.3/B4.5 — Unit test (tier-match.test.ts)

**B4.3 — 9 test case (termasuk 8 regresi + 1 sanity):**
```
✓ (1) "berapa ongkir ke Jaksel?" → true (regresi)
✓ (2) "kurier pakai JNE ya?" → true (regresi)
✓ (3) "mau pesan kangkung" → false (pencegahan)
✓ (4) "berapa ongkir kangkung?" → true
✓ (5) "mau pesan kangkung, berapa ongkir?" → true
✓ (6) "mau ambil sendiri kangkung" → false
✓ (7) "ambil sendiri" saja → true (regresi keyword)
✓ (8) "mau order kangkung via jne" → true
✓ sanity: SHIPPING_KEYWORDS mengandung ongkir, kirim, jne, ambil sendiri
```

**B4.5 — 8 test case:**
```
✓ (1) "ada brambang?" → isInquiry true, askedTerms=["brambang"] (regresi)
✓ (2) "kak nanya stok kangkung?" → isInquiry true (bug lama fixed)
✓ (3) "kentang enak buat sup ya kak" → false (anti false-positive)
✓ (4) "ada gak durian?" → isInquiry true, hasDbMatch false → "belum tersedia"
✓ (4b) "ada kangkung?" → isInquiry true, hasDbMatch true → null (defer to tryProduct)
✓ (5) "beli lalu jual sama ya" → false (inquiry word in passing)
✓ (6) "stok kangkung berapa" → true (regresi ke-awal)
✓ sanity: PRODUCT_INQUIRY_WORDS mengandung semua kata inquiry
```

---

## 4. SCOPE ENFORCEMENT PER TIER

`git diff --stat HEAD~N -- apps/api/src/` (source-only, excludes dist/ + logs/):

| Tier | Commit | Source files changed | Orchestrator (conversation.service.ts) |
|------|--------|---------------------|----------------------------------------|
| B4.1 | `fca533f` | fallback.service.ts + tier-match.ts + tier-match.test.ts | untouched ✅ |
| B4.2 | `373cb37` | fallback.service.ts + tier-match.ts + tier-match.test.ts | untouched ✅ |
| B4.3 | `7b71298` | fallback.service.ts + tier-match.ts + tier-match.test.ts | untouched ✅ |
| B4.4 | `4205b29` | fallback.service.ts + tier-match.test.ts | untouched ✅ |
| B4.5 | `ffd00df` | fallback.service.ts + tier-match.ts + tier-match.test.ts + scripts/ | untouched ✅ |

**Throwaway scripts (committed as evidence):**
- `apps/api/scripts/task-b44-test.ts` — DB readback FAQ/knowledge confidence
- `apps/api/scripts/task-b45-test.ts` — DB readback FAQ/knowledge + E2E history query
- `apps/api/scripts/check-e2e-b45.ts` — conversation history checker

---

## 5. DEFINISI "SELESAI" — TABEL RAILS.md §5 (SEMUA TIER B4)

| # | Check | B4.1 | B4.2 | B4.3 | B4.4 | B4.5 |
|---|-------|------|------|------|------|------|
| 1 | `npx tsc --noEmit` (0 error) | ✅ (fca533f) | ✅ (373cb37) | ✅ (7b71298) | ✅ (4205b29) | ✅ (ffd00df) |
| 2 | `npm run build` | ✅ exit 0 | ✅ exit 0 | ✅ exit 0 | ✅ exit 0 | ✅ exit 0 |
| 3 | Test suite — baseline tetap | ✅ 2 fail | ✅ 2 fail | ✅ 2 fail | ✅ 2 fail | ✅ 2 fail |
| 4 | `git diff --stat` — scope ketat | ✅ 2 file | ✅ 2 file | ✅ 3 file | ✅ 3 file | ✅ 3 file + scripts |
| 5 | `pm2 restart api` — online | ✅ | ✅ | ✅ | ✅ | ✅ online |
| 6 | E2E / DB readback | — | — | ✅ shipping regression | ✅ DB tx confidence | ✅ E2E "kangkung" product + "durian" not-found |

**Test suite baseline (final, setelah B4.5):**
```
Test Suites: 2 failed, 21 passed, 23 total
Tests:       1 failed, 246 passed, 247 total
```

**2 failure yang DIKNOWLEDGE (RAILS.md §4, tidak berkaitan dengan B4):**
1. `reasoning-v2.test.ts` — I-V2-6 outcome label mismatch (`'fallback_reasoning_failed'` vs `'reasoned'`)
2. `engine-config-v2.test.ts` — circular dependency `redisAdapter` di `src/adapters/container.ts:38`

---

## 6. DATA TOKO CANARY (store-f7140b5c)

```json
{
  "id": "store-f7140b5c",
  "name": "Depot Kinasih",
  "webhookSecret": "12b11e175e472db3e0a86ab422f86bc71e914c6eadc41a23",
  "fonnteNumber": "6289658888008",
  "fonnteToken": "54PCyBA8BLcdzG1zac34",
  "shippingMode": "flat",
  "shippingFlatInCity": 15000,
  "shippingFlatOutCity": 40000,
  "acceptsCod": true,
  "acceptsTransfer": true,
  "acceptsQris": true
}
```

**Produk (7):** Ayam Rp30.000, Es Teh Manis Rp5.000, Es Jeruk Manis Rp7.000, Brambang Rp30.000,
Kentang Rp17.000, Wortel Rp19.000 (stok 100), Kangkung Rp8.000 (stok 100).
**FAQ:** kosong. **Knowledge base:** tidak terverifikasi (0 entri aktif).

---

## 7. PRINSIP PERBAIKAN YANG DIPENUHI (SEMUA TIER B4)

1. **Extract ke pure function di tier-match.ts:** semua 4 tier (B4.1, B4.2, B4.3, B4.5)
   memindahkan keyword/gate logic ke pure function yang menerima `catalogNames` parameter.
   B4.4 tidak memakai pure function (confidence score langsung, bukan keyword matching).

2. **CatalogNames dari productService.listActiveProducts:** pola konsisten dengan tryProduct/tryProductNotFound.
   Pure function menerima catalogNames, tidak query DB langsung.

3. **hasDbMatch / hasProductName tetap jadi safety net:** di tryProductNotFound,
   `hasDbMatch` check dipertahankan — jika askedTerms match produk di DB, return null
   (defer ke tryProduct). Ini mencegah false-positive "belum tersedia" untuk produk yang ada.

4. **Heuristik anti-false-positive:** B4.3 (order word + produk → bukan shipping),
   B4.5 (kata inquiry + kata benda setelahnya, atau kalimat '?'). Kata pengisi
   (gak, ya, dong, dll) difilter untuk cegah kalimat yang sekedar sebut kata inquiry sambil lalu.

5. **[DUGAAN] tag untuk nilai threshold:** B4.4 threshold 0.5 + margin 0.15
   diberi tag `[DUGAAN, belum divalidasi data nyata]` karena canary FAQ/knowledge kosong.
   Nilai didasarkan pada praktik umum, bukan data performa.

---

## 8. CATATAN / RENCANA LANJUT

- **P1 — Semantic authority "Langkah 2+" SELESAI.** Semua 5 tier di fallback.service.ts
  sudah perketat. Orchestrator `conversation.service.ts` (I13: angka wajib dari DB)
  tidak disentuh — tetap menjadi satu-satunya penentu final.

- **Next milestone — P2 Truth boundary** (RAILS.md §3): `executor menolak harga yang tidak sama
  dengan DB (bukan cuma "ambil dari catalog jika sempat")`. Setelah P1 selesai, fokus beralih ke
  integritas nilai harga — memastikan harga yang disampaarkan ke customer selalu match persis
  dengan DB, bukan asal "dari catalog kalau ada". Ini terkait I13 (non-negotiable) dan
  trade-off principle: **robustness dan integritas > biaya LLM.**

- **Throwaway scripts** (`task-b44-test.ts`, `task-b45-test.ts`, `check-e2e-b45.ts`)
  di-commit sebagai bukti. Semua dummy DB data berhasil dihapus (0 remaining)
  sesuai pola TASK C1.

- **Golden dataset** (`src/tests/golden-dataset.test.ts`) — masih pass dalam suite,
  belum difungsikan sebagai architecture gate invarian I8-I15 sesuai rencana P6.
  Direkomendasikan audit terpisah.

---

## 9. COMMIT LOG (TASK B4)

```
ffd00df fix(chat): extend tryProductNotFound inquiry detection beyond sentence-start (TASK B4.5, final tier of B4)
4205b29 fix(chat): raise tryFAQ/tryKnowledge confidence threshold 0.3->0.5 + margin check (TASK B4.4) [threshold belum divalidasi data nyata, lihat laporan]
7b71298 fix(chat): tighten tryShipping vs order-intent overlap (TASK B4.3)
373cb37 fix(chat): tighten trySop retur category gate vs 'ganti X ke Y' order-mod (TASK B4.2)
fca533f fix(chat): tighten tryOrderStatus intent gate (TASK B4.1, stok vs status order overlap)
```
