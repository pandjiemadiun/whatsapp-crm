import { useEffect, useState } from 'react';
import { X, Save, RefreshCw, Plus, Trash2 } from 'lucide-react';
import api from '../../services/api';
import adminApi from '../../services/adminApi';

export interface Category {
  id: string;
  name: string;
}

export interface ProductFormData {
  name: string;
  price: string;
  stock: string;
  weight: string;
  sku: string;
  description: string;
  categoryId: string;
}

export interface MpVariantAttr {
  key: string;
  value: string;
}

export interface MpVariant {
  id?: string;
  attributes: MpVariantAttr[];
  price: string;
  stock: string;
  sku: string;
}

export interface Product {
  id: string;
  name: string;
  description: string | null;
  price: number;
  currency?: string | null;
  sku: string | null;
  stock: number | null;
  weight: number;
  primaryImageUrl: string | null;
  categoryId: string | null;
  isActive: boolean;
  source: string;
  hasVariants: boolean;
}

export interface ProductFormProps {
  storeId: string;
  mode: 'admin' | 'merchant';
  product?: Product | null;
  onSaved: (product: Product) => void;
  onCancel: () => void;
  showVariantSection?: boolean;
}

function normalizeApiBase(mode: 'admin' | 'merchant') {
  return mode === 'admin' ? adminApi : api;
}

