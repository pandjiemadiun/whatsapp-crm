/**
 * G2-B.6 — Order Transition Invariant tests
 *
 * Tests for the authoritative state machine in order-transition.ts:
 * - Valid transitions are allowed
 * - Invalid transitions throw InvalidOrderTransitionError
 * - confirmedAt is set when entering a confirmed status
 * - confirmedAt is preserved (not overwritten) on idempotent same-status
 * - Terminal states cannot be transitioned out of
 *
 * Runner: npx tsx --test src/tests/order-transition.test.ts
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../infrastructure/prisma.js';
import { transitionOrder, isTransitionAllowed, getAllowedTransitions, InvalidOrderTransitionError, CONFIRMED_STATUSES, } from '../business/order-transition.js';
const TEST_PREFIX = 'test-transition';
let storeId;
let customerId = `${TEST_PREFIX}-cust`;
let orderId;
async function cleanup() {
    await prisma.orderItem.deleteMany({ where: { order: { storeId } } }).catch(() => { });
    await prisma.order.deleteMany({ where: { storeId } }).catch(() => { });
    await prisma.conversation.deleteMany({ where: { storeId } }).catch(() => { });
    await prisma.store.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => { });
}
async function createOrder(status) {
    const conv = await prisma.conversation.create({
        data: { storeId, customerId, customerPhone: '+62812345678' },
    });
    return prisma.order.create({
        data: {
            storeId,
            conversationId: conv.id,
            customerId,
            orderStatus: status,
            items: [],
            totalPrice: 0,
            currency: 'IDR',
            confirmedAt: CONFIRMED_STATUSES.has(status) ? new Date() : null,
        },
    });
}
before(async () => {
    await cleanup();
    const store = await prisma.store.create({
        data: {
            id: `${TEST_PREFIX}-store`,
            name: 'Test Transition Store',
            email: 'test-transition@garuda.test',
        },
    });
    storeId = store.id;
});
after(async () => {
    await cleanup();
    await prisma.$disconnect();
});
beforeEach(async () => {
    await prisma.orderItem.deleteMany({ where: { order: { storeId } } }).catch(() => { });
    await prisma.order.deleteMany({ where: { storeId } }).catch(() => { });
    await prisma.conversation.deleteMany({ where: { storeId } }).catch(() => { });
});
// ---- Transition rules (pure function tests) ----
test('T1. draft → confirmed is allowed', () => {
    assert.equal(isTransitionAllowed('draft', 'confirmed'), true);
});
test('T2. draft → completed is NOT allowed (skip stages)', () => {
    assert.equal(isTransitionAllowed('draft', 'completed'), false);
});
test('T3. cancelled is terminal — cannot transition to paid', () => {
    assert.equal(isTransitionAllowed('cancelled', 'paid'), false);
});
test('T4. paid → packing is allowed (paid parent → packing child)', () => {
    assert.equal(isTransitionAllowed('paid', 'packing'), true);
});
test('T5. paid → shipped is allowed (paid parent → shipped child)', () => {
    assert.equal(isTransitionAllowed('paid', 'shipped'), true);
});
test('T6. paid → completed is NOT allowed (must go through shipped)', () => {
    assert.equal(isTransitionAllowed('paid', 'completed'), false);
});
test('T7. confirmed → packing is allowed', () => {
    assert.equal(isTransitionAllowed('confirmed', 'packing'), true);
});
test('T8. packing → shipped is allowed', () => {
    assert.equal(isTransitionAllowed('packing', 'shipped'), true);
});
test('T9. shipped → completed is allowed', () => {
    assert.equal(isTransitionAllowed('shipped', 'completed'), true);
});
test('T10. waiting_payment → cancelled is allowed', () => {
    assert.equal(isTransitionAllowed('waiting_payment', 'cancelled'), true);
});
test('T11. cancelled is terminal — no outgoing transitions', () => {
    assert.equal(getAllowedTransitions('cancelled').length, 0);
});
test('T12. refunded is terminal — no outgoing transitions', () => {
    assert.equal(getAllowedTransitions('refunded').length, 0);
});
test('T13. CONFIRMED_STATUSES contains confirmed and paid', () => {
    assert.equal(CONFIRMED_STATUSES.has('confirmed'), true);
    assert.equal(CONFIRMED_STATUSES.has('paid'), true);
});
test('T14. InvalidOrderTransitionError has correct message', () => {
    const err = new InvalidOrderTransitionError('draft', 'completed', 'ord-123');
    assert.match(err.message, /draft → completed/);
    assert.match(err.message, /ord-123/);
});
// ---- Database integration tests ----
test('T15. draft → confirmed sets confirmedAt', async () => {
    const order = await createOrder('draft');
    orderId = order.id;
    assert.equal(order.orderStatus, 'draft');
    assert.equal(order.confirmedAt, null);
    const updated = await transitionOrder(order.id, 'confirmed', {
        tx: prisma,
        actor: 'test',
    });
    assert.ok(updated.confirmedAt instanceof Date);
    assert.ok(updated.confirmedAt !== null);
});
test('T16. Idempotent: confirmed → confirmed is a no-op, confirmedAt preserved', async () => {
    const order = await createOrder('confirmed');
    const fixedTime = new Date('2024-01-01T00:00:00.000Z');
    await prisma.order.update({
        where: { id: order.id },
        data: { confirmedAt: fixedTime },
    });
    const updated = await transitionOrder(order.id, 'confirmed', {
        tx: prisma,
        actor: 'test',
    });
    assert.equal(updated.orderStatus, 'confirmed');
    // confirmedAt should be preserved, not overwritten
    assert.deepEqual(updated.confirmedAt, fixedTime);
});
test('T17. draft → completed throws InvalidOrderTransitionError', async () => {
    const order = await createOrder('draft');
    await assert.rejects(() => transitionOrder(order.id, 'completed', { tx: prisma, actor: 'test' }), (err) => err instanceof InvalidOrderTransitionError);
});
test('T18. cancelled → paid throws InvalidOrderTransitionError (terminal)', async () => {
    const order = await createOrder('cancelled');
    await assert.rejects(() => transitionOrder(order.id, 'paid', { tx: prisma, actor: 'test' }), (err) => err instanceof InvalidOrderTransitionError);
});
test('T19. paid → packing succeeds', async () => {
    const order = await createOrder('paid');
    const updated = await transitionOrder(order.id, 'packing', {
        tx: prisma,
        actor: 'test',
    });
    assert.equal(updated.orderStatus, 'packing');
});
test('T20. paid → completed throws (skipping shipped/packing)', async () => {
    const order = await createOrder('paid');
    await assert.rejects(() => transitionOrder(order.id, 'completed', { tx: prisma, actor: 'test' }), (err) => err instanceof InvalidOrderTransitionError);
});
test('T21. Order not found throws ApiError', async () => {
    const { ApiError } = await import('../errors/ApiError.js');
    await assert.rejects(() => transitionOrder('nonexistent-id', 'confirmed', { tx: prisma, actor: 'test' }), (err) => err instanceof ApiError);
});
//# sourceMappingURL=order-transition.test.js.map