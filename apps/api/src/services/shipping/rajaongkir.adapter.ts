import axios from 'axios';
import {
  ShippingCostProvider,
  ShippingCostResult,
  ShippingCostError,
} from './shipping-cost-provider.interface.js';

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

export const RAJAONGKIR_STARTER_COURIERS = ['jne', 'tiki'] as const;
export type RajaOngkirStarterCourier = (typeof RAJAONGKIR_STARTER_COURIERS)[number];

/** Injectable HTTP post so the real API can be mocked in tests. */
export type HttpPostFn = (
  url: string,
  data: Record<string, string>,
  headers: Record<string, string>,
) => Promise<{ data: unknown }>;

const DEFAULT_BASE_URL =
  'https://rajaongkir.komerce.id/api/v1/calculate/domestic-cost';

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
    originId: string,
    destinationId: string,
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
          origin: String(originId),
          destination: String(destinationId),
          weight: String(Math.round(weightGrams)),
          courier: c,
          price: 'lowest',
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
      const results = (data as any)?.data;
      if (!Array.isArray(results)) return null;

      const out: ShippingCostResult[] = [];
      for (const svc of results) {
        // Flat Komerce v2 shape: { code, service, cost, etd }.
        if (svc.code == null || svc.service == null) continue;
        out.push({
          courier: String(svc.code),
          service: String(svc.service),
          cost: Number(svc.cost),
          etd: String(svc.etd ?? ''),
        });
      }
      return out.length > 0 ? out : null;
    } catch {
      return null;
    }
  }
}

export const rajaOngkirAdapter = new RajaOngkirAdapter();
