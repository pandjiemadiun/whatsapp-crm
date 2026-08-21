import { useState, useEffect } from 'react';
import { X, Save, RefreshCw } from 'lucide-react';
import adminApi from '../../services/adminApi';

interface Category {
  id: string;
  name: string;
}

interface ProductForm {
  name: string;
  price: string;
  stock: string;
  weight: string;
  sku: string;
  description: string;
  categoryId: string;
}

interface Props {
  /** Jika null → mode "buat baru"; jika ada id → mode "edit" */
  productId: string | null;
  storeId: string;
  /** Data produk saat edit (null saat create) */
  initialData?: Partial<ProductForm>;
  /** Callback ketika selesai (success atau cancel) */
  onClose: () => void;
  /** Callback ketika produk berhasil dibuat/di-update */
  onSaved: () => void;
  /** Show/hide modal */
  open: boolean;
}

/**
 * Modal form untuk create / edit produk di admin dashboard.
 * Memakai adminApi (axios) untuk 401 auto-redirect.
 */
export function ProductFormModal({ productId, storeId, initialData, onClose, onSaved, open }: Props) {
  const [form, setForm] = useState<ProductForm>({
    name: '',
    price: '',
    stock: '',
    weight: '',
    sku: '',
    description: '',
    categoryId: '',
  });
  const [categories, setCategories] = useState<Category[]>([]);
  const [loadingCats, setLoadingCats] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEdit = productId !== null;

  // Inisialisasi form saat buka
  useEffect(() => {
    if (open) {
      setForm({
        name: initialData?.name || '',
        price: initialData?.price || '',
        stock: initialData?.stock || '',
        weight: initialData?.weight || '',
        sku: initialData?.sku || '',
        description: initialData?.description || '',
        categoryId: initialData?.categoryId || '',
      });
      setError(null);
    }
  }, [open, initialData]);

  // Load categories ketika modal dibuka
  useEffect(() => {
    if (!open || !storeId) return;
    let cancelled = false;
    setLoadingCats(true);
    adminApi.get(`/stores/${storeId}/categories`)
      .then((res) => {
        if (!cancelled) {
          const cats = res.data?.data?.categories ?? [];
          setCategories(cats);
        }
      })
      .catch(() => {
        if (!cancelled) setCategories([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingCats(false);
      });
    return () => { cancelled = true; };
  }, [open, storeId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        price: Number(form.price),
        stock: form.stock ? Number(form.stock) : null,
        weight: form.weight ? Number(form.weight) : null,
        sku: form.sku.trim() || undefined,
        description: form.description.trim() || undefined,
        categoryId: form.categoryId || undefined,
      };

      if (isEdit) {
        await adminApi.patch(`/products/${productId}`, payload);
      } else {
        await adminApi.post(`/stores/${storeId}/products`, payload);
      }

      onSaved();
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || err?.message || 'Gagal menyimpan produk');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h2 className="font-semibold text-slate-900">{isEdit ? 'Edit Produk' : 'Buat Produk Baru'}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 transition"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-red-50 text-red-700 border border-red-200">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Nama Produk *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Harga *</label>
              <input
                type="number"
                min={1}
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                required
                placeholder="0"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Stok</label>
              <input
                type="number"
                min={0}
                value={form.stock}
                onChange={(e) => setForm({ ...form, stock: e.target.value })}
                placeholder="0 (kosongkan jika tidak ada)"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Berat (gram) *</label>
              <input
                type="number"
                min={1}
                value={form.weight}
                onChange={(e) => setForm({ ...form, weight: e.target.value })}
                required
                placeholder="contoh: 500"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">SKU</label>
            <input
              type="text"
              value={form.sku}
              onChange={(e) => setForm({ ...form, sku: e.target.value })}
              placeholder="AUTO-generate jika kosong"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Kategori</label>
            <select
              value={form.categoryId}
              onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
              disabled={loadingCats}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
            >
              <option value="">— Tanpa kategori —</option>
              {loadingCats && <option disabled>Loading...</option>}
              {!loadingCats && categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Deskripsi</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Deskripsi produk (opsional)"
              rows={3}
              className="w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 rounded-lg transition"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving || !form.name || !form.price || !form.weight}
              className="flex items-center gap-1 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:bg-indigo-300 transition"
            >
              {saving ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
              {saving ? 'Menyimpan...' : isEdit ? 'Update' : 'Buat'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
