/** ConnectionBanner (Step 8 — presentation only).
 *  Compact, non-blocking status derived purely from the existing Socket.IO
 *  instance's readyState. Does NOT create another socket and does NOT change
 *  WS auth, reconnect config, or the message flow.
 *
 *  Per UX blueprint: "Normal state: tidak perlu banner." Connected state
 *  renders nothing — banner only appears on connecting/reconnecting/disconnected. */

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

const LABEL: Record<Exclude<ConnectionState, 'connected'>, string> = {
  connecting: 'Menyambungkan…',
  reconnecting: 'Menyambung kembali…',
  disconnected: 'Terputus',
};

const BG: Record<Exclude<ConnectionState, 'connected'>, string> = {
  connecting: 'bg-amber-500/15 text-amber-800 border border-amber-200 dark:border-amber-900/50',
  reconnecting: 'bg-amber-500/15 text-amber-800 border border-amber-200 dark:border-amber-900/50',
  disconnected: 'bg-red-500/15 text-red-700 border border-red-200 dark:border-red-900/50',
};

export default function ConnectionBanner({ state }: { state: ConnectionState }) {
  if (state === 'connected') {
    return null;
  }

  const label = LABEL[state];
  const bgCls = BG[state];

  return (
    <div
      className={`text-xs px-3 py-1.5 rounded-md mx-3 ${bgCls}`}
      role="status"
      aria-live="polite"
      aria-label={`Koneksi: ${label}`}
    >
      {label}
    </div>
  );
}
