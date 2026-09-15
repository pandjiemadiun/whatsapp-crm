/**
 * Circuit Breaker Double-Count Fix Test (TASK: FIX-CIRCUIT-BREAKER-DOUBLE-COUNT)
 *
 * Sebelum fix: message-processor.service.ts:268 memanggil recordFailure()
 * secara eksplisit di catch block, SELAIN recordFailure() yang sudah ada
 * di dalam CircuitBreakerService.wrap(). Ini menyebabkan double-count:
 * 1 kegagalan asli → failureCount naik 2 → circuit terbuka setelah 1 failure.
 *
 * Setelah fix: recordFailure() hanya dipanggil sekali di wrap(). Circuit
 * seharusnya tetap CLOSED setelah 1 failure, dan baru terbuka setelah
 * failureThreshold (2) failures.
 *
 * Test ini memverifikasi perilaku wrap() yang benar — tanpa bergantung
 * pada message-processor.service.ts (unit test isolasi untuk
 * CircuitBreakerService).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CircuitBreakerService } from '../../circuit-breaker.service.js';

describe('CircuitBreakerService — double-count fix', () => {
  let cb: CircuitBreakerService;

  beforeEach(() => {
    cb = new CircuitBreakerService('test-llm', {
      failureThreshold: 2,
      cooldownMs: 60_000,
      halfOpenSuccessThreshold: 1,
    });
  });

  it('FAIL-SELF-FIX: 1 kegagalan di wrap() → circuit tetap CLOSED (failureCount=1, not 2)', async () => {
    // Simulate 1 LLM failure via wrap()
    try {
      await cb.wrap(() => Promise.reject(new Error('LLM timeout')));
    } catch (e) {
      // expected — error rethrown
    }

    const metrics = cb.getMetrics();
    assert.equal(metrics.state, 'closed', 'Circuit harus tetap CLOSED setelah 1 failure (bukan open)');
    assert.equal(metrics.failureCount, 1, 'failureCount harus 1, bukan 2 (double-count sudah dihapus)');
  });

  it('FAIL-SELF-FIX: 2 kegagalan berturut-turuh di wrap() → circuit terbuka (OPEN)', async () => {
    // Failure 1
    try {
      await cb.wrap(() => Promise.reject(new Error('LLM failure 1')));
    } catch { /* expected */ }
    assert.equal(cb.getMetrics().state, 'closed', 'Setelah 1 failure: masih CLOSED');

    // Failure 2
    try {
      await cb.wrap(() => Promise.reject(new Error('LLM failure 2')));
    } catch { /* expected */ }
    assert.equal(cb.getMetrics().state, 'open', 'Setelah 2 failure: harus OPEN (failureThreshold tercapai)');
    assert.equal(cb.getMetrics().failureCount, 0, 'setelah trip(), failureCount reset ke 0');
  });

  it('FAIL-SELF-FIX: isAvailable() mengembalikan false saat circuit terbuka', async () => {
    try {
      await cb.wrap(() => Promise.reject(new Error('fail 1')));
    } catch { /* expected */ }
    assert.equal(cb.isAvailable(), true, 'Setelah 1 failure: masih available');

    try {
      await cb.wrap(() => Promise.reject(new Error('fail 2')));
    } catch { /* expected */ }
    assert.equal(cb.isAvailable(), false, 'Setelah 2 failure: circuit terbuka, tidak available');
  });
});
