/**
 * Fast Path Deterministic Resolver — FASE B3
 * src/services/chat/fast-path.ts
 *
 * Modul 0-LLM yang mencoba menjawab pesan TANPA memanggil LLM interpreter.
 * Urutan eksekusi:
 *   A. Cek pending clarification aktif → deterministic resolver
 *   B. Cek tier deterministik (fallback service) — READ-ONLY
 *   C. Miss total → serahkan ke LLM interpreter
 *
 * I8: stage ini 0-LLM — tidak ada panggilan model di jalur utama.
 *     Tier fallback juga rule-based (cache, FAQ, SOP, total, ongkir, dll).
 * I10: resolver menutup klarifikasi tanpa LLM; tidak menghasilkan harga/stok.
 * I15: hasil tier belum diverifikasi ke DB — verifikasi dilakukan di stage terpisah.
 */
import type { WorkspaceV2, PendingV2 } from './types-v2.js';
import type { CatalogItem } from './setops.js';
import type { ResponseResult, PipelineContext } from '../../domain/types.js';
import { ResponseSource } from '../../domain/types.js';
import { getPendings } from './workspace.js';
import { normalizeForMatch } from './pendingClarification.js';

// ─────────────────────────────────────────────────────────────────────────────
// Keyword-guard lists (module-level named constants, substring-matched)
// ─────────────────────────────────────────────────────────────────────────────

/** Kata afirmatif untuk menutup pending clarification tanpa LLM (guard pertama). */
const AFFIRMATIVE: readonly string[] = ['iya', 'ya', 'oke', 'sip'];

/** Kata negasi/cancellation untuk rollback pending clarification. */
const NEGATION: readonly string[] = ['ga', 'gak', 'batal'];

/** "dua duanya" — quantifier eksak yang hanya valid saat N=2. */
const QUANTIFIER_BOTH = 'dua duanya';

/** Jumlah opsi maksimum agar affirmative menjadi deterministik (N ≤ 2). */
const AFFIRMATIVE_MAX_OPTIONS = 2;

/** Count yang diharapkan untuk quantifier "dua duanya". */
const QUANTIFIER_BOTH_COUNT = 2;

/** Peta kata ordinal → indeks 0-based (untuk parsing "yang kedua" dll). */
const ORDINAL_MAP: Readonly<Record<string, number>> = {
  pertama: 0,
  kedua: 1,
  ketiga: 2,
  keempat: 3,
  kelima: 4,
};

/** Kata penanda order/cart intent (guard sebelum tier fallback, substring-matched). */
const ORDER_INTENT_KEYWORDS: readonly string[] = [
  'mau',
  'beli',
  'pesan',
  'tambah',
  'kurang',
  'hapus',
  'ga jadi',
  'gak jadi',
  'batal',
  'cancel',
];

// ─────────────────────────────────────────────────────────────────────────────
// Result types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Payload ketika pending clarification berhasil di-resolve secara deterministik.
 * `action` menentukan apa yang harus dilakukan orchestrator:
 *  - 'EXECUTE': konfirmasi opsi yang dipilih
 *  - 'ROLLBACK': batalkan pending clarification (mis. kata negasi)
 */
export interface ResolvedPayload {
  /** ID pending yang diselesaikan */
  pendingId: string;
  /** Aksi yang dieksekusi */
  action: 'EXECUTE' | 'ROLLBACK';
  /** Indeks opsi yang dipilih (0-based). Hanya untuk EXECUTE. */
  resolvedIndices?: number[];
  /** Nama opsi yang matched. Hanya untuk EXECUTE. */
  matchedNames?: string[];
}

/**
 * Hasil fast-path — discriminated union.
 * - hit=true : jawaban ditemukan tanpa LLM, payload mengandung detailnya.
 * - hit=false: tidak ada fast-path match; lanjut ke LLM interpreter.
 */
export type FastPathResult =
  | { hit: true; outcome: 'resolved' | 'tier'; payload: ResolvedPayload | ResponseResult }
  | { hit: false; pendingParked: boolean; topicSwitch: boolean };

// ─────────────────────────────────────────────────────────────────────────────
// Helper: normalisasi pesan untuk tier call
// ─────────────────────────────────────────────────────────────────────────────

/** Normalisasi pesan: lowercase, trim, squash huruf berulang, buang punctuation. */
function normalizeMessage(message: string): string {
  return normalizeForMatch(message);
}

/**
 * Cek apakah pesan adalah order/cart intent (guard murah, 0-LLM).
 * Dipanggil SEBELUM tier fallback agar multi-add / cancel JANGAN disergap
 * tier klarifikasi produk (mis. tryProduct menyergap "aku mau kangkung 1").
 *
 * Deteksi (terhadap pesan ternormalisasi):
 *   - mengandung nama produk dari catalog DAN angka kuantitas, ATAU
 *   - mengandung kata kunci order (mau/beli/pesan/tambah/kurang/hapus/
 *     ga jadi/gak jadi/batal/cancel).
 */
