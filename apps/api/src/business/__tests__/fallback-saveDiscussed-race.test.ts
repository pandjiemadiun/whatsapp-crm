/**
 * Race test FIX-3 (III-4 sisa): saveDiscussedItems via atomicCas.
 * Pola sama seperti P3.4 (laporan-taskP3.4.md §9): spawn 2 write
 * konkuren, assert BOTH tersimpan (bukan salah satu ke-timpa).
 *
 * BEFORE (kode lama, read-modify-write polos): bothSaved = 0/10.
 * AFTER (FIX-3, atomicCas CAS updatedAt + retry): bothSaved = 10/10.
 *
 * Runner: node:test via tsx
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../../infrastructure/prisma.js';
import { fallbackService } from '../fallback.service.js';
import { canonicalConversationStateService } from '../canonical-context.service.js';

type PrismaMethod = (...args: any[]) => Promise<any>;

let originalFindUnique: PrismaMethod | undefined;
let originalUpdateMany: PrismaMethod | undefined;

function stubPrisma(mock: {
  findUnique?: PrismaMethod;
  updateMany?: PrismaMethod;
}) {
  const ctx = prisma.conversationContext as unknown as Record<string, unknown>;
  originalFindUnique = ctx.findUnique as PrismaMethod | undefined;
  originalUpdateMany = ctx.updateMany as PrismaMethod | undefined;
  if (mock.findUnique) ctx.findUnique = mock.findUnique as PrismaMethod;
  if (mock.updateMany) ctx.updateMany = mock.updateMany as PrismaMethod;
}

function restorePrisma() {
  const ctx = prisma.conversationContext as unknown as Record<string, unknown>;
  if (originalFindUnique !== undefined) ctx.findUnique = originalFindUnique;
  if (originalUpdateMany !== undefined) ctx.updateMany = originalUpdateMany;
}

function makeOption(product: string): any {
  return {
    content: `Produk ${product}`,
    metadata: { productIds: [product], matchedNames: [product], matchedPrices: [100] },
  };
}

describe('FIX-3 saveDiscussedItems race (atomicCas)', () => {
  // Canonical write di-noop (tidak perlu DB nyata untuk menguji CAS kolom extractedEntities).
  (canonicalConversationStateService as any).writeV1DiscussedItems = async () => {};

  it('10 iterasi x 2 write konkuren → kedua item tersimpan (bothSaved=10/10)', async () => {
    const ITER = 10;
    let bothSaved = 0;

    for (let i = 0; i < ITER; i++) {
      const convId = `conv-fix3-${i}`;
      // Stateful mock: CAS @updatedAt — updateMany count>0 hanya bila updatedAt cocok.
      let store: { extractedEntities: any; updatedAt: number } | null = {
        extractedEntities: { discussedItems: [], lastAmbiguousPrompt: null },
        updatedAt: 1000 + i,
      };

      stubPrisma({
        findUnique: async () => {
          if (!store) return null;
          return {
            extractedEntities: store.extractedEntities,
            updatedAt: new Date(store.updatedAt),
          };
        },
        updateMany: async (args: any) => {
          const where = args.where;
          if (store && where.updatedAt && where.updatedAt.getTime() === store.updatedAt) {
            store.extractedEntities = args.data.extractedEntities;
            store.updatedAt = Date.now(); // bump → paksa retry writer lain
            return { count: 1 };
          }
          return { count: 0 };
        },
      });

      try {
        const p1 = (fallbackService as any).saveDiscussedItems(convId, makeOption('Ayam'));
        const p2 = (fallbackService as any).saveDiscussedItems(convId, makeOption('Sapi'));
        await Promise.all([p1, p2]);

        const items = store!.extractedEntities.discussedItems as any[];
        const products = items.map((d) => d.product);
        if (products.includes('Ayam') && products.includes('Sapi')) bothSaved++;
      } finally {
        restorePrisma();
      }
    }

    assert.equal(bothSaved, ITER, `expected ${ITER}/10 bothSaved, got ${bothSaved}/10`);
  });
});
