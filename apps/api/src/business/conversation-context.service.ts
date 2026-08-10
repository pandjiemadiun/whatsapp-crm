import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../infrastructure/prisma.js';
import { adapters } from '../adapters/container.js';
import { ApiError } from '../errors/ApiError.js';
import { ErrorCodes } from '../constants/errorCodes.js';
import type {
  ConversationContextData,
  ConversationContextInput,
  ConversationMessage,
  ExtractedEntity,
  ExtractedEntities,
  DiscussedItem,
  ConfirmedItem,
  PendingClarification,
  ResolvedAction,
} from '../domain/types.js';
import type { WorkspaceV2 } from '../services/chat/types-v2.js';

/** Jumlah maksimal pesan yang disimpan di lastMessages */
const MAX_CONTEXT_MESSAGES = 10;
/** Durasi sesi default (menit) */
const DEFAULT_SESSION_MINUTES = 60;

export class ConversationContextService {
  /**
   * Inisialisasi (upsert) context percakapan di tabel conversation_context.
   * Membuat sessionKey SHA256 baru dan sessionExpireAt (default 60 menit).
   */
  async initializeContext(input: ConversationContextInput): Promise<ConversationContextData> {
    const sessionKey = this.generateSessionKey(input.conversationId);
    const expireMinutes = input.sessionExpireMinutes ?? DEFAULT_SESSION_MINUTES;
    const sessionExpireAt = new Date(Date.now() + expireMinutes * 60_000);

    try {
      const raw = await prisma.conversationContext.upsert({
        where: { conversationId: input.conversationId },
        update: {
          sessionKey,
          sessionExpireAt,
        },
        create: {
          conversationId: input.conversationId,
          lastMessages: [],
          extractedEntities: {},
          sessionKey,
          sessionExpireAt,
        },
      });
      adapters.logger.info('Conversation context initialized', { conversationId: input.conversationId });
      return this.mapToContextData(raw);
    } catch (error) {
      adapters.logger.error('Failed to initialize conversation context', error as Error, { conversationId: input.conversationId });
      throw new ApiError(ErrorCodes.ERR_DB, 'Failed to initialize conversation context');
    }
  }

  /**
   * Ambil context percakapan. Sesi yang kedaluwarsa tetapi memiliki barang
   * di keranjang (confirmedItems) dipertahankan selama 24 jam.
   */
  async getContext(conversationId: string): Promise<ConversationContextData | null> {
    try {
      const raw = await prisma.conversationContext.findUnique({
        where: { conversationId },
      });
      if (!raw) return null;

      if (raw.sessionExpireAt.getTime() < Date.now()) {
        const entities = this.parseExtractedEntities(raw.extractedEntities);
        if (entities.confirmedItems && entities.confirmedItems.length > 0) {
          adapters.logger.info('Conversation context expired but has active cart items, extending session by 24h', { conversationId });
          const extendedExpire = new Date(Date.now() + 24 * 60 * 60_000);
          await prisma.conversationContext
            .update({
              where: { conversationId },
              data: { sessionExpireAt: extendedExpire },
            })
            .catch(() => {});
          return this.mapToContextData({ ...raw, sessionExpireAt: extendedExpire });
        }

        adapters.logger.debug('Conversation context expired, deleting', { conversationId });
        await prisma.conversationContext
          .delete({ where: { conversationId } })
          .catch(() => {});
        return null;
      }

      return this.mapToContextData(raw);
    } catch (error) {
      adapters.logger.error('Failed to get conversation context', error as Error, { conversationId });
      return null;
    }
  }

