import { AlertTriangle, Loader2, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import type { ExtractedMagicPasteData, MagicPasteVariant } from '../../types/magicPaste';

/**
 * Props untuk komponen ConfirmCreateModal.
 */
export interface ConfirmCreateModalProps {
  /** Data hasil ekstraksi yang akan dikonformasi. */
  data: ExtractedMagicPasteData;
  /**
   * Dipanggil saat tombol Create diklik.
   * Kirim daftar varian yang sudah diedit merchant (bisa kosong → simple product).
   * Merchant edits SELALU win over raw LLM variants (PV-P3).
   */
  onConfirm: (variantOverrides?: MagicPasteVariant[]) => void;
  /** Dipanggil saat modal ditutup (Cancel / klik overlay). */
  onCancel: () => void;
  /** true saat proses create berjalan. */
  isLoading: boolean;
}

interface AttrPair {
  key: string;
  value: string;
}

interface EditedVariant {
  attributes: AttrPair[];
  price: string;
  stock: string;
  sku: string;
}

/** Format harga ke format Rp Indonesia. */
function formatPrice(price: number | null): string {
  if (price == null) return '-';
  return `Rp ${price.toLocaleString('id-ID')}`;
}

/** Inisialisasi state varian dari hasil LLM (data.variants). */
function initVariants(data: ExtractedMagicPasteData): EditedVariant[] {
  return (data.variants ?? []).map((v) => ({
    attributes: Object.entries(v.attributes ?? {}).map(([k, val]) => ({
      key: k,
      value: String(val ?? ''),
    })),
    price: v.price === undefined ? '' : String(v.price),
    stock: v.stock == null ? '' : String(v.stock),
    sku: v.sku ?? '',
  }));
}

/** Konversi state (string) → MagicPasteVariant[] yang divalidasi ketat oleh backend. */
function toMagicPasteVariants(variants: EditedVariant[]): MagicPasteVariant[] {
  return variants.map((ev) => ({
    attributes: Object.fromEntries(
      ev.attributes
        .filter((a) => a.key.trim() !== '')
        .map((a) => [a.key.trim(), a.value.trim()]),
    ),
    price: Number(ev.price),
    stock: ev.stock.trim() === '' ? null : Number(ev.stock),
    sku: ev.sku.trim() === '' ? null : ev.sku.trim(),
  }));
}

/**
 * Modal konfirmasi final sebelum produk dibuat.
 * Menampilkan data ekstraksi dalam tabel + warning jika confidence < 80%.
 *
 * PV-P3: jika `data.variants` tidak kosong, tampilkan seksi varian yang EDITABLE
 * (merchant dapat edit harga/stok/sku + atribut key/value, hapus, tambah, atau
 * clear-all kembali ke simple product). Merchant edits dikirim via onConfirm
 * dan WILL override raw LLM variants di backend.
 *
 * Contoh:
 * ```tsx
 * {showConfirm && (
 *   <ConfirmCreateModal data={extracted} onConfirm={create} onCancel={close} isLoading={creating} />
 * )}
 * ```
 */
export function ConfirmCreateModal({ data, onConfirm, onCancel, isLoading }: ConfirmCreateModalProps) {
  const lowConfidence = data.confidence < 0.8;
  const pct = Math.round(data.confidence * 100);

  // PV-P3 — state varian yang diedit merchant (init dari LLM).
  const [variants, setVariants] = useState<EditedVariant[]>(() => initVariants(data));
  const [error, setError] = useState<string | null>(null);

  const hasVariantSection = variants.length > 0;
  const lowVariantConfidence =
    data.variantConfidence != null && data.variantConfidence < 0.8;
  const variantConfidencePct =
    data.variantConfidence != null ? Math.round(data.variantConfidence * 100) : null;

  const addVariant = () =>
    setVariants((prev) => [
      ...prev,
      { attributes: [{ key: '', value: '' }], price: '', stock: '', sku: '' },
    ]);

  const removeVariant = (idx: number) =>
    setVariants((prev) => prev.filter((_, i) => i !== idx));

  const clearAllVariants = () => {
    if (window.confirm('Hapus semua varian? Produk akan dibuat sebagai simple product.')) {
      setVariants([]);
    }
  };

  const updateVariantField = (idx: number, field: 'price' | 'stock' | 'sku', value: string) => {
    setVariants((prev) =>
      prev.map((v, i) => (i === idx ? { ...v, [field]: value } : v)),
    );
  };

  const updateAttr = (vi: number, ai: number, field: 'key' | 'value', value: string) => {
    setVariants((prev) =>
      prev.map((v, i) =>
        i === vi
          ? {
              ...v,
              attributes: v.attributes.map((a, j) => (j === ai ? { ...a, [field]: value } : a)),
            }
          : v,
      ),
    );
  };

  const addAttr = (vi: number) => {
    setVariants((prev) =>
      prev.map((v, i) =>
        i === vi ? { ...v, attributes: [...v.attributes, { key: '', value: '' }] } : v,
      ),
    );
  };

  const removeAttr = (vi: number, ai: number) => {
    setVariants((prev) =>
      prev.map((v, i) => (i === vi ? { ...v, attributes: v.attributes.filter((_, j) => j !== ai) } : v)),
    );
  };

  const handleSubmit = () => {
    setError(null);
    for (let i = 0; i < variants.length; i++) {
      const realAttrs = variants[i].attributes.filter(
        (a) => a.key.trim() !== '' && a.value.trim() !== '',
      );
      if (realAttrs.length === 0) {
        setError(`Varian #${i + 1}: atribut tidak boleh kosong`);
        return;
      }
      const p = Number(variants[i].price);
      if (variants[i].price.trim() === '' || Number.isNaN(p) || p <= 0) {
        setError(`Varian #${i + 1}: harga tidak valid`);
        return;
      }
    }
    // Merchant selalu mengirim daftar (bisa kosong = simple product).
    onConfirm(toMagicPasteVariants(variants));
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Konfirmasi pembuatan produk"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={isLoading ? undefined : onCancel}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-900">Konfirmasi Produk</h2>
          {!isLoading && (
            <button
              type="button"
              onClick={onCancel}
              aria-label="Tutup modal"
              className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="px-6 py-4">
          {lowConfidence && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600" aria-hidden="true" />
              <p className="text-sm text-yellow-700">
                Tingkat cocok: Rendah. Mohon review data sebelum membuat produk.
              </p>
            </div>
          )}

          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              <tr>
                <td className="py-2 pr-4 text-slate-500">Nama</td>
                <td className="py-2 text-right font-medium text-slate-900">{data.name ?? '-'}</td>
              </tr>
              <tr>
                <td className="py-2 pr-4 text-slate-500">Harga</td>
                <td className="py-2 text-right font-medium text-slate-900">{formatPrice(data.price)}</td>
              </tr>
              <tr>
                <td className="py-2 pr-4 text-slate-500">Stok</td>
                <td className="py-2 text-right font-medium text-slate-900">{data.stock ?? 'Tidak ditentukan'}</td>
              </tr>
              <tr>
                <td className="py-2 pr-4 text-slate-500">Kategori</td>
                <td className="py-2 text-right font-medium text-slate-900">
                  {data.categoryId ? (data.categoryHint ?? 'Tercocokkan') : 'Tidak ada kecococokan'}
                </td>
              </tr>
              <tr>
                <td className="py-2 pr-4 text-slate-500">Tingkat Cocok</td>
                <td className="py-2 text-right font-medium text-slate-900">{pct}%</td>
              </tr>
            </tbody>
          </table>

          {/* PV-P3 — seksi varian (preview + edit) */}
          <div className="mt-6">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800">Varian Produk</h3>
              <div className="flex items-center gap-2">
                {variantConfidencePct != null && (
                  <span
                    className={
                      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ' +
                      (lowVariantConfidence
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-emerald-100 text-emerald-800')
                    }
                    aria-label={
                      lowVariantConfidence
                        ? `Keyakinan varian rendah (${variantConfidencePct}%)`
                        : `Keyakinan varian ${variantConfidencePct}%`
                    }
                  >
                    Keyakinan varian {variantConfidencePct}%
                  </span>
                )}
                {hasVariantSection && (
                  <button
                    type="button"
                    onClick={clearAllVariants}
                    disabled={isLoading}
                    className="text-xs font-medium text-slate-600 underline decoration-slate-300 underline-offset-2 hover:text-slate-800 hover:decoration-slate-400 disabled:cursor-not-allowed"
                  >
                    Clear all varian
                  </button>
                )}
              </div>
            </div>

            {variants.length === 0 ? (
              <div className="mb-3 text-sm text-slate-500">
                Belum ada varian. Tambahkan varian di bawah (atau biarkan sebagai simple product).
              </div>
            ) : (
              <div className="space-y-4">
                {variants.map((v, vi) => (
                  <div key={vi} className="rounded-lg border border-slate-200 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-600">Varian #{vi + 1}</span>
                      <button
                        type="button"
                        onClick={() => removeVariant(vi)}
                        disabled={isLoading}
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        aria-label={`Hapus varian #${vi + 1}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {/* attributes (key/value pairs — konvensi VariantFormModal) */}
                    <div className="mb-2 space-y-1.5">
                      {v.attributes.map((a, ai) => (
                        <div key={ai} className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={a.key}
                            onChange={(e) => updateAttr(vi, ai, 'key', e.target.value)}
                            disabled={isLoading}
                            placeholder="size"
                            className="w-1/2 rounded-lg border border-slate-200 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                          <input
                            type="text"
                            value={a.value}
                            onChange={(e) => updateAttr(vi, ai, 'value', e.target.value)}
                            disabled={isLoading}
                            placeholder="L"
                            className="w-1/2 rounded-lg border border-slate-200 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                          <button
                            type="button"
                            onClick={() => removeAttr(vi, ai)}
                            disabled={isLoading}
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                            aria-label="Hapus atribut"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => addAttr(vi)}
                        disabled={isLoading}
                        className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800"
                      >
                        <Plus className="h-3 w-3" /> Tambah atribut
                      </button>
                    </div>

                    {/* price / stock / sku */}
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-xs text-slate-500">Harga (IDR)</label>
                        <input
                          type="text"
                          value={v.price}
                          onChange={(e) => updateVariantField(vi, 'price', e.target.value)}
                          disabled={isLoading}
                          placeholder="10000"
                          className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500">Stok</label>
                        <input
                          type="text"
                          value={v.stock}
                          onChange={(e) => updateVariantField(vi, 'stock', e.target.value)}
                          disabled={isLoading}
                          placeholder="100"
                          className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500">SKU</label>
                        <input
                          type="text"
                          value={v.sku}
                          onChange={(e) => updateVariantField(vi, 'sku', e.target.value)}
                          disabled={isLoading}
                          placeholder="opsional"
                          className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={addVariant}
              disabled={isLoading}
              className="mt-3 flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /> Tambah varian
            </button>

            {error && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer: tombol */}
        <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isLoading}
            className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-green-300"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {isLoading ? 'Membuat...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
