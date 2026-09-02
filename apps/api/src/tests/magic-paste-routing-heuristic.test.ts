/**
 * Tests for the multi-line routing heuristic in ProductsPage.tsx.
 *
 * The heuristic distinguishes:
 *  - 'single' = ONE product with per-line option+price variants
 *  - 'batch' = MULTIPLE independent products
 *
 * Since the classifier is embedded in ProductsPage.tsx (not exported), this test
 * replicates the logic to document and verify expected behavior.
 *
 * Runner: npx tsx --env-file=../../.env --test --test-force-exit src/tests/magic-paste-routing-heuristic.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Replicate the heuristic from ProductsPage.tsx
const PRICE_RE = /\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?|\d+\s*(?:K|rb|ribu|M|juta)/i;
const VARIANT_LINE_RE = /^\s*(\S{1,15})\s+(\d[\d.,]*)\s*$/;

function hasPrice(line: string): boolean {
  return PRICE_RE.test(line);
}
function looksLikeVariantLine(line: string): boolean {
  return VARIANT_LINE_RE.test(line);
}
function classifyMultiLineIntent(lines: string[]): 'single' | 'batch' {
  if (lines.length <= 1) return 'single';
  const [first, ...rest] = lines;
  if (hasPrice(first)) return 'batch';
  const variantLineCount = rest.filter(looksLikeVariantLine).length;
  return variantLineCount >= 2 ? 'single' : 'batch';
}

function classify(text: string): 'single' | 'batch' {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  return classifyMultiLineIntent(lines);
}

describe('Multi-line routing heuristic (ProductsPage.tsx)', () => {
  test('Owner multi-line (name + S/M/L/weight) → single', () => {
    assert.equal(classify('Baju kaos polos\nS 10.000\nM 20.000\nL 30.000\nBerat 100gram'), 'single');
  });

  test('Genuine batch (3 unrelated products) → batch', () => {
    assert.equal(classify('Nasi goreng 15000\nMie goreng 18000\nEs teh 5000'), 'batch');
  });

  test('Single line → single', () => {
    assert.equal(classify('Baju kaos polos S 10.000 M 20.000 L 30.000'), 'single');
  });

  test('Header + color variants → single', () => {
    assert.equal(classify('Kaos warna\nmerah 25000\nbiru 30000\nhijau 28000'), 'single');
  });

  test('First line has price → batch (even if rest look like variants)', () => {
    assert.equal(classify('Produk A 5000\nS 10000\nM 20000'), 'batch');
  });

  test('Only 1 variant-like line → batch (below threshold)', () => {
    assert.equal(classify('Baju\nS 10000'), 'batch');
  });

  test('Empty lines are ignored', () => {
    assert.equal(classify('Baju kaos\n\nS 10000\n\nM 20000\n'), 'single');
  });
});
