# G2-D Conversation State Architecture Review

**Task:** G2-D — CONVERSATION STATE REFACTOR
**Mode:** FORENSIC → ARCHITECTURE → CONTROLLED MIGRATION → VERIFICATION
**Date:** 2026-08-14
**Status:** DRAFT (Forensic complete — implementation pending architecture approval)

---

## 1. Executive Summary

The conversation engine maintains **two competing, independently-persisted working-state stores** in the same `conversation_context` database table:

- **`extractedEntities`** (JSON column) — written and read by the **V1 path** (`fallback.service.ts` + `conversationContextService`).
- **`workspace_v2`** (JSON column) — written and read by the **V2 path** (`interpreter.ts` → `reasoning.ts` → `composer-v2.ts`).

Both columns exist on the same `ConversationContext` row. A **one-time, one-way migration** (`mapLegacyEntitiesToWorkspace`) runs on first V2 access — after that, the two stores diverge permanently with **no reconciliation path**. This creates the core G2-D risk surfaces:

1. **Competing state writers** — V1 and V2 write different JSON columns; neither reads the other's mutations.
2. **Triple cart representation** — `workspace_v2.draft_cart` + `extractedEntities.confirmedItems` + `OrderItem` rows, where the first two are not atomically synced.
3. **Stale `workspace_v2` on V2→V1 fallback** — if the V2 engine partially persists `workspace_v2` then throws, the next turn loads stale `workspace_v2` state; V1 reads `extractedEntities` which never received V2 changes.
4. **Direct DB writes bypassing `atomicCas`** — three code paths write `conversationContext` without optimistic locking.
5. **Vestigial `lastMessages` column** — written by V1 `appendMessage` but never read as a source of truth (both paths load message history from `conversationHistory` table instead).

**V2 path is gated per-store** via `getStoreEngine(storeId)` (Redis/config), defaulting to `'v1'`. V1 and V2 can coexist on the same `ConversationContext` row for different stores.

---

## 2. Current State Map

### Database Schema (`prisma/schema.prisma`)

```
model ConversationContext (@@map "conversation_context")
  id              String   @id
  conversationId  String   @unique   → conversations.id
  lastMessages    Json               ← vestigial (see §12)
  extractedEntities Json?            ← V1 working state
  workspace_v2    Json?              ← V2 working state
  userIntent      String?            ← written by V1 only
  sessionKey      String @unique     ← SHA256, session auth
  sessionExpireAt DateTime           ← session TTL
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt ← optimistic lock clock
```

| State | Storage (DB Column / Table) | Writer(s) | Reader(s) | Lifetime | Authority |
|---|---|---|---|---|---|
| **extractedEntities** | `ConversationContext.extractedEntities` (JSON) | `conversationContextService` (atomicCas, 8 methods) + `fallbackService.saveDiscussedItems` (direct upsert) + `conversation.service.ts:storePreviousMutation` (direct update) + `cartAuthority.syncConfirmedItemsJson` (tx) | `conversationContextService.getContext` → `parseExtractedEntities` + `fallbackService.getResponse` + `conversation.service.ts` V1 path + PWA `fetchClarificationOptions` | Per-conversation, persistent | V1 engine primary; V2 reads only during one-time migration |
| **workspace_v2** | `ConversationContext.workspace_v2` (JSON) | `conversationContextService.updateWorkspaceV2` (atomicCas) + `conversation.service.ts` V2 path (3 call sites) | `conversation.service.ts` V2 path (`loadWorkspace`) | Per-conversation, persistent after first V2 turn | V2 engine primary |
| **lastMessages** | `ConversationContext.lastMessages` (JSON) | `conversationContextService.appendMessage` (atomicCas) — called only in V1 path | `conversationContextService.mapToContextData` (returns but no consumer reads) | Per-conversation, persistent | **VESTIGIAL** — message history served from `conversationHistory` table |
| **userIntent** | `ConversationContext.userIntent` (String) | `conversationContextService.setUserIntent` (atomicCas) | `conversationContextService.mapToContextData` | Per-conversation, persistent | V1 engine only |
| **sessionKey / sessionExpireAt** | `ConversationContext.sessionKey`, `.sessionExpireAt` | `conversationContextService.createSession` + `refreshSession` + `fallbackService.saveDiscussedItems` (upsert fallback) | `conversationContextService.getContext` | Per-conversation, 60-min TTL | Session auth — not conversation state |
| **confirmedItems** | Inside `extractedEntities.confirmedItems` (JSON) | `conversationContextService.modifyCart` (atomicCas) + `cartAuthority.syncConfirmedItemsJson` (tx) | `fallbackService.tryTotal` + `conversation.service.ts:buildPipelineContext` + PWA `fetchCart` (via `cartAuthority.getCartSummary`) | Per-conversation, persistent | **CartAuthority** (OrderItem rows); `confirmedItems` is backward-compat mirror |
| **pendingClarification** | Inside `extractedEntities.pendingClarification` (JSON) | `conversationContextService.setPendingClarification` + `clearPendingClarification` + `incrementClarificationRetry` (all atomicCas) + `fallbackService.saveDiscussedItems` (direct upsert) | `conversationContextService.getPendingClarification` + `conversation.service.ts` V1 path + PWA `fetchClarificationOptions` | Per-conversation, persistent until resolved/cleared | V1 engine |
| **pendings** (V2) | Inside `workspace_v2.pendings` (JSON array) | `workspace.ts` accessor functions (`parkPending`, `resolvePending` (v2), `dropPending`, `incrementAttempts`, `incrementDeferredTurns`) | `conversation.service.ts` V2 path (`workspace.pendings.find`) + `workspace.ts` accessors | In-memory during turn; persisted to `workspace_v2` at turn end | V2 engine |
| **draft_cart** (V2) | Inside `workspace_v2.draft_cart` (JSON array) | `workspace.ts` `addToDraft` + `confirmDraftItem` | `fast-path.ts:366` (read to context) + `conversation.service.ts` V2 path (cartAct extraction) | In-memory during turn; persisted to `workspace_v2` | V2 engine (intent; not authoritative) |
| **resolved_facts** | Inside `workspace_v2.resolved_facts` (JSON object) | `workspace.ts` `setFact` | V2 engine / fast-path | In-memory during turn; persisted to `workspace_v2` | V2 engine |
| **trackedEntities** | Inside `extractedEntities.trackedEntities` (JSON array) | `conversationContextService.trackEntities` (atomicCas) | `conversationContextService.mapToContextData` + integration tests | Per-conversation, persistent | V1 engine entity tracker |
| **previousMutation** | Inside `extractedEntities.previousMutation` (JSON) | `conversation.service.ts:storePreviousMutation` (direct update) + `conversation.service.ts:941-966` | `conversation.service.ts:425` (V1 pending resolution) | Per-conversation, cleared after use | V1 rollback mechanism |
| **lastAmbiguousPrompt** | Inside `extractedEntities.lastAmbiguousPrompt` (JSON string) | `fallbackService.saveDiscussedItems` (upsert) | `fallbackService.saveDiscussedItems` (read+write round-trip) | Per-conversation, persistent | V1 product disambiguation |
| **discussedItems** | Inside `extractedEntities.discussedItems` (JSON array) | `fallbackService.saveDiscussedItems` (upsert) | `fallbackService.detectNegation` (local read only) | Per-conversation, capped 10 entries | V1 product mention tracker |
| **conversationHistory** | `conversationHistory` table (separate table) | `conversation.service.ts:saveMessage` (create) | `getOrCreateContext` (10-message rolling window) + PWA `/history` endpoint + admin dashboard | Per-conversation, persistent, append-only | **Authoritative message history** |
| **Order.items + OrderItem rows** | `Order.items` (JSON) + `OrderItem` relation table | `CartAuthority` (addLine/removeLine/updateQuantity/clearCart/checkout/executeOps/restoreFromSnapshot) | PWA `fetchCart` (via `cartAuthority.getCartSummary`) + `fallbackService.tryTotal` + `order.service.ts` mapOrderWithItems | Per-conversation, draft orders only | **CartAuthority** (authoritative for cart) |

---

## 3. Current V1/V2 State Flow

### Decision Point

```
conversation.service.ts:110-111
  engine = getStoreEngine(storeId)  // Redis/config, default 'v1'
  if (engine === 'v2') { V2 path (lines 113-386) }
  else               { V1 path (lines 389-796) }
```

**V2 path** (lines 113-386):
```
Inbound message
  ↓
[110] getStoreEngine → 'v2'
  ↓
[139] findUnique: read workspace_v2 + extractedEntities
  ↓
[145] if workspace_v2 exists → loadWorkspace(JSON.stringify(workspace_v2))
  ↑  else → mapLegacyEntitiesToWorkspace(extractedEntities) → updateWorkspaceV2 (one-time migrate)
  ↓
[162] auto-drop deferred pendings (workspace.pendings, pure mutation, NO DB write yet)
  ↓
[190] understand(customerMessage, workspace, catalog, messages, fallbackService, storeId)
  ├─ fast-path (0-LLM): tier-based rules + resolvePending (workspace.pendings)
  └─ reasoning interpreter (LLM, 0-1 call per I8)
  ↓
[201] if outcome === 'tier' → composeReply → saveMessage → return
[221] if outcome === 'resolved' → resolvePending(ws, id) → executeCartOps → saveMessage → return
  ↓
[249] if outcome === 'reasoned' → executeCartOps(valid) → saveWorkspace (updateWorkspaceV2)
  ↓
[250] composeReply → buildResult → saveMessage (customer + assistant) → return
  ↓
[368-386] catch → log + fall through to V1 path (extractedEntities)
```

**State read at each stage:**

