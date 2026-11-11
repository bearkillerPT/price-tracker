import { CUSTOM_STORE_DEFAULTS, MIN_INTERVAL_MINUTES, rateGroupIn, requestsPerHour, storeIn, type StoreId } from "@price-tracker/shared";
import { TriangleAlert } from "lucide-react";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCatalog, useStores } from "@/hooks/queries";
import { INTERVAL_PRESETS, formatInterval, formatRate } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Check interval picker, with the ban warning and what the choice does to the store's request rate.
 * `count` listings get this interval; `previousMinutes` is their current interval when editing.
 */
export function IntervalField({
  id,
  store,
  value,
  onChange,
  count = 1,
  previousMinutes,
  newStoreLabel,
}: {
  id: string;
  store: StoreId;
  value: number;
  onChange: (minutes: number) => void;
  count?: number;
  previousMinutes?: number;
  /** Name of a shop being added (not in the catalog yet). */
  newStoreLabel?: string;
}) {
  const stores = useStores();
  const catalog = useCatalog();
  const info = storeIn(catalog, store);
  // A shop being added doesn't exist yet: it'll get its own group with the custom-store limits
  const group = rateGroupIn(catalog, info?.rateGroup ?? store) ?? {
    id: store,
    label: info?.label ?? (newStoreLabel || store),
    warnPerHour: CUSTOM_STORE_DEFAULTS.warnPerHour,
    dangerPerHour: CUSTOM_STORE_DEFAULTS.dangerPerHour,
  };
  const status = stores.data?.find((g) => g.group === group.id);

  const options = [...new Set([...INTERVAL_PRESETS, value])].filter((m) => m >= MIN_INTERVAL_MINUTES).sort((a, b) => a - b);
  const added = count * requestsPerHour(value) - (previousMinutes ? count * requestsPerHour(previousMinutes) : 0);
  const planned = status?.plannedPerHour ?? 0;
  const after = Math.max(0, planned + added);
  const level = after > group.dangerPerHour ? "danger" : after > group.warnPerHour ? "warn" : "ok";

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Check every</Label>
      <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger id={id} className="w-40" aria-describedby={`${id}-impact ${id}-warning`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((m) => (
            <SelectItem key={m} value={String(m)}>
              {formatInterval(m)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p
        id={`${id}-impact`}
        className={cn(
          "text-xs",
          level === "ok" && "text-muted-foreground",
          level === "warn" && "text-warning",
          level === "danger" && "font-medium text-destructive",
        )}
      >
        {added >= 0 ? "Adds" : "Removes"} {formatRate(Math.abs(added))} requests/hour to {group.label}
        {status && (
          <>
            : {formatRate(planned)} → {formatRate(after)} per hour (warning above {group.warnPerHour}, strong warning above{" "}
            {group.dangerPerHour}).
          </>
        )}
      </p>
      <p id={`${id}-warning`} className="flex gap-1.5 text-xs text-muted-foreground">
        <TriangleAlert className="mt-px size-3.5 shrink-0 text-warning" aria-hidden />
        <span>
          Stores don't want automated checks. Checking often can get the server's IP blocked or your store account banned, so
          keep intervals long.
        </span>
      </p>
    </div>
  );
}
