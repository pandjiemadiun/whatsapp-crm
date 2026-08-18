# Laporan TASK P3.1 — Migration + persist WorkspaceV2 ke kolom baru (T1 fix)

**Tanggal:** 10 Agu 2026
**Scope:** Kolom baru `workspace_v2` (JSON, nullable) di `conversationContext`. TIDAK reuse kolom `extractedEntities`. Path v1/legacy `extractedEntities` tidak disentuh (scope T2/P3.3).

**Akar masalah (lihat laporan-taskP3-audit.md §4):** `saveWorkspace(workspace)`
dikonversi ke string lalu dikirim ke `updateExtractedEntities(conversationId, JSON.parse(...))`.
`updateExtractedEntities` mensyaratkan `ExtractedEntity[]` (guard `if (!entities.length) return`).
`WorkspaceV2` adalah objek — tidak punya `.length` → `entities.length === undefined` → `!undefined === true`
→ **selalu NO-OP.** WorkspaceV2 tidak pernah tersimpan; turn berikutnya `loadWorkspace`
membaca kolom `extractedEntities` yang kosong → `pendings:[]`, `draft_cart:[]`, dst. **Memori v2 antar-turn hilang total.**

## Perubahan (diff)

### 1. `prisma/schema.prisma`
```prisma
model ConversationContext {
  ...
  extractedEntities     Json?
  workspace_v2          Json?     // ← BARU (T1 fix P3.1)
  ...
}
```

### 2. Migrasi baru
`apps/api/prisma/migrations/20260810100618_add_workspace_v2/migration.sql`
```sql
ALTER TABLE "conversation_context" ADD COLUMN "workspace_v2" JSONB;
```
`npx prisma migrate deploy` → sukses:
```
Applying migration `20260810100618_add_workspace_v2`
All migrations have been successfully applied.
```
Kolom terbaca di DB:
```
 extractedEntities | jsonb  |           |          |
 workspace_v2      | jsonb  |           |          |
```

### 3. `src/business/conversation-context.service.ts`
- Import `WorkspaceV2` dari `types-v2.ts`.
- Method baru `updateWorkspaceV2(conversationId, workspace: WorkspaceV2)` → menulis ke kolom `workspace_v2` (bukan `extractedEntities`).

### 4. `src/business/conversation.service.ts`
- **Load (141→135):** `select: { workspace_v2: true }` + `loadWorkspace(JSON.stringify(ctxRow?.workspace_v2 || {}))`.
- **Persist `resolved` (233→232):** `conversationContextService.updateWorkspaceV2(conversationId, JSON.parse(resolvedWs))`.
- **Persist `reasoned` (317→317):** `conversationContextService.updateWorkspaceV2(conversationId, JSON.parse(updatedWorkspace))`.
- `updateExtractedEntities` (NO-OP) tidak lagi dipanggil di jalur v2. `workspace.ts` (loadWorkspace/saveWorkspace) tidak disentuh.

`git diff --stat` (hanya file terkait):
```
apps/api/prisma/schema.prisma                          |  11 +-
apps/api/prisma/migrations/20260810100618_add_workspace_v2/migration.sql |  4 +
apps/api/src/business/conversation-context.service.ts  |  29 +
apps/api/src/business/conversation.service.ts         |  33 +-
```

---

## ACCEPTANCE

1. `npx tsc --noEmit -p apps/api` → **0 error**
   ```
   TSC EXIT: 0
   ```

2. `npm run build` → **sukses**
   ```
   > garuda-api@0.0.1 build
   > tsc
   BUILD EXIT: 0
   ```

3. Prisma migration file dibuat + `npx prisma migrate deploy` → **sukses, output:**
   ```
   Applying migration `20260810100618_add_workspace_v2`
   The following migration(s) have been applied:
     migrations/20260810100618_add_workspace_v2/migration.sql
   All migrations have been successfully applied.
   ```

