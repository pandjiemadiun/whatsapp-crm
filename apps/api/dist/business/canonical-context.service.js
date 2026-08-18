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
import { prisma } from '../infrastructure/prisma.js';
import { adapters } from '../adapters/container.js';
import { DEFERRED_AUTO_DROP_TURNS } from '../services/chat/constants-v2.js';
// ─────────────────────────────────────────────────────────────────────────────
// Version & Atomic CAS constants
// ─────────────────────────────────────────────────────────────────────────────
/** Versi skema canonical state. Membedakan format canonical-v1 dari format V2 lama ('' / '3.2'). */
export const CANONICAL_SCHEMA_VERSION = 'canonical-v1';
/** Maksimal percobaan optimistic lock sebelum memberi up. */
const ATOMIC_MAX_ATTEMPTS = 5;
/** Backoff ms per attempt (jitter sederhana). */
const ATOMIC_BACKOFF_MS = [0, 25, 50, 100, 200];
// ─────────────────────────────────────────────────────────────────────────────
// Legacy field mapping decisions (Part D)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Field-field di extractedEntities yang MAP ke resolved_facts (kanonik).
 * Semua field ini dibaca & ditulis oleh V1 path, dan dibutuhkan untuk
 * conversation working state.
 */
const RESOLVED_FACT_FIELDS = [
    'customerCity',
    'recipientName',
    'shippingAddress',
    'shippingNotes',
    'lastAmbiguousPrompt',
    'lastAmbiguousProduct',
];
/**
 * Field-field yang MAP ke _compat (deprecated, tapi dipreserve untuk V1 backward compat).
 * customerName / customerPhone adalah customer identity — belongs ke Customer/Conversation
 * table. Disimpan di _compat hanya untuk mencegah silent data loss selama migrasi.
 */
const COMPAT_FIELDS = [
    'customerName',
    'customerPhone',
];
// ─────────────────────────────────────────────────────────────────────────────
// Default state
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Default canonical state — digunakan saat inisialisasi, reset, atau recovery
 * dari malformed/empty input.
 */
export const DEFAULT_CANONICAL_STATE = {
    schema_version: CANONICAL_SCHEMA_VERSION,
    conversation_summary: '',
    pendings: [],
    resolved_facts: {},
    intent: null,
    options_presented: [],
    cart_ref: { order_id: null },
};
// ─────────────────────────────────────────────────────────────────────────────
// Type guards
// ─────────────────────────────────────────────────────────────────────────────
/** Cek apakah nilai adalah plain object (bukan array, bukan null). */
function isPlainObject(val) {
    return val !== null && typeof val === 'object' && !Array.isArray(val);
}
/** Cek apakah nilai adalah array of objects. */
function isRecordArray(val) {
    return Array.isArray(val) && val.every((item) => isPlainObject(item));
}
// ─────────────────────────────────────────────────────────────────────────────
// Serialization / Deserialization (Part C — JSON Safety)
// ─────────────────────────────────────────────────────────────────────────────
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
export function loadCanonical(raw) {
    // Handle: null, undefined, empty string
    if (raw === null || raw === undefined || raw === '') {
        return { ...DEFAULT_CANONICAL_STATE };
    }
    // Handle: string input (parse JSON, may be malformed)
    let parsed;
    if (typeof raw === 'string') {
        try {
            parsed = JSON.parse(raw);
        }
        catch {
            // Malformed JSON — recovery ke default (service layer akan log)
            return { ...DEFAULT_CANONICAL_STATE };
        }
    }
    else {
        parsed = raw;
    }
    // Handle: non-object (number, boolean, array, null)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ...DEFAULT_CANONICAL_STATE };
    }
    const obj = parsed;
    // Build state with explicit field defaults — NO silent field loss
    return {
        schema_version: typeof obj.schema_version === 'string' && obj.schema_version.length > 0
            ? obj.schema_version
            : CANONICAL_SCHEMA_VERSION,
        conversation_summary: typeof obj.conversation_summary === 'string'
            ? obj.conversation_summary
            : '',
        pendings: Array.isArray(obj.pendings) ? obj.pendings : [],
        resolved_facts: isPlainObject(obj.resolved_facts)
            ? obj.resolved_facts
            : {},
        intent: typeof obj.intent === 'string' ? obj.intent : null,
        options_presented: Array.isArray(obj.options_presented)
            ? obj.options_presented
            : [],
        last_bot_message_type: typeof obj.last_bot_message_type === 'string'
            ? obj.last_bot_message_type
            : undefined,
        cart_ref: loadCartRef(obj.cart_ref),
        ...((() => {
            const compat = loadCompat(obj._compat);
            return compat ? { _compat: compat } : {};
        })()),
    };
}
/** Serialize canonical state ke JSON string. Pure — no validation. */
export function saveCanonical(state) {
    return JSON.stringify(state);
}
/** Deserialize cart_ref sub-object. */
function loadCartRef(raw) {
    if (isPlainObject(raw)) {
        return {
            order_id: typeof raw.order_id === 'string' ? raw.order_id : null,
        };
    }
    return { order_id: null };
}
/** Deserialize _compat sub-object. */
function loadCompat(raw) {
    if (raw === null || raw === undefined)
        return undefined;
    if (isPlainObject(raw)) {
        return {
            discussed_items: isRecordArray(raw.discussed_items)
                ? raw.discussed_items
                : [],
            tracked_entities: isRecordArray(raw.tracked_entities)
                ? raw.tracked_entities
                : [],
            previous_mutation: isPlainObject(raw.previous_mutation)
                ? raw.previous_mutation
                : null,
            customer_name: typeof raw.customer_name === 'string' ? raw.customer_name : null,
            customer_phone: typeof raw.customer_phone === 'string' ? raw.customer_phone : null,
            pending_clarification: isPlainObject(raw.pending_clarification)
                ? raw.pending_clarification
                : null,
        };
    }
    return undefined;
}
// ─────────────────────────────────────────────────────────────────────────────
// Legacy mapping: extractedEntities → CanonicalConversationState (Part B)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Normalisasi legacy PendingClarification ke PendingV2.
 * Mapping:
 *   pendingClarification.question     → PendingV2.question
 *   pendingClarification.options       → PendingV2.options (extract string labels)
 *   pendingClarification.asked_at     → PendingV2.asked_at
 *   pendingClarification.retry_count  → PendingV2.attempts
 *   (new)                              → PendingV2.deferred_turns = 0
 *   (always)                           → PendingV2.status = 'active'
 */
