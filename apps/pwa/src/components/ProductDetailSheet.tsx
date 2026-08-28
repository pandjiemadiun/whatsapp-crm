import { useState, useEffect } from 'react';
import api from '../services/api';

export type ProductDetailSheetProps = {
  productId: string | null;
  storeSlug: string;
  onClose: () => void;
  onAddToCart?: (productId: string, variantId: string) => void;
};

type VariantOption = {
  id: string;
  label: string;
  price: number | null;
  stock: number | null;
  sku: string | null;
};

type ProductDetail = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  stock: number | null;
  primaryImageUrl: string | null;
  category?: { id: string; name: string } | null;
  hasVariants: boolean;
  variants?: VariantOption[];
};

function formatPrice(price: number | null | undefined): string {
  if (price == null) return '—';
  return `Rp ${price.toLocaleString('id-ID')}`;
}

export default function ProductDetailSheet({ productId, storeSlug, onClose, onAddToCart }: ProductDetailSheetProps) {
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);

  useEffect(() => {
    if (!productId) {
      setProduct(null);
      setSelectedVariantId(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelectedVariantId(null);

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
              hasVariants: data.hasVariants ?? false,
              variants: data.hasVariants ? data.variants : undefined,
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
  }, [productId, storeSlug]);

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

  const selectedVariant = product?.variants?.find((v) => v.id === selectedVariantId) ?? null;

  const handleAddToCart = () => {
    if (selectedVariantId && onAddToCart && product) {
      onAddToCart(product.id, selectedVariantId);
      onClose();
    }
  };

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
                  {selectedVariant && selectedVariant.price != null && (
                    <span className="text-sm text-muted-foreground">
                      ({formatPrice(selectedVariant.price)} untuk varian ini)
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${stockColor}`}>{stockLabel}</span>
                </div>

                {product.description && (
                  <p className="text-sm text-muted-foreground leading-relaxed pt-2 border-t border-border">
                    {product.description}
                  </p>
                )}

                {/* Variant selector */}
                {product.hasVariants && product.variants && product.variants.length > 0 && (
                  <div className="pt-3 border-t border-border">
                    <p className="text-sm font-semibold text-foreground mb-2">Pilih Varian</p>
                    <div className="flex flex-col gap-2">
                      {product.variants.map((v) => {
                        const isSelected = selectedVariantId === v.id;
                        const isOutOfStock = v.stock !== null && v.stock === 0;
                        return (
                          <label
                            key={v.id}
                            className={`flex items-center justify-between px-3 py-2.5 rounded-xl border text-sm cursor-pointer transition-colors ${
                              isSelected
                                ? 'border-primary bg-primary/10'
                                : 'border-border hover:border-primary/50'
                            } ${isOutOfStock ? 'opacity-50 cursor-not-allowed' : ''}`}
                          >
                            <span className="flex items-center gap-2">
                              <input
                                type="radio"
                                name="variant"
                                checked={isSelected}
                                onChange={() => !isOutOfStock && setSelectedVariantId(v.id)}
                                disabled={isOutOfStock}
                                className="accent-primary"
                              />
                              <span>
                                <span className="font-medium">{v.label}</span>
                                {v.sku && (
                                  <span className="block text-xs text-muted-foreground">SKU: {v.sku}</span>
                                )}
                              </span>
                            </span>
                            <span className="text-right">
                              <span className="font-semibold">{formatPrice(v.price ?? product.price)}</span>
                              <span className="block text-xs text-muted-foreground">
                                {v.stock === null ? 'Stok tidak terbatas' : v.stock === 0 ? 'Stok habis' : `Stok: ${v.stock}`}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Add-to-cart footer */}
        {product && product.hasVariants && product.variants && product.variants.length > 0 && onAddToCart && (
          <div className="p-4 border-t border-border bg-surface-elevated">
            <button
              type="button"
              onClick={handleAddToCart}
              disabled={!selectedVariantId}
              className="w-full py-3 rounded-full text-sm font-bold text-white border-0 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: 'var(--forest)' }}
            >
              {selectedVariant ? `Tambah ke Keranjang — ${selectedVariant.label}` : 'Pilih varian terlebih dahulu'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
