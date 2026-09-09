import { prisma } from '../src/infrastructure/prisma.js';

async function main() {
  try {
    const conversations = [
      { id: '6820af04-aafc-4c25-a7e8-6fe5ead55295', name: 'sc1' },
      { id: '05ead4e7-8a39-4ef3-aa9d-f41ab1ba5f9f', name: 'sc2' },
      { id: 'ec056cf5-de1b-4891-980f-84382a46a77a', name: 'sc3' },
      { id: 'fe8db315-e7c5-4543-b330-a4c962b3c979', name: 'sc4' },
      { id: 'a4b0a49a-8093-4c12-b4b7-8f195dd5997c', name: 'sc5' },
    ];
    
    for (const c of conversations) {
      const order = await prisma.order.findFirst({
        where: { conversationId: c.id, orderStatus: 'draft' },
        include: { orderItems: { orderBy: { createdAt: 'asc' } } }
      });
      if (!order) {
        console.log(`${c.name}: no draft order`);
        continue;
      }
      console.log(`${c.name} order ${order.id}: totalPrice=${order.totalPrice}, items=${order.orderItems.length}`);
      for (const item of order.orderItems) {
        console.log(`  - ${item.productName} qty=${item.quantity} price=${item.unitPrice} subtotal=${item.subtotal}`);
      }
    }
  } catch (e) {
    console.error('ERROR:', e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
