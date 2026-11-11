// Decides which alert rules fire when a check changes a product's price state. Pure, so it's tested
// without a database: the caller stores the triggers, sends them, and saves the new reference prices.
import type { AlertType, BestPrice } from '@price-tracker/shared';
import type { PriceState } from '../views/products.ts';

export interface RuleInput {
  id: number;
  type: AlertType;
  threshold: number | null;
  enabled: boolean;
  referencePrice: number | null;
}

export interface Trigger {
  ruleId: number;
  type: AlertType;
  title: string;
  message: string;
  priority: number;
}

export interface Evaluation {
  triggers: Trigger[];
  /** New reference prices for drop_percent rules (highest price since they last fired). */
  references: Map<number, number>;
}

const eurValue = (best: BestPrice | null): number | null => best?.headlineEur ?? null;

/**
 * @param describe one line for a price, e.g. "€958.22 at Amazon Germany (incl. €9.22 delivery)"
 * @param formatEur formats an amount in EUR
 */
export function evaluateAlerts(
  productName: string,
  rules: RuleInput[],
  before: PriceState,
  after: PriceState,
  describe: (best: BestPrice) => string,
  formatEur: (amount: number) => string,
): Evaluation {
  const triggers: Trigger[] = [];
  const references = new Map<number, number>();
  const was = eurValue(before.best);
  const now = eurValue(after.best);

  for (const rule of rules) {
    if (!rule.enabled) continue;
    switch (rule.type) {
      case 'any_drop':
        if (was !== null && now !== null && now < was - 0.005) {
          triggers.push({
            ruleId: rule.id,
            type: rule.type,
            title: `Price drop: ${productName}`,
            message: `${describe(after.best!)}\nWas ${formatEur(was)}`,
            priority: 5,
          });
        }
        break;
      case 'target_price':
        if (rule.threshold !== null && now !== null && now <= rule.threshold && (was === null || was > rule.threshold)) {
          triggers.push({
            ruleId: rule.id,
            type: rule.type,
            title: `Target price reached: ${productName}`,
            message: `${describe(after.best!)}\nTarget ${formatEur(rule.threshold)}`,
            priority: 8,
          });
        }
        break;
      case 'drop_percent': {
        if (rule.threshold === null || now === null) break;
        const reference = rule.referencePrice;
        if (reference === null || now > reference) {
          references.set(rule.id, now); // first price, or a new high
        } else if (now <= reference * (1 - rule.threshold / 100)) {
          const pct = Math.round((1 - now / reference) * 1000) / 10;
          triggers.push({
            ruleId: rule.id,
            type: rule.type,
            title: `Price down ${pct}%: ${productName}`,
            message: `${describe(after.best!)}\nFrom ${formatEur(reference)}`,
            priority: 6,
          });
          references.set(rule.id, now);
        }
        break;
      }
      case 'back_in_stock':
        if (before.anyInStock === false && after.anyInStock === true && after.best) {
          triggers.push({
            ruleId: rule.id,
            type: rule.type,
            title: `Back in stock: ${productName}`,
            message: describe(after.best),
            priority: 7,
          });
        }
        break;
    }
  }
  return { triggers, references };
}
