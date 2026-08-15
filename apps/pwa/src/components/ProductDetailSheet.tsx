import { useState, useEffect } from 'react';
import api from '../services/api';

export type ProductDetailSheetProps = {
  productId: string | null;
  storeSlug: string;
  onClose: () => void;
};

type ProductDetail = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  stock: number | null;
  primaryImageUrl: string | null;
  category?: { id: string; name: string } | null;
};

function formatPrice(price: number | null | undefined): string {
  if (price == null) return '—';
  return `Rp ${price.toLocaleString('id-ID')}`;
}

export default function ProductDetailSheet({ productId, storeSlug, onClose }: ProductDetailSheetProps) {
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!productId) {
      setProduct(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .get(`/pwa/${encodeURIComponent(storeSlug)}/products/${encodeURIComponent(productId)}`)
      .then((res) => {
        if (!cancelled) {
          const data = res.data?.data ?? null;
          if (data) {
            setProduct({
              id: data.id,
              name: data.name,
              description: data.description ?? null,
              price: data.price,
              stock: data.stock,
              primaryImageUrl: data.primaryImageUrl ?? null,
            });
          } else {
            setError('Produk tidak ditemukan');
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err?.response?.data?.error ?? 'Gagal memuat detail produk');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [productId]);

  useEffect(() => {
    if (!productId) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [productId, onClose]);

  if (!productId) return null;

  const stockLabel =
    product?.stock === null
      ? 'Stok tidak terbatas'
      : product?.stock === 0
        ? 'Stok habis'
        : product?.stock != null
          ? `Stok: ${product.stock}`
          : '—';

  const stockColor =
    product?.stock === 0
      ? 'text-destructive'
      : product?.stock === null
        ? 'text-green-600'
        : 'text-muted-foreground';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet / Modal */}
      <div
        className="relative w-full max-w-lg bg-surface border border-border rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[85vh] flex flex-col animate-in slide-in-from-bottom sm:zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
        aria-label={product ? `Detail ${product.name}` : 'Detail produk'}
      >
        {/* Drag handle (mobile) */}
        <div className="flex justify-center pt-2 pb-1 sm:hidden">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
        </div>

        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-surface-elevated border border-border text-muted-foreground hover:text-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring/40 transition-colors"
          aria-label="Tutup detail"
        >
          <span aria-hidden="true">✕</span>
        </button>

        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="p-6 flex flex-col items-center justify-center gap-3">
              <div className="w-full aspect-square bg-muted rounded-xl animate-pulse" />
              <div className="w-3/4 h-5 bg-muted rounded animate-pulse" />
              <div className="w-1/2 h-4 bg-muted rounded animate-pulse" />
            </div>
          )}

          {error && !loading && (
            <div className="p-6 text-center">
              <p className="text-destructive text-sm">{error}</p>
              <button
                type="button"
                onClick={onClose}
                className="mt-3 px-4 py-2 text-sm font-medium text-primary hover:underline focus:outline-none"
              >
                Tutup
              </button>
            </div>
          )}

          {product && !loading && (
            <div className="flex flex-col">
              {/* Product image */}
              <div className="w-full aspect-square bg-muted">
                {product.primaryImageUrl ? (
                  <img
                    src={product.primaryImageUrl}
                    alt={product.name}
                    className="w-full h-full object-cover"
                    loading="eager"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground/50 text-sm">
                    Tidak ada gambar
                  </div>
                )}
              </div>

              {/* Product info */}
              <div className="p-5 space-y-3">
                <div>
                  <h2 className="text-lg font-semibold text-foreground leading-tight">{product.name}</h2>
                  {product.category && (
                    <p className="text-xs text-muted-foreground mt-0.5">{product.category.name}</p>
                  )}
                </div>

                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-semibold text-foreground">{formatPrice(product.price)}</span>
                </div>

                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${stockColor}`}>{stockLabel}</span>
                </div>

                {product.description && (
                  <p className="text-sm text-muted-foreground leading-relaxed pt-2 border-t border-border">
                    {product.description}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
