import { adapters } from '../adapters/container.js';
import { faqService } from './faq.service.js';
import { knowledgeService } from './knowledge.service.js';
import { productService } from './product.service.js';
import { prisma } from '../infrastructure/prisma.js';
import { Prisma } from '@prisma/client';
import { conversationContextService } from './conversation-context.service.js';
import { canonicalConversationStateService } from './canonical-context.service.js';

import {
  ResponseSource,
  ResponseOption,
  ConversationContext,
  ResponseResult,
  ConversationMessage,
  DiscussedItem,
  ConfirmedItem,
  PipelineContext,
} from '../domain/types.js';
import { isDeadEnd } from '../services/message-queue.service.js';
// TASK B1 — pure product-name match scoring (extracted to keep chat tests hermetic).
import { shouldAnswerSingleProduct } from '../services/chat/product-match.js';
// TASK B3 — pure total/payment intent classification (disambiguate "bayar <produk>"
// dari harga vs total/keranjang, dan metode bayar vs pertanyaan harga).
// TASK B4.1 — pure order-status intent classification (cegah "sampai mana <produk>"
// disalahartikan sebagai status order).
// TASK B4.3 — pure shipping intent classification (cegah "mau pesan <produk>"
// disalahartikan sebagai tanya ongkir).
// TASK B4.5 — pure inquiry detection untuk tryProductNotFound (match inquiry
// word di mana saja, bukan hanya di awal kalimat).
import { isTotalTrigger, isTotalIntent, isPaymentIntent, isOrderStatusIntent, ORDER_STATUS_KEYWORDS, isSopRetourIntent, SOP_RETUR_KEYWORDS, isShippingIntent, SHIPPING_KEYWORDS, isProductNotFoundInquiry } from '../services/chat/tier-match.js';

// In-memory cache for store profiles (TTL: 10 minutes)
const storeProfileCache = new Map<string, { profile: string; expiresAt: number }>();
const STORE_PROFILE_TTL_MS = 10 * 60 * 1000;

// TASK B4.4 — confidence gate untuk tryFAQ/tryKnowledge.
// [DUGAAN, threshold 0.5 belum divalidasi data nyata] — naik dari 0.3
// karena risiko false-positive teoretis (lihat laporan-taskB2.md: "tidak
// menemukan false-positive kritis yang pasti", tapi threshold 0.3 teoretis
// longgar untuk toko dengan FAQ/knowledge banyak).
const CONFIDENCE_THRESHOLD = 0.5;
const CONFIDENCE_MARGIN = 0.15;

function formatOperatingHours(operatingHours: any): string | null {
  if (!operatingHours || typeof operatingHours !== 'object') return null;

  // Format 1: text deskriptif (e.g. "Senin-minggu jam 09-10 malam")
  if (typeof operatingHours.text === 'string' && operatingHours.text.trim()) {
    return operatingHours.text.trim();
  }

  // Format 2: days object (e.g. { senin: {open:"09:00", close:"17:00"}, ... })
  const days = operatingHours.days || operatingHours;
  if (typeof days !== 'object' || Object.keys(days).length === 0) return null;

  const dayNames: Record<string, string> = {
    senin: 'Senin', selasa: 'Selasa', rabu: 'Rabu', kamis: 'Kamis',
    jumat: 'Jumat', sabtu: 'Sabtu', minggu: 'Minggu',
  };

  const lines: string[] = [];
  for (const [day, info] of Object.entries(days)) {
    if (typeof info !== 'object' || !info) continue;
    const d = info as any;
    if (d.open && d.close) {
      const label = dayNames[day.toLowerCase()] || day;
      lines.push(`${label} ${d.open}-${d.close}`);
    }
  }
  return lines.length > 0 ? lines.join(', ') : null;
}

