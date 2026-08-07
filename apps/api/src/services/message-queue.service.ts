/**
 * Message Queue Service — kelola antrian per-chat dengan mutex, deduplication,
 * coalescing, dan priority routing.
 *
 * Arsitektur:
 * - Per-chat mutex lock (Set-based — hanya satu processor per chat)
 * - Dedup berdasarkan messageId (LRU cache 5 menit)
 * - Coalescing: buffer text 5-15s, media 10-15s
 * - Priority routing: urgent keywords → proses langsung (bypass buffer)
 */

export type MessageType = 'text' | 'image' | 'video' | 'audio' | 'document';

export interface RawMessage {
  id: string;
  chatId: string;
  storeId: string;
  customerId: string;
  type: MessageType;
  content: string;
  mediaKey?: string;
  receivedAt: number;
}

export interface QueuedMessage extends RawMessage {
  priority: 'normal' | 'urgent';
  attempts: number;
  isUgc: boolean;
  gateway: 'gowa' | 'fonnte';
  deviceId?: string;
  token?: string;
  inboxId?: number;
  storeTimezone?: string;
}

export interface ProcessedMessage {
  id: string;
  chatId: string;
  storeId: string;
  customerId: string;
  type: MessageType;
  content: string;
  mediaKey?: string;
  receivedAt: number;
  priority: 'normal' | 'urgent';
}

export type FlushHandler = (
  msg: ProcessedMessage,
  sourceMsg: QueuedMessage
) => void;

interface CoalesceBuffer {
  timer: NodeJS.Timeout | null;
  messages: QueuedMessage[];
}

const URGENT_KEYWORDS = [
  'transfer', 'complain', 'urgent', 'blocked', 'frozen',
  'cancel', 'cancelled', 'cancellation', 'refund', 'chargeback',
  'ganti', 'komplain', 'urgen', 'blokir', 'batal',
  'lama', 'lambat', 'gagal', 'error',
];

const DEAD_END_PATTERNS: RegExp[] = [
  /^(ok|oke|okay|alright|yep|sip|done|siap|mantap|udh|udah|sudah|thanks|thank\s*you|✓|✔|✅|👍|👌|👏|cool|nice|great|perfect|baik\s*sudah|sudah\s*baik|sudah\s*tidak\s*perlu|terima\s*kasih(?:\s*saya)?\s*!?)\s*$/i,
  /^\s*[✓✔]\s*$/,
  /^\s*[👍👌👏🙏]+?\s*$/u,
  /^\s*\p{Emoji}+\s*$/u,
];

// Pola konteks funnel transaksi — jika AI sebelumnya mengandung pola ini,
// pesan pendek dari user tidak boleh dianggap dead-end
const ORDER_FUNNEL_PATTERNS: RegExp[] = [
  /\btotal\b.*rp\s*\d/i,
  /silakan\s*(?:laku)?k(?:an)?\s*transfer/i,
  /transfer\s*ke\s*rekening/i,
  /order[^\n]{0,200}\s*(?:dikonfirmasi|diproses|dikirim)/i,
  /pembayaran/i,
  /konfirmasi\s*order/i,
  /terima\s*kasih.*belanja/i,
];

// Kata negasi yang harus melewatkan keyword urgent
const NEGATION_WORDS = [
  'nggak', 'gak', 'tidak', 'bukan', 'ga', 'tak', 'nggak', 'gak',
];

// TTL untuk dedup cache (5 menit)
const DEDUP_TTL_MS = 300_000;
const DEDUP_CACHE_MAX = 10_000;

// Coalescing window
const TEXT_COALESCE_MIN = 5_000;
const TEXT_COALESCE_MAX = 15_000;
const MEDIA_COALESCE_MIN = 10_000;
const MEDIA_COALESCE_MAX = 15_000;

function getRandomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Dead-end detection — pola penutupan yang tidak perlu LLM */
export function isDeadEnd(text: string): boolean {
  const cleaned = normalizeText(text);
  return DEAD_END_PATTERNS.some((p) => p.test(cleaned));
}

/**
 * Dead-end detection with order-funnel context awareness.
 * Jika AI sebelumnya memberikan kutipan harga / instruksi transfer /
 * konfirmasi order, maka pesan pendek ("ok", "sip") HARUS tetap diproses
 * oleh LLM untuk update state order.
 */
export function isDeadEndWithContext(text: string, lastAiMessage?: string): boolean {
  if (!isDeadEnd(text)) return false;
  // Bypass dead-end jika AI sebelumnya sedang dalam tahap order funnel
  if (lastAiMessage && isOrderFunnelContext(lastAiMessage)) {
    return false;
  }
  return true;
}

/** Cek apakah pesan AI sebelumnya termasuk konteks funnel transaksi */
export function isOrderFunnelContext(text: string): boolean {
  const lower = normalizeText(text);
  return ORDER_FUNNEL_PATTERNS.some((p) => p.test(lower));
}

