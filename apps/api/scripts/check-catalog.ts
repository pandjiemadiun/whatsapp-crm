import { prisma } from '../src/infrastructure/prisma.js';

async function main() {
  const products = await prisma.product.findMany({
    where: { storeId: 'store-a3cd7205' },
    select: { id: true, name: true, price: true, stock: true },
    orderBy: { name: 'asc' }
  });
  console.log('Canary catalog:');
  console.log(JSON.stringify(products, null, 2));
  
  const busiMobil = await prisma.product.findFirst({
    where: { storeId: 'store-a3cd7205', name: { contains: 'busi mobil', mode: 'insensitive' } }
  });
  console.log('Busi Mobil exists:', !!busiMobil);
  
  await prisma.$disconnect();
}

main();
