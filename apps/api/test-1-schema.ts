#!/usr/bin/env node
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testSchema() {
  console.log('\n╔════════════════════════════════════════════════╗');
  console.log('║  TEST 1: PRISMA SCHEMA VALIDATION              ║');
  console.log('╚════════════════════════════════════════════════╝\n');

  try {
    // Test 1.1: Create test store
    console.log('▶ 1.1: Creating test store...\n');
    const store = await prisma.store.create({
      data: {
        name: 'Test Store',
        phone: '6281234567890',
      },
    });
    console.log(`✅ Store created: ${store.id}\n`);

    // Test 1.2: Create conversation
    console.log('▶ 1.2: Creating conversation (session)...\n');
    const conversation = await prisma.conversation.create({
      data: {
        userId: 'user-test-001',
        storeId: store.id,
        status: 'active',
        topic: 'test_inquiry',
      },
    });
    console.log(`✅ Conversation created: ${conversation.id}`);
    console.log(`   userId: ${conversation.userId}`);
    console.log(`   storeId: ${conversation.storeId}`);
    console.log(`   status: ${conversation.status}`);
    console.log(`   createdAt: ${conversation.createdAt}\n`);

    // Test 1.3: Create conversation history
    console.log('▶ 1.3: Creating conversation messages (history)...\n');
    const msg1 = await prisma.conversationHistory.create({
      data: {
        conversationId: conversation.id,
        role: 'user',
        content: 'Berapa harga produk?',
        source: 'user_input',
        metadata: JSON.stringify({ intent: 'pricing' }),
      },
    });
    console.log(`✅ Message 1 created (user): ${msg1.id}\n`);

    const msg2 = await prisma.conversationHistory.create({
      data: {
        conversationId: conversation.id,
        role: 'assistant',
        content: 'Harga produk kami adalah Rp 100.000',
        source: 'faq',
        tokens: 25,
        cost: 0.0001,
      },
    });
    console.log(`✅ Message 2 created (assistant): ${msg2.id}\n`);

    // Test 1.4: Query relationships
    console.log('▶ 1.4: Testing relationships...\n');
    const convWithMessages = await prisma.conversation.findUnique({
      where: { id: conversation.id },
      include: { messages: true },
    });

    console.log(`✅ Conversation with messages:`);
    console.log(`   Messages count: ${convWithMessages?.messages.length}`);
    convWithMessages?.messages.forEach((m, i) => {
      console.log(`   ${i + 1}. ${m.role}: ${m.content.substring(0, 40)}...`);
    });

    console.log('\n╔════════════════════════════════════════════════╗');
    console.log('║  ✅ TEST 1 PASSED: Schema is valid            ║');
    console.log('╚════════════════════════════════════════════════╝\n');

    return { storeId: store.id, conversationId: conversation.id };
  } catch (error) {
    console.error('❌ TEST 1 FAILED:', error);
    process.exit(1);
  }
}

testSchema().then(() => process.exit(0));