| Stage | State Read | State Written | Authoritative? |
|---|---|---|---|
| Context load | `workspace_v2` column (or `extractedEntities` for migration) | `workspace_v2` (migration persist) | V2: `workspace_v2` |
| Fast-path | `workspace.pendings`, `workspace.draft_cart`, `workspace.resolved_facts` (in-memory) | Workspace accessors mutate in-memory | V2: in-memory workspace |
| Reasoning | `workspace.*` (in-memory), `catalog` (DB), `messages` (conversationHistory) | None (read-only interpreter) | V2: in-memory workspace + DB catalog |
| Resolved | `workspace.pendings` (in-memory) | `resolvePending` mutates in-memory; `executeCartOps` writes OrderItem | V2: workspace (read) + OrderItem (cart write) |
| Reasoned | `workspace.*` (in-memory) | `saveWorkspace` → `workspace_v2` (DB) | V2: `workspace_v2` for workspace; OrderItem for cart |
| Message persist | — | `saveMessage` → `conversationHistory` (table) | `conversationHistory` (authoritative messages) |

**V1 path** (lines 389-796):
```
Inbound message
  ↓
[394] Extract customerCity from extractedEntities (direct read, NOT atomicCas)
  ↓
[418] findUnique: read extractedEntities
  ↓
[423] getPendingClarification(entities) — resolves from extractedEntities.pendingClarification
  ↓
[433] resolvePending({pending: {ops, snapshot, retryCount}}) — V1 resolver
  ├─ if ESCALATE → markHumanTakeover → return human takeover reply
  ├─ if EXECUTE → executeCartOps → renderCartSummary → return cart reply
  ├─ if ROLLBACK → restoreCart → return cancellation reply
  ┓ if RETRY → incrementClarificationRetry → return retry question
  ↓
[594] Normalizer (0-LLM): normalize(customerMessage, productDictionary)
  ↓
[602] buildPipelineContext: read extractedEntities (confirmedItems) + Order (draft)
  ↓
[617] fallbackService.getResponse(normalizedMsg, pipelineCtx) — tier-based fallback
  ├─ cache → FAQ → knowledge → catalog → product → productNotFound → SOP → orderStatus → total → shipping → payment
  └─ if no tier matches → return HUMAN (dead-end)
  ↓
[625-685] if no result + !llmCalledThisTurn → runOneCall (1 LLM call, I8)
  ├─ if clarification → setPendingClarification (atomicCas on extractedEntities)
  ├─ if reply_draft → buildResult
  ├─ if executedAdd → getCartFromDb → renderCartSummary
  ↓
[689] if !result → dead-end fallback (HUMAN)
  ↓
[759-777] saveMessage (conversationHistory) + appendMessage (lastMessages) + refreshSession
  ↓
[786] logPipelineAudit + return
```

**V1 vs V2 state divergence:**

| Concern | V1 reads | V2 reads | Divergence |
|---|---|---|---|
| Pending clarification | `extractedEntities.pendingClarification` | `workspace_v2.pendings` | **YES** — V1 resolver reads from extractedEntities; V2 resolver reads from workspace.pendings. If V2 sets a pending in workspace_v2.pendings, V1 cannot resolve it (and vice versa). |
| Cart state | `extractedEntities.confirmedItems` | `workspace_v2.draft_cart` (intent only) + `OrderItem` rows (authoritative via CartAuthority) | **YES** — V2's draft_cart is a pre-execution intent list; V1 reads confirmedItems. They are not synced. |
| customerCity | `extractedEntities.customerCity` (direct raw read) | NOT read (always `null` at line 241) | **YES** — V2 never populates or reads customerCity. Lost on V1→V2 transition. |
| trackedEntities | `extractedEntities.trackedEntities` | NOT present in workspace_v2 | **YES** — V2 has no trackedEntities equivalent. |
| userIntent | `extractedEntities.userIntent` column | NOT written/read | **YES** — V2 does not set userIntent. |
| lastMessages | `extractedEntities` column — NOT read (V1 loads from conversationHistory table) | NOT read | **YES** — lastMessages column is vestigial (see §12). |
| sessionKey/sessionExpireAt | `ConversationContext` columns | V2 does NOT check/refresh session | **YES** — V1 path calls `refreshSession`; V2 path does not. |

---

## 4. extractedEntities Audit

`extractedEntities` is a JSON column on `ConversationContext`. Shape defined by `domain/types.ts:257-269`:

```typescript
interface ExtractedEntities {
  discussedItems: DiscussedItem[];
  confirmedItems: ConfirmedItem[];
  lastAmbiguousPrompt: string | null;
  recipientName?: string | null;       // delivery
  shippingAddress?: string | null;     // delivery
  pendingClarification?: PendingClarification | null;
  previousMutation?: { cartSnapshot: ConfirmedItem[]; message: string } | null;
  trackedEntities?: ExtractedEntity[];
  // dynamic fields (not in typed interface):
  customerCity?: string;              // read at conversation.service.ts:401
  customerName?: string;              // read at conversation.service.ts:560
  customerPhone?: string;             // read at conversation.service.ts:953
}
```

| Field | Writer | Reader | KEEP / MIGRATE / COMPAT / REMOVE | Decision |
|---|---|---|---|---|
| `discussedItems` | `fallbackService.saveDiscussedItems` (upsert, line 950-968) | `fallbackService.detectNegation` (local read) | **REMOVE LATER** | V1-only product mention tracker. V2 has no equivalent (uses workspace.options_presented). No PWA reader. Zero V2 readers. |
| `confirmedItems` | `conversationContextService.modifyCart` (atomicCas, dead code per G2-C-L-021) + `cartAuthority.syncConfirmedItemsJson` (backward-compat sync) | `fallbackService.tryTotal` (644), `fallbackService.tryProductNotFound` (386), `conversation.service.ts:buildPipelineContext` (836), PWA `fetchCart` (via CartAuthority — does NOT read this field) | **READ-ONLY COMPAT** | CartAuthority now writes OrderItem rows (authoritative). `confirmedItems` JSON is kept in sync ONLY for backward compatibility with `fallbackService.tryTotal` and V1 `buildPipelineContext`. Readers should migrate to CartAuthority. |
| `lastAmbiguousPrompt` | `fallbackService.saveDiscussedItems` (947, 956) | Same method (read round-trip) | **REMOVE LATER** | V1-only product disambiguation prompt. No V2 equivalent. No external readers besides self-round-trip. |
| `recipientName` | `conversationContextService.setDeliveryInfo` (atomicCas, line 350ish) | Same method (read on update) | **MIGRATE** | Maps to `workspace_v2.resolved_facts.recipientName` (workspace.ts:345). Migration done during `mapLegacyEntitiesToWorkspace`. |
| `shippingAddress` | `conversationContextService.setDeliveryInfo` (atomicCas) | Same method (read on update) | **MIGRATE** | Maps to `workspace_v2.resolved_facts.shippingAddress` (workspace.ts:346). Migration done. |
| `pendingClarification` | `conversationContextService.setPendingClarification/clearPendingClarification/incrementClarificationRetry` (atomicCas) + `fallbackService.saveDiscussedItems` (967 — sets on create) | `conversationContextService.getPendingClarification` + `conversation.service.ts:423` (V1 resolver) + PWA `fetchClarificationOptions` (structured-message.mapper.ts:205) | **READ-ONLY COMPAT** | V2 maps to `workspace_v2.pendings` (PendingV2[]). V1 readers should migrate to workspace_v2. PWA reader (fetchClarificationOptions) reads from extractedEntities — **this is a V1/V2 reader mismatch**: if V2 is engine, pendingClarification in extractedEntities is stale/never-set. |
| `previousMutation` | `conversation.service.ts:storePreviousMutation` (direct update, line 954) + cleared by `clearPreviousMutation` (direct update, line 1445) | `conversation.service.ts:425` (V1 resolver reads cartSnapshot for rollback) | **REMOVE LATER** | V1-only rollback mechanism. V2 has no equivalent (uses workspace.pendings + resolvePending result). No V2 readers. |
| `trackedEntities` | `conversationContextService.trackEntities` (atomicCas, line 543-558) | `conversationContextService.mapToContextData` + integration tests | **REMOVE LATER** | V1-only entity tracker. V2 does not populate or read trackedEntities. No PWA readers. |
| `customerCity` | **NEVER EXPLICITLY WRITTEN** — appears to be set dynamically by LLM interpreter or legacy code | `conversation.service.ts:401` (V1 direct read) + `fallbackService.tryTotal` (117, via pipelineCtx) + `fallbackService.tryShipping` (474, via pipelineCtx) | **MIGRATE** → `resolved_facts.customerCity` | V1-only. NOT migrated by `mapLegacyEntitiesToWorkspace`. V2 path always passes `customerCity: null`. |
| `userIntent` | `conversationContextService.setUserIntent` (atomicCas, line 156-159) | `conversationContextService.mapToContextData` | **DEPRECATED** | V1-only. V2 tracks intent via reasoning acts, not this field. |

**Migration path audit:**
- `mapLegacyEntitiesToWorkspace` (workspace.ts:320-356) migrates: `confirmedItems` → `draft_cart`, `pendingClarification` → `pendings`, `recipientName`/`shippingAddress`/`lastAmbiguousPrompt` → `resolved_facts`.
- **NOT migrated:** `discussedItems`, `previousMutation`, `trackedEntities`, `customerCity`, `customerName`, `customerPhone`, `lastAmbiguousPrompt` (only if no pending/clarification).
- Migration runs **ONCE** (when `workspace_v2` is null/empty). After that, the two stores are fully independent.

---

## 5. workspace_v2 Audit

`workspace_v2` is a JSON column on `ConversationContext`. Shape defined by `services/chat/types-v2.ts:67-79`:

```typescript
interface WorkspaceV2 {
  schema_version: string;                    // always '' (empty string — loadWorkspace line 350)
  conversation_summary: string;             // conversation summary text
  pendings: PendingV2[];                    // clarification cycle pendings
  draft_cart: DraftCartOp[];                // pre-execution cart intent
  resolved_facts: Record<string, unknown>;  // recipientName, shippingAddress, etc.
  last_bot_message_type?: string;           // optional
  options_presented: string[][];            // history of option sets per turn
}
```

