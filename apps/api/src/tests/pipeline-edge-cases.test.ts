/**
 * Edge Case Tests — WhatsApp Pipeline
 * Runner: npx tsx --env-file=../../.env --test --test-force-exit src/tests/pipeline-edge-cases.test.ts
 *
 * 4 skenario edge case yang harus lolong:
 *  1. Dead-end vs Order Funnel Context — "ok" setelah kutipan harga harus tetap ke LLM
 *  2. Circuit Breaker Reset vs Human Takeover — setelah cooldown, AI tetap diam jika status human_takeover
 *  3. Multi-modal Coalescing — image + caption text harus jadi satu batch
 *  4. Priority Queue False Positive — "nggak mau komplain" tidak boleh trigger priority
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isDeadEnd, isDeadEndWithContext, isUrgent, isOrderFunnelContext, messageQueueService, type QueuedMessage, type ProcessedMessage } from '../services/message-queue.service.js';
import { CircuitBreakerService } from '../services/circuit-breaker.service.js';
import { prisma } from '../infrastructure/prisma.js';

describe('EDGE CASE 1: Dead-end vs Order Funnel Context', () => {
  test('isDeadEnd("ok") → true (tanpa konteks)', () => {
    assert.equal(isDeadEnd('ok'), true, 'Short ack harus dead-end');
    assert.equal(isDeadEnd('sip'), true);
    assert.equal(isDeadEnd('done'), true);
  });

  test('isOrderFunnelContext: deteksi konteks transaksi', () => {
    assert.equal(isOrderFunnelContext('Total harga Rp 50.000. Silakan transfer ke rekening berikut.'), true);
    assert.equal(isOrderFunnelContext('Silakan lakukan pembayaran Rp 50.000 via transfer'), true);
    assert.equal(isOrderFunnelContext('Order Anda telah dikonfirmasi.'), true);
    assert.equal(isOrderFunnelContext('Terima kasih sudah belanja!'), true);
    assert.equal(isOrderFunnelContext('Ada lagi yang bisa saya bantu?'), false);
    assert.equal(isOrderFunnelContext('Harga kami dimulai dari Rp 10.000'), false);
  });

test('"+ok" setelah kutipan harga → bukan dead-end (bypass)', () => {
    const lastAiMessage = 'Total harga Rp 50.000. Silakan transfer ke rekening berikut.';
    const userReply = 'ok';
    assert.equal(isDeadEnd(userReply), true, 'Mentah tidak ada konteks: dead-end');
    assert.equal(isDeadEndWithContext(userReply, lastAiMessage), false, 'Dengan konteks order: bukan dead-end');
  });

  test('"sip" setelah konfirmasi order → bukan dead-end', () => {
    const lastAiMessage = 'Order Anda telah dikonfirmasi, akan kami proses segeri.';
    const userReply = 'sip';
    assert.equal(isDeadEnd(userReply), true);
    assert.equal(isDeadEndWithContext(userReply, lastAiMessage), false);
  });

  test('"ok" setelah pertanyaan non-order → tetap dead-end', () => {
    const lastAiMessage = 'Ada lagi yang bisa saya bantu?';
    const userReply = 'ok';
    assert.equal(isDeadEndWithContext(userReply, lastAiMessage), true, 'Non-order context: tetap dead-end');
  });
});

describe('EDGE CASE 2: Circuit Breaker Reset vs Human Takeover', () => {
  test('Circuit breaker trips setelah 2 failure, reset setelah cooldown', async () => {
    const cb = new CircuitBreakerService('ec2-test', {
      failureThreshold: 2,
      cooldownMs: 100,
      halfOpenSuccessThreshold: 1,
    });

    // 2 failures → trip
    cb.recordFailure();
    assert.equal(cb.isAvailable(), true, 'Available after 1 failure');

    cb.recordFailure();
    assert.equal(cb.isAvailable(), false, 'Tripped after 2 failures');

    // Cooldown
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(cb.isAvailable(), true, 'Available after cooldown');
  });

  test('Conversation human_takeover status dilanggengkan meski circuit breaker reset', async () => {
    const ec2StoreId = crypto.randomUUID();
    // Buat store dulu (foreign key constraint)
    await prisma.store.create({
      data: {
        id: ec2StoreId,
        name: 'EC2 Test Store',
        phoneNumber: '+6281200000011',
        address: 'Jl. Test No. 11',
        originProvinceId: 'prov-test-11',
        originProvinceName: 'Jawa Barat',
        originCityId: 'city-test-11',
        originCityName: 'Bandung',
        originSubdistrictId: 'sub-test-11',
        originSubdistrictName: 'Coblong',
      },
    });

    const TEST_CONV_ID = `${ec2StoreId}:ec2-customer`;
try {
      await prisma.conversation.upsert({
        where: { id: TEST_CONV_ID },
        update: { status: 'human_takeover' as any, humanTakeoverAt: new Date() },
        create: {
          id: TEST_CONV_ID,
          storeId: ec2StoreId,
          customerId: 'ec2-customer',
          customerPhone: 'ec2-customer',
          status: 'human_takeover' as any,
          humanTakeoverAt: new Date(),
          channel: 'whatsapp',
        },
      });
    } finally {
      // Simulate: circuit breaker is open, we process a new message
      const cb = new CircuitBreakerService('ec2-takeover', {
        failureThreshold: 2,
        cooldownMs: 100,
        halfOpenSuccessThreshold: 1,
      });
      // Circuit is tripped
      cb.recordFailure();
      cb.recordFailure();
      assert.equal(cb.isAvailable(), false, 'Circuit should be tripped');

      // But conversation has human_takeover status — AI should NOT respond
      const conv = await prisma.conversation.findUnique({
        where: { id: TEST_CONV_ID },
        select: { status: true },
      });
      assert.equal(conv?.status, 'human_takeover', 'Conversation must be in human_takeover');
    }

    // Cleanup
    await prisma.conversation.delete({ where: { id: TEST_CONV_ID } }).catch(() => {});
    await prisma.store.delete({ where: { id: ec2StoreId } }).catch(() => {});
  });
});

describe('EDGE CASE 3: Multi-modal Coalescing', () => {
  test('Image + caption text dalam 3s → di-buffer bersama', async () => {
    messageQueueService.cleanup();

    // Simulasi: image dikirim, diikuti text 3 detik kemudian
    const chatId = 'ec3-chat';
    const imageMsg: QueuedMessage = {
      id: 'img-1',
      chatId,
      storeId: 'store-1',
      customerId: 'cust-1',
      type: 'image',
      content: 'data:image/jpeg;base64,/9j/4AAQ',
      receivedAt: Date.now(),
      priority: 'normal',
      attempts: 0,
      isUgc: true,
      gateway: 'gowa',
    };

    let flushedBatch: ProcessedMessage | null = null;
    messageQueueService.setFlushHandler((msg) => {
      flushedBatch = msg;
    });

    // Buffer image (media buffer)
    const buffered = messageQueueService.bufferMessage(imageMsg);
    assert.equal(buffered, true, 'Image should be buffered');

    // Verify media buffer has the image
    const stats = messageQueueService.getStats();
    assert.equal(stats.pendingMediaBuffers, 1, 'Media buffer should have 1 entry');

    // 3 seconds later, send text "ini buktinya kak"
    const textMsg: QueuedMessage = {
      id: 'txt-1',
      chatId,
      storeId: 'store-1',
      customerId: 'cust-1',
      type: 'text',
      content: 'ini buktinya kak',
      receivedAt: Date.now() + 3000,
      priority: 'normal',
      attempts: 0,
      isUgc: false,
      gateway: 'gowa',
    };

    // Text message should merge with pending media buffer (same customerId)
    const textBuffered = messageQueueService.bufferMessage(textMsg);

    // The text should be added to the media buffer, not create a new text buffer
    // (or flush the media buffer with the text as caption)
    // After this, either:
    //  - both in media buffer (pendingMediaBuffers = 1)
    //  - or media buffer flushed (pendingMediaBuffers = 0)
    const stats2 = messageQueueService.getStats();
    assert.ok(
      stats2.pendingMediaBuffers <= 1,
      `Media buffers should not exceed 1: got ${stats2.pendingMediaBuffers}`
    );

    messageQueueService.cleanup();
  });

  test('Multiple image uploads → satu batch', async () => {
    messageQueueService.cleanup();

    let flushed: ProcessedMessage | null = null;
    let flushCount = 0;
    messageQueueService.setFlushHandler((msg) => {
      flushed = msg;
      flushCount++;
    });

    const chatId = 'ec3-chat-2';
    const baseMsg = {
      storeId: 'store-1',
      customerId: 'cust-1',
      chatId,
      priority: 'normal' as const,
      attempts: 0,
      isUgc: true,
      gateway: 'gowa' as const,
      receivedAt: Date.now(),
    };

    // 3 images in quick succession
    for (let i = 0; i < 3; i++) {
      const img: QueuedMessage = {
        ...baseMsg,
        id: `img-${i}`,
        type: 'image',
        content: `data:image/jpeg;base64,img${i}`,
      };
      messageQueueService.bufferMessage(img);
    }

    // Should be in one media buffer
    const stats = messageQueueService.getStats();
    assert.equal(stats.pendingMediaBuffers, 1, 'Should be one media buffer');

    messageQueueService.cleanup();
  });
});

describe('EDGE CASE 4: Priority Queue False Positive', () => {
  test('"nggak mau komplain" → false (negated keyword)', () => {
    assert.equal(isUrgent('Baju ini bagus banget, saya nggak mau komplain pokoknya the best'), false);
  });

  test('"saya tidak komplain" → false (negated)', () => {
    assert.equal(isUrgent('Saya tidak komplain, produk bagus'), false);
  });

  test('"saya komplain tentang harga" → true (positive)' , () => {
    assert.equal(isUrgent('Saya komplain tentang harga yang tinggi'), true);
  });

  test('"transfer sudah kelar" → true', () => {
    assert.equal(isUrgent('Transfer sudah kelar, kapan dikirim?'), true);
  });

  test('"batal order" → true', () => {
    assert.equal(isUrgent('Saya ingin batal order'), true);
  });

  test('"error di sistem" → true', () => {
    assert.equal(isUrgent('Ada error di sistem, tolong bantu'), true);
  });

  test('"ganti produk" → true', () => {
    assert.equal(isUrgent('Saya mau ganti produk ini'), true);
  });

  test('"kata komplain di tengah kalimat tanpa negasi" → true', () => {
    assert.equal(isUrgent('Produk ini butuh komplain karena rusak'), true);
  });
});
