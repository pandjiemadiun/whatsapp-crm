import { useState, useMemo } from 'react';
import ProductCard from './ProductCard';
import type { ChatProduct, ProductPayload } from '../types/chat';

export type StoreIdentity = {
  name?: string | null;
  profilePhotoUrl?: string | null;
  phoneNumber?: string | null;
  operatingHours?: { summary?: string | null } | null;
  isActive?: boolean | null;
};

export type QuickActionType = 'products' | 'search' | 'chat';

export type EmptyStateProps = {
  store?: StoreIdentity | null;
  products?: ChatProduct[];
  onQuickAction?: (action: QuickActionType) => void;
  onProductTap?: (product: ProductPayload) => void;
  onAddToCart?: (product: ProductPayload) => void;
};

const PREVIEW_COUNT = 6;

export default function EmptyState({ store, products = [], onQuickAction, onProductTap, onAddToCart }: EmptyStateProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return products;
    const q = searchQuery.toLowerCase();
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description?.toLowerCase().includes(q) ?? false),
    );
  }, [products, searchQuery]);

  return (
    <div className="flex-1 overflow-y-auto chat-scroll">
      {/* Hero — §2: render only authoritative data. operatingHours.summary is real;
          rating / order-count / "Buka Setiap Hari" / "Tutup 21.00" have NO data
          source → hidden (no mock values). */}
      <div className="px-4 pt-3 pb-2">
        {store?.operatingHours?.summary ? (
          <p className="text-eyebrow" style={{ color: 'var(--clay)' }}>{store.operatingHours.summary}</p>
        ) : null}
        <h1 className="font-serif italic text-xl font-medium text-primary mt-1 leading-tight">
          Segar dari pasar, langsung ke keranjangmu.
        </h1>
      </div>

      {/* Search */}
      <div className="px-4 mt-2">
        <div className="flex items-center gap-2 bg-white border border-border rounded-2xl px-3.5 py-2.5 shadow-sm">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9AA69B" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="text"
            placeholder="Cari produk…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 border-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/70 outline-none"
          />
        </div>
      </div>

      {/* §3: no category data available (products carry no `category` field, no
          categories endpoint) → category chips intentionally omitted. */}

      {/* Product grid */}
      <div className="px-4 mt-4">
        <div className="flex items-center justify-between mb-2.5">
          <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider font-mono">Pilihan untukmu</h3>
          <button
            type="button"
            onClick={() => onQuickAction?.('products')}
            className="text-[11px] font-bold focus:outline-none"
            style={{ color: 'var(--clay)' }}
          >
            Lihat semua
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2.5 pb-4">
          {filtered.slice(0, PREVIEW_COUNT).map((p) => (
            <ProductCard
              key={p.id}
              product={{
                id: p.id,
                name: p.name,
                price: p.price,
                stock: p.stock,
                imageUrl: p.primaryImageUrl ?? null,
                hasVariants: p.hasVariants,
              }}
              variant="compact"
              onTap={onProductTap}
              onAddToCart={onAddToCart}
            />
          ))}
        </div>
      </div>

      {/* Tanya Toko FAB */}
      <div className="px-4 mt-2 mb-4">
        <button
          type="button"
          onClick={() => onQuickAction?.('chat')}
          className="w-full flex items-center gap-3 p-3.5 rounded-2xl text-left border-0 cursor-pointer shadow-lg transition-all hover:brightness-110 active:scale-[0.98]"
          style={{ background: 'var(--forest)', color: '#fff' }}
        >
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(255,255,255,0.14)' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-bold text-white m-0 leading-tight">Tanya Toko</p>
            <span className="text-[11px] text-white/70">"Ada kacang gak, Kak?"</span>
          </div>
        </button>
      </div>
    </div>
  );
}