function normalizePendingClarification(pc) {
    // Options: legacy bisa simpan sebagai rawOptions (string[]) atau
    // options (ClarificationOption[]). Normalisasi ke string label.
    let options;
    const rawOptions = pc.rawOptions;
    if (Array.isArray(rawOptions)) {
        options = rawOptions.filter((s) => typeof s === 'string');
    }
    else if (Array.isArray(pc.options)) {
        options = pc.options
            .map((o) => typeof o === 'string'
            ? o
            : o.label ?? o.id ?? '')
            .filter((s) => s.length > 0);
    }
    else {
        options = [];
    }
    // ID: pakai pc.id bila ada, generate dari asked_at bila tidak
    const id = typeof pc.id === 'string' &&
        pc.id.length > 0
        ? pc.id
        : `migrate:${pc.asked_at ?? new Date().toISOString()}`;
    return {
        id,
        question: typeof pc.question === 'string' ? pc.question : '',
        options,
        status: 'active',
        attempts: typeof pc.retry_count === 'number' ? pc.retry_count : 0,
        deferred_turns: 0,
        asked_at: typeof pc.asked_at === 'string' && pc.asked_at.length > 0
            ? pc.asked_at
            : new Date().toISOString(),
    };
}
/**
 * Ekstrak nilai string dari raw object dengan key tertentu.
 * Mengembalikan string atau null — untuk field dinamis di extractedEntities
 * yang tidak ada di typed ExtractedEntities interface (seperti customerCity).
 */
