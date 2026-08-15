import type { HandoffPayload } from '../types/chat';

/** Handoff presentation (Step 7).
 *  Status/source of truth is the canonical conversation lifecycle:
 *  open | human_takeover | resolved (not invented here). */
export default function HandoffMessage({
  payload,
  content,
}: {
  payload?: HandoffPayload | null;
  content?: string;
}) {
  const reason = payload?.reason;
  const body = payload?.content ?? content ?? '';

  return (
    <div className="flex items-start gap-2">
      <span aria-hidden="true">👤</span>
      <div className="flex flex-col text-sm">
        {reason === 'escalation_clarification_retry_exceeded' ? (
          <p className="font-medium text-amber-700">
            Pesan diteruskan ke admin.
          </p>
        ) : (
          <p className="font-medium text-amber-700">Terhubung ke admin.</p>
        )}
        {body ? <span className="text-foreground/70 break-words">{body}</span> : null}
      </div>
    </div>
  );
}
