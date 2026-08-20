import axios from 'axios';
import {
  ShippingCostProvider,
  ShippingCostResult,
  ShippingCostError,
} from './shipping-cost-provider.interface.js';

/**
 * RajaOngkir STARTER tier adapter.
 *
 * Starter is FREE and ONLY supports city-level (NOT subdistrict) lookups, with
 * couriers limited to: jne, pos, tiki. The HTTP call is injectable so tests
 * never hit the real API (no key exists in this environment yet).
 */

export const RAJAONGKIR_STARTER_COURIERS = ['jne', 'pos', 'tiki'] as const;
export type RajaOngkirStarterCourier = (typeof RAJAONGKIR_STARTER_COURIERS)[number];

/** Injectable HTTP post so the real API can be mocked in tests. */
export type HttpPostFn = (
  url: string,
  data: Record<string, string>,
  headers: Record<string, string>,
) => Promise<{ data: unknown }>;

const DEFAULT_BASE_URL = 'https://api.rajaongkir.com/starter/cost';

const defaultHttpPost: HttpPostFn = (url, data, headers) =>
  axios.post(url, new URLSearchParams(data).toString(), {
    headers,
    timeout: 10000,
  });

export class RajaOngkirAdapter implements ShippingCostProvider {
  constructor(
    private readonly apiKey: string = process.env.RAJAONGKIR_API_KEY || '',
    private readonly httpPost: HttpPostFn = defaultHttpPost,
    private readonly baseUrl: string = DEFAULT_BASE_URL,
  ) {}

  async getCost(
    originCityId: string,
    destinationCityId: string,
    weightGrams: number,
    courier: string,
  ): Promise<ShippingCostResult[] | ShippingCostError> {
    const c = courier.toLowerCase();

    if (!RAJAONGKIR_STARTER_COURIERS.includes(c as RajaOngkirStarterCourier)) {
      // Starter tier cannot serve this courier — honest rejection, not a fake quote.
      return 'PROVIDER_ERROR';
    }

    if (!this.apiKey) {
      return 'PROVIDER_ERROR';
    }

    try {
      const res = await this.httpPost(
        this.baseUrl,
        {
          origin: String(originCityId),
          destination: String(destinationCityId),
          weight: String(Math.round(weightGrams)),
          courier: c,
        },
        {
          key: this.apiKey,
          'content-type': 'application/x-www-form-urlencoded',
        },
      );

      const parsed = this.parse(res.data);
      return parsed === null ? 'PROVIDER_ERROR' : parsed;
    } catch {
      return 'PROVIDER_ERROR';
    }
  }

  private parse(data: unknown): ShippingCostResult[] | null {
    try {
      const results = (data as any)?.rajaongkir?.results;
      if (!Array.isArray(results)) return null;

      const out: ShippingCostResult[] = [];
      for (const r of results) {
        if (!Array.isArray(r.costs)) continue;
        for (const svc of r.costs) {
          if (!Array.isArray(svc.cost) || svc.cost.length === 0) continue;
          const first = svc.cost[0];
          out.push({
            courier: r.code,
            service: svc.service,
            cost: Number(first.value),
            etd: String(first.etd ?? ''),
          });
        }
      }
      return out;
    } catch {
      return null;
    }
  }
}

export const rajaOngkirAdapter = new RajaOngkirAdapter();
