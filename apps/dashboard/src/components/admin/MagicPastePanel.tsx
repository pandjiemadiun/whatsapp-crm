import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wand2, Eraser, FileText, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useMagicPaste } from '../../hooks/useMagicPaste';
import magicPasteService from '../../services/magicPasteService';
import { MagicPastePreview } from './MagicPastePreview';
import { MagicPasteWarnings } from './MagicPasteWarnings';
import { ConfirmCreateModal } from './ConfirmCreateModal';
import { MAGIC_PASTE_MAX_CHARS, MAGIC_PASTE_MIN_CHARS } from '../../types/magicPaste';
import type { MagicPasteVariant } from '../../types/magicPaste';

/**
 * Props untuk komponen MagicPastePanel.
 */
export interface MagicPastePanelProps {
  /** Token admin (bearer). */
  token: string;
  /** Dipanggil setelah produk berhasil dibuat (opsional). */
  onProductCreated?: (productId: string) => void;
}

interface StoreOption {
  id: string;
  name: string;
}

/** Contoh teks untuk tombol Example. */
const EXAMPLE_TEXT = 'Kangkung segar 5000 stok 100 ikat, kategori sayuran';

/**
 * Panel utama Magic Paste: textarea → extract → preview → warning → confirm modal → create.
 *
 * Contoh:
 * ```tsx
 * <MagicPastePanel token={admin.token} onProductCreated={(id) => navigate(`/admin/products/${id}`)} />
 * ```
 */
