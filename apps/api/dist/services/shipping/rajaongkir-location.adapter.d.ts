import { CacheStore } from './cached-shipping-cost.service.js';
export interface LocationItem {
    id: string;
    name: string;
    parentId?: string;
}
/** Injectable HTTP GET so tests never hit the real RajaOngkir API. */
export type LocationHttpFn = (url: string, headers: Record<string, string>) => Promise<{
    data: unknown;
}>;
export declare class RajaOngkirLocationAdapter {
    private readonly apiKey;
    private readonly httpGet;
    private readonly redis;
    private readonly baseUrl;
    constructor(apiKey?: string, httpGet?: LocationHttpFn, redis?: CacheStore, baseUrl?: string);
    getProvinces(): Promise<LocationItem[]>;
    getCities(provinceId: string): Promise<LocationItem[]>;
    getSubdistricts(cityId: string): Promise<LocationItem[]>;
    private cached;
}
export declare const rajaOngkirLocation: RajaOngkirLocationAdapter;
//# sourceMappingURL=rajaongkir-location.adapter.d.ts.map