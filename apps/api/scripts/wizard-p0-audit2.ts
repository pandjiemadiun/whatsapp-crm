import { prisma } from '../src/infrastructure/prisma.js';

async function main() {
  // Check FAQ rows for store-a3cd7205
  console.log('=== FAQ ROWS FOR store-a3cd7205 ===');
  const faqs = await prisma.fAQ.findMany({
    where: { storeId: 'store-a3cd7205' },
    select: { id: true, question: true, answer: true, category: true, priority: true, source: true, createdAt: true }
  });
  console.log(JSON.stringify(faqs, null, 2));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
