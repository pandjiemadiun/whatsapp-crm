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

function getInitials(name?: string | null): string {
  if (!name) return 'T';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  if (!parts[0]) return 'T';
  return parts.map((p) => p[0]).join('').slice(0, 2).toUpperCase();
}

function MessageBubble({
  message,
  onQuickReply,
  onProductTap,
  onAddToCart,
  onShowRelated,
  submitting,
  store,
}: {
  message: ChatMessage;
  onQuickReply?: (label: string) => void;
  onProductTap?: (product: ProductPayload) => void;
  onAddToCart?: (product: ProductPayload) => void;
  onShowRelated?: (product: ProductPayload) => void;
  submitting?: boolean;
  store?: EmptyStateProps['store'];
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
    return (
      <div className="flex gap-2 items-start">
        {/* §5: merchant avatar on commerce rows = store.profilePhotoUrl (real)
            or generic initials fallback (never a product/mock image). */}
        {store?.profilePhotoUrl ? (
          <img
            src={store.profilePhotoUrl}
            alt={store.name || 'Merchant'}
            className="w-5 h-5 rounded-full object-cover flex-shrink-0"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none'
            }}
          />
        ) : (
          <div
            className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-[9px] font-serif font-semibold text-white"
            style={{ background: 'linear-gradient(160deg, #3a6e52, #1E3A2B)' }}
          >
            {getInitials(store?.name)}
          </div>
        )}
        <div className="flex flex-col items-start gap-2.5">{content}</div>
      </div>
    );
  }

  return (
    <div className={`flex gap-2 items-end ${isUser ? 'flex-row-reverse ml-auto' : ''}`}>
      {/* §5: avatar = identity indicator (NOT a commerce card element). Customer
          messages are anonymous (webUid, no photo/name in /init or /message) →
          generic guest avatar. Merchant → real store profilePhotoUrl. */}
      {isAssistant && store && (
        store.profilePhotoUrl ? (
          <img
            src={store.profilePhotoUrl}
            alt={store.name || 'Merchant'}
            className="w-5 h-5 rounded-full object-cover flex-shrink-0"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none'
            }}
          />
        ) : (
          <div
            className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-[9px] font-serif font-semibold text-white"
            style={{ background: 'linear-gradient(160deg, #3a6e52, #1E3A2B)' }}
          >
            {getInitials(store.name)}
          </div>
        )
      )}
      {isUser && (
        <div className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center bg-muted text-muted-foreground/40">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="8" r="3" />
            <path d="M20 20v-2a4 4 0 0 0-3-3.87M4 20v-2a4 4 0 0 1 3-3.87" />
          </svg>
        </div>
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
            store={store}
          />
        </div>
      ))}
      {trailing}
      <div ref={bottomRef} />
    </main>
  );
}
