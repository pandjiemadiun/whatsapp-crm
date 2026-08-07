/**
 * Pending Clarification Resolver — BAGIAN 2
 * src/services/chat/pendingClarification.ts
 *
 * Pure resolver: given a normalizedText + pendingClarification state,
 * determine whether customer's reply resolves the clarification.
 *
 * Afirmatif → execute cart_ops TANPA LLM.
 * Negasi → rollback snapshot, clear pending.
 * Eksplisit (angka/urutan) → pilih opsi spesifik.
 * Miss → retry (retry_count ≤1) atau eskalasi ke pemilik toko.
 */
import type { PendingClarification, ResolverResult, ClarificationOption } from '../../domain/types.js';

/** Kata afirmatif */
const AFFIRMATIVE_WORDS = [
  'iya', 'ya', 'oke', 'yaudah', 'boleh', 'dua duanya', 'dua dua', 'keduanya',
  'semua', 'all', 'both', 'jadi', 'gas', 'lanjut', 'yes', 'bener', 'benar',
  'setuju', 'ikut', 'siap', 'mantap', 'done', 'ok', 'semuanya', 'ikut aja',
];

/** Kata negasi/cancellation */
const NEGATION_WORDS = [
  'tidak', 'nggak', 'engak', 'gak', 'ga', 'batal', 'jangan', 'hapus', 'cancel',
  'batalin', 'hapusin', 'enggak', 'bukan', 'no', 'nope', 'maunah', 'salah',
  'enggak jadi',
];