function isOrderIntent(message: string, catalog: CatalogItem[]): boolean {
  if (ORDER_INTENT_KEYWORDS.some((kw) => message.includes(kw))) return true;
  const mentionsProduct = catalog.some((c) =>
    message.includes(c.name.toLowerCase())
  );
  return mentionsProduct && /\d/.test(message);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: match deterministik terhadap pending clarification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cek afirmatif: keyword iya/ya/oke/sip + N ≤ 2 opsi → EXECUTE semua.
 * I10: 0-LLM affirmation closes clarification.
 */
export function tryMatchAffirmative(message: string, options: string[]): boolean {
  if (options.length > AFFIRMATIVE_MAX_OPTIONS) return false;
  const msg = message.toLowerCase();
  return AFFIRMATIVE.some((kw) => msg.includes(kw));
}

/**
 * Cek negasi: keyword ga/gak/batal → ROLLBACK.
 */
export function tryMatchNegation(message: string): boolean {
  const msg = message.toLowerCase();
  return NEGATION.some((kw) => msg.includes(kw));
}

/**
 * Cek quantifier eksak: "dua duanya" + N=2 → EXECUTE semua.
 * Mengembalikan {exact, indices} di mana:
 * - exact=true, indices=[0..N-1] bila quantifier cocok dan N sesuai
 * - exact=false, indices=null bila tidak cocok
 */
export function tryMatchQuantifier(
  message: string,
  N: number
): { exact: boolean; indices: number[] | null } {
  const msg = message.toLowerCase();
  if (msg.includes(QUANTIFIER_BOTH)) {
    if (N === QUANTIFIER_BOTH_COUNT) {
      return { exact: true, indices: [...Array(N).keys()] };
    }
    return { exact: false, indices: null };
  }
  return { exact: false, indices: null };
}

/**
 * Parse indeks opsi dari pesan.
 * Contoh: "nomor 1" → [0], "nomor 2" → [1], "yang kedua" → [1].
 * Kembalikan null bila tidak ada indeks yang terdeteksi.
 */
export function tryMatchIndices(message: string): number[] | null {
  const msg = message.toLowerCase();
  const indices: number[] = [];

  // Pattern "nomor <angka>" — 1-based, konversi ke 0-based
  const numRegex = /nomor\s+(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = numRegex.exec(msg)) !== null) {
    const num = parseInt(m[1], 10);
    if (!isNaN(num) && num > 0) indices.push(num - 1);
  }

  // Pattern "yang <ordinal>" — menggunakan ORDINAL_MAP
  for (const [word, idx] of Object.entries(ORDINAL_MAP)) {
    if (msg.includes(`yang ${word}`)) indices.push(idx);
  }

  return indices.length > 0 ? indices : null;
}

/**
 * Cek apakah pesan menyebut nama opsi yang ada.
 * Kembalikan array nama yang matched, atau null bila tidak ada.
 */
export function tryMatchNames(message: string, options: string[]): string[] | null {
  const msg = message.toLowerCase();
  const matched = options.filter(
    (opt) => opt.trim().length > 0 && msg.includes(opt.toLowerCase())
  );
  return matched.length > 0 ? matched : null;
}

/**
 * Parkirkan pending: ubah status ke 'deferred' + increment deferred_turns.
 * Mutasi in-place pada workspace (Accessor PURE — storage di-handle caller).
 */
