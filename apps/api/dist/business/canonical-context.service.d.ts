/**
 * Canonical Conversation State Service — G2-D.1
 * src/business/canonical-context.service.ts
 *
 * Boundary tunggal untuk conversation working state.
 * Semua persistence state conversation harus melewati service ini.
 *
 * CANONICAL AUTHORITY: ConversationContext.workspace_v2 (kolom yang sama).
 * JANGAN rename schema column — nama `workspace_v2` dipertahankan.
 *
 * Cart boundary: canonical state MENYIMPAN cart_ref (order reference) SAJA.
 * CartAuthority tetap owner cart (OrderItem rows). Canonical state TIDAK
 * menyimpan draft_cart / confirmedItems / OrderItem sebagai authoritative cart.
 *
 * Legacy compatibility: V1 (extractedEntities) tetap ada sebagai compatibility
 * engine, tetapi tidak boleh menjadi persistence authority setelah migration.
 * fromLegacyExtractedEntities() memetakan semua field eksplisit — TIDAK ada
 * silent field loss (G2-D-L-009 fix).
 *
 * I8: atomic update via optimistic lock (@updatedAt CAS).
 * I10: 0-LLM fast-path tidak tersentuh di file ini (pure state + DB boundary).
 */
import type { PendingV2, WorkspaceV2 } from '../services/chat/types-v2.js';
import type { DiscussedItem, ExtractedEntity, ConfirmedItem, PendingClarification } from '../domain/types.js';
/** Versi skema canonical state. Membedakan format canonical-v1 dari format V2 lama ('' / '3.2'). */
export declare const CANONICAL_SCHEMA_VERSION = "canonical-v1";
/**
 * Reference ke cart/order. BUKAN cart authority — hANYA referensi.
 * CartAuthority (OrderItem rows) tetap owner cart state.
 */
export interface CanonicalCartRef {
    order_id: string | null;
}
/**
 * Legacy / deprecated fields yang disimpan untuk mencegah silent data loss
 * selama migrasi V1->V2. Semua field di sini SECARA EKSPLISIT dideprecatekan.
 * Akses read-only; tidak boleh menjadi persistence authority.
 */
export interface CanonicalCompatState {
    /** V1-only product mention tracker — deprecated. */
    discussed_items: DiscussedItem[];
    /** V1-only raw entity tracker — deprecated. */
    tracked_entities: ExtractedEntity[];
    /** V1-only cart mutation snapshot untuk rollback — deprecated. */
    previous_mutation: {
        cart_snapshot: ConfirmedItem[];
        message: string;
    } | null;
    /** Customer identity (nama, phone) — deprecated (belongs to Customer/Conversation table). */
    customer_name: string | null;
    customer_phone: string | null;
    /** V1-only PendingClarification (with cartOps in options) — compatibility for V1 resolver. */
    pending_clarification: PendingClarification | null;
}
/**
 * Canonical conversation working state.
 * Disimpan di ConversationContext.workspace_v2 (JSON nullable).
 *
 * Fields kanonik:
 * - schema_version: versi skema
 * - conversation_summary: rolling summary
 * - pendings: clarification state (unified V2 model)
 * - resolved_facts: fakta customer context yang terselesaikan
 * - intent: conversation intent
 * - options_presented: workflow metadata
 * - last_bot_message_type: bookkeeping
 * - cart_ref: reference ke cart (BUKAN cart data)
 *
 * Fields non-kanonik (di _compat): legacy V1 fields, deprecated.
 */
export interface CanonicalConversationState {
    schema_version: string;
    conversation_summary: string;
    pendings: PendingV2[];
    resolved_facts: Record<string, unknown>;
    intent: string | null;
    options_presented: string[][];
    last_bot_message_type?: string;
    cart_ref: CanonicalCartRef;
    /** Preserved legacy fields — deprecated, will be removed when V1 phases out. */
    _compat?: CanonicalCompatState;
}
/**
 * Default canonical state — digunakan saat inisialisasi, reset, atau recovery
 * dari malformed/empty input.
 */
