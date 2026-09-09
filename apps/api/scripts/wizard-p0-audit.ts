import { prisma } from '../src/infrastructure/prisma.js';

async function main() {
  // 1. Check FAQ counts per store
  console.log('=== FAQ COUNTS PER STORE ===');
  const faqCounts = await prisma.$queryRaw`SELECT "storeId" as store_id, CAST(COUNT(*) as INTEGER) as count FROM faqs GROUP BY "storeId"`;
  console.log(JSON.stringify(faqCounts, null, 2));

  // 2. Check Knowledge counts per store
  console.log('\n=== KNOWLEDGE COUNTS PER STORE ===');
  const knowledgeCounts = await prisma.$queryRaw`SELECT "storeId" as store_id, CAST(COUNT(*) as INTEGER) as count FROM knowledge_base GROUP BY "storeId"`;
  console.log(JSON.stringify(knowledgeCounts, null, 2));

  // 3. Check if source column exists and what values it has
  console.log('\n=== FAQ SOURCE VALUES ===');
  const faqSources = await prisma.$queryRaw`SELECT DISTINCT source FROM faqs WHERE source IS NOT NULL`;
  console.log(JSON.stringify(faqSources, null, 2));

  console.log('\n=== KNOWLEDGE SOURCE VALUES ===');
  const knowledgeSources = await prisma.$queryRaw`SELECT DISTINCT source FROM knowledge_base WHERE source IS NOT NULL`;
  console.log(JSON.stringify(knowledgeSources, null, 2));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
