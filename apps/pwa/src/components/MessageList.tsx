import type { RefObject, ReactNode } from 'react';
import MessageRenderer from './MessageRenderer';
import EmptyState, { type EmptyStateProps } from './EmptyState';
import TextMessage from './TextMessage';
import type { ChatMessage, ChatProduct, ProductPayload, StructuredMessageType } from '../types/chat';

const COMMERCE_TYPES: ReadonlyArray<StructuredMessageType> = [
  'product',
  'product_list',
  'cart',
  'quick_reply',
  'handoff',
];

function formatTime(createdAt?: string): string {
  if (!createdAt) return '';
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function MessageBubble({
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
}) {
  const isCommerce = message.type != null && COMMERCE_TYPES.includes(message.type);
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const timestamp = formatTime(message.createdAt);

  const content = (
    <MessageRenderer
      message={message}
      onQuickReply={onQuickReply}
      onProductTap={onProductTap}
      onAddToCart={onAddToCart}
      onShowRelated={onShowRelated}
      submitting={submitting}
    />
  );

  if (isCommerce) {
    return <div className="flex flex-col items-start gap-2.5">{content}</div>;
  }

  return (
    <div className={`flex gap-2 max-w-[85%] ${isUser ? 'flex-row-reverse ml-auto' : ''}`}>
      {isAssistant && (
        <div
          className="w-[22px] h-[22px] rounded-full flex-shrink-0 mt-auto"
          style={{ background: 'linear-gradient(160deg, #3a6e52, #1E3A2B)' }}
        />
      )}
      <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
        <div
          className="px-3 py-2.5 text-[13px] leading-relaxed border"
          style={{
            background: isUser ? 'var(--forest)' : '#fff',
            color: isUser ? '#fff' : 'var(--ink)',
            borderColor: isUser ? 'transparent' : 'var(--line)',
            borderRadius: isUser ? '15px 15px 4px 15px' : '15px 15px 15px 4px',
          }}
        >
          {message.role === 'system' ? (
            <TextMessage text={message.content} />
          ) : (
            <TextMessage text={message.content} />
          )}
        </div>
        {timestamp && (
          <span
            className="text-[9px] mt-1 px-0.5"
            style={{ color: '#A7B1A5' }}
          >
            {timestamp}
          </span>
        )}
      </div>
    </div>
  );
}

export interface MessageListProps {
  messages: ChatMessage[];
  bottomRef: RefObject<HTMLDivElement | null>;
  onQuickReply?: (label: string) => void;
  submitting?: boolean;
  showEmptyState?: boolean;
  store?: EmptyStateProps['store'];
  products?: ChatProduct[];
  onQuickAction?: EmptyStateProps['onQuickAction'];
  onProductTap?: (product: ProductPayload) => void;
  onAddToCart?: (product: ProductPayload) => void;
  onShowRelated?: (product: ProductPayload) => void;
  trailing?: ReactNode;
}

export default function MessageList({
  messages,
  bottomRef,
  onQuickReply,
  submitting,
  showEmptyState,
  store,
  products,
  onQuickAction,
  onProductTap,
  onAddToCart,
  onShowRelated,
  trailing,
}: MessageListProps) {
  if (showEmptyState && messages.length === 0) {
    return (
      <main className="flex-1 overflow-y-auto chat-scroll">
        <EmptyState
          store={store}
          products={products}
          onQuickAction={onQuickAction}
          onProductTap={onProductTap}
          onAddToCart={onAddToCart}
        />
        {trailing}
        <div ref={bottomRef} />
      </main>
    );
  }

  return (
    <main className="flex-1 overflow-y-auto chat-scroll p-3 space-y-3">
      {messages.map((m, i) => (
        <div key={m.id || `msg-${i}`}>
          <MessageBubble
            message={m}
            onQuickReply={onQuickReply}
            onProductTap={onProductTap}
            onAddToCart={onAddToCart}
            onShowRelated={onShowRelated}
            submitting={submitting}
          />
        </div>
      ))}
      {trailing}
      <div ref={bottomRef} />
    </main>
  );
}
