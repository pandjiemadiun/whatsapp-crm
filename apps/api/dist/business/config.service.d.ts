export declare class ConfigService {
    private cache;
    private readonly CACHE_TTL;
    /**
     * getConfig — Get a config value by key.
     * Priority: env override → DB → process.env fallback.
     *
     * ENV_OVERRIDE melebihi DB agar:
     *  1. `dotenv` load dari .env SELALU menang (single source of truth)
     *  2. Admin panel (DB) hanya dipakai jika .env TIDAK mendefinisikan key tersebut
     *  3. Tidak ada lagi placeholder `isi_key_kamu` yang menyelinap ke production
     */
    getConfig(key: string): Promise<string | null>;
    /**
     * Sync .env value ke DB (non-blocking, best-effort).
     * Hanya update jika DB kosong atau masih placeholder.
     */
    private syncEnvToDb;
    /**
     * setConfig — Upsert a config value, then invalidate cache.
     */
    setConfig(key: string, value: string, options?: {
        category?: string;
        isSecret?: boolean;
        description?: string;
    }): Promise<void>;
    /**
     * getAllConfigs — List all settings, masking secret values for API output.
     */
    getAllConfigs(filterCategory?: string): Promise<{
        key: string;
        value: string;
        category: string;
        isSecret: boolean;
        description: string | null;
        updatedAt: Date;
    }[]>;
    /**
     * getSingleConfig — Get a single config for API output (masks secrets).
     */
    getSingleConfig(key: string): Promise<{
        key: string;
        value: string;
        category: string;
        isSecret: boolean;
        description: string | null;
        updatedAt: Date;
    } | null>;
    /**
     * deleteConfig — Delete a config key from DB + cache.
     */
    deleteConfig(key: string): Promise<boolean>;
    /**
     * invalidateCache — Clear entire cache (force re-read on next getConfig).
     */
    invalidateCache(): void;
}
export declare const configService: ConfigService;
//# sourceMappingURL=config.service.d.ts.map