  /**
   * Merge entitas baru ke extractedEntities yang sudah ada.
   * Shape kanonik P3.3: kolom `extractedEntities` SELALU berupa OBJECT
   * (ExtractedEntities), bukan array. Entitas berupa token mentah
   * (ExtractedEntity[], mis. product/order/quantity/destination dari
   * order.service) digabungkan ke dalam field `trackedEntities` object
   * — tidak lagi menulis array ke kolom yang sama dengan penulis object
   * lain (modifyCart/setPendingClarification/fallback). Dedup by type:value,
   * confidence lebih tinggi menang (semantik lama dipertahankan).
   */
  async updateExtractedEntities(conversationId: string, entities: ExtractedEntity[]): Promise<void> {
    if (!entities?.length) return;
    try {
      const raw = await prisma.conversationContext.findUnique({
        where: { conversationId },
      });
      if (!raw) {
        adapters.logger.debug('Context not found, skipping entity update', { conversationId });
        return;
      }

      const existing = this.parseExtractedEntities(raw.extractedEntities);
      const merged = this.mergeTrackedEntities(existing, entities);

      await prisma.conversationContext.update({
        where: { conversationId },
        data: { extractedEntities: merged as unknown as Prisma.InputJsonValue },
      });
      adapters.logger.debug('Extracted entities updated', { conversationId, tracked: merged.trackedEntities?.length ?? 0 });
    } catch (error) {
      adapters.logger.error('Failed to update extracted entities', error as Error, { conversationId });
    }
  }

  /**
   * Persist WorkspaceV2 (v3.2) ke kolom terpisah `workspace_v2` (JSON nullable).
   * T1 fix (P3.1): workspace v2 tidak pernah tersimpan sebelumnya — semua "persist"
   * lewat updateExtractedEntities yang NO-OP karena type mismatch (WorkspaceV2
   * object tidak punya .length, sehingga guard `if (!entities.length) return`
   * langsung return). Kolom baru memutuskan v2 dari legacy extractedEntities.
   */
  async updateWorkspaceV2(conversationId: string, workspace: WorkspaceV2): Promise<void> {
    try {
      const ctxRow = await prisma.conversationContext.findUnique({
        where: { conversationId },
        select: { id: true },
      });
      if (!ctxRow) {
        adapters.logger.debug('Context not found, skipping workspace_v2 update', { conversationId });
        return;
      }

      await prisma.conversationContext.update({
        where: { conversationId },
        data: { workspace_v2: workspace as unknown as Prisma.InputJsonValue },
      });
      adapters.logger.debug('Workspace v2 persisted', { conversationId });
    } catch (error) {
      adapters.logger.error('Failed to update workspace_v2', error as Error, { conversationId });
    }
  }

  /**
   * Set intent pengguna pada context.
   */
  async updateUserIntent(conversationId: string, intent: 'browse' | 'purchase' | 'support' | 'inquiry'): Promise<void> {
    try {
      await prisma.conversationContext.update({
        where: { conversationId },
        data: { userIntent: intent },
      });
      adapters.logger.debug('User intent updated', { conversationId, intent });
    } catch (error) {
      adapters.logger.error('Failed to update user intent', error as Error, { conversationId });
    }
  }

  /**
   * Tambah pesan ke lastMessages context, otomatis memangkas ke 10 pesan terakhir.
   */
  async appendMessage(conversationId: string, message: ConversationMessage): Promise<void> {
    try {
      const raw = await prisma.conversationContext.findUnique({
        where: { conversationId },
      });
      if (!raw) return;

      const messages = this.parseMessages(raw.lastMessages);
      messages.push(message);
      const trimmed = messages.slice(-MAX_CONTEXT_MESSAGES);

      await prisma.conversationContext.update({
        where: { conversationId },
        data: { lastMessages: trimmed as unknown as Prisma.InputJsonValue },
      });
    } catch (error) {
      adapters.logger.error('Failed to append message to context', error as Error, { conversationId });
    }
  }

  /**
   * Perpanjang masa berlaku sesi (default 60 menit lagi).
   */
  async refreshSession(conversationId: string, sessionExpireMinutes?: number): Promise<void> {
    const minutes = sessionExpireMinutes ?? DEFAULT_SESSION_MINUTES;
    const sessionExpireAt = new Date(Date.now() + minutes * 60_000);
    try {
      await prisma.conversationContext.update({
        where: { conversationId },
        data: { sessionExpireAt },
      });
      adapters.logger.debug('Session refreshed', { conversationId, sessionExpireAt });
    } catch (error) {
      adapters.logger.error('Failed to refresh session', error as Error, { conversationId });
    }
  }

