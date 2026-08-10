/**
 * Golden Dataset Integration Test
 *
 * Runner: npx tsx --env-file=../../.env --test --test-force-exit src/tests/golden-dataset.test.ts
 *
 * 10 permanent test cases covering the 5-stage chat-flow pipeline:
 *   Stage 1 — Resolver (pending-clarification, 0 LLM)
 *   Stage 2 — Normalizer (typo + I12 product-preservation guard, 0 LLM)
 *   Stage 3 — Tier (rule-based fast-path, 0 LLM)
 *   Stage 4 — Interpreter (≤1 LLM via groqAdapter.generate)
 *   Stage 5 — Dead-end (HUMAN fallback)
 *
 * Mocks:
 *   - groqAdapter.generate → canned JSON (I8: max 1 LLM per turn)
 *   - orderService.detectDoneOrdering → false (prevents finalizeDraftOrder side-effects)
 *   - adapters.logger.info → captures 'Pipeline audit' entries
 */
export {};
//# sourceMappingURL=golden-dataset.test.d.ts.map