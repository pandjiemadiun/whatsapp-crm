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
  uncertainty_signals: z.array(V2UncertaintySignalSchema).default([]),
});

export type V2EngineOutputValidated = z.infer<typeof V2EngineOutputSchema>;
