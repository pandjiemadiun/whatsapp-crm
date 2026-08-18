# G2-D.7 Legacy Cleanup — Phase Report

## Objective
Hapus legacy code yang terbukti sudah tidak diperlukan (dead code) setelah migrasi canonical state (G2-D.1–D.6). Pastikan seluruh compatibility yang masih diperlukan tetap berfungsi.

## Caller-Graph Audit

Setiap item dinilai melalui caller graph analysis — bukan hanya grep, tapi verifikasi bahwa setiap function/type tidak direferensi sama sekali (kecuali komentar).

### 1. `hasLegacyState` — REMOVED ✅
- **Location**: `services/chat/workspace.ts:264`
- **Caller graph**: 0 callers. Hanya referensi di komentar (`canonical-context.service.ts:839`).
- **Canonical replacement**: Legacy V1→V2 migration sekarang ditangani oleh `fromLegacyExtractedEntities()` di canonical-context.service.ts — bukan oleh `mapLegacyEntitiesToWorkspace` + `hasLegacyState` di workspace.ts.
- **Verification**: `grep -r hasLegacyState src/` → 0 production references, 0 test references.

### 2. `mapLegacyEntitiesToWorkspace` — REMOVED ✅
- **Location**: `services/chat/workspace.ts:320`
- **Caller graph**: 0 callers. Hanya referensi di komentar (`canonical-context.service.ts:839`).
- **Canonical replacement**: `fromLegacyExtractedEntities()` di canonical-context.service.ts:745 melakukan mapping V1→canonical.
- **Verification**: `grep -r mapLegacyEntitiesToWorkspace src/` → 0 production references, 0 test references.

### 3. `updateWorkspaceV2` — REMOVED ✅
- **Location**: `conversation-context.service.ts:152`
- **Caller graph**: 0 callers. Semua V2 writes sekarang lewat `CanonicalConversationStateService.saveWorkspaceV2()` (G2-D.5). Komentar di conversation.service.ts:247 mengacu pada nama lama.
- **Canonical replacement**: `CanonicalConversationStateService.saveWorkspaceV2()` — primary write. `CanonicalConversationStateService.updateV2Transient()` — V2 transient (draft_cart) adapter.
- **Verification**: `grep -r updateWorkspaceV2 src/` → 0 production callers, hanya komentar.

### 4. `saveWorkspace` — NOT REMOVED (P2 MEDIUM DEFERRED)
- **Location**: `services/chat/workspace.ts:48`
- **Caller graph**: Hanya di test files (`engine-e2e-v2.test.ts:330,561,572`, `workspace-v2.test.ts:86`).
- **Reason**: `saveWorkspace` adalah pure function untuk JSON serialization round-trip testing. Production code tidak memakai — `saveWorkspaceV2` (canonical service) adalah production equivalent. Namun test files bergantung pada `saveWorkspace` untuk memverifikasi format JSON `WorkspaceV2`.
- **Risk**: Menghapus akan memutuskan 5+ unit tests di `workspace-v2.test.ts` dan `engine-e2e-v2.test.ts` yang verifikasikan struktur WorkspaceV2.
- **Decision**: DEFERRED ke G2-D.8 (test modernization). `saveWorkspace` adalah utility test, bukan production code.

