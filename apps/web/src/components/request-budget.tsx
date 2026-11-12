// How hard the enabled listings make the tracker hit each store, and how risky that is. Each store group (one
// company, one IP) has one budget: the requests per hour its listings' intervals add up to.
import type { RateGroupStatus } from "@price-tracker/shared";
import { CirclePause } from "lucide-react";
import { Link } from "react-router";

import { StoreIcon } from "@/components/store-icon";
import { formatDateTime, formatRate, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const RISK = {
  ok: { label: "Low risk", text: "text-success", bar: "bg-success", dot: "bg-success" },
  warn: { label: "Elevated risk", text: "text-warning", bar: "bg-warning", dot: "bg-warning" },
  danger: { label: "High risk", text: "text-destructive", bar: "bg-destructive", dot: "bg-destructive" },
} as const;

export const isPaused = (g: RateGroupStatus) => g.pausedUntil !== null && new Date(g.pausedUntil).getTime() > Date.now();

/**
 * The store's planned rate against its warning levels (the ticks). With `own`, the part one product's listings
 * make is solid and the rest of the store's total faded.
 */
export function BudgetMeter({ group: g, own, className }: { group: RateGroupStatus; own?: number; className?: string }) {
  // Full width is 1.5x the strong-warning level, so both ticks sit inside it
  const scale = g.dangerPerHour * 1.5;
  const pct = (n: number) => `${Math.min(100, (n / scale) * 100)}%`;
  const of = own !== undefined ? `${formatRate(own)} per hour from this product, ` : "";
  return (
    <div
      className={cn("relative h-1.5 rounded-full bg-muted", className)}
      role="meter"
      aria-label={`Planned requests per hour to ${g.label}`}
      aria-valuemin={0}
      aria-valuemax={scale}
      aria-valuenow={Number(g.plannedPerHour.toFixed(2))}
      aria-valuetext={`${of}${formatRate(g.plannedPerHour)} per hour in all: ${RISK[g.level].label.toLowerCase()}. Warning above ${g.warnPerHour}, strong warning above ${g.dangerPerHour}.`}
    >
      <div
        className={cn("absolute inset-y-0 left-0 rounded-full transition-[width]", RISK[g.level].bar, own !== undefined && "opacity-35")}
        style={{ width: pct(g.plannedPerHour) }}
      />
      {own !== undefined && (
        <div className={cn("absolute inset-y-0 left-0 rounded-full transition-[width]", RISK[g.level].bar)} style={{ width: pct(own) }} />
      )}
      <div className="absolute -top-0.5 h-2.5 w-px bg-warning" style={{ left: pct(g.warnPerHour) }} aria-hidden />
      <div className="absolute -top-0.5 h-2.5 w-px bg-destructive" style={{ left: pct(g.dangerPerHour) }} aria-hidden />
    </div>
  );
}

/** "● Low risk", in words as well as colour. */
export function RiskLabel({ level, className }: { level: RateGroupStatus["level"]; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", RISK[level].text, className)}>
      <span className={cn("size-1.5 rounded-full", RISK[level].dot)} aria-hidden />
      {RISK[level].label}
    </span>
  );
}

/**
 * One card per store group: planned requests per hour, the risk, and whether it's paused. Links to the Stores
 * page. With `own` (a product page), each card leads with that product's listings' rate; the risk stays the
 * store's, since every product's checks of a store add up.
 */
export function RequestRates({ groups, own, title = "Requests to stores" }: { groups: RateGroupStatus[]; own?: Record<string, number>; title?: string }) {
  if (!groups.length) return null;
  return (
    <section aria-labelledby="request-rates-heading" className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="request-rates-heading" className="text-sm font-medium">
          {title}
        </h2>
        <Link to="/stores" className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          How this works
        </Link>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((g) => {
          const paused = isPaused(g);
          const mine = own?.[g.group];
          const rate = mine ?? g.plannedPerHour;
          return (
            <li key={g.group}>
              <Link
                to={`/stores#store-${g.group}`}
                className="block rounded-lg border bg-card p-3 transition-colors hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <div className="flex items-center gap-2">
                  <StoreIcon store={g.stores[0] ?? g.group} label={g.label} />
                  <span className="truncate text-sm font-medium">{g.label}</span>
                  <span className={cn("ml-auto text-sm font-semibold tabular-nums", RISK[g.level].text)}>{formatRate(rate)}/h</span>
                </div>
                <BudgetMeter group={g} own={mine} className="mt-2.5" />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {paused ? (
                    <span className="inline-flex items-center gap-1 text-destructive">
                      <CirclePause className="size-3" aria-hidden /> Paused, resumes{" "}
                      <time dateTime={g.pausedUntil!} title={formatDateTime(g.pausedUntil)}>
                        {relativeTime(g.pausedUntil)}
                      </time>
                    </span>
                  ) : (
                    <RiskLabel level={g.level} />
                  )}
                  <span className="tabular-nums">
                    {mine !== undefined
                      ? `store total ${formatRate(g.plannedPerHour)}/h`
                      : `${g.enabledListings} ${g.enabledListings === 1 ? "listing" : "listings"}`}
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
