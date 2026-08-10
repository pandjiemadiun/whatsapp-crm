import { DEFERRED_AUTO_DROP_TURNS, SELECTION_CONFIDENCE_THRESHOLD, } from './constants-v2.js';
// ─────────────────────────────────────────────────────────────────────────────
// Load / Save (JSON <-> WorkspaceV2)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Parse JSON string menjadi WorkspaceV2.
 * Defensif pada batas boundary JSON: bidang struktural (array/object)
 * di-defaultkan agar tidak crash bila storage data parsial.
 */
export function loadWorkspace(json) {
    const parsed = JSON.parse(json);
    return {
        schema_version: parsed.schema_version ?? '',
        conversation_summary: parsed.conversation_summary ?? '',
        pendings: parsed.pendings ?? [],
        draft_cart: parsed.draft_cart ?? [],
        resolved_facts: parsed.resolved_facts ?? {},
        options_presented: parsed.options_presented ?? [],
        ...(parsed.last_bot_message_type
            ? { last_bot_message_type: parsed.last_bot_message_type }
            : {}),
    };
}
/**
 * Serialisasi WorkspaceV2 ke JSON string (untuk persist caller).
 */
export function saveWorkspace(ws) {
    return JSON.stringify(ws);
}
// ─────────────────────────────────────────────────────────────────────────────
// Pending clarification access
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Dapatkan daftar pending, opsional difilter per status.
 */
export function getPendings(ws, status) {
    if (status)
        return ws.pendings.filter((p) => p.status === status);
    return ws.pendings;
}
/**
 * Parkirkan (store) sebuah pending baru ke workspace.
 * Mutasi in-place pada ws.pendings; mengembalikan ws untuk chaining.
 */
export function parkPending(ws, pending) {
    ws.pendings.push(pending);
    return ws;
}
/**
 * Aktifkan kembali pending yang 'deferred' -> status 'active'.
 */
export function resumePending(ws, id) {
    const p = findPending(ws, id);
    if (p)
        p.status = 'active';
    return p;
}
/**
 * Tandai pending sebagai 'resolved' (jawaban ditemukan). I10: tidak perlu LLM.
 */
export function resolvePending(ws, id) {
    const p = findPending(ws, id);
    if (p)
        p.status = 'resolved';
    return p;
}
/**
 * Tandai pending sebagai 'dropped' (dibiarkan / timeout). I13.
 */
export function dropPending(ws, id) {
    const p = findPending(ws, id);
    if (p)
        p.status = 'dropped';
    return p;
}
/**
 * Increment counter `attempts` pada pending dengan id tertentu.
 */
export function incrementAttempts(ws, id) {
    const p = findPending(ws, id);
    if (p)
        p.attempts += 1;
    return p;
}
/**
 * Increment counter `deferred_turns` pada pending.
 */
export function incrementDeferredTurns(ws, id) {
    const p = findPending(ws, id);
    if (p)
        p.deferred_turns += 1;
    return p;
}
/**
 * Apakah pending harus otomatis di-drop?
 * I13: ambang ditentukan oleh DEFERRED_AUTO_DROP_TURNS.
 */
export function shouldAutoDrop(pending) {
    return pending.deferred_turns >= DEFERRED_AUTO_DROP_TURNS;
}
function findPending(ws, id) {
    return ws.pendings.find((p) => p.id === id);
}
// ─────────────────────────────────────────────────────────────────────────────
// Draft cart access
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Ekstrak nama produk dari act (entitas pertama bertipe 'product').
 */
function extractProductName(act) {
    const productEntity = act.entities.find((e) => e.type === 'product');
    return productEntity?.value ?? '';
}
/**
 * Tambahkan act sebagai draft cart op.
 * I13: status 'confirmed' hanya bila confidence >= SELECTION_CONFIDENCE_THRESHOLD;
 *      di bawah ambang -> 'needs_clarification' (draft belum dieksekusi).
 * I15: draft belum diverifikasi ke DB — validation ke DB dilakukan di stage terpisah.
 */
export function addToDraft(ws, act) {
    const op = {
        action: act.intent === 'remove' ? 'remove' : 'add',
        product: extractProductName(act),
        qty: act.qty ?? 1,
        qty_source: act.qty_source,
        status: act.confidence >= SELECTION_CONFIDENCE_THRESHOLD
            ? 'confirmed'
            : 'needs_clarification',
    };
    ws.draft_cart.push(op);
    return op;
}
/**
 * Konfirmasi (flip status) sebuah draft item ke 'confirmed' berdasarkan index.
 */
export function confirmDraftItem(ws, index) {
    const op = ws.draft_cart[index];
    if (op)
        op.status = 'confirmed';
    return op;
}
// ─────────────────────────────────────────────────────────────────────────────
// Resolved facts
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Simpan fakta terselesaikan (key/value) ke resolved_facts.
 */
export function setFact(ws, key, value) {
    ws.resolved_facts[key] = value;
    return ws;
}
/**
 * Ambil fakta yang pernah diselesaikan (undefined bila belum ada).
 */
