import { redisAdapter } from '../../adapters/cache/redis.adapter.js';
import { rajaOngkirAdapter } from './rajaongkir.adapter.js';
import {
  ShippingCostProvider,
  ShippingCostResult,
  ShippingCostError,
} from './shipping-cost-provider.interface.js';

/**
 * Cached shipping-cost wrapper. Wraps ANY ShippingCostProvider and adds:
 *   - a GLOBAL (non-per-store) cache keyed by
 *     ongkir:cost:{originId}:{destinationId}:{courier}:{weightBucket}
 *   - a daily quota guard (Redis counter, WIB date) that short-circuits to
 *     QUOTA_EXCEEDED BEFORE calling the provider.
 *
 * NOTE (owner decision, risk accepted): RajaOngkir's terms forbid caching
 * "cost" results. We deliberately cache with a 7-day TTL so the architecture
 * is provider-agnostic — if banned, swap the provider, not the consumers.
 */

const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const WEIGHT_BUCKET_GRAMS = 100;

/** Minimal Redis surface this service depends on (so it can be mocked in tests). */
export interface CacheStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
}

function weightBucket(weightGrams: number): number {
  // Round UP to the next 100g multiple. Rationale: a higher bucket still gets
  // the REAL price RajaOngkir returns for that rounded weight (not a guess),
  // while collapsing 450g..500g into one key → far better cache hit rate with
  // acceptable accuracy loss.
  return Math.ceil(weightGrams / WEIGHT_BUCKET_GRAMS) * WEIGHT_BUCKET_GRAMS;
}

export function wibDateKey(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function secondsToWibMidnight(d = new Date()): number {
  const wibNow = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  const nextMidnight = new Date(wibNow);
  nextMidnight.setHours(24, 0, 0, 0);
  return Math.max(1, Math.ceil((nextMidnight.getTime() - wibNow.getTime()) / 1000));
}

export class CachedShippingCostService {
  constructor(
    private readonly provider: ShippingCostProvider,
    private readonly redis: CacheStore = redisAdapter,
    private readonly quotaLimit: number = parseInt(process.env.RAJAONGKIR_DAILY_QUOTA || '100', 10),
  ) {}

  async getCost(
    originId: string,
    destinationId: string,
    weightGrams: number,
    courier: string,
  ): Promise<ShippingCostResult[] | ShippingCostError> {
    const c = courier.toLowerCase();
    const bucket = weightBucket(weightGrams);

    const cacheKey = `ongkir:cost:${originId}:${destinationId}:${c}:${bucket}`;

    // 1) Cache HIT → return immediately, NO provider call, NO quota consumption.
    const cached = await this.redis.get<ShippingCostResult[]>(cacheKey);
    if (cached) {
      return cached;
    }

    // 2) Quota guard (WIB daily counter).
    const quotaKey = `ongkir:quota:rajaongkir:${wibDateKey()}`;
    const used = (await this.redis.get<number>(quotaKey)) ?? 0;
    if (used >= this.quotaLimit) {
      return 'QUOTA_EXCEEDED';
    }

    // 3) Cache MISS + quota OK → call provider with the BUCKETED weight so the
    //    cached price is the REAL price for that rounded weight.
    const result = await this.provider.getCost(originId, destinationId, bucket, c);

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
