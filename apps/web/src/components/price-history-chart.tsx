import { useMemo, useState } from "react";
import type { ProductHistory } from "@price-tracker/shared";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { useHistory, useLabels } from "@/hooks/queries";
import { conditionLabel, formatDateTime, formatEur, formatShortDate, formatTime } from "@/lib/format";

const RANGES = [7, 30, 90] as const;
const PALETTE = 5;

type Row = { t: number } & Record<string, number | null>;

function toChart(history: ProductHistory, marketplaceLabel: (id: string) => string) {
  const config: ChartConfig = {};
  const rows = new Map<number, Row>();
  history.listings.forEach((l, i) => {
    const key = `l${l.listingId}`;
    config[key] = {
      label: `${marketplaceLabel(l.marketplace)} · ${conditionLabel(l.condition)}`,
      color: `var(--chart-${(i % PALETTE) + 1})`,
    };
    for (const p of l.points) {
      if (p.headlineEur == null) continue;
      const t = new Date(p.t).getTime();
      const row = rows.get(t) ?? ({ t } as Row);
      row[key] = p.headlineEur;
      rows.set(t, row);
    }
  });
  const counts = Object.fromEntries(history.listings.map((l) => [`l${l.listingId}`, l.points.filter((p) => p.headlineEur != null).length]));
  return { config, counts, rows: [...rows.values()].sort((a, b) => a.t - b.t), keys: Object.keys(config) };
}

export function PriceHistoryChart({ productId }: { productId: number }) {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const history = useHistory(productId, days);
  const { marketplaceLabel } = useLabels();
  const chart = useMemo(() => (history.data ? toChart(history.data, marketplaceLabel) : null), [history.data, marketplaceLabel]);
  // Points within about a day: label the axis with times, not the (same) date
  const span = chart && chart.rows.length > 1 ? chart.rows[chart.rows.length - 1]!.t - chart.rows[0]!.t : 0;
  const tick = span < 36 * 60 * 60 * 1000 ? formatTime : formatShortDate;

  return (
    <section aria-labelledby="history-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="history-heading" className="font-semibold">
          Price history <span className="text-sm font-normal text-muted-foreground">(EUR, delivered when known)</span>
        </h2>
        <div role="group" aria-label="Time range" className="flex gap-1">
          {RANGES.map((d) => (
            <Button
              key={d}
              size="xs"
              variant={d === days ? "secondary" : "ghost"}
              aria-pressed={d === days}
              onClick={() => setDays(d)}
            >
              {d} days
            </Button>
          ))}
        </div>
      </div>
      {history.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : history.isError ? (
        <p className="text-sm text-destructive">Couldn't load the history: {history.error.message}</p>
      ) : !chart || chart.rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No prices in the last {days} days yet.
        </p>
      ) : (
        <ChartContainer config={chart.config} className="aspect-auto h-64 w-full sm:h-72">
          <LineChart data={chart.rows} margin={{ left: 4, right: 12, top: 8 }} accessibilityLayer>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(t: number) => tick(t)}
              tickLine={false}
              axisLine={false}
              minTickGap={24}
            />
            <YAxis
              width={64}
              tickLine={false}
              axisLine={false}
              domain={["auto", "auto"]}
              tickFormatter={(v: number) => formatEur(v).replace(/[.,]00(?=\D*$)/, "")}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(_, payload) => {
                    const t = (payload?.[0]?.payload as Row | undefined)?.t;
                    return t ? formatDateTime(new Date(t).toISOString()) : "";
                  }}
                  formatter={(value, name) => (
                    <div className="flex w-full justify-between gap-3">
                      <span className="text-muted-foreground">{chart.config[String(name)]?.label}</span>
                      <span className="font-mono tabular-nums">{formatEur(Number(value))}</span>
                    </div>
                  )}
                />
              }
            />
            {chart.keys.map((key, i) => (
              <Line
                key={key}
                dataKey={key}
                type="stepAfter"
                stroke={`var(--color-${key})`}
                strokeWidth={2}
                strokeDasharray={i >= PALETTE ? "5 3" : undefined}
                // Dots while a line has few points, so a single price is visible at all
                dot={(chart.counts[key] ?? 0) <= 40 ? { r: 3, strokeWidth: 0, fill: `var(--color-${key})` } : false}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ChartContainer>
      )}
      {/* Below the chart rather than inside it, so a long list wraps without covering the lines */}
      {chart && chart.rows.length > 0 && (
        <ul aria-label="Lines" className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs">
          {chart.keys.map((key, i) => (
            <li key={key} className="inline-flex items-center gap-1.5">
              <span aria-hidden className="w-3.5" style={{ borderTop: `2px ${i >= PALETTE ? "dashed" : "solid"} var(--chart-${(i % PALETTE) + 1})` }} />
              {chart.config[key]?.label}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
