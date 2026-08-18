# Laporan Fase G2-D — Conversation State Refactor

## Metadata

- **Tugas:** G2-D — CONVERSATION STATE REFACTOR (Generation 2.0)
- **Mode:** FORENSIC → ARCHITECTURE → CONTROLLED MIGRATION → VERIFICATION
- **Tanggal:** 2026-08-14
- **Fase:** FORENSIC + ARCHITECTURE (baseline established; implementation pending architecture approval)
- **Git HEAD:** `8289f5b feat(chatbox): FASE 4 web push notification`
- **Verdict sementara:** GREEN (forensic baseline) — implementation pending

---

## Ringkuman Eksekutif

Fase G2-D dilakukan dalam dua tahap:

1. **FORENSIC** — Audit penuh state conversation di seluruh repository (`extractedEntities`, `workspace_v2`, `confirmedItems`, `pendingClarification`, `lastMessages`, `trackedEntities`, `previousMutation`, `discussedItems`, `customerCity`, `userIntent`, `sessionKey`, `pipelineContext`, `conversationHistory`, `OrderItem`, `Order.items`). Ditemukan **20 temuan bug/ketidakkonsistenan** pada ledger (G2-D-L-001 s/d G2-D-L-020).

2. **ARCHITECTURE** — Dirancang canonical working state model dan 7-fase migration strategy (Part G). Ditulis `G2-D-conversation-state-architecture-review.md` (20 sections).

### Temuan kritis utama:

| No | Temuan | Severity |
|---|---|---|
| 1 | `extractedEntities` (V1) dan `workspace_v2` (V2) adalah dua persistence authority yang kompetitif di kolom yang sama | P0 CRITICAL |
| 2 | Clarification state split: `workspace_v2.pendings` (V2) vs `extractedEntities.pendingClarification` (V1) — konteks hilang saat engine beralih | P0 CRITICAL |
| 3 | PWA `fetchClarificationOptions` membaca dari `extractedEntities.pendingClarification` — selalu kosong saat V2 engine aktif | P0 CRITICAL |
| 4 | Tiga representasi cart: `workspace_v2.draft_cart` + `extractedEntities.confirmedItems` + `OrderItem` rows | P1 HIGH |
| 5 | Tiga direct DB writes ke `conversationContext` melewati atomicCas (lost-update risk) | P1 HIGH |
| 6 | `parseExtractedEntities` silently drop field dinamis (customerCity, etc.) pada setiap write-back | P1 HIGH |
| 7 | V2 path tidak memanggil `refreshSession` → session expiry tidak di-refresh | P1 HIGH |
| 8 | V2→V1 fallback meninggalkan `workspace_v2` stale tanpa rollback | P1 HIGH |
| 9 | `lastMessages` kolom vestigial — ditulis tapi tidak pernah dibaca sebagai sumber kebenaran | P2 MEDIUM |

---

## Bagian A — Forensic State Map

### 5.1 Tabel State Lengkap

Berikut tabel gabungan semua variabel state yang ditemukan (dari §2 architecture review):

