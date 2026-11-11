import { useState } from "react";
import { marketplacesOfStore, storeFamily, storeIn, type Listing, type Observation, type ProductDetail } from "@price-tracker/shared";
import { Crosshair, ExternalLink, MoreHorizontal, Pencil, RefreshCw, Store, Trash2 } from "lucide-react";

import { TrackMoreStoresDialog } from "@/components/add-listing-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EditListingDialog } from "@/components/edit-listing-dialog";
import { RepickPriceDialog } from "@/components/repick-price";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLabels, useProductMutation } from "@/hooks/queries";
import { del, post } from "@/lib/api";
import {
  conditionLabel,
  formatDateTime,
  formatEur,
  formatInterval,
  formatMoney,
  relativeTime,
} from "@/lib/format";
import { cn } from "@/lib/utils";

export function ListingsTable({ product }: { product: ProductDetail }) {
  const [editing, setEditing] = useState<Listing | null>(null);
  const [trackingMore, setTrackingMore] = useState<Listing | null>(null);
  const [repicking, setRepicking] = useState<Listing | null>(null);

  if (product.listings.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No listings yet. Add a store page that sells this product.
      </div>
    );
  }

  return (
    <>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Store</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="hidden lg:table-cell">Seller</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden md:table-cell">Checks</TableHead>
              <TableHead className="w-10">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {product.listings.map((l) => (
              <ListingRow
                key={l.id}
                listing={l}
                product={product}
                onEdit={() => setEditing(l)}
                onTrackMore={() => setTrackingMore(l)}
                onRepick={() => setRepicking(l)}
              />
            ))}
          </TableBody>
        </Table>
      </div>
      {editing && (
        <EditListingDialog
          listing={editing}
          open={editing !== null}
          onOpenChange={(open) => !open && setEditing(null)}
        />
      )}
      <TrackMoreStoresDialog product={product} from={trackingMore} onOpenChange={(open) => !open && setTrackingMore(null)} />
      <RepickPriceDialog listing={repicking} onClose={() => setRepicking(null)} />
    </>
  );
}

