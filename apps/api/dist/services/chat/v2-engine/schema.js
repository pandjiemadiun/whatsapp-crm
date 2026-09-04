/**
 * V2 Engine Output Schema
 *
 * Foundation types + Zod validation for the new LLM-first chat engine.
 * This file is standalone — no wiring to interpreter.ts / reasoning.ts /
 * fallback.service.ts in this unit.
 */
import { z } from 'zod';
// ─────────────────────────────────────────────────────────────────────────────
// Schema version
// ─────────────────────────────────────────────────────────────────────────────
export const V2_SCHEMA_VERSION = 'v1';
// ─────────────────────────────────────────────────────────────────────────────
// Intent enum
// ─────────────────────────────────────────────────────────────────────────────
export const V2_INTENTS = {
    PRODUCT_INQUIRY: 'product_inquiry',
    ADD_TO_CART: 'add_to_cart',
    DONE_ORDERING: 'done_ordering',
    MODIFY_CART: 'modify_cart',
    PAYMENT_INQUIRY: 'payment_inquiry',
    SHIPPING_INQUIRY: 'shipping_inquiry',
    ORDER_STATUS: 'order_status',
    CANCEL_ORDER: 'cancel_order',
    SMALLTALK: 'smalltalk',
    CLARIFICATION: 'clarification',
    ESCALATION: 'escalation',
    UNKNOWN: 'unknown',
};
// ─────────────────────────────────────────────────────────────────────────────
// Zod schema
// ─────────────────────────────────────────────────────────────────────────────
export const V2EntitySchema = z.object({
    type: z.enum([
        'product',
        'quantity',
        'price',
        'variant',
        'customer_name',
        'customer_address',
        'customer_phone',
        'payment_method',
        'shipping_method',
        'order_status',
        'negation',
        'rollback',
        'greeting',
        'other',
    ]),
    value: z.string().min(1),
    confidence: z.number().min(0).max(1),
    metadata: z.record(z.string(), z.unknown()).optional(),
});
export const V2ProposedActionSchema = z.object({
    action_type: z.enum([
        'ADD_TO_CART',
        'REMOVE_FROM_CART',
        'UPDATE_CART_QUANTITY',
        'CANCEL_ORDER',
        'OPEN_CATALOG',
        'OPEN_CART',
        'SHOW_RELATED_PRODUCTS',
        'CONTACT_ADMIN',
        'NONE',
    ]),
    payload: z.record(z.string(), z.unknown()),
    confidence: z.number().min(0).max(1),
    requires_validation: z.boolean(),
});
export const V2UncertaintySignalSchema = z.object({
    type: z.enum(['ambiguous_entity', 'missing_context', 'contradiction', 'low_confidence', 'out_of_scope']),
    description: z.string().min(1),
});
export const V2EngineOutputSchema = z.object({
    schema_version: z.literal('v1'),
    intent: z.nativeEnum(V2_INTENTS),
    confidence: z.number().min(0).max(1),
    entities: z.array(V2EntitySchema),
    proposed_actions: z.array(V2ProposedActionSchema),
    reply_text: z.string().min(1).max(500),
    needs_clarification: z.boolean(),
    clarification_question: z.string().optional(),
    summary_update: z.string().optional(),
    uncertainty_signals: z.array(V2UncertaintySignalSchema),
});
//# sourceMappingURL=schema.js.map