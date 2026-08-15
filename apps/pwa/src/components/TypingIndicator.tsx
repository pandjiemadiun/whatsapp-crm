import ChatBubble from './ChatBubble';

/** TypingIndicator (Step 10 — presentation only).
 * - AI typing: local simulation ("mengetik…" + 3-dot pulse).
 * - Admin typing: "Admin sedang mengetik…" (WS party='human_agent').
 * No new backend; reuses the existing Socket.IO typing events.
 */
export default function TypingIndicator({
  isAI,
  isAdmin,
}: {
  isAI?: boolean;
  isAdmin?: boolean;
}) {
  if (isAdmin) {
    return (
      <div
        className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5"
        aria-label="Admin sedang mengetik"
        role="status"
        aria-live="polite"
      >
        <span>Admin sedang mengetik</span>
        <span className="inline-flex items-center gap-[1px]">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="dot-pulse"
              style={{ animationDelay: `${i * 0.12}s` }}
              aria-hidden="true"
            />
          ))}
        </span>
      </div>
    );
  }
  if (isAI) {
    return <ChatBubble role="assistant" isTyping />;
  }
  return null;
}