| Field | Writer | Reader | Transient/Persistent | Authority |
|---|---|---|---|---|
| `schema_version` | `loadWorkspace` (default `''`) | `loadWorkspace` only | Persistent (always empty string — **dead value**) | N/A |
| `conversation_summary` | `workspace.ts:setSummary` (setter) | `workspace.ts:getSummary` | Persistent | V2 conversation memory |
| `pendings` | `workspace.ts` accessors (parkPending, resolvePending v2, dropPending, incrementAttempts, incrementDeferredTurns) | `conversation.service.ts` V2 path (223, 226, 228) + `workspace.ts:getPendings` | Persistent (persisted via `updateWorkspaceV2` at turn end) | V2 engine (primary for V2 clarification) |
| `draft_cart` | `workspace.ts:addToDraft`, `confirmDraftItem` | `fast-path.ts:366` (read to ctx) + `conversation.service.ts` V2 path (303-333, 254-265) | Persistent (persisted via `updateWorkspaceV2` at turn end) | V2 engine — **transient intent only, NOT authoritative cart** (actual cart via CartAuthority) |
| `resolved_facts` | `workspace.ts:setFact` + `mapLegacyEntitiesToWorkspace` (migration) | `fast-path.ts` (read to ctx) | Persistent | V2 engine (resolved facts: recipientName, shippingAddress, etc.) |
| `options_presented` | `workspace.ts:setLastBotMessage` (pushes options) | `workspace.ts:saveWorkspace` (serialize only) | Persistent | V2 engine (turn history, for context) |
| `last_bot_message_type` | `workspace.ts:setLastBotMessage` | `workspace.ts:loadWorkspace` (optional read) | Persistent | V2 engine (bookkeeping) |

**Key finding:** `workspace_v2` is **persistent** — it's saved to the DB `workspace_v2` column at the end of every V2 turn (lines 251, 339). It is NOT a transient in-memory structure; it survives across turns. This means `workspace_v2` IS a persistence authority for V2 state, competing directly with `extractedEntities` as V1 persistence authority.

**Stale state risk:** `schema_version` is always set to `''` (empty string) — it is a dead field that never carries a real version. `updateWorkspaceV2` uses `atomicCas` which reads `updatedAt` for optimistic locking, BUT the writer in `updateWorkspaceV2` (conversation-context.service.ts:141-145) reads `extractedEntities` as the CAS row — the CAS protects against concurrent writes to the row via `updatedAt`, but V2 writers don't read V2 state fields, only `updatedAt`.

---

## 6. Canonical State Proposal

### Target Conceptual Model

```
Conversation
  ↓
ConversationContext (orchestrator / runtime only)
  ↓
CanonicalWorkingState
  ├── customer/context       → Customer identity (DB: Customer), store identity (DB: Store)
  ├── conversation memory    → conversationHistory table (authoritative) + workspace.conversation_summary
  ├── pending clarification  → workspace_v2.pendings (canonical for V2)
  ├── intent                 → reasoning acts (transient, derived each turn)
  ├── entities               → workspace_v2.resolved_facts + catalog lookup (transient)
  ├── commerce references    → CartAuthority (OrderItem rows) — NOT in workspace
  └── workflow metadata      → workspace_v2.options_presented, last_bot_message_type
```

### Canonical Working State (single JSON column proposal)

Replace the dual `extractedEntities` + `workspace_v2` columns with a **single canonical column** — either:
1. **Rename `workspace_v2` → `conversation_state`** and make it the sole authority, OR
2. **Keep the column name `workspace_v2`** and migrate all V1 fields into it.

The canonical state schema (proposed):

```typescript
// Canonical Conversation Working State (single source of truth)
interface CanonicalConversationState {
  version: string;                          // real schema version (e.g., "3.2.0")
  
  // --- Conversation memory ---
  conversation_summary: string;             // rolling summary (V2)
  options_presented: string[][];            // turn history of option sets
  last_bot_message_type?: string;
  
  // --- Pending clarification ---
  pendings: PendingV2[];                    // V2 PendingV2[] (canonical clarification state)
  
  // --- Resolved facts (customer context, delivery info) ---
  resolved_facts: Record<string, unknown>; // recipientName, shippingAddress, customerCity, etc.
  
  // --- Cart is NOT stored here ---
  // Cart authority: OrderItem relation rows (via CartAuthority)
  // Only a reference for compatibility:
  // cart_ref: { order_id: string | null }  // points to draft Order
}
```

**Key design rules:**
- **Cart is NOT stored in conversation state.** CartAuthority owns cart. ConversationState only stores a reference.
- **Clarification is V2-native** (`pendings: PendingV2[]`). V1 `pendingClarification` is removed.
- **Messages** are stored in `conversationHistory` table (already authoritative). `lastMessages` column is dropped.
- **`resolved_facts`** absorbs V1's dynamic fields (`customerCity`, `customerName`, `customerPhone`, `recipientName`, `shippingAddress`, `lastAmbiguousPrompt`).
- **`discussedItems`, `trackedEntities`, `previousMutation`, `lastAmbiguousPrompt`** are V1-only fields that do NOT survive into canonical state (they are either dead, redundant, or have V2 equivalents).

---

## 7. Persistence Boundary

### Current (dual-authority) state:

```
                        ┌─────────────────────────────────────────┐
                        │       ConversationContext (table)       │
                        │   - extractedEntities (JSON)  [V1]      │
                        │   - workspace_v2 (JSON)    [V2]        │
                        │   - lastMessages (JSON)   [VESTIGIAL]  │
                        │   - userIntent (String)   [V1]         │
                        │   - sessionKey/SessExpire [SESSION]    │
                        └────────────────┬──────────┬────────────┘
           Conversation                   │          │
           (table)                        │          │
           - status, channel              │          │
           - customerName/Phone           │          │
           - aiResponseCount              │          │
                                        │          │
           conversationHistory         │          │
           (table) ───────────────────┐  │          │
           - role, content            │  │          │
           - source, metadata         │  │          │
           - messageType, costUSD     │  │          │
                                     │  │          │
     Order (table)                   │  │          │
     - items (JSON)                  │  │          │
     - orderStatus, totalPrice       │  │          │
                                         │          │
     OrderItem (table) ──────────────────┘          │
     - productId, productName                       │
     - quantity, unitPrice                          │
     - subtotal                                     │
                                                    │
     Customer / Store (tables)              SessionAuth (separate)
```

### Target (single-authority) state:

```
                        ┌─────────────────────────────────────────┐
                        │       ConversationContext (table)       │
                        │   - conversation_state (JSON) [CANONICAL] │
                        │   - sessionKey / sessionExpireAt [SESSION]│
                        └────────────────┬──────────┬────────────┘
           Conversation                   │          │
           (table)                        │          │
           - status, channel              │          │
           - customerName/Phone           │          │
                                         │          │
           conversationHistory           │          │
           (table) ──────────────────────┘
           (authoritative message history)

     Order (table)
     - items (JSON)         ← synced by CartAuthority
     - orderStatus, totalPrice

     OrderItem (table)
     (authoritative cart state — CartAuthority sole writer)
```

### PipelineContext (runtime DTO — NOT persistence authority)

```
PipelineContext (domain/types.ts:350-362)
  - Built once per turn from DB reads
  - NOT persisted
  - Carries: messages, customerCity, customerName, cart, activeOrder,
    pendingClarification, storeProducts, llmCalledThisTurn
  - Rule: RUNTIME DTO ≠ PERSISTENCE AUTHORITY
```

**Problem:** `PipelineContext.pendingClarification` is populated from `extractedEntities.pendingClarification` (V1), but when V2 is the engine, the clarification state is in `workspace_v2.pendings` — which is NOT loaded into PipelineContext. This means the V2 path's `understand()` function receives a PipelineContext with stale/null pendingClarification.

**Problem:** `PipelineContext.cart` is populated from `extractedEntities.confirmedItems` (V1 read), but V2 writes cart state to `workspace_v2.draft_cart` + OrderItem rows. The PipelineContext.cart is only used by the V1 path (fallbackService.getResponse).

---

## 8. Cart Boundary

### Current state — Three competing representations:

| Representation | Location | Authority | Writers | Readers |
|---|---|---|---|---|
| `OrderItem` relation rows | `orderItem` table | **CartAuthority** (sole) | `cartAuthority.addLine/removeLine/updateQuantity/clearCart/checkout/executeOps/restoreFromSnapshot/migrateConfirmedItems` | `cartAuthority.getCartSummary` (PWA fetchCart), `cartAuthority.getCartFromDb`, `order.service.ts:mapOrderWithItems` |
| `Order.items` JSON | `Order.items` column | CartAuthority (sync) | `cartAuthority` (syncConfirmedItemsJson + checkout) + `order.service.ts` (createOrder) | `fallbackService.tryTotal` (reads raw Order.items JSON), `routes/orders.ts` GET (raw) |
| `extractedEntities.confirmedItems` | `ConversationContext.extractedEntities` JSON | **Legacy** — kept in sync backward-compat | `cartAuthority.syncConfirmedItemsJson` + `conversationContextService.modifyCart` (DEAD — G2-C-L-021) | `fallbackService.tryTotal` (644), `fallbackService.tryProductNotFound` (386), `conversation.service.ts:buildPipelineContext` (836) |
| `workspace_v2.draft_cart` | `ConversationContext.workspace_v2` JSON | V2 engine (intent only) | `workspace.ts:addToDraft` + `confirmDraftItem` | `fast-path.ts:366`, `conversation.service.ts` V2 path |

### G2-C CartAuthority status:

CartAuthority (G2-C) is implemented and verified:
- Sole writer to `OrderItem` relation rows
- All mutations atomic via `prisma.$transaction`
- Price always read from `Product.price` (DB)
- `confirmedItems` JSON kept in sync backward-compat via `syncConfirmedItemsJson`
- `modifyCart` is a backward-compat wrapper (zero callers per G2-C-L-021 audit)

