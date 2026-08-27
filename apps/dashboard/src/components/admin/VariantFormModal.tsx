import { useState, useEffect } from 'react';
import { X, Save, Loader2, Plus } from 'lucide-react';
import adminApi from '../../services/adminApi';

interface Variant {
  id: string;
  productId: string;
  storeId: string;
  sku: string | null;
  attributes: Record<string, any>;
  price: number;
  stock: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  productId: string;
  storeId: string;
  variant: Variant | null;
  onClose: () => void;
  onSaved: () => void;
}

interface VariantForm {
  price: string;
  stock: string;
  sku: string;
  attributes: Array<{ key: string; value: string }>;
}

export function VariantFormModal({ productId, storeId, variant, onClose, onSaved }: Props) {
  const isEdit = variant !== null;
  const [form, setForm] = useState<VariantForm>({
    price: variant ? String(variant.price) : '',
    stock: variant?.stock != null ? String(variant.stock) : '',
    sku: variant?.sku || '',
    attributes: variant
      ? Object.entries(variant.attributes).map(([key, value]) => ({ key, value: String(value) }))
      : [{ key: '', value: '' }],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (variant) {
      setForm({
        price: String(variant.price),
        stock: variant.stock != null ? String(variant.stock) : '',
        sku: variant.sku || '',
        attributes: Object.entries(variant.attributes).map(([key, value]) => ({ key, value: String(value) })),
      });
    } else {
      setForm({ price: '', stock: '', sku: '', attributes: [{ key: '', value: '' }] });
    }
  }, [variant]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const attributes: Record<string, any> = {};
      for (const attr of form.attributes) {
        if (attr.key.trim()) {
          attributes[attr.key.trim()] = attr.value.trim();
        }
      }

      const payload: Record<string, unknown> = {
        price: Number(form.price),
        stock: form.stock ? Number(form.stock) : null,
        sku: form.sku.trim() || undefined,
        attributes,
      };

      if (isEdit && variant) {
        await adminApi.patch(`/variants/${variant.id}`, payload);
      } else {
        await adminApi.post(`/stores/${storeId}/products/${productId}/variants`, payload);
      }

      onSaved();
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Gagal menyimpan variasi');
    } finally {
      setSaving(false);
    }
  };

  const addAttribute = () => {
    setForm({ ...form, attributes: [...form.attributes, { key: '', value: '' }] });
  };

  const removeAttribute = (index: number) => {
    setForm({ ...form, attributes: form.attributes.filter((_, i) => i !== index) });
  };

  const updateAttribute = (index: number, field: 'key' | 'value', val: string) => {
    const updated = [...form.attributes];
    updated[index] = { ...updated[index], [field]: val };
    setForm({ ...form, attributes: updated });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h2 className="font-semibold text-slate-900">{isEdit ? 'Edit Variasi' : 'Buat Variasi Baru'}</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 transition" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-red-50 text-red-700 border border-red-200">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Harga *</label>
              <input
                type="number"
                min={0}
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                required
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
                placeholder="Kosongkan = unlimited"
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
              placeholder="Opsional"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Atribut (key-value pairs) *</label>
            {form.attributes.map((attr, idx) => (
              <div key={idx} className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={attr.key}
                  onChange={(e) => updateAttribute(idx, 'key', e.target.value)}
                  placeholder="Key (misal: size)"
                  className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <input
                  type="text"
                  value={attr.value}
                  onChange={(e) => updateAttribute(idx, 'value', e.target.value)}
                  placeholder="Value (misal: S)"
                  className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  type="button"
                  onClick={() => removeAttribute(idx)}
                  className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition"
                  aria-label="Remove attribute"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addAttribute}
              className="flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-700 mt-1"
            >
              <Plus className="h-4 w-4" /> Tambah atribut
            </button>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 rounded-lg transition">
              Batal
            </button>
            <button
              type="submit"
              disabled={saving || !form.price}
              className="flex items-center gap-1 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:bg-indigo-300 transition"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
              {saving ? 'Menyimpan...' : isEdit ? 'Update' : 'Buat'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