export function getFact(ws, key) {
    return ws.resolved_facts[key];
}
// ─────────────────────────────────────────────────────────────────────────────
// Last bot message bookkeeping
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Catat tipe pesan bot terakhir + opsi yang disajikan (ditambahkan ke history).
 * I8: 0-LLM bookkeeping — hanya mencatat, mengirim tidak dilakukan di sini.
 */
export function setLastBotMessage(ws, type, options) {
    ws.last_bot_message_type = type;
    if (options.length > 0)
        ws.options_presented.push(options);
    return ws;
}
// ─────────────────────────────────────────────────────────────────────────────
// Conversation summary
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Dapatkan ringkasan percakapan.
 */
export function getSummary(ws) {
    return ws.conversation_summary;
}
/**
 * Perbarui ringkasan percakapan.
 */
export function setSummary(ws, summary) {
    ws.conversation_summary = summary;
    return ws;
}
// ─────────────────────────────────────────────────────────────────────────────
// v1 legacy -> v2 migration (T3 fix, P3.2)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Cek apakah legacy extractedEntities masih "ada isi" yang perlu dimigrasi ke v2.
 * Hanya migrasi bila ada confirmedItems atau pendingClarification — field in-itu
 * yang punya padanan v2 (draft_cart / pendings). Field lain (recipientName,
 * shippingAddress, discussedItems) tidak beralih otomatis pada turn pertama
 * kecuali memang ada keranjang/klarifikasi untuk dilanjutkan.
 */
export function hasLegacyState(legacy) {
    if (!legacy || typeof legacy !== 'object')
        return false;
    const hasCart = Array.isArray(legacy.confirmedItems) && legacy.confirmedItems.length > 0;
    const hasPending = !!legacy.pendingClarification;
    return hasCart || hasPending;
}
/**
 * Ambil opsi clarification sebagai string[] (v2 PendingV2.options).
 * Legacy bisa simpan opsi sebagai ClarificationOption[] (object) atau rawOptions
 * (string[], backward compat). Normalisasi ke string label.
 */
function clarificationOptionsToStrings(pc) {
    const rawOptions = pc.rawOptions;
    if (Array.isArray(rawOptions)) {
        return rawOptions.filter((s) => typeof s === 'string');
    }
    if (Array.isArray(pc.options)) {
        return pc.options
            .map((o) => typeof o === 'string' ? o : (o?.label ?? o?.id ?? ''))
            .filter((s) => s.length > 0);
    }
    return [];
}
/**
 * Coerce legacy qty (string|number|null) ke number positif.
 */
function coerceQty(qty) {
    if (typeof qty === 'number' && !isNaN(qty) && qty > 0)
        return qty;
    if (typeof qty === 'string') {
        const n = Number(qty.replace(/[^\d.]/g, ''));
        if (!isNaN(n) && n > 0)
            return n;
    }
    return 1;
}
/**
 * Migrasi satu arah: legacy ExtractedEntities (kolom `extractedEntities`) ke
 * WorkspaceV2 (kolom `workspace_v2`).
 *
 * Pemetaan (T3 fix — P3.2):
 *   - confirmedItems  -> draft_cart   (action:'add', status:'confirmed', qty_source:'default')
 *   - pendingClarification -> pendings  (status:'active'; question/options/asked_at/retry_count
 *                                       dipetakan ke PendingV2; retry_count -> attempts)
 *   - recipientName / shippingAddress / lastAmbiguousPrompt -> resolved_facts
 *     (v2 tidak punya slot eksplisit; masukkan ke resolved_facts yang generik)
 * Field tanpa padanan (discussedItems, previousMutation) tidak dipetakan —
 * biarkan default kosong.
 *
 * PURE: tidak ada I/O; dipanggil di titik baca conversation.service.ts:141.
 * Hasil mapping ini kemudian di-persist ke `workspace_v2` oleh caller agar turn
 * berikutnya pakai workspace_v2 sebagai sumber kebenaran (tidak re-map legacy).
 */
export function mapLegacyEntitiesToWorkspace(legacy) {
    const pendings = [];
    if (legacy.pendingClarification) {
        const pc = legacy.pendingClarification;
        pendings.push({
            id: pc.id || `migrate:${pc.asked_at}`,
            question: pc.question,
            options: clarificationOptionsToStrings(pc),
            status: 'active',
            attempts: typeof pc.retry_count === 'number' ? pc.retry_count : 0,
            deferred_turns: 0,
            asked_at: pc.asked_at,
        });
    }
    const draft_cart = (legacy.confirmedItems || []).map((it) => ({
        action: 'add',
        product: it.product,
        qty: coerceQty(it.qty),
        qty_source: 'default',
        status: 'confirmed',
    }));
    const resolved_facts = {};
    if (legacy.recipientName)
        resolved_facts.recipientName = legacy.recipientName;
    if (legacy.shippingAddress)
        resolved_facts.shippingAddress = legacy.shippingAddress;
    if (legacy.lastAmbiguousPrompt)
        resolved_facts.lastAmbiguousPrompt = legacy.lastAmbiguousPrompt;
    return {
        schema_version: '',
        conversation_summary: '',
        pendings,
        draft_cart,
        resolved_facts,
        options_presented: [],
    };
}
//# sourceMappingURL=workspace.js.map