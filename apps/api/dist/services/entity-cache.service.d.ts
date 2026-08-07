export interface CachedEntity {
    value: any;
    cachedAt: number;
    expiresAt: number;
}
export interface CustomerProfile {
    name?: string;
    profilePicUrl?: string;
    about?: string;
    lastSeen?: string;
}
export interface GroupMetadata {
    subject: string;
    desc?: string;
    participantCount: number;
    isAdmin: boolean;
}
export declare class EntityCacheService {
    private readonly TTL_MS;
    private cache;
    private key;
    /** Ambil dari cache, atau execute fetchFn dan cache hasilnya */
    getOrSet<T>(key: string, fetchFn: () => Promise<T>, ttlMs?: number): Promise<T>;
    getCustomerProfile(storeId: string, customerId: string): Promise<CustomerProfile | null>;
    getGroupName(storeId: string, groupId: string): Promise<string | null>;
    /** Bersihkan cache yang kadaluarsa secara manual */
    cleanup(): number;
    clear(): void;
}
export declare const entityCacheService: EntityCacheService;
//# sourceMappingURL=entity-cache.service.d.ts.map