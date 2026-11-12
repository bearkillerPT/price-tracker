import { describe, expect, it } from 'vitest';
import type { BestPrice } from '@price-tracker/shared';
import { evaluateAlerts } from '../src/alerts/evaluate.ts';
import type { RuleInput } from '../src/alerts/evaluate.ts';
import type { PriceState } from '../src/views/products.ts';

const best = (eur: number): BestPrice => ({
  listingId: 1,
  store: 'amazon',
  marketplace: 'amazon.de',
  condition: 'new',
  headlinePrice: eur,
  priceIncludesVat: true,
  currency: 'EUR',
  headlineEur: eur,
  checkedAt: '2026-11-11T12:00:00Z',
});
const state = (eur: number | null, anyInStock: boolean | null = true): PriceState => ({ best: eur === null ? null : best(eur), anyInStock });
const rule = (type: RuleInput['type'], threshold: number | null = null, referencePrice: number | null = null): RuleInput => ({
  id: 1,
  type,
  threshold,
  enabled: true,
  referencePrice,
});
const run = (rules: RuleInput[], before: PriceState, after: PriceState) =>
  evaluateAlerts('M1 Pro', rules, before, after, (b) => `€${b.headlinePrice}`, (n) => `€${n}`);

describe('evaluateAlerts', () => {
  it('any_drop fires on a lower price only', () => {
    expect(run([rule('any_drop')], state(964.69), state(958.22)).triggers).toHaveLength(1);
    expect(run([rule('any_drop')], state(958.22), state(958.22)).triggers).toHaveLength(0);
    expect(run([rule('any_drop')], state(null), state(958.22)).triggers).toHaveLength(0);
  });

  it('target_price fires when crossing the target, not while staying below it', () => {
    expect(run([rule('target_price', 960)], state(964.69), state(958.22)).triggers[0]?.title).toBe('Target price reached: M1 Pro');
    expect(run([rule('target_price', 960)], state(null), state(958.22)).triggers).toHaveLength(1);
    expect(run([rule('target_price', 960)], state(958.22), state(950)).triggers).toHaveLength(0);
  });

  it('drop_percent compares with the highest price since it last fired', () => {
    const first = run([rule('drop_percent', 5)], state(null), state(1000));
    expect(first.triggers).toHaveLength(0);
    expect(first.references.get(1)).toBe(1000);
    expect(run([rule('drop_percent', 5, 1000)], state(1000), state(960)).triggers).toHaveLength(0);
    const fired = run([rule('drop_percent', 5, 1000)], state(960), state(949));
    expect(fired.triggers[0]?.title).toBe('Price down 5.1%: M1 Pro');
    expect(fired.references.get(1)).toBe(949);
    expect(run([rule('drop_percent', 5, 949)], state(949), state(1020)).references.get(1)).toBe(1020);
  });

  it('back_in_stock fires only after a known out-of-stock state', () => {
    expect(run([rule('back_in_stock')], state(null, false), state(958.22, true)).triggers).toHaveLength(1);
    expect(run([rule('back_in_stock')], state(null, null), state(958.22, true)).triggers).toHaveLength(0);
  });

  it('skips disabled rules', () => {
    expect(run([{ ...rule('any_drop'), enabled: false }], state(964.69), state(958.22)).triggers).toHaveLength(0);
  });
});
