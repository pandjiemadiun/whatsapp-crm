import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Plus, Package, Wand2, Pencil, Trash2, Loader2, AlertCircle, CheckCircle2, X, Camera,
} from 'lucide-react';
import api from '../services/api';
import ConfirmDialog from '../components/ConfirmDialog';
import { useAuth } from '../contexts/AuthContext';
import { ProductForm } from '../components/shared/ProductForm';

interface Product {
  id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  sku: string | null;
  stock: number | null;
  weight: number;
  primaryImageUrl: string | null;
  categoryId: string | null;
  isActive: boolean;
  source: string;
  hasVariants: boolean;
}

interface Category {
  id: string;
  name: string;
}

interface MpVariantAttr {
  key: string;
  value: string;
}

interface MpVariant {
  attributes: MpVariantAttr[];
  price: string;
  stock: string;
  sku: string;
}

interface MagicPasteExtracted {
  name: string | null;
  price: number | null;
  stock: number | null;
  categoryId: string | null;
  categoryHint: string | null;
  confidence: number;
  weight: number | null;
  variants: Array<{ attributes: Record<string, string>; price: number; stock: number | null; sku: string | null }> | null;
  variantConfidence: number | null;
}

/** Price-like number pattern: supports thousand-separator dots/commas, K/rb/ribu suffixes. */
const PRICE_RE = /\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?|\d+\s*(?:K|rb|ribu|M|juta)/i;

/** A "variant line" = a single short token (option-like, ≤15 chars) + a clean price. */
const VARIANT_LINE_RE = /^\s*(\S{1,15})\s+(\d[\d.,]*)\s*$/;

/** Detect if a line contains a price-like number. */
function hasPrice(line: string): boolean {
  return PRICE_RE.test(line);
}

/** Detect if a line looks like a single option + price (variant pattern). */
function looksLikeVariantLine(line: string): boolean {
  return VARIANT_LINE_RE.test(line);
}

/**
 * Classify multi-line pasted text as either:
 *  - 'single' = ONE product whose lines are option+price variants (or a name header
 *    followed by variant lines)
 *  - 'batch' = MULTIPLE independent products
 *
 * Heuristic: if the first line has NO price (acts as a name/header) AND at least
 * 2 subsequent lines match the variant pattern (short token + price), treat as
 * single-product-with-variants. Otherwise batch.
 *
 * Limitations: inherently ambiguous. A genuine multi-product list where each line
 * is "short token + price" (e.g. "Apel 5000\nJeruk 6000") will be classified as
 * single-with-variants. The preview-before-save UX is the safety net — the owner
 * sees the interpretation and can correct/retry.
 */
function classifyMultiLineIntent(lines: string[]): 'single' | 'batch' {
  if (lines.length <= 1) return 'single';
  const [first, ...rest] = lines;
  if (hasPrice(first)) return 'batch';
  const variantLineCount = rest.filter(looksLikeVariantLine).length;
  return variantLineCount >= 2 ? 'single' : 'batch';
}

function formatRupiah(v: number | null | undefined): string {
  if (v == null) return '—';
  return `Rp ${Number(v).toLocaleString('id-ID')}`;
}

