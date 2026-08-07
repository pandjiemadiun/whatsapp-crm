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
export declare class FAQService {
    create(data: FAQInput): Promise<{
        id: string;
        category: string | null;
        createdAt: Date;
        updatedAt: Date;
        question: string;
        answer: string;
        keywords: string[];
        priority: number;
        embedding: string | null;
        matchCount: number;
        isActive: boolean;
        deletedAt: Date | null;
        storeId: string;
    }>;
    update(id: string, data: Partial<FAQInput>): Promise<{
        id: string;
        category: string | null;
        createdAt: Date;
        updatedAt: Date;
        question: string;
        answer: string;
        keywords: string[];
        priority: number;
        embedding: string | null;
        matchCount: number;
        isActive: boolean;
        deletedAt: Date | null;
        storeId: string;
    }>;
    delete(id: string): Promise<{
        success: boolean;
        id: string;
    }>;
    findAll(storeId: string, options?: {
        category?: string;
        search?: string;
        includeInactive?: boolean;
    }): Promise<{
        id: string;
        category: string | null;
        createdAt: Date;
        updatedAt: Date;
        question: string;
        answer: string;
        keywords: string[];
        priority: number;
        embedding: string | null;
        matchCount: number;
        isActive: boolean;
        deletedAt: Date | null;
        storeId: string;
    }[]>;
    findById(id: string): Promise<{
        id: string;
        category: string | null;
        createdAt: Date;
        updatedAt: Date;
        question: string;
        answer: string;
        keywords: string[];
        priority: number;
        embedding: string | null;
        matchCount: number;
        isActive: boolean;
        deletedAt: Date | null;
        storeId: string;
    } | null>;
    search(storeId: string, query: string): Promise<FAQSearchResult[]>;
}
export declare const faqService: FAQService;
//# sourceMappingURL=faq.service.d.ts.map