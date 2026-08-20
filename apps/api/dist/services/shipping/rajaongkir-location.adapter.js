import axios from 'axios';
import { redisAdapter } from '../../adapters/cache/redis.adapter.js';
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
const defaultHttpGet = (url, headers) => axios.get(url, { headers, timeout: 10000 });
export class RajaOngkirLocationAdapter {
    constructor(apiKey = process.env.RAJAONGKIR_API_KEY || '', httpGet = defaultHttpGet, redis = redisAdapter, baseUrl = 'https://rajaongkir.komerce.id/api/v1/destination') {
        this.apiKey = apiKey;
        this.httpGet = httpGet;
        this.redis = redis;
        this.baseUrl = baseUrl;
    }
    async getProvinces() {
        return this.cached('ongkir:ref:province', async () => {
            const res = await this.httpGet(`${this.baseUrl}/province`, { key: this.apiKey });
            return parseProvinces(res.data);
        });
    }
    async getCities(provinceId) {
        // New API has no city list endpoint — emulate by searching the province
        // NAME and de-duplicating city_name. (provinceId → name lookup via cache.)
        const provinces = await this.getProvinces();
        const prov = provinces.find((p) => p.id === provinceId);
        if (!prov)
            return [];
        const key = `ongkir:ref:city:${provinceId}`;
        return this.cached(key, async () => {
            const res = await this.httpGet(`${this.baseUrl}/domestic-destination?search=${encodeURIComponent(prov.name)}&limit=100`, { key: this.apiKey });
            const rows = parseDestinations(res.data);
            const cities = new Map();
            for (const r of rows) {
                if (r.province_name === prov.name && r.city_name)
                    cities.set(r.city_name, r.city_name);
            }
            // City has no id in the Komerce API → use the name as its identifier.
            return [...cities.values()].map((name) => ({ id: name, name }));
        });
    }
    async getSubdistricts(cityId) {
        // cityId here is the city NAME (see getCities). Search it and keep rows
        // whose city_name matches, de-duplicating by subdistrict_name.
        const key = `ongkir:ref:subdistrict:${cityId}`;
        return this.cached(key, async () => {
            const res = await this.httpGet(`${this.baseUrl}/domestic-destination?search=${encodeURIComponent(cityId)}&limit=100`, { key: this.apiKey });
            const rows = parseDestinations(res.data);
            const seen = new Map();
            for (const r of rows) {
                if (r.city_name === cityId && r.subdistrict_name) {
                    seen.set(r.subdistrict_name, String(r.id));
                }
            }
            return [...seen.entries()].map(([name, id]) => ({ id, name }));
        });
    }
    async cached(key, fetchFn) {
        const hit = await this.redis.get(key);
        if (hit)
            return hit;
        const fresh = await fetchFn();
        if (fresh) {
            await this.redis.set(key, fresh, LOCATION_REF_TTL);
            return fresh;
        }
        throw new Error('RAJAONGKIR_LOCATION_UNAVAILABLE');
    }
}
function parseProvinces(data) {
    try {
        const results = data?.data; // Komerce wraps in { meta, data: [...] }
        if (!Array.isArray(results))
            return null;
        return results.map((r) => ({ id: String(r.id), name: r.name }));
    }
    catch {
        return null;
    }
}
function parseDestinations(data) {
    try {
        const results = data?.data;
        if (!Array.isArray(results))
            return [];
        return results;
    }
    catch {
        return [];
    }
}
export const rajaOngkirLocation = new RajaOngkirLocationAdapter();
//# sourceMappingURL=rajaongkir-location.adapter.js.map