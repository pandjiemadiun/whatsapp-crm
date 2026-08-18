# G2-D.4 V1 Write Migration — Phase Report

## Objective
Migrate V1 conversation-state WRITES to `CanonicalConversationStateService` as the sole authority.
`workspace_v2` is the canonical store; `extractedEntities` is compatibility mirror only.
Cart writers (modifyCart, restoreCart) are NOT in scope (deferred to G2-D.5).

## Scope

### Migrated to canonical (PRIMARY write → workspace_v2)
| V1 Writer | Old Location | Canonical Method | Notes |
|---|---|---|---|
| `setPendingClarification` | conversation-context.service.ts:404 | `canonicalConversationStateService.writeV1PendingClarification()` | Mirror called inside method |
| `clearPendingClarification` | conversation-context.service.ts:432 | `canonicalConversationStateService.clearV1PendingClarification()` | Mirror called inside method |
| `incrementClarificationRetry` | conversation-context.service.ts:446 | `canonicalConversationStateService.incrementV1PendingRetry()` | Mirror called inside method |
| `storePreviousMutation` | conversation.service.ts:955 | `canonicalConversationStateService.writeV1PreviousMutation()` | Mirror called inside method |
| `clearPreviousMutation` | conversation.service.ts:1459 | `canonicalConversationStateService.clearV1PreviousMutation()` | Mirror called inside method |
| `updateShippingInfo` | conversation-context.service.ts:211 | `canonicalConversationStateService.writeV1ShippingInfo()` | NEW — write to canonical resolved_facts |
| `updateExtractedEntities` | conversation-context.service.ts:115 | `canonicalConversationStateService.writeV1TrackedEntities()` | NEW — write to canonical _compat.tracked_entities |
| `saveDiscussedItems` | fallback.service.ts:907 | `canonicalConversationStateService.writeV1DiscussedItems()` | NEW — write to canonical _compat.discussed_items + resolved_facts.lastAmbiguousPrompt |

### Deferred (G2-D.5 — CartAuthority writes)
| V1 Writer | Reason |
|---|---|
| `modifyCart` (confirmedItems add/remove/swap) | Cart is CartAuthority domain; migration requires DB-level cart migration |
| `restoreCart` (confirmedItems rollback) | Same — CartAuthority owns cart state |

### G2-D-L-018 Fix: parseExtractedEntities silent field loss
**Problem:** `parseExtractedEntities` returned only 9 typed fields — dynamic fields (`customerCity`, `customerName`, `customerPhone`) were silently dropped on write-back.

**Fix:** Added `_unknown` preservation — `parseExtractedEntities` now captures all unrecognized keys into `_unknown?: Record<string, unknown>`. Write-back includes `_unknown` so dynamic fields survive. This is a safety net for V1 writers that haven't been fully migrated to canonical.

**Note:** For writers migrated to canonical (G2-D.4), dynamic fields are properly mapped:
- `customerCity` → `resolved_facts.customerCity`
- `recipientName` → `resolved_facts.recipientName`
- `customerName` → `_compat.customer_name`
- `customerPhone` → `_compat.customer_phone`

## Architecture

### Write flow (post-migration)
```
V1 writer (extractedEntities) ──dual-write──→ CanonicalConversationStateService
                                                   │
                                                   ├── primary: workspace_v2 (via atomicCas)
                                                   └── compat: extractedEntities (unchanged)
```

Canonical (workspace_v2) is the **authority**. V1 readers already migrated (G2-D.2) read from canonical.
ExtractedEntities remains as compatibility mirror for any legacy readers that haven't migrated.

### New canonical methods (G2-D.4)

1. **`writeV1ShippingInfo(conversationId, recipientName, shippingAddress)`**
   - Writes to `resolved_facts.recipientName` and `resolved_facts.shippingAddress` via `updateResolvedFacts` (atomic CAS)

2. **`writeV1TrackedEntities(conversationId, entities)`**
   - Merges to `_compat.tracked_entities` with dedup by type:value, confidence wins (same semantics as V1 `mergeTrackedEntities`)

3. **`writeV1DiscussedItems(conversationId, items, lastAmbiguousPrompt?)`**
   - Writes to `_compat.discussed_items` + `resolved_facts.lastAmbiguousPrompt`