### V2 cart flow (post-G2-C):

```
V2: LLM intents → workspace.draft_cart (intent, unverified)
  → deriveResolvedCartOps → executeCartOps
  → CartAuthority.executeOps → OrderItem rows + Order.items JSON + confirmedItems JSON
  → saveWorkspace → workspace_v2 (persist draft_cart for next turn context)
```

### Problem — V2 does NOT sync draft_cart with OrderItem:

The V2 path persists `workspace_v2.draft_cart` (LLM intent list) at turn end. The actual cart state is in `OrderItem` rows (via CartAuthority). If V2 writes to `workspace_v2` then falls back to V1, V1 reads `confirmedItems` (synced from OrderItem by CartAuthority) — which may or may not reflect the V2 draft_cart. The draft_cart and OrderItem can diverge because draft_cart is intent (pre-execution) while OrderItem is executed.

### G2-D requirement — Cart boundary:

```
CartAuthority = cart authority.
ConversationState only stores:
  - reference (cart_ref → draft Order ID)
  - intent/context
  - pending workflow
  - information necessary for conversation

NO: conversation state mutation + cart mutation → two sources of truth.
```

**Current violation:** `workspace_v2.draft_cart` stores cart intent in ConversationState. While this is "intent" not "executed cart", it IS a cart representation in conversation state. The canonical model should store only a `cart_ref` pointing to the draft Order, letting CartAuthority be the sole authority.

---

## 9. Customer Context Boundary

### Current ownership:

| Domain | Identity | Storage | Authority |
|---|---|---|---|
| Customer identity | `customerId` / `webUid` / `phone` | `Customer` table | Customer table (DB) |
| Store identity | `storeId` / `slug` | `Store` table | Store table (DB) |
| Conversation identity | `conversationId` | `Conversation` table | Conversation table (DB) |
| Channel | `whatsapp` / `web` | `Conversation.channel` | Conversation table (DB) |
| Session | `sessionKey` / `sessionExpireAt` | `ConversationContext` columns | `conversationContextService` |
| Handoff state | `status` / `humanTakeoverAt` | `Conversation.status` / `humanTakeoverAt` | `conversation.service.ts` + `messageProcessorService` |

### Issues found:

1. **customerCity is stored in `extractedEntities.customerCity`** (V1-only dynamic JSON field), NOT in a structured column. V2 doesn't read or migrate it. The `Conversation` table has `customerName` and `customerPhone` as structured columns but NO `customerCity`.

2. **customerName/customerPhone** exist as structured columns on `Conversation` table (lines 144-145 of schema) AND as JSON fields inside `extractedEntities`. V2's `buildPipelineContext` reads `conversation.customerName` from the Conversation table (line 608), while V1 path reads `entities.customerName` from extractedEntities JSON (via pipelineCtx). This is a **dual representation** of customer identity.

3. **Handoff state** (`human_takeover`, `humanTakeoverAt`) is managed through `Conversation.status` column + `Conversation.metadata` JSON. Admin dashboard filters on `status` and `humanTakeoverAt != null` (admin/stores.ts:547). V2 path does NOT set handoff state on V2 failure — it falls through to V1 which may or may not handle it.

4. **Session auth** (`sessionKey`/`sessionExpireAt`) is in `ConversationContext`. V2 path does NOT call `refreshSession` — only V1 path does (line 778). This means V2 conversations don't refresh session expiry, potentially causing session timeouts.

---

## 10. Clarification State

### V1 clarification state (extractedEntities.pendingClarification):

```typescript
// domain/types.ts:294-305
interface PendingClarification {
  id?: string;
  type?: string;
  question: string;
  options: ClarificationOption[];
  expected_type: 'affirmative' | 'choice' | 'yes_no';
  snapshot?: object;
  asked_at: string;
  retry_count: number;
  rawOptions?: string[];      // legacy backward compat
  rawExpectedType?: 'yes_no' | 'choice_multi';
}
```

- **Writer:** `conversationContextService.setPendingClarification` (atomicCas, line 357-378)
- **Reader:** `conversationContextService.getPendingClarification` (pure function, line 381-383) + `conversation.service.ts:423` (V1 resolver)
- **Lifecycle:** Set before asking question → cleared after resolution (EXECUTE/ROLLBACK) or incremented on retry → ESCALATE when retry_count > 1
- **Resolution:** `resolvePending` (pendingClarification.ts:67) — pure, 0-LLM, keyword-guard based

### V2 clarification state (workspace_v2.pendings):

```typescript
// types-v2.ts:55-65
interface PendingV2 {
  id: string;
  question: string;
  options: string[];
  status: 'active' | 'deferred' | 'resolved' | 'dropped';
  attempts: number;
  deferred_turns: number;
  asked_at: string;
}
```

- **Writer:** `workspace.ts` accessors — `parkPending`, `resolvePending` (v2), `dropPending`, `incrementAttempts`, `incrementDeferredTurns`, `resumePending`
- **Reader:** `conversation.service.ts` V2 path — `workspace.pendings.find(p => p.id === payload.pendingId)` (line 223)
- **Lifecycle:** Created by interpreter clarification → status cycles: active → resolved/dropped; deferred → auto-increment deferred_turns → auto-drop at `DEFERRED_AUTO_DROP_TURNS`
- **Resolution:** `resolvePending` (pendingClarification.ts:67) — pure, 0-LLM, keyword-guard based

### Clarification continuity audit (G2-D Part K requirements):

| Scenario | V1 behavior | V2 behavior | Risk |
|---|---|---|---|
| **Question → Answer** | `pendingClarification` set → `resolvePending` resolves → clears + executes | `pendings[].status = resolved` → executes | Both work independently |
| **Unrelated message after question** | `resolvePending` returns `NOT_PENDING_ANSWER` → falls through to normal pipeline | `workspace.pendings` checked — if not answered, question is re-asked or pending stays active | V2: pending may persist indefinitely if `deferred_turns` never incremented |
| **Clarification timeout** | `incrementClarificationRetry` → ESCALATE if retry_count > 1 | `incrementDeferredTurns` + `shouldAutoDrop` (DEFERRED_AUTO_DROP_TURNS threshold) | Different escalation semantics — V1 escalates after 2 retries; V2 auto-drops after DEFERRED_AUTO_DROP_TURNS deferred turns |
| **Repeated clarification** | `incrementClarificationRetry` → retry_question variant (attempt 2: reframed, attempt 3: fallback hand-off) | `attempts` tracked, but V2 doesn't have graduated response variant logic | V2 missing graduated response logic (G2-D Part K requires this) |
| **Concurrent turn** | Per-chat mutex (`acquireLock`) prevents concurrency; `atomicCas` on `updatedAt` | Same mutex; V2's `updateWorkspaceV2` also uses `atomicCas` | Both protected by same lock, but V1 fallback path's direct updates bypass CAS (see §12) |

**Key risk — V1/V2 clarification mismatch:**
If a V2 turn sets `workspace_v2.pendings` with a question, then the next turn falls back to V1 (engine reverts or V2 throws), V1 reads `extractedEntities.pendingClarification` — which is **empty** (V2 only writes to workspace_v2, not extractedEntities). The clarification context is **lost**. The customer's answer ("yang 2 liter") would be processed as a fresh message, not as clarification resolution.

Conversely, if V1 sets `extractedEntities.pendingClarification` then the engine switches to V2, V2 reads `workspace_v2.pendings` — which is **empty** (V1 only writes to extractedEntities). Same context loss.

**Test coverage for clarification:**
- `services/chat/__tests__/pendingClarification.test.ts` — tests `resolvePending` (V2 resolver)
- `services/chat/__tests__/workspace-v2.test.ts` — tests `resolvePending` on workspace
- `business/tests/order-context.integration.test.ts` — tests V1 clarification cycle
- `tests/golden-dataset.test.ts` — Case P3 tests workspace_v2 persist (not clarification continuity)

---

## 11. Concurrency

### Current concurrency model:

1. **Per-chat mutex** (`messageQueueService.acquireLock`):
   - Implemented in `message-processor.service.ts:161-165`
   - Also in `conversation-delivery.service.ts:79` (web path)
   - Prevents concurrent processing of the same `conversationId`
   - Single owner per chat — good.

2. **Optimistic locking via `atomicCas`** (`conversation-context.service.ts:468-514`):
   - Reads `extractedEntities` + `updatedAt` → writer callback → `updateMany({ where: { conversationId, updatedAt } })`
   - If `count === 0` (another writer committed → `updatedAt` bumped) → retry with backoff (max `ATOMIC_MAX_ATTEMPTS`)
   - **Only protects writes through `atomicCas`** — direct writes bypass this

3. **Direct (non-atomicCas) writes — concurrency hazard:**
   - `fallback.service.ts:950` — `prisma.conversationContext.upsert()` in `saveDiscussedItems`
   - `conversation.service.ts:954` — `client.conversationContext.update()` in `storePreviousMutation`
   - `conversation.service.ts:1445` — `prisma.conversationContext.update()` in `clearPreviousMutation`
   - `conversation.service.ts:396` — `findUnique` (read) in V1 customerCity extraction — reads without CAS, could be stale

4. **`updateWorkspaceV2` uses atomicCas BUT:**
   - It reads `extractedEntities` + `updatedAt` (not `workspace_v2`)
   - The writer writes `workspace_v2` field
   - CAS protection works via `updatedAt` bump (any concurrent write to the row bumps updatedAt)
   - BUT: if V1 writes to `extractedEntities` (bumping updatedAt) between V2's read and write, V2's CAS will retry — even though they write different fields. This causes unnecessary retries but prevents lost updates. ✓

5. **`clearPreviousMutation` (line 1438-1452) — NO CAS:**
   - Reads `extractedEntities` → spreads → writes `{ ...entities, previousMutation: null }`
   - This is a read-modify-write WITHOUT optimistic locking
   - If another writer commits between read and write, this overwrites their changes (last-write-wins on extractedEntities)
   - **BUG: lost update risk** — a concurrent `modifyCart` or `setPendingClarification` could be silently overwritten

