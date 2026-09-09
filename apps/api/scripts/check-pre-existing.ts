import { prisma } from '../src/infrastructure/prisma.js';

async function main() {
  // Check if these products existed BEFORE our seeding by looking at createdAt
  const products = await prisma.product.findMany({
    where: { storeId: 'store-a3cd7205', name: { in: ['Busi Motor', 'Ban Dalam Motor', 'Oli Mesin'] } },
    select: { id: true, name: true, createdAt: true, updatedAt: true }
  });
  console.log('Products in canary store:');
  console.log(JSON.stringify(products, null, 2));
  
  // Also check for any [TEST] prefixed products
  const testProducts = await prisma.product.findMany({
    where: { storeId: 'store-a3cd7205', name: { startsWith: '[TEST]' } },
    select: { id: true, name: true, createdAt: true }
  });
  console.log('Test products:');
  console.log(JSON.stringify(testProducts, null, 2));
  
  await prisma.$disconnect();
}

main();
