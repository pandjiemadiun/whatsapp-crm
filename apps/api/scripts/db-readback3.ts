import { prisma } from '../src/infrastructure/prisma.js';

async function main() {
  try {
    // Check claims for scenario 2
    const claims = await prisma.actionIdempotency.findMany({
      where: { storeId: 'store-a3cd7205', actionType: 'WA_CART_MUTATION', actionId: { startsWith: 'web:05ead4e7-8a39-4ef3-aa9d-f41ab1ba5f9f:' } },
      select: { actionId: true, status: true }
    });
    console.log('Scenario 2 claims:', JSON.stringify(claims, null, 2));
    
    // Check all orders for sc2
    const orders = await prisma.order.findMany({
      where: { conversationId: '05ead4e7-8a39-4ef3-aa9d-f41ab1ba5f9f' },
      include: { orderItems: true }
    });
    console.log('Scenario 2 orders:', JSON.stringify(orders.map(o => ({ id: o.id, status: o.orderStatus, total: o.totalPrice, items: o.orderItems.map(i => ({ name: i.productName, qty: i.quantity })) })), null, 2));
  } catch (e) {
    console.error('ERROR:', e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
