/**
 * V2 Engine — System Enrichment for Reply Text
 *
 * P2-UNIT5: Enrich V2 reply_text with prices/stock from the SYSTEM
 * (CartAuthority / productService), NOT from the V2 LLM output.
 *
 * Design principle (I13 / P1-FIX rule #4): "JANGAN masukkan harga/stok/varian
 * ID di reply_text. Harga dan stok akan di-enrich sistem setelah kamu propose
 * action."
 *
 * This enrichment is ONLY for logging/comparison in V2ShadowLog — the enriched
 * reply is NOT sent to the customer. It exists so V1 vs V2 comparison is fair
 * (both replies should have prices).
 */
import { cartAuthority } from '../../../business/cart-authority.js';
import { productService } from '../../../business/product.service.js';
import { prisma } from '../../../infrastructure/prisma.js';
import type { V2EngineOutput, V2ProposedAction } from './schema.js';
import type { V2EngineResult } from './engine-call.js';

/** Cart-action types that may involve price information in reply_text. */
const PRICE_RELEVANT_ACTIONS: V2ProposedAction['action_type'][] = [
  'ADD_TO_CART',
  'REMOVE_FROM_CART',
  'UPDATE_CART_QUANTITY',
  'OPEN_CART',
  'CANCEL_ORDER',
];

/** Indonesian Rupiah formatter: 65000 → "Rp 65.000" */
export function formatPrice(value: number | null | undefined): string {
  const n = value ?? 0;
  return 'Rp ' + n.toLocaleString('id-ID').replace(/,/g, '.');
}

/**
 * Returns true if any proposed action warrants price enrichment.
 */
function shouldEnrich(v2Output: V2EngineOutput): boolean {
  return v2Output.proposed_actions.some((a: V2ProposedAction) =>
    PRICE_RELEVANT_ACTIONS.includes(a.action_type)
  );
}

/**
 * Enrich V2 reply_text with prices from CartAuthority (authoritative) and
 * productService (catalog). Harga dari v2Output.entities['price'] TIDAK
 * dipakai — I13 tetap berlaku.
 *
 * @param v2Output   Parsed V2 engine output
 * @param storeId    Store for product price lookup
 * @param conversationId  Conversation for cart summary lookup
 * @returns Enriched reply_text (for logging only — NOT sent to customer)
 */
export async function enrichV2Reply(
  v2Output: V2EngineOutput,
  storeId: string,
  conversationId: string,
): Promise<string> {
  if (!shouldEnrich(v2Output)) {
    return v2Output.reply_text;
  }

  let enriched = v2Output.reply_text;
  const enrichmentParts: string[] = [];

  // 1. Product entities → lookup REAL price from productService (DB, authoritative)
  const productEntities = v2Output.entities.filter((e) => e.type === 'product' || e.type === 'price');
  if (productEntities.length > 0) {
    // Fetch all active products for store (single DB read)
    const products = await productService.listActiveProducts(storeId);

    for (const entity of productEntities) {
      // Match by name (substring, case-insensitive) — LLM entity value is product name hint
      const match = products.find(
        (p) =>
          p.name.toLowerCase().includes(entity.value.toLowerCase()) ||
          entity.value.toLowerCase().includes(p.name.toLowerCase()),
      );
      if (match && match.price !== null && match.price > 0) {
        enrichmentParts.push(`${match.name}: ${formatPrice(match.price)}`);
      }
    }
  }

  // 2. Cart actions (ADD_TO_CART, OPEN_CART, etc.) → read REAL prices from CartAuthority
  try {
    const cartSummary = await cartAuthority.getCartSummary(conversationId);

    if (cartSummary.items.length > 0) {
      const itemLines = cartSummary.items.map((item) => {
        const linePrice = item.subtotal > 0 ? formatPrice(item.subtotal) : '';
        const unitPrice = item.unitPrice > 0 ? formatPrice(item.unitPrice) : '';
        if (item.quantity > 1 && unitPrice) {
          return `${item.productName} (${item.quantity}x @ ${unitPrice}) = ${linePrice}`;
        }
        return `${item.productName} (${item.quantity}x) ${linePrice}`;
      });
      enrichmentParts.push(`--- Rincian ---\n${itemLines.join('\n')}`);

      if (cartSummary.total !== null && cartSummary.total > 0) {
        enrichmentParts.push(`Total: ${formatPrice(cartSummary.total)}`);
      }
    }
  } catch (err) {
    // Enrichment failure must NOT throw — log and continue
    // The V2ShadowLog will have the un-enriched reply + a note
    enrichmentParts.push('[enrichment: cart lookup failed]');
  }

  // 3. If there are NO product entities and NO cart items but there are price-relevant actions
  //    (e.g., CANCEL_ORDER — no items to show), append nothing
  if (enrichmentParts.length > 0) {
    enriched += `\n\n${enrichmentParts.join('\n')}`;
  }

  return enriched;
}

/**
 * Safe wrapper: enrich V2 reply with total try-catch.
 * If V2 engine failed (success: false), returns null for v2EnrichedReply.
 * If enrichment throws, returns the raw reply_text as fallback (no crash).
 */
export async function safeEnrichV2Reply(
  v2Result: V2EngineResult,
  storeId: string,
  conversationId: string,
): Promise<string | null> {
  if (!v2Result.success) {
    return null;
  }

  try {
    return await enrichV2Reply(v2Result.data, storeId, conversationId);
  } catch (err) {
    // Enrichment must never crash the shadow log
    return v2Result.data.reply_text;
  }
}
