/**
 * Handoff Service — reusable human-takeover trigger (P4-2).
 *
 * Extracted (pure extract-method, NO behavior change) from the inline body of
 * `POST /api/pwa/:storeSlug/handoff` in routes/pwa.ts. Both the PWA handoff
 * route and the CONTACT_ADMIN structured action handler call THIS function so
 * the escalation convention stays single-source:
 *
 *   - conversation.status = 'human_takeover' + humanTakeoverAt
 *   - a `handoff` conversationHistory row (the customer-facing reply)
 *   - eventBus.publish('message.created' type 'handoff')  -> realtime -> customer
 *   - eventBus.publish('conversation.handoff')            -> dashboard alert
 *   - eventBus.publish('conversation.updated')            -> dashboard inbox refresh
 *
 * Reuses the EXISTING composer helpers (composeEscalateReply / escalateStatusUpdate
 * convention) as-is — those are NOT modified (contract P4-2 DILARANG list).
 *
 * Conversation Engine (conversation.service.ts) is NOT touched — this is a
 * standalone service, not the engine escalation path (still locked §6A.11.6).
 */
export interface ExecuteHandoffInput {
    conversationId: string;
    storeId: string;
    channel: 'whatsapp' | 'web';
}
export interface ExecuteHandoffResult {
    messageId: string;
    status: string;
    content: string;
}
/**
 * Mark a conversation for human takeover and notify both the customer (WS) and
 * the dashboard (eventBus). Runs the status update + history insert inside a
 * single $transaction, mirroring the original route exactly.
 */
export declare function executeHandoff(input: ExecuteHandoffInput): Promise<ExecuteHandoffResult>;
//# sourceMappingURL=handoff.service.d.ts.map