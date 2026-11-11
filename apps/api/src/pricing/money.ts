/**
 * Reads an amount from a store's formatted price, whatever the locale:
 * "€949.00", "964,69€", "1.234,56 €", "9 999,00 kr", "1 299,00 zł", "kr 1,299.00".
 * Returns null when there are no digits.
 */
export function parseAmount(text: string | null | undefined): number | null {
  if (!text) return null;
  // Keep digits and separators; spaces (incl. no-break and thin spaces) are thousands separators
  const cleaned = text.replace(/[\s  ']/g, '').replace(/[^\d.,]/g, '');
  if (!/\d/.test(cleaned)) return null;
  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');
  let normalized: string;
  if (lastDot >= 0 && lastComma >= 0) {
    // Both present: the later one is the decimal separator
    const decimal = lastDot > lastComma ? '.' : ',';
    const thousands = decimal === '.' ? ',' : '.';
    normalized = cleaned.split(thousands).join('').replace(decimal, '.');
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    const parts = cleaned.split(sep);
    const tail = parts[parts.length - 1]!;
    // One separator followed by 1-2 digits is a decimal point; otherwise it groups thousands
    normalized = parts.length === 2 && tail.length <= 2 ? parts.join('.') : parts.join('');
  } else {
    normalized = cleaned;
  }
  const value = Number(normalized.replace(/^\.+|\.+$/g, ''));
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;