export function MagicPastePanel({ token, onProductCreated }: MagicPastePanelProps) {
  const navigate = useNavigate();
  const mp = useMagicPaste();

  const [stores, setStores] = useState<StoreOption[]>([]);
  const [storesLoading, setStoresLoading] = useState(true);
  const [showConfirm, setShowConfirm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  // Ambil daftar store untuk dropdown
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/stores?page=1', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('Failed to load stores');
        const body = (await res.json()) as any;
        const list: StoreOption[] = (body?.data?.stores ?? []).map((s: any) => ({
          id: s.id,
          name: s.name,
        }));
        if (!cancelled) {
          setStores(list);
          if (list.length > 0) mp.handleStoreChange(list[0].id);
        }
      } catch {
        if (!cancelled) setFeedback({ type: 'error', msg: 'Gagal memuat daftar store' });
      } finally {
        if (!cancelled) setStoresLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const showFeedback = (type: 'success' | 'error', msg: string) => {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 5000);
  };

  /** Ekstrak teks via hook. */
  const handleExtract = async () => {
    if (!mp.canExtract || mp.loading) return;
    const result = await mp.handleExtract({ storeId: mp.storeId, text: mp.text });
    if (!result.success) {
      showFeedback('error', result.error || 'Extract gagal');
      if (result.error === 'Unauthorized') {
        navigate('/admin/login');
      }
    }
  };

  /** Reset semua. */
  const handleClear = () => {
    mp.handleClear();
    setShowConfirm(false);
    setCreatedId(null);
    setFeedback(null);
  };

  /** Muat teks contoh. */
  const handleExample = () => {
    mp.handleTextChange(EXAMPLE_TEXT);
  };

  /** Create produk (dari modal konfirmasi). Terima variantOverrides yang sudah
   *  diedit merchant (PV-P3) — merchant edits win over raw LLM variants. */
  const handleConfirmCreate = async (variantOverrides?: MagicPasteVariant[]) => {
    if (!mp.extracted || creating) return;
    if (mp.extracted.needsWeightInput) {
      showFeedback('error', 'Berat produk belum diisi — lengkapi berat (gram) sebelum membuat produk.');
      return;
    }
    setCreating(true);
    setFeedback(null);
    try {
      // Preview sudah didapat saat Extract; di sini call TANPA preview=true → create.
      // variantOverrides (merchant-edited) dikirim → backend pakai ini, bukan LLM raw.
      const res = await magicPasteService.extract(mp.storeId, mp.text, token, false, variantOverrides);
      if (res.success && res.data?.product) {
        const productId = res.data.product.id;
        setCreatedId(productId);
        setShowConfirm(false);
        showFeedback('success', 'Product berhasil dibuat!');
        onProductCreated?.(productId);
        // Redirect setelah 5 detik
        setTimeout(() => navigate(`/admin/products/${productId}`), 5000);
      } else {
        const msg = res.error?.message || 'Failed to create product';
        showFeedback('error', msg);
        if (res.error?.code === 'ERR_UNAUTHORIZED') {
          navigate('/admin/login');
        }
      }
    } catch (err: any) {
      showFeedback('error', err?.message || 'Failed to create product');
    } finally {
      setCreating(false);
    }
  };

  const counterColor = mp.isNearLimit ? 'text-red-600' : 'text-slate-500';

  return (
    <div className="mx-auto w-full max-w-2xl p-4 sm:p-6">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <div className="rounded-xl bg-blue-100 p-2.5 text-blue-600">
          <Wand2 className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Magic Paste</h1>
          <p className="text-sm text-slate-500">Tempel teks bebas untuk auto-create produk</p>
        </div>
      </div>

      {/* Feedback */}
      {feedback && (
        <div
          role="alert"
          className={`mb-4 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm font-medium ${
            feedback.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-700'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          {feedback.msg}
        </div>
      )}

      {/* Store selector */}
      <div className="mb-4">
        <label htmlFor="mp-store" className="mb-1.5 block text-sm font-medium text-slate-700">
          Store
        </label>
        <select
          id="mp-store"
          value={mp.storeId}
          onChange={(e) => mp.handleStoreChange(e.target.value)}
          disabled={storesLoading}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {storesLoading ? (
            <option value="">Memuat store...</option>
          ) : (
            <>
              <option value="">— Pilih store —</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </>
          )}
        </select>
      </div>

      {/* Textarea */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <label htmlFor="mp-text" className="mb-1.5 block text-sm font-medium text-slate-700">
          Teks Produk
        </label>
        <textarea
          id="mp-text"
          value={mp.text}
          onChange={(e) => mp.handleTextChange(e.target.value)}
          placeholder="Paste teks produk di sini, contoh: Kangkung segar 5000 stok 100"
          rows={5}
          maxLength={MAGIC_PASTE_MAX_CHARS}
          className="w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="mt-1.5 flex items-center justify-between">
          <span className={`text-xs ${counterColor}`} aria-live="polite">
            {mp.charCount} / {MAGIC_PASTE_MAX_CHARS} chars
          </span>
          {mp.text.length > 0 && mp.text.length < MAGIC_PASTE_MIN_CHARS && (
            <span className="text-xs text-red-600">Minimal {MAGIC_PASTE_MIN_CHARS} karakter</span>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleClear}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
          >
            <Eraser className="h-3.5 w-3.5" aria-hidden="true" /> Clear
          </button>
          <button
            type="button"
            onClick={handleExample}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
          >
            <FileText className="h-3.5 w-3.5" aria-hidden="true" /> Example
          </button>
        </div>
      </div>

      {/* Extract button */}
      <div className="mt-4 flex justify-center">
        <button
          type="button"
          onClick={handleExtract}
          disabled={!mp.canExtract || mp.loading || !mp.storeId}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-8 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
        >
          {mp.loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Wand2 className="h-4 w-4" aria-hidden="true" />}
          {mp.loading ? 'Extracting...' : 'Extract'}
        </button>
      </div>

      {/* Warning */}
      {mp.extracted && !mp.loading && (
        <MagicPasteWarnings
          warnings={mp.extracted.confidence < 0.8 ? ['Review data sebelum create'] : []}
          confidence={mp.extracted.confidence}
          hasCategory={!!mp.extracted.categoryId}
        />
      )}

      {/* Berat belum diisi → produk tidak bisa dibuat, minta input manual */}
      {mp.extracted?.needsWeightInput && !mp.loading && (
        <div
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Berat produk <strong>belum terdeteksi</strong> dari teks. Isi berat (gram) secara manual
            lewat form produk sebelum menyimpan — produk tidak dapat dibuat tanpa berat.
          </span>
        </div>
      )}

      {/* Preview */}
      {mp.extracted && !mp.loading && (
        <MagicPastePreview data={mp.extracted} onConfirm={() => setShowConfirm(true)} isLoading={false} />
      )}

      {/* Confirm modal */}
      {showConfirm && mp.extracted && (
        <ConfirmCreateModal
          data={mp.extracted}
          onConfirm={handleConfirmCreate}
          onCancel={() => setShowConfirm(false)}
          isLoading={creating}
        />
      )}

      {/* Success indicator */}
      {createdId && !showConfirm && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          Product berhasil dibuat! Mengarahkan ke detail produk dalam 5 detik...
        </div>
      )}
    </div>
  );
}
