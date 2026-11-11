import { describe, expect, it } from 'vitest';
import { parseAmount } from '../src/pricing/money.ts';
import { parseEcbXml, toEur } from '../src/pricing/fx.ts';

describe('parseAmount', () => {
  it.each([
    ['€949.00', 949],
    ['964,69€', 964.69],
    ['1.234,56 €', 1234.56],
    ['€1,234.56', 1234.56],
    ['9 999,00 kr', 9999],
    ['9 999,00 kr', 9999],
    ['1 299,00 zł', 1299],
    ['kr 1,299.00', 1299],
    ['€9.22', 9.22],
    ['1.299', 1299],
    ['949', 949],
    ['GRÁTIS', null],
    ['', null],
  ])('%s -> %s', (text, expected) => {
    expect(parseAmount(text)).toBe(expected);
  });
});

describe('fx', () => {
  const xml = `<gesmes:Envelope><Cube><Cube time='2026-11-10'><Cube currency='USD' rate='1.0812'/><Cube currency='SEK' rate='11.2345'/><Cube currency='PLN' rate='4.2650'/></Cube></Cube></gesmes:Envelope>`;

  it('parses the ECB daily file', () => {
    expect(parseEcbXml(xml)).toEqual({ date: '2026-11-10', rates: { USD: 1.0812, SEK: 11.2345, PLN: 4.265 } });
  });

  it('converts to EUR, or null without a rate', () => {
    const rates = new Map([['SEK', 11.2345]]);
    expect(toEur(10000, 'SEK', rates)).toBe(890.12);
    expect(toEur(949, 'EUR', rates)).toBe(949);
    expect(toEur(100, 'PLN', rates)).toBeNull();
  });
});