/** Priority detection — deteksi kata kunci urgent dengan boundary + negation check */
export function isUrgent(text: string): boolean {
  const lower = normalizeText(text);
  for (const kw of URGENT_KEYWORDS) {
    if (!lower.includes(kw)) continue;

    // Cek apakah keyword didahului kata negasi dalam jendela 3 kata sebelumnya
    const idx = lower.indexOf(kw);
    const beforeWords = lower.substring(0, idx).trim().split(/\s+/).slice(-3);
    if (beforeWords.some((w) => NEGATION_WORDS.includes(w))) {
      continue; // Negated — skip
    }
    return true;
  }
  return false;
}

export class MessageQueueService {
  private processingLocks: Map<string, boolean> = new Map();
  private dedupeCache: Map<string, number> = new Map();
  private dedupeTimer: NodeJS.Timeout | null = null;

  private textBuffers: Map<string, CoalesceBuffer> = new Map();
  private mediaBuffers: Map<string, CoalesceBuffer> = new Map();

  private flushHandler: FlushHandler | null = null;

  /** Register handler dipanggil saat buffer timer fires */
  setFlushHandler(handler: FlushHandler): void {
    this.flushHandler = handler;
  }

  /** Acquire mutex for a chat — returns release function or null if locked */
  acquireLock(chatId: string): (() => void) | null {
    const key = `lock:${chatId}`;
    if (this.processingLocks.get(key)) {
      return null; // sedang diproses
    }
    this.processingLocks.set(key, true);
    return () => {
      this.processingLocks.delete(key);
    };
  }

  /** Cek & simpan messageId ke dedup cache. Return true jika duplicate. */
  isDuplicate(messageId: string): boolean {
    if (!messageId) return false;

    const now = Date.now();

    if (this.dedupeCache.size >= DEDUP_CACHE_MAX) {
      for (const [mid, ts] of this.dedupeCache.entries()) {
        if (now - ts > DEDUP_TTL_MS) {
          this.dedupeCache.delete(mid);
        }
      }
    }

    if (this.dedupeCache.has(messageId)) {
      return true;
    }

    this.dedupeCache.set(messageId, now);

    if (this.dedupeCache.size > 0 && this.dedupeCache.size % 100 === 0) {
      this.scheduleCleanup();
    }

    return false;
  }

  private scheduleCleanup(): void {
    if (this.dedupeTimer) return;
    this.dedupeTimer = setTimeout(() => {
      const now = Date.now();
      for (const [mid, ts] of this.dedupeCache.entries()) {
        if (now - ts > DEDUP_TTL_MS) {
          this.dedupeCache.delete(mid);
        }
      }
      this.dedupeCache.clear();
      this.dedupeTimer = null;
    }, DEDUP_TTL_MS);
  }

  /**
   * Buffer message untuk coalescing.
   * - Text: jika ada media buffer pending untuk user yang sama, gabungkan sebagai caption
   * - Media: buffer untuk batch processing
   *
   * Return true jika berhasil di-buffer (diproses nanti oleh timer).
   * Return false jika caller harus proses langsung (urgent).
   */
  bufferMessage(msg: QueuedMessage): boolean {
    const key = `${msg.storeId}:${msg.customerId}`;

    // Special: text message arrives while media buffer is pending → merge as caption
    if (msg.type === 'text') {
      const mediaBuf = this.mediaBuffers.get(key);
      if (mediaBuf) {
        mediaBuf.messages.push(msg);
        // Jangan reset timer — biarkan media timer yang ada yang fire
        return true;
      }
      return this.bufferText(msg);
    }

    // Special: media message arrives while text buffer is pending → merge
    const textBuf = this.textBuffers.get(key);
    if (textBuf) {
      textBuf.messages.push(msg);
      // Reset timer agar window coalescing di-extend
      clearTimeout(textBuf.timer!);
      textBuf.timer = setTimeout(() => {
        const current = this.textBuffers.get(key);
        if (!current) return;
        const merged = this.mergeTextMessages(current.messages);
        const firstMsg = current.messages.find((m) => m.priority === 'urgent') || current.messages[0];
        this.triggerFlush(merged, firstMsg);
        this.textBuffers.delete(key);
      }, getRandomInt(TEXT_COALESCE_MIN, TEXT_COALESCE_MAX));
      return true;
    }

    return this.bufferMedia(msg);
  }

