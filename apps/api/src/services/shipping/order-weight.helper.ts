import { prisma } from '../../infrastructure/prisma.js';

/**
 * Read-only helper: total weight (grams) of an order's items, computed as
 * SUM(OrderItem.quantity * Product.weight) via a single joined query.
 *
 * NOTE: deliberately placed OUTSIDE cart-authority.ts. That file is
 * contract-locked (owner-approved amendment required to modify), and this is a
 * pure read query with no cart-mutation semantics, so it does not belong there.
 *
 * Empty cart (no OrderItems) → returns 0. The empty-cart CASE is intentionally
 * NOT an error here: callers (e.g. the shipping-options endpoint, UNIT 3) own
 * the policy decision of translating weight 0 into a "keranjang kosong" 400.
 * Keeping this helper a pure calculator keeps that policy in one place.
 */
export async function getOrderWeightGrams(orderId: string): Promise<number> {
  const items = await prisma.orderItem.findMany({
    where: { orderId },
    select: {
      quantity: true,
      product: { select: { weight: true } },
    },
  });

  return items.reduce((sum, item) => {
    const unit = item.product?.weight ?? 0;
    return sum + item.quantity * unit;
  }, 0);
}
