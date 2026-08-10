# LAPORAN TASK B4.4 — Raise tryFAQ/tryKnowledge Confidence Threshold

**Tanggal:** 10 Agu 2026
**Commit:** `4205b29` — `fix(chat): raise tryFAQ/tryKnowledge confidence threshold 0.3->0.5 + margin check (TASK B4.4)`
**Store canary:** `store-f7140b5c` (Depot Kinasih)
**Branch:** `main`

---

## 1. Konteks & Bug

**Bug (laporan-taskB2.md, `:163` tryFAQ, `:182` tryKnowledge):**
Threshold confidence `0.3` dianggap **teoretis longgar** untuk toko dengan FAQ/knowledge
base yang banyak. Audit B2 menyatakan eksplisit: *"tidak bisa demonstrasi (FAQ canary
kosong)"* dan *"tidak mengklaim contoh false-positive spesifik"* — ini risiko **teoretis**,
bukan bug terbukti. Tetap perketat sebagai pencegahan.

**Fix:**
1. Naikkan threshold dari `0.3` → `0.5` (`CONFIDENCE_THRESHOLD`)
   - `[DUGAAN, threshold 0.5 belum divalidasi data nyata]` — nilai ini berasal dari
     praktik umum confidence threshold, bukan data nyata toko canary (FAQ/knowledge kosong).
2. Tambah syarat margin: jika ≥2 hasil, hasil #1 harus ≥0.15 lebih tinggi dari #2
   (`CONFIDENCE_MARGIN`), mencegah jawaban asal pada kandidat serba lemah.

---

## 2. Kode (verbatim)

### 2a. fallback.service.ts — konstanta baru (baris 34–40)

```typescript
// TASK B4.4 — confidence gate untuk tryFAQ/tryKnowledge.
// [DUGAAN, threshold 0.5 belum divalidasi data nyata] — naik dari 0.3
// karena risiko false-positive teoretis (lihat laporan-taskB2.md: "tidak
// menemukan false-positive kritis yang pasti", tapi threshold 0.3 teoretis
// longgar untuk toko dengan FAQ/knowledge banyak).
const CONFIDENCE_THRESHOLD = 0.5;
const CONFIDENCE_MARGIN = 0.15;
```

### 2b. fallback.service.ts — tryFAQ (baris 178–197)

```typescript
private async tryFAQ(context: ConversationContext, query: string): Promise<ResponseOption | null> {
  try {
    const results = await faqService.search(context.storeId, query);
    // TASK B4.4 — [DUGAAN, threshold 0.5 belum divalidasi data nyata]
    // Naik dari 0.3; tambah margin: jika ≥2 hasil, #1 harus ≥0.15
    // lebih tinggi dari #2 agar tidak jawab asal pada kandidat serba lemah.
    if (results.length > 0 && results[0].confidence > CONFIDENCE_THRESHOLD &&
        (results.length === 1 || results[0].confidence - results[1].confidence >= CONFIDENCE_MARGIN)) {
      return {
        source: ResponseSource.FAQ,
        content: results[0].answer,
        confidence: results[0].confidence,
        cost: 0,
        metadata: { faqId: results[0].id, matchedQuestion: results[0].question },
      };
    }
    return null;
  } catch {
    adapters.logger.warn('FAQ search failed, skipping to next fallback tier');
    return null;
  }
}
```

### 2c. fallback.service.ts — tryKnowledge (baris 201–220)

```typescript
private async tryKnowledge(context: ConversationContext, query: string): Promise<ResponseOption | null> {
  try {
    const results = await knowledgeService.search(context.storeId, query);
    // TASK B4.4 — [DUGAAN, threshold 0.5 belum divalidasi data nyata]
    // Naik dari 0.3; tambah margin: jika ≥2 hasil, #1 harus ≥0.15
    // lebih tinggi dari #2 agar tidak jawab asal pada kandidat serba lemah.
    if (results.length > 0 && results[0].confidence > CONFIDENCE_THRESHOLD &&
        (results.length === 1 || results[0].confidence - results[1].confidence >= CONFIDENCE_MARGIN)) {
      return {
        source: ResponseSource.KNOWLEDGE,
        content: results[0].content,
        confidence: results[0].confidence,
        cost: 0,
        metadata: { knowledgeId: results[0].id, matchedTitle: results[0].title },
      };
    }
    return null;
  } catch {
    adapters.logger.warn('Knowledge search failed, skipping to next fallback tier');
    return null;
  }
}
```

