import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Package, Wand2, Loader2, Edit, Trash2, Plus } from 'lucide-react';
import adminApi from '../../services/adminApi';
import { ProductForm } from '../../components/shared/ProductForm';

interface ProductRow {
  id: string;
  name: string;
  price: number;
  stock: number | null;
  sku: string | null;
  categoryId: string | null;
  description: string | null;
  source: string;
  primaryImageUrl: string | null;
  createdAt?: string;
  hasVariants: boolean;
  weight: number;
  currency: string;
  isActive: boolean;
}

interface StoreOption {
  id: string;
  name: string;
}

function DeleteConfirm({ productName, onCancel, onConfirm, loading }: {
  productName: string;
  onCancel: () => void;
  onConfirm: () => void;
  loading: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-dcard shadow-xl border border-dline">
        <div className="p-5">
          <h2 className="text-lg font-display font-semibold text-surface">Hapus Produk?</h2>
          <p className="mt-2 text-sm text-slate-300">
            Produk <strong>{productName}</strong> akan dihapus secara permanen. Tindakan ini tidak bisa dibatalkan.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={onCancel}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-slate-400 hover:bg-dline/20 rounded-lg transition"
            >
              Batal
            </button>
            <button
              onClick={onConfirm}
              disabled={loading}
              className="flex items-center gap-1 px-4 py-2 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 disabled:bg-red-300 transition"
            >
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
              Hapus
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AdminProductsPage() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStore, setSelectedStore] = useState('');
  const [stores, setStores] = useState<StoreOption[]>([]);

  // Modal states
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Muat daftar store
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await adminApi.get('/stores?page=1');
        const list: StoreOption[] = (res.data?.data?.stores ?? []).map((s: any) => ({
          id: s.id,
          name: s.name,
        }));
        if (!cancelled) {
          setStores(list);
          if (list.length > 0) setSelectedStore((prev) => prev || list[0].id);
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  // Muat produk untuk store terpilih
  useEffect(() => {
    if (!selectedStore) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await adminApi.get(`/stores/${selectedStore}/products?limit=50`);
        const list: ProductRow[] = (res.data?.data?.products ?? []).map((p: any) => ({
          id: p.id,
          name: p.name,
          price: p.price,
          stock: p.stock,
          sku: p.sku,
          categoryId: p.categoryId,
          description: p.description,
          source: p.source,
          primaryImageUrl: p.primaryImageUrl,
          createdAt: p.createdAt,
          hasVariants: p.hasVariants,
          weight: p.weight,
          currency: p.currency,
          isActive: p.isActive,
        }));
        if (!cancelled) setProducts(list);
      } catch {
        if (!cancelled) setProducts([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedStore, refreshKey]);

  // ─── Actions ───

  const openCreate = () => {
    setEditingProduct(null);
    setModalOpen(true);
  };

  const openEdit = (p: ProductRow) => {
    setEditingProduct(p);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingProduct(null);
  };

  const handleSaved = () => {
    setRefreshKey((k) => k + 1);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await adminApi.delete(`/products/${deleteTarget.id}`);
      setProducts(products.filter((p) => p.id !== deleteTarget.id));
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Gagal menghapus produk');
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <div className="p-6 text-surface">
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-cyan/10 p-2.5 text-cyan">
            <Package className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="font-display text-xl text-surface">Products</h1>
            <p className="text-sm text-slate-400">Kelola katalog produk store</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-lg bg-brand text-white px-4 py-2 text-sm font-medium transition hover:bg-brand-deep w-full sm:w-auto"
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> Buat Produk
          </button>
          <Link
            to="/admin/products/magic-paste"
            className="inline-flex items-center gap-2 rounded-lg bg-cyan text-navy px-4 py-2 text-sm font-medium transition hover:bg-cyan/80 w-full sm:w-auto"
          >
            <Wand2 className="h-4 w-4" aria-hidden="true" /> Magic Paste
          </Link>
        </div>
      </div>

      {/* Store filter */}
      <div className="mb-4">
        <label htmlFor="products-store" className="block text-sm font-medium text-slate-300 mb-1.5">
          Store
        </label>
        <select
          id="products-store"
          value={selectedStore}
          onChange={(e) => setSelectedStore(e.target.value)}
          className="w-full max-w-xs rounded-lg border border-dline bg-dcard px-3 py-2 text-sm text-surface focus:outline-none focus:ring-2 focus:ring-cyan font-mono"
        >
          {stores.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      {/* List produk */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
        </div>
      ) : products.length === 0 ? (
        <div className="rounded-xl border border-dashed border-dline py-16 text-center">
          <Package className="mx-auto mb-3 h-10 w-10 text-slate-500" aria-hidden="true" />
          <p className="text-slate-400">Belum ada produk untuk store ini.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-dline bg-dcard">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dline text-left">
                  <th className="px-4 py-3 text-xs font-medium text-slate-400">Nama</th>
                  <th className="px-4 py-3 text-xs font-medium text-slate-400">Harga</th>
                  <th className="px-4 py-3 text-xs font-medium text-slate-400">Stok</th>
                  <th className="px-4 py-3 text-xs font-medium text-slate-400">SKU</th>
                  <th className="px-4 py-3 text-xs font-medium text-slate-400">Sumber</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dline">
                {products.map((p) => (
                  <tr key={p.id} className="hover:bg-dline/10">
                    <td className="px-4 py-3 font-medium text-surface font-mono">
                      <div className="flex items-center gap-2">
                        {p.primaryImageUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.primaryImageUrl} alt="" className="h-6 w-6 rounded object-cover" />
                        )}
                        {p.name}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-300 font-mono text-xs">
                      Rp {p.price.toLocaleString('id-ID')}
                    </td>
                    <td className="px-4 py-3 text-slate-300 font-mono text-xs">{p.stock ?? '-'}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-400">{p.sku ?? '-'}</td>
                    <td className="px-4 py-3">
                      {p.source === 'magic_paste' ? (
                        <span className="inline-flex items-center gap-1 rounded bg-cyan/10 px-2 py-0.5 text-xs font-medium text-cyan">
                          <Wand2 className="h-3 w-3" /> magic
                        </span>
                      ) : (
                        <span className="rounded bg-dline/20 px-2 py-0.5 text-xs font-medium text-slate-400">api</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => openEdit(p)}
                          className="p-1 text-slate-400 hover:text-cyan hover:bg-dline/20 rounded-lg transition"
                          title="Edit"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeleteTarget({ id: p.id, name: p.name })}
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
        </div>
      )}

      {/* Product Form Modal (create / edit) */}
      {modalOpen && (
        <ProductForm
          mode="admin"
          storeId={selectedStore}
          product={editingProduct}
          onSaved={handleSaved}
          onCancel={closeModal}
        />
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <DeleteConfirm
          productName={deleteTarget.name}
          loading={false}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}
