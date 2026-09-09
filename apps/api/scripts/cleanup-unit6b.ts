import { prisma } from '../src/infrastructure/prisma.js';

async function main() {
  const STORE_ID = 'store-a3cd7205';
  
  const scenarioConversations = [
    '6820af04-aafc-4c25-a7e8-6fe5ead55295',
    '05ead4e7-8a39-4ef3-aa9d-f41ab1ba5f9f',
    'ec056cf5-de1b-4891-980f-84382a46a77a',
    'fe8db315-e7c5-4543-b330-a4c962b3c979',
    'a4b0a49a-8093-4c12-b4b7-8f195dd5997c',
  ];
  
  const scenarioCustomers = [
    'dcb26473-4771-4c37-856a-b573b4e70bcd',
    '83d12839-fcc2-4d52-9747-bd48e9abbee9',
    '398cdc6e-3c8e-4a53-938a-6647a5dd79f2',
    '4eb9b016-6f77-4429-96bc-492f2de05fcc',
    '246a0e0b-7b64-4c3f-a2a9-6eb631f61a30',
  ];
  
  const clientMsgIds = [
    'unit6b-sc1-cmk',
    'unit6b-sc2a-cmk',
    'unit6b-sc2b-cmk',
    'unit6b-sc3-cmk',
    'unit6b-sc4-cmk',
    'unit6b-sc5-cmk',
  ];
  
  // BEFORE counts
  console.log('=== BEFORE COUNTS ===');
  
  const beforeOrderItems = await prisma.orderItem.count({
    where: { order: { conversationId: { in: scenarioConversations } } }
  });
  console.log(`orderItems (scenario convs): ${beforeOrderItems}`);
  
  const beforeOrders = await prisma.order.count({
    where: { conversationId: { in: scenarioConversations } }
  });
  console.log(`orders (scenario convs): ${beforeOrders}`);
  
  const beforeActionIdemp = await prisma.actionIdempotency.count({
    where: {
      storeId: STORE_ID,
      actionType: 'WA_CART_MUTATION',
      actionId: { startsWith: 'web:' }
    }
  });
  console.log(`actionIdempotency (web prefix, all): ${beforeActionIdemp}`);
  
  const beforeConvCtx = await prisma.conversationContext.count({
    where: { conversationId: { in: scenarioConversations } }
  });
  console.log(`conversationContext (scenario convs): ${beforeConvCtx}`);
  
  const beforeConvHist = await prisma.conversationHistory.count({
    where: { conversationId: { in: scenarioConversations } }
  });
  console.log(`conversationHistory (scenario convs): ${beforeConvHist}`);
  
  const beforeConvs = await prisma.conversation.count({
    where: { id: { in: scenarioConversations } }
  });
  console.log(`conversations (scenario convs): ${beforeConvs}`);
  
  const beforeCustomers = await prisma.customer.count({
    where: { id: { in: scenarioCustomers } }
  });
  console.log(`customers (scenario): ${beforeCustomers}`);
  
  const totalConvsBefore = await prisma.conversation.count({ where: { storeId: STORE_ID } });
  console.log(`total conversations in canary store: ${totalConvsBefore}`);
  
  const beforeProducts = await prisma.product.count({
    where: { storeId: STORE_ID, name: { in: ['Busi Motor', 'Ban Dalam Motor', 'Oli Mesin'] } }
  });
  console.log(`products to potentially delete: ${beforeProducts}`);
  
  // DELETE order items
  await prisma.orderItem.deleteMany({
    where: { order: { conversationId: { in: scenarioConversations } } }
  });
  console.log('Deleted orderItems');
  
  // DELETE orders
  await prisma.order.deleteMany({
    where: { conversationId: { in: scenarioConversations } }
  });
  console.log('Deleted orders');
  
  // DELETE action idempotency for these clientMsgIds
  for (const msgId of clientMsgIds) {
    await prisma.actionIdempotency.deleteMany({
      where: { storeId: STORE_ID, actionType: 'WA_CART_MUTATION', actionId: { startsWith: `web:${msgId}` } }
    }).catch(() => {});
  }
  // Also delete by conversation prefix
  for (const convId of scenarioConversations) {
    await prisma.actionIdempotency.deleteMany({
      where: { storeId: STORE_ID, actionType: 'WA_CART_MUTATION', actionId: { startsWith: `web:${convId}:` } }
    }).catch(() => {});
  }
  console.log('Deleted actionIdempotency');
  
  // DELETE conversation context
  await prisma.conversationContext.deleteMany({
    where: { conversationId: { in: scenarioConversations } }
  });
  console.log('Deleted conversationContext');
  
  // DELETE conversation history
  await prisma.conversationHistory.deleteMany({
    where: { conversationId: { in: scenarioConversations } }
  });
  console.log('Deleted conversationHistory');
  
  // DELETE conversations
  await prisma.conversation.deleteMany({
    where: { id: { in: scenarioConversations } }
  });
  console.log('Deleted conversations');
  
  // DELETE customers
  await prisma.customer.deleteMany({
    where: { id: { in: scenarioCustomers } }
  });
  console.log('Deleted customers');
  
  // DELETE products created for this test (all 3 were created at the same time during our seeding)
  const deletedProducts = await prisma.product.deleteMany({
    where: { storeId: STORE_ID, name: { in: ['Busi Motor', 'Ban Dalam Motor', 'Oli Mesin'] } }
  });
  console.log(`Deleted products: ${deletedProducts.count}`);
  
  // AFTER counts
  console.log('\n=== AFTER COUNTS ===');
  
  const afterOrderItems = await prisma.orderItem.count({
    where: { order: { conversationId: { in: scenarioConversations } } }
  });
  console.log(`orderItems (scenario convs): ${afterOrderItems}`);
  
  const afterOrders = await prisma.order.count({
    where: { conversationId: { in: scenarioConversations } }
  });
  console.log(`orders (scenario convs): ${afterOrders}`);
  
  const afterActionIdemp = await prisma.actionIdempotency.count({
    where: {
      storeId: STORE_ID,
      actionType: 'WA_CART_MUTATION',
      actionId: { startsWith: 'web:' }
    }
  });
  console.log(`actionIdempotency (web prefix, all): ${afterActionIdemp}`);
  
  const afterConvCtx = await prisma.conversationContext.count({
    where: { conversationId: { in: scenarioConversations } }
  });
  console.log(`conversationContext (scenario convs): ${afterConvCtx}`);
  
  const afterConvHist = await prisma.conversationHistory.count({
    where: { conversationId: { in: scenarioConversations } }
  });
  console.log(`conversationHistory (scenario convs): ${afterConvHist}`);
  
  const afterConvs = await prisma.conversation.count({
    where: { id: { in: scenarioConversations } }
  });
  console.log(`conversations (scenario convs): ${afterConvs}`);
  
  const afterCustomers = await prisma.customer.count({
    where: { id: { in: scenarioCustomers } }
  });
  console.log(`customers (scenario): ${afterCustomers}`);
  
  const totalConvsAfter = await prisma.conversation.count({ where: { storeId: STORE_ID } });
  console.log(`total conversations in canary store: ${totalConvsAfter}`);
  
  const afterProducts = await prisma.product.count({
    where: { storeId: STORE_ID, name: { in: ['Busi Motor', 'Ban Dalam Motor', 'Oli Mesin'] } }
  });
  console.log(`products remaining: ${afterProducts}`);
  
  // Verify batch1/batch2 conversations untouched
  const batch1batch2Count = await prisma.conversation.count({
    where: { storeId: STORE_ID, id: { notIn: scenarioConversations } }
  });
  console.log(`\nNon-scenario conversations (should include 54 batch1/batch2): ${batch1batch2Count}`);
  
  await prisma.$disconnect();
}

main();
