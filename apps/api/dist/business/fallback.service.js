import { adapters } from '../adapters/container.js';
import { getAiDefaults } from '../adapters/ai/ai-config.js';
import { groqAdapter } from '../adapters/ai/groq.adapter.js';
import { faqService } from './faq.service.js';
import { knowledgeService } from './knowledge.service.js';
import { productService } from './product.service.js';
import { prisma } from '../infrastructure/prisma.js';
import { ResponseSource, } from '../domain/types.js';
import { isDeadEnd } from '../services/message-queue.service.js';
const ROLLING_CONTEXT_SIZE = 10;
// In-memory cache for store profiles (TTL: 10 minutes)
const storeProfileCache = new Map();
const STORE_PROFILE_TTL_MS = 10 * 60 * 1000;
function formatOperatingHours(operatingHours) {
    if (!operatingHours || typeof operatingHours !== 'object')
        return null;
    // Format 1: text deskriptif (e.g. "Senin-minggu jam 09-10 malam")
    if (typeof operatingHours.text === 'string' && operatingHours.text.trim()) {
        return operatingHours.text.trim();
    }
    // Format 2: days object (e.g. { senin: {open:"09:00", close:"17:00"}, ... })
    const days = operatingHours.days || operatingHours;
    if (typeof days !== 'object' || Object.keys(days).length === 0)
        return null;
    const dayNames = {
        senin: 'Senin', selasa: 'Selasa', rabu: 'Rabu', kamis: 'Kamis',
        jumat: 'Jumat', sabtu: 'Sabtu', minggu: 'Minggu',
    };
    const lines = [];
    for (const [day, info] of Object.entries(days)) {
        if (typeof info !== 'object' || !info)
            continue;
        const d = info;
        if (d.open && d.close) {
            const label = dayNames[day.toLowerCase()] || day;
            lines.push(`${label} ${d.open}-${d.close}`);
        }
    }
    return lines.length > 0 ? lines.join(', ') : null;
}
export class FallbackService {
    async getResponse(context, customerMessage, askIdentity = true, customerCity = null) {
        // Dead-end detection: jika penutupan, langsung return tanpa LLM
        if (customerMessage && isDeadEnd(customerMessage)) {
            return this.createResult(context, {
                source: ResponseSource.DEAD_END,
                content: '',
                confidence: 0.99,
                cost: 0,
                metadata: { reason: 'dead_end_detected' },
            }, ResponseSource.DEAD_END);
        }
        const cachedResponse = await this.tryCache(context, customerMessage);
        if (cachedResponse && cachedResponse.confidence > 0.8) {
            return this.createResult(context, cachedResponse, ResponseSource.CACHE);
        }
        const faqResponse = await this.tryFAQ(context, customerMessage);
        if (faqResponse && faqResponse.confidence > 0.35) {
            return this.createResult(context, faqResponse, ResponseSource.FAQ);
        }
        // Order status tier — "sudah dikirim?", "status pesanan?"
        const orderStatusResponse = await this.tryOrderStatus(context, customerMessage);
        if (orderStatusResponse && orderStatusResponse.confidence > 0.5) {
            return this.createResult(context, orderStatusResponse, ResponseSource.ORDER_STATUS);
        }
        // Total tier — "totalnya berapa?", "jumlahnya?"
        const totalResponse = await this.tryTotal(context, customerMessage, customerCity);
        if (totalResponse && totalResponse.confidence > 0.5) {
            return this.createResult(context, totalResponse, ResponseSource.TOTAL);
        }
        // BUG-10/12 fix: shipping + payment check BEFORE product.
        // Product search has substring matching — "bayar" → "Bawang" misfire.
        // Monetary/logistics keywords must be intercepted before product lookup.
        const shippingResponse = await this.tryShipping(context, customerMessage, customerCity, askIdentity);
        if (shippingResponse && shippingResponse.confidence > 0.5) {
            return this.createResult(context, shippingResponse, ResponseSource.SHIPPING);
        }
        const paymentResponse = await this.tryPayment(context, customerMessage);
        if (paymentResponse && paymentResponse.confidence > 0.5) {
            return this.createResult(context, paymentResponse, ResponseSource.PAYMENT);
        }
        const catalogResponse = await this.tryCatalog(context, customerMessage);
        if (catalogResponse && catalogResponse.confidence > 0.5) {
            return this.createResult(context, catalogResponse, ResponseSource.CATALOG);
        }
        const productResponse = await this.tryProduct(context, customerMessage);
        if (productResponse && productResponse.confidence > 0.5) {
            await this.saveDiscussedItems(context.conversationId, productResponse);
            return this.createResult(context, productResponse, ResponseSource.PRODUCT);
        }
        // BAGIAN 1.6 - Product-not-found: deterministic, no LLM
        const notFoundResponse = await this.tryProductNotFound(context, customerMessage);
        if (notFoundResponse && notFoundResponse.confidence > 0.5) {
            return this.createResult(context, notFoundResponse, ResponseSource.CATALOG);
        }
        const sopResponse = await this.trySop(context, customerMessage);
        if (sopResponse && sopResponse.confidence > 0.5) {
            return this.createResult(context, sopResponse, ResponseSource.SOP);
        }
        const knowledgeResponse = await this.tryKnowledge(context, customerMessage);
        if (knowledgeResponse && knowledgeResponse.confidence > 0.35) {
            return this.createResult(context, knowledgeResponse, ResponseSource.KNOWLEDGE);
        }
        const aiResponse = await this.tryAI(context, customerMessage);
        if (aiResponse && aiResponse.confidence > 0.5) {
            return this.createResult(context, aiResponse, ResponseSource.AI);
        }
        return this.createResult(context, {
            source: ResponseSource.HUMAN,
            content: 'Mohon maaf, saya tidak dapat memproses pertanyaan Anda saat ini. Silakan coba beberapa saat lagi, atau tim kami akan segera menghubungi Anda.',
            confidence: 1.0,
            cost: 0,
            metadata: { reason: 'All fallback chains exhausted' },
        }, ResponseSource.HUMAN);
    }
    async tryCache(context, query) {
        const cacheKey = `response:${context.storeId}:${query}`;
        const cached = await adapters.cache.get(cacheKey);
        if (cached && cached.content) {
            return { source: ResponseSource.CACHE, content: cached.content, confidence: 0.95, cost: 0 };
        }
        return null;
    }
    async tryFAQ(context, query) {
        try {
            const results = await faqService.search(context.storeId, query);
            if (results.length > 0 && results[0].confidence > 0.3) {
                return {
                    source: ResponseSource.FAQ,
                    content: results[0].answer,
                    confidence: results[0].confidence,
                    cost: 0,
                    metadata: { faqId: results[0].id, matchedQuestion: results[0].question },
                };
            }
            return null;
        }
        catch {
            adapters.logger.warn('FAQ search failed, skipping to next fallback tier');
            return null;
        }
    }
    async tryKnowledge(context, query) {
        try {
            const results = await knowledgeService.search(context.storeId, query);
            if (results.length > 0 && results[0].confidence > 0.3) {
                return {
                    source: ResponseSource.KNOWLEDGE,
                    content: results[0].content,
                    confidence: results[0].confidence,
                    cost: 0,
                    metadata: { knowledgeId: results[0].id, matchedTitle: results[0].title },
                };
            }
            return null;
        }
        catch {
            adapters.logger.warn('Knowledge search failed, skipping to next fallback tier');
            return null;
        }
    }
    async tryCatalog(context, query) {
        const lower = query.trim().toLowerCase();
        const catalogKeywords = [
            'jual apa', 'jualan apa', 'ada apa', 'ada apa aja', 'list produk',
            'produk apa', 'barang apa', 'katalog', 'lihat produk', 'semua produk',
            'produk tersedia', 'stok apa', 'bisa beli apa',
        ];
        const isCatalogIntent = catalogKeywords.some(kw => lower.includes(kw));
        if (!isCatalogIntent)
            return null;
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
            const productList = products
                .map(p => `- ${p.name}${p.price ? ` (Rp ${p.price})` : ''}${p.stock !== null && p.stock > 0 ? ` (stok: ${p.stock})` : ''}`)
                .join('\n');
            const rawAnswer = `Produk yang tersedia di toko kami:\n${productList}`;
            try {
                const prompt = `Berikan daftar produk berikut dalam bahasa Indonesia yang ramah dan singkat untuk WhatsApp commerce. Gunakan emoji minimal:\n\n${productList}`;
                const paraphrased = await groqAdapter.generate(prompt, {
                    temperature: 0.3,
                    maxTokens: 300,
                    intent: 'paraphrase',
                    conversationId: context.conversationId,
                });
                return {
                    source: ResponseSource.CATALOG,
                    content: paraphrased.content || rawAnswer,
                    confidence: 0.85,
                    cost: paraphrased.cost || 0,
                    metadata: { productCount: products.length },
                };
            }
            catch {
                return {
                    source: ResponseSource.CATALOG,
                    content: rawAnswer,
                    confidence: 0.8,
                    cost: 0,
                    metadata: { productCount: products.length },
                };
            }
        }
        catch {
            adapters.logger.warn('Catalog listing failed, skipping to next fallback tier');
            return null;
        }
    }
    async tryProduct(context, query) {
        try {
            const results = await productService.searchProducts(context.storeId, query);
            if (results.length === 0)
                return null;
            // searchProducts already sorts: name.startsWith(query) first, then createdAt desc
            const best = results[0];
            const q = query.trim().toLowerCase();
            // Simple text similarity: berapa banyak kata query yang muncul di nama produk
            const queryWords = q.split(/\s+/).filter(w => w.length > 1);
            const matchScore = (name) => {
                const lower = name.toLowerCase();
                if (lower === q)
                    return 4;
                if (lower.startsWith(q))
                    return 3;
                if (lower.includes(q))
                    return 2;
                const wordHits = queryWords.filter(w => lower.includes(w)).length;
                return wordHits;
            };
            const scored = results.map(r => ({ ...r, score: matchScore(r.name) }));
            scored.sort((a, b) => b.score - a.score);
            // Ambiguity detection: 2+ product dengan score yang sama = ambiguous
            const topScore = scored[0].score;
            const similarCount = scored.filter(r => r.score === topScore).length;
            const formatPrice = (price) => {
                return 'Rp ' + price.toLocaleString('id-ID').replace(/,/g, '.');
            };
            if (similarCount >= 2) {
                const top = scored.filter(r => r.score === topScore).slice(0, 3);
                const lines = top.map(p => {
                    let line = `• *${p.name}* — ${this.formatPrice(p.price)}`;
                    if (p.stock !== null && p.stock > 0)
                        line += ` (stok: ${p.stock})`;
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
            // Single match
            const p = scored[0];
            let response = `Halo Kak! Untuk *${p.name}* harganya *${this.formatPrice(p.price)}* per unit ya. 🌿`;
            if (p.stock !== null) {
                if (p.stock > 0) {
                    response += ` (Stok ready ${p.stock} pcs)\n\nMau dimasukkan ke keranjang belanja Kakak?`;
                }
                else {
                    response += `\n\nMaaf banget Kak, saat ini stoknya sedang kosong. 🙏 Boleh aku bantu cariin produk alternatif lainnya?`;
                }
            }
            else {
                response += `\n\nMau dimasukkan ke keranjang belanja Kakak?`;
            }
            return {
                source: ResponseSource.PRODUCT,
                content: response,
                confidence: Math.min(0.9, 0.4 + (topScore * 0.15)),
                cost: 0,
                metadata: { productIds: [p.id], matchedNames: [p.name], matchedPrices: [p.price] },
            };
        }
        catch {
            adapters.logger.warn('Product search failed, skipping to next fallback tier');
            return null;
        }
    }
    async tryProductNotFound(context, query) {
        const lower = query.trim().toLowerCase();
        const greetingWords = ['halo', 'hai', 'permisi', 'selamat', 'pagi', 'siang', 'sore', 'malam', 'hallo'];
        if (greetingWords.some(g => lower.includes(g)))
            return null;
        const inquiryMatch = lower.match(/^(ada|boleh|jual|beli|stok|ready|kosong|tersedia|punya)\s+(.+?)(\?|$)/);
        if (!inquiryMatch)
            return null;
        const askedProduct = inquiryMatch[2].replace(/[.,!?]/g, '').trim();
        if (!askedProduct || askedProduct.length < 2)
            return null;
        try {
            const products = await productService.listActiveProducts(context.storeId);
            const dbProductNameTokens = products.map(p => p.name.toLowerCase());
            const askedWords = askedProduct.split(/\s+/).filter(w => w.length > 1 && !['kg', 'gr', 'ml', 'biji', 'bungkus'].includes(w));
            const hasDbMatch = askedWords.some(w => dbProductNameTokens.some(dn => dn.includes(w)));
            if (hasDbMatch)
                return null;
            try {
                const ctxRow = await prisma.conversationContext.findUnique({
                    where: { conversationId: context.conversationId },
                    select: { extractedEntities: true },
                });
                const entities = this.parseEntities(ctxRow?.extractedEntities);
                const cartTokens = entities.confirmedItems.map(c => (c.product || '').toLowerCase()).filter(Boolean);
                if (askedWords.some(w => cartTokens.some(ct => ct.includes(w))))
                    return null;
            }
            catch { }
            return {
                source: ResponseSource.CATALOG,
                content: 'Maaf Kak, produk itu belum tersedia di toko kami saat ini. Kakak bisa cek ya stok produk lain?',
                confidence: 0.95,
                cost: 0,
            };
        }
        catch {
            return null;
        }
    }
    async tryPayment(context, query) {
        const lower = query.trim().toLowerCase();
        // Quick keyword gate — if no payment keyword present, bail immediately
        const paymentKeywords = [
            'bayar', 'pembayaran', 'transfer', 'rekening', 'qris',
            'cod', 'cash on delivery', 'bisa cod', 'metode pembayaran',
            'via apa', 'cara bayar', 'mau bayar', 'pembayarannya',
            'pake apa', 'pakai apa', 'bisa bayar', 'pakai bank',
            'transfer ke', 'nomor rekening', 'norek', 'atm',
            'debit', 'kredit', 'virtual account', 'va', 'ovo', 'gopay', 'dana',
        ];
        const hasPaymentKeyword = paymentKeywords.some(kw => lower.includes(kw));
        if (!hasPaymentKeyword)
            return null;
        try {
            const store = await prisma.store.findUnique({
                where: { id: context.storeId },
                select: {
                    acceptsTransfer: true,
                    acceptsQris: true,
                    acceptsCod: true,
                    qrisImageUrl: true,
                },
            });
            if (!store)
                return null;
            // None configured → let AI/Human handle it
            if (!store.acceptsTransfer && !store.acceptsQris && !store.acceptsCod) {
                return null;
            }
            // Fetch active bank accounts (auto-decrypted by Prisma middleware)
            const bankAccounts = await prisma.bankAccount.findMany({
                where: { storeId: context.storeId, isActive: true, deletedAt: null },
                select: { bankName: true, accountNumber: true, accountName: true },
            });
            const lines = [];
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
        }
        catch {
            adapters.logger.warn('Payment info lookup failed, skipping to next fallback tier');
            return null;
        }
    }
    async tryShipping(context, query, customerCity = null, askIdentity = true) {
        const lower = query.trim().toLowerCase();
        // Keyword gate — only shipping-specific terms (not ambiguous "cod" alone).
        // "cod" is payment-tier; "bisa cod" is shipping only if store uses COD
        // as delivery method (pickup). Let tryPayment handle the "cod" ambiguity.
        const shippingKeywords = [
            'ongkir', 'kirim', 'pengiriman', 'ekspedisi', 'biaya kirim',
            'berapa ongkos', 'ambil sendiri', 'pickup', 'dikirim', 'ongkos kirim',
            'kurir', 'jne', 'j&t', 'sicepat', 'anteraja', 'gosend', 'grab',
            'bisa diantar', 'diantar', 'pengirimannya',
        ];
        const hasKeyword = shippingKeywords.some(kw => lower.includes(kw));
        if (!hasKeyword)
            return null;
        try {
            const store = await prisma.store.findUnique({
                where: { id: context.storeId },
                select: {
                    shippingMode: true,
                    shippingFlatInCity: true,
                    shippingFlatOutCity: true,
                    address: true,
                },
            });
            if (!store)
                return null;
            const formatRp = (n) => 'Rp ' + (n || 0).toLocaleString('id-ID').replace(/,/g, '.');
            if (store.shippingMode === 'pickup') {
                let response = 'Kami hanya melayani pengambilan langsung di toko';
                if (store.address)
                    response += `: ${store.address}`;
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
                if (inCity === null && outCity === null)
                    return null;
                const lines = ['Berikut biaya pengiriman flat:'];
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
        }
        catch {
            adapters.logger.warn('Shipping info lookup failed, skipping to next fallback tier');
            return null;
        }
    }
    async tryOrderStatus(context, query) {
        const lower = query.trim().toLowerCase();
        const statusKeywords = [
            'sudah dikirim', 'kapan dikirim', 'status pesanan', 'status order',
            'sampai mana', 'udah sampai', 'udah sampe', 'pesanan saya',
            'order saya', 'mana pesanan',
        ];
        const matched = statusKeywords.some((kw) => lower.includes(kw));
        if (!matched)
            return null;
        try {
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
            const statusLabels = {
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
            const formatRp = (n) => 'Rp ' + (n || 0).toLocaleString('id-ID').replace(/,/g, '.');
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
        }
        catch {
            adapters.logger.warn('Order status lookup failed, skipping to next tier');
            return null;
        }
    }
    async tryTotal(context, query, customerCity = null) {
        const lower = query.trim().toLowerCase();
        const totalKeywords = [
            'total', 'totalnya', 'total saya', 'berapa semua', 'semuanya berapa',
            'jumlahnya', 'grand total', 'gtotal', 'tagihannya', 'bayar berapa',
        ];
        const matched = totalKeywords.some((kw) => lower.includes(kw));
        if (!matched)
            return null;
        try {
            const ctxRow = await prisma.conversationContext.findUnique({
                where: { conversationId: context.conversationId },
                select: { extractedEntities: true },
            });
            const entities = this.parseEntities(ctxRow?.extractedEntities);
            const cartItems = entities.confirmedItems || [];
            let items = [...cartItems];
            if (items.length === 0) {
                const lastOrder = await prisma.order.findFirst({
                    where: {
                        conversationId: context.conversationId,
                        storeId: context.storeId,
                        deletedAt: null,
                        orderStatus: { in: ['pending', 'waiting_payment', 'paid', 'waiting_address', 'confirmed'] },
                    },
                    orderBy: { createdAt: 'desc' },
                    select: { items: true, totalPrice: true, currency: true, orderStatus: true },
                });
                if (lastOrder) {
                    try {
                        items = JSON.parse(lastOrder.items);
                    }
                    catch {
                        items = [];
                    }
                }
            }
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
            const formatRp = (n) => 'Rp ' + (n || 0).toLocaleString('id-ID').replace(/,/g, '.');
            let content = `GRAND TOTAL: ${formatRp(grandTotal)}`;
            if (shippingCost > 0) {
                content += `\n\nRincian:\n- Subtotal: ${formatRp(subtotal)}\n- Ongkir: ${formatRp(shippingCost)}\n- Total: ${formatRp(grandTotal)}`;
            }
            else if (items.length > 0) {
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
        }
        catch {
            adapters.logger.warn('Total calculation failed, skipping to next tier', {
                conversationId: context.conversationId,
                error: (new Error()).message,
            });
            return null;
        }
    }
    async trySop(context, query) {
        const lower = query.trim().toLowerCase();
        // Map keywords to SOP categories — first wins
        const categoryMap = [
            [['komplain', 'keluhan', 'kecewa'], 'komplain'],
            [['retur', 'kembalikan barang', 'tukar barang', 'barang rusak', 'rusak', 'pengembalian', 'refund'], 'retur'],
            [['garansi', 'warranty'], 'garansi'],
            [['stok habis', 'kosong', 'ready ga', 'ready kapan'], 'stok_habis'],
            [['cara order', 'cara pesan', 'gimana belinya'], 'order'],
            [['sudah dikirim', 'kapan dikirim', 'status pesanan', 'status order', 'sampai mana', 'udah sampai', 'pesanan saya'], 'order_status'],
        ];
        let category = null;
        for (const [keywords, cat] of categoryMap) {
            if (keywords.some(kw => lower.includes(kw))) {
                category = cat;
                break;
            }
        }
        if (!category)
            return null;
        try {
            const sop = await prisma.sop.findUnique({
                where: { storeId_category: { storeId: context.storeId, category } },
                select: { content: true },
            });
            if (!sop?.content)
                return null;
            return {
                source: ResponseSource.SOP,
                content: sop.content,
                confidence: 0.8,
                cost: 0,
                metadata: { category },
            };
        }
        catch {
            adapters.logger.warn('SOP lookup failed, skipping to next fallback tier');
            return null;
        }
    }
    async tryAI(context, query) {
        try {
            // Load custom system prompt from store settings (store-level), fallback to default
            let systemPrompt = 'You are a helpful WhatsApp commerce assistant for Indonesian MSMEs. Answer concisely and professionally.';
            try {
                const setting = await prisma.storeSetting.findUnique({
                    where: { storeId_key: { storeId: context.storeId, key: 'ai_system_prompt' } },
                });
                if (setting?.value) {
                    systemPrompt = setting.value;
                }
            }
            catch {
                // Fallback to default on error
            }
            // MISI 1 — Anti-hallination: inject produk DB ke system prompt, dan block hallucinasi
            const activeProducts = await productService.listActiveProducts(context.storeId);
            if (activeProducts.length === 0) {
                return {
                    source: ResponseSource.AI,
                    content: 'Saat ini kami belum mengisi katalog produk. Silakan tanya langsung ke pemilik toko ya, Kak.',
                    confidence: 0.95,
                    cost: 0,
                };
            }
            const productCatalog = activeProducts
                .map(p => `- ${p.name}: Rp ${p.price?.toLocaleString('id-ID')?.replace(/,/g, '.') || '0'} (stok: ${p.stock ?? 0})`)
                .join('\n');
            systemPrompt += `\n\n[PRODUK YANG TERSEDIA — HANYA SEBUTKAN DARI LIST INI]\n${productCatalog}\n\nATURAN KERAS: Jangan pernah menyebut produk di luar list di atas. Jika pelanggan tanya produk yang tidak ada, jawab: 'Maaf Kak, produk itu belum tersedia di toko kami saat ini.'`;
            // Inject store profile (cached, TTL 10 min)
            const storeProfile = await this.getStoreProfile(context.storeId);
            if (storeProfile) {
                systemPrompt = `${systemPrompt}\n\n[Info Toko]\n${storeProfile}`;
            }
            // Inject current active cart context if available
            try {
                const ctxRow = await prisma.conversationContext.findUnique({
                    where: { conversationId: context.conversationId },
                    select: { extractedEntities: true },
                });
                const entities = this.parseEntities(ctxRow?.extractedEntities);
                if (entities.confirmedItems && entities.confirmedItems.length > 0) {
                    const cartList = entities.confirmedItems
                        .map((i) => {
                        const qty = typeof i.qty === 'number' ? i.qty : 1;
                        const price = typeof i.price === 'number' ? i.price : 0;
                        return `- ${i.product} (${qty}x, Rp ${price * qty})`;
                    })
                        .join('\n');
                    systemPrompt += `\n\n[Status Keranjang Belanja Pelanggan Saat Ini]\n${cartList}`;
                    if (entities.shippingAddress) {
                        systemPrompt += `\nAlamat Pengiriman: ${entities.shippingAddress}`;
                    }
                }
            }
            catch {
                // ignore context read error
            }
            // Inject platform style guide (config-backed, hot-reloadable)
            const aiDefaults = await getAiDefaults();
            if (aiDefaults.styleGuide) {
                systemPrompt += `\n\n${aiDefaults.styleGuide}`;
            }
            // Rolling context window: last 5-10 messages
            const recent = context.messages.slice(-ROLLING_CONTEXT_SIZE);
            const historyLines = recent
                .map((m) => `${m.sender === 'customer' ? 'User' : 'Assistant'}: ${m.content}`)
                .join('\n');
            const history = historyLines ? `Riwayat percakapan:\n${historyLines}\n\n` : '';
            // Build single prompt — llm.chat sends to Gemini (Primary Generative Speaker)
            const fullQuery = `[Instruksi Sistem]\n${systemPrompt}\n\n${history}[Pesan Pengguna]\n${query}`;
            const messages = [{ role: 'user', content: fullQuery }];
            const result = await adapters.llm.chat(messages, {
                temperature: aiDefaults.temperature,
                topP: aiDefaults.topP,
                maxTokens: aiDefaults.maxTokensGemini,
                intent: 'tryAI',
                conversationId: context.conversationId,
            });
            // Cache the LLM response for future similar queries (TTL: 1 hour)
            const cacheKey = `response:${context.storeId}:${query}`;
            adapters.cache.set(cacheKey, { content: result.content }, 3600).catch(() => { });
            return {
                source: ResponseSource.AI,
                content: result.content,
                confidence: 0.6,
                cost: result.cost || 0,
            };
        }
        catch (err) {
            const isCircuitBreaker = err.message?.includes('Circuit breaker');
            adapters.logger.warn('AI fallback (tryAI) failed — entering degraded mode', {
                storeId: context.storeId,
                conversationId: context.conversationId,
                error: err.message,
                circuitBreaker: isCircuitBreaker,
            });
            return {
                source: ResponseSource.HUMAN,
                content: 'Mohon maaf, saya belum bisa menjawab pertanyaan itu saat ini. Untuk info produk, ongkir, pembayaran, dan status pesanan, saya tetap bisa membantu Kak. 😊',
                confidence: 0.55,
                cost: 0,
            };
        }
    }
    async validateDescriptionAgainstProducts(storeId, description) {
        const dbProductNames = await productService.listActiveProducts(storeId);
        const dbNames = dbProductNames.map(p => p.name.toLowerCase());
        const descLower = description.toLowerCase();
        // Ekstrak kata-kata yang disebutkan di description tapi tidak ada di DB
        const descWords = descLower.split(/[\s,.]+/).filter(w => w.length > 3);
        const nonDbMentions = [];
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
    async getStoreProfile(storeId) {
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
            if (!store)
                return null;
            const lines = [];
            if (store.name)
                lines.push(`Nama: ${store.name}`);
            if (store.businessCategory)
                lines.push(`Kategori: ${store.businessCategory}`);
            // MISI 2.4 - Profil toko tidak boleh menyebut produk yang tidak ada di DB
            if (store.description) {
                const productMentions = await this.validateDescriptionAgainstProducts(storeId, store.description);
                if (productMentions.length > 0) {
                    adapters.logger.warn('Store description mentions products not in DB catalog - excluded from AI prompt', {
                        storeId,
                        nonDbMentions: productMentions,
                    });
                }
                else {
                    lines.push(`Deskripsi: ${store.description}`);
                }
            }
            if (store.address)
                lines.push(`Alamat: ${store.address}`);
            if (store.phoneNumber)
                lines.push(`Telepon: ${store.phoneNumber}`);
            const jamOp = formatOperatingHours(store.operatingHours);
            if (jamOp) {
                lines.push(`Jam Operasional: ${jamOp}`);
            }
            const profile = lines.length > 0 ? lines.join('\n') : null;
            storeProfileCache.set(storeId, { profile: profile || '', expiresAt: Date.now() + STORE_PROFILE_TTL_MS });
            return profile;
        }
        catch (err) {
            adapters.logger.warn('Failed to fetch store profile for AI prompt', { storeId, error: err.message });
            return null;
        }
    }
    async createResult(context, option, source) {
        const message = {
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
     * Append item yang dibahas ke extractedEntities.discussedItems.
     * Dipanggil setelah tryProduct mengembalikan hasil (single match atau ambiguous).
     * Caps last 10 entries (drop oldest), gunakan upsert untuk race-safe.
     */
    async saveDiscussedItems(conversationId, option) {
        const meta = option.metadata;
        if (!meta?.productIds?.length)
            return;
        const productIds = meta.productIds;
        const matchedNames = meta.matchedNames || [];
        const matchedPrices = meta.matchedPrices || [];
        const newItems = productIds.map((id, i) => ({
            product: matchedNames[i] ?? id,
            qty: null,
            price: matchedPrices[i] ?? null,
            unit: 'unit',
            mentionedAt: new Date().toISOString(),
        }));
        try {
            const current = await prisma.conversationContext.findUnique({
                where: { conversationId },
                select: { extractedEntities: true, sessionKey: true, sessionExpireAt: true },
            });
            let existing = {
                discussedItems: [],
                confirmedItems: [],
                lastAmbiguousPrompt: null,
            };
            const raw = current?.extractedEntities;
            if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
                const parsed = raw;
                existing = {
                    discussedItems: Array.isArray(parsed.discussedItems) ? parsed.discussedItems : [],
                    confirmedItems: Array.isArray(parsed.confirmedItems) ? parsed.confirmedItems : [],
                    lastAmbiguousPrompt: typeof parsed.lastAmbiguousPrompt === 'string' ? parsed.lastAmbiguousPrompt : null,
                };
            }
            // Fix BUG-7: Dedup new items against existing discussedItems by product name
            const existingProductNames = new Set(existing.discussedItems.map(d => d.product.toLowerCase()));
            const dedupedNew = newItems.filter(n => !existingProductNames.has(n.product.toLowerCase()));
            // Fix BUG-1: new items di BELAKANG (bukan depan) supaya slice(-10) jangan drop item baru
            const mergedDiscussedItems = [
                ...existing.discussedItems,
                ...dedupedNew,
            ].slice(-10);
            // Jika tryProduct mengembalikan hasil ambigu (2+ products), set lastAmbiguousPrompt
            // sehingga turn berikutnya bisa resolve (mis. "dua-duanya", "kangkung aja")
            const isAmbiguous = productIds.length > 1;
            const newLastAmbiguous = isAmbiguous
                ? existing.lastAmbiguousPrompt || option.content
                : null;
            await prisma.conversationContext.upsert({
                where: { conversationId },
                update: {
                    extractedEntities: {
                        discussedItems: mergedDiscussedItems,
                        confirmedItems: existing.confirmedItems,
                        lastAmbiguousPrompt: newLastAmbiguous,
                    },
                },
                create: {
                    conversationId,
                    lastMessages: '[]',
                    sessionKey: current?.sessionKey ?? crypto.randomUUID(),
                    sessionExpireAt: current?.sessionExpireAt ?? new Date(Date.now() + 3600000),
                    extractedEntities: {
                        discussedItems: mergedDiscussedItems,
                        confirmedItems: [],
                        lastAmbiguousPrompt: isAmbiguous ? option.content : null,
                    },
                },
            });
            adapters.logger.debug('Discussed items appended to extractedEntities', {
                conversationId,
                count: mergedDiscussedItems.length,
                products: matchedNames,
            });
        }
        catch (err) {
            adapters.logger.warn('Failed to save discussedItems to extractedEntities', {
                conversationId,
                error: err.message,
            });
        }
    }
    /**
     * Deteksi sinyal pembelian.
     * Keyword heuristic dulu — hanya call LLM jika tidak match keyword sama sekali.
     */
    async detectBuySignal(message) {
        const lower = message.trim().toLowerCase();
        // 1. Keyword check — fast path
        const hasKeyword = FallbackService.BUY_KEYWORDS.some(kw => lower.includes(kw));
        if (hasKeyword)
            return true;
        // 2. LLM classification — hanya untuk kasus ambigu
        try {
            const result = await adapters.llm.chat([
                {
                    role: 'user',
                    content: `Kamu adalah asisten AI untuk aplikasi WhatsApp commerce Indonesia.
Tentukan apakah pesan berikut merupakan sinyal pembelian (intent to buy / order).
Contoh sinyal pembelian: "saya mau", "oke ambil", "checkout", "gas", "cod aja", "pesan ya", dll.
Pesan: "${message}"

Jawab HANYA "YES" jika ini sinyal pembelian, "NO" jika tidak.`,
                },
            ]);
            const verdict = result.content.trim().toUpperCase();
            return verdict === 'YES';
        }
        catch (err) {
            adapters.logger.warn('Buy signal LLM classification failed, treating as false', {
                error: err.message,
            });
            return false;
        }
    }
    /**
     * Cek apakah ada pending ambiguous prompt di extractedEntities.
     * Jika ada, caller harus selalu coba resolveBuySignal meski detectBuySignal false.
     */
    async hasPendingAmbiguity(conversationId) {
        const ctx = await prisma.conversationContext.findUnique({
            where: { conversationId },
            select: { extractedEntities: true },
        });
        const entities = this.parseEntities(ctx?.extractedEntities);
        return (entities.lastAmbiguousPrompt?.trim()?.length ?? 0) > 0;
    }
    /**
     * Resolve a buy signal against the conversation's extractedEntities.
     * Handles 4 cases (A: single→confirm, B: ambiguous→ask back, C: correction,
     * and the "resolve against lastAmbiguousPrompt" sub-branch).
     * Returns ResponseResult if resolved, null if caller should fall through to normal chain.
     */
    async resolveBuySignal(context, message) {
        // 1. Baca extractedEntities dari conversation_context
        const ctx = await prisma.conversationContext.findUnique({
            where: { conversationId: context.conversationId },
            select: { extractedEntities: true },
        });
        const entities = this.parseEntities(ctx?.extractedEntities);
        const discussed = entities.discussedItems;
        const confirmed = entities.confirmedItems;
        const lastAmbiguous = entities.lastAmbiguousPrompt;
        // Buy signal but tidak ada discussedItems dan confirmedItems — fall through to normal chain
        if (discussed.length === 0 && confirmed.length === 0)
            return null;
        // BUG-10/12 permanent fix: Payment/Shipping/SOP queries must NEVER be
        // intercepted by resolveBuySignal, even if there are pending items in cart.
        // These are tier-specific intents — the waterfall should handle them.
        const lowerTrimmed = message.trim().toLowerCase();
        const isPaymentQuery = /bayar|pembayaran|transfer|rekening|qris|cod|cash|metode|pakai apa|pake apa|via|debit|kredit|ovo|gopay|dana|atm|va|virtual account/.test(lowerTrimmed);
        const isShippingQuery = /ongkir|kirim|pengiriman|kurir|ekspedisi|jne|j&t|sicepat|anteraja|gosend|grab|diantar|pickup|pengiriman|biaya kirim/.test(lowerTrimmed);
        const isSopQuery = /sop|retur|komplain|garansi|rusak|stok habis|kosong|barang rusak|pengembalian|refund|prosedur|kebijakan/.test(lowerTrimmed);
        const isDoneOrdering = /udah segitu|udha segitu|checkout|total berapa|minta total|proses pesanan|kirim pesanan|lunas|lanjut bayar/.test(lowerTrimmed);
        if (isPaymentQuery || isShippingQuery || isSopQuery || isDoneOrdering)
            return null;
        // BUG-4: Semua item sudah dikonfirmasi, belum ada yang dibahas lagi
        if (discussed.length === 0 && confirmed.length > 0) {
            const itemList = confirmed
                .map(i => `• ${i.product} — ${this.formatPrice(i.price ?? 0)}`)
                .join('\n');
            return this.createResult(context, {
                source: ResponseSource.PRODUCT,
                content: `Siap Kak! Ini rincian keranjang belanja Kakak saat ini:\n\n${itemList}\n\nAda tambahan item lagi Kak, atau mau lanjut infokan *Nama Lengkap & Alamat Pengiriman* untuk dihitung ongkirnya?`,
                confidence: 0.9,
                cost: 0,
            }, ResponseSource.PRODUCT);
        }
        const lower = message.trim().toLowerCase();
        // ── Case E: Correction — "eh bunot, cuma wortel doang"
        const correctionMatch = this.detectCorrection(lower, confirmed);
        if (correctionMatch) {
            const updatedConfirmed = confirmed.filter(c => c.product.toLowerCase() !== correctionMatch.toLowerCase());
            const remaining = updatedConfirmed;
            const removed = confirmed.find(c => c.product.toLowerCase() === correctionMatch.toLowerCase());
            const reply = removed
                ? `Siap Kak, ${removed.product} sudah dihapus dari keranjang.\n` +
                    (remaining.length
                        ? `Sisa item di keranjang: ${remaining.map(i => `${i.product} (${this.formatPrice(i.price ?? 0)})`).join(', ')}`
                        : 'Saat ini keranjang belanja Kakak masih kosong.')
                : ' tidak ditemukan di keranjang Anda.';
            const updated = { ...entities, confirmedItems: remaining, lastAmbiguousPrompt: null };
            await this.upsertExtractedEntities(context.conversationId, updated);
            return this.createResult(context, {
                source: ResponseSource.PRODUCT,
                content: reply,
                confidence: 0.8,
                cost: 0,
            }, ResponseSource.PRODUCT);
        }
        // ── Sub-branch: resolve against lastAmbiguousPrompt
        if (lastAmbiguous && lastAmbiguous.trim()) {
            // "dua-duanya" → confirm ALL discussedItems
            if (lower.includes('dua-duanya') || lower.includes('kedua') || lower.includes('semua')) {
                const now = new Date().toISOString();
                const newlyConfirmed = discussed.map(d => ({ ...d, confirmedAt: now }));
                const merged = [...confirmed, ...newlyConfirmed];
                const updated = { ...entities, confirmedItems: merged, discussedItems: [], lastAmbiguousPrompt: null };
                await this.upsertExtractedEntities(context.conversationId, updated);
                const itemList = newlyConfirmed.map(i => `• ${i.product} — ${this.formatPrice(i.price ?? 0)}`).join('\n');
                return this.createResult(context, {
                    source: ResponseSource.PRODUCT,
                    content: `Sip Kak! Keranjang belanja Kakak sudah diupdate:\n\n${itemList}\n\nAda yang mau ditambah lagi Kak, atau mau langsung checkout?`,
                    confidence: 0.8,
                    cost: 0,
                    metadata: { confirmedProducts: newlyConfirmed.map(i => i.product) },
                }, ResponseSource.PRODUCT);
            }
            // "kangkung aja" / "kangkung sama bawang aja" → confirm ALL matching discussed items
            const matchedItems = discussed.filter(d => lower.includes(d.product.toLowerCase()));
            if (matchedItems.length > 0) {
                const now = new Date().toISOString();
                const newConfirmed = matchedItems.map(d => ({ ...d, confirmedAt: now }));
                const matchedNames = new Set(matchedItems.map(m => m.product));
                const remainingDiscussed = discussed.filter(d => !matchedNames.has(d.product));
                const updated = {
                    ...entities,
                    confirmedItems: [...confirmed, ...newConfirmed],
                    discussedItems: remainingDiscussed,
                    lastAmbiguousPrompt: null,
                };
                await this.upsertExtractedEntities(context.conversationId, updated);
                const itemList = newConfirmed
                    .map(i => `• ${i.product} — ${this.formatPrice(i.price ?? 0)}`)
                    .join('\n');
                return this.createResult(context, {
                    source: ResponseSource.PRODUCT,
                    content: `Sip Kak!\n${itemList}\nsudah dimasukkan ke keranjang belanja Kakak. 🛒\n\nAda yang mau ditambah lagi Kak, atau mau lanjut checkout?`,
                    confidence: 0.8,
                    cost: 0,
                    metadata: { confirmedProducts: newConfirmed.map(i => i.product) },
                }, ResponseSource.PRODUCT);
            }
            // lastAmbiguousPrompt set but message tidak resolve — biarkan null (fall through)
        }
        // ── Negation: "bukan kangkung", "salah wortel" → hapus dari discussedItems, jangan konfirmasi
        const negated = this.detectNegation(lower, discussed);
        if (negated.length > 0) {
            const updatedDiscussed = discussed.filter(d => !negated.includes(d.product.toLowerCase()));
            const updated = { ...entities, discussedItems: updatedDiscussed, lastAmbiguousPrompt: null };
            await this.upsertExtractedEntities(context.conversationId, updated);
            const label = negated.map(n => this.capitalize(n)).join(', ');
            const reply = `Baik Kak, ${label} tidak dipilih.` +
                (updatedDiscussed.length
                    ? ` Sisa produk yang tersedia: ${updatedDiscussed.map(d => d.product).join(', ')}`
                    : ' Belum ada item yang dikonfirmasi.');
            return this.createResult(context, {
                source: ResponseSource.PRODUCT,
                content: reply,
                confidence: 0.8,
                cost: 0,
            }, ResponseSource.PRODUCT);
        }
        // ── Case A: 1 item → auto-confirm
        if (discussed.length === 1) {
            const item = discussed[0];
            const now = new Date().toISOString();
            const newConfirmed = { ...item, confirmedAt: now };
            const updated = {
                ...entities,
                discussedItems: [],
                confirmedItems: [...confirmed, newConfirmed],
                lastAmbiguousPrompt: null,
            };
            await this.upsertExtractedEntities(context.conversationId, updated);
            return this.createResult(context, {
                source: ResponseSource.PRODUCT,
                content: `Sip Kak! *${item.product}* (${this.formatPrice(item.price ?? 0)}) sudah dimasukkan ke keranjang belanja. 🛒\n\nAda yang mau ditambah lagi Kak, atau mau langsung checkout?`,
                confidence: 0.8,
                cost: 0,
                metadata: { confirmedProduct: item.product, confirmedPrice: item.price },
            }, ResponseSource.PRODUCT);
        }
        // ── Case B: 2+ items, ambiguous, tidak resolve → ask back concretely
        if (discussed.length >= 2) {
            const itemNames = discussed.map(d => d.product);
            let prompt;
            if (discussed.length === 2) {
                const [a, b] = itemNames;
                prompt = `${a}-nya sama ${b}-nya kak, dua-duanya? Atau salah satu aja?`;
            }
            else {
                const named = itemNames.map(n => `${n}-nya`).join(', ');
                prompt = `${named} — semua? Atau pilih salah satu aja?`;
            }
            const updated = { ...entities, lastAmbiguousPrompt: prompt };
            await this.upsertExtractedEntities(context.conversationId, updated);
            return this.createResult(context, {
                source: ResponseSource.PRODUCT,
                content: prompt,
                confidence: 0.7,
                cost: 0,
                metadata: { disambiguate: true, discussedItemNames: itemNames },
            }, ResponseSource.PRODUCT);
        }
        // Fallback: shouldn't reach here (discussed.length === 0 was checked at top)
        return null;
    }
    // ── Helpers ──
    parseEntities(raw) {
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            const parsed = raw;
            return {
                discussedItems: Array.isArray(parsed.discussedItems) ? parsed.discussedItems : [],
                confirmedItems: Array.isArray(parsed.confirmedItems) ? parsed.confirmedItems : [],
                lastAmbiguousPrompt: typeof parsed.lastAmbiguousPrompt === 'string' ? parsed.lastAmbiguousPrompt : null,
                recipientName: typeof parsed.recipientName === 'string' ? parsed.recipientName : null,
                shippingAddress: typeof parsed.shippingAddress === 'string' ? parsed.shippingAddress : null,
            };
        }
        return { discussedItems: [], confirmedItems: [], lastAmbiguousPrompt: null };
    }
    async upsertExtractedEntities(conversationId, entities) {
        try {
            const current = await prisma.conversationContext.findUnique({
                where: { conversationId },
                select: { sessionKey: true, sessionExpireAt: true },
            });
            await prisma.conversationContext.upsert({
                where: { conversationId },
                update: { extractedEntities: entities },
                create: {
                    conversationId,
                    lastMessages: '[]',
                    sessionKey: current?.sessionKey ?? crypto.randomUUID(),
                    sessionExpireAt: current?.sessionExpireAt ?? new Date(Date.now() + 3600000),
                    extractedEntities: entities,
                },
            });
            adapters.logger.debug('Extracted entities updated', { conversationId });
        }
        catch (err) {
            adapters.logger.warn('Failed to upsert extracted entities', {
                conversationId,
                error: err.message,
            });
        }
    }
    /**
     * Deteksi intent koreksi: message mengandng kata "bukan"/"salah"
     * dan menyebut nama produk di confirmedItems. Kembalikan nama produk yang disebut.
     */
    detectCorrection(lower, confirmedItems) {
        const correctionIndicators = ['bukan', 'salah', 'eh', 'cuma', 'doang', 'hanya'];
        const hasCorrection = correctionIndicators.some(kw => lower.includes(kw));
        if (!hasCorrection)
            return null;
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
    detectNegation(lower, discussed) {
        const negationWords = ['bukan', 'salah', 'cuma', 'doang', 'hanya'];
        if (!negationWords.some(w => lower.includes(w)))
            return [];
        const negated = [];
        for (const d of discussed) {
            const lowerName = d.product.toLowerCase();
            const idx = lower.indexOf(lowerName);
            if (idx === -1)
                continue;
            const before = lower.substring(0, idx).trimEnd();
            const wordsBefore = before.split(/\s+/).slice(-3);
            if (wordsBefore.some(w => negationWords.includes(w))) {
                negated.push(lowerName);
            }
        }
        return negated;
    }
    capitalize(s) {
        return s.charAt(0).toUpperCase() + s.slice(1);
    }
    formatPrice(price) {
        if (!price)
            return 'Rp 0';
        return 'Rp ' + price.toLocaleString('id-ID').replace(/,/g, '.');
    }
    get ORDER_STATUS_LABELS() {
        return {
            draft: 'Baru Dipilih', waiting_address: 'Tunggu Alamat', waiting_payment: 'Tunggu Bayar',
            paid: 'Sudah Bayar', packing: 'Dikemas', shipped: 'Terkirim', delivered: 'Selesai',
            cancelled: 'Dibatalkan', pending: 'Diproses', confirmed: 'Dikonfirmasi',
        };
    }
    async handleOrderChangeRequest(context, customerMessage, orderStatus) {
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
        }
        catch (e) {
            adapters.logger.warn('Failed to append order notes', { error: e.message });
        }
        // Set conversation metadata
        try {
            await prisma.conversation.updateMany({
                where: { id: context.conversationId },
                data: {
                    metadata: { orderChangeRequestedAt: new Date().toISOString() },
                },
            });
        }
        catch (e) {
            adapters.logger.warn('Failed to set conversation metadata', { error: e.message });
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
// ============================================================
// Stage 3 — Buy signal detection + purchase resolution
// ============================================================
// Colloquial Indonesian signals that indicate intent to purchase
FallbackService.BUY_KEYWORDS = [
    'saya mau', 'mau beli', 'ambil', 'pesan', 'order', 'checkout', 'gas',
    'gas lah', 'gas ya', 'cod aja', 'bisa cod', 'siap', 'oke', 'ya beli',
    'membeli', 'beli ini', 'beli', 'konfirmasi pesanan', 'konfirm',
    'dua-duanya', 'semua', 'kedua', 'ini saja', 'itu aja', 'pilih salah satu',
    'cuma', 'doang', 'hanya', 'bukan', 'salah', 'eh',
];
export const fallbackService = new FallbackService();
//# sourceMappingURL=fallback.service.js.map