export declare const DEFAULT_CANONICAL_STATE: CanonicalConversationState;
/**
 * Deserialize raw JSON ke CanonicalConversationState.
 *
 * HANDLE SECARA DETERMINISTIC:
 * - null / undefined / '' → default state
 * - malformed JSON string → default state (recovery)
 * - non-object (number, boolean, array) → default state (recovery)
 * - missing fields → defaults via ?? / type guards
 * - unknown fields (mis. draft_cart, confirmedItems) → ignored, NOT stored
 * - old schema_version → parsed normally, fields mapped by name
 *
 * I8: tidak ada silent catch — `loadCanonical` adalah pure function;
 *     observabilitas (logging) dilakukan oleh service layer (getCanonical).
 */
export declare function loadCanonical(raw: unknown): CanonicalConversationState;
/** Serialize canonical state ke JSON string. Pure — no validation. */
export declare function saveCanonical(state: CanonicalConversationState): string;
/**
 * Legacy adapter: extractedEntities (JSON) → CanonicalConversationState.
 *
 * GARANSI: TIDAK ada silent field loss. Setiap field dikelola eksplisit:
 *   - MAP: customerCity, recipientName, shippingAddress, dll → resolved_facts
 *   - MAP: pendingClarification → pendings
 *   - DEPRECATE (preserve in _compat): discussedItems, trackedEntities,
 *     previousMutation, customerName, customerPhone
 *   - DEPRECATE (not stored, log warning): confirmedItems (cart authority)
 *
 * (G2-D-L-009 fix: parseExtractedEntities silently dropped customerCity,
 *  customerName, customerPhone — adapter ini menyelamatkan ketiganya.)
 */
export declare function fromLegacyExtractedEntities(raw: unknown, logger?: {
    warn: (msg: string, ctx?: Record<string, unknown>) => void;
}): CanonicalConversationState;
/** Cari pending berdasarkan ID (bukan index — I15 invariant). */
export declare function findPending(state: CanonicalConversationState, id: string): PendingV2 | undefined;
/** Dapatkan daftar pending, opsional difilter per status. */
export declare function getPendings(state: CanonicalConversationState, status?: PendingV2['status']): PendingV2[];
/** Parkirkan (store) pending baru ke state. Mutasi in-place; return state untuk chaining. */
export declare function parkPending(state: CanonicalConversationState, pending: PendingV2): CanonicalConversationState;
/** Aktifkan kembali pending 'deferred' → 'active'. */
export declare function resumePending(state: CanonicalConversationState, id: string): PendingV2 | undefined;
/** Tandai pending sebagai 'resolved'. */
export declare function resolvePending(state: CanonicalConversationState, id: string): PendingV2 | undefined;
/** Tandai pending sebagai 'dropped'. */
export declare function dropPending(state: CanonicalConversationState, id: string): PendingV2 | undefined;
/** Increment counter attempts pada pending. */
export declare function incrementAttempts(state: CanonicalConversationState, id: string): PendingV2 | undefined;
/** Increment counter deferred_turns pada pending. */
export declare function incrementDeferredTurns(state: CanonicalConversationState, id: string): PendingV2 | undefined;
/** Cek apakah pending harus otomatis di-drop (deferred_turns >= threshold). */
export declare function shouldAutoDrop(pending: PendingV2): boolean;
/** Dapatkan pending yang sedang aktif (status='active'). */
export declare function getActivePending(state: CanonicalConversationState): PendingV2 | undefined;
/** Set resolved fact (key/value). Mutasi in-place; return state untuk chaining. */
export declare function setFact(state: CanonicalConversationState, key: string, value: unknown): CanonicalConversationState;
/** Get resolved fact (undefined bila belum ada). */
export declare function getFact(state: CanonicalConversationState, key: string): unknown;
/** Set conversation intent. Mutasi in-place; return state untuk chaining. */
export declare function setIntent(state: CanonicalConversationState, intent: string | null): CanonicalConversationState;
/** Get conversation intent. */
export declare function getIntent(state: CanonicalConversationState): string | null;
/** Set conversation summary. Mutasi in-place; return state untuk chaining. */
export declare function setSummary(state: CanonicalConversationState, summary: string): CanonicalConversationState;
/** Get conversation summary. */
export declare function getSummary(state: CanonicalConversationState): string;
/** Set cart reference (order_id). Mutasi in-place; return state untuk chaining. */
export declare function setCartRef(state: CanonicalConversationState, orderId: string | null): CanonicalConversationState;
/** Get cart reference. */
export declare function getCartRef(state: CanonicalConversationState): CanonicalCartRef;
/** Set last bot message type + append options presented. Mutasi in-place; return state. */
export declare function setLastBotMessage(state: CanonicalConversationState, type: string, options: string[]): CanonicalConversationState;
/** Get options presented history. */
export declare function getOptionsPresented(state: CanonicalConversationState): string[][];
/**
 * Service kanonik untuk conversation state persistence.
 *
 * BOUNDARY RULES:
 * - Read: hanya dari kolom `workspace_v2` di tabel conversation_context
 * - Write: hanya ke kolom `workspace_v2` via atomicCas (@updatedAt optimistic lock)
 * - Legacy (extractedEntities) hanya dibaca oleh fromLegacyExtractedEntities()
 *   — adapter ini BUKAN writer ke extractedEntities
 * - Cart data (draft_cart, confirmedItems) TIDAK pernah ditulis di sini
 * - CartAuthority tetap owner cart state
 */