export class FallbackService {
async getResponse(
  normalizedMsg: string,
  ctx: PipelineContext
): Promise<ResponseResult> {
  const context: ConversationContext = {
    storeId: ctx.storeId,
    customerId: ctx.customerId,
    conversationId: ctx.conversationId,
    messages: ctx.messages,
    lastMessageAt: ctx.messages.length > 0
      ? ctx.messages[ctx.messages.length - 1].createdAt
      : new Date(),
    status: 'active',
  };

  // Dead-end detection
  if (normalizedMsg && isDeadEnd(normalizedMsg)) {
    return this.createResult(context, {
      source: ResponseSource.DEAD_END,
      content: '',
      confidence: 0.99,
      cost: 0,
      metadata: { reason: 'dead_end_detected' },
    }, ResponseSource.DEAD_END);
  }

  const cachedResponse = await this.tryCache(context, normalizedMsg);
  if (cachedResponse && cachedResponse.confidence > 0.8) {
    return this.createResult(context, cachedResponse, ResponseSource.CACHE);
  }

  const faqResponse = await this.tryFAQ(context, normalizedMsg);
  if (faqResponse && faqResponse.confidence > 0.35) {
    return this.createResult(context, faqResponse, ResponseSource.FAQ);
  }

  // Order status tier — "sudah dikirim?", "status pesanan?"
  const orderStatusResponse = await this.tryOrderStatus(context, normalizedMsg);
  if (orderStatusResponse && orderStatusResponse.confidence > 0.5) {
    return this.createResult(context, orderStatusResponse, ResponseSource.ORDER_STATUS);
  }

  // Total tier — "totalnya berapa?", "jumlahnya?"
  const totalResponse = await this.tryTotal(context, normalizedMsg, ctx.customerCity);
  if (totalResponse && totalResponse.confidence > 0.5) {
    return this.createResult(context, totalResponse, ResponseSource.TOTAL);
  }

  // BUG-10/12 fix: shipping + payment check BEFORE product.
  // Product search has substring matching — "bayar" → "Bawang" misfire.
  // Monetary/logistics keywords must be intercepted before product lookup.
  const shippingResponse = await this.tryShipping(context, normalizedMsg, ctx.customerCity, false);
  if (shippingResponse && shippingResponse.confidence > 0.5) {
    return this.createResult(context, shippingResponse, ResponseSource.SHIPPING);
  }

  const paymentResponse = await this.tryPayment(context, normalizedMsg);
  if (paymentResponse && paymentResponse.confidence > 0.5) {
    return this.createResult(context, paymentResponse, ResponseSource.PAYMENT);
  }

  const catalogResponse = await this.tryCatalog(context, normalizedMsg);
  if (catalogResponse && catalogResponse.confidence > 0.5) {
    return this.createResult(context, catalogResponse, ResponseSource.CATALOG);
  }

  const productResponse = await this.tryProduct(context, normalizedMsg);
  if (productResponse && productResponse.confidence > 0.5) {
    await this.saveDiscussedItems(context.conversationId, productResponse);
    return this.createResult(context, productResponse, ResponseSource.PRODUCT);
  }

  // BAGIAN 1.6 - Product-not-found: deterministic, no LLM
  const notFoundResponse = await this.tryProductNotFound(context, normalizedMsg);
  if (notFoundResponse && notFoundResponse.confidence > 0.5) {
    return this.createResult(context, notFoundResponse, ResponseSource.CATALOG);
  }

  const sopResponse = await this.trySop(context, normalizedMsg);
  if (sopResponse && sopResponse.confidence > 0.5) {
    return this.createResult(context, sopResponse, ResponseSource.SOP);
  }

  const knowledgeResponse = await this.tryKnowledge(context, normalizedMsg);
  if (knowledgeResponse && knowledgeResponse.confidence > 0.35) {
    return this.createResult(context, knowledgeResponse, ResponseSource.KNOWLEDGE);
  }

  return this.createResult(context, {
    source: ResponseSource.HUMAN,
    content: 'Mohon maaf, saya tidak dapat memproses pertanyaan Anda saat ini. Silakan coba beberapa saat lagi, atau tim kami akan segera menghubungi Anda.',
    confidence: 1.0,
    cost: 0,
    metadata: { reason: 'All fallback chains exhausted' },
  }, ResponseSource.HUMAN);
}

  private async tryCache(context: ConversationContext, query: string): Promise<ResponseOption | null> {
    const cacheKey = `response:${context.storeId}:${query}`;
    const cached = await adapters.cache.get(cacheKey) as { content: string } | null;
    if (cached && cached.content) {
      return { source: ResponseSource.CACHE, content: cached.content, confidence: 0.95, cost: 0 };
    }
    return null;
  }

  private async tryFAQ(context: ConversationContext, query: string): Promise<ResponseOption | null> {
    try {
      const results = await faqService.search(context.storeId, query);
      // TASK B4.4 — [DUGAAN, threshold 0.5 belum divalidasi data nyata]
      // Naik dari 0.3; tambah margin: jika ≥2 hasil, #1 harus ≥0.15
      // lebih tinggi dari #2 agar tidak jawab asal pada kandidat serba lemah.
      if (results.length > 0 && results[0].confidence > CONFIDENCE_THRESHOLD &&
          (results.length === 1 || results[0].confidence - results[1].confidence >= CONFIDENCE_MARGIN)) {
        return {
          source: ResponseSource.FAQ,
          content: results[0].answer,
          confidence: results[0].confidence,
          cost: 0,
          metadata: { faqId: results[0].id, matchedQuestion: results[0].question },
        };
      }
      return null;
    } catch {
      adapters.logger.warn('FAQ search failed, skipping to next fallback tier');
      return null;
    }
  }

  private async tryKnowledge(context: ConversationContext, query: string): Promise<ResponseOption | null> {
    try {
      const results = await knowledgeService.search(context.storeId, query);
      // TASK B4.4 — [DUGAAN, threshold 0.5 belum divalidasi data nyata]
      // Naik dari 0.3; tambah margin: jika ≥2 hasil, #1 harus ≥0.15
      // lebih tinggi dari #2 agar tidak jawab asal pada kandidat serba lemah.
      if (results.length > 0 && results[0].confidence > CONFIDENCE_THRESHOLD &&
          (results.length === 1 || results[0].confidence - results[1].confidence >= CONFIDENCE_MARGIN)) {
        return {
          source: ResponseSource.KNOWLEDGE,
          content: results[0].content,
          confidence: results[0].confidence,
          cost: 0,
          metadata: { knowledgeId: results[0].id, matchedTitle: results[0].title },
        };
      }
      return null;
    } catch {
      adapters.logger.warn('Knowledge search failed, skipping to next fallback tier');
      return null;
    }
  }

  private async tryCatalog(context: ConversationContext, query: string): Promise<ResponseOption | null> {
    const lower = query.trim().toLowerCase();

    const catalogKeywords = [
      'jual apa', 'jualan apa', 'ada apa', 'ada apa aja', 'list produk',
      'produk apa', 'barang apa', 'katalog', 'lihat produk', 'semua produk',
      'produk tersedia', 'stok apa', 'bisa beli apa',
    ];
    const isCatalogIntent = catalogKeywords.some(kw => lower.includes(kw));
    if (!isCatalogIntent) return null;

    try {
      const products = await productService.listActiveProducts(context.storeId);
      if (products.length === 0) {
        // BAGIAN MISI 2.2 - Produk nol -> jawaban jujur tanpa LLM
        return {
          source: ResponseSource.CATALOG,
          content: 'Saat ini toko belum punya produk yang tersedia. Silakan hubungi pemilik toko untuk info lebih lanjut.',
          confidence: 0.9,
          cost: 0,
          metadata: { productCount: 0 },
        };
      }

      // Engine-authored structured catalog (HARD RULE #5/#16): `items` di-generate
      // dari productService.listActiveProducts (DB, bukan keyword/regex/AI).
      // classifyStructured memetakan CATALOG + array items -> product_list -> grid.
      const items = products.map((p) => ({
        id: p.id,
        name: p.name,
        price: p.price,
      }));

      return {
        source: ResponseSource.CATALOG,
        content: 'Produk yang tersedia di toko kami:',
        confidence: 0.85,
        cost: 0,
        metadata: { productCount: products.length, items },
      };
    } catch {
      adapters.logger.warn('Catalog listing failed, skipping to next fallback tier');
      return null;
    }
  }

