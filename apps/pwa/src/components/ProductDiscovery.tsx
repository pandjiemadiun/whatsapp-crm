import { useState, useMemo } from 'react';
import type { ChatProduct } from '../types/chat';
import ProductCard from './ProductCard';

export type ProductDiscoveryProps = {
  products: ChatProduct[];
  storeName?: string | null;
  onBack: () => void;
  onProductTap?: (p: ChatProduct) => void;
  showSearch?: boolean;
  /** Use compact card variant (image-top grid). */
  compact?: boolean;
};

const SEARCH_PLACEHOLDER = 'Cari produk…';

export default function ProductDiscovery({
  products,
  storeName,
  onBack,
  onProductTap,
  showSearch = true,
  compact = false,
}: ProductDiscoveryProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!query.trim()) return products;
    const q = query.toLowerCase();
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description?.toLowerCase().includes(q) ?? false),
    );
  }, [products, query]);

  const toPayload = (p: ChatProduct) => ({
    id: p.id,
    name: p.name,
    price: p.price,
    stock: p.stock,
    imageUrl: p.primaryImageUrl ?? null,
    hasVariants: p.hasVariants,
  });

  return (
    <div className="flex flex-col h-full bg-surface">
      {/* ── Sticky header ── */}
      <header className="flex items-center gap-3 px-4 py-3 bg-surface-elevated border-b border-border sticky top-0 z-10">
        <button
          type="button"
          onClick={onBack}
          className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring/40 transition-colors"
          aria-label="Kembali ke chat"
        >
          <span aria-hidden="true">←</span>
        </button>
        <div className="min-w-0">
          <span className="text-base font-medium text-foreground truncate block">
            {storeName || 'Produk'}
          </span>
          {showSearch && (
            <span className="text-xs text-muted-foreground">Cari produk yang kamu butuhkan</span>
          )}
        </div>
      </header>

      {/* ── Search ── */}
      {showSearch && (
        <div className="px-4 py-3 bg-surface border-b border-border">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 text-sm" aria-hidden="true">
              🔍
            </span>
            <input
              type="text"
              placeholder={SEARCH_PLACEHOLDER}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 text-sm rounded-lg border border-border bg-muted/50 focus:outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 placeholder-muted-foreground/70 transition-colors"
              aria-label="Cari produk"
            />
          </div>
        </div>
      )}

      {/* ── Product grid ── */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-12 text-center px-6">
            {query ? (
              <>
                <span className="text-2xl mb-3">🤔</span>
                <p className="text-foreground/70">Belum ketemu, Kak. Coba kata lain?</p>
              </>
            ) : (
              <>
                <span className="text-2xl mb-3">🛍️</span>
                <p className="text-muted-foreground mb-4">Belum ada produk di sini.</p>
                <button
                  type="button"
                  onClick={onBack}
                  className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
                >
                  Tanya Toko
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 p-4">
            {filtered.map((p) => (
              <div
                key={p.id}
                onClick={() => onProductTap?.(p)}
                className={compact ? '' : 'cursor-pointer'}
              >
                <ProductCard product={toPayload(p)} variant={compact ? 'compact' : 'default'} onTap={() => onProductTap?.(p)} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