function ListingRow({
  listing: l,
  product,
  onEdit,
  onTrackMore,
  onRepick,
}: {
  listing: Listing;
  product: ProductDetail;
  onEdit: () => void;
  onTrackMore: () => void;
  onRepick: () => void;
}) {
  const productId = product.id;
  const { catalog, marketplaceLabel } = useLabels();
  // Only stores with several country stores (Amazon, Amazon Business) can track the same ID elsewhere
  const family = storeFamily(l.store).filter((s) => storeIn(catalog, s)?.implemented);
  const marketplaces = family.flatMap((s) => marketplacesOfStore(catalog, s));
  const untracked = marketplaces.filter(
    (m) => !product.listings.some((x) => family.includes(x.store) && x.externalId === l.externalId && x.marketplace === m.id),
  );
  const check = useProductMutation(productId, () => post<ProductDetail>(`/api/listings/${l.id}/check`), "Check queued. It runs when the store's turn comes.");
  const remove = useProductMutation(productId, () => del<ProductDetail>(`/api/listings/${l.id}`), "Listing deleted");
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Show the latest price; when the latest check didn't read one, fall back to the last one that did
  const shown: Observation | null = l.latest?.status === "ok" ? l.latest : l.lastOk;
  const stale = shown !== null && shown !== l.latest && shown.id !== l.latest?.id;

  return (
    <TableRow className={cn(!l.enabled && "opacity-60")}>
      <TableCell className="align-top whitespace-normal">
        <a href={l.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-medium hover:underline">
          {marketplaceLabel(l.marketplace)}
          <ExternalLink className="size-3 text-muted-foreground" aria-label="(opens the store page)" />
        </a>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>{conditionLabel(l.condition)}</span>
          <span className="font-mono">{l.externalId}</span>
          {!l.enabled && <Badge variant="outline">Disabled</Badge>}
        </div>
        {shown?.variantLabel && <div className="mt-0.5 text-xs text-muted-foreground">Version: {shown.variantLabel}</div>}
      </TableCell>

      <TableCell className="text-right align-top whitespace-normal">
        <PriceCell observation={shown} stale={stale} />
      </TableCell>

      <TableCell className="hidden max-w-[14rem] align-top text-xs whitespace-normal lg:table-cell">
        {shown?.seller && <div>Sold by {shown.seller}</div>}
        {shown?.shipsFrom && <div className="text-muted-foreground">Ships from {shown.shipsFrom}</div>}
        {!shown?.seller && !shown?.shipsFrom && <span className="text-muted-foreground">—</span>}
      </TableCell>

      <TableCell className="align-top whitespace-normal">
        {l.latest ? <StatusBadge status={l.latest.status} error={l.latest.error} /> : <Badge variant="outline">Not checked yet</Badge>}
        {l.latest?.status === "variant_mismatch" && (l.latest.variantLabel || l.latest.title) && (
          <div className="mt-1 max-w-[12rem] text-xs text-muted-foreground">Page showed: {l.latest.variantLabel ?? l.latest.title}</div>
        )}
        {l.latest?.status === "unavailable" && l.latest.availabilityText && (
          <div className="mt-1 max-w-[12rem] text-xs text-muted-foreground">{l.latest.availabilityText}</div>
        )}
        {l.latest?.status === "ok" && l.latest.inStock === false && (
          <div className="mt-1 text-xs text-muted-foreground">{l.latest.availabilityText ?? "Out of stock"}</div>
        )}
      </TableCell>

      <TableCell className="hidden align-top text-xs text-muted-foreground md:table-cell">
        <div>
          Last:{" "}
          <time dateTime={l.lastCheckedAt ?? undefined} title={formatDateTime(l.lastCheckedAt)}>
            {relativeTime(l.lastCheckedAt)}
          </time>
        </div>
        <div>
          Next:{" "}
          <time dateTime={l.nextCheckAt ?? undefined} title={formatDateTime(l.nextCheckAt)}>
            {l.enabled ? relativeTime(l.nextCheckAt) : "disabled"}
          </time>
        </div>
        <div>Every {formatInterval(l.intervalMinutes)}</div>
      </TableCell>

      <TableCell className="align-top">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${marketplaceLabel(l.marketplace)}`}>
              <MoreHorizontal aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={!l.enabled || check.isPending} onSelect={() => check.mutate(undefined)}>
              <RefreshCw aria-hidden /> Check now
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil aria-hidden /> Edit
            </DropdownMenuItem>
            {marketplaces.length > 1 && (
              <DropdownMenuItem disabled={untracked.length === 0} onSelect={onTrackMore}>
                <Store aria-hidden /> {untracked.length === 0 ? "Tracked in every store" : "Track in more stores…"}
              </DropdownMenuItem>
            )}
            {storeIn(catalog, l.store)?.custom && (
              <DropdownMenuItem onSelect={onRepick}>
                <Crosshair aria-hidden /> Pick the price element…
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
              <Trash2 aria-hidden /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title="Delete this listing?"
          description={`${marketplaceLabel(l.marketplace)} (${l.externalId}) and its price history will be deleted.`}
          onConfirm={() => remove.mutate(undefined)}
        />
      </TableCell>
    </TableRow>
  );
}

function PriceCell({ observation: o, stale }: { observation: Observation | null; stale: boolean }) {
  if (!o || o.headlinePrice == null) return <span className="text-muted-foreground">—</span>;
  const showBreakdown = o.shipping != null && o.price != null;
  return (
    <div className={cn(stale && "text-muted-foreground")}>
      <div className="font-semibold tabular-nums">
        {formatMoney(o.headlinePrice, o.currency)}
        {o.priceIncludesVat === false && <span className="ml-1 text-xs font-normal text-muted-foreground">excl. VAT</span>}
      </div>
      {o.priceIncludesVat === false && o.headlineEur != null ? (
        <div className="text-xs text-muted-foreground tabular-nums" title="Compared with other listings with the delivery country's standard VAT added (an estimate)">
          ≈ {formatEur(o.headlineEur)} with VAT
        </div>
      ) : (
        o.currency !== "EUR" &&
        o.headlineEur != null && <div className="text-xs text-muted-foreground tabular-nums">≈ {formatEur(o.headlineEur)}</div>
      )}
      {showBreakdown && (
        <div className="text-xs text-muted-foreground tabular-nums">
          {o.shipping === 0
            ? `${formatMoney(o.price, o.currency)}, free delivery`
            : `${formatMoney(o.price, o.currency)} + ${formatMoney(o.shipping, o.currency)} delivery`}
        </div>
      )}
      {o.deliveryLocation && (
        <div className="text-xs text-muted-foreground">
          {o.deliveryLocationSource === "ip"
            ? `Delivery to ${o.deliveryLocation}, based on the server's public IP`
            : o.deliveryLocationSource === "account"
              ? `Delivery to ${o.deliveryLocation} (your account's address)`
              : `Delivery to ${o.deliveryLocation}`}
        </div>
      )}
      {stale && (
        <div className="text-xs">
          Read <time dateTime={o.checkedAt} title={formatDateTime(o.checkedAt)}>{relativeTime(o.checkedAt)}</time>
        </div>
      )}
    </div>
  );
}