  private async tryProduct(context: ConversationContext, query: string): Promise<ResponseOption | null> {
    try {
      const results = await productService.searchProducts(context.storeId, query);
      if (results.length === 0) return null;

      // Per TASK B1 (P1 semantic authority): tryProduct is a 0-LLM fast tier
      // and may ONLY answer when HIGH-CONFIDENCE the product was meant.
      const q = query.trim().toLowerCase();
      // Ranking score (ordering only — higher tiers keep precedence so the
      // disambiguation question still lists the strongest candidates first).
      const queryWords = q.split(/\s+/).filter(w => w.length > 1);
      const matchScore = (name: string) => {
        const lower = name.toLowerCase();
        if (lower === q) return 4;          // exact whole-token
        if (lower.startsWith(q)) return 3; // prefix (stronger than substring)
        if (lower.includes(q)) return 2;    // substring
        const wordHits = queryWords.filter(w => lower.includes(w)).length;
        return wordHits;                    // partial word overlap
      };

      const scored = results.map(r => ({ ...r, score: matchScore(r.name) }));
      scored.sort((a, b) => b.score - a.score);

      // Ambiguity detection: 2+ product dengan score yang sama = ambiguous.
      // (UNCHANGED behavior — disambiguation prompt is the intended fallback for
      // genuine multi-candidate ambiguity; only the SINGLE-match quality gate
      // below is tightened by TASK B1.)
      const topScore = scored[0].score;
      const similarCount = scored.filter(r => r.score === topScore).length;

      const formatPrice = (price: number) => {
        return 'Rp ' + price.toLocaleString('id-ID').replace(/,/g, '.');
      };

      if (similarCount >= 2) {
        const top = scored.filter(r => r.score === topScore).slice(0, 3);
        const lines = top.map(p => {
          let line = `• *${p.name}* — ${this.formatPrice(p.price)}`;
          if (p.stock !== null && p.stock > 0) line += ` (stok: ${p.stock})`;
          return line;
        });
        return {
          source: ResponseSource.PRODUCT,
          content: `Boleh dibantu dipastikan Kak, produk mana yang dimaksud?\n\n${lines.join('\n')}\n\nKakak mau pilih yang mana nih?`,
          confidence: 0.55,
          cost: 0,
          metadata: { productIds: top.map(p => p.id), matchedNames: top.map(p => p.name), matchedPrices: top.map(p => p.price) },
        };
      }

      // Single match — apply HIGH-CONFIDENCE gate (TASK B1).
      const p = scored[0];
      const qualifies = shouldAnswerSingleProduct(q, p.name, results.length);

      // (c) Otherwise (substring-only, weak word-hit, low confidence) -> MISS.
      // Returning null makes getResponse fall through to the next tier / LLM,
      // and crucially performs NO side effect (no saveDiscussedItems) — exactly
      // like any other miss.
      if (!qualifies) {
        adapters.logger.info('tryProduct miss (low confidence single match)', {
          storeId: context.storeId,
          conversationId: context.conversationId,
          query: q,
          candidate: p.name,
          score: topScore,
        });
        return null;
      }

      // (a)/(b) High-confidence single match -> answer directly.
      let response = `Halo Kak! Untuk *${p.name}* harganya *${this.formatPrice(p.price)}* per unit ya. 🌿`;
      if (p.stock !== null) {
        if (p.stock > 0) {
          response += ` (Stok ready ${p.stock} pcs)\n\nMau dimasukkan ke keranjang belanja Kakak?`;
        } else {
          response += `\n\nMaaf banget Kak, saat ini stoknya sedang kosong. 🙏 Boleh aku bantu cariin produk alternatif lainnya?`;
        }
      } else {
        response += `\n\nMau dimasukkan ke keranjang belanja Kakak?`;
      }

      return {
        source: ResponseSource.PRODUCT,
        content: response,
        confidence: 0.9,
        cost: 0,
        metadata: { productIds: [p.id], matchedNames: [p.name], matchedPrices: [p.price] },
      };
    } catch {
      adapters.logger.warn('Product search failed, skipping to next fallback tier');
      return null;
    }
  }

