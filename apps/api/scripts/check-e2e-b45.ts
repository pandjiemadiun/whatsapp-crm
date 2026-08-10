import { prisma } from '../src/infrastructure/prisma.js';

async function main() {
  // E2E 1: "kak nanya stok kangkung?" (sender: 6281231944200)
  // Expected: product info (kangkung ada di DB), NOT "belum tersedia"
  const r1 = await prisma.conversationHistory.findMany({
    where: { conversationId: 'store-f7140b5c:6281231944200', role: 'assistant' },
    orderBy: { createdAt: 'desc' },
    take: 2,
    select: { content: true, source: true, createdAt: true },
  });
  console.log('=== E2E 1: "kak nanya stok kangkung?" ===');
  for (const r of r1) {
    console.log(`[${r.source}] ${r.content?.substring(0, 200)}`);
  }

  // E2E 2: "ada durian?" (sender: 6281380000999)
  // Expected: "belum tersedia" (durian tidak ada di katalog canary)
  const r2 = await prisma.conversationHistory.findMany({
    where: { conversationId: 'store-f7140b5c:6281380000999', role: 'assistant' },
    orderBy: { createdAt: 'desc' },
    take: 2,
    select: { content: true, source: true, createdAt: true },
  });
  console.log('\n=== E2E 2: "ada durian?" ===');
  for (const r of r2) {
    console.log(`[${r.source}] ${r.content?.substring(0, 200)}`);
  }

  // Check both responses
  const hasNotFound = r1.some(r => r.content?.includes('belum tersedia'));
  const hasProductInfo = r1.some(r => !r.content?.includes('belum tersedia') && r.content?.length > 0);
  const hasCatNotAvailable = r2.some(r => r.content?.includes('belum tersedia'));

  console.log('\n=== VERIFICATION ===');
  console.log(`E2E 1 "kak nanya stok kangkung?" → belum tersedia? ${hasNotFound ? 'YES (BUG!)' : 'NO (benar)'}`);
  console.log(`E2E 1 → dapat jawaban produk? ${hasProductInfo ? 'YES (benar)' : 'NO'}`);
  console.log(`E2E 2 "ada durian?" → balas "belum tersedia"? ${hasCatNotAvailable ? 'YES (benar)' : 'NO (REGRESI!)'}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
