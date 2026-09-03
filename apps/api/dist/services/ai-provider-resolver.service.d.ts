import type { AIProvider } from '../adapters/ai/types.js';
/** Minimal row shape the resolver cares about (subset of Prisma's AIProviderConfig). */
export interface ProviderRow {
    name: string;
    format: string;
    baseUrl: string;
    apiKey: string;
    model: string;
    role: string;
    priority: number;
    isActive: boolean;
}
type FindManyArgs = {
    where?: {
        role?: string;
        isActive?: boolean;
    };
    orderBy?: {
        priority?: 'asc' | 'desc';
    };
};
export declare class AIProviderResolverService {
    /**
     * Injected findMany (defaults to the real Prisma client).
     * Tests inject a fake to avoid the database.
     */
    private findMany;
    private cache;
    constructor(
    /**
     * Injected findMany (defaults to the real Prisma client).
     * Tests inject a fake to avoid the database.
     */
    findMany?: (args: FindManyArgs) => Promise<ProviderRow[]>);
    /** Active providers for a role, ordered by priority (highest first). Empty array if none active. */
    getProvidersForRole(role: string): Promise<AIProvider[]>;
    private buildProvider;
    /** Clear the local cache (e.g. after a provider-config hot-reload). */
    invalidateCache(): void;
}
export declare const aiProviderResolver: AIProviderResolverService;
export {};
//# sourceMappingURL=ai-provider-resolver.service.d.ts.map