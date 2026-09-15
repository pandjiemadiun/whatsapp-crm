import { prisma } from '../src/infrastructure/prisma.js';

async function main() {
  const STORE_ID = 'store-a3cd7205';

  // ── Find-or-create category (idempotent — tidak duplikat saat re-run) ──
  const existingCategory = await prisma.productCategory.findFirst({
    where: { storeId: STORE_ID, name: 'Spare Parts' },
  });
  const category = existingCategory ?? await prisma.productCategory.create({
    data: { storeId: STORE_ID, name: 'Spare Parts', displayOrder: 1 },
  });
  console.log('Category ready:', category.id);

  // ── Products: upsert by (storeId, sku) unique constraint ──
  // Acceptance: 3 produk aktif (Busi Motor, Ban Dalam Motor, Oli Mesin)
  // untuk skenario implicit_ref_relative_price_cheapest & implicit_ref_itu_plus_new_item
  const products = [
    { name: 'Busi Motor', price: 15000, stock: 50, sku: 'BUSI-MOTOR-V2' },
    { name: 'Ban Dalam Motor', price: 50000, stock: 100, sku: 'BAN-DALAM-V2' },
    { name: 'Oli Mesin', price: 75000, stock: 30, sku: 'OLI-MESIN-V2' },
  ];

  for (const p of products) {
    const upserted = await prisma.product.upsert({
      where: { storeId_sku: { storeId: STORE_ID, sku: p.sku } },
      create: { storeId: STORE_ID, categoryId: category.id, ...p },
      update: {
        name: p.name,
        price: p.price,
        stock: p.stock,
        isActive: true,
        deletedAt: null,
      },
    });
    console.log('Upserted product:', upserted.id, upserted.name, `(active=${upserted.isActive})`);
  }

  await prisma.$disconnect();
  // Force-exit setelah disconnect — Prisma engine + encryption setInterval
  // (prisma.ts) menahan event loop agar proses tidak keluar dengan signal kill.
  process.exit(0);
}

main().catch(async (e) => {
  console.error('Seed failed:', e);
  await prisma.$disconnect();
  process.exit(1);
});