---

## 3. Scope (git diff --stat)

```
 apps/api/src/business/fallback.service.ts           | 20 +++++++++++++++++-- (source)
 apps/api/dist/business/fallback.service.*           | build artifacts (B4.3 → B4.4)
 apps/api/logs/combined.log / error.log              | runtime log (test runs)
```

**Hanya 1 file source yang berubah:** `fallback.service.ts` — **HANYA** bagian
`tryFAQ` dan `tryKnowledge`. Tidak ada perubahan di `tier-match.ts`, `conversation.service.ts`
(verifikasi via `git diff --stat -- conversation.service.ts` → kosong).

---

## 4. Build & Type Check

```
$ npx tsc --noEmit
EXIT_CODE=0

$ npm run build
> tsc
BUILD_EXIT=0
```

---

## 5. Unit Test (npm run test:chat)

```
Test Suites: 2 failed, 21 passed, 23 total
Tests:       1 failed, 238 passed, 239 total
```

**2 pre-existing failure (tidak berubah dari baseline B4.3):**
1. `reasoning-v2.test.ts` — outcome label mismatch (`'fallback_reasoning_failed'` vs `'reasoned'`, I-V2-6) — **pre-existing**
2. `engine-config-v2.test.ts` — circular dep `redisAdapter` (file-level) — **pre-existing**

**Tidak ada failure baru.** Semua `tier-match.test.ts` (40/40) termasuk task B4.3 tetap pass.

---

## 6. pm2 Restart

```
$ pm2 restart api
[PM2] [api](0) ✓
status: online  pid: 202165  uptime: 5s  (no crash loop)
```

---

## 7. DB Readback — Throwaway Prisma Tx (WAJIB, B4.4 tidak bisa e2e curl)

**Script:** `apps/api/scripts/task-b44-test.ts` (throwaway, di-commit sebagai bukti)

**Metodologi:** Insert FAQ/knowledge dummy ke store canary `store-f7140b5c`,
panggil `faqService.search()` / `knowledgeService.search()` secara langsung
(bukan tryFAQ/tryKnowledge — agar dapat confidence mentah), lalu simulate
threshold logic lama (0.3, tanpa margin) vs baru (0.5, dengan margin).
Semua dummy dihapus setelah selesai.

**Query test:** `"gimana cara order"`

### 7a. FAQ

| Phase | FAQ question | answer | confidence | Sebelum (0.3) | Sesudah (0.5+margin) |
|-------|-------------|--------|------------|---------------|----------------------|
| 1a (low only) | `"syarat order"` | `"hubungi admin ya"` | **0.350** | match ✅ | **no match ✗** → FIX |
| 1b (high only) | `"order cara"` | `"silakan order"` | **0.750** | match ✅ | match ✅ → REGRESI AMAN |
| 1c (both) | both | — | 0.750 vs 0.350 | — | match ✅ (margin 0.4 ≥ 0.15) |

**Log hasil search (faqrService.search):**
```
Phase 1a: FAQ results: 1
  [0] conf=0.3500  q="syarat order"
  SEBELUM fix (threshold 0.3): match=true — confidence 0.350 > threshold 0.3
  SESUDAH fix (threshold 0.5 + margin): match=false — confidence 0.350 <= threshold 0.5
  ✓ SEBELUM match (salah), SESUDAH tidak match → FIX BEKERJA

Phase 1b: FAQ results: 1
  [0] conf=0.7500  q="order cara"
  SEBELUM fix: match=true — confidence 0.750 > threshold 0.3
  SESUDAH fix: match=true — confidence 0.750 > threshold 0.5
  ✓ Keduanya match → REGRESI AMAN

Phase 1c: FAQ results: 2
  [0] conf=0.7500  q="order cara"
  [1] conf=0.3500  q="syarat order"
  Margin: 0.7500 - 0.3500 = 0.4000 (>= 0.15? YES)
  ✓ High-confidence first, margin cukup → match
```

