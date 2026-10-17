/** Money helpers. Amounts are integers in minor units; never summed across currencies. */

export const ZERO_DECIMAL = new Set([
  "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf",
]);

export function exponent(currency: string): number {
  return ZERO_DECIMAL.has(currency.toLowerCase()) ? 0 : 2;
}

/** `49900, "usd"` -> `$499.00`. Falls back to `CODE 499.00` for codes Intl does not know. */
export function formatMoney(minor: number, currency: string): string {
  const cur = currency.toUpperCase();
  const exp = exponent(cur);
  const major = minor / 10 ** exp;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: cur,
      minimumFractionDigits: exp,
      maximumFractionDigits: exp,
    }).format(major);
  } catch {
    return `${cur} ${major.toFixed(exp)}`;
  }
}
