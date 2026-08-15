import type { SenderRole } from '../types/chat';

/** StatusBanner — handoff/resolved banner extracted from ChatPage (Step 7).
 *  Reads only the canonical conversation status: open | human_takeover | resolved. */
export default function StatusBanner({
  status,
}: {
  status?: 'open' | 'human_takeover' | 'resolved';
}) {
  if (status === 'human_takeover' || status === 'resolved') {
    return (
      <div
        className={`text-xs px-3 py-1 rounded-md mb-1 ${
          status === 'resolved'
            ? 'bg-muted text-muted-foreground'
            : 'bg-amber-500/15 text-amber-700 border border-amber-200 dark:border-amber-900/50'
        }`}
        aria-label={status === 'resolved' ? 'conversation resolved' : 'human takeover'}
        role="status"
        aria-live="polite"
      >
        {status === 'resolved'
          ? 'Percakapan telah diselesaikan oleh admin.'
          : 'Pesan Anda diteruskan ke admin. Mohon tunggu.'}
      </div>
    );
  }
  return null;
}

export type { SenderRole };
