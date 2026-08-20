import { ShippingCostProvider, ShippingCostResult, ShippingCostError } from './shipping-cost-provider.interface.js';
/**
 * RajaOngkir STARTER tier adapter.
 *
 * Starter is FREE and ONLY supports city-level (NOT subdistrict) lookups, with
 * couriers limited to: jne, pos, tiki. The HTTP call is injectable so tests
 * never hit the real API (no key exists in this environment yet).
 */
export declare const RAJAONGKIR_STARTER_COURIERS: readonly ["jne", "pos", "tiki"];
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
    getCost(originCityId: string, destinationCityId: string, weightGrams: number, courier: string): Promise<ShippingCostResult[] | ShippingCostError>;
    private parse;
}
export declare const rajaOngkirAdapter: RajaOngkirAdapter;
//# sourceMappingURL=rajaongkir.adapter.d.ts.map