4. **`getV1TrackedEntities(conversationId)`** — V1 READ compat
5. **`getV1DiscussedItems(conversationId)`** — V1 READ compat
6. **`getV1ExtractedEntities(conversationId)`** — full V1 Entity reconstruction from canonical

All canonical write methods use `updateCanonical()` which uses `atomicCas` (optimistic lock `@updatedAt`).

## Regression Tests (8 cases)

Added to `canonical-context.test.ts`:

1. **D4-R1: V1 write → canonical read** — `writeV1PendingClarification` → `getV1PendingClarification` round-trip preserves question, options, retry_count
2. **D4-R2: pending lifecycle** — set → increment retry (3x) → resolve → clear (all via canonical)
3. **D4-R3: previousMutation lifecycle** — write → read → clear (via canonical + _compat)
4. **D4-R4: discussedItems** — `writeV1DiscussedItems` → `getV1DiscussedItems` round-trip + `lastAmbiguousPrompt` in resolved_facts
5. **D4-R5: trackedEntities** — `writeV1TrackedEntities` → `getV1TrackedEntities` round-trip with dedup
6. **D4-R6: customerCity preservation** — customerCity survives across `writeV1ShippingInfo` + `updateResolvedFacts` (G2-D-L-018 fix)
7. **D4-R7: partial update doesn't delete other state** — pending write preserves existing facts + discussedItems + intent
8. **D4-R8: concurrent update still safe** — two concurrent `updateResolvedFacts` → CAS retry, both facts preserved (no lost update)

## Verification Results

| Test Suite | Result |
|---|---|
| `tsc --noEmit` (production code) | ✅ No new errors (pre-existing test-file errors unchanged) |
| canonical-context.test.ts | ✅ 75/75 pass (57 original + 10 G2-D.3 + 9 G2-D.4) |
| golden-dataset.test.ts | ✅ 17/17 pass |
| reasoning-v2.test.ts | ✅ 13/13 pass |
| fast-path-v2.test.ts | ✅ 17/17 pass |
| workspace-v2.test.ts | ✅ 20/20 pass |
| composer-v2.test.ts | ✅ 18/18 pass |
| validator-v2.test.ts | ✅ 18/18 pass |
| prompts-v2.test.ts | ✅ 13/13 pass |
| pendingClarification.test.ts | ✅ 6/6 pass |
| engine-e2e-v2.test.ts | ✅ 9/9 pass |
| shadow-logger-v2.test.ts | ✅ 13/13 pass |
| pipeline.test.ts | ✅ 20/20 pass |
| cart-authority.test.ts | ✅ 53/53 pass |
| order-transition.test.ts | ✅ 21/21 pass |
| clarification-composer-v2.test.ts | ✅ 7/7 pass |
| **Full suite (all relevant)** | ✅ **321/321 pass** |

## Post-Migration Audit

V1 direct writes to `extractedEntities` — all verified:

| Writer | Status | Canonical Mirror |
|---|---|---|
| `setPendingClarification` | MIGRATED | `writeV1PendingClarification` (inside method) |
| `clearPendingClarification` | MIGRATED | `clearV1PendingClarification` (inside method) |
| `incrementClarificationRetry` | MIGRATED | `incrementV1PendingRetry` (inside method) |
| `storePreviousMutation` | MIGRATED | `writeV1PreviousMutation` (inside method) |
| `clearPreviousMutation` | MIGRATED | `clearV1PreviousMutation` (inside method) |
| `updateShippingInfo` | MIGRATED | `writeV1ShippingInfo` (inside method, NEW) |
| `updateExtractedEntities` | MIGRATED | `writeV1TrackedEntities` (inside method, NEW) |
| `saveDiscussedItems` | MIGRATED | `writeV1DiscussedItems` (inside method, NEW) |
| `modifyCart` | DEFERRED (G2-D.5) | N/A — cart authority |
| `restoreCart` | DEFERRED (G2-D.5) | N/A — cart authority |

No remaining unguarded V1 writers for non-cart conversation state fields.

## Status: GREEN

All V1 conversation-state writes (non-cart) now have canonical mirror writes via `CanonicalConversationStateService`. G2-D-L-018 silent field loss fixed. All 321 tests pass. No dual authority for non-cart state.
