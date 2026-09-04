/**
 * V2 Engine Output Schema
 *
 * Foundation types + Zod validation for the new LLM-first chat engine.
 * This file is standalone — no wiring to interpreter.ts / reasoning.ts /
 * fallback.service.ts in this unit.
 */
import { z } from 'zod';
export declare const V2_SCHEMA_VERSION = "v1";
export declare const V2_INTENTS: {
    readonly PRODUCT_INQUIRY: "product_inquiry";
    readonly ADD_TO_CART: "add_to_cart";
    readonly DONE_ORDERING: "done_ordering";
    readonly MODIFY_CART: "modify_cart";
    readonly PAYMENT_INQUIRY: "payment_inquiry";
    readonly SHIPPING_INQUIRY: "shipping_inquiry";
    readonly ORDER_STATUS: "order_status";
    readonly CANCEL_ORDER: "cancel_order";
    readonly SMALLTALK: "smalltalk";
    readonly CLARIFICATION: "clarification";
    readonly ESCALATION: "escalation";
    readonly UNKNOWN: "unknown";
};
export type V2Intent = typeof V2_INTENTS[keyof typeof V2_INTENTS];
export interface V2Entity {
    type: 'product' | 'quantity' | 'price' | 'variant' | 'customer_name' | 'customer_address' | 'customer_phone' | 'payment_method' | 'shipping_method' | 'order_status' | 'negation' | 'rollback' | 'greeting' | 'other';
    value: string;
    confidence: number;
    metadata?: Record<string, unknown>;
}
export interface V2ProposedAction {
    action_type: 'ADD_TO_CART' | 'REMOVE_FROM_CART' | 'UPDATE_CART_QUANTITY' | 'CANCEL_ORDER' | 'OPEN_CATALOG' | 'OPEN_CART' | 'SHOW_RELATED_PRODUCTS' | 'CONTACT_ADMIN' | 'NONE';
    payload: Record<string, unknown>;
    confidence: number;
    requires_validation: boolean;
}
export interface V2UncertaintySignal {
    type: 'ambiguous_entity' | 'missing_context' | 'contradiction' | 'low_confidence' | 'out_of_scope';
    description: string;
}
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
export declare const V2EntitySchema: z.ZodObject<{
    type: z.ZodEnum<{
        other: "other";
        product: "product";
        order_status: "order_status";
        price: "price";
        customer_name: "customer_name";
        customer_phone: "customer_phone";
        quantity: "quantity";
        variant: "variant";
        greeting: "greeting";
        rollback: "rollback";
        customer_address: "customer_address";
        payment_method: "payment_method";
        shipping_method: "shipping_method";
        negation: "negation";
    }>;
    value: z.ZodString;
    confidence: z.ZodNumber;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export declare const V2ProposedActionSchema: z.ZodObject<{
    action_type: z.ZodEnum<{
        ADD_TO_CART: "ADD_TO_CART";
        REMOVE_FROM_CART: "REMOVE_FROM_CART";
        UPDATE_CART_QUANTITY: "UPDATE_CART_QUANTITY";
        CANCEL_ORDER: "CANCEL_ORDER";
        SHOW_RELATED_PRODUCTS: "SHOW_RELATED_PRODUCTS";
        OPEN_CATALOG: "OPEN_CATALOG";
        OPEN_CART: "OPEN_CART";
        CONTACT_ADMIN: "CONTACT_ADMIN";
        NONE: "NONE";
    }>;
    payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    confidence: z.ZodNumber;
    requires_validation: z.ZodBoolean;
}, z.core.$strip>;
export declare const V2UncertaintySignalSchema: z.ZodObject<{
    type: z.ZodEnum<{
        ambiguous_entity: "ambiguous_entity";
        missing_context: "missing_context";
        contradiction: "contradiction";
        low_confidence: "low_confidence";
        out_of_scope: "out_of_scope";
    }>;
    description: z.ZodString;
}, z.core.$strip>;
export declare const V2EngineOutputSchema: z.ZodObject<{
    schema_version: z.ZodLiteral<"v1">;
    intent: z.ZodEnum<{
        readonly PRODUCT_INQUIRY: "product_inquiry";
        readonly ADD_TO_CART: "add_to_cart";
        readonly DONE_ORDERING: "done_ordering";
        readonly MODIFY_CART: "modify_cart";
        readonly PAYMENT_INQUIRY: "payment_inquiry";
        readonly SHIPPING_INQUIRY: "shipping_inquiry";
        readonly ORDER_STATUS: "order_status";
        readonly CANCEL_ORDER: "cancel_order";
        readonly SMALLTALK: "smalltalk";
        readonly CLARIFICATION: "clarification";
        readonly ESCALATION: "escalation";
        readonly UNKNOWN: "unknown";
    }>;
    confidence: z.ZodNumber;
    entities: z.ZodArray<z.ZodObject<{
        type: z.ZodEnum<{
            other: "other";
            product: "product";
            order_status: "order_status";
            price: "price";
            customer_name: "customer_name";
            customer_phone: "customer_phone";
            quantity: "quantity";
            variant: "variant";
            greeting: "greeting";
            rollback: "rollback";
            customer_address: "customer_address";
            payment_method: "payment_method";
            shipping_method: "shipping_method";
            negation: "negation";
        }>;
        value: z.ZodString;
        confidence: z.ZodNumber;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, z.core.$strip>>;
    proposed_actions: z.ZodArray<z.ZodObject<{
        action_type: z.ZodEnum<{
            ADD_TO_CART: "ADD_TO_CART";
            REMOVE_FROM_CART: "REMOVE_FROM_CART";
            UPDATE_CART_QUANTITY: "UPDATE_CART_QUANTITY";
            CANCEL_ORDER: "CANCEL_ORDER";
            SHOW_RELATED_PRODUCTS: "SHOW_RELATED_PRODUCTS";
            OPEN_CATALOG: "OPEN_CATALOG";
            OPEN_CART: "OPEN_CART";
            CONTACT_ADMIN: "CONTACT_ADMIN";
            NONE: "NONE";
        }>;
        payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        confidence: z.ZodNumber;
        requires_validation: z.ZodBoolean;
    }, z.core.$strip>>;
    reply_text: z.ZodString;
    needs_clarification: z.ZodBoolean;
    clarification_question: z.ZodOptional<z.ZodString>;
    summary_update: z.ZodOptional<z.ZodString>;
    uncertainty_signals: z.ZodArray<z.ZodObject<{
        type: z.ZodEnum<{
            ambiguous_entity: "ambiguous_entity";
            missing_context: "missing_context";
            contradiction: "contradiction";
            low_confidence: "low_confidence";
            out_of_scope: "out_of_scope";
        }>;
        description: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type V2EngineOutputValidated = z.infer<typeof V2EngineOutputSchema>;
//# sourceMappingURL=schema.d.ts.map