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
} as const;

export type V2Intent = typeof V2_INTENTS[keyof typeof V2_INTENTS];

// ─────────────────────────────────────────────────────────────────────────────
// Entity
// ─────────────────────────────────────────────────────────────────────────────

export interface V2Entity {
  type:
    | 'product'
    | 'quantity'
    | 'price'
    | 'variant'
    | 'customer_name'
    | 'customer_address'
    | 'customer_phone'
    | 'payment_method'
    | 'shipping_method'
    | 'order_status'
    | 'negation'
    | 'rollback'
    | 'greeting'
    | 'other';
  value: string;
  confidence: number;
  metadata?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Proposed action
// ─────────────────────────────────────────────────────────────────────────────

export interface V2ProposedAction {
  action_type:
    | 'ADD_TO_CART'
    | 'REMOVE_FROM_CART'
    | 'UPDATE_CART_QUANTITY'
    | 'CANCEL_ORDER'
    | 'OPEN_CATALOG'
    | 'OPEN_CART'
    | 'SHOW_RELATED_PRODUCTS'
    | 'CONTACT_ADMIN'
    | 'UPDATE_SHIPPING_ADDRESS'
    | 'SHOW_PAYMENT_METHODS'
    | 'NONE';
  payload: Record<string, unknown>;
  confidence: number;
  requires_validation: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Uncertainty signal
// ─────────────────────────────────────────────────────────────────────────────

export interface V2UncertaintySignal {
  type: 'ambiguous_entity' | 'missing_context' | 'contradiction' | 'low_confidence' | 'out_of_scope';
  description: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Engine output
// ─────────────────────────────────────────────────────────────────────────────

export interface V2EngineOutput {
  schema_version: typeof V2_SCHEMA_VERSION;
  intent: V2Intent;
  confidence: number;
  entities: V2Entity[];
  proposed_actions: V2ProposedAction[];
  reply_text: string;
  needs_clarification: boolean;
  clarification_question?: string;
  summary_update?: string;
  uncertainty_signals: V2UncertaintySignal[];
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM output normalization
// ─────────────────────────────────────────────────────────────────────────────
//
// The V2 schema uses FIXED enums (anti-drift principle from
// CHAT-ENGINE-V2-DESIGN-P1.md). However, LLMs (especially LLM7.io)
// consistently emit variant type names that are semantically valid but
// not in the canonical enum. Instead of bloating the enum with aliases,
// this normalizer maps known LLM variants → canonical schema types BEFORE
// Zod validation.
//
// Entity type mapping:
//   name → customer_name
//   address, location, destination → customer_address
//   shipping_name → customer_name
//   complaint → other (non-product, non-customer-info entity)
//
// Action type mapping:
//   GET_PRODUCT_INFO, PRODUCT_INFO, SHOW_PRODUCTS, SHOW_PRODUCT_DETAILS → SHOW_RELATED_PRODUCTS
//   ESCALATE_TO_HUMAN → CONTACT_ADMIN (canonical escalation action)
//   SHOW_PAYMENT, SHOW_PAYMENT_INFO, PAYMENT_METHODS → SHOW_PAYMENT_METHODS
//     (bridge payment_inquiry intent → V1 payment trigger; see conversation.service.ts)
//
// UPDATE_SHIPPING_ADDRESS is now a CANONICAL action_type in the enum
// (requires_validation=true). It is NOT a normalization alias — it is a
// first-class action that requires product-level design decision for
// execution handling (see conversation.service.ts deriveV2EngineReason).
// NOTE: UPDATE_SHIPPING_ADDRESS modifies a SHIPPING ADDRESS, not a cart
// item — semantically distinct from modify_cart (which = cart item CRUD).
// Consider introducing 'modify_order' as intent/action category.

/** Maps LLM-emitted entity type aliases to canonical schema types. */
function normalizeEntityType(type: string): string {
  switch (type) {
    case 'name':
    case 'shipping_name':
      return 'customer_name';
    case 'address':
    case 'location':
    case 'destination':
      return 'customer_address';
    case 'complaint':
      return 'other';
    default:
      return type;
  }
}

/** Maps LLM-emitted action_type aliases to canonical schema types. */
function normalizeActionType(actionType: string, intent: string): string {
  switch (actionType) {
    case 'GET_PRODUCT_INFO':
    case 'PRODUCT_INFO':
    case 'SHOW_PRODUCTS':
    case 'SHOW_PRODUCT_DETAILS':
      return 'SHOW_RELATED_PRODUCTS';
    case 'ESCALATE_TO_HUMAN':
      // ESCALATE_TO_HUMAN maps to the canonical escalation action
      // CONTACT_ADMIN — same semantic meaning (human handoff).
      return 'CONTACT_ADMIN';
    case 'SHOW_PAYMENT':
    case 'SHOW_PAYMENT_INFO':
    case 'PAYMENT_METHODS':
      // LLM variants for "show me how to pay" → canonical payment action.
      // WIRE-PAYMENT-V2: this action is the bridge that maps a payment_inquiry
      // intent back to the V1 payment trigger (result.source === 'payment' +
      // metadata.qrisImageUrl) in conversation.service.ts (v2-rewrite active path).
      return 'SHOW_PAYMENT_METHODS';
    default:
      return actionType;
  }
}

/**
 * Normalize a raw LLM JSON output BEFORE Zod schema validation.
 *
 * Walks entities[] and proposed_actions[], mapping LLM-emitted alias
 * type/action_type strings to their canonical schema equivalents.
 *
 * NOTE: `UPDATE_SHIPPING_ADDRESS` is now a **canonical** action_type in
 * V2ProposedActionSchema (requires_validation=true). It is intentionally
 * NOT mapped by the normalizer — it is a first-class schema type, representing
 * a genuinely new business action (shipping address modification in checkout
 * flow). The normalizeActionType() function falls through to default for it,
 * and Zod accepts it directly.
 */
export function normalizeV2Output(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return raw;
  }

  const obj = raw as Record<string, unknown>;

  // Normalize entity types
  if (Array.isArray(obj.entities)) {
    obj.entities = obj.entities.map((e: unknown) => {
      if (e && typeof e === 'object' && !Array.isArray(e)) {
        const ent = e as Record<string, unknown>;
        if (typeof ent.type === 'string') {
          ent.type = normalizeEntityType(ent.type);
        }
        return ent;
      }
      return e;
    });
  }

  // Normalize proposed_actions action_type
  const intent = typeof obj.intent === 'string' ? obj.intent : '';
  if (Array.isArray(obj.proposed_actions)) {
    obj.proposed_actions = obj.proposed_actions.map((a: unknown) => {
      if (a && typeof a === 'object' && !Array.isArray(a)) {
        const act = a as Record<string, unknown>;
        if (typeof act.action_type === 'string') {
          act.action_type = normalizeActionType(act.action_type, intent);
        }
        return act;
      }
      return a;
    });
  }

  return obj;
}

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
    'UPDATE_SHIPPING_ADDRESS',
    'SHOW_PAYMENT_METHODS',
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
  uncertainty_signals: z.array(V2UncertaintySignalSchema).default([]),
});

export type V2EngineOutputValidated = z.infer<typeof V2EngineOutputSchema>;