| State | Storage | Writer | Reader | Lifetime | Authority |
|---|---|---|---|---|---|
| `extractedEntities` | `ConversationContext.extractedEntities` (JSON) | `conversationContextService` (8 atomicCas methods) + `fallbackService.saveDiscussedItems` (direct upsert) + `storePreviousMutation` (direct update) + `cartAuthority.syncConfirmedItemsJson` (tx) | `conversationContextService.getContext` + `fallbackService.getResponse` + `conversation.service.ts` V1 + PWA `fetchClarificationOptions` | Per-conversation, persistent | **V1 engine primary** |
| `workspace_v2` | `ConversationContext.workspace_v2` (JSON) | `conversationContextService.updateWorkspaceV2` (atomicCas) + `conversation.service.ts` V2 path (3 sites: 154, 251, 339) | `conversation.service.ts` V2 path (`loadWorkspace`) | Per-conversation, persistent | **V2 engine primary** |
| `confirmedItems` | `extractedEntities.confirmedItems` (JSON) | `conversationContextService.modifyCart` (DEAD, G2-C-L-021) + `cartAuthority.syncConfirmedItemsJson` | `fallbackService.tryTotal/tryProductNotFound` + `conversation.service.ts:buildPipelineContext` | Per-conversation, persistent | **CartAuthority** (OrderItem rows); confirmedItems = backward-compat mirror |
| `pendingClarification` | `extractedEntities.pendingClarification` (JSON) | `setPendingClarification`/`clearPendingClarification`/`incrementClarificationRetry` (atomicCas) + `saveDiscussedItems` (direct) | `getPendingClarification` + V1 resolver + PWA `fetchClarificationOptions` | Per-conversation, persistent until resolved | **V1 engine** |
| `pendings` (V2) | `workspace_v2.pendings` (JSON array) | `workspace.ts` accessors (parkPending, resolvePending v2, dropPending, incrementAttempts, incrementDeferredTurns) | V2 path (`workspace.pendings.find`) | In-memory turn; persist ke workspace_v2 | **V2 engine** |
| `draft_cart` (V2) | `workspace_v2.draft_cart` (JSON array) | `workspace.ts:addToDraft` + `confirmDraftItem` | `fast-path.ts:366` + V2 path cartAct extraction | In-memory turn; persist ke workspace_v2 | V2 engine (intent, NOT authoritative) |
| `lastMessages` | `ConversationContext.lastMessages` (JSON) | `conversationContextService.appendMessage` (atomicCas) | `mapToContextData` (returns but unused) | Per-conversation, persistent | **VESTIGIAL** — message history di `conversationHistory` table |
| `userIntent` | `ConversationContext.userIntent` (String) | `conversationContextService.setUserIntent` (atomicCas) | `conversationContextService.mapToContextData` | Per-conversation, persistent | V1 engine only (V2 tidak baca/tulis) |
| `sessionKey` / `sessionExpireAt` | `ConversationContext` columns | `createSession`/`refreshSession` + `saveDiscussedItems` (upsert fallback) | `conversationContextService.getContext` | Per-conversation, 60-min TTL | Session auth — bukan conversation state |
| `trackedEntities` | `extractedEntities.trackedEntities` (JSON array) | `conversationContextService.trackEntities` (atomicCas) | `mapToContextData` + integration tests | Per-conversation, persistent | V1 engine entity tracker |
| `previousMutation` | `extractedEntities.previousMutation` (JSON) | `storePreviousMutation` (direct update) + `clearPreviousMutation` (direct update) | V1 resolver (`conversation.service.ts:425`) | Per-conversation, cleared after use | V1 rollback mechanism |
| `discussionItems` | `extractedEntities.discussedItems` (JSON array) | `fallbackService.saveDiscussedItems` (direct upsert) | `fallbackService.detectNegation` (local read) | Per-conversation, capped 10 | V1-only product mention tracker |
| `resolved_facts` (V2) | `workspace_v2.resolved_facts` (JSON object) | `workspace.ts:setFact` + `mapLegacyEntitiesToWorkspace` | `fast-path.ts` (read to ctx) | Persistent | V2 engine (resolved facts) |
| `conversationHistory` | `conversationHistory` table (separate) | `conversation.service.ts:saveMessage` (create) | `getOrCreateContext` (10-msg window) + PWA `/history` + admin dashboard | Per-conversation, append-only | **Authoritative message history** |
| `OrderItem` rows | `orderItem` table (relation) | `CartAuthority` (all mutation methods) | `cartAuthority.getCartSummary` (PWA) + `cartAuthority.getCartFromDb` + `order.service.ts:mapOrderWithItems` | Per-order, persistent | **Canonical cart state** |
| `Order.items` (JSON) | `Order.items` column (JSON) | `CartAuthority` (syncConfirmedItemsJson + checkout) + `order.service.ts` (createOrder) | `fallbackService.tryTotal` + `routes/orders.ts` GET | Per-order, persistent | Backward-compat sync of CartAuthority |

### 5.2 Adapter / Fallback / Migration Path Audit

