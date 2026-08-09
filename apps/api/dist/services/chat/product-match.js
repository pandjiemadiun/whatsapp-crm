// ─────────────────────────────────────────────────────────────────────────────
// TASK B1 — Pure product-name match scoring helpers (P1: semantic authority).
//
// WHY A SEPARATE MODULE: these helpers are pure (no DB / no I/O) so they can
// be unit-tested standalone under `npm run test:chat` without importing
// fallback.service.ts (which transitively initializes the adapters/redis/prisma
// singletons and triggers a module-load cycle). Extraction keeps the chat
// engine test runner hermetic.
//
// Semantics (RAILS.md §2 / §3): a 0-LLM fast tier may ONLY answer when it is
// HIGH-CONFIDENCE the user meant the product. We deliberately use WHOLE-TOKEN
// comparison (NOT substring), so a short/generic query token that merely
//   appears inside an unrelated product name (e.g. "ram" ⊂ "Brambang") does NOT
//   qualify -> MISS -> forwarded to reasoning.ts (LLM).
// ─────────────────────────────────────────────────────────────────────────────
// (a) Score for a whole-token exact match (query trimmed === product name).
// This is the "definitely meant this product" signal -> allowed to answer.
export const PRODUCT_MATCH_EXACT_THRESHOLD = 4;
// (b) Levenshtein distance (inclusive) below which a product name is "very close"
// to the query (a typo of the whole name). 1 tolerates a single
// insert/delete/substitute — the documented fuzzy rule "≤ 1".
export const PRODUCT_FUZZY_MAX_DISTANCE = 1;
// Minimum ratio of WHOLE query word-tokens that may match a name token for a
// fuzzy qualification.
export const PRODUCT_FUZZY_TOKEN_RATIO = 0.9;
export function levenshtein(a, b) {
    const m = a.length;
    const n = b.length;
    if (m === 0)
        return n;
    if (n === 0)
        return m;
    let prev = 0;
    let cur = new Array(n + 1).fill(0);
    let tmp;
    for (let j = 0; j <= n; j++)
        cur[j] = j;
    for (let i = 1; i <= m; i++) {
        prev = cur[0];
        cur[0] = i;
        for (let j = 1; j <= n; j++) {
            tmp = cur[j];
            cur[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, cur[j - 1], cur[j]);
            prev = tmp;
        }
    }
    return cur[n];
}
// Tokens are punctuation-insensitive and length>1 so tiny generic tokens
// (e.g. "an", "ab") can never be a whole-token match by accident.
export function tokenizeText(text) {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 1);
}
// (a) Exact whole-name equality (case- & punctuation-insensitive).
export function productNameExact(query, name) {
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
    return norm(query) === norm(name);
}
// (b) Strong fuzzy: very close to the product name via any of three signals
//   - typo of the whole name within the distance threshold, OR
//   - prefix intent (query is the name's first chars, or vice-versa), OR
//   - EVERY whole NAME token is present as a whole QUERY token
//     (the query "refers to" the product — e.g. "ada kentang?" -> "kentang").
//     Whole-token, NOT substring: "ram" is NOT a token of "Brambang".
export function productNameStrongFuzzy(query, name) {
    const q = query.trim().toLowerCase();
    const lower = name.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
    if (q.length < 2 || lower.length < 2)
        return false;
    // (b-i) typo of the whole name within the distance threshold.
    if (levenshtein(q, lower) <= PRODUCT_FUZZY_MAX_DISTANCE)
        return true;
    // (b-ii) prefix intent: query is the first chars of the name, or vice-versa
    // (covers "kent" -> "kentang" and trailing "?" already stripped here).
    if (lower.startsWith(q) || q.startsWith(lower))
        return true;
    // (b-iii) token-level: every whole NAME token is present as a whole QUERY
    // token, so "ada kentang?" -> "kentang" qualifies, but a mere substring like
    // "ram" in "brambang" has no whole-token equality -> does NOT qualify.
    const nameTokens = tokenizeText(lower);
    const qTokens = tokenizeText(q);
    if (nameTokens.length > 0 && qTokens.length > 0) {
        if (nameTokens.every((t) => qTokens.includes(t)))
            return true;
    }
    return false;
}
/**
 * Decision the single-match branch of tryProduct uses, exported so the
 * acceptance tests can assert the exact gate without touching tryProduct's
 * private/DB-coupled body.
 *   query        normalized message text
 *   name         candidate product name
 *   resultCount  number of products returned by search (1 = single candidate)
 */
export function shouldAnswerSingleProduct(query, name, resultCount) {
    const q = query.trim().toLowerCase();
    // (a) exact whole-token match of the full name
    if (productNameExact(q, name))
        return true;
    // (b) strong fuzzy, ONLY when this is the single candidate product
    if (resultCount === 1 && productNameStrongFuzzy(q, name))
        return true;
    // (c) otherwise substring-only / weak word-hit -> do NOT answer -> MISS -> LLM
    return false;
}
export default {
    productNameExact,
    productNameStrongFuzzy,
    shouldAnswerSingleProduct,
    levenshtein,
    tokenizeText,
};
//# sourceMappingURL=product-match.js.map