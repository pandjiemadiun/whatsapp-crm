# Laporan TASK P3.3 — Satukan shape kolom `extractedEntities` (T2 fix)

**Tanggal:** 10 Agu 2026
**Prasyarat:** P3.1 (`c164729`) + P3.2 (`3780453`) sudah commit — kolom baru
`workspace_v2` sudah ada & jadi sumber kebenaran v2. Sehingga kolom
`extractedEntities` **sekarang MURNI dipakai v1/legacy saja**; v2 tidak lagi
menulis ke kolom ini. Ini menyederhanakan T2 karena v2 sudah "keluar" dari kolom.
**Scope:** hanya kolom `extractedEntities`. Kolom `workspace_v2` &
`workspace.ts`/`conversation.service.ts` jalur v2 **tidak disentuh**.

Akar masalah (laporan-taskP3-audit.md §6 T2, TINGGI): penulis kolom
`extractedEntities` bentuknya berseragam — `updateExtractedEntities`/
`mergeEntities`/`parseEntities` menulis/membaca **ARRAY** (`ExtractedEntity[]`),
sedangkan `setPendingClarification`/`modifyCart`/`parseExtractedEntities` pakai
**OBJECT** (`ExtractedEntities`). Penulis terakhir menentukan bentuk; pembaca
yang asumsi berbeda me-reset data → `confirmedItems`/`pendingClarification`/
`trackedEntities` hilang. Verbatim guard lama:

```ts
async updateExtractedEntities(conversationId, entities: ExtractedEntity[]) {
  if (!entities.length) return;            // guard ARRAY
  const existing = this.parseEntities(raw.extractedEntities);   // parse ARRAY
  const merged = this.mergeEntities(existing, entities);        // expect ARRAY
  ...
}
```

## 1. Re-audit pasca-P3.1/P3.2 (verifikasi, bukan asumsi)

Grep penuh atas `apps/api/src/` untuk memastikan tidak ada lagi penulis v2 ke
kolom `extractedEntities` (v2 sudah persist ke `workspace_v2` sejak P3.1/P3.2):

```
$ grep -rn "updateWorkspaceV2\|saveWorkspace\|loadWorkspace" src/business/conversation.service.ts
145  workspace = loadWorkspace(JSON.stringify(ctxRow.workspace_v2));   ← baca dari workspace_v2
152  await conversationContextService.updateWorkspaceV2(conversationId, workspace);
249  const resolvedWs = saveWorkspace(workspace);
249  await conversationContextService.updateWorkspaceV2(conversationId, JSON.parse(resolvedWs));
333  const updatedWorkspace = saveWorkspace(workspace);
333  await conversationContextService.updateWorkspaceV2(conversationId, JSON.parse(updatedWorkspace));
```

Tidak ada lagi `saveWorkspace(...)` → `updateExtractedEntities(...)` (jalur
NO-OP yang dulu). Semua persist v2 lewat `updateWorkspaceV2` → kolom
`workspace_v2`. **Kolom `extractedEntities` tidak lagi ditulis oleh v2.**

Verifikasi tidak ada penulis ARRAY tersisa ke kolom `extractedEntities`:

```
$ grep -rn "extractedEntities: \[" apps/api/src/      → (kosong, tidak ada array-literal writer)
$ grep -rni "parseEntities\|mergeEntities" apps/api/src/ → (kosong, tidak ada referensi)
```

Kesimpulan re-audit: kolom `extractedEntities` kini **seluruh penulisnya
menulis OBJECT**. Shape ARRAY tidak lagi ada di mana pun.

## 2. Shape kanonik + migrasi

**Keputusan:** shape kanonik kolom `extractedEntities` = **OBJECT** per
`domain/types.ts:257 ExtractedEntities` (karena mayoritas titik nyata
`confirmedItems`/`pendingClarification`/`modifyCart`/`setPendingClarification`
sudah dipakai object). Field baru `trackedEntities?: ExtractedEntity[]` (
`types.ts:268`) menampung token entitas mentah (product/order/quantity/
destination) yang dulu ditulis berupa array — kini **gabungkan ke dalam object**.

Perubahan kunci pada `src/business/conversation-context.service.ts`:

- `initializeContext` create: `extractedEntities: []` → **`extractedEntities: {}`**
  (object kosong).
