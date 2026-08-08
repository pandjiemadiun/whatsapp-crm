/**
 * Unit test — Set Operations Executor (FASE A2 / setops v3.2)
 * Runner: node:test via tsx (proyek tidak memakai jest).
 *   npx tsx --env-file=../../.env --test --test-force-exit \
 *     src/services/chat/__tests__/setops-v2.test.ts
 *
 * I8: semua test di bawah adalah 0-LLM — tidak ada panggilan model/DB.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applySetOp, } from '../setops.js';
// ─────────────────────────────────────────────────────────────────────────────
// Shared catalog (nama unik, harga & kategori bervariasi)
// ─────────────────────────────────────────────────────────────────────────────
const catalog = [
    { id: '1', name: 'Ayam Goreng', price: 15000, category: 'makanan' },
    { id: '2', name: 'Es Teh', price: 5000, category: 'minuman' },
    { id: '3', name: 'Kentang', price: 20000, category: 'makanan' },
    { id: '4', name: 'Nasi', price: 10000, category: 'makanan' },
    { id: '5', name: 'Kopi', price: 8000, category: 'minuman' },
];
function names(items) {
    return items.map((i) => i.name);
}
// ─────────────────────────────────────────────────────────────────────────────
// ALL
// ─────────────────────────────────────────────────────────────────────────────
describe('applySetOp — ALL (FASE A2)', () => {
    it('semua produk di catalog masuk matched; unmatched kosong', () => {
        const r = applySetOp({ type: 'ALL' }, catalog, [], []);
        assert.equal(r.matched.length, catalog.length);
        assert.deepEqual(names(r.matched), names(catalog));
        assert.deepEqual(r.unmatched, []);
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// MINUS
// ─────────────────────────────────────────────────────────────────────────────
describe('applySetOp — MINUS (FASE A2)', () => {
    it('MINUS(kentang): semua produk kecuali kentang masuk matched', () => {
        const op = { type: 'MINUS', names: ['Kentang'] };
        const r = applySetOp(op, catalog, [], []);
        assert.equal(r.unmatched.length, 0); // kentang ada di catalog -> tidak unmatched
        assert.equal(r.matched.length, catalog.length - 1);
        const matchedNames = names(r.matched);
        assert.equal(matchedNames.includes('Kentang'), false);
        assert.equal(matchedNames.includes('Ayam Goreng'), true);
    });
    it('MINUS nama tak ada di catalog -> masuk unmatched (JANGAN silent drop)', () => {
        const op = { type: 'MINUS', names: ['Kentang', 'Teh Manis'] };
        const r = applySetOp(op, catalog, [], []);
        assert.equal(r.unmatched.length, 1);
        assert.deepEqual(r.unmatched, ['Teh Manis']);
        assert.equal(r.matched.length, catalog.length - 1);
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// INDICES
// ─────────────────────────────────────────────────────────────────────────────
describe('applySetOp — INDICES (FASE A2)', () => {
    it('INDICES([1,3]): ambil index 1 dan 3 dari optionsPresented', () => {
        const optionsPresented = ['Ayam Goreng', 'Es Teh', 'Kentang', 'Nasi', 'Kopi'];
        const op = { type: 'INDICES', indices: [1, 3] };
        const r = applySetOp(op, catalog, optionsPresented, []);
        assert.equal(r.matched.length, 2);
        assert.deepEqual(names(r.matched), ['Es Teh', 'Nasi']);
        assert.deepEqual(r.unmatched, []);
    });
    it('INDICES index di luar jangkauan -> dilewati (tidak crash)', () => {
        const optionsPresented = ['Ayam Goreng', 'Es Teh'];
        const op = { type: 'INDICES', indices: [0, 9, 1] };
        const r = applySetOp(op, catalog, optionsPresented, []);
        assert.deepEqual(names(r.matched), ['Ayam Goreng', 'Es Teh']);
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// NAMES
// ─────────────────────────────────────────────────────────────────────────────
describe('applySetOp — NAMES (FASE A2)', () => {
    it('NAMES dengan 1 unmatched: 2 matched + 1 unmatched', () => {
        const op = {
            type: 'NAMES',
            names: ['Ayam Goreng', 'Kopi', 'Teh Manis'],
        };
        const r = applySetOp(op, catalog, [], []);
        assert.equal(r.matched.length, 2);
        assert.equal(r.unmatched.length, 1);
        assert.deepEqual(r.unmatched, ['Teh Manis']);
        assert.deepEqual(names(r.matched), ['Ayam Goreng', 'Kopi']);
    });
    it('NAMES matching case-insensitive', () => {
        const op = { type: 'NAMES', names: ['ayam goreng', 'KOPI'] };
        const r = applySetOp(op, catalog, [], []);
        assert.equal(r.matched.length, 2);
        assert.deepEqual(r.unmatched, []);
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// FILTER_CATEGORY
// ─────────────────────────────────────────────────────────────────────────────
describe('applySetOp — FILTER_CATEGORY (FASE A2)', () => {
    it('filter by kategori "minuman"', () => {
        const op = { type: 'FILTER_CATEGORY', cat: 'minuman' };
        const r = applySetOp(op, catalog, [], []);
        assert.equal(r.matched.length, 2);
        assert.deepEqual(names(r.matched), ['Es Teh', 'Kopi']);
        assert.deepEqual(r.unmatched, []);
    });
    it('filter by kategori "makanan"', () => {
        const op = { type: 'FILTER_CATEGORY', cat: 'makanan' };
        const r = applySetOp(op, catalog, [], []);
        assert.equal(r.matched.length, 3);
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// LAST_REPEAT
// ─────────────────────────────────────────────────────────────────────────────
describe('applySetOp — LAST_REPEAT (FASE A2)', () => {
    it('LAST_REPEAT: ambil dari lastSelection', () => {
        const op = { type: 'LAST_REPEAT' };
        const r = applySetOp(op, catalog, [], ['Kentang', 'Es Teh']);
        assert.equal(r.matched.length, 2);
        assert.deepEqual(names(r.matched), ['Kentang', 'Es Teh']);
        assert.deepEqual(r.unmatched, []);
    });
    it('LAST_REPEAT mengembalikan item tidak ditemukan ke unmatched', () => {
        const op = { type: 'LAST_REPEAT' };
        const r = applySetOp(op, catalog, [], ['Kentang', 'Air Putih']);
        assert.equal(r.matched.length, 1);
        assert.deepEqual(r.unmatched, ['Air Putih']);
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// FILTER_PRICE_RANK (bonus)
// ─────────────────────────────────────────────────────────────────────────────
describe('applySetOp — FILTER_PRICE_RANK (FASE A2)', () => {
    it("'cheap' mengembalikan setengah paling murah", () => {
        const op = { type: 'FILTER_PRICE_RANK', rank: 'cheap' };
        const r = applySetOp(op, catalog, [], []);
        // harga: Es Teh 5k, Kopi 8k, Nasi 10k, Ayam 15k, Kentang 20k -> 2 termurah
        assert.equal(r.matched.length, 2);
        assert.deepEqual(names(r.matched), ['Es Teh', 'Kopi']);
    });
    it("'expensive' mengembalikan setengah paling mahal", () => {
        const op = { type: 'FILTER_PRICE_RANK', rank: 'expensive' };
        const r = applySetOp(op, catalog, [], []);
        // 5 item -> mid=2 -> slice(2) = Nasi, Ayam, Kentang
        assert.equal(r.matched.length, 3);
        assert.deepEqual(names(r.matched), ['Nasi', 'Ayam Goreng', 'Kentang']);
    });
});
//# sourceMappingURL=setops-v2.test.js.map