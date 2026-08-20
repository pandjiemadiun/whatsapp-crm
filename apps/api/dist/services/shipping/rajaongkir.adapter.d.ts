import { ShippingCostProvider, ShippingCostResult, ShippingCostError } from './shipping-cost-provider.interface.js';
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
export declare const RAJAONGKIR_STARTER_COURIERS: readonly ["jne", "tiki"];
export type RajaOngkirStarterCourier = (typeof RAJAONGKIR_STARTER_COURIERS)[number];
/** Injectable HTTP post so the real API can be mocked in tests. */
export type HttpPostFn = (url: string, data: Record<string, string>, headers: Record<string, string>) => Promise<{
    data: unknown;
}>;
export declare class RajaOngkirAdapter implements ShippingCostProvider {
    private readonly apiKey;
    private readonly httpPost;
    private readonly baseUrl;
    constructor(apiKey?: string, httpPost?: HttpPostFn, baseUrl?: string);
    getCost(originId: string, destinationId: string, weightGrams: number, courier: string): Promise<ShippingCostResult[] | ShippingCostError>;
    private parse;
}
export declare const rajaOngkirAdapter: RajaOngkirAdapter;
//# sourceMappingURL=rajaongkir.adapter.d.ts.map