### Two-turn concurrency (G2-D Part J):

```
Customer message A → mutex acquired → V2 path → workspace_v2 saved → mutex released
Customer message B → mutex acquired → loads workspace_v2 (includes A's state) → ✓
```

Under the per-chat mutex, two turns CANNOT overlap. The risk is within a single turn where multiple DB writes happen without a transaction.

**V2 path transaction boundaries:**
- Lines 249-251: `saveWorkspace` (updateWorkspaceV2) — NOT in a transaction with `saveMessage` (line 213-214)
- Lines 336-339: `updateWorkspaceV2` — NOT in a transaction with `saveMessage` (line 363-364)
- **Risk:** If `updateWorkspaceV2` succeeds but `saveMessage` fails, workspace_v2 persists but message history doesn't → state inconsistency
- Conversely: if `saveMessage` succeeds but `updateWorkspaceV2` fails, message history persists but workspace state doesn't → context loss on next turn

**V1 path transaction boundaries:**
- `executeCartOps` wraps cart mutation in `prisma.$transaction` (line 902)
- `saveMessage` (line 759-766) is NOT in a transaction with `appendMessage` (line 770-777) or `refreshSession` (line 778)
- Same split-write risk between conversationHistory, lastMessages, and session refresh

### No optimistic/concurrency protection on:
- `lastMessages` column (only atomicCas-protected via appendMessage)
- `sessionKey`/`sessionExpireAt` (only atomicCas-protected via refreshSession)
- `userIntent` column (only atomicCas-protected via setUserIntent)

### Conclusion on concurrency:

The per-chat mutex is the primary defense. Within a turn, the `atomicCas` pattern provides per-field optimistic locking for `extractedEntities` mutations. However, three V1 code paths bypass CAS entirely, creating lost-update risks. The V2 path has no per-turn transaction wrapping `workspace_v2` persistence + `conversationHistory` persistence, creating atomicity gaps.

**No invariant tests for concurrency** exist in the test suite (verified: no concurrent-turn test for workspace_v2 or extractedEntities state).

---

## 12. Silent No-op Findings

| # | Code Location | Behavior | Expected? / Bug? / Compat? / Security? | Verdict |
|---|---|---|---|---|
| 1 | `conversation-context.service.ts:483-488` (atomicCas read fail) | Returns `null` on context read failure, logs error | Bug risk | **BUG** — silently returns null on read failure; callers may not check for null |
| 2 | `conversation-context.service.ts:494-496` (atomicCas write fail) | Returns `null` on write failure | Bug risk | **BUG** — write failure silently swallowed, returns null |
| 3 | `conversation-context.service.ts:512-513` (CAS exhausted) | Returns `null` after max retries | Bug risk | **BUG** — 5 retries exhausted = silent data loss |
| 4 | `fallback.service.ts:197-200` (tryFAQ catch) | Returns `null`, logs warn | Compat | **COMPAT** — expected fallback behavior, logged |
| 5 | `fallback.service.ts:220-223` (tryKnowledge catch) | Returns `null`, logs warn | Compat | **COMPAT** — expected fallback behavior, logged |
| 6 | `fallback.service.ts:263-266` (tryCatalog catch) | Returns `null`, logs warn | Compat | **COMPAT** |
| 7 | `fallback.service.ts:291-296, 357-360` (tryProduct catch) | Returns `null`, logs | Compat | **COMPAT** |
| 8 | `fallback.service.ts:388` (tryProductNotFound DB read catch) | `catch {}` — **swallows exception silently, no logging** | **BUG** | **BUG** — empty catch block, no logging at all |
| 9 | `fallback.service.ts:468-471` (tryPayment catch) | Returns `null`, logs warn | Compat | **COMPAT** |
| 10 | `fallback.service.ts:541-544` (tryShipping catch) | Returns `null`, logs warn | Compat | **COMPAT** |
| 11 | `fallback.service.ts:615-618` (tryOrderStatus catch) | Returns `null`, logs warn | Compat | **COMPAT** |
| 12 | `fallback.service.ts:733-739` (tryTotal catch) | Returns `null`, logs warn | Compat | **COMPAT** |
| 13 | `fallback.service.ts:792-795` (trySOP catch) | Returns `null`, logs warn | Compat | **COMPAT** |
| 14 | `fallback.service.ts:977-982` (saveDiscussedItems catch) | Logs warn, continues | Bug | **BUG** — `saveDiscussedItems` failure is logged but the upsert at line 950 **bypasses atomicCas** entirely; lost update on `discussedItems`/`lastAmbiguousPrompt` possible |
| 15 | `conversation.service.ts:404-406` (customerCity read catch) | Empty catch, `customerCity` stays `null` | Compat-ish | **COMPAT** — non-critical, but silently masks DB errors |
| 16 | `conversation.service.ts:1123-1125` (updateConversationStats catch) | Logs warn, continues | Compat | **COMPAT** — stats update failure non-critical |
| 17 | `conversation.service.ts:963-965` (storePreviousMutation catch) | Logs warn, continues | **BUG** | **BUG** — `previousMutation` is used for rollback (V1); if this write fails, rollback snapshot is lost → no rollback possible. Also bypasses CAS. |
| 18 | `conversation.service.ts:1449-1451` (clearPreviousMutation catch) | Logs warn, continues | **BUG** | **BUG** — if clear fails, stale `previousMutation` remains; could cause incorrect rollback on next turn. Also bypasses CAS. |
| 19 | `workspace.ts:350` (loadWorkspace default schema_version) | `schema_version: ''` (empty string) | Dead value | **REMOVE LATER** — dead field, always empty |
| 20 | `conversation-context.service.ts:273-275` (deleteContext catch) | Logs debug, continues | Compat | **COMPAT** — non-critical |
| 21 | `conversation-delivery.service.ts` — V2 path does NOT call `refreshSession` | Session not refreshed on V2 path | **BUG** | **BUG** — V2 conversations don't refresh session expiry; session may expire mid-conversation |
| 22 | `fallback.service.ts:519-520` (tryShipping "both null" return) | Returns `null` silently when inCity and outCity are both null | Compat | **COMPAT** — misconfigured store, let fall through to LLM |
| 23 | `fallback.service.ts:539-540` (tryShipping "unknown mode") | Returns `null` silently | Compat | **COMPAT** — unknown shipping mode, let fall through |
| 24 | `conversation.service.ts:374` (V2 throw → V1 fallback) | Catches ANY error and falls through to V1 silently (logged) | Architecture risk | **BUG** (architectural) — V2 mutation partially committed + workspace_v2 persisted, then falls through to V1 which reads different state column. Stale workspace_v2 persists. |
| 25 | `conversation.service.ts:155` (workspace_v2 empty → migrate) | Creates fresh `loadWorkspace('{}')` if no legacy state — **no error if migration produces empty workspace** | Compat | **COMPAT** — expected for new conversations |

**Key finding:** Three direct DB writes bypass `atomicCas` (items 14, 17, 18) — these are lost-update risks where concurrent V1 operations could silently overwrite each other's changes to `extractedEntities`.

---

## 13. Typed Action Boundary

### G2-C CartAuthority boundary (established):

```
LLM / Interpreter
      ↓
Decision DTO (InterpreterResult / ReasoningResult)
      ↓
Typed Commerce Action (CartOp[]: 'add' | 'remove' with product/qty/price)
      ↓
Domain Executor (CartAuthority.executeOps)
      ↓
Prisma Transaction (OrderItem rows + Order.items JSON + confirmedItems sync)
```

**Verifications — AI does NOT directly mutate Prisma:**
- `cart-authority.ts:768-790` — `restoreFromSnapshot` is wrapped in transaction, delegates to internal methods
- `cart-authority.ts:536-560` — `checkout` delegates to `transitionOrder` state machine
- `conversation.service.ts:887-928` — `executeCartOps` wraps in `$transaction`, calls `cartAuthority.executeOps` (NOT `modifyCart` directly)
- `conversation.service.ts:941-966` — `storePreviousMutation` uses `client.conversationContext.update()` — **direct Prisma on conversationContext, bypasses atomicCas**

### Bypasses found:

| # | Location | Bypass | Risk |
|---|---|---|---|
| 1 | `fallback.service.ts:950-970` (`saveDiscussedItems`) | Direct `prisma.conversationContext.upsert()` | Bypasses atomicCas; lost-update risk on `extractedEntities` |
| 2 | `conversation.service.ts:954-962` (`storePreviousMutation`) | Direct `client.conversationContext.update()` | Bypasses atomicCas; lost-update risk; also bypasses session/extractedEntities atomicity |
| 3 | `conversation.service.ts:1445-1448` (`clearPreviousMutation`) | Direct `prisma.conversationContext.update()` | Same lost-update risk |
| 4 | `conversation.service.ts:396-403` (V1 customerCity read) | Direct `prisma.conversationContext.findUnique()` (read, not write) | Stale read without CAS; non-critical but inconsistent |
| 5 | `fallback.service.ts:639-641` (tryTotal read) | Direct `prisma.conversationContext.findUnique()` (read) | Stale read without CAS; non-critical |
| 6 | `fallback.service.ts:381-384` (tryProductNotFound read) | Direct `prisma.conversationContext.findUnique()` (read) | Stale read without CAS; non-critical |

**V1 engine direct state reads (bypassing conversationContextService):**
The V1 path reads `extractedEntities` directly via `prisma.conversationContext.findUnique()` in 4 locations (conversation.service.ts:396, fallback.service.ts:381, fallback.service.ts:639, conversation.service.ts:831/418) instead of using `conversationContextService.getContext()`. This creates a second read path for the same data, bypassing any future centralization.

