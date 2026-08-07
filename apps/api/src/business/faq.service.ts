import { Prisma } from '@prisma/client';
import { adapters } from '../adapters/container.js';
import { prisma } from '../infrastructure/prisma.js';

export interface FAQInput {
  storeId: string;
  question: string;
  answer: string;
  keywords?: string[];
  category?: string;
  priority?: number;
}

export interface FAQSearchResult {
  id: string;
  question: string;
  answer: string;
  category: string | null;
  priority: number;
  matchCount: number;
  confidence: number;
  createdAt: Date;
}

export class FAQService {
  async create(data: FAQInput) {
    adapters.logger.info('Creating FAQ', { storeId: data.storeId, question: data.question });

    const faq = await prisma.fAQ.create({
      data: {
        storeId: data.storeId,
        question: data.question,
        answer: data.answer,
        keywords: data.keywords || [],
        category: data.category || null,
        priority: data.priority ?? 1,
      },
    });

    return faq;
  }

  async update(id: string, data: Partial<FAQInput>) {
    adapters.logger.info('Updating FAQ', { id });

    const existing = await prisma.fAQ.findUnique({ where: { id } });
    if (!existing) {
      throw new Error(`FAQ not found: ${id}`);
    }

    const faq = await prisma.fAQ.update({
      where: { id },
      data: {
        ...(data.question !== undefined && { question: data.question }),
        ...(data.answer !== undefined && { answer: data.answer }),
        ...(data.keywords !== undefined && { keywords: data.keywords }),
        ...(data.category !== undefined && { category: data.category }),
        ...(data.priority !== undefined && { priority: data.priority }),
      },
    });

    return faq;
  }

  async delete(id: string) {
    adapters.logger.info('Soft-deleting FAQ', { id });

    const existing = await prisma.fAQ.findUnique({ where: { id } });
    if (!existing) {
      throw new Error(`FAQ not found: ${id}`);
    }

    await prisma.fAQ.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return { success: true, id };
  }

  async findAll(storeId: string, options?: {
    category?: string;
    search?: string;
    includeInactive?: boolean;
  }) {
    const where: Prisma.FAQWhereInput = { storeId };

    if (!options?.includeInactive) {
      where.deletedAt = null;
      where.isActive = true;
    }

    if (options?.category) {
      where.category = options.category;
    }

    if (options?.search) {
      where.OR = [
        { question: { contains: options.search, mode: Prisma.QueryMode.insensitive } },
        { answer: { contains: options.search, mode: Prisma.QueryMode.insensitive } },
        { keywords: { has: options.search } },
      ];
    }

    const faqs = await prisma.fAQ.findMany({
      where,
      orderBy: [{ priority: 'asc' }, { matchCount: 'desc' }],
    });

    return faqs;
  }

  async findById(id: string) {
    return prisma.fAQ.findUnique({ where: { id, deletedAt: null } });
  }

  async search(storeId: string, query: string): Promise<FAQSearchResult[]> {
    adapters.logger.info('Searching FAQs', { storeId, query });

    const activeFaqs = await prisma.fAQ.findMany({
      where: {
        storeId,
        isActive: true,
        deletedAt: null,
      },
    });

    if (activeFaqs.length === 0) {
      return [];
    }

    const normalizedQuery = query.toLowerCase().trim();
    const queryWords = normalizedQuery.split(/\s+/).filter(w => w.length > 2);
    const stopWords = new Set(['apa', 'bagaimana', 'dimana', 'kapan', 'siapa', 'mengapa', 'yang', 'dan', 'di', 'ke', 'dari', 'dengan', 'untuk', 'pada', 'adalah', 'bisa', 'saya', 'saya ingin', 'tolong', 'apakah']);

    const scored: FAQSearchResult[] = activeFaqs.map(faq => {
      let score = 0;

      // Exact question match (highest score)
      if (faq.question.toLowerCase() === normalizedQuery) {
        score += 1.0;
      }

      // Question contains query or vice versa
      if (faq.question.toLowerCase().includes(normalizedQuery)) {
        score += 0.8;
      }
      if (normalizedQuery.includes(faq.question.toLowerCase())) {
        score += 0.7;
      }

      // Keyword matching
      if (faq.keywords && faq.keywords.length > 0) {
        const keywordHits = faq.keywords.filter(kw => {
          const normalizedKw = kw.toLowerCase();
          return normalizedQuery.includes(normalizedKw) || queryWords.some(qw => normalizedKw.includes(qw) || qw.includes(normalizedKw));
        }).length;
        score += (keywordHits / faq.keywords.length) * 0.6;
      }

      // Word overlap with question
      const questionWords = faq.question.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
      const wordHits = questionWords.filter(qw => queryWords.includes(qw)).length;
      if (questionWords.length > 0) {
        score += (wordHits / questionWords.length) * 0.5;
      }

      // Word overlap with answer (lower weight)
      const answerWords = faq.answer.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
      const answerHits = answerWords.filter(aw => queryWords.includes(aw)).length;
      if (answerWords.length > 0) {
        score += (answerHits / answerWords.length) * 0.3;
      }

      // Priority bonus
      score += (1 / faq.priority) * 0.1;

      return {
        id: faq.id,
        question: faq.question,
        answer: faq.answer,
        category: faq.category,
        priority: faq.priority,
        matchCount: faq.matchCount,
        confidence: Math.min(score, 1.0),
        createdAt: faq.createdAt,
      };
    });

    const filtered = scored
      .filter(r => r.confidence > 0.15)
      .sort((a, b) => b.confidence - a.confidence);

    // Increment matchCount for top result
    if (filtered.length > 0) {
      try {
        await prisma.fAQ.update({
          where: { id: filtered[0].id },
          data: { matchCount: { increment: 1 } },
        }).catch(() => {});
      } catch {
        // Non-critical, ignore
      }
    }

    return filtered;
  }
}

export const faqService = new FAQService();
