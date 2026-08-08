export type EngineVersion = 'v1' | 'v2';
export interface StoreEngineConfig {
    storeId: string;
    engine: EngineVersion;
    enabledAt?: string;
    canaryStartDate?: string;
}
export declare function getStoreEngine(storeId: string): Promise<EngineVersion>;
export declare function setStoreEngine(storeId: string, engine: EngineVersion): Promise<void>;
export declare function isCanaryActive(storeId: string): Promise<boolean>;
//# sourceMappingURL=engine-config.d.ts.map