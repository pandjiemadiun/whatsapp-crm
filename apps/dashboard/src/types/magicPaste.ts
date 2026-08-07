/**
 * Tipe data untuk fitur Magic Paste (Phase 1.9.4).
 * Admin menempel teks bebas → backend extract → preview → konfirmasi → create product.
 */

/**
 * Data hasil ekstraksi produk dari teks (bentuk yang ditampilkan di preview).
 */
export interface ExtractedMagicPasteData {
  /** Nama produk hasil ekstraksi */
  name: string | null;
  /** Harga dalam IDR (integer) */
  price: number | null;
  /** Stok (null = tidak disebut / unit-based) */
  stock: number | null;
  /** ID kategori hasil fuzzy match (null = tidak ada kecocokan) */
  categoryId: string | null;
  /** Hint kategori mentah dari teks */
  categoryHint: string | null;
  /** Skor keyakinan 0.0–1.0 */
  confidence: number;
}

/**
 * Response lengkap dari POST /api/admin/products/magic-paste.
 */
export interface MagicPasteResponse {
  success: boolean;
  data?: {
    product: {
      id: string;
      storeId: string;
      name: string;
      price: number;
      stock: number | null;
      categoryId: string | null;
      sku: string;
      source: string;
      createdAt: string;
    };
    extractedEntities: ExtractedMagicPasteData;
    warning: string[] | null;
  };
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
  };
}

/**
 * State form Magic Paste di hook useMagicPaste.
 */
export interface MagicPasteFormState {
  /** Teks mentah dari textarea */
  text: string;
  /** ID store yang dipilih (dari store selector) */
  storeId: string;
  /** Sedang proses extract API */
  loading: boolean;
  /** Data hasil ekstraksi (null = belum extract) */
  extracted: ExtractedMagicPasteData | null;
  /** Pesan error terakhir */
  error: string | null;
}

/**
 * Batas karakter textarea.
 */
export const MAGIC_PASTE_MAX_CHARS = 2000;

/**
 * Minimal karakter sebelum tombol Extract aktif.
 */
export const MAGIC_PASTE_MIN_CHARS = 10;

/**
 * Pattern ekstraksi regex yang dikelola admin (Phase 1.9.8).
 */
export interface MagicPastePattern {
  id: string;
  name: string;
  description: string;
  regex: string;
  fieldMappings: Array<{ field: string; group: number }>;
  confidence: number;
  isActive: boolean;
  sortOrder: number;
}

/**
 * Pengaturan Magic Paste (Phase 1.9.8).
 */
export interface MagicPasteSettings {
  regexFirstThreshold: number;
  llmEnabled: boolean;
  cacheEnabled: boolean;
}

/**
 * Response GET /api/admin/magic-paste.
 */
export interface MagicPasteConfigResponse {
  success: boolean;
  data?: {
    patterns: MagicPastePattern[];
    settings: MagicPasteSettings;
  };
  error?: { code?: string; message?: string };
}
