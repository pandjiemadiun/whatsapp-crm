# Phase 1.9.6 — Analytics Magic Paste: Kontrak API & Definisi KPI

> Dokumen teknis untuk endpoint analytics confidence. Berlaku untuk deployment live
> (`https://api.qlobot.web.id`). Semua angka/definisi merujuk implementasi aktual di
> `apps/api/src/routes/analytics.ts` (bukan asumsi).

---

## 1. Endpoint

```
GET /api/analytics/magic-paste
```

- **Auth**: Bearer token store owner (`Authorization: Bearer <token>`). Tanpa token → `401`.
- **Scope**: data hanya untuk store milik token (`storeId` selalu dari token, tidak pernah dari query/body).

## 2. Query Params

| Param   | Tipe     | Default | Deskripsi |
|---------|----------|---------|-----------|
| `from`  | `YYYY-MM-DD` | — | Batas awal, interpretasi **local start-of-day** (`00:00:00.000`) — **inclusive** |
| `to`    | `YYYY-MM-DD` | — | Batas akhir, interpretasi **local end-of-day** (`23:59:59.999`) — **inclusive** |
| `status`| `success \| failed \| preview` | — | Filter status |
| `source`| `store \| admin` | — | Filter sumber eksekusi |
| `limit` | int (1–200)  | `50` | Jumlah baris history |
| `offset`| int ≥ 0      | `0`  | Pagination offset |

> ⚠️ Parsing tanggal memakai `utils/date-range.ts` (`parseLocalDay`) — komponen tanggal
> di-parse sebagai **local date proses**, bukan `new Date('YYYY-MM-DD')` yang UTC (bug off-by-one
> yang sudah diperbaiki di 1.9.6). `from`/`to` keduanya **inclusive**.
>
> **Timezone proses API = `Asia/Jakarta` (WIB)** — diset di `ecosystem.config.js` (`TZ`)
> sejak 2026-08-01. Filter/trend dihitung dalam WIB, sehingga record pukul 00:00–07:00 WIB
> masuk tanggal WIB yang benar. Untuk user dengan timezone non-WIB (`Store.timezone`),
> lihat backlog timezone per-store.

## 3. Response Shape

```jsonc
{
  "success": true,
  "data": {
    "summary": {
      "totalExtractions": 6,        // semua record (success+failed+preview)
      "totalSuccess": 3,
      "failedCount": 2,
      "previewCount": 1,
      "averageConfidence": 0.56,    // avg SEMUA record (failed=0 ikut menurunkan)
      "medianConfidence": 0.8,      // median dari SUCCESS-only, 2 desimal
      "minConfidence": 0,
      "maxConfidence": 0.95,
      "lowConfidenceCount": 1,      // success dengan confidence < 0.8
      "lowConfidenceRate": 0.33,    // lowConfidenceCount / totalSuccess
      "successRate": 0.5            // totalSuccess / totalExtractions
    },
    "trend": [                      // 14 hari terakhir, key local-date server
      { "date": "2026-08-01", "count": 4, "failed": 1, "avgConfidence": 0.44 }
    ],
    "distribution": { "low": 0, "medium": 1, "high": 2 },
    "sourceBreakdown": [
      { "source": "store", "count": 5, "avgConfidence": 0.54 }
    ],
    "history": [                    // diurutkan createdAt DESC
      {
        "id": "uuid",
        "productId": "uuid|null",
        "textLength": 30,
        "confidence": 0.95,
        "status": "success|failed|preview",
        "warnings": ["..."] | null,
        "extractedName": "Rendang daging sapi | null",
        "categoryHint": "Daging | null",
        "source": "store|admin",
        "errorMessage": "Cannot extract required fields from text | null",
        "createdAt": "2026-08-01T00:30:00.000Z"
      }
    ],
    "pagination": { "limit": 50, "offset": 0, "total": 6 }
  }
}
```

## 4. Definisi KPI

| KPI | Rumus / Definisi | Catatan |
|-----|------------------|---------|
| **Total runs** (`totalExtractions`) | `COUNT(*)` semua `magic_paste_runs` dalam filter | Termasuk success, failed, preview |
| **Average confidence** | `AVG(confidence)` **semua** record dalam filter | Record `failed` ber-confidence `0` ikut menurunkan rata-rata. Ini by design — menggambarkan kualitas keseluruhan pipeline |
| **Median confidence** | Median `confidence` dari record **`status=success`** saja | Di-round 2 desimal |
| **Low confidence count** | `COUNT(success WHERE confidence < 0.8)` | Ambang 0.8 konsisten dengan warning LLM (`Extraction confidence low`) |
| **Low confidence rate** | `lowConfidenceCount / totalSuccess` | 0 jika belum ada success |
| **Success rate** | `totalSuccess / totalExtractions` | Preview TIDAK dihitung sukses |
| **Distribusi confidence** | Bucket dari success-only: `<0.6` (low), `0.6–0.799` (medium), `≥0.8` (high) | |

## 5. Sumber Data

- Tabel `magic_paste_runs` (model `MagicPasteRun`) — ditulis oleh `productService.magicPaste()`
  lewat `recordMagicPasteRun()` pada semua path: `success`, `failed` (parse/price), `preview`.
- Tabel `analytics` lama (daily message rollup) **tidak dipakai** untuk fitur ini — dead table, tidak disentuh.

## 6. Referensi Implementasi

- Route: `apps/api/src/routes/analytics.ts`
- Date helpers: `apps/api/src/utils/date-range.ts` (`parseLocalDay`, `localDayKey`, `buildLocalDayKeys`)
- Instrumentasi: `apps/api/src/business/product.service.ts` → `recordMagicPasteRun()`
- Hook frontend: `apps/dashboard/src/hooks/useMagicPasteAnalytics.ts`
- Page: `apps/dashboard/src/pages/AnalyticsPage.tsx`
