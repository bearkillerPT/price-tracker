import { useState, type FormEvent } from "react";
import {
  ALERT_TYPES,
  ALERT_TYPE_LABELS,
  type AlertRule,
  type AlertRuleCreate,
  type AlertRuleUpdate,
  type AlertType,
  type ProductDetail,
} from "@price-tracker/shared";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useProductMutation } from "@/hooks/queries";
import { del, patch, post } from "@/lib/api";
import { formatDateTime, formatEur, relativeTime } from "@/lib/format";

const needsThreshold = (t: AlertType) => t === "target_price" || t === "drop_percent";

function describe(rule: AlertRule): string {
  switch (rule.type) {
    case "target_price":
      return `Price at or below ${formatEur(rule.threshold)}`;
    case "drop_percent":
      return `Price drops by at least ${rule.threshold}%`;
    case "any_drop":
      return "Any price drop";
    case "back_in_stock":
      return "Back in stock";
  }
}

export function AlertRules({ product }: { product: ProductDetail }) {
  const [type, setType] = useState<AlertType>("target_price");
  const [threshold, setThreshold] = useState("");

  const add = useProductMutation(
    product.id,
    (body: AlertRuleCreate) => post<ProductDetail>(`/api/products/${product.id}/alerts`, body),
    "Alert added",
  );
  const update = useProductMutation(product.id, ({ id, ...body }: AlertRuleUpdate & { id: number }) =>
    patch<ProductDetail>(`/api/alerts/${id}`, body),
  );
  const remove = useProductMutation(product.id, (id: number) => del<ProductDetail>(`/api/alerts/${id}`), "Alert deleted");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate(
      { type, threshold: needsThreshold(type) ? Number(threshold) : null },
      { onSuccess: () => setThreshold("") },
    );
  };

  const thresholdValue = Number(threshold);
  const thresholdValid =
    !needsThreshold(type) ||
    (threshold !== "" && (type === "target_price" ? thresholdValue > 0 : thresholdValue >= 1 && thresholdValue <= 90));

  return (
    <section aria-labelledby="alerts-heading" className="space-y-3">
      <div>
        <h2 id="alerts-heading" className="font-semibold">
          Alerts
        </h2>
        <p className="text-sm text-muted-foreground">
          Sent to your notification channels. They compare the product's best price, in EUR, across its listings.
        </p>
      </div>

      {product.alertRules.length > 0 ? (
        <ul className="divide-y rounded-lg border">
          {product.alertRules.map((rule) => (
            <li key={rule.id} className="flex items-center gap-3 px-3 py-2">
              <Switch
                checked={rule.enabled}
                onCheckedChange={(enabled) => update.mutate({ id: rule.id, enabled })}
                aria-label={`${rule.enabled ? "Disable" : "Enable"}: ${describe(rule)}`}
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm">{describe(rule)}</div>
                <div className="text-xs text-muted-foreground">
                  {rule.lastTriggeredAt ? (
                    <>
                      Last sent <time title={formatDateTime(rule.lastTriggeredAt)}>{relativeTime(rule.lastTriggeredAt)}</time>
                    </>
                  ) : (
                    "Not sent yet"
                  )}
                </div>
              </div>
              <Button variant="ghost" size="icon-sm" aria-label={`Delete alert: ${describe(rule)}`} onClick={() => remove.mutate(rule.id)}>
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No alerts yet.</p>
      )}

      <form className="flex flex-wrap items-end gap-2" onSubmit={submit}>
        <div className="space-y-2">
          <Label htmlFor="alert-type">New alert</Label>
          <Select value={type} onValueChange={(v) => setType(v as AlertType)}>
            <SelectTrigger id="alert-type" className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ALERT_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {ALERT_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {needsThreshold(type) && (
          <div className="space-y-2">
            <Label htmlFor="alert-threshold">{type === "target_price" ? "Target (EUR)" : "Drop (%)"}</Label>
            <Input
              id="alert-threshold"
              type="number"
              inputMode="decimal"
              className="w-32"
              min={type === "target_price" ? 0.01 : 1}
              max={type === "drop_percent" ? 90 : undefined}
              step={type === "target_price" ? 0.01 : 1}
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              required
            />
          </div>
        )}
        <Button type="submit" variant="secondary" disabled={!thresholdValid || add.isPending}>
          Add alert
        </Button>
      </form>
    </section>
  );
}
