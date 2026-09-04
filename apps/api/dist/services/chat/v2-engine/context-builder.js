/**
 * V2 Engine — Context Assembly Layer
 *
 * Standalone utility: buildLLMContext().
 * No wiring to interpreter.ts / reasoning.ts / fallback.service.ts.
 *
 * Implements Part 3 of CHAT-ENGINE-V2-DESIGN-P1.md:
 *  - Sliding window (MAX_TURNS = 10)
 *  - Workspace_v2 state injection
 *  - 3-layer format: state → history → current message
 */
// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
export const MAX_TURNS = 10; // 5 pairs user+assistant
// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────
export function buildLLMContext({ recentHistory, workspace, customerMessage, }) {
    const parts = [];
    // Layer 2: Workspace state (ground truth)
    parts.push('=== STATE PERCAKAPAN (lupakan pesan lama, ini yang penting) ===');
    if (workspace.conversation_summary) {
        parts.push(`Ringkasan: ${workspace.conversation_summary}`);
    }
    if (Object.keys(workspace.resolved_facts).length > 0) {
        parts.push(`Fakta yang sudah diketahui: ${JSON.stringify(workspace.resolved_facts)}`);
    }
    if (workspace.draft_cart.length > 0) {
        parts.push(`Keranjang saat ini: ${JSON.stringify(workspace.draft_cart)}`);
    }
    const activePendings = workspace.pendings.filter((p) => p.status === 'active');
    if (activePendings.length > 0) {
        parts.push(`Clarification aktif: ${activePendings.map((p) => p.question).join('; ')}`);
    }
    if (workspace.options_presented.length > 0) {
        parts.push(`Opsi yang sudah ditampilkan: ${JSON.stringify(workspace.options_presented.slice(-3))}`);
    }
    // Layer 1: Recent history (sliding window)
    const trimmedHistory = recentHistory.slice(-MAX_TURNS);
    parts.push(`=== PERCAKAPAN TERBARU (max ${MAX_TURNS} turn) ===`);
    for (const turn of trimmedHistory) {
        parts.push(`${turn.role === 'user' ? 'Customer' : 'Assistant'}: ${turn.content}`);
    }
    // Layer 3: Current message
    parts.push('=== PESAN SEKARANG ===');
    parts.push(`Customer: ${customerMessage}`);
    return parts.join('\n');
}
//# sourceMappingURL=context-builder.js.map