- `updateExtractedEntities(conversationId, entities: ExtractedEntity[])` —
  **tetap menerima array token** (caller `order.service.ts:426` tidak perlu
  berubah signatur), **tapi tidak lagi menulis array ke kolom.** Sekarang:
  ```ts
  const existing = this.parseExtractedEntities(raw.extractedEntities);   // OBJECT
  const merged = this.mergeTrackedEntities(existing, entities);          // → OBJECT.trackedEntities
  await prisma.conversationContext.update({
    data: { extractedEntities: merged as unknown as Prisma.InputJsonValue },
  });
  ```
- `parseEntities` (private, parse ARRAY) **dihapus** — diganti satu jalur
  `parseExtractedEntities` (OBJECT). `parseExtractedEntities` sekarang toleran:
  bila kolom masih berisi ARRAY legacy (readback data lama), kembalikan default
  object kosong (tidak crash, tidak menimpa field lain).
- `mergeEntities` (expect ARRAY) **dihapus** — diganti `mergeTrackedEntities`
  yang merge token ke `existing.trackedEntities` (dedup by `type:value`,
  confidence-wins) dan kembalikan object penuh (higga `confirmedItems`/
  `pendingClarification`/dst tidak tertimpa).
- `mapToContextData`: `this.parseEntities(raw.extractedEntities)` →
  `this.parseExtractedEntities(raw.extractedEntities)` (konsisten object).

### File lain (caller disesuaikan, tidak ditanya ulang object)

- `order.service.ts:426` — `updateExtractedEntities(conversationId, entities)`
  tetap kirim `ExtractedEntity[]`; nilainya kini masuk ke `.trackedEntities`
  object. **Tidak berubah.** (`order` ref tetap dilacak.)
- `fallback.service.ts` — `saveDiscussedItems` (997/1003) ganti inline parsing
  pakai `conversationContextService.parseExtractedEntities`, sehingga update
  `&{ discussedItems, lastAmbiguousPrompt }` **mempertahankan** field lain
  (`trackedEntities`, `pendingClarification`, `previousMutation`,
  `recipientName`, `shippingAddress`) — sebelumnya inline `parseEntities`
  (array) mengorbankan field-field object. `upsertExtractedEntities` (private,
  kode mati, tak ada caller) + `ExtractedEntities` import tidak dipakai
  **dihapus.**
- `conversation.service.ts:920/924` (`storePreviousMutation`/`getCartFromDb`)
  — sudah pakai object spread / `parseExtractedEntities`. Tetap object.
  **`workspace_v2` tidak disentuh.**

`git diff --stat` (commit `eb74929`, source):

```
 apps/api/src/business/conversation-context.service.ts  | 51 +++++++++-------
 apps/api/src/business/fallback.service.ts            | 68 ++---------------------
 .../tests/order-context.integration.test.ts           | 43 +++++++++++++--
 apps/api/src/domain/types.ts                          |  4 +-
 4 files changed, 77 insertions(+), 89 deletions(-)
```

## 3. Hapus `parseEntities` (array) → satu jalur parse

`parseEntities`/`mergeEntities` (array) **dihapus**; satu-satunya jalur parse
sekarang `parseExtractedEntities` (OBJECT) yang dipakai oleh `updateExtractedEntities`,
`modifyCart`, `setPendingClarification`, `getCartFromDb`, `mapToContextData`, dan
`fallback.saveDiscussedItems`. Semua caller dari tabel audit §2
(`order.service.ts:426`, `fallback.service.ts:997/1003`, dst) konsisten object.

## ACCEPTANCE

1. `npx tsc --noEmit -p apps/api` → **0 error**
   ```
   TSC EXIT: 0
   ```

2. `npx oxlint` → **0 error** (hanya warning pre-existing, tidak berkaitan)
   ```
   LINT EXIT: 0
   ```

3. Build `npm run build` (tsc) → **sukses** (`TSC_EXIT=0`).

4. `npx tsx --test src/business/tests/order-context.integration.test.ts`:
   ```
   ℹ tests 15
   ℹ pass 14
   ℹ fail 1
   ```
   - **T2. Shape consistency ... PASSED.**
   - Test 9 ("Update order status -> confirmed sets confirmedAt") gagal —
     **pre-existing, tidak berkaitan `extractedEntities` shape** (assert
     `confirmed.confirmedAt` null → issue order-service timestamp, bukan shape).
     Baseline (sebelum P3.3) juga 1 failed (Test 9). **Tidak bertambah gagal.**