  private bufferText(msg: QueuedMessage): boolean {
    const key = `${msg.storeId}:${msg.customerId}`;
    const entry = this.textBuffers.get(key) || { timer: null, messages: [] };
    entry.messages.push(msg);
    this.textBuffers.set(key, entry);

    clearTimeout(entry.timer!);

    // Jika urgent, langsung flush — jangan buffer
    if (msg.priority === 'urgent') {
      const merged = this.mergeTextMessages(entry.messages);
      this.triggerFlush(merged, msg);
      this.textBuffers.delete(key);
      return false;
    }

    const delay = getRandomInt(TEXT_COALESCE_MIN, TEXT_COALESCE_MAX);
    entry.timer = setTimeout(() => {
      const current = this.textBuffers.get(key);
      if (!current) return;
      const merged = this.mergeTextMessages(current.messages);
      const firstMsg = current.messages[0];
      this.triggerFlush(merged, firstMsg);
      this.textBuffers.delete(key);
    }, delay);

    return true;
  }

  private bufferMedia(msg: QueuedMessage): boolean {
    const key = `${msg.storeId}:${msg.customerId}`;
    const entry = this.mediaBuffers.get(key) || { timer: null, messages: [] };
    entry.messages.push(msg);
    this.mediaBuffers.set(key, entry);

    clearTimeout(entry.timer!);

    const delay = getRandomInt(MEDIA_COALESCE_MIN, MEDIA_COALESCE_MAX);
    entry.timer = setTimeout(() => {
      const current = this.mediaBuffers.get(key);
      if (!current) return;
      const batch = this.mergeMediaMessages(current.messages);
      const firstMsg = current.messages[0];
      this.triggerFlush(batch, firstMsg);
      this.mediaBuffers.delete(key);
    }, delay);

    return true;
  }

  private triggerFlush(msg: ProcessedMessage, sourceMsg: QueuedMessage): void {
    if (this.flushHandler) {
      this.flushHandler(msg, sourceMsg);
    }
  }

  /** Merge multiple text messages into one */
  private mergeTextMessages(msgs: QueuedMessage[]): ProcessedMessage {
    const first = msgs[0];
    return {
      id: `batch:${Date.now()}:${first.chatId}`,
      chatId: first.chatId,
      storeId: first.storeId,
      customerId: first.customerId,
      type: 'text',
      content: msgs.map((m) => m.content).filter(Boolean).join(' | '),
      receivedAt: first.receivedAt,
      priority: first.priority === 'urgent' ? 'urgent' : 'normal',
    };
  }

  /** Merge multiple media messages into a batch */
  private mergeMediaMessages(msgs: QueuedMessage[]): ProcessedMessage {
    const first = msgs[0];
    const images = msgs.filter((m) => m.type === 'image').map((m) => m.content);
    const caption = msgs.map((m) => m.content || '').filter(Boolean).join(' ');

    return {
      id: `batch:${Date.now()}:${first.chatId}`,
      chatId: first.chatId,
      storeId: first.storeId,
      customerId: first.customerId,
      type: images.length > 0 ? 'image' : first.type,
      content: images.length > 0 ? images[0] : first.content,
      receivedAt: first.receivedAt,
      priority: first.priority === 'urgent' ? 'urgent' : 'normal',
    };
  }

  /** Drain pending buffers for a specific chat (used during shutdown) */
  drainChatBuffers(chatId: string): ProcessedMessage[] {
    const result: ProcessedMessage[] = [];
    const key = `drain:${chatId}`;

    for (const [bufKey, buf] of this.textBuffers.entries()) {
      if (bufKey.includes(chatId)) {
        clearTimeout(buf.timer!);
        const merged = this.mergeTextMessages(buf.messages);
        result.push(merged);
        this.textBuffers.delete(bufKey);
      }
    }
    for (const [bufKey, buf] of this.mediaBuffers.entries()) {
      if (bufKey.includes(chatId)) {
        clearTimeout(buf.timer!);
        const batch = this.mergeMediaMessages(buf.messages);
        result.push(batch);
        this.mediaBuffers.delete(bufKey);
      }
    }

    return result;
  }

  /** Cleanup timers (on shutdown) */
  cleanup(): void {
    if (this.dedupeTimer) {
      clearTimeout(this.dedupeTimer);
      this.dedupeTimer = null;
    }

    for (const buf of this.textBuffers.values()) {
      clearTimeout(buf.timer!);
    }
    this.textBuffers.clear();

    for (const buf of this.mediaBuffers.values()) {
      clearTimeout(buf.timer!);
    }
    this.mediaBuffers.clear();

    this.processingLocks.clear();
    this.dedupeCache.clear();
    this.flushHandler = null;
  }

  /** Stats for monitoring */
getStats(): {
    activeQueues: number;
    activeLocks: number;
    dedupeCacheSize: number;
    pendingTextBuffers: number;
    pendingMediaBuffers: number;
  } {
    return {
      activeQueues: this.processingLocks.size,
      activeLocks: this.processingLocks.size,
      dedupeCacheSize: this.dedupeCache.size,
      pendingTextBuffers: this.textBuffers.size,
      pendingMediaBuffers: this.mediaBuffers.size,
    };
  }
}

export const messageQueueService = new MessageQueueService();
