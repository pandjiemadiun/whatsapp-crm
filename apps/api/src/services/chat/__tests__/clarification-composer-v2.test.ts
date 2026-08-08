/**
 * Unit test — Clarification Composer (FASE B2)
 * Runner: node:test via tsx (proyek tidak memakai jest).
 *   npx tsx --env-file=../../.env --test --test-force-exit \
 *     src/services/chat/__tests__/clarification-composer-v2.test.ts
 *
 * I8: semua test di bawah adalah 0-LLM — tidak ada panggilan model/DB;
 *     hanya memverifikasi format string clarification per attempt.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { composeClarification } from '../clarification-composer.js';
import type { ClarificationV2 } from '../types-v2.js';

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

function makeClar(overrides: Partial<ClarificationV2> = {}): ClarificationV2 {
  return {
    question: 'Mau pesan apa?',
    options: ['Ayam Goreng', 'Es Teh'],
    expected_type: 'choice',
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Attempt 1 — klarifikasi normal
// ─────────────────────────────────────────────────────────────────────────────

describe('composeClarification — attempt 1 (FASE B2)', () => {
  it('attempt 1 dengan options → mengandung question + list opsi', () => {
    const r = composeClarification(makeClar(), 1);
    assert.equal(r.includes('Mau pesan apa?'), true);
    assert.equal(r.includes('Ayam Goreng'), true);
    assert.equal(r.includes('Es Teh'), true);
    assert.equal(r.includes('1.'), true);
    assert.equal(r.includes('2.'), true);
  });

  it('attempt 1 tanpa options → hanya question', () => {
    const r = composeClarification(makeClar({ options: [] }), 1);
    assert.equal(r, 'Mau pesan apa?');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Attempt 2 — berubah bentuk
// ─────────────────────────────────────────────────────────────────────────────

describe('composeClarification — attempt 2 (FASE B2)', () => {
  it('attempt 2 → BERBEDA dari attempt 1 (tidak mengulang question)', () => {
    const r1 = composeClarification(makeClar(), 1);
    const r2 = composeClarification(makeClar(), 2);
    assert.notEqual(r1, r2);
    assert.equal(r2.includes('Mau pesan apa?'), false); // tidak mengulang question
    assert.equal(r2.includes('Masih b'), true); // gaya baru: "Masih b..."
  });

  it('attempt 2 → menawarkan default/jalan keluar (paling laris / sebut nomor)', () => {
    const r = composeClarification(makeClar(), 2);
    assert.equal(r.includes('paling laris'), true);
    assert.equal(r.includes('nomor'), true);
    assert.equal(r.includes('batal'), true);
  });

  it('attempt 2 + context.topProduct → menawarkan produk spesifik', () => {
    const r = composeClarification(makeClar(), 2, { topProduct: 'Es Teh' });
    assert.equal(r.includes('Es Teh'), true);
    assert.equal(r.includes('pilihkan'), true);
  });

  it('attempt 2 expected_type=choice → output beda dari expected_type=affirmative', () => {
    const choiceMsg = composeClarification(
      makeClar({ expected_type: 'choice' }),
      2
    );
    const affMsg = composeClarification(
      makeClar({ expected_type: 'affirmative' }),
      2
    );
    assert.notEqual(choiceMsg, affMsg);
    // choice: menawarkan "paling laris"; affirmative: menawarkan "iya"/"tidak"/"batal"
    assert.equal(choiceMsg.includes('paling laris'), true);
    assert.equal(affMsg.includes('iya') || affMsg.includes('tidak'), true);
    assert.equal(choiceMsg.includes('iya'), false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Attempt >= 3 — fallback
// ─────────────────────────────────────────────────────────────────────────────

describe('composeClarification — attempt 3+ (FASE B2)', () => {
  it('attempt 3 → fallback message', () => {
    const r = composeClarification(makeClar(), 3);
    assert.equal(r, 'Sepertinya saya kurang paham, mau saya bantu manual?');
  });

  it('attempt > 3 → tetap fallback (defensive)', () => {
    const r = composeClarification(makeClar(), 5);
    assert.equal(r, 'Sepertinya saya kurang paham, mau saya bantu manual?');
  });
});
