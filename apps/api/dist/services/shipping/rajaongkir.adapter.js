import axios from 'axios';
/**
 * RajaOngkir Komerce (v2) COST adapter — STARTER tier.
 *
 * Platform sekarang: rajaongkir.komerce.id (bukan api.rajaongkir.com yang mati).
 * Endpoint cost: POST /api/v1/calculate/domestic-cost, body form-urlencoded:
 *   origin, destination, weight, courier, price=lowest
 *
 * origin/destination = SUBDISTRICT/kecamatan ID hasil destination search
 * (SAMA PERSIS dengan ID di rajaongkir-location.adapter), BUKAN city ID.
 * Starter ternyata dapat granularity kecamatan penuh untuk COST juga.
 *
 * Couriers: hanya yang TERBUKTI jalan di akun Starter ini (diverifikasi live):
 *   jne ✓, tiki ✓. pos ✗ (404 "not found" — tidak tersedia di plan ini).
 * Jangan asumsikan courier dokumentasi lain (sicepat, dse, dst) aktif.
 *
 * Response FLAT (bukan nested rajaongkir.results[] lama):
 *   { meta, data: [{ code, service, cost, etd }] }
 */
export const RAJAONGKIR_STARTER_COURIERS = ['jne', 'tiki'];
const DEFAULT_BASE_URL = 'https://rajaongkir.komerce.id/api/v1/calculate/domestic-cost';
const defaultHttpPost = (url, data, headers) => axios.post(url, new URLSearchParams(data).toString(), {
    headers,
    timeout: 10000,
});
export class RajaOngkirAdapter {
    constructor(apiKey = process.env.RAJAONGKIR_API_KEY || '', httpPost = defaultHttpPost, baseUrl = DEFAULT_BASE_URL) {
        this.apiKey = apiKey;
        this.httpPost = httpPost;
        this.baseUrl = baseUrl;
    }
    async getCost(originId, destinationId, weightGrams, courier) {
        const c = courier.toLowerCase();
        if (!RAJAONGKIR_STARTER_COURIERS.includes(c)) {
            // Starter tier cannot serve this courier — honest rejection, not a fake quote.
            return 'PROVIDER_ERROR';
        }
        if (!this.apiKey) {
            return 'PROVIDER_ERROR';
        }
        try {
            const res = await this.httpPost(this.baseUrl, {
                origin: String(originId),
                destination: String(destinationId),
                weight: String(Math.round(weightGrams)),
                courier: c,
                price: 'lowest',
            }, {
                key: this.apiKey,
                'content-type': 'application/x-www-form-urlencoded',
            });
            const parsed = this.parse(res.data);
            return parsed === null ? 'PROVIDER_ERROR' : parsed;
        }
        catch {
            return 'PROVIDER_ERROR';
        }
    }
    parse(data) {
        try {
            const results = data?.data;
            if (!Array.isArray(results))
                return null;
            const out = [];
            for (const svc of results) {
                // Flat Komerce v2 shape: { code, service, cost, etd }.
                if (svc.code == null || svc.service == null)
                    continue;
                out.push({
                    courier: String(svc.code),
                    service: String(svc.service),
                    cost: Number(svc.cost),
                    etd: String(svc.etd ?? ''),
                });
            }
            return out.length > 0 ? out : null;
        }
        catch {
            return null;
        }
    }
}
export const rajaOngkirAdapter = new RajaOngkirAdapter();
//# sourceMappingURL=rajaongkir.adapter.js.map