import { prisma } from '../src/infrastructure/prisma.js';

async function main() {
  const STORE_ID = 'store-a3cd7205';
  const scenarios = [
    { cust: 'unit6b-sc1-cust', conv: 'unit6b-sc1-conv' },
    { cust: 'unit6b-sc2-cust', conv: 'unit6b-sc2-conv' },
    { cust: 'unit6b-sc3-cust', conv: 'unit6b-sc3-conv' },
    { cust: 'unit6b-sc4-cust', conv: 'unit6b-sc4-conv' },
    { cust: 'unit6b-sc5-cust', conv: 'unit6b-sc5-conv' },
  ];
  
  for (const s of scenarios) {
    const customer = await prisma.customer.create({
      data: { storeId: STORE_ID, webUid: s.cust, phone: null }
    });
    const conversation = await prisma.conversation.create({
      data: { storeId: STORE_ID, customerId: customer.id, channel: 'web', customerPhone: null, status: 'open' }
    });
    console.log(`${s.cust} -> ${customer.id}, ${s.conv} -> ${conversation.id}`);
  }
  
  await prisma.$disconnect();
}

main();