**V2 engine bypass:**
The V2 path does NOT read from `extractedEntities` directly (except during one-time migration). It reads `workspace_v2` via `loadWorkspace`. However, V2's `buildPipelineContext` (line 822-879) is V1-only — when V2 falls back to V1, the V1 path builds PipelineContext from `extractedEntities`. The V2 path does NOT build a PipelineContext — it passes an in-memory `workspace` to `understand()`.

---

## 14. Migration Strategy

### Phase 1: Canonical state adapter

Create a new `canonical-context.service.ts` that provides a single canonical working state:

```
canonical-context.service.ts
  ├── getContext(conversationId) → CanonicalWorkingState
  │     Reads: workspace_v2 ?? migrate(extractedEntities)
  ├── saveContext(conversationId, state) → void
  │     Writes: workspace_v2 (single authority) via atomicCas
  ├── updateCartRef(conversationId, orderId | null) → void
  │     Writes only cart reference, delegates to CartAuthority for cart ops
  ├── setPendingClarification(conversationId, pending) → void
  │     Writes to workspace_v2.pendings (V2 canonical)
  ├── clearPendingClarification(conversationId) → void
  └── resolveCartRef(conversationId) → string | null
        Reads: existing draft Order ID from Order table
```

**Backward compat layer** (Phase 6):
- `extractedEntities` reader → reads from `workspace_v2` + `OrderItem` rows
- `confirmedItems` reader → reads from `OrderItem` rows via CartAuthority (already done)
- `lastMessages` reader → reads from `conversationHistory` table (already done by getOrCreateContext)

### Phase 2: V1 reads canonical state
- Migrate `fallbackService.getResponse` to read from canonical state adapter
- `buildPipelineContext` reads from canonical state (workspace_v2) instead of extractedEntities
- `customerCity` read from `workspace_v2.resolved_facts.customerCity`

### Phase 3: V2 reads canonical state
- V2 already reads workspace_v2 — ensure it reads through the canonical adapter (not direct loadWorkspace)

### Phase 4: V1 writes canonical state
- `setPendingClarification`, `modifyCart`, `storePreviousMutation`, `clearPreviousMutation` all route through canonical adapter
- `saveDiscussedItems` bypasses → route through adapter
- All direct `prisma.conversationContext.update` on extractedEntities are removed

### Phase 5: V2 writes canonical state
- `updateWorkspaceV2` already writes workspace_v2 — ensure it goes through canonical adapter
- V2's `saveWorkspace` becomes `canonical.saveContext()`

### Phase 6: Legacy readers become compatibility adapters
- `conversationContextService.parseExtractedEntities` → reads from canonical state
- `getPendingClarification(entities)` → reads from canonical state
- PWA `fetchClarificationOptions` → reads from canonical state (workspace_v2.pendings)

### Phase 7: Remove dead legacy paths
- Drop `extractedEntities` column write path (keep column for backward compat)
- Drop `lastMessages` column (vestigial)
- Drop `userIntent` column (V1-only, no V2 reader)
- Remove direct prisma writes to conversationContext

---

## 15. Legacy Compatibility

| Legacy artifact | Reader | Compat strategy | Removal phase |
|---|---|---|---|
| `extractedEntities` column | V1 path reads it; PWA reads `pendingClarification` from it | Compatibility adapter: read from `workspace_v2` + `OrderItem` | Phase 6 |
| `confirmedItems` JSON in extractedEntities | `fallbackService.tryTotal`, `tryProductNotFound`, `buildPipelineContext` | Already delegated to CartAuthority for writes; reads should delegate to CartAuthority.getCartFromDb | Phase 6 |
| `pendingClarification` in extractedEntities | `conversationContextService.getPendingClarification`, `conversation.service.ts:423`, PWA `fetchClarificationOptions` | V2 pendings is canonical; V1 reads through compatibility adapter | Phase 6 |
| `lastMessages` column | `conversationContextService.mapToContextData` (returns but unused) | Already vestigial; reads use `conversationHistory` table | Phase 7 (drop column) |
| `discussionItems` in extractedEntities | `fallbackService.detectNegation` (local read) | Dead field — no migration needed | Phase 7 |
| `trackedEntities` in extractedEntities | `conversationContextService.mapToContextData` + integration tests | Dead in V2 — no equivalent | Phase 7 |
| `previousMutation` in extractedEntities | `conversation.service.ts:425` (V1 rollback) | Dead in V2 — no equivalent | Phase 7 |
| `customerCity` as dynamic JSON field in extractedEntities | V1 `customerCity` extraction (line 401) | Migrate to `resolved_facts.customerCity` | Phase 4 |
| V1 `resolvePendingClarification` (whole-word matcher) | V1 resolver (line 433) | Already superseded by V2 `resolvePending` (substring) | Phase 7 |
| `appendMessage` (writes lastMessages) | V1 path only (line 770-777) | Already unused by V2; PWA reads conversationHistory table | Phase 7 |
| `saveDiscussedItems` (direct upsert) | `fallbackService.tryProduct` | Route through canonical adapter or remove (V2 has no equivalent) | Phase 7 |

---

## 16. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **R1: Clarification context loss on V1↔V2 switch** | Medium | High — customer answer "2 liter" interpreted as fresh message, not clarification response | Canonical state must store clarification in ONE place (workspace_v2.pendings); V1 must read from same source |
| **R2: Workspace_v2 stale after V2→V1 fallback** | Medium | High — V2 partial writes to workspace_v2 persist; V1 reads extractedEntities (divergent) | Roll back workspace_v2 on V2 failure OR sync workspace_v2 → extractedEntities on fallback |
| **R3: Lost update from direct DB writes** | Medium | Medium — three code paths bypass atomicCas | Route ALL conversationContext writes through canonical adapter (Phase 4-5) |
| **R4: Cart state divergence (draft_cart vs confirmedItems)** | High | High — customer sees wrong cart (V2 intent vs V1 confirmed vs OrderItem) | CartAuthority is sole cart authority; workspace_v2.draft_cart becomes read-only reference or removed |
| **R5: customerCity lost on V1→V2 migration** | Medium | Low-Medium — shipping cost calculation in tryTotal/tryShipping uses customerCity | Migrate customerCity into resolved_facts; or compute from shippingAddress |
| **R6: sessionKey not refreshed on V2 path** | Low | Medium — session expires mid-conversation on V2 engine | V2 path must call `refreshSession` or canonical adapter must do it |
| **R7: lastMessages desync** | Low | Low — vestigial column, unused by active readers | Drop column; PWA already reads from conversationHistory table |
| **R8: Atomic gap between workspace_v2 save + conversationHistory save** | Medium | Medium — state persists but messages don't (or vice versa) | Wrap V2 persistence in single transaction |
| **R9: PWA readClarificationOptions reads extractedEntities.pendingClarification** | High | High — if V2 engine is active, pendingClarification in extractedEntities is empty → PWA shows no quick-reply options | PWA reader must read from canonical state (workspace_v2.pendings) |
| **R10: V2 engine doesn't populate PipelineContext.cart** | High | Medium — V2's executeCartOps passes `cart: []` (line 241, 327) | V2 reads cart from CartAuthority directly, not from PipelineContext |
| **R11: `discussedItems` / `lastAmbiguousPrompt` not in V2** | Low | Low — V2 uses `options_presented` for this | Document as V1-only; no migration needed |

---

## 17. Logic Cleanup Findings

### New findings from G2-D forensic audit (not in existing ledger):

