/**
 * Shipping cost provider contract (FOUNDATION ONLY — not wired to checkout yet).
 *
 * Provider-agnostic interface so the implementation can be swapped (RajaOngkir,
 * or another provider if RajaOngkir bans us for caching cost results — owner
 * accepted that risk deliberately).
 */

/** Error codes a provider (or the cached wrapper) may return. */
export type ShippingCostError =
  | 'PROVIDER_ERROR' // provider unreachable / returned nothing usable
  | 'QUOTA_EXCEEDED' // daily API quota already exhausted (returned by cache layer)
  | 'INVALID_LOCATION'; // origin/destination/courier not resolvable by provider

/** A single courier service quote. `cost` is in Rupiah. */
export interface ShippingCostResult {
  courier: string;
  service: string;
  cost: number;
  etd: string;
}

export interface ShippingCostProvider {
  /**
   * Returns an array of available services for the given city-to-city pair.
   * One courier may yield multiple services (e.g. JNE REG + JNE YES) → array.
   * On failure returns one of the `ShippingCostError` codes instead of throwing.
   */
  getCost(
    originCityId: string,
    destinationCityId: string,
    weightGrams: number,
    courier: string,
  ): Promise<ShippingCostResult[] | ShippingCostError>;
}