  private async tryProductNotFound(context: ConversationContext, query: string): Promise<ResponseOption | null> {
    const lower = query.trim().toLowerCase();
    const greetingWords = ['halo', 'hai', 'permisi', 'selamat', 'pagi', 'siang', 'sore', 'malam', 'hallo'];
    if (greetingWords.some(g => lower.includes(g))) return null;
    // TASK B4.5 — ganti regex ^() (hanya match di awal) dengan
    // isProductNotFoundInquiry (match inquiry word di mana saja).
    // Pertahankan semua logic setelahnya (askedWords, hasDbMatch).
    const { isInquiry, askedTerms } = isProductNotFoundInquiry(lower);
    if (!isInquiry) return null;
    const askedProduct = askedTerms.join(' ');
    if (!askedProduct || askedProduct.length < 2) return null;
    try {
      const products = await productService.listActiveProducts(context.storeId);
      const dbProductNameTokens = products.map(p => p.name.toLowerCase());
      const askedWords = askedProduct.split(/\s+/).filter(w => w.length > 1 && !['kg', 'gr', 'ml', 'biji', 'bungkus'].includes(w));
      const hasDbMatch = askedWords.some(w => dbProductNameTokens.some(dn => dn.includes(w)));
      if (hasDbMatch) return null;
      try {
        // G2-D.2: read confirmedItems from extractedEntities (V1 write path still
        // writes here; CartAuthority migration of V1 writes is G2-D.5).
        const ctxRow = await prisma.conversationContext.findUnique({
          where: { conversationId: context.conversationId },
          select: { extractedEntities: true },
        });
        const entities = conversationContextService.parseExtractedEntities(ctxRow?.extractedEntities);
        const cartTokens = entities.confirmedItems.map(c => (c.product || '').toLowerCase()).filter(Boolean);
        if (askedWords.some(w => cartTokens.some(ct => ct.includes(w)))) return null;
      } catch {}
      return {
        source: ResponseSource.CATALOG,
        content: 'Maaf Kak, produk itu belum tersedia di toko kami saat ini. Kakak bisa cek ya stok produk lain?',
        confidence: 0.95,
        cost: 0,
      };
    } catch {
      return null;
    }
  }

  private async tryPayment(context: ConversationContext, query: string): Promise<ResponseOption | null> {
    const lower = query.trim().toLowerCase();

    // TASK B3 (P1 lanjutan): tryPayment boleh jawab HANYA bila pertanyaan
    // secara EKSPLISIT soal cara/metode bayar. Kata "bayar" saja (atau
    // "berapa bayar <produk>") TANPA kata metode eksplisit (transfer/qris/
    // cod/...) berarti tanya HARGA — harus MISS ke tryProduct, bukan balas
    // daftar metode pembayaran. Lihat tier-match.ts.
    try {
      const catalogNames = (await productService.listActiveProducts(context.storeId)).map((p) =>
        p.name.toLowerCase()
      );
      if (!isPaymentIntent(lower, catalogNames)) return null;

      const store = await prisma.store.findUnique({
        where: { id: context.storeId },
        select: {
          acceptsTransfer: true,
          acceptsQris: true,
          acceptsCod: true,
          qrisImageUrl: true,
        },
      });
      if (!store) return null;

      // None configured → let AI/Human handle it
      if (!store.acceptsTransfer && !store.acceptsQris && !store.acceptsCod) {
        return null;
      }

      // Fetch active bank accounts (auto-decrypted by Prisma middleware)
      const bankAccounts = await prisma.bankAccount.findMany({
        where: { storeId: context.storeId, isActive: true, deletedAt: null },
        select: { bankName: true, accountNumber: true, accountName: true },
      });

      const lines: string[] = [];
      lines.push('Berikut metode pembayaran yang tersedia:');
      lines.push('');

      if (store.acceptsTransfer && bankAccounts.length > 0) {
        lines.push('💰 Transfer Bank:');
        for (const b of bankAccounts) {
          lines.push(`  • ${b.bankName}: ${b.accountNumber} a.n. ${b.accountName}`);
        }
        lines.push('');
      }

      if (store.acceptsQris) {
        lines.push('📱 QRIS tersedia — silakan scan kode QR berikut.');
        if (!store.qrisImageUrl) {
          lines.push('  (QRIS aktif namun gambar QR belum di-upload)');
        }
        lines.push('');
      }

      if (store.acceptsCod) {
        lines.push('🚚 COD (Cash on Delivery) tersedia untuk order dengan kurir.');
        lines.push('');
      }

      return {
        source: ResponseSource.PAYMENT,
        content: lines.join('\n').trim(),
        confidence: 0.7,
        cost: 0,
        ...(store.acceptsQris && store.qrisImageUrl ? { metadata: { qrisImageUrl: store.qrisImageUrl } } : {}),
      };
    } catch {
      adapters.logger.warn('Payment info lookup failed, skipping to next fallback tier');
      return null;
    }
  }

  private async tryShipping(context: ConversationContext, query: string, customerCity: string | null = null, askIdentity: boolean = true): Promise<ResponseOption | null> {
    const lower = query.trim().toLowerCase();

    // TASK B4.3 — keyword gate cepat pakai SHIPPING_KEYWORDS (di tier-match.ts).
    // "cod" is payment-tier; "bisa cod" is shipping only if store uses COD
    // as delivery method (pickup). Let tryPayment handle the "cod" ambiguity.
    const matched = SHIPPING_KEYWORDS.some((kw) => lower.includes(kw));
    if (!matched) return null;

    try {
      // TASK B4.3 — refined gate: produk + kata order ('mau'/'pesan'/'order')
      // tanpa kata kirim/ongkir eksplisit → ini order, bukan tanya ongkir.
      const catalogNames = (await productService.listActiveProducts(context.storeId)).map((p) =>
        p.name.toLowerCase()
      );
      if (!isShippingIntent(lower, catalogNames)) return null;
      const store = await prisma.store.findUnique({
        where: { id: context.storeId },
        select: {
          shippingMode: true,
          shippingFlatInCity: true,
          shippingFlatOutCity: true,
          address: true,
        },
      });

      if (!store) return null;
      const formatRp = (n: number | null) => 'Rp ' + (n || 0).toLocaleString('id-ID').replace(/,/g, '.');

      if (store.shippingMode === 'pickup') {
        let response = 'Kami hanya melayani pengambilan langsung di toko';
        if (store.address) response += `: ${store.address}`;
        response += '. Tidak tersedia pengiriman ke alamat Anda.';
        return {
          source: ResponseSource.SHIPPING,
          content: response,
          confidence: 0.75,
          cost: 0,
        };
      }

      if (store.shippingMode === 'flat') {
        const inCity = store.shippingFlatInCity;
        const outCity = store.shippingFlatOutCity;

        // Misconfigured — both null, let it fall through
        if (inCity === null && outCity === null) return null;

        const lines: string[] = ['Berikut biaya pengiriman flat:'];

        if (inCity !== null && inCity > 0) {
          lines.push(`• Dalam kota: ${formatRp(inCity)}`);
        }
        if (outCity !== null && outCity > 0) {
          lines.push(`• Luar kota: ${formatRp(outCity)}`);
        }

        return {
          source: ResponseSource.SHIPPING,
          content: lines.join('\n'),
          confidence: 0.7,
          cost: 0,
        };
      }

      // Unknown mode — fall through
      return null;
    } catch {
      adapters.logger.warn('Shipping info lookup failed, skipping to next fallback tier');
      return null;
    }
  }

