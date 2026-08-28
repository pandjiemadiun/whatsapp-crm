/**
 * FASE 5 — presentation-only types.
 *
 * Backend is AUTHORITATIVE (RULE #1). These types ONLY mirror the canonical
 * `message.created` / HTTP envelope shapes that the backend already delivers
 * (see conversation-delivery.service.ts MessageCreatedData + StructuredMessage).
 * The PWA renders these values verbatim; it never decides orderStatus, payment,
 * product availability, cart authority, or conversation status.
 */

/** Canonical role vocabulary used by the PWA render layer.
 *  Mapping from the backend `sender`:
 *    customer      -> 'user'
 *    assistant     -> 'assistant'
 *    human_agent   -> 'agent'      (distinct from AI — FASE 5 Step 1)
 *    (client-only) -> 'system'      (e.g. "Pesan diteruskan ke admin")
 */
export type SenderRole = 'user' | 'assistant' | 'agent' | 'system';

/**
 * Structured message type union — mirrors the backend StructuredMessageType
 * (structured-message.mapper.ts). Only a 6-type whitelist receives specialized
 * UI (RULE #2); all other types fall back to plain text rendering.
 */
export type StructuredMessageType =
  | 'text'
  | 'product'
  | 'product_list'
  | 'cart'
  | 'quick_reply'
  | 'button'
  | 'order'
  | 'checkout'
  | 'image'
  | 'system'
  | 'handoff'
  | 'payment'
  | 'notification';

export interface ChatMessage {
  id?: string;
  role: SenderRole;
  content: string;
  source?: string | null;
  /** Structured type authored by the engine (HARD RULE #11/#12). Default 'text'. */
  type?: StructuredMessageType;
  /** Structured payload (null for text). May be absent/malformed -> text fallback. */
  payload?: unknown;
  createdAt?: string;
}

// ── Authoritative payload shapes (FASE 2 structured mapping) ────────────────
// Only these types carry authoritative payloads today (see §6 of the inspection
// report). The PWA renders exactly these fields and nothing fabricated.

export interface ProductPayload {
  id: string | null;
  name: string | null;
  price: number | null;
  stock: number | null; // null === unlimited stock
  imageUrl: string | null;
  hasVariants: boolean;
  variants?: VariantOption[];
}

export interface VariantOption {
  id: string;
  label: string;
  price: number | null;
  stock: number | null;
  sku: string | null;
}

export interface ProductListItem {
  id: string | null;
  name: string | null;
  price: number | null;
  stock: number | null;
  imageUrl: string | null;
}

export interface ProductListPayload {
  items: ProductListItem[];
}

export interface CartItem {
  id: string;
  productId: string | null;  // FK to Product (nullable if product deleted)
  productName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  variantId?: string | null;
  variantLabel?: string | null;
}

export interface CartPayload {
  items: CartItem[];
  total: number | null;
  cartOpsExecuted?: number;
  /** orderId of the draft order this cart belongs to (needed for checkout). */
  orderId?: string;
}

/** Store payment info for PWA checkout (transfer/qris). Mirrors backend payment-info. */
export interface BankAccountInfo {
  bankName: string;
  accountNumber: string;
  accountName: string;
}
export interface PaymentInfo {
  acceptsTransfer: boolean;
  acceptsQris: boolean;
  acceptsCod: boolean;
  qrisImageUrl: string | null;
  bankAccounts: BankAccountInfo[];
}

/** CartOp / ClarificationOption — server-executed signals, NOT client actions. */
export interface CartOp {
  type: 'add' | 'remove';
  product: string;
  qty?: number;
  price?: number;
}

export interface ClarificationOption {
  id: string;
  label: string;
  cartOps?: CartOp[];
  action?: string;
}

export interface QuickReplyPayload {
  reason?: string;
  question: string;
  options: ClarificationOption[];
}

export interface HandoffPayload {
  reason?: string;
  content?: string;
}

/** Product as returned by the public store product endpoint:
 *  GET /api/stores/:storeId/products (routes/products.ts, no-auth).
 *  Used by PWA for first-open product discovery. */
export interface ChatProduct {
  id: string;
  name: string;
  description: string | null;
  price: number;
  stock: number | null; // null === unlimited stock
  primaryImageUrl: string | null;
  hasVariants: boolean;
}
