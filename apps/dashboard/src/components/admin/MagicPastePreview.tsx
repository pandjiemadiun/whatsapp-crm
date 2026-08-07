import { CheckCircle2, Loader2 } from 'lucide-react';
import type { ExtractedMagicPasteData } from '../../types/magicPaste';

/**
 * Props untuk komponen MagicPastePreview.
 */
export interface MagicPastePreviewProps {
  /** Data hasil ekstraksi yang akan ditampilkan (read-only). */
  data: ExtractedMagicPasteData;
  /** Dipanggil saat tombol "Create Product" diklik. */
  onConfirm: () => void;
  /** true saat proses create berjalan (disable tombol). */
  isLoading?: boolean;
}

/** Format harga ke format Rp Indonesia. */
function formatPrice(price: number | null): string {
  if (price == null) return '-';
  return `Rp ${price.toLocaleString('id-ID')}`;
}

/**
 * Tabel read-only preview hasil ekstraksi + tombol Create Product.
 *
 * Contoh:
 * ```tsx
 * <MagicPastePreview data={extracted} onConfirm={openModal} isLoading={creating} />
 * ```
 */
export function MagicPastePreview({ data, onConfirm, isLoading = false }: MagicPastePreviewProps) {
  const hasCategory = !!data.categoryId;

  /** Warna bar confidence: hijau ≥80%, kuning 60–79%, merah <60%. */
  const barColor =
    data.confidence >= 0.8
      ? 'bg-green-600'
      : data.confidence >= 0.6
        ? 'bg-yellow-500'
        : 'bg-red-600';

  const pct = Math.round(data.confidence * 100);

  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6">
      <h3 className="mb-4 text-sm font-semibold text-slate-700">Preview Hasil Ekstraksi</h3>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-1">
          <p className="text-xs text-slate-500">Nama</p>
          <p className="text-sm font-medium text-slate-900">{data.name ?? '-'}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-slate-500">Harga</p>
          <p className="text-sm font-medium text-slate-900">{formatPrice(data.price)}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-slate-500">Stok</p>
          <p className="text-sm font-medium text-slate-900">{data.stock ?? 'Tidak ditentukan'}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-slate-500">Kategori</p>
          <p className="text-sm font-medium text-slate-900">
            {hasCategory ? (data.categoryHint ?? 'Tercocokkan') : 'Tidak ada kecocokan'}
          </p>
        </div>
      </div>

      {/* Confidence bar */}
      <div className="mt-5">
        <div className="mb-1 flex items-center justify-between">
          <p className="text-xs text-slate-500">Tingkat cocok</p>
          <span className="text-xs font-medium text-slate-700">{pct >= 80 ? "Tinggi" : pct >= 50 ? "Sedang" : "Rendah"}</span>
        </div>
        <div
          role="progressbar"
          aria-label="Tingkat cocok"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-2 w-full overflow-hidden rounded-full bg-slate-100"
        >
          <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Tombol aksi */}
      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={onConfirm}
          disabled={isLoading}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-green-300"
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
          {isLoading ? 'Membuat...' : 'Create Product'}
        </button>
      </div>
    </div>
  );
}
