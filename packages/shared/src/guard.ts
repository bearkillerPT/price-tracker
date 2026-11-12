// The version check: terms a page's title (or selected version) must and mustn't contain. Shared so the web
// app can show which of a page's versions the terms pick before a listing is added.
/**
 * Lowercases and keeps only letters, digits, "/" and "+", so "32 GB" matches "32GB", "Pro-125H" matches
 * "Pro125H" and "M1, Pro-125H" matches "M1 Pro-125H". Terms and page text go through the same function.
 */
export const normalizeForGuard = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}/+]/gu, '');

/** Reasons the page fails the listing's variant guard; empty when it passes. */
export function guardFailures(pageText: string, include: string[], exclude: string[]): string[] {
  const text = normalizeForGuard(pageText);
  const failures: string[] = [];
  for (const term of include) if (!text.includes(normalizeForGuard(term))) failures.push(`missing "${term}"`);
  for (const term of exclude) if (normalizeForGuard(term) && text.includes(normalizeForGuard(term))) failures.push(`contains "${term}"`);
  return failures;
}
