import { prisma } from '../src/infrastructure/prisma.js';

async function main() {
  const conversations = [
    '6820af04-aafc-4c25-a7e8-6fe5ead55295', // sc1
    '05ead4e7-8a39-4ef3-aa9d-f41ab1ba5f9f', // sc2
    'ec056cf5-de1b-4891-980f-84382a46a77a', // sc3
    'fe8db315-e7c5-4543-b330-a4c962b3c979', // sc4
    'a4b0a49a-8093-4c12-b4b7-8f195dd5997c', // sc5
  ];
  
  for (const convId of conversations) {
    const items = await prisma.orderItem.findMany({
      where: { order: { conversationId: convId } },
      include: { order: { select: { orderStatus: true, totalPrice: true } } }
    });
    console.log(`Conv ${convId}: ${items.length} items`);
    for (const item of items) {
      console.log(`  - ${item.productName} x${item.qty} @ ${item.unitPrice} (orderStatus: ${item.order.orderStatus})`);
    }
  }
  
  await prisma.$disconnect();
}

main();
