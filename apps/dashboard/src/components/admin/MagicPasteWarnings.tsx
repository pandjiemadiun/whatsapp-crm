import { AlertCircle } from 'lucide-react';

/**
 * Props untuk komponen MagicPasteWarnings.
 */
export interface MagicPasteWarningsProps {
  /** Daftar pesan warning dari backend (max 3). */
  warnings: string[];
  /** Skor keyakinan 0.0–1.0. */
  confidence: number;
  /** true jika kategori berhasil dicocokkan. */
  hasCategory: boolean;
}

/**
 * Badge + daftar warning hasil ekstraksi Magic Paste.
 * Tampil jika confidence < 0.8 ATAU kategori tidak ditemukan.
 *
 * Contoh:
 * ```tsx
 * <MagicPasteWarnings warnings={['Stock ambiguous...']} confidence={0.6} hasCategory={false} />
 * ```
 */
export function MagicPasteWarnings({ warnings, confidence, hasCategory }: MagicPasteWarningsProps) {
  const lowConfidence = confidence < 0.8;
  const show = lowConfidence || !hasCategory || warnings.length > 0;

  if (!show) return null;

  const items: string[] = [];
  if (lowConfidence) {
    items.push(`Extraction confidence rendah (${Math.round(confidence * 100)}%) — mohon review data`);
  }
  if (!hasCategory) {
    items.push('Kategori tidak ditemukan — produk akan dibuat tanpa kategori');
  }
  for (const w of warnings) {
    if (items.length < 3) items.push(w);
  }

  return (
    <div
      role="alert"
      aria-label="Peringatan ekstraksi"
      className="mt-4 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3"
    >
      <div className="flex items-center gap-2 text-yellow-700">
        <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="text-sm font-medium">Perlu perhatian</span>
      </div>
      <ul className="mt-2 space-y-1">
        {items.slice(0, 3).map((item, idx) => (
          <li key={idx} className="text-sm text-yellow-700/90">
            • {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