4. `npm run test:chat -- src/services/chat/__tests__` → **baseline tidak bertambah gagal**
   ```
   Test Suites: 2 failed, 19 passed, 21 total
   Tests:       1 failed, 187 passed, 188 total
   ```
   Baseline (sebelum fix): **2 failed suites / 1 failed test**. Setelah fix: sama (2 failed suites / 1 failed test).
   Suite yang gagal (pre-existing, tidak berkaitan P3.1): `reasoning-v2.test.ts` (1 test, outcome mismatch — tergantung LLM fixture non-determinatif) dan `engine-config-v2.test.ts` (suite gagal run karena `Cannot access 'redisAdapter' before initialization` — race import ESM). `workspace-v2.test.ts` lulus.

5. `git diff --stat` (source, ekskludi `dist/` & `logs/`) → **cuma file terkait**:
   `schema.prisma`, migration baru, `conversation-context.service.ts`, `conversation.service.ts` (`workspace.ts` s deliberately tidak disentuh).

6. `pm2 restart api` → **online, tidak crash loop**
   ```
   [PM2] [api](0) ✓
   │ 0 │ api │ ... │ online │ 0% │ 166.4mb │
   ```

7. **Test manual — curl webhook 2 turn ke store-f7140b5c (engine=v2)**
   - Store: `store-f7140b5c` (Depot Kinasih), engine `v2` (Redis `store:store-f7140b5c:engine`).
   - customer: `6282199911222` → conversationId `store-f7140b5c:6282199911222`.
   - Turn 1 via Fonnte webhook `POST /api/webhooks/fonnte?secret=[REDACTED]` body `{"sender":"6282199911222","name":"Test User","message":"halo","device":"6289658888008","id":...}`.
   - Seed pending klarifikasi (status `active`) ke kolom `workspace_v2` — mensimulasikan state "turn 1 minta klarifikasi" yang audit §6 catat sebagai *in-mem*.
   - Turn 2 via webhook: `message":"iya"` (afirmatif → v2 fast-path resolver, **0 LLM**).

### Readback mentah — BEFORE FIX (old NO-OP code)
Seed `active`, turn 2 `"iya"`:
```
BEFORE turn 2: {"pendings":[{"id":"pend_test","status":"active", ...}], ...}
AFTER  turn 2: {"pendings":[{"id":"pend_test","status":"active", ...}], ...}   ← TETAP active
```
→ Engine lama membaca `extractedEntities` (bukan `workspace_v2`) → tidak melihat pending → tidak resolve → persist lewat `updateExtractedEntities` **NO-OP** → `workspace_v2` tak pernah ditulis. **Bug T1: pending hilang/tidak bertahan.**

### Readback mentah — AFTER FIX (kode P3.1)
Seed `active`, turn 2 `"iya"`:
```
BEFORE turn 2: {"pendings":[{"id":"pend_test","status":"active", ...}], ...}
AFTER  turn 2: {"pendings":[{"id":"pend_test","status":"resolved", ...}], ...}  ← resolved & PERSISTED
```
→ `loadWorkspace` membaca `workspace_v2` → fast-path menemukan pending `active` → resolve via `tryMatchAffirmative("iya")` (0 LLM) → `saveWorkspace` → `updateWorkspaceV2` menuliskan kembali ke kolom `workspace_v2`. **Pending BERTEHAN antar-turn — bug T1 hilang.**

API log (after-fix turn 2):
```
{"conversationId":"store-f7140b5c:6282199911222","outcome":"resolved","llmCalls":0,"action":"EXECUTE", "message":"Engine v2 active"}
```
(`llmCalls:0` memastikan turn 2 ini 0-LLM / deterministik.)

---

## Catatan ruang lingkup (TIDAK dikerjakan di P3.1 — pindah ke P3.3/T2)
- Kolom `extractedEntities` (legacy ARRAY vs OBJECT tidak konsisten — audit §5 T2) tidak disentuh.
- Sinkronisasi legacy→v2 (`loadWorkspace` tidak memetakan `confirmedItems`→`draft_cart`) tidak dikerjakan (T3).
- Transaksi/optimistic lock pada read-modify-write (T4) tidak dikerjakan.
- Fallback tier yang menulis `extractedEntities` (T5) tidak disentuh.