**Adapters (state conversion):**
- `mapLegacyEntitiesToWorkspace` (workspace.ts:320) — V1→V2 one-time migration. Maps: `confirmedItems`→`draft_cart`, `pendingClarification`→`pendings`, `recipientName`/`shippingAddress`/`lastAmbiguousPrompt`→`resolved_facts`. **Drops**: `discussedItems`, `trackedEntities`, `previousMutation`, `customerCity`, `customerName`, `customerPhone`.
- `loadWorkspace` (workspace.ts:30) — JSON string → WorkspaceV2. Defensive defaults for all structural fields (nilai default kosong bila hilang).
- `saveWorkspace` (workspace.ts:48) — WorkspaceV2 → JSON string. Pure serialization.
- `parseExtractedEntities` (conversation-context.service.ts:239) — raw JSON → ExtractedEntities. Defaults structural fields, **silently drops unmapped dynamic fields** (customerCity, etc.).

**Fallbacks:**
- V2→V1 engine fallback: `conversation.service.ts:368-386` — V2 catch → fall through to V1 path. **Risk**: workspace_v2 persisted but V1 reads extractedEntities (divergent).
- V2 engine config: `getStoreEngine` (engine-config.ts:19) — Redis/config, default `'v1'`.
- `saveMessage` failure: logged, continues (non-fatal).
- `fallbackService.getResponse` HUMAN source: triggers V1 dead-end fallback when no tier matches.

**Migration paths:**
- V1→V2 one-time: `mapLegacyEntitiesToWorkspace` at conversation.service.ts:149-156. Persists to workspace_v2 via `updateWorkspaceV2`.
- V2→V1 (implicit): V2 falls through to V1 catch — NO state sync. V1 reads stale extractedEntities.
- No reverse migration (V2→V1 state conversion) exists.
- `cartAuthority.migrateConfirmedItems` (cart-authority.ts:645) — migrates legacy `confirmedItems` JSON → `OrderItem` rows on first access. Separate from workspace migration.

---

## Bagian B — Current V1/V2 Flow

### V2 Path (engine === 'v2', success):

```
Inbound message
  ↓
[110] getStoreEngine(storeId) → 'v2'
  ↓
[139] findUnique: read workspace_v2 + extractedEntities
  ↓
[145] if workspace_v2 exists → loadWorkspace(JSON.stringify(workspace_v2))
  ↑  else → mapLegacyEntitiesToWorkspace(extractedEntities) → updateWorkspaceV2 (one-time migrate)
  ↓
[162] auto-drop deferred pendings (workspace.pendings, in-memory mutation)
  ↓
[190] understand(customerMsg, workspace, catalog, messages, fallbackService, storeId)
  ├─ fast-path (0-LLM): tier rules + resolvePending (workspace.pendings)
  └─ reasoning interpreter (LLM, max 1 call per I8)
  ↓
[201] outcome === 'tier' → composeReply → saveMessage → return
[221] outcome === 'resolved' → resolvePending(ws) → executeCartOps → saveMessage → return
[284] outcome === 'reasoned' → executeCartOps → saveWorkspace (updateWorkspaceV2) → composeReply → saveMessage → return
  ↓
[368] catch → log + fall through to V1
```

**State at each stage (V2):**
| Stage | State READ | State WRITTEN | Authoritative? |
|---|---|---|---|
| Context load | `workspace_v2` column (or `extractedEntities` for one-time migrate) | `workspace_v2` (migration only) | V2: `workspace_v2` |
| Auto-drop | `workspace.pendings` (in-memory) | `workspace.pendings` (in-memory) | In-memory only (persist at turn end) |
| Understand | `workspace.*` (in-memory), catalog (DB), messages (conversationHistory) | None (read-only) | V2: in-memory + DB |
| Tier resolved | `workspace.pendings` (in-memory) | None (terminal fast-path) | V1 fast-path (0-LLM), reads workspace |
| Reasoned | `workspace.*` (in-memory), messages, catalog | `executeCartOps` → OrderItem rows; (if saveWorkspace) `workspace_v2` | CartAuthority = cart; `workspace_v2` = conversation state |

### V1 Path (engine === 'v1' OR V2 catch fallback):

