import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Package, Edit, Trash2, ChevronLeft, Loader2, Calendar, Tag, Wallet, Warehouse, Globe, ImageIcon } from 'lucide-react';
import adminApi from '../../services/adminApi';
import { ProductFormModal } from '../../components/admin/ProductFormModal';

interface ProductDetail {
  id: string;
  storeId: string;
  categoryId: string | null;
  name: string;
  description: string | null;
  price: number;
  currency: string | null;
  sku: string | null;
  stock: number | null;
  images: Array<{ url: string; alt?: string }> | null;
  primaryImageUrl: string | null;
  isActive: boolean;
  source: string;
  createdAt: string;
  updatedAt: string;
  category?: { id: string; name: string } | null;
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
            Produk <strong>{productName}</strong> akan dihapus. Tindakan ini tidak bisa dibatalkan.
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

export function ProductDetailPage() {
  const { productId } = useParams<{ productId: string }>();
  const navigate = useNavigate();
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProductDetail | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchProduct = useCallback(async () => {
    if (!productId) return;
    setLoading(true);
    try {
      const res = await adminApi.get(`/products/${productId}`);
      if (res.data?.data) {
        setProduct(res.data.data);
      } else {
        setError('Produk tidak ditemukan');
      }
    } catch (err: any) {
      if (err?.response?.status === 404) {
        setError('Produk tidak ditemukan');
      } else {
        setError(err?.message || 'Gagal memuat produk');
      }
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    fetchProduct();
  }, [fetchProduct]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await adminApi.delete(`/products/${deleteTarget.id}`);
      navigate('/admin/products');
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Gagal menghapus produk');
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  if (loading) {
    return (
      <div className="p-6 flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-2 p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 mb-4">
          <Package className="w-5 h-5" />
          {error}
        </div>
        <Link
          to="/admin/products"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-cyan hover:text-cyan/80"
        >
          <ChevronLeft className="w-3 h-3" /> Kembali ke daftar produk
        </Link>
      </div>
    );
  }

  if (!product) return null;

  return (
    <div className="p-6 max-w-4xl mx-auto text-surface">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            to="/admin/products"
            className="text-slate-400 hover:text-surface transition"
            title="Kembali"
          >
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <div className="rounded-xl bg-cyan/10 p-2.5 text-cyan">
            <Package className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="font-display text-xl text-surface">{product.name}</h1>
            <p className="text-sm text-slate-400">Detail Produk</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-dline px-3 py-1.5 text-sm font-medium text-surface hover:bg-dline/20 transition w-full sm:w-auto"
          >
            <Edit className="h-4 w-4" /> Edit
          </button>
          <button
            onClick={() => setDeleteTarget(product)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/20 px-3 py-1.5 text-sm font-medium text-red-400 hover:bg-red-500/10 transition w-full sm:w-auto"
          >
            <Trash2 className="h-4 w-4" /> Hapus
          </button>
        </div>
      </div>

      {/* Detail Grid */}
      <div className="bg-dcard rounded-lg border border-dline p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs text-slate-400 flex items-center gap-1">
              <Tag className="w-3 h-3" />
              Nama
            </label>
            <p className="font-medium text-surface font-mono">{product.name}</p>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-400 flex items-center gap-1">
              <Wallet className="w-3 h-3" />
              Harga Jual
            </label>
            <p className="font-medium text-surface font-mono">
              Rp {product.price.toLocaleString('id-ID')}
              {product.currency && product.currency !== 'IDR' && ` (${product.currency})`}
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-400 flex items-center gap-1">
              <Warehouse className="w-3 h-3" />
              Stok
            </label>
            <p className="font-medium text-surface font-mono">{product.stock != null ? product.stock : ' — '}</p>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-400 flex items-center gap-1">
              <Tag className="w-3 h-3" />
              SKU
            </label>
            <p className="font-mono text-xs text-slate-300">{product.sku || ' — '}</p>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-400 flex items-center gap-1">
              <Tag className="w-3 h-3" />
              Kategori
            </label>
            <p className="font-medium text-surface font-mono">{product.category?.name || ' — '}</p>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-400">Sumber</label>
            <p className="font-medium text-surface capitalize font-mono">{product.source || 'api'}</p>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-slate-400">Deskripsi</label>
          <p className="text-sm text-slate-300 whitespace-pre-wrap font-mono">{product.description || ' — '}</p>
        </div>

        {product.primaryImageUrl && (
          <div className="space-y-1">
            <label className="text-xs text-slate-400 flex items-center gap-1">
              <ImageIcon className="w-3 h-3" />
              Gambar Utama
            </label>
            <img
              src={product.primaryImageUrl}
              alt={product.name}
              className="max-h-48 max-w-full rounded-lg border border-dline object-cover"
            />
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-dline text-xs text-slate-400">
          <div className="flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            Dibuat: <span className="font-mono text-slate-300">{new Date(product.createdAt).toLocaleString('id-ID')}</span>
          </div>
          <div className="flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            Diperbarui: <span className="font-mono text-slate-300">{new Date(product.updatedAt).toLocaleString('id-ID')}</span>
          </div>
          <div className="flex items-center gap-1">
            <Globe className="w-3 h-3" />
            Store ID: <span className="font-mono text-slate-300">{product.storeId.substring(0, 12)}...</span>
          </div>
          <div className="flex items-center gap-1">
            <Tag className="w-3 h-3" />
            Status: <span className={product.isActive ? 'text-cyan' : 'text-red-400'}><span className="font-mono">{product.isActive ? 'Aktif' : 'Non-aktif'}</span></span>
          </div>
        </div>
      </div>

      {/* Edit Modal */}
      {modalOpen && (
        <ProductFormModal
          productId={product.id}
          storeId={product.storeId}
          initialData={{
            name: product.name,
            price: String(product.price),
            stock: product.stock != null ? String(product.stock) : '',
            sku: product.sku || '',
            description: product.description || '',
            categoryId: product.categoryId || '',
          }}
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          onSaved={fetchProduct}
        />
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <DeleteConfirm
          productName={deleteTarget.name}
          loading={deleting}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}