### 7b. Knowledge

| Phase | title | content | confidence | Sebelum (0.3) | Sesudah (0.5+margin) |
|-------|-------|---------|------------|---------------|----------------------|
| 2a (low only) | `"syarat order"` | `"order bisa langsung"` | **0.375** | match ✅ | **no match ✗** → FIX |
| 2b (high only) | `"cara order"` | `"gimana order bisa"` | **0.750** | match ✅ | match ✅ → REGRESI AMAN |

**Log hasil search (knowledgeService.search):**
```
Phase 2a: Knowledge results: 1
  [0] conf=0.3750  title="syarat order"
  SEBELUM fix (threshold 0.3): match=true — confidence 0.375 > threshold 0.3
  SESUDAH fix (threshold 0.5 + margin): match=false — confidence 0.375 <= threshold 0.5
  ✓ SEBELUM match (salah), SESUDAH tidak match → FIX BEKERJA

Phase 2b: Knowledge results: 1
  [0] conf=0.7500  title="cara order"
  SEBELUM fix: match=true — confidence 0.750 > threshold 0.3
  SESUDAH fix: match=true — confidence 0.750 > threshold 0.5
  ✓ Keduanya match → REGRESI AMAN
```

### 7c. Cleanup Verification

```
Remaining dummy FAQ: 0 (harus 0)       — ✓
Remaining dummy knowledge: 0 (harus 0) — ✓
Semua dummy data berhasil dihapus
```

### 7d. Scoring Proof (FAQ search algorithm trace)

Query: `"gimana cara order"` → `queryWords = ["gimana", "cara", "order"]`

**FAQ low (q="syarat order", a="hubungi admin ya"):**
- Word overlap (question): `["syarat","order"]` → `order` matches → 1/2 × 0.5 = **0.25**
- Word overlap (answer): `["hubungi","admin"]` → 0 hits → **0.0**
- Priority: 1 → (1/1) × 0.1 = **0.1**
- **Total: 0.35** ✅

**FAQ high (q="order cara", a="silakan order"):**
- Word overlap (question): `["order","cara"]` → both match → 1.0 × 0.5 = **0.5**
- Word overlap (answer): `["silakan","order"]` → `order` matches → 0.5 × 0.3 = **0.15**
- Priority: 1 → **0.1**
- **Total: 0.75** ✅

---

## 8. Keputusan & [DUGAAN] Tag

- **Threshold 0.5** dan **margin 0.15** adalah `[DUGAAN, belum divalidasi data nyata]` —
  nilainya didasarkan pada praktik umum, bukan data performa toko canary (FAQ/knowledge kosong).
  Jika setelah rollout ke toko dengan data FAQ/knowledge, tingkat recall menurun
  secara signifikan, threshold dapat dikoreksi kembali.
- Nilai `0.15` untuk margin dipilih sebagai keseimbangan: cukup untuk membedakan
  hasil kuat vs lemah, tapi tidak terlalu ketat sehingga menolak hasil valid.
- Nilai `0.5` untuk threshold sesuai pola existing di `getResponse` untuk tier lain
  (tryOrderStatus/tryTotal/tryShipping/tryPayment/tryCatalog/tryProductNotFound
  yang semuanya memakai `confidence > 0.5`).

---

## 9. CATATAN

- Store canary `shippingMode="flat"` — perubahan B4.4 tidak memengaruhi shipping tier.
- `getResponse` secondary gate masih memakai `> 0.35` (loose than internal `0.5`) —
  tidak disentuh per scope ketat (hanya tryFAQ/tryKnowledge). Secondary gate ini
  sekarang redundant karena tryFAQ/tryKnowledge sudah filter lebih ketat, tapi
  tidak berbahaya dibiarkan.
- Throwaway script `apps/api/scripts/task-b44-test.ts` di-commit sebagai bukti.
  Semua dummy data berhasil dihapus (verified 0 remaining).
