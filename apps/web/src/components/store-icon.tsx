import { marketplaceIn, storeFamily } from "@price-tracker/shared";

import { useLabels, useStoreIcons } from "@/hooks/queries";
import { cn } from "@/lib/utils";

/**
 * The store's favicon (or its family's: Amazon Business shows Amazon's), else its initial until the server has
 * one. Decorative: the store's name is always next to it.
 */
export function StoreIcon({ store, label, className }: { store: string; label: string; className?: string }) {
  const icons = useStoreIcons().data ?? {};
  const source = [store, ...storeFamily(store)].find((s) => icons[s]);
  const box = cn("inline-flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-[3px]", className);
  return source ? (
    // On a light tile in dark mode: many shop icons are dark marks drawn for light browser tabs
    <img
      src={`/api/store-icons/${encodeURIComponent(source)}?v=${icons[source]}`}
      alt=""
      aria-hidden
      loading="lazy"
      className={cn(box, "object-contain dark:bg-white dark:p-px")}
    />
  ) : (
    <span aria-hidden className={cn(box, "bg-muted text-[10px] font-semibold text-muted-foreground uppercase")}>
      {label.replace(/^www\./, "").charAt(0)}
    </span>
  );
}

/** A marketplace's name with its store's icon, e.g. "[a] Amazon Germany". */
export function MarketplaceName({ marketplace, className }: { marketplace: string; className?: string }) {
  const { catalog, marketplaceLabel } = useLabels();
  const label = marketplaceLabel(marketplace);
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <StoreIcon store={marketplaceIn(catalog, marketplace)?.store ?? marketplace} label={label} />
      <span className="truncate">{label}</span>
    </span>
  );
}