  private async tryOrderStatus(context: ConversationContext, query: string): Promise<ResponseOption | null> {
    const lower = query.trim().toLowerCase();

    // TASK B4.1 — gate keyword cepat pakai ORDER_STATUS_KEYWORDS (di tier-match.ts).
    // 'sampai mana' dkk. tidak boleh merespon pertanyaan stok/ketersediaan
    // produk (mis. "sampai mana kangkung tersedia?"). Logika penuh ada di
    // isOrderStatusIntent(lower, catalogNames).
    const matched = ORDER_STATUS_KEYWORDS.some((kw) => lower.includes(kw));
    if (!matched) return null;

    try {
      const catalogNames = (await productService.listActiveProducts(context.storeId)).map((p) =>
        p.name.toLowerCase()
      );
      if (!isOrderStatusIntent(lower, catalogNames)) return null;

      const lastOrder = await prisma.order.findFirst({
        where: {
          conversationId: context.conversationId,
          storeId: context.storeId,
          deletedAt: null,
        },
        orderBy: { createdAt: 'desc' },
        select: {
          orderStatus: true,
          totalPrice: true,
          currency: true,
          createdAt: true,
          notes: true,
        },
      });

      if (!lastOrder) {
        return {
          source: ResponseSource.ORDER_STATUS,
          content: 'Saat ini tidak ada pesanan aktif di chat ini. Apakah ada yang bisa saya bantu?',
          confidence: 0.85,
          cost: 0,
          metadata: { reason: 'no_active_order' },
        };
      }

      const statusLabels: Record<string, string> = {
        draft: 'Baru Dipilih',
        waiting_address: 'Tunggu Alamat',
        waiting_payment: 'Tunggu Bayar',
        paid: 'Sudah Bayar',
        packing: 'Dikemas',
        shipped: 'Terkirim',
        delivered: 'Selesai',
        cancelled: 'Dibatalkan',
        pending: 'Diproses',
        confirmed: 'Dikonfirmasi',
      };

      const label = statusLabels[lastOrder.orderStatus] || lastOrder.orderStatus;
      const formatRp = (n: number | null) => 'Rp ' + (n || 0).toLocaleString('id-ID').replace(/,/g, '.');
      const content = `Pesanan Kakak sedang berada di tahap: *${label}*.\n\n` +
        `Total: ${formatRp(lastOrder.totalPrice)} ${lastOrder.currency}\n` +
        `Dipesan: ${new Date(lastOrder.createdAt).toLocaleDateString('id-ID')}`;

      return {
        source: ResponseSource.ORDER_STATUS,
        content,
        confidence: 0.8,
        cost: 0,
        metadata: { orderStatus: lastOrder.orderStatus },
      };
    } catch {
      adapters.logger.warn('Order status lookup failed, skipping to next tier');
      return null;
    }
  }

