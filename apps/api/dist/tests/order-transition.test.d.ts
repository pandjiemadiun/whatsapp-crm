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
export {};
//# sourceMappingURL=order-transition.test.d.ts.map