/**
 * StoreDocumentService — P1 Onboarding Wizard
 *
 * Manages versioned, immutable StoreDocument rows (TOS/SOP) per store.
 *
 * Enforces the immutability invariant from PROJECT-CONTRACT-ONBOARDING-WIZARD.md §0.3:
 *   - A row with status='published' or 'superseded' CANNOT be updated (content is frozen).
 *   - Edit after publish → createDraft (new version+1, status='draft'), then publish.
 *   - publish() supersedes the currently-published row in the SAME transaction
 *     and verifies MAX 1 published row per (storeId, type) via count query.
 *
 * NOT responsible for HTTP endpoints (P2) or LLM generation (P3) — pure data layer.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../infrastructure/prisma.js';
import { adapters } from '../adapters/container.js';

type DocType = 'tos' | 'sop';
type DocStatus = 'draft' | 'published' | 'superseded';

export interface CreateDraftInput {
  storeId: string;
  type: DocType;
  content: string;
  generatedFromAnswers?: Prisma.InputJsonValue | null;
}

/** Thrown when a mutation violates the immutability invariant. */
export class StoreDocumentImmutabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreDocumentImmutabilityError';
  }
}

/** Thrown when a mutation targets a non-existent document. */
export class StoreDocumentNotFoundError extends Error {
  constructor(id: string) {
    super(`StoreDocument not found: ${id}`);
    this.name = 'StoreDocumentNotFoundError';
  }
}

export class StoreDocumentService {
  /**
   * Create a new draft document.
   * version = (highest existing version for storeId+type) + 1.
   * Status is always 'draft'. If generatedFromAnswers is provided,
   * generatedAt is set to now().
   */
  async createDraft(input: CreateDraftInput): Promise<Prisma.StoreDocumentGetPayload<{}>> {
    const { storeId, type, content, generatedFromAnswers } = input;

    // Compute next version: max(existing) + 1 (or 1 if first row for this storeId+type)
    const agg = await prisma.storeDocument.aggregate({
      where: { storeId, type },
      _max: { version: true },
    });
    const nextVersion = (agg._max.version ?? 0) + 1;

    adapters.logger.info('StoreDocument createDraft', { storeId, type, version: nextVersion });

    const doc = await prisma.storeDocument.create({
      data: {
        storeId,
        type,
        version: nextVersion,
        content,
        status: 'draft' as DocStatus,
        generatedFromAnswers: generatedFromAnswers ?? undefined,
        generatedAt: generatedFromAnswers ? new Date() : undefined,
      },
    });

    return doc;
  }

  /**
   * Update the content of a DRAFT document.
   *
   * THROWS StoreDocumentImmutabilityError if status !== 'draft' — the
   * immutability invariant (§0.3) forbids in-place updates to
   * published/superseded rows. Callers must createDraft + publish instead.
   *
   * THROWS StoreDocumentNotFoundError if the row does not exist.
   */
  async updateDraft(
    documentId: string,
    content: string,
  ): Promise<Prisma.StoreDocumentGetPayload<{}>> {
    const existing = await prisma.storeDocument.findUnique({
      where: { id: documentId },
      select: { status: true },
    });

    if (!existing) {
      throw new StoreDocumentNotFoundError(documentId);
    }

    if (existing.status !== 'draft') {
      throw new StoreDocumentImmutabilityError(
        `Cannot update StoreDocument ${documentId}: status is '${existing.status}', ` +
          `not 'draft'. Published/superseded documents are immutable — ` +
          `create a new draft (createDraft) and publish it instead.`,
      );
    }

    adapters.logger.info('StoreDocument updateDraft', { documentId });

    return prisma.storeDocument.update({
      where: { id: documentId },
      data: { content },
    });
  }

  /**
   * Publish a draft document in a SINGLE transaction:
   *   (a) Supede the currently-published row for the same (storeId, type), if any.
   *   (b) Set the target row to status='published' + publishedAt = now().
   *
   * After commit, verifies MAX 1 published row per (storeId, type) via a
   * count query — NOT an assumption. Throws if the invariant is violated
   * (transaction rolls back).
   *
   * THROWS StoreDocumentNotFoundError if the row does not exist.
   * THROWS StoreDocumentImmutabilityError if the row is not a draft.
   */
  async publish(documentId: string): Promise<Prisma.StoreDocumentGetPayload<{}>> {
    const doc = await prisma.storeDocument.findUnique({
      where: { id: documentId },
      select: { storeId: true, type: true, status: true },
    });

    if (!doc) {
      throw new StoreDocumentNotFoundError(documentId);
    }

    if (doc.status !== 'draft') {
      throw new StoreDocumentImmutabilityError(
        `Cannot publish StoreDocument ${documentId}: status is '${doc.status}'. ` +
          `Only 'draft' documents can be published.`,
      );
    }

    adapters.logger.info('StoreDocument publish', { documentId, storeId: doc.storeId, type: doc.type });

    await prisma.$transaction(async (tx) => {
      // (a) Supersede any currently-published row for the same (storeId, type)
      const superseded = await tx.storeDocument.updateMany({
        where: {
          storeId: doc.storeId,
          type: doc.type,
          status: 'published',
        },
        data: { status: 'superseded' },
      });

      // (b) Publish the target row
      await tx.storeDocument.update({
        where: { id: documentId },
        data: {
          status: 'published',
          publishedAt: new Date(),
        },
      });

      // (c) VERIFY: exactly 1 published row per (storeId, type) — hard check, not assumption
      const publishedCount = await tx.storeDocument.count({
        where: {
          storeId: doc.storeId,
          type: doc.type,
          status: 'published',
        },
      });

      if (publishedCount !== 1) {
        throw new Error(
          `Invariant violated: expected exactly 1 published StoreDocument for ` +
            `(storeId=${doc.storeId}, type=${doc.type}), found ${publishedCount}. ` +
            `Transaction will be rolled back.`,
        );
      }

      adapters.logger.info('StoreDocument published', {
        documentId,
        supersededCount: superseded.count,
        publishedCount,
      });
    });

    // Return the freshly published document (with full data)
    return prisma.storeDocument.findUniqueOrThrow({
      where: { id: documentId },
    });
  }

  /**
   * Read-only: get the currently-published document for a store + type.
   * Returns null if none published (draft only, or not yet created).
   * Returns the highest-version published row if multiple exist (defensive —
   * the publish() invariant guarantees at most 1, but this handles any
   * pre-existing DB state gracefully).
   */
  async getPublished(
    storeId: string,
    type: DocType,
  ): Promise<Prisma.StoreDocumentGetPayload<{}> | null> {
    return prisma.storeDocument.findFirst({
      where: {
        storeId,
        type,
        status: 'published',
      },
      orderBy: { version: 'desc' },
    });
  }
}

export const storeDocumentService = new StoreDocumentService();
