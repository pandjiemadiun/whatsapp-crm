/**
 * Race test FIX-4 (III-5): appendMessage via atomicCasMessages.
 * Pola sama seperti P3.4: spawn 2 write konkuren, assert tak ada yang
 * hilang (count sesuai ekspektasi, bukan last-write-wins).
 *
 * BEFORE (kode lama, update polos): race bisa hilangkan 1 pesan.
 * AFTER (FIX-4, atomicCasMessages CAS updatedAt + retry): 10/10 iterasi
 * kedua pesan tersimpan (noLost=10/10).
 *
 * Runner: node:test via tsx
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../../infrastructure/prisma.js';
import { conversationContextService } from '../conversation-context.service.js';

type PrismaMethod = (...args: any[]) => Promise<any>;

let originalFindUnique: PrismaMethod | undefined;
let originalUpdateMany: PrismaMethod | undefined;

function stubPrisma(mock: { findUnique?: PrismaMethod; updateMany?: PrismaMethod }) {
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

function makeMsg(id: string): any {
  return { id, conversationId: 'c', sender: 'customer', content: id, createdAt: new Date() };
}

describe('FIX-4 appendMessage race (atomicCasMessages)', () => {
  it('10 iterasi x 2 appendMessage konkuren → tak ada pesan hilang (noLost=10/10)', async () => {
    const ITER = 10;
    let noLost = 0;

    for (let i = 0; i < ITER; i++) {
      const convId = `conv-fix4-${i}`;
      let store: { lastMessages: any[]; updatedAt: number } | null = {
        lastMessages: [],
        updatedAt: 2000 + i,
      };

      stubPrisma({
        findUnique: async () => {
          if (!store) return null;
          return { lastMessages: store.lastMessages, updatedAt: new Date(store.updatedAt) };
        },
        updateMany: async (args: any) => {
          const where = args.where;
          if (store && where.updatedAt && where.updatedAt.getTime() === store.updatedAt) {
            store.lastMessages = args.data.lastMessages;
            store.updatedAt = Date.now();
            return { count: 1 };
          }
          return { count: 0 };
        },
      });

      try {
        const p1 = conversationContextService.appendMessage(convId, makeMsg('m1'));
        const p2 = conversationContextService.appendMessage(convId, makeMsg('m2'));
        await Promise.all([p1, p2]);

        const ids = (store!.lastMessages as any[]).map((m) => m.id);
        if (ids.includes('m1') && ids.includes('m2')) noLost++;
      } finally {
        restorePrisma();
      }
    }

    assert.equal(noLost, ITER, `expected ${ITER}/10 noLost, got ${noLost}/10`);
  });
});
