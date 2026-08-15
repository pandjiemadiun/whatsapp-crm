/**
 * FASE 4 — isolated unit tests (node --test, no DB / no mocks).
 *
 *   npx tsx --env-file=../../.env --test --test-force-exit \
 *     src/tests/notification/notification.service.test.ts
 *
 * These are intentionally pure: buildPayload() and isVapidConfigured() touch no
 * IO. The full eligibility/presence/payload-push flow (shouldPush, handleMessageCreated)
 * is covered by the runtime integration smoke scripts/smoke-fase4-notification.ts,
 * which exercises the REAL prisma + realtimeService + web-push (spied) end-to-end.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { notificationService } from '../../services/notification.service.js';
const leaks = ['token', 'bearer', 'authorization', 'vapidprivatekey', 'privatekey', 'secret', 'cost', 'margin', 'history', 'phonenumber', 'webuid'];
describe('NotificationService.buildPayload', () => {
    it('emits minimal deep-link payload keyed by conversation_history.id (no secrets)', () => {
        const p = notificationService.buildPayload({
            id: 'row-123',
            conversationId: 'conv-1',
            sender: 'human_agent',
            type: 'text',
            content: 'Hai customer',
            createdAt: new Date('2026-08-13T13:00:00Z'),
            storeSlug: 'f4-1',
        });
        assert.equal(p.messageId, 'row-123');
        assert.equal(p.conversationId, 'conv-1');
        assert.equal(p.title, 'f4-1');
        assert.equal(p.body, 'Ada balasan dari admin: Hai customer');
        assert.equal(p.url, '/c/f4-1');
        assert.equal(p.timestamp, '2026-08-13T13:00:00.000Z');
        // URL carries NO token / bearer / vapid private key.
        assert.ok(!p.url.includes('token') && !p.url.includes('Bearer'));
        // No forbidden fields anywhere in the payload blob.
        const blob = JSON.stringify(p);
        const found = leaks.filter((k) => blob.toLowerCase().includes(k.toLowerCase()));
        assert.deepEqual(found, [], 'payload must not leak secrets: ' + found.join(','));
    });
    it('truncates content longer than 80 chars with an ellipsis', () => {
        const long = 'a'.repeat(200);
        const p = notificationService.buildPayload({
            id: 'r', conversationId: 'c', sender: 'human_agent', type: 'text',
            content: long, createdAt: new Date(), storeSlug: 's',
        });
        assert.equal(p.body.length < long.length, true);
        assert.ok(p.body.endsWith('…'), 'body ends with ellipsis');
        assert.equal(p.body.includes('Ada balasan dari admin:'), true);
    });
    it('falls back to QloBot title + empty-slug deep-link when storeSlug absent', () => {
        const p = notificationService.buildPayload({
            id: 'r', conversationId: 'c', sender: 'human_agent', type: 'text',
            content: 'hi', createdAt: new Date(),
        });
        assert.equal(p.title, 'QloBot');
        assert.equal(p.url, '/c/');
    });
});
describe('NotificationService.isVapidConfigured', () => {
    it('is false when init() has not been called (unit process has no VAPID env side-effects)', () => {
        // This unit test process does NOT call init() (init subscribes to EventBus +
        // global web-push state); isVapidConfigured() must read the init flag, not env.
        assert.equal(notificationService.isVapidConfigured(), false);
    });
});
//# sourceMappingURL=notification.service.test.js.map