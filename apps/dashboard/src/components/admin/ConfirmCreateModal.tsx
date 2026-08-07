import { AlertTriangle, Loader2, X } from 'lucide-react';
import type { ExtractedMagicPasteData } from '../../types/magicPaste';

/**
 * Props untuk komponen ConfirmCreateModal.
 */
export interface ConfirmCreateModalProps {
  /** Data hasil ekstraksi yang akan dikonfirmasi. */
  data: ExtractedMagicPasteData;
  /** Dipanggil saat tombol Create diklik. */
  onConfirm: () => void;
  /** Dipanggil saat modal ditutup (Cancel / klik overlay). */
  onCancel: () => void;
  /** true saat proses create berjalan. */
  isLoading: boolean;
}

/** Format harga ke format Rp Indonesia. */
function formatPrice(price: number | null): string {
  if (price == null) return '-';
  return `Rp ${price.toLocaleString('id-ID')}`;
}

/**
 * Modal konfirmasi final sebelum produk dibuat.
 * Menampilkan data ekstraksi dalam tabel + warning jika confidence < 80%.
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Konfirmasi pembuatan produk"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={isLoading ? undefined : onCancel}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-xl"
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

        {/* Body: tabel data */}
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
                  {data.categoryId ? (data.categoryHint ?? 'Tercocokkan') : 'Tidak ada kecocokan'}
                </td>
              </tr>
              <tr>
                <td className="py-2 pr-4 text-slate-500">Tingkat Cocok</td>
                <td className="py-2 text-right font-medium text-slate-900">{pct}%</td>
              </tr>
            </tbody>
          </table>
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
            onClick={onConfirm}
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
