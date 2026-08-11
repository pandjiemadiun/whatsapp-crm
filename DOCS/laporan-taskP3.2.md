# Laporan TASK P3.2 — v2 loadWorkspace map dari state v1 lama (T3 fix)

**Tanggal:** 10 Agu 2026
**Prasyarat:** P3.1 sudah commit (`c164729`). Kolom `workspace_v2` sudah ada.
**Scope:** Ketika `workspace_v2` kosong/null (conversation baru switch v1→v2),
migrasi sekali dari legacy `extractedEntities` → `WorkspaceV2` lalu persist ke
`workspace_v2` jadi sumber kebenaran. **Tidak** mengubah cara v1 menulis
`extractedEntities`.

## Perubahan

### `src/services/chat/workspace.ts` (PURE accessor — tidak ada I/O)
- Import `ExtractedEntities, PendingClarification` dari `domain/types.js`.
- `hasLegacyState(legacy)`: true bila ada `confirmedItems` atau `pendingClarification`.
- `mapLegacyEntitiesToWorkspace(legacy) → WorkspaceV2`:
  - `confirmedItems` → `draft_cart` (`action:'add'`, `status:'confirmed'`, `qty_source:'default'`).
  - `pendingClarification` → `pendings` (`status:'active'`; `question/options/asked_at/retry_count→attempts`).
  - `recipientName/shippingAddress/lastAmbiguousPrompt` → `resolved_facts`.
  - `discussedItems/previousMutation` tidak dipetakan (tidak ada padanan v2) — default kosong.

### `src/business/conversation.service.ts` (~:141, titik baca)
- `select: { workspace_v2: true, extractedEntities: true }`.
- Jika `workspace_v2` terisi → `loadWorkspace(workspace_v2)` (sumber kebenaran, P3.1).
- Jika kosong & legacy ada isi → `mapLegacyEntitiesToWorkspace` + **persist sekali**
  via `updateWorkspaceV2` agar turn berikutnya tidak re-map (workspace_v2 jadi
  sumber kebenaran). Kolom kosong & legacy pun kosong → `loadWorkspace('{}')`.

`git diff --stat` (source):
```
apps/api/src/services/chat/workspace.ts      | 107 ++++++++++++++++++++++++++
apps/api/src/business/conversation.service.ts | 39 +++++++---
```

## ACCEPTANCE

- `npx tsc --noEmit -p apps/api` → **0 error** ✓
- `npm run build` → **sukses** ✓
- `npm run test:chat -- src/services/chat/__tests__` → **2 failed suites / 1 failed test** (baseline, tidak bertambah) ✓
- `git diff --stat` → **hanya file terkait** (`workspace.ts`, `conversation.service.ts`) ✓
- `pm2 restart api` → **online, tidak crash loop** ✓

## Test manual — simulasi v1→v2 switch (store `store-f7140b5c`, engine=v2)

**Setup:** seed legacy state `extractedEntities` berisi `pendingClarification`
+ `confirmedItems`, dengan `workspace_v2 = NULL` (simulasi conversation yang
dibuat oleh v1, belum pernah ada state v2). customer `6282199933333`.

### READBACK BEFORE turn 2 (P3.2)
```
ws_null=true | has_pendingClarification=true
extractedEntities = {"confirmedItems":[{"product":"Ayam","qty":1,"price":35000,...}],
                     "pendingClarification":{"id":"pc_legacy_1","question":"Mau konfirmasi pesanan ayam?",
                     "options":[{"id":"opt1","label":"iya"}],"rawOptions":["iya","tidak"],
                     "expected_type":"affirmative","asked_at":"2026-08-10T18:20:00Z","retry_count":0}}
```

### Turn 2 `"iya"` (via Fonnte webhook, v2 engine)

**AFTER-fix (P3.2) readback + log:**
```
workspace_v2 = {"pendings":[{"id":"pc_legacy_1","status":"resolved",
            "options":["iya","tidak"],"asked_at":"2026-08-10T18:20:00Z",
            "question":"Mau konfirmasi pesanan ayam?",...}],
     "draft_cart":[{"qty":1,"action":"add","status":"confirmed","product":"Ayam","qty_source":"default"}],
            "schema_version":"","options_presented":[],"resolved_facts":{},"conversation_summary":""}
```
```
log: {"outcome":"resolved","llmCalls":0,"action":"EXECUTE","message":"Engine v2 active"}
```
→ v2 **melihat** pending lama (dimigrasikan `extractedEntities`→`workspace_v2`),
lalu resolve via fast-path 0-LLM (`iya` affirmatif). **Bukan minta ulang dari nol.**

**BEFORE-fix (P3.1-only, tanpa mapper) — kontras:**
```
workspace_v2 = {"pendings":[],"draft_cart":[],...}        ← kosong, legacy TIDAK dimigrasikan
extractedEntities.pendingClarification = true              ← legacy tak disentuh v2
log: {"outcome":"reasoned","llmCalls":1}                  ← v2 blind → minta LLM ulang
```
→ Tanpa P3.2, v2 membaca `workspace_v2` kosong → pending lama tak terlihat →
`llmCalls:1`, "minta ulang dari nol". **Bug T3 (SEDANG) terjadi.**

### Kesimpulan
v2 kini migre legacy `extractedEntities` (confirmedItems→draft_cart,
pendingClarification→pendings) sekali ke `workspace_v2`, lalu memaksimalkan
`workspace_v2` sebagai sumber kebenaran. Pending lama bertahan & diselesaikan
deterministik (0 LLM) — `outcome: resolved, llmCalls: 0`.
