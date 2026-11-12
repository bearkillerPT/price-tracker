// A product's listings, one block per store (Amazon, Amazon Business, each shop) and one compact row per
// marketplace. What a store's rows have in common (ID, version, seller, delivery) is said once, in the block's
// header; each row opens to show everything about its last check.
import { Fragment, useState, type ReactNode } from "react";
import { marketplaceIn, marketplacesOfStore, storeFamily, storeIn, type Listing, type Observation, type ProductDetail } from "@price-tracker/shared";
import { ChevronDown, Crosshair, ExternalLink, LoaderCircle, MoreHorizontal, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";

import { TrackMoreStoresDialog } from "@/components/add-listing-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EditListingDialog } from "@/components/edit-listing-dialog";
import { RepickPriceDialog } from "@/components/repick-price";
import { StatusBadge } from "@/components/status-badge";
import { StoreIcon } from "@/components/store-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { checkPending, useLabels, useProductMutation } from "@/hooks/queries";
import { del, post } from "@/lib/api";
import { conditionLabel, formatDateTime, formatEur, formatInterval, formatMoney, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const COLUMNS = 5;

/** The latest check that read a price: the latest one, or the last that did when the latest didn't. */
const shownOf = (l: Listing): Observation | null => (l.latest?.status === "ok" ? l.latest : l.lastOk);

/** The value every item has, or undefined when they differ (or there are none). */
function shared<T>(values: T[]): T | undefined {
  return values.length > 0 && values.every((v) => v === values[0]) ? values[0] : undefined;
}

function deliveryText(o: Pick<Observation, "deliveryLocation" | "deliveryLocationSource">): string | null {
  if (!o.deliveryLocation) return null;
  if (o.deliveryLocationSource === "ip") return `Delivery to ${o.deliveryLocation} (from the server's IP)`;
  if (o.deliveryLocationSource === "account") return `Delivery to ${o.deliveryLocation} (your account's address)`;
  return `Delivery to ${o.deliveryLocation}`;
}

export function ListingsTable({ product }: { product: ProductDetail }) {
  const { catalog } = useLabels();
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

  // Built-in stores first, in catalog order (Amazon, Amazon Business), then shops by name
  const order = (store: string) => {
    const i = catalog.stores.findIndex((s) => s.id === store);
    return storeIn(catalog, store)?.custom ? 1000 : i;
  };
  const stores = [...new Set(product.listings.map((l) => l.store))].sort(
    (a, b) => order(a) - order(b) || (storeIn(catalog, a)?.label ?? a).localeCompare(storeIn(catalog, b)?.label ?? b),
  );

  return (
    <>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Store</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="hidden sm:table-cell">Status</TableHead>
              <TableHead className="hidden md:table-cell">Checked</TableHead>
              <TableHead className="w-20">
                <span className="sr-only">Details and actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          {stores.map((store) => (
            <StoreGroup
              key={store}
              store={store}
              listings={product.listings.filter((l) => l.store === store)}
              product={product}
              onEdit={setEditing}
              onTrackMore={setTrackingMore}
              onRepick={setRepicking}
            />
          ))}
        </Table>
      </div>
      {editing && <EditListingDialog listing={editing} open onOpenChange={(open) => !open && setEditing(null)} />}
      <TrackMoreStoresDialog product={product} from={trackingMore} onOpenChange={(open) => !open && setTrackingMore(null)} />
      <RepickPriceDialog listing={repicking} onClose={() => setRepicking(null)} />
    </>
  );
}

interface RowHandlers {
  onEdit: (l: Listing) => void;
  onTrackMore: (l: Listing) => void;
  onRepick: (l: Listing) => void;
}

function StoreGroup({ store, listings, product, ...handlers }: { store: string; listings: Listing[]; product: ProductDetail } & RowHandlers) {
  const { catalog, storeLabel } = useLabels();
  const label = storeLabel(store);
  const shown = listings.map(shownOf).filter((o): o is Observation => o !== null);

  // What the store's rows share, said once here (rows of one shop are usually one listing anyway)
  const facts = [
    shared(listings.map((l) => l.externalId)),
    shared(listings.map((l) => conditionLabel(l.condition))),
    shared(shown.map((o) => o.variantLabel)) && `Version: ${shared(shown.map((o) => o.variantLabel))}`,
    shared(shown.map((o) => o.seller)) &&
      `Sold by ${shared(shown.map((o) => o.seller))}${shared(shown.map((o) => o.shipsFrom)) ? `, ships from ${shared(shown.map((o) => o.shipsFrom))}` : ""}`,
    shared(shown.map((o) => deliveryText(o))),
  ].filter((f): f is string => !!f);

  // Amazon's stores can track the same ASIN in more countries
  const family = storeFamily(store).filter((s) => storeIn(catalog, s)?.implemented);
  const first = listings[0]!;
  const untracked = family
    .flatMap((s) => marketplacesOfStore(catalog, s))
    .filter((m) => !product.listings.some((x) => family.includes(x.store) && x.externalId === first.externalId && x.marketplace === m.id));

  return (
    <TableBody className="border-t-4 border-background first-of-type:border-t-0">
      <TableRow className="bg-muted/40 hover:bg-muted/40">
        <th scope="rowgroup" colSpan={COLUMNS} className="px-2 py-2 text-left font-normal">
          {/* Name and button on one line; on narrow screens the shared facts take their own line below */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-2 font-medium">
              <StoreIcon store={store} label={label} className="size-5" />
              {label}
            </span>
            {facts.length > 0 && (
              <span className="order-last basis-full text-xs text-muted-foreground md:order-none md:min-w-0 md:flex-1 md:basis-0">{facts.join(" · ")}</span>
            )}
            {family.length > 0 && untracked.length > 0 && marketplacesOfStore(catalog, store).length > 1 && (
              <Button variant="ghost" size="xs" className="ml-auto" onClick={() => handlers.onTrackMore(first)}>
                <Plus aria-hidden /> More stores
              </Button>
            )}
          </div>
        </th>
      </TableRow>
      {listings.map((l) => (
        <ListingRow key={l.id} listing={l} product={product} storeLabel={label} best={product.best?.listingId === l.id} {...handlers} />
      ))}
    </TableBody>
  );
}

function ListingRow({
  listing: l,
  product,
  storeLabel,
  best,
  onEdit,
  onRepick,
}: { listing: Listing; product: ProductDetail; storeLabel: string; best: boolean } & RowHandlers) {
  const { catalog, marketplaceLabel } = useLabels();
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const check = useProductMutation(
    product.id,
    () => post<ProductDetail>(`/api/listings/${l.id}/check`),
    "Check queued. Its result shows up here when the store's turn comes, usually within a minute.",
  );
  const remove = useProductMutation(product.id, () => del<ProductDetail>(`/api/listings/${l.id}`), "Listing deleted");
  const pending = checkPending(l);
  const shown = shownOf(l);
  const stale = shown !== null && shown.id !== l.latest?.id;

  const full = marketplaceLabel(l.marketplace);
  const host = marketplaceIn(catalog, l.marketplace)?.host ?? null;
  // Under its store's header, "Amazon Business Germany" is just "Germany", and a shop's one page is its domain
  const name = full.startsWith(`${storeLabel} `) ? full.slice(storeLabel.length + 1) : full === storeLabel && host ? host.replace(/^www\./, "") : full;
  const detailsId = `listing-${l.id}-details`;

  return (
    <Fragment>
      <TableRow className={cn(!l.enabled && "opacity-60")}>
        <TableCell className="align-top whitespace-normal">
          <a href={l.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-medium hover:underline">
            {name}
            <ExternalLink className="size-3 shrink-0 text-muted-foreground" aria-label="(opens the store page)" />
          </a>
          <div className="mt-0.5 flex flex-wrap gap-1">
            {best && <Badge className="border-success/40 bg-success/10 text-success" variant="outline">Lowest</Badge>}
            {!l.enabled && <Badge variant="outline">Paused</Badge>}
            {/* Narrow screens: the status sits here instead of in its own column */}
            <span className="sm:hidden">{l.latest ? <StatusBadge status={l.latest.status} error={l.latest.error} /> : <Badge variant="outline">Not checked yet</Badge>}</span>
          </div>
          <div className="sm:hidden">
            <StatusHint listing={l} />
          </div>
        </TableCell>
        <TableCell className="text-right align-top whitespace-normal">
          <PriceSummary observation={shown} stale={stale} />
        </TableCell>
        <TableCell className="hidden align-top whitespace-normal sm:table-cell">
          {l.latest ? <StatusBadge status={l.latest.status} error={l.latest.error} /> : <Badge variant="outline">Not checked yet</Badge>}
          <StatusHint listing={l} />
        </TableCell>
        <TableCell className="hidden align-top text-xs text-muted-foreground md:table-cell">
          {pending ? (
            <span className="inline-flex items-center gap-1">
              <LoaderCircle className="size-3 animate-spin" aria-hidden /> queued
            </span>
          ) : (
            <time dateTime={l.lastCheckedAt ?? undefined} title={formatDateTime(l.lastCheckedAt)}>
              {relativeTime(l.lastCheckedAt)}
            </time>
          )}
        </TableCell>
        <TableCell className="align-top">
          <div className="flex justify-end gap-0.5">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-expanded={open}
              aria-controls={detailsId}
              aria-label={`${open ? "Hide" : "Show"} details of ${full}`}
              onClick={() => setOpen((v) => !v)}
            >
              <ChevronDown className={cn("transition-transform", open && "rotate-180")} aria-hidden />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${full}`}>
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={!l.enabled || check.isPending || pending} onSelect={() => check.mutate(undefined)}>
                  <RefreshCw aria-hidden /> {pending ? "Check queued" : "Check now"}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onEdit(l)}>
                  <Pencil aria-hidden /> Edit
                </DropdownMenuItem>
                {storeIn(catalog, l.store)?.custom && (
                  <DropdownMenuItem onSelect={() => onRepick(l)}>
                    <Crosshair aria-hidden /> Pick the price element…
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                  <Trash2 aria-hidden /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <ConfirmDialog
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            title="Delete this listing?"
            description={`${full} (${l.externalId}) and its price history will be deleted.`}
            onConfirm={() => remove.mutate(undefined)}
          />
        </TableCell>
      </TableRow>
      {open && (
        <TableRow id={detailsId} className="bg-muted/20 hover:bg-muted/20">
          <TableCell colSpan={COLUMNS} className="whitespace-normal">
            <ListingDetails listing={l} shown={shown} host={host} />
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  );
}

/** The price and one line of what it's made of. */
function PriceSummary({ observation: o, stale }: { observation: Observation | null; stale: boolean }) {
  if (!o || o.headlinePrice == null) return <span className="text-muted-foreground">—</span>;
  const delivery =
    o.shipping == null || o.price == null ? null : o.shipping === 0 ? "free delivery" : `${formatMoney(o.price, o.currency)} + ${formatMoney(o.shipping, o.currency)}`;
  const lines = [
    delivery,
    o.priceIncludesVat === false && o.priceInclVat != null ? `${formatMoney(o.priceInclVat, o.currency)} incl. VAT` : null,
    o.currency !== "EUR" && o.headlineEur != null ? `≈ ${formatEur(o.headlineEur)}` : null,
  ].filter((line): line is string => !!line);
  return (
    <div className={cn(stale && "text-muted-foreground")} title={stale ? `Read ${relativeTime(o.checkedAt)}: the latest check didn't read a price` : undefined}>
      <div className="font-semibold whitespace-nowrap tabular-nums">
        {formatMoney(o.headlinePrice, o.currency)}
        {o.priceIncludesVat === false && <span className="ml-1 text-xs font-normal text-muted-foreground">excl. VAT</span>}
      </div>
      {lines.map((line) => (
        <div key={line} className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
          {line}
        </div>
      ))}
      {stale && <span className="sr-only">Read {relativeTime(o.checkedAt)}; the latest check didn't read a price.</span>}
    </div>
  );
}

/** One short line under the status, when there's something to say. */
function StatusHint({ listing: l }: { listing: Listing }) {
  const o = l.latest;
  const text =
    o?.status === "variant_mismatch"
      ? (o.error?.replace(/^Not the expected version: /, "Version check: ") ?? null)
      : o?.status === "unavailable" || (o?.status === "ok" && o.inStock === false)
        ? (o.availabilityText ?? "Out of stock")
        : null;
  return text ? <div className="mt-1 line-clamp-2 max-w-[16rem] text-xs text-muted-foreground">{text}</div> : null;
}

function ListingDetails({ listing: l, shown: o, host }: { listing: Listing; shown: Observation | null; host: string | null }) {
  const rows: [string, ReactNode][] = [];
  if (o?.price != null) {
    const vat = o.priceIncludesVat === false ? " excl. VAT" : o.priceIncludesVat === true ? " incl. VAT" : "";
    rows.push([
      "Price",
      [
        `${formatMoney(o.price, o.currency)}${vat}`,
        o.shipping != null && (o.shipping === 0 ? "free delivery" : `${formatMoney(o.shipping, o.currency)} delivery`),
        o.priceInclVat != null && `${formatMoney(o.priceInclVat, o.currency)} incl. VAT`,
      ]
        .filter(Boolean)
        .join(" · "),
    ]);
  }
  if (o && deliveryText(o)) rows.push(["Delivery", deliveryText(o)]);
  if (o?.deliveryText) rows.push(["Arrives", o.deliveryText]);
  if (o?.seller || o?.shipsFrom) rows.push(["Seller", [o.seller && `Sold by ${o.seller}`, o.shipsFrom && `ships from ${o.shipsFrom}`].filter(Boolean).join(", ")]);
  if (o?.variantLabel) rows.push(["Version", o.variantLabel]);
  rows.push(["Listing", `${conditionLabel(l.condition)} · ${l.externalId}${host ? ` on ${host}` : ""}`]);
  if (l.latest?.error) rows.push(["Last check", l.latest.error]);
  else if (l.latest?.availabilityText) rows.push(["Stock", l.latest.availabilityText]);
  rows.push([
    "Checks",
    <>
      Every {formatInterval(l.intervalMinutes)} · last <time title={formatDateTime(l.lastCheckedAt)}>{relativeTime(l.lastCheckedAt)}</time>
      {l.enabled ? (
        <>
          {" "}
          · next <time title={formatDateTime(l.nextCheckAt)}>{relativeTime(l.nextCheckAt)}</time>
        </>
      ) : (
        " · paused"
      )}
    </>,
  ]);
  if (o && o.id !== l.latest?.id) rows.push(["Price read", <time title={formatDateTime(o.checkedAt)}>{relativeTime(o.checkedAt)}</time>]);

  return (
    <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-[max-content_1fr]">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-muted-foreground">{term}</dt>
          <dd className="break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
