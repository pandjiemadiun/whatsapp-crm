import axios from 'axios';
import { redisAdapter } from '../../adapters/cache/redis.adapter.js';
import { CacheStore } from './cached-shipping-cost.service.js';

/**
 * RajaOngkir Starter REFERENCE data: province / city / subdistrict.
 *
 * Caching these in Redis is ToS-COMPLIANT (unlike cost results): reference
 * lookups are static-ish administrative data (batas administratif jarang
 * berubah, tapi tidak nol), so a 30-day refresh cycle is reasonable and
 * permitted. This is deliberately DIFFERENT from the cost cache
 * (cached-shipping-cost.service) which owner accepted violating ToS — that
 * risk does NOT apply to reference data.
 */
const LOCATION_REF_TTL = 30 * 24 * 60 * 60; // 30 days

export interface LocationItem {
  id: string;
  name: string;
  parentId?: string;
}

/** Injectable HTTP GET so tests never hit the real RajaOngkir API. */
export type LocationHttpFn = (
  url: string,
  headers: Record<string, string>,
) => Promise<{ data: unknown }>;

const defaultHttpGet: LocationHttpFn = (url, headers) =>
  axios.get(url, { headers, timeout: 10000 });

export class RajaOngkirLocationAdapter {
  constructor(
    private readonly apiKey: string = process.env.RAJAONGKIR_API_KEY || '',
    private readonly httpGet: LocationHttpFn = defaultHttpGet,
    private readonly redis: CacheStore = redisAdapter,
    private readonly baseUrl: string = 'https://api.rajaongkir.com/starter',
  ) {}

  async getProvinces(): Promise<LocationItem[]> {
    return this.cached('ongkir:ref:province', async () => {
      const res = await this.httpGet(`${this.baseUrl}/province`, { key: this.apiKey });
      return parseProvinces(res.data);
    });
  }

  async getCities(provinceId: string): Promise<LocationItem[]> {
    const key = `ongkir:ref:city:${provinceId}`;
    return this.cached(key, async () => {
      const res = await this.httpGet(
        `${this.baseUrl}/city?province=${encodeURIComponent(provinceId)}`,
        { key: this.apiKey },
      );
      return parseCities(res.data);
    });
  }

  async getSubdistricts(cityId: string): Promise<LocationItem[]> {
    const key = `ongkir:ref:subdistrict:${cityId}`;
    return this.cached(key, async () => {
      const res = await this.httpGet(
        `${this.baseUrl}/subdistrict?city=${encodeURIComponent(cityId)}`,
        { key: this.apiKey },
      );
      return parseSubdistricts(res.data);
    });
  }

  private async cached(
    key: string,
    fetchFn: () => Promise<LocationItem[] | null>,
  ): Promise<LocationItem[]> {
    const hit = await this.redis.get<LocationItem[]>(key);
    if (hit) return hit;
    const fresh = await fetchFn();
    if (fresh) {
      await this.redis.set(key, fresh, LOCATION_REF_TTL);
      return fresh;
    }
    throw new Error('RAJAONGKIR_LOCATION_UNAVAILABLE');
  }
}

function parseProvinces(data: unknown): LocationItem[] | null {
  try {
    const results = (data as any)?.rajaongkir?.results;
    if (!Array.isArray(results)) return null;
    return results.map((r: any) => ({ id: String(r.province_id), name: r.province }));
  } catch {
    return null;
  }
}

function parseCities(data: unknown): LocationItem[] | null {
  try {
    const results = (data as any)?.rajaongkir?.results;
    if (!Array.isArray(results)) return null;
    return results.map((r: any) => ({
      id: String(r.city_id),
      name: r.city_name,
      parentId: String(r.province_id),
    }));
  } catch {
    return null;
  }
}

function parseSubdistricts(data: unknown): LocationItem[] | null {
  try {
    const results = (data as any)?.rajaongkir?.results;
    if (!Array.isArray(results)) return null;
    return results.map((r: any) => ({
      id: String(r.subdistrict_id),
      name: r.subdistrict_name,
      parentId: String(r.city_id),
    }));
  } catch {
    return null;
  }
}

export const rajaOngkirLocation = new RajaOngkirLocationAdapter();