export function parkPendingAndIncrementTurns(
  workspace: WorkspaceV2,
  pendingId: string
): void {
  const pending = workspace.pendings.find((p) => p.id === pendingId);
  if (pending) {
    pending.status = 'deferred';
    pending.deferred_turns += 1;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator internal: coba match satu pending active
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Coba match deterministik terhadap satu pending clarification yang aktif.
 * Urutan guard (guard-first per spesifikasi):
 *   1. Afirmatif + N≤2 → EXECUTE
 *   2. Negasi → ROLLBACK
 *   3. Quantifier exact (dua duanya + N=2) → EXECUTE semua
 *   4. INDICES (nomor 1, yang kedua) → EXECUTE selected
 *   5. NAMES (mention nama opsi) → EXECUTE selected
 *
 * Kembalikan ResolvedPayload bila match, atau null bila tidak match.
 */
function tryMatchPending(message: string, pending: PendingV2): ResolvedPayload | null {
  const options = pending.options;
  const N = options.length;

  // 1. Afirmatif → EXECUTE (cek DULU)
  if (tryMatchAffirmative(message, options)) {
    return {
      pendingId: pending.id,
      action: 'EXECUTE',
      resolvedIndices: [...Array(N).keys()],
      matchedNames: [...options],
    };
  }

  // 2. Negasi → ROLLBACK
  if (tryMatchNegation(message)) {
    return {
      pendingId: pending.id,
      action: 'ROLLBACK',
    };
  }

  // 3. Quantifier exact → EXECUTE semua
  const q = tryMatchQuantifier(message, N);
  if (q.exact && q.indices !== null) {
    return {
      pendingId: pending.id,
      action: 'EXECUTE',
      resolvedIndices: q.indices,
      matchedNames: q.indices.map((i) => options[i]),
    };
  }

  // 4. INDICES → EXECUTE selected
  const indices = tryMatchIndices(message);
  if (indices !== null) {
    const valid = indices.filter((i) => i >= 0 && i < N);
    if (valid.length > 0) {
      return {
        pendingId: pending.id,
        action: 'EXECUTE',
        resolvedIndices: valid,
        matchedNames: valid.map((i) => options[i]),
      };
    }
  }

  // 5. NAMES dari opsi → EXECUTE selected
  const names = tryMatchNames(message, options);
  if (names !== null && names.length > 0) {
    return {
      pendingId: pending.id,
      action: 'EXECUTE',
      resolvedIndices: names.map((n) => options.indexOf(n)),
      matchedNames: names,
    };
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: bangun PipelineContext minimal untuk tier call (READ-ONLY)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bangun PipelineContext minimal dari workspace + catalog.
 * Hanya bidang yang dibutuhkan fallbackService.getResponse.
 * I8: tidak ada panggilan LLM di sini — hanya persiapan konteks saja.
 */
function buildMinimalContext(
  workspace: WorkspaceV2,
  catalog: CatalogItem[],
  storeId: string,
  conversationId: string
): PipelineContext {
  return {
    storeId,
    customerId: '',
    conversationId,
    messages: [],
    customerCity: null,
    customerName: null,
    cart: workspace.draft_cart.map((op) => ({
      product: op.product,
      qty: op.qty,
      price:
        catalog.find(
          (c) => c.name.toLowerCase() === op.product.toLowerCase()
        )?.price ?? null,
      unit: 'unit',
      mentionedAt: '',
      confirmedAt: '',
    })),
    activeOrder: null,
    pendingClarification: null,
    llmCalledThisTurn: false,
    storeProducts: catalog.map((c) => ({
      name: c.name,
      price: c.price,
      stock: null,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point: tryFastPath
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Coba selesaikan pesan via 0-LLM fast path.
 *
 * @param message        pesan mentah customer
 * @param workspace      state workspace perpercakapan (v2)
 * @param catalog        katalog produk toko
 * @param fallbackService  service tier deterministik (READ-ONLY); typed as any
 * @param storeId        id toko (diteruskan ke tier, READ-ONLY)
 * @param conversationId id percakapan (agar tier 'total' membaca cart DB yang benar)
 * @returns FastPathResult — discriminated union
 *
 * I8: maksimal 0 panggilan LLM di fast path ini.
 * I10: semua hasil resolved/tier berasal dari rule-based resolver, bukan LLM.
 */
export async function tryFastPath(
  message: string,
  workspace: WorkspaceV2,
  catalog: CatalogItem[],
  fallbackService: any,
  storeId: string = '',
  conversationId: string = ''
): Promise<FastPathResult> {
  const normalizedMsg = normalizeMessage(message);

  // ── A. CEK PENDING ACTIVE ──────────────────────────────────────────────
  // cek pending active DULU sebelum tier (guard-first per spesifikasi)
  const activePendings = getPendings(workspace, 'active');
  if (activePendings.length > 0) {
    const pending = activePendings[0];

    // a. Coba match deterministik terhadap message
    const match = tryMatchPending(message, pending);

    if (match) {
      // b. MATCH → resolved (EXECUTE atau ROLLBACK)
      return { hit: true, outcome: 'resolved', payload: match };
    }

    // c. TIDAK MATCH → park pending, increment deferred_turns
    //    topicSwitch = true karena pesan ini tidak menjawab klarifikasi
    parkPendingAndIncrementTurns(workspace, pending.id);
    return { hit: false, pendingParked: true, topicSwitch: true };
  }

  // ── A2. ORDER-INTENT GUARD ─────────────────────────────────────────────
  // Multi-add & cancel JANGAN disergap tier klarifikasi produk —
  // biarkan LLM reasoning (Stage 4) yang menangani.
  if (isOrderIntent(normalizedMsg, catalog)) {
    return { hit: false, pendingParked: false, topicSwitch: false };
  }

  // ── B. CEK TIER DETERMINISTIK (READ-ONLY) ──────────────────────────────
  // Baru cek tier setelah konfirmasi tidak ada pending active
  const ctx = buildMinimalContext(workspace, catalog, storeId, conversationId);
  const tierResult: ResponseResult = await fallbackService.getResponse(
    normalizedMsg,
    ctx
  );

  // Jika bukan HUMAN → ada jawaban deterministik.
  // FIX A: klarifikasi produk ambigu (PRODUCT) dianggap miss — tier hanya
  // menyodorkan list produk, biarkan LLM reasoning yang menuntas jalur beli.
  if (tierResult && tierResult.source !== ResponseSource.HUMAN) {
    if (tierResult.source === ResponseSource.PRODUCT) {
      return { hit: false, pendingParked: false, topicSwitch: false };
    }
    return { hit: true, outcome: 'tier', payload: tierResult };
  }

  // ── C. RETURN — semua miss, lanjut ke LLM interpreter (Stage 4) ────────
  return { hit: false, pendingParked: false, topicSwitch: false };
}
