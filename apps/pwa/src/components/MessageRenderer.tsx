import { type ReactNode } from 'react';
import TextMessage from './TextMessage';
import ProductCard from './ProductCard';
import ProductList from './ProductList';
import CartSummary from './CartSummary';
import QuickReplyBar from './QuickReplyBar';
import HandoffMessage from './HandoffMessage';
import ChatBubble from './ChatBubble';
import type {
  ChatMessage,
  StructuredMessageType,
  ProductPayload,
  ProductListPayload,
  CartPayload,
  QuickReplyPayload,
  HandoffPayload,
} from '../types/chat';

const WHITELIST: ReadonlyArray<StructuredMessageType> = [
  'text',
  'product',
  'product_list',
  'cart',
  'quick_reply',
  'handoff',
];

function isRecord(p: unknown): p is Record<string, unknown> {
  return !!p && typeof p === 'object' && !Array.isArray(p);
}

export default function MessageRenderer({
  message,
  onQuickReply,
  onProductTap,
  onAddToCart,
  onShowRelated,
  submitting,
}: {
  message: ChatMessage;
  onQuickReply?: (label: string) => void;
  onProductTap?: (product: ProductPayload) => void;
  onAddToCart?: (product: ProductPayload) => void;
  onShowRelated?: (product: ProductPayload) => void;
  submitting?: boolean;
}): ReactNode {
  const { type, payload, content } = message;

  if (!type || !WHITELIST.includes(type as StructuredMessageType)) {
    return <TextMessage text={content} />;
  }

  switch (type) {
    case 'product': {
      if (!isRecord(payload)) return <TextMessage text={content} />;
      const product = payload as unknown as ProductPayload;
      return (
        <div className="flex flex-col items-start gap-2.5">
          <ChatBubble role="assistant" source={message.source}>
            <TextMessage text={content} />
          </ChatBubble>
          <div className="w-full max-w-[280px]">
            <ProductCard
              product={product}
              variant="conversation"
              onTap={onProductTap ? () => onProductTap(product) : undefined}
              onAddToCart={onAddToCart}
              onShowRelated={onShowRelated}
            />
          </div>
        </div>
      );
    }
    case 'product_list': {
      if (!isRecord(payload)) return <TextMessage text={content} />;
      const pl = (payload as unknown) as ProductListPayload;
      const items = Array.isArray(pl?.items) ? pl.items : [];
      if (!items.length) return <TextMessage text={content} />;
      return (
        <div className="flex flex-col items-start gap-2.5">
          <ChatBubble role="assistant" source={message.source}>
            <TextMessage text={content} />
          </ChatBubble>
          <div className="w-full">
            <ProductList
              items={items}
              variant="chat-grid"
              onTap={onProductTap}
              onAddToCart={onAddToCart}
              onShowRelated={onShowRelated}
            />
          </div>
        </div>
      );
    }
    case 'cart': {
      if (!isRecord(payload)) return <TextMessage text={content} />;
      return (
        <div className="my-3 w-full max-w-[280px]">
          <ChatBubble role="assistant" source={message.source}>
            <TextMessage text={content} />
          </ChatBubble>
          <CartSummary cart={payload as unknown as CartPayload} />
        </div>
      );
    }
    case 'quick_reply': {
      if (!isRecord(payload) || !Array.isArray((payload as unknown as QuickReplyPayload).options)) {
        return <TextMessage text={content} />;
      }
      if (!onQuickReply) return <TextMessage text={content} />;
      return (
        <div className="my-3 w-full max-w-[480px]">
          <QuickReplyBar
            payload={payload as unknown as QuickReplyPayload}
            onQuickReply={onQuickReply}
            submitting={!!submitting}
          />
        </div>
      );
    }
    case 'handoff': {
      return (
        <div className="my-3 w-full max-w-[480px]">
          <HandoffMessage payload={isRecord(payload) ? (payload as unknown as HandoffPayload) : null} content={content} />
        </div>
      );
    }
    case 'text':
    default:
      return <TextMessage text={content} />;
  }
}