5. `grep`: tidak ada lagi penulis v2 / array-literal / `parseEntities`/`mergeEntities`
   ke kolom `extractedEntities` (lihat §1).

## Test manual — before/after readback (T2 scenario)

Skenario dulu kena bug T2: **tulis lewat `updateExtractedEntities` lalu baca lewat
`parseExtractedEntities`** (atau sebaliknya) → data tidak boleh hilang. Script
round-trip langsung ke kolom DB `conversationContext.extractedEntities`
(raw readback `findUnique({ select: { extractedEntities: true }})`).

### BEFORE (state lama, sebelum P3.3 — ARRAY vs OBJECT berseragam)

Penulis `updateExtractedEntities` menulis **ARRAY** ke kolom; `parseExtractedEntities`
(object-guard §2 T2) melihat `Array.isArray(raw)` → me-reset ke
`{discussedItems:[], confirmedItems:[], ... }` → **`trackedEntities` &
`pendingClarification` hilang.**

### AFTER (P3.3 — kolom SELALU OBJECT)

**BEFORE (fresh init):** kolom = `{}` (object, via `initializeContext`)
```json
{}
```

**AFTER `updateExtractedEntities(tr Teh, qty 2)` — kolom mentah:**
```json
{
  "recipientName": null,
  "confirmedItems": [],
  "discussedItems": [],
  "shippingAddress": null,
  "trackedEntities": [
    { "type": "product", "value": "Es Teh", "confidence": 0.95 },
    { "type": "quantity", "value": "2", "confidence": 0.9 }
  ],
  "previousMutation": null,
  "lastAmbiguousPrompt": null,
  "pendingClarification": null
}
```

**AFTER `setPendingClarification("Berapa banyak?")` — kolom mentah (readback:**
**`trackedEntities` TETAP ada + `pendingClarification` bertambahan):**
```json
{
  "recipientName": null,
  "confirmedItems": [],
  "discussedItems": [],
  "shippingAddress": null,
  "trackedEntities": [
    { "type": "product", "value": "Es Teh", "confidence": 0.95 },
    { "type": "quantity", "value": "2", "confidence": 0.9 }
  ],
  "previousMutation": null,
  "lastAmbiguousPrompt": null,
  "pendingClarification": {
    "options": [{ "id": "2", "label": "2" }, { "id": "3", "label": "3" }],
    "asked_at": "2026-08-10T14:05:00.018Z",
    "question": "Berapa banyak?",
    "retry_count": 0,
    "expected_type": "choice"
  }
}
```

**READBACK via `parseExtractedEntities` (lewat `getContext`):**
```json
{
  "trackedEntities": [
    { "type": "product", "value": "Es Teh", "confidence": 0.95 },
    { "type": "quantity", "value": "2", "confidence": 0.9 }
  ],
  "pendingClarification": {
    "options": [{ "id": "2", "label": "2" }, { "id": "3", "label": "3" }],
    "asked_at": "2026-08-10T14:05:00.018Z",
    "question": "Berapa banyak?",
    "retry_count": 0,
    "expected_type": "choice"
  }
}
```

```
T2 RESULT: trackedEntities preserved = true
T2 RESULT: pendingClarification preserved = true
T2 RESULT: PASS — data tidak hilang
```

→ `updateExtractedEntities` (object-merge ke `trackedEntities`) tidak lagi
menimpa `pendingClarification`; `setPendingClarification` (object) tidak lagi
menimpa `trackedEntities`. **Bug T2 (TINGGI) teratasi.**

## Catatan ruang lingkup (TIDAK dikerjakan di P3.3 — scope kolom `extractedEntities`)

- Kolom `workspace_v2` tidak disentuh (P3.1/P3.2). `workspace.ts`/jalur v2 tidak berubah.
- Race condition last-write-wins `extractedEntities` (T4) & fallback tier menimpa
  (T5) — tidak dikerjakan (klasifikasi SEDAH/RENDAH, luar scope `extractedEntities`
  shape).
