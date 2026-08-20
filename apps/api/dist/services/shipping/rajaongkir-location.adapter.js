import axios from 'axios';
import { redisAdapter } from '../../adapters/cache/redis.adapter.js';
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
const defaultHttpGet = (url, headers) => axios.get(url, { headers, timeout: 10000 });
export class RajaOngkirLocationAdapter {
    constructor(apiKey = process.env.RAJAONGKIR_API_KEY || '', httpGet = defaultHttpGet, redis = redisAdapter, baseUrl = 'https://api.rajaongkir.com/starter') {
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
        const key = `ongkir:ref:city:${provinceId}`;
        return this.cached(key, async () => {
            const res = await this.httpGet(`${this.baseUrl}/city?province=${encodeURIComponent(provinceId)}`, { key: this.apiKey });
            return parseCities(res.data);
        });
    }
    async getSubdistricts(cityId) {
        const key = `ongkir:ref:subdistrict:${cityId}`;
        return this.cached(key, async () => {
            const res = await this.httpGet(`${this.baseUrl}/subdistrict?city=${encodeURIComponent(cityId)}`, { key: this.apiKey });
            return parseSubdistricts(res.data);
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
        const results = data?.rajaongkir?.results;
        if (!Array.isArray(results))
            return null;
        return results.map((r) => ({ id: String(r.province_id), name: r.province }));
    }
    catch {
        return null;
    }
}
function parseCities(data) {
    try {
        const results = data?.rajaongkir?.results;
        if (!Array.isArray(results))
            return null;
        return results.map((r) => ({
            id: String(r.city_id),
            name: r.city_name,
            parentId: String(r.province_id),
        }));
    }
    catch {
        return null;
    }
}
function parseSubdistricts(data) {
    try {
        const results = data?.rajaongkir?.results;
        if (!Array.isArray(results))
            return null;
        return results.map((r) => ({
            id: String(r.subdistrict_id),
            name: r.subdistrict_name,
            parentId: String(r.city_id),
        }));
    }
    catch {
        return null;
    }
}
export const rajaOngkirLocation = new RajaOngkirLocationAdapter();
//# sourceMappingURL=rajaongkir-location.adapter.js.map