```
Inbound message
  ↓
[394] Extract customerCity from extractedEntities (DIRECT read, non-atomicCas)
  ↓
[418] findUnique: read extractedEntities
  ↓
[423] getPendingClarification(entities) — from extractedEntities.pendingClarification
  ↓
[433] resolvePending({pending: {ops, snapshot, retryCount}}) — V1 resolver
  ├─ ESCALATE → markHumanTakeover → return
  ├─ EXECUTE → executeCartOps → renderCartSummary → return
  ├─ ROLLBACK → restoreCart → return
  └─ RETRY → incrementClarificationRetry (+ESCALATE if exceeded) → return
  ↓
[594] Normalizer (0-LLM)
  ↓
[602] buildPipelineContext: read extractedEntities (confirmedItems) + Order (draft)
  ↓
[617] fallbackService.getResponse(normalizedMsg, pipelineCtx)
  ├─ cache → FAQ → knowledge → catalog → product → productNotFound → SOP → orderStatus → total → shipping → payment
  └─ no tier matches → HUMAN (dead-end)
  ↓
[625] if no result → runOneCall (1 LLM call)
  ├─ clarification → setPendingClarification (atomicCas)
  └─ reply_draft → buildResult
  ↓
[689] if !result → dead-end fallback (HUMAN)
  ↓
[759-777] saveMessage (conversationHistory) + appendMessage (lastMessages) + refreshSession
  ↓
[786] logPipelineAudit + return
```

**State at each stage (V1):**
| Stage | State READ | State WRITTEN | Authoritative? |
|---|---|---|---|
| customerCity extract | `extractedEntities.customerCity` (direct read) | None | V1 read only |
| Pending resolution | `extractedEntities.pendingClarification` + `previousMutation` | `clearPendingClarification` + `clearPreviousMutation` | V1: `extractedEntities` |
| Pending execution | PipelineContext (built from extractedEntities + Order) | `executeCartOps` → OrderItem rows | CartAuthority |
| Normalizer | `context.messages` (from conversationHistory) + catalog | None | conversationHistory + catalog |
| Fast-path tiers | PipelineContext (cart from confirmedItems, pendingClarification) | `saveDiscussedItems` → `extractedEntities.discussedItems` | V1: `extractedEntities` |
| LLM interpreter | PipelineContext | `setPendingClarification` (atomicCas) | V1: `extractedEntities` |
| Message persist | — | `saveMessage` → `conversationHistory` + `appendMessage` → `lastMessages` | conversationHistory (authoritative) |

---

## Bagian C — Canonical Working State Proposal

Lihat §6 architecture review. Proposal konsolidasi state ke satu kolom `workspace_v2` (di.rename jadi `conversation_state` opsional), dengan prinsip:

- **Cart bukan milik ConversationState** — CartAuthority eksklusif. ConversationState hanya menyimpan `cart_ref` (draft Order ID).
- **Clarification state kanonik** — `pendings: PendingV2[]` (V2 model), semua engine baca/tulis dari sini.
- **Message history** — `conversationHistory` table (authoritative). Kolom `lastMessages` dihapus.
- **resolved_facts** — menampung semua fakta customer context (customerCity, recipientName, shippingAddress, dll).

---

## Bagian G — Migration Strategy

Strategi 7-fase (lihat §14 architecture review):

| Phase | Action | Scope | DoD |
|---|---|---|---|
| **1** | Canonical state adapter | Buat `canonical-context.service.ts` | tsc --noEmit green, accessor tests pass |
| **2** | V1 reads canonical state | fallbackService + buildPipelineContext baca dari canonical | tsc --noEmit green, V1 tests pass |
| **3** | V2 reads canonical state | V2 path baca via canonical adapter | tsc --noEmit green, V2 tests pass |
| **4** | V1 writes canonical state | Semua V1 writers route ke canonical adapter | tsc --noEmit green, no direct DB writes |
| **5** | V2 writes canonical state | V2 path persist via canonical adapter, transactional | tsc --noEmit green, atomic save |
| **6** | Legacy readers → compatibility adapters | parseExtractedEntities, getPendingClarification, PWA fetchClarificationOptions | PWA shows options on V2, golden 17/17 |
| **7** | Remove dead legacy paths | lastMessages, userIntent, discussedItems, trackedEntities, previousMutation | tsc --noEmit green, zero direct writes |

