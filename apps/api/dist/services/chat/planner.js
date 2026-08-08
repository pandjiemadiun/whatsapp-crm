// ─────────────────────────────────────────────────────────────────────────────
// Priority classification
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Urutan prioritas act berdasarkan intent (nilai rank lebih kecil = lebih penting).
 * Matching pakai substring case-insensitive atas keyword kategori.
 */
const PRIORITY_LABELS = [
    { rank: 1, keywords: ['safety', 'correction'] }, // safety / correction
    { rank: 2, keywords: ['clarif', 'question'] }, // clarification / question
    { rank: 3, keywords: ['cart', 'buy', 'order'] }, // cart_update
    { rank: 4, keywords: ['info', 'answer', 'total', 'product_'] }, // info_answer
    { rank: 5, keywords: ['recommend', 'suggest'] }, // recommendation
    { rank: 6, keywords: ['smalltalk', 'greeting'] }, // smalltalk
];
/** Default rank untuk intent yang tidak dikenali (prioritas terendah). */
const UNKNOWN_PRIORITY = 7;
/**
 * Klasifikasikan sebuah intent ke peringkat prioritas.
 */
function priorityOf(intent) {
    const i = intent.toLowerCase();
    for (const { rank, keywords } of PRIORITY_LABELS) {
        if (keywords.some((k) => i.includes(k)))
            return rank;
    }
    return UNKNOWN_PRIORITY;
}
// ─────────────────────────────────────────────────────────────────────────────
// Supersede resolution + cycle detection (by act_id)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Bangun peta: act_id yang *diganti* -> act yang *mensupersedensinya*.
 * Jika lebih dari satu act mengklaim mensupersede id yang sama, yang terakhir
 * menang (edge case; data bersih seharusnya unik).
 */
function buildSupersededBy(acts) {
    const map = new Map();
    for (const act of acts) {
        if (act.supersedes != null) {
            map.set(act.supersedes, act);
        }
    }
    return map;
}
/**
 * Ikuti rantai supersede dari `startId` ke "head"-nya (act final yang tidak
 * diganti oleh act lain). Jika walk menemukan node berulang -> siklus terdeteksi.
 *
 * Referensiri pakai act_id; tidak pernah memakai indeks array.
 */
function resolveWinner(startId, supersededBy) {
    const visited = new Set();
    let current = startId;
    while (true) {
        if (visited.has(current)) {
            return { winner: null, cyclic: true };
        }
        visited.add(current);
        const successor = supersededBy.get(current);
        if (!successor) {
            return { winner: current, cyclic: false };
        }
        current = successor.act_id;
    }
}
// ─────────────────────────────────────────────────────────────────────────────
// planActs
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Rencanakan act final dari kandidat.
 *
 * Alur:
 *   1. buildSupersededBy — peta act_id diganti -> penggantinya.
 *   2. Untuk tiap act, resolveWinner: act surviving hanya bila ia merupakan
 *      head rantai (winner === dirinya) dan tidak bersiklus.
 *   3. Urutkan survivors by priority (lihat PRIORITY_LABELS).
 *
 * Pasca-kondisi: act yang sudah di-supersede atau bersiklus TIDAK muncul
 * di output final.
 *
 * @param acts  kandidat ActV2 (urutan/sembarang; referral pakai act_id).
 * @returns     survivors yang sudah di-supersede & di-sort per prioritas.
 */
export function planActs(acts) {
    const supersededBy = buildSupersededBy(acts);
    const survivors = [];
    for (const act of acts) {
        const { winner, cyclic } = resolveWinner(act.act_id, supersededBy);
        if (!cyclic && winner === act.act_id) {
            survivors.push(act);
        }
    }
    // I13: urutan deterministik rule-based (0-LLM) sebelum ada budget LLM.
    survivors.sort((a, b) => priorityOf(a.intent) - priorityOf(b.intent));
    return survivors;
}
//# sourceMappingURL=planner.js.map