export function ProductForm({ storeId, mode, product, onSaved, onCancel, showVariantSection = true }: ProductFormProps) {
  const [form, setForm] = useState<ProductFormData>({
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
  const [variants, setVariants] = useState<MpVariant[]>([]);
  const [variantsLoading, setVariantsLoading] = useState(false);

  const apiBase = normalizeApiBase(mode);
  const isEdit = !!product?.id;

  useEffect(() => {
    if (product) {
      setForm({
        name: product.name,
        price: String(product.price),
        stock: product.stock != null ? String(product.stock) : '',
        weight: String(product.weight ?? ''),
        sku: product.sku ?? '',
        description: product.description || '',
        categoryId: product.categoryId || '',
      });
      if (product.hasVariants) {
        setVariantsLoading(true);
        const detailPath = mode === 'admin'
          ? `/admin/stores/${storeId}/products/${product.id}/variants`
          : `/products/my/${product.id}/variants`;
        apiBase.get(detailPath)
          .then((res) => {
            const list = res.data?.data?.variants ?? [];
            setVariants(
              list.map((v: any) => ({
                id: v.id,
                attributes: Object.entries(v.attributes ?? {}).map(([key, value]) => ({ key, value: String(value ?? '') })),
                price: String(v.price ?? ''),
                stock: v.stock == null ? '' : String(v.stock),
                sku: v.sku ?? '',
              }))
            );
          })
          .catch(() => setVariants([]))
          .finally(() => setVariantsLoading(false));
      } else {
        setVariants([]);
        setVariantsLoading(false);
      }
    } else {
      setForm({ name: '', price: '', stock: '', weight: '', sku: '', description: '', categoryId: '' });
      setVariants([]);
    }
    setError(null);
  }, [product?.id, mode, storeId, apiBase]);

  useEffect(() => {
    if (!storeId) return;
    let cancelled = false;
    setLoadingCats(true);
    const catPath = mode === 'admin' ? `/stores/${storeId}/categories` : '/products/my/categories';
    apiBase.get(catPath)
      .then((res) => {
        if (!cancelled) {
          const cats = res.data?.data?.categories ?? res.data?.data ?? [];
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
  }, [storeId, mode, apiBase]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        price: Number(form.price),
        stock: form.stock === '' ? null : Number(form.stock),
        weight: form.weight ? Number(form.weight) : null,
        sku: form.sku.trim() || undefined,
        description: form.description.trim() || undefined,
        categoryId: form.categoryId || undefined,
      };

      let savedProduct: Product;
      if (isEdit && product) {
        const updatePath = mode === 'admin' ? `/products/${product.id}` : `/products/my/${product.id}`;
        const res = await apiBase.patch(updatePath, payload);
        savedProduct = res.data.data;
      } else {
        const createPath = mode === 'admin' ? `/stores/${storeId}/products` : '/products/my';
        const res = await apiBase.post(createPath, payload);
        savedProduct = res.data.data;
      }

      // Save variants if any
      if (savedProduct && variants.length > 0) {
        const variantBase = mode === 'admin'
          ? `/stores/${storeId}/products/${savedProduct.id}/variants`
          : `/products/my/${savedProduct.id}/variants`;
        for (const v of variants) {
          const attrs: Record<string, string> = {};
          for (const a of v.attributes) {
            if (a.key.trim()) attrs[a.key.trim()] = a.value.trim();
          }
          if (v.id) {
            const variantUpdatePath = mode === 'admin' ? `/variants/${v.id}` : `/products/my/variants/${v.id}`;
            await apiBase.patch(variantUpdatePath, {
              price: Number(v.price),
              stock: v.stock.trim() === '' ? null : Number(v.stock),
              sku: v.sku.trim() || undefined,
              attributes: attrs,
            });
          } else if (Object.keys(attrs).length > 0 && v.price) {
            await apiBase.post(variantBase, {
              price: Number(v.price),
              stock: v.stock.trim() === '' ? null : Number(v.stock),
              sku: v.sku.trim() || undefined,
              attributes: attrs,
            });
          }
        }
      }

      onSaved(savedProduct);
      onCancel();
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || err?.message || 'Gagal menyimpan produk');
    } finally {
      setSaving(false);
    }
  };

  const addVariant = () =>
    setVariants((prev) => [...prev, { id: undefined, attributes: [{ key: '', value: '' }], price: '', stock: '', sku: '' }]);

  const removeVariant = (idx: number) =>
    setVariants((prev) => prev.filter((_, i) => i !== idx));

  const updateVariantField = (idx: number, field: 'price' | 'stock' | 'sku', value: string) => {
    setVariants((prev) => prev.map((v, i) => (i === idx ? { ...v, [field]: value } : v)));
  };

  const updateAttr = (vi: number, ai: number, field: 'key' | 'value', value: string) => {
    setVariants((prev) =>
      prev.map((v, i) =>
        i === vi ? { ...v, attributes: v.attributes.map((a, j) => (j === ai ? { ...a, [field]: value } : a)) } : v
      )
    );
  };

  const addAttr = (vi: number) => {
    setVariants((prev) =>
      prev.map((v, i) => (i === vi ? { ...v, attributes: [...v.attributes, { key: '', value: '' }] } : v))
    );
  };

  const removeAttr = (vi: number, ai: number) => {
    setVariants((prev) =>
      prev.map((v, i) => (i === vi ? { ...v, attributes: v.attributes.filter((_, j) => j !== ai) } : v))
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl bg-surface dark:bg-dcard shadow-xl border border-line dark:border-dline max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-line dark:border-dline">
          <h2 className="font-display font-bold text-navy dark:text-surface">
            {isEdit ? 'Edit Produk' : 'Buat Produk Baru'}
          </h2>
          <button onClick={onCancel} className="text-muted hover:text-ink dark:text-muted dark:hover:text-surface">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-ink dark:text-surface mb-1.5">
              Nama Produk <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              className="w-full rounded-lg border border-line dark:border-dline px-3 py-2 text-sm bg-surface dark:bg-dsurface text-ink placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-ink dark:text-surface mb-1.5">Harga (IDR) *</label>
              <input
                type="number"
                min={1}
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                required
                placeholder="0"
                className="w-full rounded-lg border border-line dark:border-dline px-3 py-2 text-sm bg-surface dark:bg-dsurface text-ink placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink dark:text-surface mb-1.5">Stok</label>
              <input
                type="number"
                min={0}
                value={form.stock}
                onChange={(e) => setForm({ ...form, stock: e.target.value })}
                placeholder="Kosongkan jika tidak ada"
                className="w-full rounded-lg border border-line dark:border-dline px-3 py-2 text-sm bg-surface dark:bg-dsurface text-ink placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink dark:text-surface mb-1.5">Berat (gram)</label>
              <input
                type="number"
                min={0}
                value={form.weight}
                onChange={(e) => setForm({ ...form, weight: e.target.value })}
                placeholder="Opsional"
                className="w-full rounded-lg border border-line dark:border-dline px-3 py-2 text-sm bg-surface dark:bg-dsurface text-ink placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink dark:text-surface mb-1.5">SKU</label>
              <input
                type="text"
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
                placeholder="AUTO-generate jika kosong"
                className="w-full rounded-lg border border-line dark:border-dline px-3 py-2 text-sm bg-surface dark:bg-dsurface text-ink placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink dark:text-surface mb-1.5">Kategori</label>
            <select
              value={form.categoryId}
              onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
              disabled={loadingCats}
              className="w-full rounded-lg border border-line dark:border-dline px-3 py-2 text-sm bg-surface dark:bg-dsurface text-ink focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50"
            >
              <option value="">— Tanpa kategori —</option>
              {loadingCats && <option disabled>Loading...</option>}
              {!loadingCats && categories.map((c) => (
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
              className="w-full resize-y rounded-lg border border-line dark:border-dline px-3 py-2 text-sm bg-surface dark:bg-dsurface text-ink placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>

          {/* ── Variant editing section ── */}
          {isEdit && product?.hasVariants && showVariantSection && (
            <div className="mt-4 pt-4 border-t border-line dark:border-dline space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-ink dark:text-surface">Varian Produk</h3>
                <button
                  type="button"
                  onClick={addVariant}
                  disabled={saving}
                  className="flex items-center gap-1 rounded-lg border border-line dark:border-dline px-3 py-1.5 text-xs font-medium text-ink dark:text-surface hover:bg-surface dark:hover:bg-dline disabled:cursor-not-allowed disabled:opacity/50"
                >
                  <Plus className="h-3.5 w-3.5" /> Tambah varian
                </button>
              </div>
              {variantsLoading ? (
                <div className="flex justify-center py-4">
                  <RefreshCw className="w-5 h-5 animate-spin text-brand" />
                </div>
              ) : variants.length === 0 ? (
                <p className="text-xs text-muted">Belum ada varian.</p>
              ) : (
                <div className="space-y-3">
                  {variants.map((v, vi) => (
                    <div key={vi} className="rounded-lg border border-line dark:border-dline p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted">Varian #{vi + 1}</span>
                        <button
                          type="button"
                          onClick={() => removeVariant(vi)}
                          disabled={saving}
                          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                          aria-label={`Hapus varian #${vi + 1}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="space-y-1.5">
                        {v.attributes.map((a, ai) => (
                          <div key={ai} className="flex items-center gap-1.5">
                            <input
                              type="text"
                              value={a.key}
                              onChange={(e) => updateAttr(vi, ai, 'key', e.target.value)}
                              disabled={saving}
                              placeholder="size"
                              className="w-1/2 rounded-lg border border-line dark:border-dline px-2 py-1 text-sm bg-surface dark:bg-dsurface text-ink focus:outline-none focus:ring-1 focus:ring-brand"
                            />
                            <input
                              type="text"
                              value={a.value}
                              onChange={(e) => updateAttr(vi, ai, 'value', e.target.value)}
                              disabled={saving}
                              placeholder="L"
                              className="w-1/2 rounded-lg border border-line dark:border-dline px-2 py-1 text-sm bg-surface dark:bg-dsurface text-ink focus:outline-none focus:ring-1 focus:ring-brand"
                            />
                            <button
                              type="button"
                              onClick={() => removeAttr(vi, ai)}
                              disabled={saving}
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
                          disabled={saving}
                          className="flex items-center gap-1 text-xs font-medium text-brand hover:text-brand-deep"
                        >
                          <Plus className="h-3 w-3" /> Tambah atribut
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="block text-xs text-muted">Harga (IDR)</label>
                          <input
                            type="number"
                            value={v.price}
                            onChange={(e) => updateVariantField(vi, 'price', e.target.value)}
                            disabled={saving}
                            placeholder="10000"
                            className="mt-0.5 w-full rounded-lg border border-line dark:border-dline px-2 py-1 text-sm bg-surface dark:bg-dsurface text-ink focus:outline-none focus:ring-1 focus:ring-brand"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-muted">Stok</label>
                          <input
                            type="number"
                            value={v.stock}
                            onChange={(e) => updateVariantField(vi, 'stock', e.target.value)}
                            disabled={saving}
                            placeholder="100"
                            className="mt-0.5 w-full rounded-lg border border-line dark:border-dline px-2 py-1 text-sm bg-surface dark:bg-dsurface text-ink focus:outline-none focus:ring-1 focus:ring-brand"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-muted">SKU</label>
                          <input
                            type="text"
                            value={v.sku}
                            onChange={(e) => updateVariantField(vi, 'sku', e.target.value)}
                            disabled={saving}
                            placeholder="opsional"
                            className="mt-0.5 w-full rounded-lg border border-line dark:border-dline px-2 py-1 text-sm bg-surface dark:bg-dsurface text-ink focus:outline-none focus:ring-1 focus:ring-brand"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-line dark:border-dline">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-sm font-medium text-muted dark:text-muted border border-line dark:border-dline hover:bg-surface dark:hover:bg-dline rounded-lg transition"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving || !form.name || !form.price}
              className="flex items-center gap-1 px-4 py-2 bg-brand text-white rounded-lg text-sm font-semibold hover:bg-brand-deep disabled:bg-brand/30 transition"
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
