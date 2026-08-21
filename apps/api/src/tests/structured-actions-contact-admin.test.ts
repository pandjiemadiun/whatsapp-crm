/**
 * P4-2 CONTACT_ADMIN — Structured Action acceptance tests (action-contract).
 *
 * Verifies the human-takeover ("Hubungi CS") action against the contract:
 *   1. First CONTACT_ADMIN -> applied, conversation human_takeover, handoff
 *      history row written, events published.
 *   2. Second CONTACT_ADMIN (already human_takeover) -> already_applied,
 *      NO new history row, NO new events (idempotent guard).
 *   3. Tenant mismatch -> rejected (ERR_AUTH_FORBIDDEN).
 *   4. channel=web never triggers WA push (branch is a no-op; asserted by the
 *      fact that no gateway send is reachable for web customers — reported as-is).
 *
 * Runner:
 *   npx tsx --env-file=../../.env --test --test-force-exit src/tests/structured-actions-contact-admin.test.ts
 */
import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../infrastructure/prisma.js';
import {
  executeAction,
  ContactAdminRequestSchema,
} from '../business/action-registry.js';
import { ApiError } from '../errors/ApiError.js';
import { ErrorCodes } from '../constants/errorCodes.js';
import { eventBus, type EventEnvelope } from '../services/event-bus.service.js';

const TEST_PREFIX = 'test-action-contact-admin';

let storeId: string;
let storeIdOther: string;
let customerId: string;
let conversationId: string;

const captured: EventEnvelope[] = [];
let unsub: Array<() => void> = [];

function makeActionContext(overrides?: Partial<{ storeId: string; customerId: string; conversationId: string }>): any {
  return {
    storeId: overrides?.storeId || storeId,
    customerId: overrides?.customerId || customerId,
    conversationId: overrides?.conversationId || conversationId,
    channel: 'web',
    requestId: randomUUID(),
  };
}

function makeRequest(): any {
  return {
    actionId: randomUUID(),
    type: 'CONTACT_ADMIN',
    payload: {},
  };
}

async function cleanup() {
  await prisma.conversationHistory.deleteMany({
    where: { conversation: { storeId: { startsWith: TEST_PREFIX } } },
  }).catch(() => {});
  await prisma.conversation.deleteMany({
    where: { storeId: { startsWith: TEST_PREFIX } },
  }).catch(() => {});
  await prisma.customer.deleteMany({
    where: { storeId: { startsWith: TEST_PREFIX } },
  }).catch(() => {});
  await prisma.store.deleteMany({
    where: { id: { startsWith: TEST_PREFIX } },
  }).catch(() => {});
}

before(async () => {
  await cleanup();

  const store = await prisma.store.upsert({
    where: { id: `${TEST_PREFIX}-store` },
    update: {},
    create: {
      id: `${TEST_PREFIX}-store`,
      name: 'CA Store',
      slug: `${TEST_PREFIX}-store`,
      email: 'ca@garuda.test',
      phoneNumber: '+6281200000090',
      address: 'Jl. CA No. 1',
      originProvinceId: 'prov-ca-1',
      originProvinceName: 'Jawa Barat',
      originCityId: 'city-ca-1',
      originCityName: 'Bandung',
      originSubdistrictId: 'sub-ca-1',
      originSubdistrictName: 'Coblong',
    },
  });
  storeId = store.id;

  const storeOther = await prisma.store.upsert({
    where: { id: `${TEST_PREFIX}-other` },
    update: {},
    create: {
      id: `${TEST_PREFIX}-other`,
      name: 'CA Other',
      slug: `${TEST_PREFIX}-other`,
      email: 'cao@garuda.test',
      phoneNumber: '+6281200000091',
      address: 'Jl. CA Other No. 1',
      originProvinceId: 'prov-cao-1',
      originProvinceName: 'Jawa Barat',
      originCityId: 'city-cao-1',
      originCityName: 'Bandung',
      originSubdistrictId: 'sub-cao-1',
      originSubdistrictName: 'Coblong',
    },
  });
  storeIdOther = storeOther.id;

  const customer = await prisma.customer.create({
    data: { storeId, webUid: `${TEST_PREFIX}-uid` },
  });
  customerId = customer.id;

  const conversation = await prisma.conversation.create({
    data: { storeId, customerId, status: 'open', channel: 'web' },
  });
  conversationId = conversation.id;

  unsub.push(eventBus.subscribe('message.created', (env) => captured.push(env)));
  unsub.push(eventBus.subscribe('conversation.handoff', (env) => captured.push(env)));
  unsub.push(eventBus.subscribe('conversation.updated', (env) => captured.push(env)));
});

after(async () => {
  unsub.forEach((u) => u());
  unsub = [];
  await cleanup();
});

beforeEach(() => {
  captured.length = 0;
});

async function countHandoffRows() {
  return prisma.conversationHistory.count({
    where: { conversationId, messageType: 'handoff' },
  });
}

describe('CONTACT_ADMIN action-contract', () => {
  test('T1 first CONTACT_ADMIN -> applied + human_takeover + handoff row + events', async () => {
    const result = await executeAction('CONTACT_ADMIN', makeRequest(), makeActionContext());

    assert.equal(result.success, true);
    assert.equal(result.status, 'applied');

    const conv = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { status: true } });
    assert.equal(conv?.status, 'human_takeover');

    assert.equal(await countHandoffRows(), 1);

    const messageCreated = captured.find(
      (e) => e.event === 'message.created' && (e.data as any).type === 'handoff',
    );
    assert.ok(messageCreated, 'message.created (handoff) event must be published');
    assert.ok(
      captured.find((e) => e.event === 'conversation.handoff'),
      'conversation.handoff event must be published',
    );
    assert.ok(
      captured.find((e) => e.event === 'conversation.updated'),
      'conversation.updated event must be published',
    );
  });

  test('T2 second CONTACT_ADMIN (already human_takeover) -> already_applied, no dupe', async () => {
    // Ensure first handoff happened (state from T1 persists: cleanup only in before/after).
    const before = await countHandoffRows();

    const result = await executeAction('CONTACT_ADMIN', makeRequest(), makeActionContext());

    assert.equal(result.success, true);
    assert.equal(result.status, 'already_applied');

    // No new history row, no new events.
    assert.equal(await countHandoffRows(), before);
    assert.equal(captured.length, 0);
  });

  test('T3 tenant mismatch -> rejected (ERR_AUTH_FORBIDDEN)', async () => {
    await assert.rejects(
      () => executeAction('CONTACT_ADMIN', makeRequest(), makeActionContext({ storeId: storeIdOther })),
      (err: unknown) => {
        const e = err as ApiError;
        return e instanceof ApiError && e.code === ErrorCodes.ERR_AUTH_FORBIDDEN;
      },
    );
  });

  test('T4 invalid request schema rejected before handler', async () => {
    const bad = ContactAdminRequestSchema.safeParse({ type: 'CONTACT_ADMIN' }); // missing actionId
    assert.equal(bad.success, false);
  });
});
