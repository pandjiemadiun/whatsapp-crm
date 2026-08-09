import { SELECTION_CONFIDENCE_THRESHOLD, CLARIFICATION_MAX_ATTEMPTS, } from './constants-v2.js';
// ─────────────────────────────────────────────────────────────────────────────
// Helpers (pure)
// ─────────────────────────────────────────────────────────────────────────────
/** Lookup satu item di katalog by nama (case-insensitive). */
function findInCatalog(catalog, name) {
    return catalog.find((c) => c.name.toLowerCase() === name.toLowerCase());
}
/** Apakah sebuah act termasuk intent cart_update? (cek X DULU untuk conflict) */
function isCartAct(act) {
    return act.intent.toLowerCase().includes('cart');
}
/** Nama produk target dari act (entitas pertama bertipe 'product'). */
function targetProduct(act) {
    return (Array.isArray(act.entities) ? act.entities : []).find((e) => e.type === 'product')?.value;
}
/**
 * Walk rantai supersede dari startId; true bila mengunjungi node berulang
 * (siklus). Logika ekuivalen planner.resolveWinner, tapi di sini hanya
 * membutuhkan deteksi siklus (I-V2-5).
 */
function inCycle(startId, supersededBy) {
    const visited = new Set();
    let current = startId;
    while (true) {
        if (visited.has(current))
            return true;
        visited.add(current);
        const next = supersededBy.get(current);
        if (!next)
            return false;
        current = next.act_id;
    }
}
/** quantifier subset yang memungkinkan affirmative aman (I-V2-2 guard). */
function hasSubsetQuantifier(q) {
    return !!q && q.resolution_type === 'subset';
}
// ─────────────────────────────────────────────────────────────────────────────
// validate
// ─────────────────────────────────────────────────────────────────────────────
export function validate(result, ctx) {
    const reasons = [];
    let retryable = false; // ada violation yang boleh di-retry
    let terminal = false; // I-V2-4 / I-V2-6 -> retryable FALSE (eskalasi / clarify)
    // Defensif pada batas boundary JSON (LLM output bisa omit field).
    const acts = Array.isArray(result.acts) ? result.acts : [];
    const unmatched = Array.isArray(result.unmatched_mentions)
        ? result.unmatched_mentions
        : [];
    const N = ctx.optionsPresented.length;
    const catalog = ctx.catalog;
    const catalogNames = new Set(catalog.map((c) => c.name.toLowerCase()));
    // Defensif: LLM bisa meng-omit/malformed isi unmatched_mentions — jangan crash.
    const unmatchedStrings = unmatched.filter((u) => typeof u === 'string');
    const unmatchedSet = new Set(unmatchedStrings.map((u) => u.toLowerCase()));
    const resultIds = new Set(acts.map((a) => a.act_id));
    // ── I-V2-9: qty ada tapi qty_source absent (runtime LLM omission guard) ──
    for (const a of acts) {
        const qs = a.qty_source;
        if (a.qty !== undefined && qs === undefined) {
            reasons.push(`I-V2-9: act ${a.act_id} punya qty tapi qty_source absent`);
            retryable = true;
        }
    }
    // ── I-V2-1: no product value left behind (product mentions) ──
    for (const a of acts) {
        for (const e of Array.isArray(a.entities) ? a.entities : []) {
            if (e.type !== 'product')
                continue; // hanya concern case dicek katalog
            // Defensif: LLM output bisa meng-omit value product entity.
            // JANGAN throw — tandai entity invalid (retryable agar LLM perbaiki).
            const v = e.value;
            if (typeof v !== 'string' || v.trim().length === 0) {
                reasons.push(`I-V2-1-invalid: entity product (act ${a.act_id}) punya value kosong/absent`);
                retryable = true;
                continue;
            }
            const vLower = v.toLowerCase();
            if (!catalogNames.has(vLower) && !unmatchedSet.has(vLower)) {
                reasons.push(`I-V2-1: mention "${v}" (act ${a.act_id}) tidak di catalog dan tidak di unmatched_mentions`);
                retryable = true;
            }
        }
    }
    // ── I-V2-2: no silent affirmation ──
    const affirmed = acts.some((a) => a.intent.toLowerCase().includes('affirmative') ||
        a.intent.toLowerCase().includes('confirm'));
    if (affirmed && N > 2 && !hasSubsetQuantifier(result.quantifier)) {
        reasons.push(`I-V2-2: affirmative/confirm pada ${N} opsi (>2) tanpa quantifier subset -> retry`);
        retryable = true;
    }
    // ── I-V2-3: kardinalitas + mismatch reason ──
    if (result.quantifier) {
        const q = result.quantifier;
        const indices = Array.isArray(q.resolved_indices)
            ? q.resolved_indices
            : [];
        // Defensif: LLM bisa omit/format aneh resolved_indices — jangan crash.
        if (!Array.isArray(q.resolved_indices)) {
            reasons.push('I-V2-3-invalid: quantifier.resolved_indices bukan array (LLM omit/malformed)');
            retryable = true;
        }
        // hitung ulang N dari optionsPresented; cek setiap resolved index dalam range
        for (const idx of indices) {
            if (idx < 0 || idx >= N) {
                reasons.push(`I-V2-3: kardinalitas mismatch — resolved index ${idx} di luar range [0,${N})`);
                retryable = true;
            }
        }
        if (q.resolution_type === 'mismatch' && !q.mismatch_reason) {
            reasons.push('I-V2-3: resolution_type=mismatch harus ada mismatch_reason');
            retryable = true;
        }
    }
    // ── I-V2-5: supersede valid (dangling + cycle), by act_id ──
    const supersededBy = new Map();
    for (const a of acts) {
        if (a.supersedes != null) {
            if (!resultIds.has(a.supersedes)) {
                reasons.push(`I-V2-5: act ${a.act_id} supersede id tidak ada: ${a.supersedes}`);
                retryable = true;
            }
            else {
                supersededBy.set(a.supersedes, a);
            }
        }
    }
    const cyclicIds = new Set();
    for (const a of acts) {
        if (inCycle(a.act_id, supersededBy))
            cyclicIds.add(a.act_id);
    }
    if (cyclicIds.size > 0) {
        reasons.push(`I-V2-5: siklus supersede terdeteksi pada ${[...cyclicIds].join(', ')}`);
        retryable = true;
    }
    // ── I-V2-6: selection confidence < threshold -> paksa clarify ──
    const sel = result.confidence ? result.confidence.selection : undefined;
    if (typeof sel === 'number' && sel < SELECTION_CONFIDENCE_THRESHOLD) {
        reasons.push(`I-V2-6: selection confidence (${sel}) < threshold ${SELECTION_CONFIDENCE_THRESHOLD} -> paksa clarify`);
        terminal = true;
    }
    // ── I-V2-8: conflicting_acts (dua cart_update produk sama, tidak saling supersede) ──
    const cartActs = acts.filter(isCartAct);
    const groups = new Map();
    for (const a of cartActs) {
        const t = targetProduct(a);
        if (!t)
            continue;
        const g = groups.get(t) ?? [];
        g.push(a);
        groups.set(t, g);
    }
    for (const [product, group] of groups) {
        if (group.length < 2)
            continue;
        const linked = group.some((a) => a.supersedes != null && group.some((b) => b.act_id === a.supersedes));
        if (!linked) {
            reasons.push(`I-V2-8: act cart_update konflik pada produk "${product}" tanpa supersedes`);
            retryable = true;
        }
    }
    // ── I-V2-4: attempts > CLARIFICATION_MAX_ATTEMPTS -> eskalasi ──
    for (const p of ctx.pendings) {
        if (p.status === 'active' && p.attempts > CLARIFICATION_MAX_ATTEMPTS) {
            reasons.push(`I-V2-4: clarification attempts (${p.attempts}) > batas ${CLARIFICATION_MAX_ATTEMPTS} -> eskalasi`);
            terminal = true;
        }
    }
    // ── I-V2-7: unmatched non-kosong wajib clarification ATAU disebut di reply_draft ──
    if (unmatchedStrings.length > 0) {
        const hasClar = !!result.clarification;
        const mentionedInReply = !!result.reply_draft &&
            unmatchedStrings.some((u) => result.reply_draft.toLowerCase().includes(u.toLowerCase()));
        if (!hasClar && !mentionedInReply) {
            reasons.push('I-V2-7: unmatched_mentions tidak kosong tanpa clarification dan tidak disebut di reply_draft');
            retryable = true;
        }
    }
    const ok = reasons.length === 0;
    // terminal (eskalasi/clarify) menang atas retryable: tidak boleh di-retry LLM.
    const finalRetryable = ok ? false : terminal ? false : retryable;
    return { ok, reasons, retryable: finalRetryable };
}
//# sourceMappingURL=validator-v2.js.map