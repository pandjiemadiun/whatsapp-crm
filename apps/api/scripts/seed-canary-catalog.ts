import { prisma } from '../src/infrastructure/prisma.js';

async function main() {
  const STORE_ID = 'store-a3cd7205';
  
  // Create category
  const category = await prisma.productCategory.create({
    data: { storeId: STORE_ID, name: 'Spare Parts', displayOrder: 1 }
  });
  console.log('Created category:', category.id);
  
  // Create products
  const products = [
    { name: 'Busi Motor', price: 15000, stock: 50, sku: 'BUSI-MOTOR-V2' },
    { name: 'Ban Dalam Motor', price: 50000, stock: 100, sku: 'BAN-DALAM-V2' },
    { name: 'Oli Mesin', price: 75000, stock: 30, sku: 'OLI-MESIN-V2' },
  ];
  
  for (const p of products) {
    const created = await prisma.product.create({
      data: { storeId: STORE_ID, categoryId: category.id, ...p }
    });
    console.log('Created product:', created.id, created.name);
  }
  
  await prisma.$disconnect();
}

main();
