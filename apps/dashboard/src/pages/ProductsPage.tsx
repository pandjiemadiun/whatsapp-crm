import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Plus, Package, Wand2, Pencil, Trash2, Loader2, AlertCircle, CheckCircle2, X, Camera,
} from 'lucide-react';
import api from '../services/api';
import ConfirmDialog from '../components/ConfirmDialog';

interface Product {
  id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  sku: string | null;
  stock: number | null;
  primaryImageUrl: string | null;
  categoryId: string | null;
  isActive: boolean;
  source: string;
}

interface Category {
  id: string;
  name: string;
}

interface MagicPasteExtracted {
  name: string | null;
  price: number | null;
  stock: number | null;
  categoryId: string | null;
  categoryHint: string | null;
  confidence: number;
}

const EMPTY_FORM = { name: '', price: '', stock: '', description: '', categoryId: '' };

function formatRupiah(v: number | null | undefined): string {
  if (v == null) return '—';
  return `Rp ${Number(v).toLocaleString('id-ID')}`;
}

export default function ProductsPage() {
  const [tab, setTab] = useState<'list' | 'magic'>('list');
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirmProduct, setDeleteConfirmProduct] = useState<Product | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadTargetId, setUploadTargetId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
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
    }>;
    summary: { total: number; success: number; failed: number; skipped: number };
  } | null>(null);

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
    setForm(EMPTY_FORM);
    setFormError('');
    setModalOpen(true);
  };

  const openEdit = (p: Product) => {
    setEditing(p);
    setForm({
      name: p.name,
      price: String(p.price),
      stock: p.stock != null ? String(p.stock) : '',
      description: p.description || '',
      categoryId: p.categoryId || '',
    });
    setFormError('');
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setFormError('Nama produk wajib diisi');
      return;
    }
    const price = Number(form.price);
    if (form.price === '' || isNaN(price) || price < 0) {
      setFormError('Harga wajib diisi dan tidak boleh negatif');
      return;
    }
    const payload = {
      name: form.name.trim(),
      price,
      stock: form.stock === '' ? null : Number(form.stock),
      description: form.description.trim() || null,
      categoryId: form.categoryId || null,
    };

    setSaving(true);
    setFormError('');
    try {
      if (editing) {
        await api.put(`/products/my/${editing.id}`, payload);
        showFeedback('success', 'Produk berhasil diupdate');
      } else {
        await api.post('/products/my', payload);
        showFeedback('success', 'Produk berhasil ditambahkan');
      }
      setModalOpen(false);
      loadProducts();
    } catch (err: any) {
      setFormError(err?.response?.data?.error || 'Gagal menyimpan produk');
    } finally {
      setSaving(false);
    }
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
  const handleMpExtract = async (create: boolean, overrides?: { name?: string; price?: number; stock?: number | null }) => {
    const text = mpText.trim();
    if (text.length < 10) {
      setMpError('Minimal 10 karakter');
      return;
    }
    setMpLoading(true);
    setMpError('');
    try {
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
      const isBatch = lines.length > 1;

      if (isBatch) {
        const url = create
          ? '/products/my/magic-paste/batch'
          : '/products/my/magic-paste/batch?preview=true';
        const res = await api.post(url, { text });
        if (res.data.success) {
          const d = res.data.data;
          const items = d.items.map((it: any) => ({
            ...it,
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

      const url = create ? '/products/my/magic-paste' : '/products/my/magic-paste?preview=true';
      const res = await api.post(url, { text, ...(overrides ? { overrides } : {}) });
      if (res.data.success) {
        const d = res.data.data;
        setMpExtracted({
          name: d.extractedEntities?.name ?? null,
          price: d.extractedEntities?.price ?? null,
          stock: d.extractedEntities?.stock ?? null,
          categoryId: d.extractedEntities?.categoryId ?? null,
          categoryHint: d.extractedEntities?.categoryHint ?? null,
          confidence: d.extractedEntities?.confidence ?? 0,
        });
        setMpBatch(null);
        setMpEdit(false);
        if (create) {
          showFeedback('success', 'Produk berhasil dibuat via Magic Paste!');
          setMpText('');
          setMpExtracted(null);
          setMpEdit(false);
          loadProducts();
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
        const s = res.data.data.summary;
        showFeedback('success', `${s.success} produk berhasil dibuat (${s.failed} gagal, ${s.skipped} dilewati).`);
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
                <div key={p.id} className="grid grid-cols-1 gap-2 p-4 rounded-xl border border-line dark:border-dline bg-surface dark:bg-dcard overflow-hidden">
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
                      onClick={() => triggerUpload(p.id)}
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
                  <div>
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                      p.source === 'magic_paste'
                        ? 'bg-brand-soft dark:bg-brand/15 text-brand'
                        : 'bg-surface dark:bg-dline text-muted'
                    }`}>
                      {p.source === 'magic_paste' ? 'Magic Paste' : 'Manual'}
                    </span>
                  </div>
                  <div className="flex justify-end gap-1 pt-1">
                    <button
                      onClick={() => openEdit(p)}
                      className="p-2 text-muted hover:text-brand hover:bg-brand-soft dark:hover:bg-brand/15 rounded-lg transition"
                      title="Edit"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(p)}
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
                } : undefined)}
                disabled={mpLoading}
                className="flex items-center gap-2 bg-green-600 text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-green-700 focus-visible:ring-2 focus:ring-brand disabled:bg-green-300 transition"
              >
                <CheckCircle2 className="w-4 h-4" />
                Buat Produk
              </button>
            )}
            {mpBatch && mpBatch.summary.success > 0 && (
              <button
                onClick={handleMpCreateBatch}
                disabled={mpLoading}
                className="flex items-center gap-2 bg-green-600 text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-green-700 focus-visible:ring-2 focus:ring-brand disabled:bg-green-300 transition"
              >
                {mpLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {mpLoading ? 'Membuat...' : `Buat ${mpBatch.summary.success} Produk`}
              </button>
            )}
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
                  <span className="text-xs text-muted">Kategori</span>
                  <p className="font-medium text-ink dark:text-surface">{mpExtracted.categoryHint || mpExtracted.categoryId || '—'}</p>
                </div>
              </div>
              {mpExtracted.confidence < 0.8 && (
                <p className="text-xs text-amber-700 dark:text-amber-400">Review data di atas sebelum membuat produk.</p>
              )}
            </div>
          )}
        </div>
        </div>
      )}

      {/* ── MODAL: Tambah/Edit ── */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-surface dark:bg-dcard rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-line dark:border-dline">
              <h2 className="font-display font-bold text-navy dark:text-surface">
                {editing ? 'Edit Produk' : 'Tambah Produk'}
              </h2>
              <button
                onClick={() => setModalOpen(false)}
                className="text-muted hover:text-ink dark:text-muted dark:hover:text-surface"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {formError && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {formError}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-ink dark:text-surface mb-1.5">
                  Nama Produk <span className="text-red-500">*</span>
                </label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Contoh: Soto Ayam Spesial"
                  className="w-full rounded-lg border border-line dark:border-dline px-3 py-2 text-sm bg-surface dark:bg-dsurface text-ink placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-ink dark:text-surface mb-1.5">
                    Harga (Rp) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    value={form.price}
                    onChange={(e) => setForm({ ...form, price: e.target.value })}
                    placeholder="25000"
                    className="w-full rounded-lg border border-line dark:border-dline px-3 py-2 text-sm bg-surface dark:bg-dsurface text-ink placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink dark:text-surface mb-1.5">Stok</label>
                  <input
                    type="number"
                    value={form.stock}
                    onChange={(e) => setForm({ ...form, stock: e.target.value })}
                    placeholder="100"
                    className="w-full rounded-lg border border-line dark:border-dline px-3 py-2 text-sm bg-surface dark:bg-dsurface text-ink placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-ink dark:text-surface mb-1.5">Kategori</label>
                <select
                  value={form.categoryId}
                  onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                  className="w-full rounded-lg border border-line dark:border-dline px-3 py-2 text-sm bg-surface dark:bg-dsurface text-ink focus:outline-none focus:ring-2 focus:ring-brand"
                >
                  <option value="">— Tanpa kategori —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-ink dark:text-surface mb-1.5">Deskripsi</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Deskripsi singkat produk..."
                  rows={3}
                  maxLength={1000}
                  className="w-full resize-y rounded-lg border border-line dark:border-dline px-3 py-2 text-sm bg-surface dark:bg-dsurface text-ink placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-line dark:border-dline">
              <button
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-muted dark:text-muted border border-line dark:border-dline hover:bg-surface dark:hover:bg-dline transition"
              >
                Batal
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-brand text-white hover:bg-brand-deep disabled:bg-brand/30 transition"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {saving ? 'Menyimpan...' : 'Simpan'}
              </button>
            </div>
          </div>
        </div>
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
