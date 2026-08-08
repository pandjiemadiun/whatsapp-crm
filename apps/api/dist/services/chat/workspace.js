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
//# sourceMappingURL=workspace.js.map