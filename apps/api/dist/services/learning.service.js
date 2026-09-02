import { prisma } from '../infrastructure/prisma.js';
import { groqAdapter } from '../adapters/ai/groq.adapter.js';
import { aiProviderResolver } from './ai-provider-resolver.service.js';
import { adapters } from '../adapters/container.js';
/**
 * Analyze customer questions answered by AI in the last 24h.
 * Cluster similar questions and generate draft FAQ entries.
 * Returns the number of drafts created.
 */
export async function analyzeAndGenerateFaqDrafts(storeId) {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    // Step 1: Find assistant messages with source='ai' (AI-generated, not FAQ/cache)
    // in the last 24h, joined to conversation (deletedAt null, status != 'human_takeover')
    const aiResponses = await prisma.conversationHistory.findMany({
        where: {
            role: 'assistant',
            source: 'ai',
            createdAt: { gte: twentyFourHoursAgo },
            conversation: {
                storeId: storeId,
                deletedAt: null,
                status: { not: 'human_takeover' },
            },
        },
        include: { conversation: { select: { id: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
    });
    if (aiResponses.length === 0) {
        adapters.logger.info('[Learning Service] No AI-answered questions found', { storeId });
        return 0;
    }
    // Step 2: For each AI response, get the preceding customer (user) message
    // NOTE: conversation_history stores role as 'user' (not 'customer') for
    // customer messages. See conversation.service.ts line 360:
    //   role: message.sender === 'customer' ? 'user' : 'assistant'
    const customerQuestions = [];
    for (const resp of aiResponses) {
        const prevUserMsg = await prisma.conversationHistory.findFirst({
            where: {
                conversationId: resp.conversationId,
                role: 'user',
                createdAt: { lt: resp.createdAt },
            },
            orderBy: { createdAt: 'desc' },
            select: { content: true },
        });
        if (prevUserMsg) {
            customerQuestions.push(prevUserMsg.content);
        }
    }
    // Step 3: Need minimum 5 questions for clustering
    if (customerQuestions.length < 5) {
        adapters.logger.info('[Learning Service] Insufficient data (need >= 5 questions)', {
            storeId,
            count: customerQuestions.length,
        });
        return 0;
    }
    adapters.logger.info('[Learning Service] Analyzing questions', {
        storeId,
        questionCount: customerQuestions.length,
    });
    // Step 4: Send to Groq for clustering & drafting
    const drafts = await clusterAndDraftFaqs(customerQuestions);
    if (!drafts || drafts.length === 0) {
        adapters.logger.info('[Learning Service] No drafts generated', { storeId });
        return 0;
    }
    // Step 5: Persist drafts in a single transaction
    // isActive=false, category='ai_suggestion' — owner must approve manually
    await prisma.$transaction(drafts.map((draft) => prisma.fAQ.create({
        data: {
            storeId: storeId,
            question: draft.question,
            answer: draft.answer,
            isActive: false,
            category: 'ai_suggestion',
            priority: 1,
            keywords: [],
        },
    })));
    adapters.logger.info('[Learning Service] FAQ drafts created', {
        storeId,
        count: drafts.length,
    });
    return drafts.length;
}
/**
 * Cluster customer questions & generate FAQ drafts via Groq.
 * Returns array of { question, answer, frequency }.
 */
async function clusterAndDraftFaqs(questions) {
    const prompt = `Anda adalah AI clustering assistant untuk toko WhatsApp commerce Indonesia.
Analisis pertanyaan pelanggan berikut, kelompokkan yang serupa, dan untuk setiap kelompok
buat 1 draft FAQ (question + answer). Gaya bahasa ramah, singkat, dan natural.

Pertanyaan pelanggan:
${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Aturan:
- Kelompokkan pertanyaan yang bertanya hal yang sama atau mirip (boleh toleransi minor).
- frequency = jumlah pertanyaan dalam kelompok itu.
- question = pertanyaan representatif yang paling jelas dari kelompok.
- answer = jawaban singkat (1-2 kalimat) yang mencakup semua variasi pertanyaan.
- JANGAN gunakan placeholder seperti [link] atau [harga].
- Output HANYA JSON valid: [{"question":"...","answer":"...","frequency":3}]`;
    try {
        // Unit 5: 'batch_task' role — resolver-backed, falls back to the groqAdapter
        // singleton when no active AIProviderConfig row exists for 'batch_task'
        // (default OFF: no rows => groqAdapter, identical to prior behavior).
        const batchTaskProviders = await aiProviderResolver.getProvidersForRole('batch_task');
        const llm = batchTaskProviders.length > 0 ? batchTaskProviders[0] : groqAdapter;
        const result = await llm.generate(prompt, {
            temperature: 0.2,
            maxTokens: 500,
            jsonMode: true,
        });
        const parsed = JSON.parse(result.content);
        // Handle both direct array and { faq: [...] } wrapper formats
        let draftsArray;
        if (Array.isArray(parsed)) {
            draftsArray = parsed;
        }
        else if (parsed && Array.isArray(parsed.faq)) {
            draftsArray = parsed.faq;
        }
        else {
            adapters.logger.warn('[Learning Service] Groq returned unexpected format', { content: result.content.slice(0, 200) });
            return null;
        }
        const validDrafts = draftsArray.filter((d) => d && typeof d.question === 'string' && typeof d.answer === 'string' && typeof d.frequency === 'number');
        return validDrafts.length > 0 ? validDrafts : null;
    }
    catch (err) {
        adapters.logger.warn('[Learning Service] Groq clustering failed', {
            error: err.message,
        });
        return null;
    }
}
//# sourceMappingURL=learning.service.js.map