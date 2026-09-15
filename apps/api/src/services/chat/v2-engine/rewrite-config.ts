/**
 * V2 Rewrite Mode — WIRE-V2ENGINE-ENTRYPOINT
 *
 * Flag `chatEngine.v2RewriteMode` (values: 'off' | 'shadow' | 'active', default 'off').
 *
 * SEPARATE from chatEngine.v2Mode (the existing V2-vs-V1 engine selector).
 * This new flag controls whether the V2 engine *rewrite path* (callV2Engine
 * from v2-engine/engine-call.ts → V2EngineOutput) runs in SHADOW or ACTIVE mode:
 *
 *   - 'off' (default): no shadow rewrite call. V2-lama customer reply is
 *     completely unaffected. Shadow call is skipped entirely.
 *   - 'shadow':  AFTER the V2-lama path (reasoning.ts / InterpreterResultV2)
 *     has composed and persisted the customer-facing reply, fire-and-forget
 *     callV2Engine() → run the 3 translation layers
 *     (deriveV2EngineReason / deriveV2EngineProductSource / deriveV2EngineQuickReply)
 *     → classifyStructured for messageType → save ALL to a separate log row
 *     in v2_shadow_logs (v2RewriteOutput columns). Customer receives the
 *     SAME reply as 'off'.
 *   - 'active':  callV2Engine() becomes the SOLE source of the
 *     customer-facing reply for ALL stores — reasoning.ts is NOT called
 *     at all. This saves 1 LLM call per message (single call vs V2-lama's
 *     dual path). Success: translation layers produce the same
 *     messageType/payload/reply_text as proven in shadow mode. Failure
 *     (provider_exhausted): a static honest fallback reply
 *     ("Maaf Kak, sistem sedang sibuk banget...") is composed, saved, and
 *     returned — reasoning.ts is NOT called as backup.
 */
import { configService } from '../../../business/config.service.js';

/** System-setting / env key for the rewrite-mode flag. */
export const V2_REWRITE_MODE_FLAG_KEY = 'chatEngine.v2RewriteMode';

export type V2RewriteMode = 'off' | 'shadow' | 'active';

/**
 * Read chatEngine.v2RewriteMode from system_settings (cached 5 min via ConfigService).
 * Unknown / unset values default to 'off' for safety.
 */
export async function getV2RewriteMode(): Promise<V2RewriteMode> {
  try {
    const value = await configService.getConfig(V2_REWRITE_MODE_FLAG_KEY);
    if (value === 'shadow') return 'shadow';
    if (value === 'active') return 'active';
    return 'off';
  } catch {
    return 'off';
  }
}
