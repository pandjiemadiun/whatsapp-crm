// Konstanta
export const FOUNDER_STORE_ID = process.env.FOUNDER_STORE_ID || 'store-founder';
/**
 * Cek apakah shadow mode harus dijalankan untuk store ini.
 */
export function shouldRunShadow(storeId, storeConfig) {
    const mode = process.env.SHADOW_MODE || 'false';
    if (mode === 'true')
        return true;
    if (mode === 'founder_only')
        return storeId === FOUNDER_STORE_ID;
    if (mode === 'false')
        return false;
    // Cek store config (opsional)
    return !!storeConfig?.shadow?.enabled;
}
//# sourceMappingURL=shadow-config.js.map