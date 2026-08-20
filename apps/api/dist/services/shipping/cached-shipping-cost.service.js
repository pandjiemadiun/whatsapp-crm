import { redisAdapter } from '../../adapters/cache/redis.adapter.js';
import { rajaOngkirAdapter } from './rajaongkir.adapter.js';
/**
 * Cached shipping-cost wrapper. Wraps ANY ShippingCostProvider and adds:
 *   - a GLOBAL (non-per-store) cache keyed by
 *     ongkir:cost:{originCityId}:{destinationCityId}:{courier}:{weightBucket}
 *   - a daily quota guard (Redis counter, WIB date) that short-circuits to
 *     QUOTA_EXCEEDED BEFORE calling the provider.
 *
 * NOTE (owner decision, risk accepted): RajaOngkir's terms forbid caching
 * "cost" results. We deliberately cache with a 7-day TTL so the architecture
 * is provider-agnostic — if banned, swap the provider, not the consumers.
 */
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const WEIGHT_BUCKET_GRAMS = 100;
function weightBucket(weightGrams) {
    // Round UP to the next 100g multiple. Rationale: a higher bucket still gets
    // the REAL price RajaOngkir returns for that rounded weight (not a guess),
    // while collapsing 450g..500g into one key → far better cache hit rate with
    // acceptable accuracy loss.
    return Math.ceil(weightGrams / WEIGHT_BUCKET_GRAMS) * WEIGHT_BUCKET_GRAMS;
}
function wibDateKey(d = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(d);
}
function secondsToWibMidnight(d = new Date()) {
    const wibNow = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
    const nextMidnight = new Date(wibNow);
    nextMidnight.setHours(24, 0, 0, 0);
    return Math.max(1, Math.ceil((nextMidnight.getTime() - wibNow.getTime()) / 1000));
}
export class CachedShippingCostService {
    constructor(provider, redis = redisAdapter, quotaLimit = parseInt(process.env.RAJAONGKIR_DAILY_QUOTA || '100', 10)) {
        this.provider = provider;
        this.redis = redis;
        this.quotaLimit = quotaLimit;
    }
    async getCost(originCityId, destinationCityId, weightGrams, courier) {
        const c = courier.toLowerCase();
        const bucket = weightBucket(weightGrams);
        const cacheKey = `ongkir:cost:${originCityId}:${destinationCityId}:${c}:${bucket}`;
        // 1) Cache HIT → return immediately, NO provider call, NO quota consumption.
        const cached = await this.redis.get(cacheKey);
        if (cached) {
            return cached;
        }
        // 2) Quota guard (WIB daily counter).
        const quotaKey = `ongkir:quota:rajaongkir:${wibDateKey()}`;
        const used = (await this.redis.get(quotaKey)) ?? 0;
        if (used >= this.quotaLimit) {
            return 'QUOTA_EXCEEDED';
        }
        // 3) Cache MISS + quota OK → call provider with the BUCKETED weight so the
        //    cached price is the REAL price for that rounded weight.
        const result = await this.provider.getCost(originCityId, destinationCityId, bucket, c);
        // Provider/validation error → return honestly, do NOT consume quota, do NOT cache.
        if (typeof result === 'string') {
            return result;
        }
        // Success → cache the real price, consume one quota slot.
        await this.redis.set(cacheKey, result, CACHE_TTL_SECONDS);
        await this.redis.set(quotaKey, used + 1, secondsToWibMidnight());
        return result;
    }
}
export const cachedShippingCostService = new CachedShippingCostService(rajaOngkirAdapter);
//# sourceMappingURL=cached-shipping-cost.service.js.map