// Standard VAT rates of EU countries (percent), to compare prices shown without VAT (Amazon Business) with
// prices that include it. Some goods have reduced rates, so it's an estimate. Rates change now and then:
// check https://taxation-customs.ec.europa.eu if a comparison looks off.
const STANDARD_VAT: Record<string, number> = {
  AT: 20, BE: 21, BG: 20, CY: 19, CZ: 21, DE: 19, DK: 25, EE: 24, ES: 21, FI: 25.5, FR: 20, GR: 24, HR: 25, HU: 27,
  IE: 23, IT: 22, LT: 21, LU: 17, LV: 21, MT: 18, NL: 21, PL: 23, PT: 23, RO: 21, SE: 25, SI: 22, SK: 23,
};

export const standardVatRate = (country: string | null | undefined): number | null => (country ? (STANDARD_VAT[country.toUpperCase()] ?? null) : null);

/** The amount with the country's standard VAT added, or null when the rate isn't known. */
export function withStandardVat(amount: number | null, country: string | null | undefined): number | null {
  const rate = standardVatRate(country);
  return amount === null || rate === null ? null : Math.round(amount * (1 + rate / 100) * 100) / 100;
}