| ID | Finding | Severity | Module | Root Cause | Fix Now? | Planned Phase | Status |
|---|---|---|---|---|---|---|---|
| G2-D-L-001 | **Two competing persistence authorities** — `extractedEntities` (V1) and `workspace_v2` (V2) columns on same `ConversationContext` row, written by different code paths with no reconciliation | P0 CRITICAL | conversation-context.service.ts, conversation.service.ts:145/251/339, fallback.service.ts:950 | Architecture split: V1 and V2 each own a separate JSON column. One-time migration creates permanent divergence. | YES (architectural — requires migration strategy) | G2-D Phase 1-7 | DEFERRED |
| G2-D-L-002 | **Three cart representations** — `workspace_v2.draft_cart` (V2 intent) + `extractedEntities.confirmedItems` (V1 compat) + `OrderItem` rows (CartAuthority) | P1 HIGH | workspace.ts:166, conversation.service.ts:836, cart-authority.ts:272 | No single cart authority across V1/V2 boundary; draft_cart is intent, confirmedItems is compat mirror, OrderItem is authoritative | YES (canonical state: remove draft_cart from conversation state) | G2-D Phase 4-5 | DEFERRED |
| G2-D-L-003 | **Direct DB writes bypass atomicCas** — `saveDiscussedItems` (fallback.service.ts:950), `storePreviousMutation` (conversation.service.ts:954), `clearPreviousMutation` (conversation.service.ts:1445) | P1 HIGH | fallback.service.ts:950-970, conversation.service.ts:941-966, 1438-1452 | Read-modify-write on `extractedEntities` without `updatedAt` optimistic locking → lost updates | YES (route through atomicCas or canonical adapter) | G2-D Phase 4 | DEFERRED |
| G2-D-L-004 | **`lastMessages` column is vestigial** — written by `appendMessage` but never read as source of truth | P2 MEDIUM | conversation-context.service.ts:170, conversation.service.ts:770-777 | Message history moved to `conversationHistory` table; `lastMessages` is written but unused | YES (remove write + mark column for deprecation) | G2-D Phase 6-7 | DEFERRED |
| G2-D-L-005 | **V2 path does NOT call `refreshSession`** — session expiry not refreshed on V2 engine | P1 HIGH | conversation.service.ts (V2 path, lines 113-386) has no `refreshSession` call | V1 path calls `refreshSession` at line 778; V2 path has no equivalent | YES (add refreshSession to canonical adapter; Phase 2) | G2-D Phase 2-3 | DEFERRED |
| G2-D-L-006 | **`schema_version` is always empty string** — dead value in workspace_v2 | P3 LOW | workspace.ts:350 | `loadWorkspace` defaults `schema_version: ''`; never set to real version | YES (set to real version or remove) | G2-D cleanup | DEFERRED |
| G2-D-L-007 | **`customerCity` stored in extractedEntities as untyped dynamic field** — not in ExtractedEntities interface | P2 MEDIUM | domain/types.ts:257-269 (no customerCity field), conversation.service.ts:401 | customerCity is a dynamic JSON field not in the typed interface; V2 doesn't migrate it | YES (migrate to `resolved_facts.customerCity`) | G2-D Phase 4 | DEFERRED |
| G2-D-L-008 | **V2→V1 fallback leaves workspace_v2 stale** — no rollback on V2 failure | P1 HIGH | conversation.service.ts:249-251, 337-339, 368-386 | `updateWorkspaceV2` commits before `saveMessage`; if post-mutation error → workspace_v2 persisted but response may be stale | YES (Phase 5: persist workspace only after all side-effects succeed, or roll back) | G2-D Phase 5 | DEFERRED |
| G2-D-L-009 | **PWA `fetchClarificationOptions` reads from `extractedEntities.pendingClarification`** — breaks on V2 engine | P0 CRITICAL | structured-message.mapper.ts:203-206 | If V2 is active, pendingClarification in extractedEntities is empty/stale; PWA gets no options | YES (read from canonical state/workspace_v2.pendings) | G2-D Phase 3-6 | DEFERRED |
| G2-D-L-010 | **V2 engine doesn't populate `PipelineContext.cart`** — passes `cart: []` | P2 MEDIUM | conversation.service.ts:241, 327 | V2's executeCartOps passes empty cart to pipelineCtx; relies on CartAuthority directly | YES (V2 should read cart from CartAuthority, not PipelineContext) | G2-D Phase 4-5 | DEFERRED |
| G2-D-L-011 | **Direct reads of extractedEntities bypass conversationContextService** — 4 V1 read sites read raw `extractedEntities` | P2 MEDIUM | conversation.service.ts:396, fallback.service.ts:381/639, conversation.service.ts:831/418 | V1 path reads `prisma.conversationContext.findUnique({ select: { extractedEntities: true } })` directly, bypassing `getContext` | YES (route through canonical adapter) | G2-D Phase 2-3 | DEFERRED |
| G2-D-L-012 | **No invariant tests for concurrent turns or state isolation** | P2 MEDIUM | test suite | All tests are single-turn; no concurrent-turn or V1↔V2-switch tests | YES (add invariant tests — Part P) | G2-D Phase T (test design) | DEFERRED |
| G2-D-L-013 | **Empty catch block** — `tryProductNotFound` (fallback.service.ts:388) | P1 HIGH | fallback.service.ts:387-388 | `catch {}` swallows exception with zero logging | YES (add logging) | G2-D cleanup | DEFERRED |
| G2-D-L-014 | **`appendMessage` writes `lastMessages` but V2 never calls it** — V2 path uses `saveMessage` (conversationHistory) only | P3 LOW | conversation.service.ts:213-214 (V2), 770-777 (V1) | V2 writes to conversationHistory but not lastMessages; V1 writes both | YES (drop lastMessages writes; both paths already use conversationHistory) | G2-D Phase 6-7 | DEFERRED |

### Cross-referencing with existing G2-B/G2-C ledger entries:

The G2-C ledger already documented G2-C-L-006 (stale draft_cart) and G2-C-L-001 (dual cart authority) — G2-D-L-001 and G2-D-L-002 are the state-level generalization of these findings. The canonical state refactor (G2-D) is the architectural fix for these.

---

## 18. Owner Decisions Required

1. **OD-1: Column rename strategy**
   - Option A: Rename `workspace_v2` → `conversation_state` (canonical) via new column + data migration, drop old columns in Phase 7.
   - Option B: Keep `workspace_v2` name, migrate all V1 fields into it, leave `extractedEntities` as deprecated read-only compat.
   - **Recommended:** Option B (less migration risk; avoids data migration on live DB).

2. **OD-2: V1 deprecation timeline**
   - The V1 fallback service (`fallback.service.ts`) is still the default engine for most stores. Full removal of V1 state fields (`extractedEntities`) requires all stores to be migrated to V2.
   - **Recommended:** Keep V1 as compatibility adapter until all stores are on V2. G2-D work focuses on unification, not removal.

3. **OD-3: `lastMessages` column deprecation**
   - Confirmed vestigial (no active reader). Can be deprecated and eventually dropped.
   - **Recommended:** Stop writing it (Phase 4) → mark column deprecated → drop in future migration (Phase 7+).

4. **OD-4: `customerCity` migration**
   - V1 stores `customerCity` as untyped dynamic field in `extractedEntities`. V2 has no equivalent.
   - **Recommended:** Migrate to `resolved_facts.customerCity` during canonical state consolidation. If value is empty, compute from delivery address.

5. **OD-5: V2→V1 fallback workspace_v2 rollback**
   - Currently: V2 persists `workspace_v2` before `saveMessage`; if saveMessage fails, workspace_v2 is stale.
   - Option A: Roll back workspace_v2 on post-mutation error.
   - Option B: Don't persist workspace_v2 until all side-effects (saveMessage, cart) succeed.
   - **Recommended:** Option B (persist workspace_v2 only after message history + cart ops are committed, ideally in a single transaction).

6. **OD-6: PWA clarification options reader**
   - Current: reads `extractedEntities.pendingClarification` (V1 state).
   - If V2 is active, this is always empty → PWA shows no quick_reply options.
   - **Recommended:** Migrate to canonical state reader (workspace_v2.pendings) as part of Phase 3.

7. **OD-7: Schema version field**
   - `schema_version` in workspace_v2 is always `''` (empty string). Should it be a real version string?
   - **Recommended:** Set to `'3.2'` (or canonical model version) on first save; use for migration detection.

8. **OD-8: V1 `discussionItems` / `lastAmbiguousPrompt` / `trackedEntities` / `previousMutation`**
   - These V1-only fields have zero V2 readers. Removing their writes requires V1 deprecation.
   - **Recommended:** Keep writes during transition; document as dead in V2. Remove writes when V1 fallback is deprecated (OD-2).

---

## Git Baseline (Part R)

```
HEAD: 8289f5b feat(chatbox): FASE 4 web push notification
```

**Modified source files (tracked, M):**
- `apps/api/src/business/conversation.service.ts`
- `apps/api/src/business/conversation-context.service.ts`
- `apps/api/src/business/fallback.service.ts`
- `apps/api/src/business/order.service.ts`
- `apps/api/src/business/cart-authority.ts` (NEW — see ?? below)
- `apps/api/src/business/order-transition.ts` (NEW)
- `apps/api/src/domain/types.ts`
- `apps/api/src/middleware/gowa-trust.ts` (NEW)
- `apps/api/src/middleware/redis-rate-limit-store.ts` (NEW)
- `apps/api/src/routes/pwa.ts`
- `apps/api/src/services/chat/reasoning.ts`
- `apps/api/src/services/chat/interpreter.ts`
- `apps/api/src/services/chat/fast-path.ts`
- `apps/api/src/services/structured-message.mapper.ts`
- `apps/api/src/services/message-processor.service.ts`
- `apps/api/src/services/message-queue.service.ts`
- `apps/api/src/services/learning.service.ts`
- `apps/api/src/adapters/container.ts`
- `apps/api/src/adapters/ai/gemini.adapter.ts`
- `apps/api/src/adapters/ai/groq.adapter.ts`
- `apps/api/src/adapters/cache/redis.adapter.ts`
- `apps/api/src/middleware/rate-limiters.ts`
- `apps/pwa/src/components/ChatPage.tsx`
- `apps/pwa/src/components/ChatBubble.tsx`
- `apps/pwa/src/index.css`
- `apps/pwa/src/main.tsx`
- `apps/pwa/index.html`
- `apps/pwa/public/manifest.json`

**Untracked source files (??):**
- `apps/api/src/business/cart-authority.ts`
- `apps/api/src/business/order-transition.ts`
- `apps/api/src/adapters/ai/llm-gateway.ts`
- `apps/api/src/middleware/gowa-trust.ts`
- `apps/api/src/middleware/redis-rate-limit-store.ts`
- `apps/api/src/services/conversation-delivery.service.ts`
- `apps/api/src/services/event-bus.service.ts`
- `apps/api/src/services/notification.service.ts`
- `apps/api/src/services/realtime.service.ts`
- `apps/api/src/routes/orders.ts` (modified)
- `apps/api/src/routes/profile.ts` (modified)
- `apps/api/src/routes/admin/config.ts` (modified)
- `apps/pwa/src/components/*.tsx` (20 new component files)
- `apps/pwa/src/types/chat.ts`
- `apps/pwa/src/utils/format.ts`
- `apps/pwa/playwright-screenshot.ts`

**No destructive operations performed.** Forensic phase is read-only.

---

## 19. State Merge Semantics (Part I)

Audit of all spread / merge / Object.assign / JSON merge / partial update / upsert / replace operations that could cause field loss.

### Merge operations found in state-critical paths:

