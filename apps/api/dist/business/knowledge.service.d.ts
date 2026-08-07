export interface KnowledgeInput {
    storeId: string;
    title: string;
    content: string;
    category?: string;
    tags?: string[];
    source?: string;
    relevanceScore?: number;
}
export interface KnowledgeSearchResult {
    id: string;
    title: string;
    content: string;
    category: string | null;
    tags: string[];
    confidence: number;
    createdAt: Date;
}
export declare class KnowledgeService {
    create(data: KnowledgeInput): Promise<{
        id: string;
        category: string | null;
        createdAt: Date;
        updatedAt: Date;
        content: string;
        tags: string[];
        embedding: string | null;
        isActive: boolean;
        deletedAt: Date | null;
        storeId: string;
        title: string;
        source: string | null;
        relevanceScore: number;
    }>;
    update(id: string, data: Partial<KnowledgeInput>): Promise<{
        id: string;
        category: string | null;
        createdAt: Date;
        updatedAt: Date;
        content: string;
        tags: string[];
        embedding: string | null;
        isActive: boolean;
        deletedAt: Date | null;
        storeId: string;
        title: string;
        source: string | null;
        relevanceScore: number;
    }>;
    delete(id: string): Promise<{
        success: boolean;
        id: string;
    }>;
    findById(id: string): Promise<{
        id: string;
        category: string | null;
        createdAt: Date;
        updatedAt: Date;
        content: string;
        tags: string[];
        embedding: string | null;
        isActive: boolean;
        deletedAt: Date | null;
        storeId: string;
        title: string;
        source: string | null;
        relevanceScore: number;
    } | null>;
    list(storeId: string, options?: {
        category?: string;
        search?: string;
        includeInactive?: boolean;
    }): Promise<{
        id: string;
        category: string | null;
        createdAt: Date;
        updatedAt: Date;
        content: string;
        tags: string[];
        embedding: string | null;
        isActive: boolean;
        deletedAt: Date | null;
        storeId: string;
        title: string;
        source: string | null;
        relevanceScore: number;
    }[]>;
    search(storeId: string, query: string): Promise<KnowledgeSearchResult[]>;
}
export declare const knowledgeService: KnowledgeService;
//# sourceMappingURL=knowledge.service.d.ts.map