  private async tryTotal(context: ConversationContext, query: string, customerCity: string | null = null): Promise<ResponseOption | null> {
    const lower = query.trim().toLowerCase();

    // TASK B3 (P1 lanjutan): tryTotal boleh jawab HANYA bila sinyal kuat
    // total/keranjang/order. Kata 'bayar berapa' disengaja DIHAPUS dari
    // trigger karena bisa tanya harga produk (contoh "berapa bayar kangkung"),
    // yang harus diteruskan ke tryProduct. Lihat tier-match.ts.
    if (!isTotalTrigger(lower)) return null;

    try {
      // Bedakan "total keranjang" vs "harga satuan produk" pakai daftar nama
      // produk toko (pola sama seperti tryProduct/tryProductNotFound yang
      // juga panggil productService.listActiveProducts).
      const catalogNames = (await productService.listActiveProducts(context.storeId)).map((p) =>
        p.name.toLowerCase()
      );
      if (!isTotalIntent(lower, catalogNames)) return null;

      // G2-D.2: read confirmedItems from extractedEntities (V1 write path still
      // writes here; CartAuthority migration of V1 writes is G2-D.5).
      const ctxRow = await prisma.conversationContext.findUnique({
        where: { conversationId: context.conversationId },
        select: { extractedEntities: true },
      });
      const entities = conversationContextService.parseExtractedEntities(ctxRow?.extractedEntities);
      const cartItems = entities.confirmedItems || [];

      let items: ConfirmedItem[] = [...cartItems];

      if (items.length === 0) {
        // Prefer 'draft' (harga DB, bentuk ConfirmedItem) sebagai sumber total
        // fallback. 'pending' (hasil createOrder) dan status lain hanya dipilih
        // bila memang tidak ada draft, agar tidak menampilkan harga/total order
        // yang tidak sedang dibangun di dialog ini. Lihat BUG I-3.
        let lastOrder = await prisma.order.findFirst({
          where: {
            conversationId: context.conversationId,
            storeId: context.storeId,
            deletedAt: null,
            orderStatus: 'draft',
          },
          orderBy: { createdAt: 'desc' },
          select: { items: true, totalPrice: true, currency: true, orderStatus: true },
        });

        if (!lastOrder) {
          lastOrder = await prisma.order.findFirst({
            where: {
              conversationId: context.conversationId,
              storeId: context.storeId,
              deletedAt: null,
              orderStatus: { in: ['pending', 'waiting_payment', 'paid', 'waiting_address', 'confirmed'] },
            },
            orderBy: { createdAt: 'desc' },
            select: { items: true, totalPrice: true, currency: true, orderStatus: true },
          });
        }

        if (lastOrder) {
          // Prisma Json field dikembalikan sebagai JS array (bukan string),
          // jadi JSON.parse gagal. Handle kedua bentuk agar draft/pending
          // items bisa diparsed dengan benar. Lihat BUG I-3 / P4.2.
          const rawItems: unknown = lastOrder.items;
          if (Array.isArray(rawItems)) {
            items = rawItems as unknown as ConfirmedItem[];
          } else if (typeof rawItems === 'string') {
            try { items = JSON.parse(rawItems) as ConfirmedItem[]; } catch { items = []; }
          } else {
            items = [];
          }
        }
      }

      // FIX B: skip item dengan qty <= 0 supaya "Brambang (0x)" tidak muncul
      // di receipt dan tidak menyumbang subtotal.
      items = items.filter((ci) => Number(ci.qty || 0) > 0);

      // Guard 1: empty cart → tawarkan masukkan item, jangan "Rp 0"
      if (items.length === 0) {
        const conv = await prisma.conversation.findUnique({
          where: { id: context.conversationId },
          select: { customerName: true },
        });
        const name = conv?.customerName ? `Kak ${conv.customerName}` : 'Kakak';
        return {
          source: ResponseSource.TOTAL,
          content: `${name}, keranjang belanja Kakak masih kosong nih. Mau cari produk dulu? Ketik nama produk atau cek katalog ya!`,
          confidence: 0.75,
          cost: 0,
          metadata: { reason: 'empty_cart' },
        };
      }

      const subtotal = items.reduce((sum, ci) => sum + ((ci.price || 0) * Number(ci.qty || 0)), 0);
      const shippingCost = customerCity ? 5000 : 0;
      const grandTotal = subtotal + shippingCost;

      const formatRp = (n: number | null) => 'Rp ' + (n || 0).toLocaleString('id-ID').replace(/,/g, '.');

      let content = `GRAND TOTAL: ${formatRp(grandTotal)}`;
      if (shippingCost > 0) {
        content += `\n\nRincian:\n- Subtotal: ${formatRp(subtotal)}\n- Ongkir: ${formatRp(shippingCost)}\n- Total: ${formatRp(grandTotal)}`;
      } else if (items.length > 0) {
        content += `\n\nRincian:\n${items.map(ci => `- ${ci.product} (${ci.qty || 0}x): ${formatRp((ci.price || 0) * Number(ci.qty || 0))}`).join('\n')}`;
        content += `\n- Subtotal: ${formatRp(subtotal)}`;
      }

      return {
        source: ResponseSource.TOTAL,
        content,
        confidence: 0.85,
        cost: 0,
        metadata: { grandTotal, subtotal, shippingCost, itemCount: items.length },
      };
    } catch {
      adapters.logger.warn('Total calculation failed, skipping to next tier', {
        conversationId: context.conversationId,
        error: (new Error()).message,
      });
      return null;
    }
  }

  private async trySop(context: ConversationContext, query: string): Promise<ResponseOption | null> {
    const lower = query.trim().toLowerCase();

    // Map keywords to SOP categories — first wins
    const categoryMap: Array<[readonly string[], string]> = [
      [['komplain', 'keluhan', 'kecewa'], 'komplain'],
      // TASK B4.2: 'ganti' termasuk keyword retur (lemah) — ditolak oleh
      // isSopRetourIntent bila bukan sinyal retur kuat atau pola "ganti X ke Y".
      [SOP_RETUR_KEYWORDS, 'retur'],
      [['garansi', 'warranty'], 'garansi'],
      [['stok habis', 'kosong', 'ready ga', 'ready kapan'], 'stok_habis'],
      [['cara order', 'cara pesan', 'gimana belinya'], 'order'],
      [['sudah dikirim', 'kapan dikirim', 'status pesanan', 'status order', 'sampai mana', 'udah sampai', 'pesanan saya'], 'order_status'],
    ];

    let category: string | null = null;
    for (const [keywords, cat] of categoryMap) {
      if (keywords.some(kw => lower.includes(kw))) {
        category = cat;
        break;
      }
    }
    if (!category) return null;

    try {
      // TASK B4.2 — gate khusus kategori 'retur': 'ganti' sendirian bukan
      // sinyal retur kuat. Butuh kata eksplisit ('rusak', 'refund', dsb.)
      // atau pola "ganti X ke Y" dengan dua nama produk katalog → false
      // (itu order-modification, bukan retur). Lihat tier-match.ts.
      if (category === 'retur') {
        const catalogNames = (await productService.listActiveProducts(context.storeId)).map((p) =>
          p.name.toLowerCase()
        );
        if (!isSopRetourIntent(lower, catalogNames)) return null;
      }

      const sop = await prisma.sop.findUnique({
        where: { storeId_category: { storeId: context.storeId, category } },
        select: { content: true },
      });

      if (!sop?.content) return null;

      return {
        source: ResponseSource.SOP,
        content: sop.content,
        confidence: 0.8,
        cost: 0,
        metadata: { category },
      };
    } catch {
      adapters.logger.warn('SOP lookup failed, skipping to next fallback tier');
      return null;
    }
  }
  private async validateDescriptionAgainstProducts(storeId: string, description: string): Promise<string[]> {
    const dbProductNames = await productService.listActiveProducts(storeId);
    const dbNames = dbProductNames.map(p => p.name.toLowerCase());
    const descLower = description.toLowerCase();
    // Ekstrak kata-kata yang disebutkan di description tapi tidak ada di DB
    const descWords = descLower.split(/[\s,.]+/).filter(w => w.length > 3);
    const nonDbMentions: string[] = [];
    for (const word of descWords) {
      if (!dbNames.some(dn => dn.includes(word) || word.includes(dn))) {
        // Cek apakah ini seperti nama makanan (bukan kata umum)
        if (['rendang', 'gulai', 'sambal', 'lado', 'masakan', 'minang', 'kacang'].includes(word)) {
          nonDbMentions.push(word);
        }
      }
    }
    return nonDbMentions;
  }

