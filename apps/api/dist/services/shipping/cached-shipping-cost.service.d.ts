import { ShippingCostProvider, ShippingCostResult, ShippingCostError } from './shipping-cost-provider.interface.js';
/** Minimal Redis surface this service depends on (so it can be mocked in tests). */
export interface CacheStore {
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
}
export declare class CachedShippingCostService {
    private readonly provider;
    private readonly redis;
    private readonly quotaLimit;
    constructor(provider: ShippingCostProvider, redis?: CacheStore, quotaLimit?: number);
    getCost(originId: string, destinationId: string, weightGrams: number, courier: string): Promise<ShippingCostResult[] | ShippingCostError>;
}
export declare const cachedShippingCostService: CachedShippingCostService;
//# sourceMappingURL=cached-shipping-cost.service.d.ts.map