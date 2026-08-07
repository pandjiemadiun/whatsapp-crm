#!/usr/bin/env node
import 'dotenv/config';
import { adapters, initAdapters } from './apps/api/src/adapters/container.js';

// --- MOCK CLASSES (Simulasi Phase 2) ---

class MockPromptBuilder {
  build(userMessage: string) {
    return `
      Anda adalah asisten virtual resmi untuk Project Garuda.
      Tugas Anda adalah menjawab pertanyaan pengguna dengan sopan dan ringkas (maksimal 2 kalimat).
      Jika pengguna bertanya sesuatu yang spesifik mengenai produk, pastikan Anda memberikan jawaban yang aman.
      Pertanyaan Pengguna: "${userMessage}"
    `;
  }
}

class MockFAQEngine {
  async search(query: string) {
    const text = query.toLowerCase();
    if (text.includes('ongkir') || text.includes('pengiriman')) {
      return {
        id: 'faq-001',
        answer: 'Biaya pengiriman untuk Jabodetabek adalah Rp 15.000, sedangkan luar kota Rp 25.000.',
        confidence: 0.95
      };
    }
    if (text.includes('garansi')) {
      return {
        id: 'faq-002',
        answer: 'Semua produk kami dilindungi garansi resmi selama 1 tahun dari tanggal pembelian.',
        confidence: 0.92
      };
    }
    // Jika tidak ada keyword yang cocok, return null
    return null;
  }
}

// --- MESSAGE HANDLER (Inti Phase 2.5) ---

class MessageHandler {
  constructor(
    private faqEngine = new MockFAQEngine(),
    private promptBuilder = new MockPromptBuilder()
  ) {}

  async handle(userMessage: string) {
    console.log(`\n📨 Menerima pesan: "${userMessage}"`);

    // 1. Cek FAQ Lokal terlebih dahulu (Hemat Biaya & Latency 0)
    console.log('🔍 Mencari di FAQ Engine...');
    const faqResult = await this.faqEngine.search(userMessage);

    if (faqResult && faqResult.confidence > 0.8) {
      console.log('✅ Ditemukan di FAQ! (Tidak memanggil AI)');
      return {
        source: 'FAQ',
        reply: faqResult.answer,
        cost: 0
      };
    }

    console.log('⚠️ Tidak ditemukan di FAQ. Melakukan Fallback ke AI...');

    // 2. Jika tidak ada di FAQ, gunakan AI
    try {
      const prompt = this.promptBuilder.build(userMessage);
      const aiResponse = await adapters.ai.generate(prompt, { maxTokens: 500 });
      
      return {
        source: `AI (${aiResponse.provider})`,
        reply: aiResponse.content,
        cost: aiResponse.cost
      };
    } catch (error) {
      console.error('❌ AI Engine Gagal:', error);
      return {
        source: 'HUMAN_FALLBACK',
        reply: 'Mohon maaf, sistem kami sedang sibuk. Customer Service kami akan segera membantu Anda.',
        cost: 0
      };
    }
  }
}

// --- RUN TEST ---

async function runTests() {
  await initAdapters();
  const handler = new MessageHandler();

  console.log('\n========================================');
  console.log('   🧪 MESSAGE HANDLER ORCHESTRATION TEST');
  console.log('========================================\n');

  // Test 1: Pertanyaan yang ada di FAQ
  const res1 = await handler.handle('Berapa ongkir ke Surabaya?');
  console.log(`\n🤖 Bot (${res1.source}): ${res1.reply}`);
  console.log(`💰 Biaya: $${res1.cost}`);

  console.log('\n----------------------------------------');

  // Test 2: Pertanyaan random yang butuh kecerdasan AI
  const res2 = await handler.handle('Saya ingin membeli hadiah untuk pacar saya yang suka ngopi, ada saran?');
  console.log(`\n🤖 Bot (${res2.source}): ${res2.reply}`);
  console.log(`💰 Biaya: $${res2.cost.toFixed(6)}`);

  console.log('\n========================================');
}

runTests().catch(console.error);
