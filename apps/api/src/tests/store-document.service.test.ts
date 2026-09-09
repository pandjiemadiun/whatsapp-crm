/**
 * Integration tests for StoreDocumentService (WIZARD-P1-SCHEMA).
 *
 * Enforces immutability invariants from PROJECT-CONTRACT-ONBOARDING-WIZARD.md §0.3:
 *   T1. createDraft: double create → version 1 then 2 (not overwrite)
 *   T2. updateDraft on published → THROW, content must be unchanged (readback)
 *   T3. publish two drafts same (storeId,type) → old→superseded, new→published,
 *       NEVER 2 published concurrently (count assertion, not assumption)
 *   T4. Order without tosDocumentId → no constraint violation (regression gate)
 *
 * Uses real DB. Pattern follows order-context.integration.test.ts.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../infrastructure/prisma.js';
import {
  storeDocumentService,
  StoreDocumentImmutabilityError,
} from '../services/store-document.service.js';

const TEST_PREFIX = 'test-p1-sd';
const TEST_STORE = `${TEST_PREFIX}-store`;

// ─── Test store lifecycle ──────────────────────────────────────────────

before(async () => {
  // Clean any leftover rows from a previous run
  await prisma.storeDocument.deleteMany({ where: { storeId: TEST_STORE } }).catch(() => {});
  await prisma.$executeRawUnsafe(`DELETE FROM "orders" WHERE "storeId" = '${TEST_STORE}'`);
  await prisma.$executeRawUnsafe(`DELETE FROM "conversations" WHERE "storeId" = '${TEST_STORE}'`);
  await prisma.store.deleteMany({ where: { id: TEST_STORE } }).catch(() => {});

  await prisma.store.create({
    data: {
      id: TEST_STORE,
      name: 'P1 Schema Test Store',
      email: 'p1-test@garuda.test',
      phoneNumber: '+6281200000099',
      address: 'Jl. Test P1',
      originProvinceId: 'prov-p1',
      originProvinceName: 'Jawa Barat',
      originCityId: 'city-p1',
      originCityName: 'Bandung',
      originSubdistrictId: 'sub-p1',
      originSubdistrictName: 'Coblong',
    },
  });
});

beforeEach(async () => {
  // Isolate each test: wipe all StoreDocument rows for the test store
  await prisma.storeDocument.deleteMany({ where: { storeId: TEST_STORE } });
});

after(async () => {
  await prisma.storeDocument.deleteMany({ where: { storeId: TEST_STORE } }).catch(() => {});
  await prisma.$executeRawUnsafe(`DELETE FROM "orders" WHERE "storeId" = '${TEST_STORE}'`);
  await prisma.$executeRawUnsafe(`DELETE FROM "conversations" WHERE "storeId" = '${TEST_STORE}'`);
  await prisma.store.deleteMany({ where: { id: TEST_STORE } }).catch(() => {});
  await prisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════
// T1 — createDraft: two drafts for same (storeId, type) → version 1, then 2
// ═══════════════════════════════════════════════════════════════════════

describe('T1: createDraft versioning', () => {
  test('createDraft twice for same (storeId, type) produces version 1 then 2 — not overwrite', async () => {
    // First draft
    const draft1 = await storeDocumentService.createDraft({
      storeId: TEST_STORE,
      type: 'tos',
      content: 'TOS draft v1 content',
    });

    assert.equal(draft1.version, 1, 'first draft must be version 1');
    assert.equal(draft1.status, 'draft');
    assert.equal(draft1.content, 'TOS draft v1 content');

    // Second draft — same storeId + type → must be version 2, NOT overwrite v1
    const draft2 = await storeDocumentService.createDraft({
      storeId: TEST_STORE,
      type: 'tos',
      content: 'TOS draft v2 content',
    });

    assert.equal(draft2.version, 2, 'second draft must be version 2 (incremented, not overwritten)');
    assert.equal(draft2.status, 'draft');

    // Both rows must exist in DB (no overwrite)
    const allDocs = await prisma.storeDocument.findMany({
      where: { storeId: TEST_STORE, type: 'tos' },
      orderBy: { version: 'asc' },
    });

    assert.equal(allDocs.length, 2, 'both drafts must exist in DB');
    assert.equal(allDocs[0].version, 1);
    assert.equal(allDocs[0].content, 'TOS draft v1 content');
    assert.equal(allDocs[1].version, 2);
    assert.equal(allDocs[1].content, 'TOS draft v2 content');
  });

  test('createDraft for different type does NOT share version sequence', async () => {
    const tosDraft = await storeDocumentService.createDraft({
      storeId: TEST_STORE,
      type: 'tos',
      content: 'TOS content',
    });
    const sopDraft = await storeDocumentService.createDraft({
      storeId: TEST_STORE,
      type: 'sop',
      content: 'SOP content',
    });

    assert.equal(tosDraft.version, 1, 'tos should start at version 1');
    assert.equal(sopDraft.version, 1, 'sop should start at version 1 (independent sequence)');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// T2 — updateDraft on published row → THROW + content unchanged (readback)
// ═══════════════════════════════════════════════════════════════════════

describe('T2: updateDraft immutability', () => {
  test('updateDraft on a published row throws and content is NOT changed in DB', async () => {
    // Create + publish a draft
    const draft = await storeDocumentService.createDraft({
      storeId: TEST_STORE,
      type: 'tos',
      content: 'TOS original content',
    });

    await storeDocumentService.publish(draft.id);

    // Verify it's published
    const published = await prisma.storeDocument.findUnique({
      where: { id: draft.id },
      select: { status: true, content: true },
    });
    assert.equal(published?.status, 'published');

    // Attempt to mutate — MUST throw
    await assert.rejects(
      async () => {
        await storeDocumentService.updateDraft(draft.id, 'TOS HACKED content');
      },
      (err: Error) => {
        assert.ok(
          err instanceof StoreDocumentImmutabilityError,
          `Expected StoreDocumentImmutabilityError, got ${err?.constructor?.name}: ${err?.message}`,
        );
        return true;
      },
    );

    // Readback: content must be UNCHANGED
    const after = await prisma.storeDocument.findUnique({
      where: { id: draft.id },
      select: { content: true, status: true },
    });
    assert.equal(after?.content, 'TOS original content', 'content must NOT have been modified');
    assert.equal(after?.status, 'published', 'status must NOT have changed');
  });

  test('updateDraft on a superseded row also throws', async () => {
    // Publish v1, then publish v2 → v1 becomes superseded
    const draft1 = await storeDocumentService.createDraft({
      storeId: TEST_STORE,
      type: 'sop',
      content: 'SOP v1 content',
    });
    const draft2 = await storeDocumentService.createDraft({
      storeId: TEST_STORE,
      type: 'sop',
      content: 'SOP v2 content',
    });

    await storeDocumentService.publish(draft1.id);
    await storeDocumentService.publish(draft2.id);

    // draft1 should now be superseded
    const doc1 = await prisma.storeDocument.findUnique({
      where: { id: draft1.id },
      select: { status: true },
    });
    assert.equal(doc1?.status, 'superseded');

    // Attempt to mutate superseded row — MUST throw
    await assert.rejects(
      async () => {
        await storeDocumentService.updateDraft(draft1.id, 'SUPACED HACK');
      },
      (err: Error) => err instanceof StoreDocumentImmutabilityError,
    );

    // Content must still be unchanged
    const after = await prisma.storeDocument.findUnique({
      where: { id: draft1.id },
      select: { content: true },
    });
    assert.equal(after?.content, 'SOP v1 content');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// T3 — publish two drafts → first superseded, second published,
//      NEVER 2 published concurrently (count assertion)
// ═══════════════════════════════════════════════════════════════════════

describe('T3: publish superseding', () => {
  test('publish two drafts for same (storeId, type) — old→superseded, new→published, max 1 published', async () => {
    // Create two drafts
    const draft1 = await storeDocumentService.createDraft({
      storeId: TEST_STORE,
      type: 'tos',
      content: 'TOS v1 (will be superseded)',
    });
    const draft2 = await storeDocumentService.createDraft({
      storeId: TEST_STORE,
      type: 'tos',
      content: 'TOS v2 (will be published)',
    });

    // Publish v1
    await storeDocumentService.publish(draft1.id);

    // After first publish: exactly 1 published (count assertion)
    let publishedCount = await prisma.storeDocument.count({
      where: { storeId: TEST_STORE, type: 'tos', status: 'published' },
    });
    assert.equal(publishedCount, 1, 'exactly 1 published after first publish');

    // Publish v2
    await storeDocumentService.publish(draft2.id);

    // After second publish: STILL exactly 1 published (never 2 concurrent)
    publishedCount = await prisma.storeDocument.count({
      where: { storeId: TEST_STORE, type: 'tos', status: 'published' },
    });
    assert.equal(
      publishedCount,
      1,
      'NEVER 2 published concurrently — count must still be 1 after second publish',
    );

    // v1 → superseded
    const doc1 = await prisma.storeDocument.findUnique({
      where: { id: draft1.id },
      select: { status: true, content: true },
    });
    assert.equal(doc1?.status, 'superseded', 'first published draft must become superseded');
    assert.equal(doc1?.content, 'TOS v1 (will be superseded)', 'superseded content must be preserved');

    // v2 → published
    const doc2 = await prisma.storeDocument.findUnique({
      where: { id: draft2.id },
      select: { status: true, content: true },
    });
    assert.equal(doc2?.status, 'published', 'second draft must be published');
    assert.equal(doc2?.content, 'TOS v2 (will be published)');

    // getPublished returns the newly-published v2 (highest version)
    const published = await storeDocumentService.getPublished(TEST_STORE, 'tos');
    assert.equal(published?.id, draft2.id, 'getPublished must return the latest published row');
    assert.equal(published?.version, 2);

    // Verify superseded row still exists (NOT deleted — retention policy)
    const totalRows = await prisma.storeDocument.count({
      where: { storeId: TEST_STORE, type: 'tos' },
    });
    assert.equal(totalRows, 2, 'superseded row must NOT be deleted (retention)');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// T4 — Order without tosDocumentId → no constraint violation
// ═══════════════════════════════════════════════════════════════════════

describe('T4: Order without tosDocumentId (legacy regression gate)', () => {
  test('an Order created without tosDocumentId succeeds and tosDocumentId is null', async () => {
    // Simulate a legacy order: create conversation + order WITHOUT tosDocumentId
    const conv = await prisma.conversation.create({
      data: {
        storeId: TEST_STORE,
        customerId: `${TEST_PREFIX}-cust`,
        customerPhone: '+6281200000100',
      },
    });

    // Create Order — tosDocumentId intentionally omitted (simulating old order)
    const order = await prisma.order.create({
      data: {
        storeId: TEST_STORE,
        conversationId: conv.id,
        customerId: `${TEST_PREFIX}-cust`,
        items: [{ productId: 'prod-test', qty: 1, price: 10000 }],
      },
    });

    // Read back — tosDocumentId must be null (no constraint failure)
    const readback = await prisma.order.findUnique({
      where: { id: order.id },
      select: { tosDocumentId: true, orderStatus: true, storeId: true },
    });

    assert.equal(readback?.tosDocumentId, null, 'legacy order must have null tosDocumentId');
    assert.equal(readback?.orderStatus, 'pending');
    assert.equal(readback?.storeId, TEST_STORE);

    // Cleanup
    await prisma.order.delete({ where: { id: order.id } }).catch(() => {});
    await prisma.conversation.delete({ where: { id: conv.id } }).catch(() => {});
  });

  test('Order WITH tosDocumentId references a valid StoreDocument (FK integrity)', async () => {
    const doc = await storeDocumentService.createDraft({
      storeId: TEST_STORE,
      type: 'tos',
      content: 'TOS for order linkage test',
    });
    await storeDocumentService.publish(doc.id);

    const conv = await prisma.conversation.create({
      data: {
        storeId: TEST_STORE,
        customerId: `${TEST_PREFIX}-cust2`,
        customerPhone: '+6281200000200',
      },
    });

    const order = await prisma.order.create({
      data: {
        storeId: TEST_STORE,
        conversationId: conv.id,
        customerId: `${TEST_PREFIX}-cust2`,
        items: [{ productId: 'prod-test-2', qty: 2, price: 5000 }],
        tosDocumentId: doc.id,
      },
    });

    // Both FK directions must work
    const orderWithTos = await prisma.order.findUnique({
      where: { id: order.id },
      include: { tosDocument: true },
    });
    assert.equal(orderWithTos?.tosDocumentId, doc.id);
    assert.equal(orderWithTos?.tosDocument?.id, doc.id);
    assert.equal(orderWithTos?.tosDocument?.status, 'published');

    // Cleanup
    await prisma.order.delete({ where: { id: order.id } }).catch(() => {});
    await prisma.conversation.delete({ where: { id: conv.id } }).catch(() => {});
  });
});
