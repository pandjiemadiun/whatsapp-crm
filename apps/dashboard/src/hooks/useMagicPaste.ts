import { useCallback, useMemo, useState } from 'react';
import type { ExtractedMagicPasteData, MagicPasteVariant } from '../types/magicPaste';
import { MAGIC_PASTE_MAX_CHARS, MAGIC_PASTE_MIN_CHARS } from '../types/magicPaste';

/**
 * Interface hasil pemanggilan extract — mencakup data + timestamp untuk debugging.
 */
export interface ExtractResult {
  success: boolean;
  data: ExtractedMagicPasteData | null;
  error: string | null;
  /** ISO timestamp kapan extract dijalankan */
  timestamp: string;
}

/**
 * Pure helpers — bisa di-test tanpa DOM/React.
 */

/** Hitung jumlah karakter. */
export function countChars(text: string): number {
  return text.length;
}

/** Truncate teks ke max 2000 karakter. */
export function truncateText(text: string, max = MAGIC_PASTE_MAX_CHARS): string {
  return text.slice(0, max);
}

/** Cek apakah teks valid untuk extract (10–2000 chars, non-empty setelah trim). */
export function isValidPasteText(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length >= MAGIC_PASTE_MIN_CHARS && trimmed.length <= MAGIC_PASTE_MAX_CHARS;
}

/** Cek apakah counter mendekati batas (> 80% dari 2000). */
export function isNearCharLimit(charCount: number, max = MAGIC_PASTE_MAX_CHARS): boolean {
  return charCount > max * 0.8;
}

/**
 * Hook pengelola state form Magic Paste: text, storeId, loading, extracted, error.
 *
 * Contoh penggunaan:
 * ```tsx
 * const mp = useMagicPaste();
 * <textarea value={mp.text} onChange={(e) => mp.handleTextChange(e.target.value)} />
 * <button disabled={!mp.canExtract} onClick={() => mp.handleExtract(storeId)}>Extract</button>
 * ```
 */
export function useMagicPaste() {
  const [text, setText] = useState('');
  const [storeId, setStoreId] = useState('');
  const [loading, setLoading] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedMagicPasteData | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Jumlah karakter saat ini (memoized). */
  const charCount = useMemo(() => countChars(text), [text]);

  /** Teks valid jika 10–2000 karakter. */
  const canExtract = useMemo(() => isValidPasteText(text), [text]);

  /** Counter hampir penuh (> 80% dari 2000). */
  const isNearLimit = useMemo(() => isNearCharLimit(charCount), [charCount]);

  /**
   * Update teks dengan auto-truncate ke 2000 karakter.
   * Validasi (min chars) ditangani di sini, bukan useEffect.
   */
  const handleTextChange = useCallback((value: string) => {
    const next = truncateText(value);
    setText(next);
    setExtracted(null);
    setError(null);
  }, []);

  /**
   * Panggil API extract. Handler dipisah agar mudah di-test.
   * Melempar error (bukan hanya return) agar caller bisa catch.
   */
  const extract = useCallback(async (input: { storeId: string; text: string }): Promise<ExtractResult> => {
    const timestamp = new Date().toISOString();
    if (!input.text.trim()) {
      const result: ExtractResult = { success: false, data: null, error: 'Text is required', timestamp };
      setError(result.error);
      return result;
    }
    if (input.text.length < MAGIC_PASTE_MIN_CHARS) {
      const result: ExtractResult = { success: false, data: null, error: 'Minimal 10 karakter', timestamp };
      setError(result.error);
      return result;
    }
    if (!input.storeId) {
      const result: ExtractResult = { success: false, data: null, error: 'Pilih store terlebih dahulu', timestamp };
      setError(result.error);
      return result;
    }

    setLoading(true);
    setError(null);
    try {
      // Token admin disimpan sebagai JSON di localStorage 'garuda_admin'
      let token = '';
      try {
        const stored = localStorage.getItem('garuda_admin');
        if (stored) token = JSON.parse(stored).token || '';
      } catch {}

      const res = await fetch('/api/admin/products/magic-paste?preview=true', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ storeId: input.storeId, text: input.text }),
        signal: AbortSignal.timeout(10_000),
      });

      // 401 → token invalid
      if (res.status === 401) {
        const result: ExtractResult = { success: false, data: null, error: 'Unauthorized', timestamp };
        setError(result.error);
        return result;
      }

      const body = (await res.json()) as any;

      if (!res.ok || !body.success) {
        const msg =
          body?.error?.message ||
          (Array.isArray(body?.details) ? body.details.map((d: any) => d.message).join(', ') : null) ||
          `Extract gagal (HTTP ${res.status})`;
        const result: ExtractResult = { success: false, data: null, error: msg, timestamp };
        setError(msg);
        return result;
      }

      const data = body.data;
      const extractedData: ExtractedMagicPasteData = {
        name: data.extractedEntities?.name ?? null,
        price: data.extractedEntities?.price ?? null,
        stock: data.extractedEntities?.stock ?? null,
        categoryId: data.extractedEntities?.categoryId ?? null,
        categoryHint: data.extractedEntities?.categoryHint ?? null,
        confidence: data.extractedEntities?.confidence ?? 0,
        variants: (data.extractedEntities?.variants as MagicPasteVariant[] | undefined) ?? undefined,
        variantConfidence: data.extractedEntities?.variantConfidence ?? null,
        needsWeightInput: data.needsWeightInput ?? false,
      };
      setExtracted(extractedData);
      return { success: true, data: extractedData, error: null, timestamp };
    } catch (err: any) {
      const msg = err?.name === 'TimeoutError' ? 'Request timeout (10s)' : 'Network error — coba lagi';
      const result: ExtractResult = { success: false, data: null, error: msg, timestamp };
      setError(msg);
      return result;
    } finally {
      setLoading(false);
    }
  }, []);

  /** Reset seluruh state form. */
  const handleClear = useCallback(() => {
    setText('');
    setExtracted(null);
    setError(null);
  }, []);

  /** Sinkron storeId dari dropdown. */
  const handleStoreChange = useCallback((id: string) => {
    setStoreId(id);
    setExtracted(null);
    setError(null);
  }, []);

  return {
    text,
    storeId,
    loading,
    extracted,
    error,
    charCount,
    isNearLimit,
    canExtract,
    handleTextChange,
    handleStoreChange,
    handleClear,
    handleExtract: extract,
  };
}

export type UseMagicPasteReturn = ReturnType<typeof useMagicPaste>;