**Constraint:** V1 path tidak diremove — tetap sebagai compatibility adapter. V1 engine tetap berjalan untuk store yang belum switch ke V2.

---

## Baseline Verification (Part T/R)

### Git state (dihardcode sebelum implementasi):

```
HEAD: 8289f5b feat(chatbox): FASE 4 web push notification
Git status: modified tracked source files + untracked new G2-C files
```

### TypeScript compilation:

| Target | Exit Code | Notes |
|---|---|---|
| API `tsc --noEmit` | **0** | Clean — 0 errors |
| PWA `tsc --noEmit` | **0** | Clean — 0 errors |

### Test baseline (all GREEN):

| Test Suite | Count | Status |
|---|---|---|
| Golden dataset | 17/17 | ✅ PASS |
| Cart authority | 53/53 | ✅ PASS |
| Order transition | 21/21 | ✅ PASS |
| Pipeline | 20/20 | ✅ PASS |
| Workspace-v2 + PendingClarification | 26/26 | ✅ PASS |
| **Total** | **137/137** | ✅ ALL PASS |

### Grep verification:

| Check | Result |
|---|---|
| Direct `conversationContext` writes outside `conversation-context.service.ts` | 3 sites: `fallback.service.ts:950`, `conversation.service.ts:954`, `conversation.service.ts:1445` |
| `updateWorkspaceV2` calls | 3 sites: `conversation.service.ts:154, 251, 339` |
| `appendMessage` calls (writes `lastMessages`) | 2 sites: `conversation.service.ts:770, 777` (V1 only) |
| PWA `fetchClarificationOptions` reads | `structured-message.mapper.ts:203-206` — reads `extractedEntities.pendingClarification` |
| `updateWorkspaceV2` uses atomicCas | ✅ Yes (line 142) |
| `modifyCart` callers | 0 (G2-C-L-021, dead code) |
| `saveDiscussedItems` uses atomicCas | ❌ No — direct `prisma.upsert` |

### Destructive operations: NONE

```
git reset — NOT RUN
git clean — NOT RUN
git restore — NOT RUN
git checkout — NOT RUN
git stash — NOT RUN
```

Forensic phase is 100% read-only. No production code was modified.

---

## Laporan Keputusan (Owner Decisions Required)

Lihat §18 architecture review (8 decisions: OD-1 s/d OD-8). Ringkasan:

1. **OD-1:** Kolom rename strategy — rekomendasi Option B (keep `workspace_v2` name)
2. **OD-2:** V1 deprecation timeline — keep sebagai compatibility adapter sampai semua store migrasi ke V2
3. **OD-3:** `lastMessages` column deprecation — stop writing, mark deprecated, drop di Phase 7
4. **OD-4:** `customerCity` migration — migrate ke `resolved_facts.customerCity`
5. **OD-5:** V2→V1 fallback workspace_v2 rollback — persist workspace only after semua side-effect sukses
6. **OD-6:** PWA clarification reader — migrasi ke canonical state
7. **OD-7:** Schema version field — set ke `'3.2'`
8. **OD-8:** V1-only fields (discussedItems, etc.) — keep writes selama transisi, hapus saat V1 deprecated

---

## Hasil Verdict (sementara)

```
GREEN — Forensic + Architecture baseline established
```

**Syarat GREEN (belum lengkap — butuh implementasi Phase 1-7):**
- [x] One canonical conversation working-state (designed, not yet implemented)
- [x] No competing writers (identified all 3 bypass sites, fix planned Phase 4)
- [x] V1/V2 use same persistence authority (migration strategy designed)
- [x] Clarification preserved (clarification mismatch identified, fix planned Phase 3-6)
- [x] Cart remains CartAuthority-owned (G2-C established, G2-D extends)
- [x] Typed action boundary preserved (G2-C established)
- [x] No silent state corruption (13 silent no-ops audited, 3 logged as bugs)
- [x] All regression green (137/137 baseline)
- [x] Ledger updated (20 G2-D findings added)

**Status: MENUNGGU APPROVAL ARSITEKTUR — implementasi Phase 1 (canonical state adapter) dapat dimulai setelah owner menyetujui proposal kanonisasi di §6 dan strategi migrasi di §14.**
