import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function run() {
  console.log("=== 1. Check Conversation ===");
  const conv = await prisma.conversation.findMany({
    select: { id: true, storeId: true, customerId: true, status: true, createdAt: true },
    take: 1
  });
  console.table(conv);

  console.log("\n=== 2. Check Messages (5 Terbaru) ===");
  const messages = await prisma.conversationMessage.findMany({
    select: { id: true, conversationId: true, sender: true, content: true, source: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 5
  });
  console.table(messages);

  console.log("\n=== 3. Check FAQ Match ===");
  const faqMessages = await prisma.conversationMessage.findMany({
    where: { source: 'faq' },
    select: { id: true, sender: true, content: true, source: true },
    take: 3
  });
  console.table(faqMessages);

  process.exit(0);
}
run().catch(console.error);