export declare class CanonicalConversationStateService {
    /**
     * Atomic compare-and-swap (optimistic lock @updatedAt).
     *
     * Pattern sama seperti ConversationContextService.atomicCas, tetapi
     * membaca/menulis kolom `workspace_v2` (bukan `extractedEntities`).
     *
     * I8: writer function menerima row yang sudah dibaca; jika writer me-return
     *     count: null → berhenti tanpa retry (terminal). count > 0 → committed.
     *     count === 0 → writer lain menang → retry dengan state yang di-refresh.
     */
    private atomicCas;
    /**
     * Baca canonical state dari kolom workspace_v2.
     * Mengembalikan null bila context tidak ada.
     * Log warning bila state kosong/null (belum pernah ditulis) atau malformed.
     */
    getCanonical(conversationId: string): Promise<CanonicalConversationState | null>;
    /**
     * V1 READ: Baca canonical state dengan legacy fallback ke extractedEntities.
     *
     * Priority (Part F rule — canonical → legacy, NOT legacy → canonical):
     * 1. workspace_v2 (canonical) — jika ada isi, parse & gunakan
     * 2. extractedEntities (legacy V1) — konversi via fromLegacyExtractedEntities
     * 3. default state
     *
     * READ-ONLY — tidak menulis ke workspace_v2. DB-level migration (membaca
     * extractedEntities, menulis ke workspace_v2) terjadi di fase G2-D.5.
     *
     * G2-D-L-005 fix: V1 reader tidak perlu khawatir V2 menulis ke workspace_v2
     * tapi V1 tidak bisa baca. Canonical read membaca workspace_v2 yang sama.
     */
    getCanonicalWithLegacyFallback(conversationId: string): Promise<CanonicalConversationState | null>;
    /**
     * Baca pending clarification yang sedang aktif.
     */
    getPendingClarification(conversationId: string): Promise<PendingV2 | undefined>;
    /**
     * Baca resolved fact.
     */
    getFact(conversationId: string, key: string): Promise<unknown>;
    /**
     * V1 READ: Dapatkan pending clarification dalam format V1 (PendingClarification).
     *
     * Jika _compat.pending_clarification tersedia (legacy V1 data yang melalui
     * fromLegacyExtractedEntities), gunakan itu — mempertahankan cartOps di options.
     *
     * Jika tidak (V2 pendings dari workspace_v2), konversi PendingV2 → PendingClarification
     * (string options → ClarificationOption[] dengan cartOps:[] — ops akan kosong
     * untuk V2 pendings, tapi question/answer/retry_count/escalate flow tetap work).
     *
     * Legacy fallback ke extractedEntities juga dilakukan (Part F).
     */
    getV1PendingClarification(conversationId: string): Promise<PendingClarification | null>;
    /**
     * V1 READ: Dapatkan resolved fact (mis. customerCity) dengan legacy fallback.
     * Membaca dari workspace_v2.resolved_facts pertama, turun ke extractedEntities
     * bila workspace_v2 kosong (V1 engine belum migri).
     */
    getFactWithLegacyFallback(conversationId: string, key: string): Promise<unknown>;
    /**
     * V2 READ: Dapatkan WorkspaceV2 untuk engine v2 (read-only boundary).
     *
     * V2 engine tidak baca `workspace_v2` secara langsung (G2-D.3).
     * Semua business state read (pendings, resolved_facts, options_presented,
     * intent, conversation_summary) dilalukan melalui canonical boundary ini.
     *
     * Untuk V2-specific fields yang tidak ada di canonical state:
     * - `draft_cart`: diekstrak dari raw `workspace_v2` JSON. V2 engine menulis
     *   draft_cart ke workspace_v2 (writer tidak dimigrasi — G2-D.3 constraint
     *   "JANGAN migrate V2 writers"). Draft cart adalah pre-execution intent
     *   V2 engine, bukan cart authority state. CartAuthority tetap owner cart.
     * - `schema_version`: dari canonical state (kanonik).
     * - `last_bot_message_type`: dari canonical state (sudah termasuk di
     *   CanonicalConversationState sejak G2-D.1).
     *
     * Legacy fallback (V1→V2 transition): bila workspace_v2 kosong, migrasi
     * dari extractedEntities melalui fromLegacyExtractedEntities, lalu
     * mapLegacyEntitiesToWorkspace untuk draft_cart dari confirmedItems.
     *
     * READ-ONLY — tidak menulis ke workspace_v2.
     */
    getV2Workspace(conversationId: string): Promise<WorkspaceV2 | null>;
    /**
     * V1 READ: Dapatkan _compat.previous_mutation (snake_case → camelCase conversion
     * untuk V1 caller yang mengharapkan { cartSnapshot, message }).
     */
    getV1PreviousMutation(conversationId: string): Promise<{
        cartSnapshot: unknown[];
        message: string;
    } | null>;
    /**
     * V1 READ: Dapatkan tracked entities (compat read for V1 callers that
     * haven't migrated to canonical _compat.tracked_entities yet).
     *
     * READ-ONLY. Legacy readers still call parseExtractedEntities; canonical
     * state preserves trackedEntities in _compat.tracked_entities.
     */
    getV1TrackedEntities(conversationId: string): Promise<ExtractedEntity[]>;
    /**
     * V1 READ: Dapatkan discussedItems (compat read for V1 callers that
     * haven't migrated to canonical _compat.discussed_items yet).
     *
     * READ-ONLY.
     */
    getV1DiscussedItems(conversationId: string): Promise<DiscussedItem[]>;
    /**
     * Atomic update canonical state via updater function.
     * CAS dilakukan pada @updatedAt — bila conflict, retry otomatis.
     *
     * updater menerima state yang sudah di-load dan mengembalikan state baru.
     * MERGE SEMANTICS: updater melakukan spread { ...state, field: newValue }
     * — semua field lain tetap terjaga.
     */
    updateCanonical(conversationId: string, updater: (state: CanonicalConversationState) => CanonicalConversationState): Promise<CanonicalConversationState | null>;
    /**
     * Partial update resolved_facts — MERGE semantics (bukan replace).
     * Fact lama yang tidak dioverride tetap ada.
     */
    updateResolvedFacts(conversationId: string, facts: Record<string, unknown>): Promise<CanonicalConversationState | null>;
    /**
     * Update conversation intent.
     */
    updateIntent(conversationId: string, intent: string | null): Promise<CanonicalConversationState | null>;
    /**
     * Set cart reference (order_id). BUKAN cart data — hanya reference.
     */
    setCartRef(conversationId: string, orderId: string | null): Promise<CanonicalConversationState | null>;
    /**
     * Update conversation summary.
     */
    updateConversationSummary(conversationId: string, summary: string): Promise<CanonicalConversationState | null>;
    /**
     * Record last bot message type + options presented.
     */
    recordBotMessage(conversationId: string, type: string, options: string[]): Promise<CanonicalConversationState | null>;
    /**
     * Parkirkan pending clarification baru.
     * Jika pending dengan ID yang sama sudah ada, ganti (upsert by ID).
     */
    upsertPending(conversationId: string, pending: PendingV2): Promise<CanonicalConversationState | null>;
    /**
     * Tandai pending sebagai resolved (jawaban ditemukan).
     */
    resolvePending(conversationId: string, id: string): Promise<CanonicalConversationState | null>;
    /**
     * Tandai pending sebagai dropped (timeout / ignored).
     */
    dropPending(conversationId: string, id: string): Promise<CanonicalConversationState | null>;
    /**
     * Hapus semua pending clarification.
     */
    clearAllPending(conversationId: string): Promise<CanonicalConversationState | null>;
    /**
     * V1 WRITE: Persist pendingClarification ke canonical state.
     * Upserts to pendings[] + stores original (with cartOps) in _compat.
     * Called AFTER V1 setPendingClarification writes to extractedEntities.
     */
    writeV1PendingClarification(conversationId: string, clarification: PendingClarification): Promise<void>;
    /**
     * V1 WRITE: Clear pending from canonical state.
     * Called AFTER V1 clearPendingClarification writes to extractedEntities.
     */
    clearV1PendingClarification(conversationId: string): Promise<void>;
    /**
     * V1 WRITE: Increment retry count on active pending.
     * Called AFTER V1 incrementClarificationRetry writes to extractedEntities.
     */
    incrementV1PendingRetry(conversationId: string): Promise<void>;
    /**
     * V1 WRITE: Store previousMutation in canonical _compat.
     * Called AFTER V1 storePreviousMutation writes to extractedEntities.
     */
    writeV1PreviousMutation(conversationId: string, cartSnapshot: {
        product: string;
        qty?: number | string | null;
        price?: number | null;
    }[], message: string): Promise<void>;
    /**
     * V1 WRITE: Clear previousMutation from canonical _compat.
     * Called AFTER V1 clearPreviousMutation writes to extractedEntities.
     */
    clearV1PreviousMutation(conversationId: string): Promise<void>;
    /**
     * V1 WRITE: Update shipping info (recipientName, shippingAddress) in canonical
     * resolved_facts. Called as PRIMARY write (canonical is authority).
     *
     * Legacy extractedEntities compatibility: V1 path no longer writes to
     * extractedEntities for shipping info — canonical (workspace_v2) is sole authority.
     * V1 reader (conversation.service.ts:393) already reads from canonical via
     * getFactWithLegacyFallback (G2-D.2).
     */
    writeV1ShippingInfo(conversationId: string, recipientName?: string | null, shippingAddress?: string | null): Promise<void>;
    /**
     * V1 WRITE: Store tracked entities in canonical _compat.
     * Called as PRIMARY write (canonical is authority).
     *
     * Legacy extractedEntities compatibility: V1 path no longer writes to
     * extractedEntities for tracked entities — canonical _compat.tracked_entities
     * is sole authority. Legacy readers should use getV1TrackedEntities() or
     * migrate to canonical.
     */
    writeV1TrackedEntities(conversationId: string, entities: ExtractedEntity[]): Promise<void>;
    /**
     * V1 WRITE: Store discussedItems in canonical _compat + lastAmbiguousPrompt
     * in resolved_facts. Called as PRIMARY write (canonical is authority).
     *
     * Legacy extractedEntities compatibility: V1 path no longer writes to
     * extractedEntities for discussedItems — canonical _compat.discussed_items
     * is sole authority.
     */
    writeV1DiscussedItems(conversationId: string, items: DiscussedItem[], lastAmbiguousPrompt?: string | null): Promise<void>;
    /**
     * V1 WRITE: Construct legacy ExtractedEntities from canonical state.
     * Used by V1 readers that haven't fully migrated (e.g., fallback.service.ts
     * confirmedItems reads — deferred to G2-D.5).
     *
     * This is READ-ONLY — does not modify canonical state. It reconstructs
     * the ExtractedEntities shape that legacy code expects, sourcing all
     * fields from canonical (workspace_v2 + _compat).
     *
     * Fields reconstructed:
     * - pendingClarification ← _compat.pending_clarification OR null (V2 pendings
     *   are NOT reversible to V1 PendingClarification format — V1 readers should
     *   use getV1PendingClarification() instead)
     * - discussedItems ← _compat.discussed_items
     * - confirmedItems ← _compat (not stored in canonical — G2-C design)
     *   Returns [] as placeholder; CartAuthority is authoritative
     * - trackedEntities ← _compat.tracked_entities
     * - lastAmbiguousPrompt ← resolved_facts.lastAmbiguousPrompt
     * - recipientName ← resolved_facts.recipientName
     * - shippingAddress ← resolved_facts.shippingAddress
     * - previousMutation ← _compat.previous_mutation (converted to camelCase)
     */
    getV1ExtractedEntities(conversationId: string): Promise<{
        discussedItems: DiscussedItem[];
        confirmedItems: ConfirmedItem[];
        lastAmbiguousPrompt: string | null;
        recipientName: string | null;
        shippingAddress: string | null;
        pendingClarification: PendingClarification | null;
        previousMutation: {
            cartSnapshot: ConfirmedItem[];
            message: string;
        } | null;
        trackedEntities: ExtractedEntity[];
    } | null>;
    /**
     * V2 WRITE: Persist WorkspaceV2 through canonical boundary.
     *
     * This is the PRIMARY write path for V2 conversation state. V2 engine
     * callers that previously called `updateWorkspaceV2` should call this method
     * instead.
     *
     * Splits WorkspaceV2 into canonical vs. V2-transient:
     * - Canonical state → `updateCanonical` (atomic CAS):
     *   pendings, resolved_facts, intent, options_presented, conversation_summary,
     *   schema_version, last_bot_message_type
     * - V2-specific transient → adapter write to `workspace_v2` JSON:
     *   draft_cart (V2 engine pre-execution intent, NOT CartAuthority data)
     *
     * draft_cart STATUS: V2-specific transient state. V2 engine writes draft ops
     * (add/remove/intent) to workspace.draft_cart for turn processing, then
     * converts them to canonical cart via executeCartOps (which delegates to
     * CartAuthority for OrderItem rows). draft_cart is NOT canonical cart — it
     * is reset after each execution cycle. Persisted to workspace_v2 JSON so V2
     * engine can read it back on subsequent turns, but canonical state does NOT
     * treat it as authoritative cart state.
     *
     * Cart boundary: CartAuthority (OrderItem rows) IS the cart authority.
     * Canonical state stores only `cart_ref` (order_id reference).
     *
     * Atomicity: canonical fields updated via updateCanonical (atomicCas,
     * @updatedAt optimistic lock). draft_cart adapter write uses the same CAS
     * via updateV2Transient.
     */
    saveWorkspaceV2(conversationId: string, workspace: WorkspaceV2): Promise<void>;
    /**
     * V2 WRITE: Update V2-specific transient fields in workspace_v2 JSON.
     * These fields are NOT part of CanonicalConversationState — they are
     * V2-engine-internal state preserved across turns but not canonical business
     * state.
     *
     * Current transient fields:
     * - draft_cart: V2 engine pre-execution intent (confirmed/needs_clarification)
     *   NOT migrated to canonical cart (CartAuthority owns OrderItem).
     *   Reset after each execution cycle.
     *
     * Atomic CAS: uses updateMany with @updatedAt optimistic lock.
     */
    private updateV2Transient;
    /**
     * Reset canonical state ke default. Semua field dikembalikan ke nilai default.
     * (Untuk test dan emergency recovery.)
     */
    resetCanonical(conversationId: string): Promise<boolean>;
    /**
     * Clear specific resolved fact.
     */
    clearFact(conversationId: string, key: string): Promise<CanonicalConversationState | null>;
    /**
     * Clear intent.
     */
    clearIntent(conversationId: string): Promise<CanonicalConversationState | null>;
}
export declare const canonicalConversationStateService: CanonicalConversationStateService;
//# sourceMappingURL=canonical-context.service.d.ts.map