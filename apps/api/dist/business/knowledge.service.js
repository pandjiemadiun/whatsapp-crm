import { Prisma } from '@prisma/client';
import { adapters } from '../adapters/container.js';
import { prisma } from '../infrastructure/prisma.js';
export class KnowledgeService {
    async create(data) {
        adapters.logger.info('Creating knowledge entry', { storeId: data.storeId, title: data.title });
        const entry = await prisma.knowledge.create({
            data: {
                storeId: data.storeId,
                title: data.title,
                content: data.content,
                category: data.category || null,
                tags: data.tags || [],
                source: data.source || null,
                relevanceScore: data.relevanceScore ?? 0,
            },
        });
        return entry;
    }
    async update(id, data) {
        adapters.logger.info('Updating knowledge entry', { id });
        const existing = await prisma.knowledge.findUnique({ where: { id } });
        if (!existing) {
            throw new Error(`Knowledge entry not found: ${id}`);
        }
        const entry = await prisma.knowledge.update({
            where: { id },
            data: {
                ...(data.title !== undefined && { title: data.title }),
                ...(data.content !== undefined && { content: data.content }),
                ...(data.category !== undefined && { category: data.category }),
                ...(data.tags !== undefined && { tags: data.tags }),
                ...(data.source !== undefined && { source: data.source }),
                ...(data.relevanceScore !== undefined && { relevanceScore: data.relevanceScore }),
            },
        });
        return entry;
    }
    async delete(id) {
        adapters.logger.info('Soft-deleting knowledge entry', { id });
        const existing = await prisma.knowledge.findUnique({ where: { id } });
        if (!existing) {
            throw new Error(`Knowledge entry not found: ${id}`);
        }
        await prisma.knowledge.update({
            where: { id },
            data: { deletedAt: new Date() },
        });
        return { success: true, id };
    }
    async findById(id) {
        return prisma.knowledge.findUnique({ where: { id, deletedAt: null } });
    }
    async list(storeId, options) {
        const where = { storeId };
        if (!options?.includeInactive) {
            where.deletedAt = null;
            where.isActive = true;
        }
        if (options?.category) {
            where.category = options.category;
        }
        if (options?.search) {
            where.OR = [
                { title: { contains: options.search, mode: Prisma.QueryMode.insensitive } },
                { content: { contains: options.search, mode: Prisma.QueryMode.insensitive } },
                { tags: { has: options.search } },
            ];
        }
        const entries = await prisma.knowledge.findMany({
            where,
            orderBy: [{ relevanceScore: 'desc' }, { createdAt: 'desc' }],
        });
        return entries;
    }
    async search(storeId, query) {
        adapters.logger.info('Searching knowledge base', { storeId, query });
        const normalizedQuery = query.toLowerCase().trim();
        const queryWords = normalizedQuery.split(/\s+/).filter(w => w.length > 2);
        const entries = await prisma.knowledge.findMany({
            where: {
                storeId,
                isActive: true,
                deletedAt: null,
                OR: [
                    { title: { contains: normalizedQuery, mode: Prisma.QueryMode.insensitive } },
                    { content: { contains: normalizedQuery, mode: Prisma.QueryMode.insensitive } },
                    ...queryWords.map(word => ({
                        OR: [
                            { title: { contains: word, mode: Prisma.QueryMode.insensitive } },
                            { content: { contains: word, mode: Prisma.QueryMode.insensitive } },
                        ],
                    })),
                ],
            },
        });
        if (entries.length === 0) {
            return [];
        }
        const stopWords = new Set(['apa', 'bagaimana', 'dimana', 'kapan', 'siapa', 'mengapa',
            'yang', 'dan', 'di', 'ke', 'dari', 'dengan', 'untuk', 'pada', 'adalah',
            'bisa', 'saya', 'tolong', 'apakah']);
        const scored = entries.map(entry => {
            let score = 0;
            const titleLower = entry.title.toLowerCase();
            const contentLower = entry.content.toLowerCase();
            // Exact title match
            if (titleLower === normalizedQuery)
                score += 0.95;
            else if (titleLower.includes(normalizedQuery))
                score += 0.7;
            // Word overlap in title (weighted higher)
            const titleWords = titleLower.split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
            const titleHits = titleWords.filter(tw => queryWords.includes(tw)).length;
            if (titleWords.length > 0) {
                score += (titleHits / titleWords.length) * 0.5;
            }
            // Word overlap in content
            const contentWords = contentLower.split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
            const contentHits = contentWords.filter(cw => queryWords.includes(cw)).length;
            if (contentWords.length > 0) {
                score += (contentHits / contentWords.length) * 0.25;
            }
            // Tag matching
            if (entry.tags.length > 0) {
                const tagHits = entry.tags.filter(tag => {
                    const tagLower = tag.toLowerCase();
                    return queryWords.some(qw => tagLower.includes(qw) || qw.includes(tagLower));
                }).length;
                score += (tagHits / entry.tags.length) * 0.4;
            }
            // relevanceScore bonus (scaled 0–0.2)
            score += Math.min(entry.relevanceScore / 100, 0.2);
            return {
                id: entry.id,
                title: entry.title,
                content: entry.content,
                category: entry.category,
                tags: entry.tags,
                confidence: Math.min(score, 1.0),
                createdAt: entry.createdAt,
            };
        });
        return scored
            .filter(r => r.confidence > 0.15)
            .sort((a, b) => b.confidence - a.confidence);
    }
}
export const knowledgeService = new KnowledgeService();
//# sourceMappingURL=knowledge.service.js.map