| Location | Operation | Fields affected | Safe? | CAS? |
|---|---|---|---|---|
| `conversation-context.service.ts:119` (`updateExtractedEntities`) | `mergeTrackedEntities(existing, entities)` → `{ ...existing, trackedEntities: [...] }` | trackedEntities only | ✅ SAFE | ✅ Yes (atomicCas) |
| `conversation-context.service.ts:346` (`modifyCart`) | `entities.confirmedItems = items` (after `parseExtractedEntities` spread) | confirmedItems only | ✅ SAFE | ✅ Yes (atomicCas) |
| `conversation-context.service.ts:364` (`setPendingClarification`) | `entities.pendingClarification = { ... }` | pendingClarification only | ✅ SAFE | ✅ Yes (atomicCas) |
| `conversation-context.service.ts:389` (`clearPendingClarification`) | `entities.pendingClarification = null` | pendingClarification only | ✅ SAFE | ✅ Yes (atomicCas) |
| `conversation-context.service.ts:403` (`incrementClarificationRetry`) | `pc.retry_count = pc.retry_count + 1` | pendingClarification.retry_count | ✅ SAFE | ✅ Yes (atomicCas) |
| `fallback.service.ts:952-957` (`saveDiscussedItems` update path) | `{ ...existing, discussedItems: [...], lastAmbiguousPrompt: ... }` | discussedItems, lastAmbiguousPrompt | ✅ SAFE merge | ⚠️ **NO** (direct upsert, bypasses atomicCas) |
| `conversation.service.ts:957-960` (`storePreviousMutation`) | `{ ...entities, previousMutation: { ... } }` | previousMutation only | ✅ SAFE merge | ⚠️ **NO** (direct update, bypasses atomicCas) |
| `conversation.service.ts:1447` (`clearPreviousMutation`) | `{ ...entities, previousMutation: null }` | previousMutation only | ✅ SAFE merge | ⚠️ **NO** (direct update, bypasses atomicCas) |
| `workspace.ts:558` (`mergeTrackedEntities`) | `{ ...existing, trackedEntities: Array.from(map.values()) }` | trackedEntities only | ✅ SAFE | N/A (in-memory accessor, not persisted directly) |
| `fallback.service.ts:959-968` (`saveDiscussedItems` create path) | Fresh object: `{ discussedItems, confirmedItems: [], lastAmbiguousPrompt }` | Sets 3 of 9 fields; rest defaulted | ✅ SAFE (create, no prior data) | N/A (upsert create) |
| `conversation.service.ts:251` (V2 `updateWorkspaceV2`) | Full replacement of `workspace_v2` column | ALL workspace fields replaced | ✅ SAFE by design | ✅ Yes (atomicCas) |
| `workspace.ts:320` (`mapLegacyEntitiesToWorkspace`) | Fresh `WorkspaceV2` object built from legacy fields | Maps: confirmedItems→draft_cart, pendingClarification→pendings, recipientName/shippingAddress/lastAmbiguousPrompt→resolved_facts. **DROPS**: discussedItems, trackedEntities, previousMutation, customerCity, customerName, customerPhone | ⚠️ **INTENTIONAL FIELD LOSS** (one-time migration) | N/A (pure function, no persistence) |

### Key finding — `updateWorkspaceV2` is full-replacement, not merge:

`updateWorkspaceV2` (line 141-145) writes the ENTIRE `workspace_v2` JSON column, replacing whatever was there. This is by design — the workspace is loaded into memory, mutated by the V2 engine during the turn, then saved wholesale. The `atomicCas` on `updatedAt` prevents lost updates between concurrent V2 turns (per-chat mutex already prevents this, but defense-in-depth is good).

**However**: if the V2 engine fails mid-turn (after mutating workspace in memory but before `updateWorkspaceV2` is called), the in-memory mutations are lost on the next turn (workspace is re-loaded from the last-persisted `workspace_v2`). This is correct behavior — no partial state persisted.

### Key finding — `saveDiscussedItems` create path defaults critical fields:

The `upsert` create path (fallback.service.ts:959-968) sets `confirmedItems: []` — this means if `saveDiscussedItems` runs when no context exists, it creates a context with empty confirmedItems, potentially wiping a cart that was in a non-persisted state. However, since this is an `upsert` create (row must not exist), this is not a real risk unless the conversationContext row was deleted out-of-band.

### Key finding — `parseExtractedEntities` defaults dynamic fields silently:

`parseExtractedEntities` (line 239-261) only maps the 9 typed fields (discussedItems, confirmedItems, lastAmbiguousPrompt, recipientName, shippingAddress, pendingClarification, previousMutation, trackedEntities). Dynamic fields like `customerCity`, `customerName`, `customerPhone` are NOT in the return type — they pass through as untyped extras in the raw object but are **DROPPED** when the parsed object is written back (since the write uses the parsed+spread object).

**This means**: any time `parseExtractedEntities` → modify → write-back occurs, dynamic fields like `customerCity` are **silently lost**. This affects:
- `modifyCart` (line 346→350): writes back parsed entities → customerCity LOST
- `setPendingClarification` (line 364→370): writes back → customerCity LOST
- `clearPendingClarification` (line 389→390): writes back → customerCity LOST
- `incrementClarificationRetry` (line 407→408): writes back → customerCity LOST
- `updateExtractedEntities` (line 119→122): writes back → customerCity LOST

**This is a silent data loss bug** — customerCity (and any other dynamic field) is silently dropped on every extractedEntities write because `parseExtractedEntities` doesn't preserve unknown fields.

---

## 20. Test Design (Part P)

### Invariant tests to be created after canonical state consolidation:

#### STATE INITIALIZATION
- **V1:** `getContext(new_conversation)` → returns default `ExtractedEntities` with all fields empty arrays/null
- **V2:** `loadWorkspace('{}')` → returns `WorkspaceV2` with all fields defaulted (schema_version='', pendings=[], draft_cart=[], etc.)
- **Canonical:** `canonical.getContext(new_conversation)` → returns canonical state with all fields defaulted

#### STATE READ
- **V1:** `getContext` returns correct `extractedEntities` fields after `modifyCart` (confirmedItems updated, other fields preserved)
- **V2:** `loadWorkspace` returns correct `workspace_v2` fields after `parkPending` (pendings updated, other fields preserved)
- **Canonical:** `canonical.getContext` returns correct state after any write

#### STATE WRITE
- **V1:** `setPendingClarification` → `extractedEntities.pendingClarification` set, other fields preserved (via atomicCas)
- **V2:** `updateWorkspaceV2` → `workspace_v2` column updated, other columns unchanged
- **Canonical:** `canonical.saveContext` → single column updated, no field loss

#### STATE MERGE
- **V1:** Two concurrent `setPendingClarification` calls → last write wins via `updatedAt` CAS, no lost update
- **V2:** Two concurrent `updateWorkspaceV2` calls → CAS retry, no lost update
- **Canonical:** Same — single writer via atomicCas
- **FIELD PRESERVATION:** After any write to `extractedEntities`, dynamic fields (customerCity) are preserved (G2-D-L-013 fix validation)

#### STATE RESET / STATE CLEAR
- `clearPendingClarification` → `pendingClarification` is null, `confirmedItems` preserved
- `clearCart` (via CartAuthority) → `OrderItem` rows deleted, `confirmedItems` JSON cleared, `Order.items` JSON empty
- `deleteContext` → ConversationContext row deleted, Conversation remains

#### CLARIFICATION: question → answer
1. Set pending clarification (V2: `parkPending`; V1: `setPendingClarification`)
2. Customer sends affirmative answer ("ya", "2 liter")
3. `resolvePending` resolves → `EXECUTE` or `ROLLBACK` or `ESCALATE`
4. Clarification cleared, cart ops executed via CartAuthority
5. **Cross-engine variant:** Set V2 pending → fall back to V1 → V1 reads clarification (should read from canonical state, not extractedEntities)

#### CLARIFICATION: edge cases (Part K)
- Unrelated message after question → falls through to normal pipeline, clarification preserved
- Clarification timeout → retry count increments → ESCALATE after >1 retries
- Repeated clarification → graduated response variants (attempt 1: direct Q+options; attempt 2: reframed; attempt 3+: hand-off)
- Concurrent turn → mutex prevents overlap (tested via mock concurrent calls)

#### CONTEXT: multi-turn continuity
- 3-message conversation: state persists across turns via canonical working state
- `workspace_v2` survives between turns (golden Case P3 baseline)
- `pendingClarification` survives turn boundary until resolved

#### CART: conversation → action → CartAuthority
1. Customer: "ambil minyak 2 liter"
2. V2: LLM intents → `draft_cart` op → `executeCartOps` → `CartAuthority.executeOps` → `OrderItem` rows + `Order.items` JSON + `confirmedItems` JSON sync
3. PWA: `fetchCart` → `CartAuthority.getCartSummary` → reads `OrderItem` rows → displays cart
4. **Invariant:** `OrderItem rows == Order.items JSON == confirmedItems JSON` after every mutation (mirrors G2-C-L-019 test)

#### HANDOFF: AI → human → AI
- Circuit breaker open → `markHumanTakeover` → `Conversation.status = 'human_takeover'`
- Admin sends reply via dashboard → `Conversation.status` stays `human_takeover`
- Admin resets status via `PUT /conversations/:id/status` → `Conversation.status = 'open'`
- V1/V2 engine resumes on next message
- **Invariant:** `Conversation.status === 'human_takeover'` → `processCustomerMessage` returns null (line 82-96)

#### CONCURRENCY: two turns
- Two concurrent messages for same conversationId → mutex (`acquireLock`) allows only one to proceed
- Second message returns 429 (web) or is dropped (WA)
- **Invariant test:** Two simultaneous `processCustomerMessage` calls → only one succeeds, other returns null or throws lock error

#### LEGACY: old state → canonical adapter
- `extractedEntities` with `pendingClarification` → canonical adapter reads → `pendings` populated
- `extractedEntities` with `confirmedItems` → canonical adapter reads → CartAuthority (not workspace.draft_cart)
- `extractedEntities` with `customerCity` → canonical adapter reads → `resolved_facts.customerCity`

### Test file locations (per convention):

| Test | Location |
|---|---|
| Canonical context state | `src/business/__tests__/canonical-context.test.ts` |
| State merge/field preservation | `src/business/tests/state-merge.test.ts` |
| Clarification continuity | `src/services/chat/__tests__/clarification-continuity.test.ts` |
| V1↔V2 state switch | `src/tests/cross-engine-clarification.test.ts` |
| Cart authority consistency | `src/tests/cart-authority.test.ts` (existing, extend) |
| Concurrency invariants | `src/tests/concurrency-invariants.test.ts` |
| Session refresh on V2 | `src/business/__tests__/v2-session-refresh.test.ts` |
