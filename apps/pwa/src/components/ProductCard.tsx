import { formatPrice } from '../utils/format';
import type { ProductPayload } from '../types/chat';

export type ProductCardProps = {
  product: ProductPayload;
  /** Compact discovery layout (image-top commerce card). */
  variant?: 'default' | 'compact' | 'conversation';
  /** Tap callback for product detail. */
  onTap?: (product: ProductPayload) => void;
  /** Badge text to display (optional). */
  badge?: string | { text: string; variant: 'default' | 'new' };
  /** BUG 3: "+ Keranjang" / "Tambah" -> shared client cart (storefront + chat). */
  onAddToCart?: (product: ProductPayload) => void;
  /** BUG 3: "Produk Lain" -> show other products in chat. */
  onShowRelated?: (product: ProductPayload) => void;
};

function ImageBox({
  imageUrl,
  name,
  className,
  fallbackIcon,
}: { imageUrl: string | null | undefined; name: string | null; className: string; fallbackIcon?: React.ReactNode }) {
  if (!imageUrl) {
    return (
      <div
        className={`${className} flex items-center justify-center`}
        style={{ background: 'linear-gradient(150deg, #2F5240, #1E3A2B)' }}
      >
        {fallbackIcon || (
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.6" opacity="0.6">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
        )}
      </div>
    );
  }
  return (
    <img
      src={imageUrl}
      alt={name ?? 'Produk'}
      className={`${className} object-cover`}
      loading="lazy"
      onError={(e) => {
        (e.target as HTMLImageElement).style.display = 'none';
      }}
    />
  );
}

function StockLabel({ stock }: { stock: number | null }) {
  if (stock === null) return <span className="mt-1 text-[10px] text-muted-foreground">Stok tidak terbatas</span>;
  if (stock === 0) return <span className="mt-1 text-[10px] text-destructive">Stok habis</span>;
  return <span className="mt-1 text-[10px] text-muted-foreground">Stok {stock} · per kg</span>;
}

function Badge({ badge }: { badge?: string | { text: string; variant: 'default' | 'new' } }) {
  if (!badge) return null;
  const text = typeof badge === 'string' ? badge : badge.text;
  const isNew = typeof badge === 'object' && badge.variant === 'new';
  return (
    <span
      className="absolute top-2 left-2 text-[9px] font-extrabold px-2 py-0.5 rounded-full tracking-wide"
      style={{
        background: isNew ? 'var(--forest)' : 'var(--marigold)',
        color: isNew ? '#fff' : '#241505',
      }}
    >
      {text}
    </span>
  );
}

/** Commerce product card.
 *  - default: horizontal commerce card (image-left).
 *  - compact: image-top commerce card (image → name → price → stock → action).
 *  - conversation: large image, 340px max, full commerce CTA.
 *  BUG 3: conversation/compact action buttons call onAddToCart (shared client
 *  cart) / onShowRelated — bukan no-op lagi. Price & stock straight from payload. */
export default function ProductCard({ product, variant = 'default', onTap, badge, onAddToCart, onShowRelated }: ProductCardProps) {
  const { name, price, stock, imageUrl } = product;
  const compact = variant === 'compact';
  const conversation = variant === 'conversation';

  const handleClick = () => {
    if (onTap) onTap(product);
  };

  if (conversation) {
    return (
      <article
        className="w-full max-w-[280px] overflow-hidden rounded-2xl border border-border bg-surface shadow-sm cursor-pointer transition-all duration-200 hover:shadow-lg active:scale-[0.985]"
      >
        <button
          type="button"
          onClick={handleClick}
          className="w-full text-left border-0 bg-transparent p-0"
        >
          <div className="w-full bg-muted relative" style={{ height: '88px' }}>
            <ImageBox imageUrl={imageUrl} name={name} className="w-full h-full" />
            <Badge badge={badge} />
          </div>
          <div className="px-3.5 pb-3.5 pt-2.5">
            <div className="text-sm font-bold leading-tight text-foreground line-clamp-2">{name ?? '—'}</div>
            <div className="mt-1 text-price text-base font-extrabold">{formatPrice(price)}</div>
            <div className="mt-1 text-[10px] text-muted-foreground">🌿 Stok ready {stock ?? '-'} pcs</div>
            <div className="mt-2.5 flex gap-1.5">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onShowRelated?.(product) }}
                className="flex-1 text-center py-2 rounded-full text-xs font-bold border border-border bg-muted text-primary hover:bg-muted/80 transition-colors"
              >
                Produk Lain
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onAddToCart?.(product) }}
                className="flex-1 text-center py-2 rounded-full text-xs font-bold text-white border-0"
                style={{ background: 'var(--forest)' }}
              >
                + Keranjang
              </button>
            </div>
          </div>
        </button>
      </article>
    );
  }

  if (compact) {
    return (
      <article className="group overflow-hidden rounded-2xl border border-border bg-surface shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.985]">
        <button
          type="button"
          onClick={handleClick}
          className="w-full text-left border-0 bg-transparent p-0"
        >
          <div className="w-full bg-muted relative" style={{ height: '96px' }}>
            <ImageBox imageUrl={imageUrl} name={name} className="w-full h-full" />
            <Badge badge={badge} />
          </div>
          <div className="p-2.5">
            <div className="text-sm font-semibold leading-tight text-foreground line-clamp-2">{name ?? '—'}</div>
            <div className="mt-1 text-price text-base font-extrabold">{formatPrice(price)}</div>
            <StockLabel stock={stock} />
          </div>
          <div className="px-2.5 pb-2.5">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onAddToCart?.(product) }}
              className="w-full flex items-center justify-center gap-1 py-2 rounded-full text-xs font-bold text-white border-0 cursor-pointer transition-all hover:brightness-110 active:scale-95"
              style={{ background: 'var(--forest)' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Tambah
            </button>
          </div>
        </button>
      </article>
    );
  }

  return (
    <article className="group overflow-hidden rounded-2xl border border-border bg-surface shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.985]">
      <button
        type="button"
        onClick={handleClick}
        className="flex gap-3 items-start w-full text-left border-0 bg-transparent p-0"
      >
        <div className="w-16 h-16 rounded-xl flex-shrink-0 bg-muted">
          <ImageBox imageUrl={imageUrl} name={name} className="w-full h-full rounded-xl" />
        </div>
        <div className="flex-1 min-w-0 py-2 pr-2">
          <div className="text-sm font-semibold leading-tight text-foreground line-clamp-2">{name ?? '—'}</div>
          <div className="mt-1 text-price text-base font-extrabold">{formatPrice(price)}</div>
          <StockLabel stock={stock} />
        </div>
      </button>
    </article>
  );
}
