/**
 * Unit Tests — WhatsApp Pipeline Services
 * Runner: npx tsx --env-file=../../.env --test --test-force-exit src/tests/pipeline.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isDeadEnd, isUrgent, messageQueueService, type QueuedMessage } from '../services/message-queue.service.js';
import { CircuitBreakerService } from '../services/circuit-breaker.service.js';
import { presenceSimulatorService } from '../services/presence-simulator.service.js';
import { healthMonitorService } from '../services/health-monitor.service.js';

describe('isDeadEnd', () => {
  test('positive: sapaan penutup', () => {
    assert.equal(isDeadEnd('ok'), true);
    assert.equal(isDeadEnd('oke'), true);
    assert.equal(isDeadEnd('terima kasih'), true);
    assert.equal(isDeadEnd('👍'), true);
    assert.equal(isDeadEnd('✅'), true);
    assert.equal(isDeadEnd('baik sudah'), true);
  });

  test('negative: pertanyaan produk', () => {
    assert.equal(isDeadEnd('berapa harga sepatu ini?'), false);
    assert.equal(isDeadEnd('saya mau beli sepatu size 42'), false);
    assert.equal(isDeadEnd(''), false);
  });
});

describe('isUrgent', () => {
  test('positive: kata kunci urgent', () => {
    assert.equal(isUrgent('saya ingin transfer ke manager'), true);
    assert.equal(isUrgent('komplain tentang pelayanan'), true);
    assert.equal(isUrgent('urgen banget ini'), true);
    assert.equal(isUrgent('transaksi terblokir'), true);
  });

  test('negative: pertanyaan normal', () => {
    assert.equal(isUrgent('berapa harga?'), false);
    assert.equal(isUrgent('saya mau beli'), false);
  });
});

describe('MessageQueueService', () => {
  test('dedup: duplicate messageId dihapus', () => {
    const msgId = 'test-msg-1';
    assert.equal(messageQueueService.isDuplicate(msgId), false);
    // Insert kedua — harus duplicate
    assert.equal(messageQueueService.isDuplicate(msgId), true);
  });

  test('mutex: lock per chat mencegah concurrent processing', () => {
    const release = messageQueueService.acquireLock('chat-1');
    assert.ok(release, 'First acquire should succeed');

    // Lock kedua untuk chat yang sama harus gagal
    const second = messageQueueService.acquireLock('chat-1');
    assert.equal(second, null, 'Second acquire on same chat should fail');

    release!();
    const third = messageQueueService.acquireLock('chat-1');
    assert.ok(third, 'Acquire after release should succeed');
    third!();
  });

  test('mutex: lock per chat berbeda independen', () => {
    const release1 = messageQueueService.acquireLock('chat-1');
    const release2 = messageQueueService.acquireLock('chat-2');
    assert.ok(release1, 'chat-1 lock should succeed');
    assert.ok(release2, 'chat-2 lock should succeed (different lock)');
    release1();
    release2();
  });

  test('getStats mengembalikan struktur yang benar', () => {
    const stats = messageQueueService.getStats();
    assert.ok(typeof stats.activeQueues === 'number');
    assert.ok(typeof stats.activeLocks === 'number');
    assert.ok(typeof stats.dedupeCacheSize === 'number');
    assert.ok(typeof stats.pendingTextBuffers === 'number');
    assert.ok(typeof stats.pendingMediaBuffers === 'number');
  });
});

describe('CircuitBreakerService', () => {
  test('closed circuit allows calls', () => {
    const cb = new CircuitBreakerService('test', {
      failureThreshold: 2,
      cooldownMs: 100,
      halfOpenSuccessThreshold: 1,
    });
    assert.equal(cb.isAvailable(), true);
  });

  test('trip after threshold failures', () => {
    const cb = new CircuitBreakerService('test-trip', {
      failureThreshold: 2,
      cooldownMs: 1000,
      halfOpenSuccessThreshold: 1,
    });

    cb.recordFailure();
    assert.equal(cb.isAvailable(), true, 'Should still be available after 1 failure');

    cb.recordFailure();
    assert.equal(cb.isAvailable(), false, 'Should be tripped after 2 failures');
  });

  test('half-open after cooldown', async () => {
    const cb = new CircuitBreakerService('test-half', {
      failureThreshold: 1,
      cooldownMs: 100, // 100ms
      halfOpenSuccessThreshold: 1,
    });

    cb.recordFailure();
    assert.equal(cb.isAvailable(), false, 'Should be tripped');

    // Wait for cooldown
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(cb.isAvailable(), true, 'Should be half-open after cooldown');

    // Success should close the circuit
    cb.recordSuccess();
    const m = cb.getMetrics();
    assert.equal(m.state, 'closed', 'Should be closed after success in half-open');
  });

  test('wrap: success', async () => {
    const cb = new CircuitBreakerService('test-wrap-ok', {
      failureThreshold: 2,
      cooldownMs: 100,
      halfOpenSuccessThreshold: 1,
    });

    const result = await cb.wrap(async () => 'ok');
    assert.equal(result, 'ok');
  });

  test('wrap: failure throws and records', async () => {
    const cb = new CircuitBreakerService('test-wrap-fail', {
      failureThreshold: 2,
      cooldownMs: 100,
      halfOpenSuccessThreshold: 1,
    });

    await assert.rejects(
      cb.wrap(async () => {
        throw new Error('boom');
      }),
      /boom/
    );

    assert.equal(cb.getMetrics().state, 'closed', 'Still closed after 1 failure (threshold=2)');
  });

  test('fallback message', () => {
    const cb = new CircuitBreakerService('test-fb', {
      failureThreshold: 1,
      cooldownMs: 100,
      halfOpenSuccessThreshold: 1,
    });
    cb.recordFailure();
    assert.equal(cb.isAvailable(), false);
    const msg = cb.getFallbackMessage();
    assert.ok(msg.length > 0, 'Fallback message should be non-empty');
  });
});

describe('PresenceSimulatorService', () => {
  test('calculateDelay scales with word count', () => {
    const store = { timezone: 'Asia/Jakarta' };
    const shortDelay = presenceSimulatorService.calculateDelay('halo', store);
    const longDelay = presenceSimulatorService.calculateDelay(
      Array(50).fill('word').join(' '),
      store
    );
    assert.ok(longDelay > shortDelay, 'Longer text should take more delay');
  });

  test('getRandomPresenceState returns valid state', () => {
    const states = ['composing', 'paused', 'none'];
    for (let i = 0; i < 50; i++) {
      const state = presenceSimulatorService.getRandomPresenceState();
      assert.ok(states.includes(state), `Invalid state: ${state}`);
    }
  });

  test('isNightMode returns boolean', () => {
    const result = presenceSimulatorService.isNightMode({ timezone: 'Asia/Jakarta' });
    assert.equal(typeof result, 'boolean');
  });
});

describe('HealthMonitorService', () => {
  test('records metrics correctly', () => {
    healthMonitorService.reset();
    healthMonitorService.recordSendTimeout();
    healthMonitorService.recordSendTimeout();
    healthMonitorService.recordAuthError();

const metrics = healthMonitorService.getMetrics();
    assert.equal(metrics.sendTimeouts, 2, 'sendTimeouts should be 2');
    assert.equal(metrics.authErrors, 1, 'authErrors should be 1');
  });

  test('safe mode engages on threshold exceed', () => {
    healthMonitorService.reset();
    healthMonitorService.recordReconnect();
    healthMonitorService.recordReconnect();
    healthMonitorService.recordReconnect();
    // Should not engage (3 < maxReconnectsPerHour of 5)
    assert.equal(healthMonitorService.checkSafeMode(), false);

    // Add more reconnects
    for (let i = 0; i < 3; i++) {
      healthMonitorService.recordReconnect();
    }
    // Now 6 reconnects > threshold of 5
    assert.equal(healthMonitorService.checkSafeMode(), true, 'Safe mode should engage');
  });

  test('safe mode disengages when healthy', () => {
    healthMonitorService.reset();
    healthMonitorService.recordReconnect();
    healthMonitorService.recordReconnect();
    for (let i = 0; i < 5; i++) healthMonitorService.recordReconnect();

    assert.equal(healthMonitorService.checkSafeMode(), true);

    healthMonitorService.reset();
    assert.equal(healthMonitorService.checkSafeMode(), false, 'Should not be in safe mode after reset');
  });
});