  /**
   * Update info pengiriman (nama penerima & alamat) di extractedEntities.
   */
  async updateShippingInfo(
    conversationId: string,
    recipientName?: string | null,
    shippingAddress?: string | null
  ): Promise<void> {
    try {
      const raw = await prisma.conversationContext.findUnique({
        where: { conversationId },
      });
      if (!raw) return;

      const entities = this.parseExtractedEntities(raw.extractedEntities);
      if (recipientName !== undefined && recipientName !== null) entities.recipientName = recipientName;
      if (shippingAddress !== undefined && shippingAddress !== null) entities.shippingAddress = shippingAddress;

      await prisma.conversationContext.update({
        where: { conversationId },
        data: { extractedEntities: entities as unknown as Prisma.InputJsonValue },
      });
      adapters.logger.debug('Shipping info updated in context', { conversationId, recipientName, shippingAddress });
    } catch (error) {
      adapters.logger.error('Failed to update shipping info in context', error as Error, { conversationId });
    }
  }

  /**
   * Parse kolom JSON extractedEntities sebagai objek ExtractedEntities.
   * Toleransi untuk legacy ARRAY (T2): bila kolom berupa array, kembalikan
   * default kosong (array tidak lagi ditulis — P3.3 kanonik OBJECT).
   * Membawa `trackedEntities` + `previousMutation` agar penulis object lain
   * (modifyCart/setPendingClarification/fallback) tidak menimppadnya.
   */
  parseExtractedEntities(raw: unknown): ExtractedEntities {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const parsed = raw as Record<string, unknown>;
      return {
        discussedItems: Array.isArray(parsed.discussedItems) ? (parsed.discussedItems as DiscussedItem[]) : [],
        confirmedItems: Array.isArray(parsed.confirmedItems) ? (parsed.confirmedItems as ConfirmedItem[]) : [],
        lastAmbiguousPrompt: typeof parsed.lastAmbiguousPrompt === 'string' ? parsed.lastAmbiguousPrompt : null,
        recipientName: typeof parsed.recipientName === 'string' ? parsed.recipientName : null,
        shippingAddress: typeof parsed.shippingAddress === 'string' ? parsed.shippingAddress : null,
        pendingClarification: (parsed.pendingClarification as PendingClarification) || null,
        previousMutation: (parsed.previousMutation as { cartSnapshot: ConfirmedItem[]; message: string } | null) ?? null,
        trackedEntities: Array.isArray(parsed.trackedEntities) ? (parsed.trackedEntities as ExtractedEntity[]) : [],
      };
    }
    return {
      discussedItems: [],
      confirmedItems: [],
      lastAmbiguousPrompt: null,
      recipientName: null,
      shippingAddress: null,
      pendingClarification: null,
      previousMutation: null,
      trackedEntities: [],
    };
  }

  /**
   * Hapus context percakapan. Operasi non-kritikal — error dibiarkan
   * tidak dilempar jika context memang tidak ada.
   */
  async deleteContext(conversationId: string): Promise<void> {
    try {
      await prisma.conversationContext.delete({ where: { conversationId } });
      adapters.logger.debug('Conversation context deleted', { conversationId });
    } catch {
      adapters.logger.debug('Conversation context delete skipped (not found)', { conversationId });
    }
  }

  /**
   * Modifikasi keranjang belanja (confirmedItems) secara atomik.
   *
   * Mendukung 3 aksi:
   *  - 'remove'  : hapus item berdasarkan productName (fuzzy match)
   *  - 'swap'    : hapus cancelledProduct, tambah/update addedProduct dengan qty/price baru
   *  - 'add'     : tambah atau update qty item yang sudah ada (dedup by name fuzzy match)
   *
   * Mengembalikan list confirmedItems SETELAH modifikasi.
   */
  async modifyCart(
    conversationId: string,
    action: 'add' | 'remove' | 'swap',
    opts: {
      cancelledProduct?: string;   // untuk 'remove' & 'swap'
      addedProduct?: string;       // untuk 'add' & 'swap'
      qty?: number;                // qty baru untuk added item
      price?: number;              // harga per unit untuk added item
    }
  ): Promise<ConfirmedItem[]> {
    try {
      const raw = await prisma.conversationContext.findUnique({
        where: { conversationId },
        select: { extractedEntities: true },
      });
      if (!raw) return [];

      const entities = this.parseExtractedEntities(raw.extractedEntities);
      let items: ConfirmedItem[] = entities.confirmedItems ?? [];

      /** Fuzzy match: apakah nama item mengandung kata kunci target */
      const fuzzyMatch = (itemName: string, target: string): boolean => {
        const a = itemName.toLowerCase().trim();
        const b = target.toLowerCase().trim();
        if (a === b) return true;
        if (a.includes(b) || b.includes(a)) return true;
        const words = b.split(/\s+/).filter(w => w.length > 1);
        return words.some(w => a.includes(w));
      };

      // 1. Hapus cancelledProduct dari cart (untuk 'remove' dan 'swap')
      if ((action === 'remove' || action === 'swap') && opts.cancelledProduct) {
        items = items.filter(i => !fuzzyMatch(i.product, opts.cancelledProduct!));
      }

      // 2. Tambah / update addedProduct (untuk 'add' dan 'swap')
      if ((action === 'add' || action === 'swap') && opts.addedProduct) {
        const existingIdx = items.findIndex(i => fuzzyMatch(i.product, opts.addedProduct!));
        if (existingIdx >= 0) {
          // Update qty jika item sudah ada
          const existing = items[existingIdx];
          items[existingIdx] = {
            ...existing,
            qty: opts.qty ?? (typeof existing.qty === 'number' ? existing.qty : 1),
            price: opts.price ?? existing.price,
            confirmedAt: existing.confirmedAt ?? new Date().toISOString(),
            mentionedAt: existing.mentionedAt ?? new Date().toISOString(),
          };
        } else {
          // Tambah item baru
          const now = new Date().toISOString();
          items.push({
            product: opts.addedProduct,
            qty: opts.qty ?? 1,
            price: opts.price ?? 0,
            confirmedAt: now,
            mentionedAt: now,
          });
        }
      }

      // Simpan hasil modifikasi
      entities.confirmedItems = items;
      await prisma.conversationContext.update({
        where: { conversationId },
        data: { extractedEntities: entities as unknown as import('@prisma/client').Prisma.InputJsonValue },
      });

      adapters.logger.info('Cart modified via modifyCart()', { conversationId, action, itemCount: items.length });
      return items;
    } catch (error) {
      adapters.logger.error('Failed to modify cart', error as Error, { conversationId });
      return [];
    }
  }

