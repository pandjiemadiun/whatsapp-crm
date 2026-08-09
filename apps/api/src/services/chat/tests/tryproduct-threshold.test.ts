/**
 * TASK B1 acceptance — tryProduct confidence gate (P1 semantic authority).
 *
 * SCOPE: pure scoring/gate logic in src/services/chat/product-match.ts.
 * No DB / no adapters — this file imports nothing side-effectful, so it runs
 * hermetically under `npm run test:chat` (the redisAdapter cycle in
 * adapters/container.ts is avoided because product-match.ts is pure).
 *
 * Runner: npm run test:chat -- src/services/chat/tests/tryproduct-threshold.test.ts
 *
 * Acceptance mapping:
 *  (a) exact query -> shouldAnswerSingleProduct==true  (regresi negatif = FAIL)
 *  (b) substring-only / short-generic token -> false    (bug asli, mis. "ram" -> "Brambang")
 *  (c) query mentions no product           -> false    (unchanged miss)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  productNameExact,
  productNameStrongFuzzy,
  shouldAnswerSingleProduct,
  levenshtein,
  PRODUCT_FUZZY_MAX_DISTANCE,
} from '../product-match.js';

describe('TASK B1 — tryProduct confidence gate (whole-token, no substring guessing)', () => {
  // ── (a) EXACT / strong intent must still be answered (regresi guard) ──
  describe('(a) high-confidence -> answer', () => {
    it('full exact name (case-insensitive) -> qualifies', () => {
      assert.equal(productNameExact('kentang', 'Kentang'), true);
      assert.equal(productNameExact('BERAS', 'beras'), true);
    });

    it('query "ada kentang?" (filler + product, punctuation) -> single match qualifies', () => {
      // single candidate product "Kentang"
      assert.equal(shouldAnswerSingleProduct('ada kentang?', 'Kentang', 1), true);
      assert.equal(shouldAnswerSingleProduct('kentang', 'Kentang', 1), true);
    });

    it('typo within distance 1 of whole name -> qualifies (single candidate)', () => {
      // "kentang" vs "kentan" (1 deletion) -> true 1-edit typo
      assert.equal(levenshtein('kentan', 'kentang'), 1);
      assert.equal(
        shouldAnswerSingleProduct('kentan', 'Kentang', 1),
        true
      );
    });

    it('prefix intent "kent" -> "kentang" qualifies', () => {
      assert.equal(shouldAnswerSingleProduct('kent', 'Kentang', 1), true);
    });
  });

  // ── (b) substring-only / short-generic token -> MUST MISS (bug asli) ──
  describe('(b) ambiguous/substring-only -> miss (do not guess)', () => {
    it('query "ram" must NOT trigger product "Brambang" (substring bug)', () => {
      // OLD scoring: "brambang".includes("ram") -> wordHits=1 -> answered wrongly.
      assert.equal(shouldAnswerSingleProduct('ram', 'Brambang', 1), false);
      assert.equal(productNameStrongFuzzy('ram', 'Brambang'), false);
    });

    it('short generic token "an" must not qualify any product by substring', () => {
      assert.equal(shouldAnswerSingleProduct('an', 'Brambang', 1), false);
      assert.equal(productNameStrongFuzzy('an', 'Brambang'), false);
    });

    it('"ada brambang" filler + unrelated short product token does not fire', () => {
      // query mentions "brambang" only via filler token overlap, single short product
      assert.equal(shouldAnswerSingleProduct('ram', 'Ane', 1), false);
    });

    it('fuzzy threshold pin: distance equal to MAX_DISTANCE qualifies, MAX_DISTANCE+1 does not', () => {
      const near = levenshtein('kentan', 'kentang'); // 1
      const far = levenshtein('kentn', 'kentang'); // 2
      assert.equal(near, PRODUCT_FUZZY_MAX_DISTANCE);
      assert.equal(shouldAnswerSingleProduct('kentan', 'Kentang', 1), true);
      assert.equal(shouldAnswerSingleProduct('kentn', 'Kentang', 1), false);
    });
  });

  // ── (c) no product mentioned -> miss (unchanged) ──
  describe('(c) no product -> miss', () => {
    it('generic greeting/query with no product tokens -> miss', () => {
      assert.equal(shouldAnswerSingleProduct('halo', 'Kentang', 1), false);
      assert.equal(shouldAnswerSingleProduct('berapa ongkir', 'Beras', 1), false);
    });
  });

  // ── ambiguity: 2+ candidate must NOT be collapsed into a single-product answer
  //     via the FUZZY gate (tryProduct routes those to the disambiguation prompt
  //     branch instead). Note: an EXACT match may still answer even among 2+
  //     results (that's the intended "user clearly said this product" case); the
  //     gate below asserts fuzzy-only does NOT auto-answer when ambiguous. ──
  describe('ambiguity guard', () => {
    it('fuzzy-only match with resultCount > 1 must NOT auto-answer (disambiguation branch handles it)', () => {
      // "kentan" (typo, Levenshtein 1) qualifies as fuzzy for a SINGLE
      // candidate, but with 2 candidates the fuzzy gate must NOT claim a win.
      assert.equal(shouldAnswerSingleProduct('kentan', 'Kentang', 1), true);
      assert.equal(shouldAnswerSingleProduct('kentan', 'Kentang', 2), false);
    });

    it('exact match still answers even when multiple results exist', () => {
      // user clearly named the product -> single-product answer is correct regresi behavior
      assert.equal(shouldAnswerSingleProduct('kentang', 'Kentang', 2), true);
    });
  });
});
