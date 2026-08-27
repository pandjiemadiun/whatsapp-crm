import { useState, useEffect, useCallback } from 'react';
import { Plus, Edit, Trash2, Loader2 } from 'lucide-react';
import adminApi from '../../services/adminApi';
import { VariantFormModal } from './VariantFormModal';

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
  productHasVariants: boolean;
  onChanged: () => void;
}

export function VariantManagementPanel({ productId, storeId, productHasVariants, onChanged }: Props) {
  const [variants, setVariants] = useState<Variant[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingVariant, setEditingVariant] = useState<Variant | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Variant | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchVariants = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.get(`/stores/${storeId}/products/${productId}/variants`);
      setVariants(res.data?.data?.variants ?? []);
    } catch {
      setVariants([]);
    } finally {
      setLoading(false);
    }
  }, [storeId, productId]);

  useEffect(() => {
    fetchVariants();
  }, [fetchVariants]);

  const handleSaved = () => {
    fetchVariants();
    onChanged();
  };

  const openCreate = () => {
    setEditingVariant(null);
    setModalOpen(true);
  };

  const openEdit = (v: Variant) => {
    setEditingVariant(v);
    setModalOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await adminApi.delete(`/variants/${deleteTarget.id}`);
      setVariants(variants.filter((v) => v.id !== deleteTarget.id));
      onChanged();
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Gagal menghapus variasi');
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  return (
    <div className="mt-6 bg-dcard rounded-lg border border-dline p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h3 className="font-display text-lg text-surface">Variasi Produk</h3>
          {productHasVariants && (
            <span className="inline-flex items-center rounded bg-cyan/10 px-2 py-0.5 text-xs font-medium text-cyan">
              Sistem-managed
            </span>
          )}
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand text-white px-3 py-1.5 text-sm font-medium transition hover:bg-brand-deep"
        >
          <Plus className="h-4 w-4" /> Buat Variasi
        </button>
      </div>

      {/* hasVariants indicator (read-only) */}
      <div className="mb-3 text-xs text-slate-400">
        Status hasVariants:{' '}
        <span className={productHasVariants ? 'text-cyan font-medium' : 'text-slate-500'}>
          {productHasVariants ? 'true (system-managed)' : 'false'}
        </span>
        — Dikelola otomatis berdasarkan keberadaan variasi. Tidak bisa diubah manual.
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      ) : variants.length === 0 ? (
        <div className="text-center py-8 text-slate-400 text-sm">
          Belum ada variasi untuk produk ini.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dline text-left">
                <th className="px-3 py-2 text-xs font-medium text-slate-400">Atribut</th>
                <th className="px-3 py-2 text-xs font-medium text-slate-400">Harga</th>
                <th className="px-3 py-2 text-xs font-medium text-slate-400">Stok</th>
                <th className="px-3 py-2 text-xs font-medium text-slate-400">SKU</th>
                <th className="px-3 py-2 text-xs font-medium text-slate-400">Status</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-slate-400">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dline">
              {variants.map((v) => (
                <tr key={v.id} className="hover:bg-dline/10">
                  <td className="px-3 py-2 text-xs text-slate-300 font-mono">
                    {Object.entries(v.attributes).map(([k, val]) => `${k}: ${val}`).join(', ')}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-300 font-mono">
                    Rp {v.price.toLocaleString('id-ID')}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-300 font-mono">{v.stock ?? '-'}</td>
                  <td className="px-3 py-2 text-xs text-slate-400 font-mono">{v.sku || '-'}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${v.isActive ? 'bg-cyan/10 text-cyan' : 'bg-red-500/10 text-red-400'}`}>
                      {v.isActive ? 'Aktif' : 'Non-aktif'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => openEdit(v)}
                        className="p-1 text-slate-400 hover:text-cyan hover:bg-dline/20 rounded-lg transition"
                        title="Edit"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(v)}
                        className="p-1 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition"
                        title="Hapus"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create/Edit Modal */}
      {modalOpen && (
        <VariantFormModal
          productId={productId}
          storeId={storeId}
          variant={editingVariant}
          onClose={() => { setModalOpen(false); setEditingVariant(null); }}
          onSaved={handleSaved}
        />
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-dcard shadow-xl border border-dline">
            <div className="p-5">
              <h2 className="text-lg font-display font-semibold text-surface">Hapus Variasi?</h2>
              <p className="mt-2 text-sm text-slate-300">
                Variasi <strong>{deleteTarget.sku || Object.entries(deleteTarget.attributes).map(([k,v]) => `${k}: ${v}`).join(', ')}</strong> akan dihapus permanen.
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={() => setDeleteTarget(null)}
                  disabled={deleting}
                  className="px-4 py-2 text-sm font-medium text-slate-400 hover:bg-dline/20 rounded-lg transition"
                >
                  Batal
                </button>
                <button
                  onClick={confirmDelete}
                  disabled={deleting}
                  className="flex items-center gap-1 px-4 py-2 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 disabled:bg-red-300 transition"
                >
                  {deleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                  Hapus
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
