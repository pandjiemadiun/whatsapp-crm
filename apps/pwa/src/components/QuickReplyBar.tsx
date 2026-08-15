import { useState } from 'react';
import type { QuickReplyPayload } from '../types/chat';

/** Quick reply bar (Step 6).
 *  Backend-authored options render as buttons labeled with option.label.
 *  On click -> send option.label through the EXISTING POST /pwa/:slug/message.
 *  cartOps / action are server-executed — NEVER executed in the browser. */
export default function QuickReplyBar({
  payload,
  onQuickReply,
  submitting,
}: {
  payload: QuickReplyPayload;
  onQuickReply: (label: string) => void;
  submitting: boolean;
}) {
  const options = Array.isArray(payload?.options) ? payload.options : [];
  const [sentId, setSentId] = useState<string | null>(null);

  if (!options.length) return null;

  return (
    <div className="flex flex-col gap-1.5 mt-1 ml-7">
      {payload?.question && (
        <p className="text-sm text-muted-foreground break-words">{payload.question}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const fired = sentId === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              disabled={submitting || fired}
              onClick={() => {
                setSentId(opt.id);
                onQuickReply(opt.label);
              }}
              className="rounded-full border px-3.5 py-1.5 text-[11px] font-bold transition-all"
              style={{
                borderColor: 'var(--forest)',
                color: 'var(--forest)',
                background: '#fff',
                opacity: fired || submitting ? 0.6 : 1,
                cursor: fired || submitting ? 'not-allowed' : 'pointer',
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
