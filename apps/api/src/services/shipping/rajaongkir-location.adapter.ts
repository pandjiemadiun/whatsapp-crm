import axios from 'axios';
import { redisAdapter } from '../../adapters/cache/redis.adapter.js';
import { CacheStore } from './cached-shipping-cost.service.js';

/**
 * RajaOngkir Komerce reference data (current platform: rajaongkir.komerce.id).
 *
 * - Provinces: dedicated `/province` endpoint.
 * - Cities & subdistricts: unified search `/domestic-destination` (requires a
 *   non-empty `search`). Each row is subdistrict-level and carries
 *   province_name / city_name / district_name / subdistrict_name / zip_code.
 *   There is NO separate city/subdistrict list endpoint and NO city_id, so the
 *   cascade is emulated by searching by province/city NAME and de-duplicating
 *   the child level. The granular id the API exposes is the subdistrict `id`
 *   (used as originSubdistrictId); city is identified by its name.
 *
 * Caching these in Redis is ToS-COMPLIANT (unlike cost results): reference
 * lookups are static-ish administrative data (batas administratif jarang
 * berubah, tapi tidak nol), so a 30-day refresh cycle is reasonable.
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

interface DestinationRow {
  id?: number;
  province_name?: string;
  city_name?: string;
  district_name?: string;
  subdistrict_name?: string;
}

export class RajaOngkirLocationAdapter {
  constructor(
    private readonly apiKey: string = process.env.RAJAONGKIR_API_KEY || '',
    private readonly httpGet: LocationHttpFn = defaultHttpGet,
    private readonly redis: CacheStore = redisAdapter,
    private readonly baseUrl: string = 'https://rajaongkir.komerce.id/api/v1/destination',
  ) {}

  async getProvinces(): Promise<LocationItem[]> {
    return this.cached('ongkir:ref:province', async () => {
      const res = await this.httpGet(`${this.baseUrl}/province`, { key: this.apiKey });
      return parseProvinces(res.data);
    });
  }

  async getCities(provinceId: string): Promise<LocationItem[]> {
    // New API has no city list endpoint — emulate by searching the province
    // NAME and de-duplicating city_name. (provinceId → name lookup via cache.)
    const provinces = await this.getProvinces();
    const prov = provinces.find((p) => p.id === provinceId);
    if (!prov) return [];
    const key = `ongkir:ref:city:${provinceId}`;
    return this.cached(key, async () => {
      const res = await this.httpGet(
        `${this.baseUrl}/domestic-destination?search=${encodeURIComponent(prov.name)}&limit=100`,
        { key: this.apiKey },
      );
      const rows = parseDestinations(res.data);
      const cities = new Map<string, string>();
      for (const r of rows) {
        if (r.province_name === prov.name && r.city_name) cities.set(r.city_name, r.city_name);
      }
      // City has no id in the Komerce API → use the name as its identifier.
      return [...cities.values()].map((name) => ({ id: name, name }));
    });
  }

  async getSubdistricts(cityId: string): Promise<LocationItem[]> {
    // cityId here is the city NAME (see getCities). Search it and keep rows
    // whose city_name matches, de-duplicating by subdistrict_name.
    const key = `ongkir:ref:subdistrict:${cityId}`;
    return this.cached(key, async () => {
      const res = await this.httpGet(
        `${this.baseUrl}/domestic-destination?search=${encodeURIComponent(cityId)}&limit=100`,
        { key: this.apiKey },
      );
      const rows = parseDestinations(res.data);
      const seen = new Map<string, string>();
      for (const r of rows) {
        if (r.city_name === cityId && r.subdistrict_name) {
          seen.set(r.subdistrict_name, String(r.id));
        }
      }
      return [...seen.entries()].map(([name, id]) => ({ id, name }));
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
    const results = (data as any)?.data; // Komerce wraps in { meta, data: [...] }
    if (!Array.isArray(results)) return null;
    return results.map((r: any) => ({ id: String(r.id), name: r.name }));
  } catch {
    return null;
  }
}

function parseDestinations(data: unknown): DestinationRow[] {
  try {
    const results = (data as any)?.data;
    if (!Array.isArray(results)) return [];
    return results as DestinationRow[];
  } catch {
    return [];
  }
}

export const rajaOngkirLocation = new RajaOngkirLocationAdapter();
