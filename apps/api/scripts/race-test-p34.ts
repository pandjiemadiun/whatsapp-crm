/**
 * Race test for P3.4 — T4 fix (transaksi/lock untuk read-modify-write).
 *
 * Skenario: 2 request nyaris bersamaan ke conversationId yang SAMA.
 *   - Request A: modifyCart('add', 'TestProduct')          → menulis confirmedItems
 *   - Request B: setPendingClarification({question:'q'})   → menulis pendingClarification
 * Kedua field berada di kolom JSON `extractedEntities` yang SAMA (row yang sama).
 *
 * Before (kode lama, findUnique→update tanp a transaksi/lock): last-write-wins →
 *   salah satu field hilang.
 * After  (atomicCas optimistic lock @updatedAt): retry otomatis → KEDUA tersimpan.
 *
 * Jalankan:
 *   AFTER : npx tsx scripts/race-test-p34.ts        (working tree = atomicCas aktif)
 *   BEFORE: git stash && npx tsx scripts/race-test-p34.ts && git stash pop
 */
import { prisma } from '../src/infrastructure/prisma.js';
import { conversationContextService } from '../src/business/conversation-context.service.js';
import type { PendingClarification } from '../src/domain/types.js';

const ITER = 10;
// Label via arg: `npx tsx scripts/race-test-p34.ts "AFTER (atomicCas)"`
const LABEL = process.argv[2] ?? 'AFTER';

const store = await prisma.store.upsert({
  where: { id: 'race-store-p34' },
  update: {},
  create: { id: 'race-store-p34', name: 'Race Store P3.4', email: 'race-p34@garuda.test' },
});

async function freshConversation(idx: number): Promise<string> {
  const convId = `race-conv-p34-${idx}-${Date.now()}`;
  await prisma.conversation.create({
    data: { id: convId, storeId: store.id, customerId: 'c1', customerPhone: 'p1' },
  });
  await prisma.conversationContext.create({
    data: {
      conversationId: convId,
      lastMessages: [],
      extractedEntities: {},
      sessionKey: `sk-${convId}`,
      sessionExpireAt: new Date(Date.now() + 3_600_000),
    },
  });
  return convId;
}

function pending(idx: number): PendingClarification {
  return {
    question: `q${idx}`,
    options: [{ id: 'opt1', label: 'yes' }, { id: 'opt2', label: 'no' }],
    expected_type: 'yes_no',
    asked_at: new Date().toISOString(),
    retry_count: 0,
  };
}

async function runRace(label: string) {
  let bothOk = 0;
  let cartLost = 0;
  let pendingLost = 0;
  let bothLost = 0;

  for (let i = 0; i < ITER; i++) {
    const convId = await freshConversation(i);
    const pc = pending(i);

    // 2 request nyaris bersamaan — Promise.all
    await Promise.all([
      conversationContextService.modifyCart(convId, 'add', { addedProduct: 'TestProduct', qty: 1, price: 1000 }),
      conversationContextService.setPendingClarification(convId, pc),
    ]);

    const raw = await prisma.conversationContext.findUnique({
      where: { conversationId: convId },
      select: { extractedEntities: true },
    });
    const ee = conversationContextService.parseExtractedEntities(raw!.extractedEntities);
    const hasCart = ee.confirmedItems.some((ci) => ci.product === 'TestProduct');
    const hasPending = !!ee.pendingClarification && ee.pendingClarification.question === `q${i}`;

    if (hasCart && hasPending) bothOk++;
    else if (!hasCart && hasPending) cartLost++;
    else if (hasCart && !hasPending) pendingLost++;
    else bothLost++;

    // cleanup per-iteration
    await prisma.conversationContext.delete({ where: { conversationId: convId } }).catch(() => {});
    await prisma.conversation.delete({ where: { id: convId } }).catch(() => {});
  }

  const verdict = bothOk === ITER ? 'PASS (both writes preserved, no last-write-wins)' : 'FAIL (data lost → race)';
  console.log(`[${label}] iterations=${ITER} bothSaved=${bothOk} cartLost=${cartLost} pendingLost=${pendingLost} bothLost=${bothLost} → ${verdict}`);
  return { bothOk, cartLost, pendingLost, bothLost };
}

const after = await runRace(LABEL);
await prisma.store.delete({ where: { id: 'race-store-p34' } }).catch(() => {});
await prisma.$disconnect();

// Force-exit: importing the adapters container opens a Redis client that keeps
// the event loop alive. We only need the in-memory race result.
if (after.bothOk !== ITER) {
  process.exitCode = 1;
}
process.exit(process.exitCode);
