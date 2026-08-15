import ProductCard from './ProductCard';
import type { ProductListPayload, ProductPayload } from '../types/chat';

export type ProductListProps = {
  items: ProductListPayload['items'];
  onTap?: (product: ProductPayload) => void;
  onAddToCart?: (product: ProductPayload) => void;
  onShowRelated?: (product: ProductPayload) => void;
  /** catalog = grid layout; conversation = horizontal rail on mobile, grid on desktop;
   *  chat-grid = 2-col grid of conversation cards (with CTA) inside a chat bubble. */
  variant?: 'catalog' | 'conversation' | 'chat-grid';
};

function isConversation(variant?: ProductListProps['variant']) {
  return variant === 'conversation';
}
function isChatGrid(variant?: ProductListProps['variant']) {
  return variant === 'chat-grid';
}

/** Commerce product list.
 *  - catalog: responsive grid (1 col mobile → 2 col sm).
 *  - conversation: horizontal scroll rail on mobile (190px cards, snap), grid on desktop.
 *  - chat-grid: 2-col grid of conversation cards (BUG 2 in-chat catalog rendering). */
export default function ProductList({ items, onTap, onAddToCart, onShowRelated, variant = 'catalog' }: ProductListProps) {
  if (!Array.isArray(items) || items.length === 0) return null;

  if (isChatGrid(variant)) {
    return (
      <div className="grid grid-cols-2 gap-2.5 w-full justify-items-center">
        {items.map((it, i) => (
          <ProductCard
            key={it.id ?? `p-${i}`}
            product={it as ProductPayload}
            variant="conversation"
            onTap={onTap ? () => onTap(it as ProductPayload) : undefined}
            onAddToCart={onAddToCart}
            onShowRelated={onShowRelated}
          />
        ))}
      </div>
    );
  }

  if (isConversation(variant)) {
    return (
      <div
        className="
          flex
          gap-3
          overflow-x-auto
          snap-x
          snap-mandatory
          pb-2
          [scrollbar-width:none]
          [&::-webkit-scrollbar]:hidden
        "
      >
        {items.map((it, i) => (
          <div key={it.id ?? `p-${i}`} className="w-[340px] shrink-0 snap-start">
            <ProductCard
              product={it as ProductPayload}
              variant="conversation"
              onTap={onTap}
              onAddToCart={onAddToCart}
              onShowRelated={onShowRelated}
            />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {items.map((it, i) => (
        <ProductCard
          key={it.id ?? `p-${i}`}
          product={it as ProductPayload}
          onTap={onTap}
          onAddToCart={onAddToCart}
          onShowRelated={onShowRelated}
        />
      ))}
    </div>
  );
}