/** BAGIAN 2.1 — Set pending clarification state, WAJIB sebelum kirim question */
  async setPendingClarification(
    conversationId: string,
    clarification: Omit<PendingClarification, 'asked_at' | 'retry_count'>
  ): Promise<void> {
    try {
      const raw = await prisma.conversationContext.findUnique({
        where: { conversationId },
        select: { extractedEntities: true },
      });
      const entities = this.parseExtractedEntities(raw?.extractedEntities);
      entities.pendingClarification = {
        question: clarification.question,
        options: clarification.options,
        expected_type: clarification.expected_type,
        asked_at: new Date().toISOString(),
        retry_count: 0,
      };
      await prisma.conversationContext.update({
        where: { conversationId },
        data: { extractedEntities: entities as unknown as Prisma.InputJsonValue },
      });
      adapters.logger.info('Pending clarification set', { conversationId, question: clarification.question });
    } catch (error) {
      adapters.logger.error('Failed to set pending clarification', error as Error, { conversationId });
    }
  }

  /** BAGIAN 2.2 — Get pending clarification (if any) */
  getPendingClarification(entities: ExtractedEntities): PendingClarification | null {
    return entities.pendingClarification ?? null;
  }

  /** BAGIAN 2.3 — Clear pending clarification */
  async clearPendingClarification(conversationId: string): Promise<void> {
    try {
      const raw = await prisma.conversationContext.findUnique({
        where: { conversationId },
        select: { extractedEntities: true },
      });
      const entities = this.parseExtractedEntities(raw?.extractedEntities);
      entities.pendingClarification = null;
      await prisma.conversationContext.update({
        where: { conversationId },
        data: { extractedEntities: entities as unknown as Prisma.InputJsonValue },
      });
      adapters.logger.info('Pending clarification cleared', { conversationId });
    } catch (error) {
      adapters.logger.error('Failed to clear pending clarification', error as Error, { conversationId });
    }
  }

  /** BAGIAN 2.4 — Increment retry_count; return true if exceeded (>1) */
  async incrementClarificationRetry(conversationId: string): Promise<boolean> {
    try {
      const raw = await prisma.conversationContext.findUnique({
        where: { conversationId },
        select: { extractedEntities: true },
      });
      const entities = this.parseExtractedEntities(raw?.extractedEntities);
      const pc = entities.pendingClarification;
      if (!pc) return false;
      pc.retry_count = (pc.retry_count ?? 0) + 1;
      entities.pendingClarification = pc;
      await prisma.conversationContext.update({
        where: { conversationId },
        data: { extractedEntities: entities as unknown as Prisma.InputJsonValue },
      });
      return pc.retry_count > 1;
    } catch {
      return false;
    }
  }

  /** BAGIAN 1.4 — Rollback: restore cart to a previous snapshot */
  async restoreCart(conversationId: string, snapshot: any[]): Promise<ConfirmedItem[]> {
    try {
      const ctxRow = await prisma.conversationContext.findUnique({
        where: { conversationId },
        select: { extractedEntities: true },
      });
      const entities = this.parseExtractedEntities(ctxRow?.extractedEntities);
      entities.confirmedItems = snapshot;
      await prisma.conversationContext.update({
        where: { conversationId },
        data: {
          extractedEntities: entities as unknown as import('@prisma/client').Prisma.InputJsonValue,
        },
      });
      adapters.logger.info('Cart rolled back to snapshot', { conversationId, itemCount: snapshot.length });
      return snapshot;
    } catch (error) {
      adapters.logger.error('Failed to rollback cart', error as Error, { conversationId });
      return [];
    }
  }

  // ============================================================
  // Private helpers
  // ============================================================

  /** Generate session key deterministik per conversationId */
  private generateSessionKey(conversationId: string): string {
    return crypto.createHash('sha256').update(`${conversationId}:${Date.now()}`).digest('hex');
  }

  /** Map row Prisma mentah ke ConversationContextData */
  private mapToContextData(raw: any): ConversationContextData {
    return {
      id: raw.id,
      conversationId: raw.conversationId,
      lastMessages: this.parseMessages(raw.lastMessages),
      extractedEntities: this.parseExtractedEntities(raw.extractedEntities),
      userIntent: raw.userIntent ?? null,
      sessionKey: raw.sessionKey,
      sessionExpireAt: raw.sessionExpireAt,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  }

  /** Parse kolom JSON lastMessages dengan toleransi error */
  private parseMessages(raw: unknown): ConversationMessage[] {
    if (Array.isArray(raw)) return raw as ConversationMessage[];
    return [];
  }

  /**
   * Merge token entitas mentah (ExtractedEntity[]) ke dalam field
   * `trackedEntities` object ExtractedEntities — semantik dedup per type:value
   * & confidence-wins dipertahankan, tapi ditulis sebagai OBJECT (kanonik P3.3)
   * sehingga tidak menimpa/kosongkan field lain (confirmedItems/pendingClarification).
   */
  private mergeTrackedEntities(existing: ExtractedEntities, incoming: ExtractedEntity[]): ExtractedEntities {
    const map = new Map<string, ExtractedEntity>();
    for (const e of existing.trackedEntities ?? []) map.set(`${e.type}:${e.value}`, e);
    for (const e of incoming) {
      const key = `${e.type}:${e.value}`;
      const current = map.get(key);
      if (!current || (e.confidence ?? 0) > (current.confidence ?? 0)) {
        map.set(key, e);
      }
    }
    return { ...existing, trackedEntities: Array.from(map.values()) };
  }
}

export const conversationContextService = new ConversationContextService();