  private async getStoreProfile(storeId: string): Promise<string | null> {
    const cached = storeProfileCache.get(storeId);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.profile;
    }

    try {
      const store = await prisma.store.findUnique({
        where: { id: storeId },
        select: {
          name: true,
          description: true,
          businessCategory: true,
          address: true,
          phoneNumber: true,
          operatingHours: true,
        },
      });

      if (!store) return null;

      const lines: string[] = [];
      if (store.name) lines.push(`Nama: ${store.name}`);
      if (store.businessCategory) lines.push(`Kategori: ${store.businessCategory}`);
      // MISI 2.4 - Profil toko tidak boleh menyebut produk yang tidak ada di DB
      if (store.description) {
        const productMentions = await this.validateDescriptionAgainstProducts(storeId, store.description);
        if (productMentions.length > 0) {
          adapters.logger.warn('Store description mentions products not in DB catalog - excluded from AI prompt', {
            storeId,
            nonDbMentions: productMentions,
          });
        } else {
          lines.push(`Deskripsi: ${store.description}`);
        }
      }
      if (store.address) lines.push(`Alamat: ${store.address}`);
      if (store.phoneNumber) lines.push(`Telepon: ${store.phoneNumber}`);

      const jamOp = formatOperatingHours(store.operatingHours);
      if (jamOp) {
        lines.push(`Jam Operasional: ${jamOp}`);
      }

      const profile = lines.length > 0 ? lines.join('\n') : null;
      storeProfileCache.set(storeId, { profile: profile || '', expiresAt: Date.now() + STORE_PROFILE_TTL_MS });
      return profile;
    } catch (err) {
      adapters.logger.warn('Failed to fetch store profile for AI prompt', { storeId, error: (err as Error).message });
      return null;
    }
  }

  private async createResult(
    context: ConversationContext,
    option: ResponseOption,
    source: ResponseSource
  ): Promise<ResponseResult> {
    const message: ConversationMessage = {
      id: crypto.randomUUID(),
      conversationId: context.conversationId,
      sender: 'assistant',
      content: option.content,
      source: source,
      cost: option.cost,
      createdAt: new Date(),
    };
    if (option.metadata) {
      message.metadata = option.metadata;
    }
    return {
      conversationId: context.conversationId,
      message,
      source,
      confidence: option.confidence,
      cost: option.cost,
      requiresHumanReview: source === ResponseSource.HUMAN &&
        option.metadata?.reason?.includes('circuit') === true,
      metadata: option.metadata,
    };
  }

  /**
   * Append item yang dibahas ke discussedItems.
   * Dipanggil setelah tryProduct mengembalikan hasil (single match atau ambiguous).
   * Caps last 10 entries (drop oldest), gunakan atomicCas untuk race-safe.
   *
   * G2-D.6: Canonical (workspace_v2) is PRIMARY authority. Reads existing
   * discussedItems from canonical _compat for dedup. Writes to canonical via
   * writeV1DiscussedItems, then mirrors to extractedEntities for backward compat.
   */
  private async saveDiscussedItems(
    conversationId: string,
    option: ResponseOption
  ): Promise<void> {
    try {
      const meta = option.metadata;
      if (!meta?.productIds?.length) return;

      const productIds = meta.productIds as string[];
      const matchedNames = (meta.matchedNames as string[]) || [];
      const matchedPrices = (meta.matchedPrices as (number | null)[]) || [];

      const newItems: DiscussedItem[] = productIds.map((id, i) => ({
        product: matchedNames[i] ?? id,
        qty: null,
        price: matchedPrices[i] ?? null,
        unit: 'unit',
        mentionedAt: new Date().toISOString(),
      }));

      // G2-D.6: Read existing state from canonical (authority: workspace_v2)
      const current = await prisma.conversationContext.findUnique({
        where: { conversationId },
        select: { extractedEntities: true, sessionKey: true, sessionExpireAt: true },
      });
      const existingEntities = conversationContextService.parseExtractedEntities(current?.extractedEntities);
      const existingDiscussed = existingEntities.discussedItems || [];
      const existingLastAmbiguous = existingEntities.lastAmbiguousPrompt || null;

      // Fix BUG-7: Dedup new items against existing discussedItems by product name
      const existingProductNames = new Set(
        existingDiscussed.map(d => d.product.toLowerCase())
      );
      const dedupedNew = newItems.filter(
        n => !existingProductNames.has(n.product.toLowerCase())
      );

      // Fix BUG-1: new items di BELAKANG (bukan depan) supaya slice(-10) jangan drop item baru
      const mergedDiscussedItems: DiscussedItem[] = [
        ...existingDiscussed,
        ...dedupedNew,
      ].slice(-10);

      // Jika tryProduct mengembalikan hasil ambigu (2+ products), set lastAmbiguousPrompt
      // sehingga turn berikutnya bisa resolve (mis. "dua-duanya", "kangkung aja")
      const isAmbiguous = productIds.length > 1;
      const newLastAmbiguous = isAmbiguous
        ? existingLastAmbiguous || option.content
        : null;

      await prisma.conversationContext.upsert({
        where: { conversationId },
        update: {
          extractedEntities: {
            ...existingEntities,
            discussedItems: mergedDiscussedItems,
            lastAmbiguousPrompt: newLastAmbiguous,
          } as unknown as Prisma.InputJsonValue,
        },
        create: {
          conversationId,
          lastMessages: '[]',
          sessionKey: current?.sessionKey ?? crypto.randomUUID(),
          sessionExpireAt: current?.sessionExpireAt ?? new Date(Date.now() + 3_600_000),
          extractedEntities: {
            discussedItems: mergedDiscussedItems,
            confirmedItems: [],
            lastAmbiguousPrompt: isAmbiguous ? option.content : null,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      adapters.logger.debug('Discussed items appended to extractedEntities (backward compat mirror)', {
        conversationId,
        count: mergedDiscussedItems.length,
        products: matchedNames,
      });

      // G2-D.6: PRIMARY write to canonical (workspace_v2) via writeV1DiscussedItems
      try {
        await canonicalConversationStateService.writeV1DiscussedItems(
          conversationId,
          mergedDiscussedItems,
          newLastAmbiguous,
        );
      } catch (err) {
        adapters.logger.warn('saveDiscussedItems: failed to write to canonical', {
          conversationId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } catch (err) {
      adapters.logger.warn('Failed to save discussedItems', {
        conversationId,
        error: (err as Error).message,
      });
    }
  }
  // ── Helpers ──

  /**
   * Deteksi intent koreksi: message mengandng kata "bukan"/"salah"
   * dan menyebut nama produk di confirmedItems. Kembalikan nama produk yang disebut.
   */
  private detectCorrection(lower: string, confirmedItems: ConfirmedItem[]): string | null {
    const correctionIndicators = ['bukan', 'salah', 'eh', 'cuma', 'doang', 'hanya'];
    const hasCorrection = correctionIndicators.some(kw => lower.includes(kw));
    if (!hasCorrection) return null;

    // Cari nama produk dari confirmedItems yang disebut di message
    for (const item of confirmedItems) {
      if (lower.includes(item.product.toLowerCase())) {
        return item.product;
      }
    }
    return null;
  }

  /**
   * Deteksi negasi terhadap discussedItems: "bukan kangkung", "salah wortel".
   * Hanya return nama produk yang muncul setelah kata negasi dalam jendela 3 kata.
   */
  private detectNegation(lower: string, discussed: DiscussedItem[]): string[] {
    const negationWords = ['bukan', 'salah', 'cuma', 'doang', 'hanya'];
    if (!negationWords.some(w => lower.includes(w))) return [];

    const negated: string[] = [];
    for (const d of discussed) {
      const lowerName = d.product.toLowerCase();
      const idx = lower.indexOf(lowerName);
      if (idx === -1) continue;

      const before = lower.substring(0, idx).trimEnd();
      const wordsBefore = before.split(/\s+/).slice(-3);
      if (wordsBefore.some(w => negationWords.includes(w))) {
        negated.push(lowerName);
      }
    }
    return negated;
  }

  private capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  private formatPrice(price: number | null): string {
    if (!price) return 'Rp 0';
    return 'Rp ' + price.toLocaleString('id-ID').replace(/,/g, '.');
  }

  private get ORDER_STATUS_LABELS(): Record<string, string> {
    return {
      draft: 'Baru Dipilih', waiting_address: 'Tunggu Alamat', waiting_payment: 'Tunggu Bayar',
      paid: 'Sudah Bayar', packing: 'Dikemas', shipped: 'Terkirim', delivered: 'Selesai',
      cancelled: 'Dibatalkan', pending: 'Diproses', confirmed: 'Dikonfirmasi',
    };
  }

  async handleOrderChangeRequest(
    context: ConversationContext,
    customerMessage: string,
    orderStatus: string
  ): Promise<ResponseOption> {
    const lower = customerMessage.trim().toLowerCase();
    const isReturn = ['retur', 'kembalikan', 'refund', 'ganti'].some((kw) => lower.includes(kw));
    const category = isReturn ? 'retur' : 'batal';
    const label = this.ORDER_STATUS_LABELS[orderStatus] || orderStatus;

    // Append to order notes
    try {
      const notesAppend = `[permintaan ubah/batal via chat] ${customerMessage}`;
      const existingOrders = await prisma.order.findMany({
        where: { conversationId: context.conversationId, storeId: context.storeId, deletedAt: null },
        select: { id: true, notes: true },
      });
      for (const o of existingOrders) {
        const currentNotes = o.notes ? o.notes + '\n' : '';
        await prisma.order.update({
          where: { id: o.id },
          data: { notes: currentNotes + notesAppend },
        });
      }
    } catch (e) {
      adapters.logger.warn('Failed to append order notes', { error: (e as Error).message });
    }

    // Set conversation metadata
    try {
      await prisma.conversation.updateMany({
        where: { id: context.conversationId },
        data: {
          metadata: { orderChangeRequestedAt: new Date().toISOString() } as any,
        },
      });
    } catch (e) {
      adapters.logger.warn('Failed to set conversation metadata', { error: (e as Error).message });
    }

    const cost = 0;
    const reply = `Permintaan ${category} Kakak sudah dicatat ya!\n\nPesanan sedang berada di tahap *${label}*\n\nTim kami akan segera memproses permintaan ini. Terima kasih sudah menunggu. 🙏`;

    return {
      source: ResponseSource.SOP,
      content: reply,
      confidence: 0.85,
      cost,
      metadata: { orderStatus, category, label, reason: 'order_change_request' },
    };
  }
}

export const fallbackService = new FallbackService();