function extractStringField(obj, key) {
    const val = obj[key];
    if (typeof val === 'string' && val.length > 0)
        return val;
    return null;
}
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
export function fromLegacyExtractedEntities(raw, logger) {
    const entities = isPlainObject(raw) ? raw : {};
    // ── MAP: resolved_facts ────────────────────────────────────────────────
    const resolved_facts = {};
    for (const field of RESOLVED_FACT_FIELDS) {
        const val = extractStringField(entities, field);
        if (val !== null)
            resolved_facts[field] = val;
    }
    // ── MAP: pendingClarification → pendings ───────────────────────────────
    const pendings = [];
    const pc = entities.pendingClarification;
    if (isPlainObject(pc)) {
        pendings.push(normalizePendingClarification(pc));
    }
    // ── DEPRECATE: confirmedItems — cart authority, NOT stored in canonical ─
    if (Array.isArray(entities.confirmedItems) && entities.confirmedItems.length > 0) {
        logger?.warn('fromLegacyExtractedEntities: confirmedItems found — cart authority, NOT mapped to canonical state', {
            itemCount: entities.confirmedItems.length,
        });
    }
    // ── DEPRECATE (preserve in _compat) ───────────────────────────────────
    const customer_name = extractStringField(entities, 'customerName');
    const customer_phone = extractStringField(entities, 'customerPhone');
    // Preserve legacy pendingClarification (with cartOps in options) for V1 resolver compat
    const pending_clarification = isPlainObject(entities.pendingClarification)
        ? entities.pendingClarification
        : null;
    // Konversi legacy previousMutation (camelCase cartSnapshot) → canonical snake_case
    const legacyPreviousMutation = entities.previousMutation;
    const previous_mutation = isPlainObject(legacyPreviousMutation)
        ? {
            cart_snapshot: Array.isArray(legacyPreviousMutation.cartSnapshot)
                ? legacyPreviousMutation.cartSnapshot
                : [],
            message: typeof legacyPreviousMutation.message === 'string'
                ? legacyPreviousMutation.message
                : '',
        }
        : null;
    const hasCompat = Array.isArray(entities.discussedItems) ||
        Array.isArray(entities.trackedEntities) ||
        isPlainObject(entities.previousMutation) ||
        customer_name !== null ||
        customer_phone !== null ||
        pending_clarification !== null;
    const _compat = hasCompat
        ? {
            discussed_items: Array.isArray(entities.discussedItems)
                ? entities.discussedItems
                : [],
            tracked_entities: Array.isArray(entities.trackedEntities)
                ? entities.trackedEntities
                : [],
            previous_mutation,
            customer_name,
            customer_phone,
            pending_clarification,
        }
        : undefined;
    return {
        schema_version: CANONICAL_SCHEMA_VERSION,
        conversation_summary: '',
        pendings,
        resolved_facts,
        intent: null, // userIntent adalah kolom terpisah, bukan bagian extractedEntities
        options_presented: [],
        cart_ref: { order_id: null }, // confirmedItems tidak memetakan ke cart_ref
        _compat,
    };
}
// ─────────────────────────────────────────────────────────────────────────────
// Pure in-memory accessors (I8: 0-LLM, mutate-in-place, return state for chaining)
// Diikuti pola workspace.ts — "Accessor PURE", "Storage di-handle caller".
// ─────────────────────────────────────────────────────────────────────────────
/** Cari pending berdasarkan ID (bukan index — I15 invariant). */
export function findPending(state, id) {
    return state.pendings.find((p) => p.id === id);
}
/** Dapatkan daftar pending, opsional difilter per status. */
export function getPendings(state, status) {
    if (status)
        return state.pendings.filter((p) => p.status === status);
    return state.pendings;
}
/** Parkirkan (store) pending baru ke state. Mutasi in-place; return state untuk chaining. */
export function parkPending(state, pending) {
    state.pendings.push(pending);
    return state;
}
/** Aktifkan kembali pending 'deferred' → 'active'. */
export function resumePending(state, id) {
    const p = findPending(state, id);
    if (p)
        p.status = 'active';
    return p;
}
/** Tandai pending sebagai 'resolved'. */
export function resolvePending(state, id) {
    const p = findPending(state, id);
    if (p)
        p.status = 'resolved';
    return p;
}
/** Tandai pending sebagai 'dropped'. */
export function dropPending(state, id) {
    const p = findPending(state, id);
    if (p)
        p.status = 'dropped';
    return p;
}
/** Increment counter attempts pada pending. */
export function incrementAttempts(state, id) {
    const p = findPending(state, id);
    if (p)
        p.attempts += 1;
    return p;
}
/** Increment counter deferred_turns pada pending. */
export function incrementDeferredTurns(state, id) {
    const p = findPending(state, id);
    if (p)
        p.deferred_turns += 1;
    return p;
}
/** Cek apakah pending harus otomatis di-drop (deferred_turns >= threshold). */
export function shouldAutoDrop(pending) {
    return pending.deferred_turns >= DEFERRED_AUTO_DROP_TURNS;
}
/** Dapatkan pending yang sedang aktif (status='active'). */
export function getActivePending(state) {
    return getPendings(state, 'active')[0];
}
// ─────────────────────────────────────────────────────────────────────────────
// Pure accessors — resolved_facts
// ─────────────────────────────────────────────────────────────────────────────
/** Set resolved fact (key/value). Mutasi in-place; return state untuk chaining. */
export function setFact(state, key, value) {
    state.resolved_facts[key] = value;
    return state;
}
/** Get resolved fact (undefined bila belum ada). */
export function getFact(state, key) {
    return state.resolved_facts[key];
}
// ─────────────────────────────────────────────────────────────────────────────
// Pure accessors — intent, summary, cart_ref, bot message
// ─────────────────────────────────────────────────────────────────────────────
/** Set conversation intent. Mutasi in-place; return state untuk chaining. */
export function setIntent(state, intent) {
    state.intent = intent;
    return state;
}
/** Get conversation intent. */
export function getIntent(state) {
    return state.intent;
}
/** Set conversation summary. Mutasi in-place; return state untuk chaining. */
export function setSummary(state, summary) {
    state.conversation_summary = summary;
    return state;
}
/** Get conversation summary. */
export function getSummary(state) {
    return state.conversation_summary;
}
/** Set cart reference (order_id). Mutasi in-place; return state untuk chaining. */
export function setCartRef(state, orderId) {
    state.cart_ref.order_id = orderId;
    return state;
}
/** Get cart reference. */
export function getCartRef(state) {
    return state.cart_ref;
}
/** Set last bot message type + append options presented. Mutasi in-place; return state. */
export function setLastBotMessage(state, type, options) {
    state.last_bot_message_type = type;
    if (options.length > 0)
        state.options_presented.push(options);
    return state;
}
/** Get options presented history. */
export function getOptionsPresented(state) {
    return state.options_presented;
}
// ─────────────────────────────────────────────────────────────────────────────
// Service — Database boundary (atomic CAS via @updatedAt)
// ─────────────────────────────────────────────────────────────────────────────
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
export class CanonicalConversationStateService {
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
    async atomicCas(conversationId, operation, writer) {
        for (let attempt = 0; attempt <= ATOMIC_MAX_ATTEMPTS; attempt++) {
            let row;
            try {
                row = await prisma.conversationContext.findUnique({
                    where: { conversationId },
                    select: { workspace_v2: true, updatedAt: true },
                });
            }
            catch (error) {
                adapters.logger.error('canonical atomicCas read failed', error, { conversationId, operation });
                return null;
            }
            if (!row) {
                adapters.logger.debug('Canonical context not found, skipping atomic update', { conversationId, operation });
                return null;
            }
            let outcome;
            try {
                outcome = await writer(row);
            }
            catch (error) {
                adapters.logger.error('canonical atomicCas write failed', error, { conversationId, operation });
                return null;
            }
            // count === null → writer memutuskan tidak perlu menulis (terminal)
            if (outcome.count === null)
                return outcome.value;
            // count > 0 → committed
            if (outcome.count > 0) {
                adapters.logger.debug('Canonical atomic update committed', { conversationId, operation, attempt });
                return outcome.value;
            }
            // count === 0 → konflik (updatedAt berubah) → retry
            if (attempt < ATOMIC_MAX_ATTEMPTS) {
                const wait = ATOMIC_BACKOFF_MS[attempt] ?? 200;
                adapters.logger.warn('Canonical optimistic lock conflict, retrying', {
                    conversationId,
                    operation,
                    attempt,
                    wait,
                });
                await new Promise((r) => setTimeout(r, wait));
            }
        }
        adapters.logger.error('Canonical optimistic lock conflict exhausted retries', { conversationId, operation });
        return null;
    }
    // ──────────────────────────────────────────────────────────────────────────
    // READ (Part D — Read API)
    // ──────────────────────────────────────────────────────────────────────────
    /**
     * Baca canonical state dari kolom workspace_v2.
     * Mengembalikan null bila context tidak ada.
     * Log warning bila state kosong/null (belum pernah ditulis) atau malformed.
     */
    async getCanonical(conversationId) {
        const row = await prisma.conversationContext.findUnique({
            where: { conversationId },
            select: { workspace_v2: true, updatedAt: true },
        });
        if (!row) {
            adapters.logger.debug('Canonical state not found — context does not exist', { conversationId });
            return null;
        }
        const state = loadCanonical(row.workspace_v2);
        // Observability: log bila workspace_v2 kosong atau schema version lama
        if (row.workspace_v2 === null || row.workspace_v2 === undefined || row.workspace_v2 === '') {
            adapters.logger.debug('Canonical state is empty — first write or pre-migration', { conversationId });
        }
        else if (state.schema_version !== CANONICAL_SCHEMA_VERSION) {
            adapters.logger.warn('Canonical state has old schema version', {
                conversationId,
                schema_version: state.schema_version,
                expected: CANONICAL_SCHEMA_VERSION,
            });
        }
        return state;
    }
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
    async getCanonicalWithLegacyFallback(conversationId) {
        const row = await prisma.conversationContext.findUnique({
            where: { conversationId },
            select: { workspace_v2: true, extractedEntities: true },
        });
        if (!row) {
            adapters.logger.debug('Canonical context not found — context does not exist', { conversationId });
            return null;
        }
        // 1. Canonical state: workspace_v2 ada isi
        if (row.workspace_v2 !== null &&
            row.workspace_v2 !== undefined &&
            row.workspace_v2 !== '') {
            return loadCanonical(row.workspace_v2);
        }
        // 2. Legacy fallback: extractedEntities → canonical (pure, no DB write)
        if (row.extractedEntities !== null && row.extractedEntities !== undefined) {
            return fromLegacyExtractedEntities(row.extractedEntities, adapters.logger);
        }
        // 3. Semua kosong — default state
        return { ...DEFAULT_CANONICAL_STATE };
    }
    /**
     * Baca pending clarification yang sedang aktif.
     */
    async getPendingClarification(conversationId) {
        const state = await this.getCanonical(conversationId);
        if (!state)
            return undefined;
        return getActivePending(state);
    }
    /**
     * Baca resolved fact.
     */
    async getFact(conversationId, key) {
        const state = await this.getCanonical(conversationId);
        if (!state)
            return undefined;
        return getFact(state, key);
    }
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
    async getV1PendingClarification(conversationId) {
        const state = await this.getCanonicalWithLegacyFallback(conversationId);
        if (!state)
            return null;
        // 1. Cek _compat.pending_clarification (legacy V1 dengan cartOps)
        if (state._compat?.pending_clarification) {
            return state._compat.pending_clarification;
        }
        // 2. Cek V2 pendings — konversi ke V1 format
        const pending = getActivePending(state);
        if (!pending)
            return null;
        return {
            id: pending.id,
            question: pending.question,
            options: pending.options.map((o, i) => ({
                id: String(i),
                label: o,
                cartOps: [],
            })),
            expected_type: 'affirmative',
            asked_at: pending.asked_at,
            retry_count: pending.attempts,
            rawOptions: pending.options,
        };
    }
    /**
     * V1 READ: Dapatkan resolved fact (mis. customerCity) dengan legacy fallback.
     * Membaca dari workspace_v2.resolved_facts pertama, turun ke extractedEntities
     * bila workspace_v2 kosong (V1 engine belum migri).
     */
    async getFactWithLegacyFallback(conversationId, key) {
        const state = await this.getCanonicalWithLegacyFallback(conversationId);
        if (!state)
            return undefined;
        return getFact(state, key);
    }
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
    async getV2Workspace(conversationId) {
        const canonicalState = await this.getCanonicalWithLegacyFallback(conversationId);
        if (!canonicalState)
            return null;
        // Extract V2-specific draft_cart from raw workspace_v2 JSON.
        // Canonical state tidak memetakan draft_cart (bukan canonical field).
        // V2 engine menulis draft_cart ke workspace_v2; kita baca kembali lewat
        // boundary ini agar V2 engine tidak perlu direct Prisma access.
        let draftCart = [];
        try {
            const row = await prisma.conversationContext.findUnique({
                where: { conversationId },
                select: { workspace_v2: true },
            });
            if (row?.workspace_v2 !== null && row?.workspace_v2 !== undefined && row.workspace_v2 !== '') {
                const raw = row.workspace_v2;
                if (Array.isArray(raw.draft_cart)) {
                    draftCart = raw.draft_cart;
                }
            }
        }
        catch (err) {
            adapters.logger.warn('getV2Workspace: failed to extract draft_cart from workspace_v2', {
                conversationId,
                error: err instanceof Error ? err.message : String(err),
            });
        }
        // Build WorkspaceV2 from canonical state (business fields) + V2-specific draft_cart
        const workspace = {
            schema_version: canonicalState.schema_version,
            conversation_summary: canonicalState.conversation_summary,
            pendings: canonicalState.pendings,
            draft_cart: draftCart,
            resolved_facts: canonicalState.resolved_facts,
            options_presented: canonicalState.options_presented,
            ...(canonicalState.last_bot_message_type
                ? { last_bot_message_type: canonicalState.last_bot_message_type }
                : {}),
        };
        return workspace;
    }
    /**
     * V1 READ: Dapatkan _compat.previous_mutation (snake_case → camelCase conversion
     * untuk V1 caller yang mengharapkan { cartSnapshot, message }).
     */
    async getV1PreviousMutation(conversationId) {
        const state = await this.getCanonicalWithLegacyFallback(conversationId);
        if (!state?._compat?.previous_mutation)
            return null;
        const pm = state._compat.previous_mutation;
        return {
            cartSnapshot: pm.cart_snapshot ?? [],
            message: pm.message ?? '',
        };
    }
    /**
     * V1 READ: Dapatkan tracked entities (compat read for V1 callers that
     * haven't migrated to canonical _compat.tracked_entities yet).
     *
     * READ-ONLY. Legacy readers still call parseExtractedEntities; canonical
     * state preserves trackedEntities in _compat.tracked_entities.
     */
    async getV1TrackedEntities(conversationId) {
        const state = await this.getCanonicalWithLegacyFallback(conversationId);
        if (!state?._compat?.tracked_entities)
            return [];
        return state._compat.tracked_entities;
    }
    /**
     * V1 READ: Dapatkan discussedItems (compat read for V1 callers that
     * haven't migrated to canonical _compat.discussed_items yet).
     *
     * READ-ONLY.
     */
    async getV1DiscussedItems(conversationId) {
        const state = await this.getCanonicalWithLegacyFallback(conversationId);
        if (!state?._compat?.discussed_items)
            return [];
        return state._compat.discussed_items;
    }
    // ──────────────────────────────────────────────────────────────────────────
    // V1 WRITE BRIDGE (G2-D.4 — migrate non-cart V1 writers to canonical)
    // ──────────────────────────────────────────────────────────────────────────
    // ──────────────────────────────────────────────────────────────────────────
    // WRITE (Part D — Atomic Write API)
    // ──────────────────────────────────────────────────────────────────────────
    /**
     * Atomic update canonical state via updater function.
     * CAS dilakukan pada @updatedAt — bila conflict, retry otomatis.
     *
     * updater menerima state yang sudah di-load dan mengembalikan state baru.
     * MERGE SEMANTICS: updater melakukan spread { ...state, field: newValue }
     * — semua field lain tetap terjaga.
     */
    async updateCanonical(conversationId, updater) {
        return this.atomicCas(conversationId, 'updateCanonical', async (row) => {
            const state = loadCanonical(row.workspace_v2);
            const updated = updater(state);
            const json = updated;
            const result = await prisma.conversationContext.updateMany({
                where: { conversationId, updatedAt: row.updatedAt },
                data: { workspace_v2: json },
            });
            return { count: result.count, value: updated };
        });
    }
    /**
     * Partial update resolved_facts — MERGE semantics (bukan replace).
     * Fact lama yang tidak dioverride tetap ada.
     */
    async updateResolvedFacts(conversationId, facts) {
        return this.updateCanonical(conversationId, (state) => ({
            ...state,
            resolved_facts: { ...state.resolved_facts, ...facts },
        }));
    }
    /**
     * Update conversation intent.
     */
    async updateIntent(conversationId, intent) {
        return this.updateCanonical(conversationId, (state) => setIntent(state, intent));
    }
    /**
     * Set cart reference (order_id). BUKAN cart data — hanya reference.
     */
    async setCartRef(conversationId, orderId) {
        return this.updateCanonical(conversationId, (state) => setCartRef(state, orderId));
    }
    /**
     * Update conversation summary.
     */
    async updateConversationSummary(conversationId, summary) {
        return this.updateCanonical(conversationId, (state) => setSummary(state, summary));
    }
    /**
     * Record last bot message type + options presented.
     */
    async recordBotMessage(conversationId, type, options) {
        return this.updateCanonical(conversationId, (state) => setLastBotMessage(state, type, options));
    }
    // ──────────────────────────────────────────────────────────────────────────
    // PENDING CLARIFICATION (Part H — Clarification Boundary)
    // ──────────────────────────────────────────────────────────────────────────
    /**
     * Parkirkan pending clarification baru.
     * Jika pending dengan ID yang sama sudah ada, ganti (upsert by ID).
     */
    async upsertPending(conversationId, pending) {
        return this.updateCanonical(conversationId, (state) => {
            // Remove existing pending with same ID, then add new
            const filtered = state.pendings.filter((p) => p.id !== pending.id);
            filtered.push(pending);
            state.pendings = filtered;
            return state;
        });
    }
    /**
     * Tandai pending sebagai resolved (jawaban ditemukan).
     */
    async resolvePending(conversationId, id) {
        return this.updateCanonical(conversationId, (state) => {
            resolvePending(state, id);
            return state;
        });
    }
    /**
     * Tandai pending sebagai dropped (timeout / ignored).
     */
    async dropPending(conversationId, id) {
        return this.updateCanonical(conversationId, (state) => {
            dropPending(state, id);
            return state;
        });
    }
    /**
     * Hapus semua pending clarification.
     */
    async clearAllPending(conversationId) {
        return this.updateCanonical(conversationId, (state) => {
            state.pendings = [];
            return state;
        });
    }
    // ──────────────────────────────────────────────────────────────────────────
    // V1 WRITE BRIDGE (G2-D.2 CLEANUP — eliminate read/write split-brain)
    // ──────────────────────────────────────────────────────────────────────────
    // V1 writers still write to extractedEntities (legacy). These methods write
    // the SAME state to canonical (workspace_v2) so V1 reads — which now read
    // canonical — observe their own latest writes.
    // Authority: canonical state (workspace_v2) = source of truth
    // Legacy: extractedEntities = compatibility mirror (V1 writers maintain)
    // Both writes happen sequentially (per-conversation mutex prevents concurrency).
    /**
     * V1 WRITE: Persist pendingClarification ke canonical state.
     * Upserts to pendings[] + stores original (with cartOps) in _compat.
     * Called AFTER V1 setPendingClarification writes to extractedEntities.
     */
    async writeV1PendingClarification(conversationId, clarification) {
        const pendingV2 = normalizePendingClarification(clarification);
        await this.updateCanonical(conversationId, (state) => {
            state.pendings = state.pendings.filter((p) => p.id !== pendingV2.id);
            state.pendings.push(pendingV2);
            if (!state._compat) {
                state._compat = {
                    discussed_items: [], tracked_entities: [],
                    previous_mutation: null, customer_name: null, customer_phone: null,
                    pending_clarification: null,
                };
            }
            state._compat.pending_clarification = clarification;
            return state;
        });
    }
    /**
     * V1 WRITE: Clear pending from canonical state.
     * Called AFTER V1 clearPendingClarification writes to extractedEntities.
     */
    async clearV1PendingClarification(conversationId) {
        await this.updateCanonical(conversationId, (state) => {
            state.pendings = [];
            if (state._compat) {
                state._compat.pending_clarification = null;
            }
            return state;
        });
    }
    /**
     * V1 WRITE: Increment retry count on active pending.
     * Called AFTER V1 incrementClarificationRetry writes to extractedEntities.
     */
    async incrementV1PendingRetry(conversationId) {
        await this.updateCanonical(conversationId, (state) => {
            state.pendings = state.pendings.map((p) => p.status === 'active' ? { ...p, attempts: p.attempts + 1 } : p);
            if (state._compat?.pending_clarification) {
                state._compat.pending_clarification = {
                    ...state._compat.pending_clarification,
                    retry_count: state._compat.pending_clarification.retry_count + 1,
                };
            }
            return state;
        });
    }
    /**
     * V1 WRITE: Store previousMutation in canonical _compat.
     * Called AFTER V1 storePreviousMutation writes to extractedEntities.
     */
    async writeV1PreviousMutation(conversationId, cartSnapshot, message) {
        await this.updateCanonical(conversationId, (state) => {
            if (!state._compat) {
                state._compat = {
                    discussed_items: [], tracked_entities: [],
                    previous_mutation: null, customer_name: null, customer_phone: null,
                    pending_clarification: null,
                };
            }
            state._compat.previous_mutation = {
                cart_snapshot: cartSnapshot,
                message,
            };
            return state;
        });
    }
    /**
     * V1 WRITE: Clear previousMutation from canonical _compat.
     * Called AFTER V1 clearPreviousMutation writes to extractedEntities.
     */
    async clearV1PreviousMutation(conversationId) {
        await this.updateCanonical(conversationId, (state) => {
            if (state._compat) {
                state._compat.previous_mutation = null;
            }
            return state;
        });
    }
    /**
     * V1 WRITE: Update shipping info (recipientName, shippingAddress) in canonical
     * resolved_facts. Called as PRIMARY write (canonical is authority).
     *
     * Legacy extractedEntities compatibility: V1 path no longer writes to
     * extractedEntities for shipping info — canonical (workspace_v2) is sole authority.
     * V1 reader (conversation.service.ts:393) already reads from canonical via
     * getFactWithLegacyFallback (G2-D.2).
     */
    async writeV1ShippingInfo(conversationId, recipientName, shippingAddress) {
        const facts = {};
        if (recipientName !== undefined)
            facts.recipientName = recipientName;
        if (shippingAddress !== undefined)
            facts.shippingAddress = shippingAddress;
        if (Object.keys(facts).length > 0) {
            await this.updateResolvedFacts(conversationId, facts);
        }
    }
    /**
     * V1 WRITE: Store tracked entities in canonical _compat.
     * Called as PRIMARY write (canonical is authority).
     *
     * Legacy extractedEntities compatibility: V1 path no longer writes to
     * extractedEntities for tracked entities — canonical _compat.tracked_entities
     * is sole authority. Legacy readers should use getV1TrackedEntities() or
     * migrate to canonical.
     */
    async writeV1TrackedEntities(conversationId, entities) {
        await this.updateCanonical(conversationId, (state) => {
            if (!state._compat) {
                state._compat = {
                    discussed_items: [], tracked_entities: [],
                    previous_mutation: null, customer_name: null, customer_phone: null,
                    pending_clarification: null,
                };
            }
            // Merge: dedup by type:value, confidence wins (same semantics as V1)
            const map = new Map();
            for (const e of state._compat.tracked_entities) {
                map.set(`${e.type}:${e.value}`, e);
            }
            for (const e of entities) {
                const key = `${e.type}:${e.value}`;
                const current = map.get(key);
                if (!current || (e.confidence ?? 0) > (current.confidence ?? 0)) {
                    map.set(key, e);
                }
            }
            state._compat.tracked_entities = Array.from(map.values());
            return state;
        });
    }
    /**
     * V1 WRITE: Store discussedItems in canonical _compat + lastAmbiguousPrompt
     * in resolved_facts. Called as PRIMARY write (canonical is authority).
     *
     * Legacy extractedEntities compatibility: V1 path no longer writes to
     * extractedEntities for discussedItems — canonical _compat.discussed_items
     * is sole authority.
     */
    async writeV1DiscussedItems(conversationId, items, lastAmbiguousPrompt) {
        await this.updateCanonical(conversationId, (state) => {
            if (!state._compat) {
                state._compat = {
                    discussed_items: [], tracked_entities: [],
                    previous_mutation: null, customer_name: null, customer_phone: null,
                    pending_clarification: null,
                };
            }
            state._compat.discussed_items = items;
            if (lastAmbiguousPrompt !== undefined) {
                state.resolved_facts.lastAmbiguousPrompt = lastAmbiguousPrompt;
            }
            return state;
        });
    }
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
    async getV1ExtractedEntities(conversationId) {
        const state = await this.getCanonicalWithLegacyFallback(conversationId);
        if (!state)
            return null;
        const compat = state._compat;
        return {
            discussedItems: compat?.discussed_items ?? [],
            confirmedItems: [], // Not in canonical — CartAuthority is authority (G2-C design)
            lastAmbiguousPrompt: typeof state.resolved_facts.lastAmbiguousPrompt === 'string'
                ? state.resolved_facts.lastAmbiguousPrompt
                : null,
            recipientName: typeof state.resolved_facts.recipientName === 'string'
                ? state.resolved_facts.recipientName
                : null,
            shippingAddress: typeof state.resolved_facts.shippingAddress === 'string'
                ? state.resolved_facts.shippingAddress
                : null,
            pendingClarification: compat?.pending_clarification ?? null,
            previousMutation: compat?.previous_mutation
                ? {
                    cartSnapshot: (compat.previous_mutation.cart_snapshot ?? []),
                    message: compat.previous_mutation.message ?? '',
                }
                : null,
            trackedEntities: compat?.tracked_entities ?? [],
        };
    }
    // ──────────────────────────────────────────────────────────────────────────
    // V2 WRITE BRIDGE (G2-D.5 — V2 writers → canonical authority)
    // ──────────────────────────────────────────────────────────────────────────
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
    async saveWorkspaceV2(conversationId, workspace) {
        // 1. Persist canonical state fields (atomic CAS)
        await this.updateCanonical(conversationId, (state) => {
            // G2-D.8-RACE: merge pendings instead of replacing to preserve concurrent
            // additions. workspace.pendings is a snapshot that may be stale relative
            // to the DB state loaded by atomicCas. Merging by ID ensures no pending
            // is lost: existing pendings are preserved, workspace pendings update/add.
            const existingById = new Map(state.pendings.map((p) => [p.id, p]));
            for (const p of workspace.pendings) {
                existingById.set(p.id, p);
            }
            state.pendings = Array.from(existingById.values());
            state.resolved_facts = workspace.resolved_facts;
            if (workspace.schema_version)
                state.schema_version = workspace.schema_version;
            if (workspace.last_bot_message_type)
                state.last_bot_message_type = workspace.last_bot_message_type;
            state.options_presented = workspace.options_presented;
            state.conversation_summary = workspace.conversation_summary;
            return state;
        });
        // 2. Persist V2-specific transient (draft_cart) — adapter write to workspace_v2 JSON
        //    NOT canonical cart authority — CartAuthority owns cart (OrderItem)
        await this.updateV2Transient(conversationId, {
            draft_cart: workspace.draft_cart,
        });
    }
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
    async updateV2Transient(conversationId, transient) {
        await this.atomicCas(conversationId, 'updateV2Transient', async (row) => {
            let raw = {};
            if (row.workspace_v2 && typeof row.workspace_v2 === 'object' && !Array.isArray(row.workspace_v2)) {
                raw = { ...row.workspace_v2 };
            }
            if (transient.draft_cart !== undefined) {
                raw.draft_cart = transient.draft_cart;
            }
            const result = await prisma.conversationContext.updateMany({
                where: { conversationId, updatedAt: row.updatedAt },
                data: { workspace_v2: raw },
            });
            return { count: result.count, value: null };
        });
    }
    // ──────────────────────────────────────────────────────────────────────────
    /**
     * Reset canonical state ke default. Semua field dikembalikan ke nilai default.
     * (Untuk test dan emergency recovery.)
     */
    async resetCanonical(conversationId) {
        const result = await this.updateCanonical(conversationId, () => ({
            ...DEFAULT_CANONICAL_STATE,
        }));
        return result !== null;
    }
    /**
     * Clear specific resolved fact.
     */
    async clearFact(conversationId, key) {
        return this.updateCanonical(conversationId, (state) => {
            const { [key]: _removed, ...rest } = state.resolved_facts;
            return { ...state, resolved_facts: rest };
        });
    }
    /**
     * Clear intent.
     */
    async clearIntent(conversationId) {
        return this.updateCanonical(conversationId, (state) => ({ ...state, intent: null }));
    }
}
// ─────────────────────────────────────────────────────────────────────────────
// Singleton export
// ─────────────────────────────────────────────────────────────────────────────
export const canonicalConversationStateService = new CanonicalConversationStateService();
//# sourceMappingURL=canonical-context.service.js.map