export function normalizeForMatch(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/([a-z])\1{1,}/g, '$1') // squash 2+ repeats ("iyaa" → "iya")
    .replace(/[.,!?;:]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Cek apakah teks mengandung kata afirmatif */
export function isAffirmative(text: string): boolean {
  const norm = normalizeForMatch(text);
  // Whole-word match — prevent "ya" matching inside "yang"
  const words = norm.split(/\s+/);
  return AFFIRMATIVE_WORDS.some((w) => words.includes(w) || norm === w);
}

/** Cek apakah teks mengandung kata negasi */
export function isNegation(text: string): boolean {
  const norm = normalizeForMatch(text);
  const words = norm.split(/\s+/);
  // Exact negation match (whole-word)
  if (NEGATION_WORDS.some((w) => words.includes(w))) return true;
  // "nggak jadi", "gak jadi", "tidak jadi" patterns (starts with negation word)
  return NEGATION_WORDS.some((w) => words[0] === w);
  // "nggak jadi", "gak jadi", "tidak jadi" patterns
  return NEGATION_WORDS.some((w) => norm.startsWith(w));
}

/** Cek apakah teks memilih opsi eksplisit (angka, "yang pertama", dsb) */
export function parseExplicitChoice(text: string): number | null {
  const norm = normalizeForMatch(text);

  // "1", "2", "3" — angka
  const num = parseInt(norm, 10);
  if (!isNaN(num) && num >= 1) return num;

  // "yang pertama", "pilih 1", "nomor 2"
  const numMatch = norm.match(/(?:yang\s+)?(?:pertama|ke-?(\d)|nomor\s+(\d)|no\s+(\d))/);
  if (numMatch) {
    const extracted = parseInt(numMatch[1] || numMatch[2] || numMatch[3], 10);
    if (!isNaN(extracted) && extracted >= 1) return extracted;
  }

  // "satu", "dua", "tiga" — kata bilangan
  const wordMap: Record<string, number> = {
    nol: 0, satu: 1, dua: 2, tiga: 3, empat: 4, lima: 5,
    enam: 6, tujuh: 7, delapan: 8, sembilan: 9, sepuluh: 10,
  };
  for (const [word, num] of Object.entries(wordMap)) {
    if (norm === word || norm.includes(word)) return num;
  }

  return null;
}

/**
 * Cek apakah teks memilih opsi spesifik dari clarification.options.
 * Fuzzy match per kata kunci.
 */
export function selectOption(text: string, options: any[]): string[] {
  const norm = normalizeForMatch(text);
  const selected: string[] = [];
  for (const opt of options) {
    const label = typeof opt === 'string' ? opt : opt.label;
    const keywords = label
      .toLowerCase()
      .split(/\s+/)
      .filter((w: string) => w.length > 2);
    if (keywords.some((w: string) => norm.includes(w))) {
      selected.push(label);
    }
  }
  return selected;
}

/**
 * @param normalizedText  pesan yang sudah dinormalisasi
 * @param pending         state pending clarification dari DB
 * @returns ResolverResult
 */
export function resolvePendingClarification(
  normalizedText: string,
  pending: PendingClarification
): ResolverResult {
  const norm = normalizeForMatch(normalizedText);
  const opts = pending.options && pending.options.length > 0
    ? pending.options
    : (pending.rawOptions || []).map((r: string, i: number) => ({ id: String(i), label: r }));

  // Check for explicit numeric choice — only for pure numbers, not "dua"
  const explicitChoice = parseExplicitChoice(norm);
  const isPureNumber = /^\d+$/.test(norm);

  if (isPureNumber && explicitChoice !== null && opts.length > 0 && explicitChoice <= opts.length) {
    const selectedOption: any = opts[explicitChoice - 1];
    const cartOps = (selectedOption?.cartOps as any[]) ?? [];
    return {
      status: 'RESOLVED',
      cartOps,
      message: `✅ Baik Kak, sudah kudapatkan: ${selectedOption?.label ?? ''}.`,
    };
  }

  // a. Afirmatif
  if (isAffirmative(norm)) {
    let allCartOps: any[] = [];
    for (const opt of opts) {
      if ((opt as any).cartOps) allCartOps = allCartOps.concat((opt as any).cartOps);
    }

    if (opts.length === 1) {
      return { status: 'RESOLVED', cartOps: allCartOps, message: '✅ Baik, sudah dikonfirmasi!' };
    }

    if (opts.length === 2) {
      // Eksekusi semua — 2 opsi
      return { status: 'RESOLVED', cartOps: allCartOps, message: '✅ Baik, keduanya sudah dikonfirmasi!' };
    }

    if (opts.length > 2) {
      // Cek apakah "semua"/"all"/"both"
      if (norm === 'semua' || norm === 'all' || norm === 'both' || norm === 'semuanya') {
        return { status: 'RESOLVED', cartOps: allCartOps, message: '✅ Baik, semua sudah dikonfirmasi!' };
      }
      // "dua duanya"/"keduanya"
      if (norm === 'dua duanya' || norm === 'keduanya') {
        // Check retry
        const retryCount = pending.retry_count ?? 0;
        if (retryCount === 0) {
          return {
            status: 'NEED_RETRY',
            message: `Pilih dengan nomor ya Kak:\n${opts.map((o: any, i: number) => `${i + 1}. ${o.label ?? o.id ?? ''}`).join('\n')}`,
          };
        }
        if (retryCount >= 1) {
          return {
            status: 'ESCALATE',
            cartOps: [],
            message: 'Sebentar ya Kak, aku konfirmasi ke pemilik toko dulu 🙏',
          };
        }
      }
    }

    // Default: affirmative with unknown multi-option → execute all
    return { status: 'RESOLVED', cartOps: allCartOps, message: '✅ Baik, sudah dikonfirmasi!' };
  }

  // b. Negasi
  if (isNegation(norm)) {
    return {
      status: 'RESOLVED',
      cartOps: [],
      message: pending.snapshot
        ? 'Oke, dibatalkan ya Kak. Keranjang sebelumnya sudah dipulihkan.'
        : 'Oke, dibatalkan ya Kak.',
    };
  }

  // f. Jika tidak terdeteksi (miss)
  const retryCount = pending.retry_count ?? 0;
  if (retryCount === 0) {
    return {
      status: 'NEED_RETRY',
      message: `Bisa dijelaskan lebih spesifik Kak? \n${opts.map((o: any, i: number) => `${i + 1}. ${o.label ?? o.id ?? ''}`).join('\n')}`,
    };
  }

  if (retryCount >= 1) {
    return {
      status: 'ESCALATE',
      cartOps: [],
      message: 'Sebentar ya Kak, aku konfirmasi ke pemilik toko dulu 🙏',
    };
  }

  // h. Not pending answer (shouldn't reach here — caller checks before calling)
  return { status: 'NOT_PENDING_ANSWER' };
}
