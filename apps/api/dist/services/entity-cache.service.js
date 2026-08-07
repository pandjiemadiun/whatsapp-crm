/**
 * Entity Cache Service — cache profil customer, nama, dan metadata grup
 * WhatsApp dengan TTL 6 jam. Menghindari fetch berulang per event.
 */
import { adapters } from '../adapters/container.js';
export class EntityCacheService {
    constructor() {
        this.TTL_MS = 6 * 60 * 60 * 1000; // 6 jam
        this.cache = new Map();
    }
    key(...parts) {
        return parts.join(':');
    }
    /** Ambil dari cache, atau execute fetchFn dan cache hasilnya */
    async getOrSet(key, fetchFn, ttlMs) {
        const cached = this.cache.get(key);
        const ttl = ttlMs ?? this.TTL_MS;
        if (cached && cached.expiresAt > Date.now()) {
            return cached.value;
        }
        const value = await fetchFn();
        this.cache.set(key, { value, cachedAt: Date.now(), expiresAt: Date.now() + ttl });
        return value;
    }
    async getCustomerProfile(storeId, customerId) {
        return this.getOrSet(this.key('customer', storeId, customerId), async () => {
            // GOWA/Fonnte tidak punya API profil langsung — gunakan data yang pernah dikirim
            // atau lewati ke gateway jika support
            try {
                const conv = await import('../infrastructure/prisma.js').then((p) => p.prisma.conversation.findFirst({
                    where: { storeId, customerId: customerId, deletedAt: null },
                    select: { customerName: true },
                    orderBy: { createdAt: 'desc' },
                }));
                return conv?.customerName ? { name: conv.customerName } : null;
            }
            catch {
                return null;
            }
        });
    }
    async getGroupName(storeId, groupId) {
        return this.getOrSet(this.key('group', storeId, groupId), async () => {
            return null; // stub — diimplementasikan jika gateway support group metadata
        });
    }
    /** Bersihkan cache yang kadaluarsa secara manual */
    cleanup() {
        const now = Date.now();
        let cleaned = 0;
        for (const [key, entry] of this.cache.entries()) {
            if (entry.expiresAt <= now) {
                this.cache.delete(key);
                cleaned++;
            }
        }
        if (cleaned > 0) {
            adapters.logger.debug('Entity cache cleaned', { cleaned });
        }
        return cleaned;
    }
    clear() {
        this.cache.clear();
    }
}
export const entityCacheService = new EntityCacheService();
//# sourceMappingURL=entity-cache.service.js.map