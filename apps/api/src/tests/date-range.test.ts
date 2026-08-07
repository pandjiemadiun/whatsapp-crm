import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseLocalDay, localDayKey, buildLocalDayKeys } from '../utils/date-range.js';

// ============================================================
// Unit tests — utils/date-range.ts (fix 1.9.6)
// Runner: npx tsx --test --test-force-exit src/tests/date-range.test.ts
//
// Melindungi dua bug yang sudah diperbaiki:
//  1. parseLocalDay: filter from/to harus LOCAL start/end-of-day (bukan UTC),
//     sehingga record pagi hari (zona +7) tidak hilang.
//  2. localDayKey: grouping trend tidak boleh pindah hari karena toISOString()/UTC.
// ============================================================

describe('parseLocalDay', () => {
  test('start-of-day: from=2026-08-01 → 2026-08-01T00:00:00.000 (local server)', () => {
    const dt = parseLocalDay('2026-08-01', false);
    assert.equal(dt.getFullYear(), 2026);
    assert.equal(dt.getMonth(), 7); // 0-based → Agustus
    assert.equal(dt.getDate(), 1);
    assert.equal(dt.getHours(), 0);
    assert.equal(dt.getMinutes(), 0);
    assert.equal(dt.getSeconds(), 0);
    assert.equal(dt.getMilliseconds(), 0);
  });

  test('end-of-day: to=2026-08-01 → 2026-08-01T23:59:59.999 (local server)', () => {
    const dt = parseLocalDay('2026-08-01', true);
    assert.equal(dt.getFullYear(), 2026);
    assert.equal(dt.getMonth(), 7);
    assert.equal(dt.getDate(), 1);
    assert.equal(dt.getHours(), 23);
    assert.equal(dt.getMinutes(), 59);
    assert.equal(dt.getSeconds(), 59);
    assert.equal(dt.getMilliseconds(), 999);
  });

  test('inclusive: record UTC di dalam hari yang sama masuk rentang from/to', () => {
    // Server di UTC: record 2026-08-01T00:30Z adalah 00:30 pagi hari itu.
    const record = new Date('2026-08-01T00:30:00Z');
    const start = parseLocalDay('2026-08-01', false);
    const end = parseLocalDay('2026-08-01', true);
    assert.ok(record >= start, 'record pagi harus >= start-of-day');
    assert.ok(record <= end, 'record pagi harus <= end-of-day');
  });

  test('inclusive: record tepat di batas start/end masih masuk', () => {
    const start = parseLocalDay('2026-08-01', false);
    const end = parseLocalDay('2026-08-01', true);
    // tepat di 00:00:00.000 → gte → masuk
    assert.ok(new Date('2026-08-01T00:00:00.000Z') >= start);
    // tepat di 23:59:59.999 → lte → masuk
    assert.ok(new Date('2026-08-01T23:59:59.999Z') <= end);
  });

  test('format tanggal lain → fallback ke new Date(v)', () => {
    // String yang bukan YYYY-MM-DD prefix → fallback parser default.
    const dt = parseLocalDay('2026/08/01', false);
    assert.ok(dt instanceof Date);
    assert.ok(!isNaN(dt.getTime()));
  });

  test('from=today & to=today mengembalikan rentang 24 jam penuh (inclusive)', () => {
    const start = parseLocalDay('2026-08-01', false).getTime();
    const end = parseLocalDay('2026-08-01', true).getTime();
    const dayMs = 24 * 60 * 60 * 1000;
    // selisih harus < 1 hari + epsilon (23:59:59.999 - 00:00:00.000)
    assert.ok(end - start < dayMs);
    assert.ok(end - start > dayMs - 1000);
  });
});

describe('localDayKey', () => {
  test('tidak pindah hari untuk record malam WIB (UTC+7)', () => {
    // Record dibuat jam 23:30 WIB = 16:30 UTC hari yang sama.
    const recordWib = new Date('2026-08-01T16:30:00Z'); // 2026-08-01 23:30 WIB
    // Server UTC: getDate() = 1 Agustus → key tetap 2026-08-01.
    assert.equal(localDayKey(recordWib), '2026-08-01');
  });

  test('pad zero: bulan & tanggal satu digit', () => {
    assert.equal(localDayKey(new Date(2026, 0, 5)), '2026-01-05');
    assert.equal(localDayKey(new Date(2026, 11, 31)), '2026-12-31');
  });

  test('buildLocalDayKeys menghasilkan N key berurutan', () => {
    const since = new Date(2026, 7, 1); // 1 Agustus 2026 local
    const keys = buildLocalDayKeys(since, 3);
    assert.deepEqual(keys, ['2026-08-01', '2026-08-02', '2026-08-03']);
  });
});