### 5. `getContext` direct `extractedEntities` read — NOT REMOVED (P2 MEDIUM DEFERRED)
- **Location**: `conversation-context.service.ts:67, 596` (`getContext` → `mapToContextData`)
- **Caller graph**: 5 production callers:
  1. `conversation.service.ts:100` — existence check (doesn't read extractedEntities fields)
  2. `conversation.service.ts:1183` — `getConversationWithContext` API serialization
  3. `conversation.service.ts:1276` — list conversations with context
  4. `order-context.integration.test.ts` — test assertions
- **Reason**: `getContext` adalah V1 public API yang mengembalikan `ConversationContextData` (dengan field `extractedEntities`). Digunakan oleh API routes untuk serialisasi response. Mengganti ke canonical berarti mengubah tipe `ConversationContextData` (breaking API change).
- **Decision**: DEFERRED ke G2-D.7.5 (V1 public API migration).

### 6. `parseExtractedEntities` — NOT REMOVED (LEGACY COMPAT)
- **Caller graph**: 15+ references di production code.
- **Reason**: Masih digunakan untuk:
  - Backward-compat mirror writes (G2-D.6: `storePreviousMutation`, `clearPreviousMutation` mirror writes)
  - Cart reads (`getCartFromDb`, `tryProductNotFound`, `tryTotal` — consistent with V1 cart writes)
  - `mapToContextData` (V1 public API `getContext`)
- **Decision**: PERTAHANkan sampai V1 cart writes migresi ke CartAuthority (G2-D.5) dan `getContext` migresi ke canonical (G2-D.7.5).

### 7. `atomicCas` (private) — PERTAHANkan
- **Caller graph**: 8 internal calls + 1 public wrapper (`atomicCasExtractedEntities`).
- **Reason**: Masih critical untuk backward-compat mirror writes (atomic CAS pada `extractedEntities`).
- **Decision**: PERTAHANkan.

## Unused Imports Cleaned

| File | Import Removed | Reason |
|---|---|---|
| `workspace.ts:15` | `import type { ExtractedEntities, PendingClarification } from '../../domain/types.js'` | Hanya dipakai oleh `hasLegacyState` dan `mapLegacyEntitiesToWorkspace` yang sudah dihapus |
| `conversation-context.service.ts:19` | `import type { WorkspaceV2 } from '../services/chat/types-v2.js'` | Hanya dipakai oleh `updateWorkspaceV2` yang sudah dihapus |

## Changes Made

### Files Modified

1. **`src/services/chat/workspace.ts`**
   - Removed: `hasLegacyState()` function (lines 257-269)
   - Removed: `clarificationOptionsToStrings()` helper (lines 271-289, only used by `mapLegacyEntitiesToWorkspace`)
   - Removed: `coerceQty()` helper (lines 291-301, only used by `mapLegacyEntitiesToWorkspace`)
   - Removed: `mapLegacyEntitiesToWorkspace()` function (lines 303-357)
   - Removed: unused imports `ExtractedEntities`, `PendingClarification`

2. **`src/business/conversation-context.service.ts`**
   - Removed: `updateWorkspaceV2()` method (lines 142-161)
   - Removed: unused import `WorkspaceV2`

3. **`src/business/conversation.service.ts`**
   - Updated comment reference to `updateWorkspaceV2` (line 247)

## Verification Results

| Check | Result |
|---|---|
| `tsc --noEmit` (production) | ✅ No new errors |
| canonical-context.test.ts | ✅ 92/92 pass (84 original + 8 D6) |
| golden-dataset.test.ts | ✅ 17/17 pass |
| reasoning-v2.test.ts | ✅ 13/13 pass |
| fast-path-v2.test.ts | ✅ 17/17 pass |
| workspace-v2.test.ts | ✅ 20/20 pass (saveWorkspace still works for test format) |
| composer-v2.test.ts | ✅ 18/18 pass |
| validator-v2.test.ts | ✅ 18/18 pass |
| prompts-v2.test.ts | ✅ 13/13 pass |
| pendingClarification.test.ts | ✅ 6/6 pass |
| engine-e2e-v2.test.ts | ✅ 9/9 pass (saveWorkspace still used in test round-trip) |
| shadow-logger-v2.test.ts | ✅ 13/13 pass |
| pipeline.test.ts | ✅ 20/20 pass |
| cart-authority.test.ts | ✅ 53/53 pass |
| order-transition.test.ts | ✅ 21/21 pass |
| clarification-composer-v2.test.ts | ✅ 7/7 pass |
| **Full suite** | ✅ **338/338 pass** |

## Post-Cleanup Direct Access Audit

### `extractedEntities` direct access (production, non-test)

| Access | Location | Reader Type | Status |
|---|---|---|---|
| `parseExtractedEntities(raw.extractedEntities)` in `mapToContextData` | conversation-context.ts:596 | LEGACY COMPAT (V1 API) | Preserved ✓ |
| `parseExtractedEntities(raw.extractedEntities)` in `getContext` | conversation-context.ts:75 | LEGACY COMPAT (cart check) | Preserved ✓ |
| `parseExtractedEntities(row.extractedEntities)` in `atomicCas` writers | conversation-context.ts:118,232,347,409,449,472,501 | LEGACY COMPAT (mirror writes) | Preserved ✓ |
| `parseExtractedEntities(ctxRow?.extractedEntities)` in `atomicCasExtractedEntities` | conversation.service.ts:967,1469 | LEGACY COMPAT (D6 mirror writes) | Preserved ✓ |
| SELECT `extractedEntities` for `confirmedItems` | conversation.service.ts:829,937; fallback.ts:386,646 | CART (deferred G2-D.5) | Preserved ✓ |
| SELECT `extractedEntities` for `discussedItems` | fallback.service.ts:934 | LEGACY COMPAT (backward-compat mirror) | Preserved ✓ |
| SELECT `extractedEntities` in cart-authority | cart-authority.ts:882,1097 | CART (backward-compat sync) | Preserved ✓ |

### `workspace_v2` direct writes (production)

| Writer | Location | Type | Status |
|---|---|---|---|
| `updateCanonical` | canonical-context.ts | Canonical (CAS) | Primary ✓ |
| `updateV2Transient` | canonical-context.ts | V2 transient adapter | Primary ✓ |
| `getCanonicalWithLegacyFallback` | canonical-context.ts | Read + legacy fallback | Read-only ✓ |

## Status: GREEN

All removed code was provenead dead (0 callers). All remaining compatibility code is either:
- Used by active V1 API (`getContext`)
- Used for backward-compat mirror writes (atomic CAS)
- Used for cart reads (consistent with V1 cart writes, deferred to G2-D.5)
- Used by tests (`saveWorkspace`)

Canonical boundary remains the single authority for conversation working state. V1 fallback still functions. V2 still functions. CartAuthority remains the sole cart authority.