export default function ProductsPage() {
  const { user } = useAuth();
  const ownStoreId = user?.storeId || '';
  const [tab, setTab] = useState<'list' | 'magic'>('list');
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirmProduct, setDeleteConfirmProduct] = useState<Product | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadTargetId, setUploadTargetId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailVariants, setDetailVariants] = useState<Array<{ id: string; price: number; attributes: Record<string, string>; stock: number | null; sku: string | null }>>([]);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');

  // ── Magic Paste state ──
  const [mpText, setMpText] = useState('');
  const [mpLoading, setMpLoading] = useState(false);
  const [mpExtracted, setMpExtracted] = useState<MagicPasteExtracted | null>(null);
  const [mpError, setMpError] = useState('');
  const [mpEdit, setMpEdit] = useState(false);
  const [mpBatch, setMpBatch] = useState<{
    items: Array<{
      index: number;
      line: string;
      status: 'success' | 'failed' | 'skipped';
      product: null;
      extractedEntities: MagicPasteExtracted | null;
      error: string | null;
      warning: string[] | null;
      needsWeightInput?: boolean;
    }>;
    summary: { total: number; success: number; failed: number; skipped: number };
   } | null>(null);

  // ── Magic Paste — merchant-edited variant state (PV-P3 preview edit) ──
  const [mpVariants, setMpVariants] = useState<MpVariant[]>([]);

  const syncMpVariantsFromExtracted = (extracted: MagicPasteExtracted | null) => {
    if (!extracted?.variants?.length) {
      setMpVariants([]);
      return;
    }
    setMpVariants(
      extracted.variants.map((v) => ({
        attributes: Object.entries(v.attributes ?? {}).map(([key, value]) => ({ key, value: String(value ?? '') })),
        price: v.price === undefined ? '' : String(v.price),
        stock: v.stock == null ? '' : String(v.stock),
        sku: v.sku ?? '',
      }))
    );
  };

  const addMpVariant = () =>
    setMpVariants((prev) => [...prev, { attributes: [{ key: '', value: '' }], price: '', stock: '', sku: '' }]);

  const removeMpVariant = (idx: number) =>
    setMpVariants((prev) => prev.filter((_, i) => i !== idx));

  const clearAllMpVariants = () => {
    if (window.confirm('Hapus semua varian? Produk akan dibuat sebagai simple product.')) {
      setMpVariants([]);
    }
  };

  const updateMpVariantField = (idx: number, field: 'price' | 'stock' | 'sku', value: string) => {
    setMpVariants((prev) => prev.map((v, i) => (i === idx ? { ...v, [field]: value } : v)));
  };

  const updateMpAttr = (vi: number, ai: number, field: 'key' | 'value', value: string) => {
    setMpVariants((prev) =>
      prev.map((v, i) =>
        i === vi ? { ...v, attributes: v.attributes.map((a, j) => (j === ai ? { ...a, [field]: value } : a)) } : v
      )
    );
  };

  const addMpAttr = (vi: number) => {
    setMpVariants((prev) =>
      prev.map((v, i) => (i === vi ? { ...v, attributes: [...v.attributes, { key: '', value: '' }] } : v))
    );
  };

  const removeMpAttr = (vi: number, ai: number) => {
    setMpVariants((prev) =>
      prev.map((v, i) => (i === vi ? { ...v, attributes: v.attributes.filter((_, j) => j !== ai) } : v))
    );
  };

  const mpVariantsToOverrides = (): Array<{ attributes: Record<string, string>; price: number; stock: number | null; sku: string | null }> => {
    return mpVariants.map((v) => {
      const attrs: Record<string, string> = {};
      for (const a of v.attributes) {
        if (a.key.trim()) attrs[a.key.trim()] = a.value.trim();
      }
      return {
        attributes: attrs,
        price: Number(v.price),
        stock: v.stock.trim() === '' ? null : Number(v.stock),
        sku: v.sku.trim() === '' ? null : v.sku.trim(),
      };
    });
  };

  const showFeedback = (type: 'success' | 'error', msg: string) => {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 4000);
  };

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/products/my');
      setProducts(res.data.data.products);
    } catch (err: any) {
      showFeedback('error', err?.response?.data?.error || 'Gagal memuat produk');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCategories = useCallback(async () => {
    try {
      const res = await api.get('/products/my/categories');
      setCategories(res.data.data);
    } catch {
      // kategori opsional — abaikan jika gagal
    }
  }, []);

  useEffect(() => {
    loadProducts();
    loadCategories();
  }, [loadProducts, loadCategories]);

  const filteredProducts = products.filter((p) => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === '' || p.categoryId === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (p: Product) => {
    setEditing(p);
    setModalOpen(true);
  };

  const openDetail = async (p: Product) => {
    setDetailProduct(p);
    setDetailLoading(true);
    setDetailVariants([]);
    try {
      const res = await api.get(`/products/my/${p.id}`);
      const data = res.data.data;
      setDetailVariants(Array.isArray(data.variants) ? data.variants : []);
      setDetailProduct({ ...p, description: data.description ?? p.description });
    } catch {
      setDetailVariants([]);
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setDetailProduct(null);
    setDetailVariants([]);
    setDetailLoading(false);
  };

  const handleDelete = (p: Product) => {
    setDeleteConfirmProduct(p);
  };

  const confirmDelete = async () => {
    if (!deleteConfirmProduct) return;
    setDeletingId(deleteConfirmProduct.id);
    try {
      await api.delete(`/products/my/${deleteConfirmProduct.id}`);
      showFeedback('success', 'Produk dihapus');
      loadProducts();
    } catch (err: any) {
      showFeedback('error', err?.response?.data?.error || 'Gagal menghapus produk');
    } finally {
      setDeletingId(null);
      setDeleteConfirmProduct(null);
    }
  };

  // ── Upload image handlers ──
  const triggerUpload = (productId: string) => {
    setUploadTargetId(productId);
    setTimeout(() => fileInputRef.current?.click(), 0);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !uploadTargetId) return;

    if (!file.type.startsWith('image/')) {
      showFeedback('error', 'Hanya file gambar yang diizinkan');
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      showFeedback('error', 'Ukuran gambar maksimal 3MB');
      return;
    }

    setUploadingId(uploadTargetId);
    try {
      const fd = new FormData();
      fd.append('image', file);
      await api.post(`/products/my/${uploadTargetId}/image`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      showFeedback('success', 'Gambar produk diperbarui');
      loadProducts();
    } catch (err: any) {
      showFeedback('error', err?.response?.data?.error || 'Gagal upload gambar');
    } finally {
      setUploadingId(null);
      setUploadTargetId(null);
    }
  };

  // ── Magic Paste handlers ──
  const handleMpExtract = async (create: boolean, overrides?: { name?: string; price?: number; stock?: number | null; weight?: number | null }) => {
    const text = mpText.trim();
    if (text.length < 10) {
      setMpError('Minimal 10 karakter');
      return;
    }
    setMpLoading(true);
    setMpError('');
    try {
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
      const intent = classifyMultiLineIntent(lines);

      if (intent === 'batch') {
        const url = create
          ? '/products/my/magic-paste/batch'
          : '/products/my/magic-paste/batch?preview=true';
        const res = await api.post(url, { text });
        if (res.data.success) {
          const d = res.data.data;
          const items = d.items.map((it: any) => ({
            ...it,
            needsWeightInput: (it.warning ?? []).some((w: string) => /berat/i.test(w)),
            extractedEntities: it.extractedEntities
              ? {
                  name: it.extractedEntities?.name ?? null,
                  price: it.extractedEntities?.price ?? null,
                  stock: it.extractedEntities?.stock ?? null,
                  categoryId: it.extractedEntities?.categoryId ?? null,
                  categoryHint: it.extractedEntities?.categoryHint ?? null,
                  confidence: it.extractedEntities?.confidence ?? 0,
                }
              : null,
          }));
          setMpBatch({ items, summary: d.summary });
          setMpExtracted(null);
          setMpEdit(false);
          if (create) {
            showFeedback('success', `${d.summary.success} produk berhasil dibuat dari ${d.summary.total} baris.`);
            setMpText('');
            setMpBatch(null);
            loadProducts();
          }
        } else {
          setMpError(res.data.error?.message || 'Gagal memproses teks');
        }
        return;
      }

      // Single-product intent (including multi-line "name + variant lines")
      const url = create ? '/products/my/magic-paste' : '/products/my/magic-paste?preview=true';
      const body: Record<string, unknown> = { text };
      if (overrides) body.overrides = overrides;
      if (create) {
        const overridesToSend = mpVariants.length > 0 ? mpVariantsToOverrides() : (mpExtracted?.variants ?? []);
        if (overridesToSend.length) body.variantOverrides = overridesToSend;
      }
      const res = await api.post(url, body);
      if (res.data.success) {
        const d = res.data.data;
        const nextExtracted: MagicPasteExtracted = {
          name: d.extractedEntities?.name ?? null,
          price: d.extractedEntities?.price ?? null,
          stock: d.extractedEntities?.stock ?? null,
          categoryId: d.extractedEntities?.categoryId ?? null,
          categoryHint: d.extractedEntities?.categoryHint ?? null,
          confidence: d.extractedEntities?.confidence ?? 0,
          weight: d.extractedEntities?.weight ?? null,
          variants: d.extractedEntities?.variants ?? null,
          variantConfidence: d.extractedEntities?.variantConfidence ?? null,
        };
        setMpExtracted(nextExtracted);
        syncMpVariantsFromExtracted(nextExtracted);
        setMpBatch(null);
        if (create && d.needsWeightInput) {
          setMpEdit(true);
          showFeedback('error', 'Berat (gram) tidak ditemukan — isi berat sebelum membuat produk.');
        } else if (create && d.product) {
          setMpEdit(false);
          showFeedback('success', 'Produk berhasil dibuat via Magic Paste!');
          setMpText('');
          setMpExtracted(null);
          setMpVariants([]);
          loadProducts();
        } else {
          setMpEdit(false);
        }
      } else {
        setMpError(res.data.error?.message || 'Gagal memproses teks');
      }
    } catch (err: any) {
      setMpError(err?.response?.data?.error || 'Gagal memproses teks');
    } finally {
      setMpLoading(false);
    }
  };

  const handleMpCreateBatch = async () => {
    if (!mpBatch) return;
    const text = mpText.trim();
    if (text.length < 10) return;
    setMpLoading(true);
    setMpError('');
    try {
      const res = await api.post('/products/my/magic-paste/batch', { text });
      if (res.data.success) {
        const d = res.data.data;
        const created = d.items.filter((it: any) => it.product !== null);
        const skipped = d.items.filter((it: any) => it.product === null && (it.warning ?? []).some((w: string) => /berat/i.test(w)));
        if (created.length > 0 && skipped.length === 0) {
          showFeedback('success', `${created.length} produk berhasil dibuat dari ${d.items.length} baris.`);
        } else if (created.length > 0 && skipped.length > 0) {
          showFeedback('success', `${created.length} produk berhasil dibuat, ${skipped.length} baris dilewati (berat belum diisi).`);
        } else {
          showFeedback('error', `Tidak ada produk yang dibuat. Semua baris membutuhkan input berat.`);
        }
        setMpText('');
        setMpBatch(null);
        setMpExtracted(null);
        loadProducts();
      } else {
        setMpError(res.data.error?.message || 'Gagal membuat batch');
      }
    } catch (err: any) {
      setMpError(err?.response?.data?.error || 'Gagal membuat batch');
    } finally {
      setMpLoading(false);
    }
  };

  const stockBadge = (p: Product) => {
    if (p.stock === null) {
      return <span className="text-sm text-muted">Stok tak terbatas</span>;
    }
    if (p.stock <= 5) {
      return (
        <span className="text-xs font-medium text-red-700 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-2 py-0.5 rounded-full">
          Stok menipis: {p.stock}
        </span>
      );
    }
    return <span className="text-sm text-muted">Stok: {p.stock}</span>;
  };

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-7xl mx-auto">
      {/* ── 1. Header ── */}
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-display font-bold text-navy dark:text-surface">Produk</h1>
          <p className="text-sm text-muted">Kelola katalog produk toko Anda</p>
        </div>
        <button
          onClick={openCreate}
className="flex items-center gap-2 bg-brand text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-brand-deep focus-visible:ring-2 focus:ring-brand transition shrink-0"
        >
          <Plus className="w-4 h-4" />
          Tambah Produk
        </button>
      </div>

      {/* Feedback */}
      {feedback && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-medium ${
          feedback.type === 'success'
            ? 'bg-green-50 text-green-700 border border-green-200 dark:bg-green-900/20 dark:border-green-800'
            : 'bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/20 dark:border-red-800'
        }`}>
          {feedback.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {feedback.msg}
        </div>
      )}

      {/* ── 3. Tabs ── */}
      <div className="flex gap-1 border-b border-line dark:border-dline">
        <button
          onClick={() => setTab('list')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition ${
            tab === 'list'
              ? 'border-brand text-brand'
              : 'border-transparent text-muted hover:text-ink'
          }`}
        >
          <Package className="w-4 h-4" />
          Daftar Produk
        </button>
        <button
          onClick={() => setTab('magic')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition ${
            tab === 'magic'
              ? 'border-brand text-brand'
              : 'border-transparent text-muted hover:text-ink'
          }`}
        >
          <Wand2 className="w-4 h-4" />
          Magic Paste
        </button>
      </div>

      {/* ── TAB: LIST ── */}
      {tab === 'list' && (
        <div className="bg-surface dark:bg-dcard rounded-xl border border-line dark:border-dline overflow-hidden">
          {/* Search + category filter (only on Daftar tab) */}
          <div className="p-4 border-b border-line dark:border-dline">
            <div className="flex flex-col md:flex-row gap-3">
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari produk..."
                className="flex-1 px-3 py-2 border border-line dark:border-dline rounded-lg text-sm bg-surface dark:bg-dsurface text-ink placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand"
              />
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="px-3 py-2 border border-line dark:border-dline rounded-lg text-sm bg-surface dark:bg-dsurface text-ink focus:outline-none focus:ring-2 focus:ring-brand"
              >
                <option value="">Semua kategori</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>

          {loading ? (
            <div className="p-8 flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-brand" />
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="p-12 text-center space-y-3">
              <Package className="w-10 h-10 mx-auto text-muted" />
              <p className="text-sm text-muted font-medium">
                {products.length === 0
                  ? 'Belum ada produk. Tambahkan produk pertama Anda.'
                  : 'Tidak ada produk yang cocok dengan filter.'}
              </p>
              <button
                onClick={() => setTab('magic')}
                className="flex items-center gap-2 bg-brand text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-brand-deep focus-visible:ring-2 focus:ring-brand transition mx-auto w-full sm:w-auto"
              >
                <Wand2 className="w-4 h-4" />
                Tambah lewat Magic Paste
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
              <div className="hidden xl:grid grid-cols-12 gap-3 px-5 py-3 bg-surface dark:bg-dline/50 text-xs font-semibold text-muted uppercase tracking-wider">
                <div className="col-span-4">Produk</div>
                <div className="col-span-2">Harga</div>
                <div className="col-span-2">Stok</div>
                <div className="col-span-2">Sumber</div>
                <div className="col-span-2 text-right">Aksi</div>
              </div>
              {filteredProducts.map((p) => (
                <div key={p.id} onClick={() => openDetail(p)} className="grid grid-cols-1 gap-2 p-4 rounded-xl border border-line dark:border-dline bg-surface dark:bg-dcard overflow-hidden cursor-pointer hover:border-brand/50 transition">
                  <div className="flex items-center gap-3 min-w-0">
                    {p.primaryImageUrl ? (
                      <img src={p.primaryImageUrl} alt="" className="w-10 h-10 rounded-lg object-cover border border-line shrink-0" />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-brand-soft dark:bg-brand/15 flex items-center justify-center shrink-0">
                        <Package className="w-5 h-5 text-brand" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-ink dark:text-surface truncate">{p.name}</p>
                      {p.sku && !p.sku.startsWith('AUTO-') && (
                        <p className="text-xs text-muted truncate">{p.sku}</p>
                      )}
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); triggerUpload(p.id); }}
                      disabled={uploadingId === p.id}
                      className="p-1.5 text-muted hover:text-brand hover:bg-brand-soft dark:hover:bg-brand/15 rounded-lg transition shrink-0 disabled:opacity-50"
                      title="Upload gambar produk"
                    >
                      {uploadingId === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                    </button>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted">Harga:</span>
                    <span className="font-medium text-ink dark:text-surface">{formatRupiah(p.price)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted">Stok:</span>
                    {stockBadge(p)}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                      p.source === 'magic_paste'
                        ? 'bg-brand-soft dark:bg-brand/15 text-brand'
                        : 'bg-surface dark:bg-dline text-muted'
                    }`}>
                      {p.source === 'magic_paste' ? 'Magic Paste' : 'Manual'}
                    </span>
                    {p.hasVariants && (
                      <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400">
                        Ada varian
                      </span>
                    )}
                  </div>
                  <div className="flex justify-end gap-1 pt-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); openEdit(p); }}
                      className="p-2 text-muted hover:text-brand hover:bg-brand-soft dark:hover:bg-brand/15 rounded-lg transition"
                      title="Edit"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(p); }}
                      disabled={deletingId === p.id}
                      className="p-2 text-muted hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition disabled:opacity-50"
                      title="Hapus"
                    >
                      {deletingId === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── PRODUCT DETAIL MODAL ── */}
      {detailProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={closeDetail}>
          <div className="bg-surface dark:bg-dcard rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-line dark:border-dline">
              <h2 className="font-display font-bold text-navy dark:text-surface">Detail Produk</h2>
              <button onClick={closeDetail} className="text-muted hover:text-ink dark:text-muted dark:hover:text-surface">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {detailLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-brand" />
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-xs text-muted block mb-0.5">Nama</span>
                      <p className="font-medium text-ink dark:text-surface">{detailProduct.name}</p>
                    </div>
                    <div>
                      <span className="text-xs text-muted block mb-0.5">SKU</span>
                      <p className="font-medium text-ink dark:text-surface">{detailProduct.sku || '—'}</p>
                    </div>
                    <div>
                      <span className="text-xs text-muted block mb-0.5">Harga</span>
                      <p className="font-medium text-ink dark:text-surface">{formatRupiah(detailProduct.price)}</p>
                    </div>
                    <div>
                      <span className="text-xs text-muted block mb-0.5">Stok</span>
                      <p className="font-medium text-ink dark:text-surface">{detailProduct.stock != null ? detailProduct.stock : 'Tak terbatas'}</p>
                    </div>
                    <div>
                      <span className="text-xs text-muted block mb-0.5">Berat</span>
                      <p className="font-medium text-ink dark:text-surface">{detailProduct.weight ? `${detailProduct.weight} gram` : '—'}</p>
                    </div>
                    <div>
                      <span className="text-xs text-muted block mb-0.5">Sumber</span>
                      <p className="font-medium text-ink dark:text-surface">{detailProduct.source === 'magic_paste' ? 'Magic Paste' : 'Manual'}</p>
                    </div>
                    <div className="sm:col-span-2">
                      <span className="text-xs text-muted block mb-0.5">Deskripsi</span>
                      <p className="text-sm text-ink dark:text-surface whitespace-pre-wrap">{detailProduct.description || '—'}</p>
                    </div>
                  </div>
                  {detailVariants.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-line dark:border-dline">
                      <span className="text-xs text-muted block mb-2">Varian ({detailVariants.length})</span>
                      <div className="space-y-2">
                        {detailVariants.map((v) => (
                          <div key={v.id} className="flex items-center justify-between rounded-lg border border-line dark:border-dline px-3 py-2 text-sm">
                            <span className="font-medium text-ink dark:text-surface">
                              {Object.entries(v.attributes).map(([_, val]) => `${val}`).join(' / ')}
                            </span>
                            <span className="text-muted">{formatRupiah(v.price)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-line dark:border-dline">
              <button onClick={closeDetail} className="px-4 py-2 rounded-lg text-sm font-medium text-muted dark:text-muted border border-line dark:border-dline hover:bg-surface dark:hover:bg-dline transition">
                Tutup
              </button>
              <button onClick={() => { closeDetail(); openEdit(detailProduct); }} className="px-4 py-2 rounded-lg text-sm font-semibold bg-brand text-white hover:bg-brand-deep transition">
                Edit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: MAGIC PASTE ── */}
      {tab === 'magic' && (
        <div className="bg-surface dark:bg-dcard rounded-xl border border-line dark:border-dline p-5 sm:p-6 space-y-4 lg:space-y-0 lg:grid lg:grid-cols-2 lg:gap-6 max-w-none">
          <div className="flex items-center gap-3 lg:col-span-2">
            <div className="rounded-xl bg-brand-soft dark:bg-brand/15 p-2.5 text-brand">
              <Wand2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display font-bold text-navy dark:text-surface">Magic Paste</h2>
              <p className="text-sm text-muted">Tempel teks harga/katalog, qlobot ekstrak otomatis</p>
            </div>
          </div>

          {mpError && (
            <div className="lg:col-span-2 flex items-center gap-2 px-4 py-3 rounded-lg text-sm bg-red-50 dark:bg-red-900/20 text-red-700 border border-red-200 dark:border-red-800">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {mpError}
            </div>
          )}

          <div className="space-y-4 lg:col-span-1">
          <div>
            <label className="block text-sm font-medium text-ink dark:text-surface mb-1.5">Teks Produk</label>
            <textarea
              value={mpText}
              onChange={(e) => { setMpText(e.target.value); setMpExtracted(null); setMpBatch(null); setMpError(''); setMpEdit(false); }}
              placeholder="Contoh: Soto ayam spesial harga 25000 stok 100, porsi 1 mangkok, tersedia setiap hari"
              rows={5}
              maxLength={2000}
              className="w-full resize-y rounded-lg border border-line dark:border-dline px-3 py-2 text-sm bg-surface dark:bg-dsurface text-ink placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand"
            />
            <div className="mt-1 text-xs text-muted flex justify-between">
              <span>{mpText.length} / 2000 karakter</span>
              {mpText.length > 0 && mpText.length < 10 && <span className="text-red-600">Minimal 10 karakter</span>}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => handleMpExtract(false)}
              disabled={mpLoading || mpText.trim().length < 10}
              className="flex items-center gap-2 bg-brand text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-brand-deep focus-visible:ring-2 focus:ring-brand disabled:bg-brand/30 transition"
            >
              {mpLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
              {mpLoading ? 'Memproses...' : 'Ekstrak (Preview)'}
            </button>
            {mpExtracted && (
              <button
                onClick={() => handleMpExtract(true, mpEdit ? {
                  name: mpExtracted.name || undefined,
                  price: mpExtracted.price ?? undefined,
                  stock: mpExtracted.stock ?? undefined,
                  weight: mpExtracted.weight ?? undefined,
                } : undefined)}
                disabled={mpLoading}
                className="flex items-center gap-2 bg-green-600 text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-green-700 focus-visible:ring-2 focus:ring-brand disabled:bg-green-300 transition"
              >
                <CheckCircle2 className="w-4 h-4" />
                Buat Produk
              </button>
            )}
            {mpBatch && (() => {
              const creatable = mpBatch.items.filter((it: any) => !it.needsWeightInput).length;
              const blocked = mpBatch.items.filter((it: any) => it.needsWeightInput).length;
              const canCreate = creatable > 0;
              return canCreate ? (
                <button
                  onClick={handleMpCreateBatch}
                  disabled={mpLoading}
                  className="flex items-center gap-2 bg-green-600 text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-green-700 focus-visible:ring-2 focus:ring-brand disabled:bg-green-300 transition"
                >
                  {mpLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  {mpLoading ? 'Membuat...' : `Buat ${creatable} Produk${blocked > 0 ? ` (${blocked} dilewati)` : ''}`}
                </button>
              ) : (
                <p className="text-xs text-red-600 dark:text-red-400">
                  {blocked} baris membutuhkan input berat sebelum dapat dibuat.
                </p>
              );
            })()}
          </div>
          </div>

          {/* Batch preview + per-item extraction result (right column at lg+) */}
          <div className="space-y-4 lg:col-span-1">
          {/* Batch preview */}
          {mpBatch && (
            <div className="rounded-lg border border-brand/30 bg-brand-soft dark:bg-brand/15 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-brand">
                  Hasil Batch ({mpBatch.summary.total} baris)
                </h3>
                <div className="flex gap-2 text-xs font-medium">
                  <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400">
                    {mpBatch.summary.success} sukses
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400">
                    {mpBatch.summary.failed} gagal
                  </span>
                  {mpBatch.summary.skipped > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-line text-muted dark:bg-dline dark:text-muted">
                      {mpBatch.summary.skipped} dilewati
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                {mpBatch.items.map((it) => (
                  <div
                    key={it.index}
                    className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${
                      it.status === 'success'
                        ? 'bg-surface border-green-200 dark:bg-dcard dark:border-green-800'
                        : it.status === 'failed'
                          ? 'bg-surface border-red-200 dark:bg-dcard dark:border-red-800'
                          : 'bg-surface border-line dark:bg-dcard dark:border-dline opacity-70'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-ink dark:text-surface truncate">
                        {it.status === 'success'
                          ? it.extractedEntities?.name || it.line
                          : it.line}
                      </p>
                      <p className="text-xs text-muted truncate">
                        {it.status === 'success'
                          ? `${formatRupiah(it.extractedEntities?.price ?? null)}${it.extractedEntities?.stock != null ? ` · stok ${it.extractedEntities.stock}` : ''}`
                          : it.error || 'Baris dilewati'}
                      </p>
                      {(it.status === 'success' && it.needsWeightInput) && (
                        <p className="text-xs text-red-600 dark:text-red-400 truncate">
                          {(it.warning ?? []).find((w: string) => /berat/i.test(w)) || 'Berat produk belum diisi'}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {it.status === 'success' && it.extractedEntities && (
                        <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${
                          (it.extractedEntities.confidence ?? 0) >= 0.8
                            ? 'bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                            : 'bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'
                        }`}>
                          {(it.extractedEntities.confidence ?? 0) >= 0.8
                            ? 'Data lengkap'
                            : 'Periksa kembali'}
                        </span>
                      )}
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${
                        it.status === 'success'
                          ? 'bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                          : it.status === 'failed'
                            ? 'bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                            : 'bg-surface dark:bg-dline text-muted'
                      }`}>
                        {it.status === 'success' ? 'OK' : it.status === 'failed' ? 'Gagal' : 'Skip'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {mpBatch.summary.failed > 0 && (
                <p className="text-xs text-red-600 dark:text-red-400">
                  {mpBatch.summary.failed} baris tidak bisa diproses (nama/harga tidak terdeteksi). Perbaiki barisnya lalu coba lagi.
                </p>
              )}
              {mpBatch.items.some((it: any) => it.needsWeightInput) && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {mpBatch.items.filter((it: any) => it.needsWeightInput).length} baris membutuhkan input berat (gram) sebelum dapat dibuat.
                </p>
              )}
            </div>
          )}

          {mpExtracted && (
            <div className="rounded-lg border border-brand/30 bg-brand-soft dark:bg-brand/15 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-brand">Hasil Ekstraksi</h3>
                <div className="flex items-center gap-1">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    mpExtracted.confidence >= 0.8
                      ? 'bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                      : 'bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'
                  }`}>
                    {mpExtracted.confidence >= 0.8 ? 'Data lengkap & akurat' : 'Periksa kembali sebelum simpan'}
                  </span>
                  {mpEdit ? (
                    <button
                      onClick={() => setMpEdit(false)}
                      className="p-0.5 text-muted hover:bg-line dark:hover:bg-dline rounded transition"
                      title="Batal edit"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      onClick={() => setMpEdit(true)}
                      className="p-0.5 text-brand hover:bg-brand-soft dark:hover:bg-brand/15 rounded transition"
                      title="Edit hasil ekstraksi"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-xs text-muted">Nama</span>
                  {mpEdit ? (
                    <input
                      value={mpExtracted.name || ''}
                      onChange={(e) => setMpExtracted({ ...mpExtracted, name: e.target.value || null })}
                      className="w-full mt-0.5 px-2 py-1 border border-line dark:border-dline rounded text-sm bg-surface dark:bg-dsurface text-ink focus:outline-none focus:ring-1 focus:ring-brand"
                    />
                  ) : (
                    <p className="font-medium text-ink dark:text-surface">{mpExtracted.name || '—'}</p>
                  )}
                </div>
                <div>
                  <span className="text-xs text-muted">Harga</span>
                  {mpEdit ? (
                    <input
                      type="number"
                      value={mpExtracted.price != null ? String(mpExtracted.price) : ''}
                      onChange={(e) => setMpExtracted({ ...mpExtracted, price: e.target.value ? Number(e.target.value) : null })}
                      className="w-full mt-0.5 px-2 py-1 border border-line dark:border-dline rounded text-sm bg-surface dark:bg-dsurface text-ink focus:outline-none focus:ring-1 focus:ring-brand"
                    />
                  ) : (
                    <p className="font-medium text-ink dark:text-surface">{mpExtracted.price != null ? formatRupiah(mpExtracted.price) : '—'}</p>
                  )}
                </div>
                <div>
                  <span className="text-xs text-muted">Stok</span>
                  {mpEdit ? (
                    <input
                      type="number"
                      value={mpExtracted.stock != null ? String(mpExtracted.stock) : ''}
                      onChange={(e) => setMpExtracted({ ...mpExtracted, stock: e.target.value ? Number(e.target.value) : null })}
                      className="w-full mt-0.5 px-2 py-1 border border-line dark:border-dline rounded text-sm bg-surface dark:bg-dsurface text-ink focus:outline-none focus:ring-1 focus:ring-brand"
                    />
                  ) : (
                    <p className="font-medium text-ink dark:text-surface">{mpExtracted.stock != null ? mpExtracted.stock : '—'}</p>
                  )}
                </div>
                <div>
                  <span className="text-xs text-muted">Berat (gram)</span>
                  {mpEdit ? (
                    <input
                      type="number"
                      value={mpExtracted.weight != null ? String(mpExtracted.weight) : ''}
                      onChange={(e) => setMpExtracted({ ...mpExtracted, weight: e.target.value ? Number(e.target.value) : null })}
                      placeholder="Wajib diisi"
                      className="w-full mt-0.5 px-2 py-1 border border-line dark:border-dline rounded text-sm bg-surface dark:bg-dsurface text-ink focus:outline-none focus:ring-1 focus:ring-brand"
                    />
                  ) : (
                    <p className={`font-medium ${mpExtracted.weight ? 'text-ink dark:text-surface' : 'text-red-600 dark:text-red-400'}`}>
                      {mpExtracted.weight != null ? `${mpExtracted.weight} gram` : '— (belum diisi)'}
                    </p>
                  )}
                </div>
                <div className="sm:col-span-2">
                  <span className="text-xs text-muted">Kategori</span>
                  <p className="font-medium text-ink dark:text-surface">{mpExtracted.categoryHint || mpExtracted.categoryId || '—'}</p>
                </div>
              </div>
              {mpVariants.length > 0 && (
                <div className="mt-3 pt-3 border-t border-line dark:border-dline">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-muted block">Varian ({mpVariants.length})</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={clearAllMpVariants}
                        disabled={mpLoading}
                        className="text-xs font-medium text-slate-600 underline decoration-slate-300 underline-offset-2 hover:text-slate-800 disabled:cursor-not-allowed"
                      >
                        Clear all
                      </button>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {mpVariants.map((v, vi) => (
                      <div key={vi} className="rounded-lg border border-line dark:border-dline p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-muted">Varian #{vi + 1}</span>
                          <button
                            type="button"
                            onClick={() => removeMpVariant(vi)}
                            disabled={mpLoading}
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                            aria-label={`Hapus varian #${vi + 1}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        {/* attributes (key/value pairs — konvensi ConfirmCreateModal) */}
                        <div className="space-y-1.5">
                          {v.attributes.map((a, ai) => (
                            <div key={ai} className="flex items-center gap-1.5">
                              <input
                                type="text"
                                value={a.key}
                                onChange={(e) => updateMpAttr(vi, ai, 'key', e.target.value)}
                                disabled={mpLoading}
                                placeholder="size"
                                className="w-1/2 rounded-lg border border-line dark:border-dline px-2 py-1 text-sm bg-surface dark:bg-dsurface text-ink focus:outline-none focus:ring-1 focus:ring-brand"
                              />
                              <input
                                type="text"
                                value={a.value}
                                onChange={(e) => updateMpAttr(vi, ai, 'value', e.target.value)}
                                disabled={mpLoading}
                                placeholder="L"
                                className="w-1/2 rounded-lg border border-line dark:border-dline px-2 py-1 text-sm bg-surface dark:bg-dsurface text-ink focus:outline-none focus:ring-1 focus:ring-brand"
                              />
                              <button
                                type="button"
                                onClick={() => removeMpAttr(vi, ai)}
                                disabled={mpLoading}
                                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                                aria-label="Hapus atribut"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={() => addMpAttr(vi)}
                            disabled={mpLoading}
                            className="flex items-center gap-1 text-xs font-medium text-brand hover:text-brand-deep"
                          >
                            <Plus className="h-3 w-3" /> Tambah atribut
                          </button>
                        </div>

                        {/* price / stock / sku */}
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="block text-xs text-muted">Harga (IDR)</label>
                            <input
                              type="number"
                              value={v.price}
                              onChange={(e) => updateMpVariantField(vi, 'price', e.target.value)}
                              disabled={mpLoading}
                              placeholder="10000"
                              className="mt-0.5 w-full rounded-lg border border-line dark:border-dline px-2 py-1 text-sm bg-surface dark:bg-dsurface text-ink focus:outline-none focus:ring-1 focus:ring-brand"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-muted">Stok</label>
                            <input
                              type="number"
                              value={v.stock}
                              onChange={(e) => updateMpVariantField(vi, 'stock', e.target.value)}
                              disabled={mpLoading}
                              placeholder="100"
                              className="mt-0.5 w-full rounded-lg border border-line dark:border-dline px-2 py-1 text-sm bg-surface dark:bg-dsurface text-ink focus:outline-none focus:ring-1 focus:ring-brand"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-muted">SKU</label>
                            <input
                              type="text"
                              value={v.sku}
                              onChange={(e) => updateMpVariantField(vi, 'sku', e.target.value)}
                              disabled={mpLoading}
                              placeholder="opsional"
                              className="mt-0.5 w-full rounded-lg border border-line dark:border-dline px-2 py-1 text-sm bg-surface dark:bg-dsurface text-ink focus:outline-none focus:ring-1 focus:ring-brand"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={addMpVariant}
                    disabled={mpLoading}
                    className="mt-3 flex items-center gap-1.5 rounded-lg border border-line dark:border-dline px-3 py-1.5 text-sm font-medium text-ink dark:text-surface hover:bg-surface dark:hover:bg-dline disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Plus className="h-3.5 w-3.5" /> Tambah varian
                  </button>
                </div>
              )}
              {mpExtracted.confidence < 0.8 && (
                <p className="text-xs text-amber-700 dark:text-amber-400">Review data di atas sebelum membuat produk.</p>
              )}
            </div>
          )}
        </div>
        </div>
      )}

      {/* ── Product Form Modal (shared component) ── */}
      {modalOpen && (
        <ProductForm
          mode="merchant"
          storeId={ownStoreId}
          product={editing}
          onSaved={() => {
            showFeedback('success', editing ? 'Produk berhasil diupdate' : 'Produk berhasil ditambahkan');
            setModalOpen(false);
            setEditing(null);
            loadProducts();
          }}
          onCancel={() => {
            setModalOpen(false);
            setEditing(null);
          }}
        />
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Delete confirmation */}
      {deleteConfirmProduct && (
        <ConfirmDialog
          title="Hapus Produk"
          message={`Hapus produk "${deleteConfirmProduct.name}"?`}
          consequence="Produk akan dihapus permanen."
          onConfirm={confirmDelete}
          onCancel={() => setDeleteConfirmProduct(null)}
        />
      )}
    </div>
  );
}
