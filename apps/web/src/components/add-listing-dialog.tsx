import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CONDITIONS,
  CUSTOM_STORE_DEFAULTS,
  marketplacesOfStore,
  storeFamily,
  storeIn,
  type Catalog,
  type Condition,
  type Listing,
  type ListingCreate,
  type ParsedUrl,
  type ParseUrlResult,
  type ProductDetail,
  type SelectorTest,
  type StorePreview,
} from "@price-tracker/shared";
import { CircleCheck, CircleX, Crosshair, Plus, Store } from "lucide-react";

import { GuardFields } from "@/components/guard-fields";
import { IntervalField } from "@/components/interval-field";
import { PickPriceDialog, type Pick } from "@/components/live-browser";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { keys, useLabels, useProductMutation } from "@/hooks/queries";
import { ApiRequestError, errorMessage, post } from "@/lib/api";
import { conditionLabel, formatMoney } from "@/lib/format";

export function AddListingDialog({ product }: { product: ProductDetail }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus aria-hidden /> Add listing
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add listing</DialogTitle>
          <DialogDescription>
            Paste the product page's address. Amazon pages and shops you've added are recognised without fetching anything; for
            another shop you can load the page once to see if it can be tracked.
          </DialogDescription>
        </DialogHeader>
        {open && <AddListingForm product={product} onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}

/** Opened from a listing's menu: the same ASIN in the store's other marketplaces, with that listing's settings. */
export function TrackMoreStoresDialog({
  product,
  from,
  onOpenChange,
}: {
  product: ProductDetail;
  from: Listing | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { catalog, marketplaceLabel } = useLabels();
  return (
    <Dialog open={from !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Track in more stores</DialogTitle>
          <DialogDescription>
            The same {from ? (storeIn(catalog, from.store)?.externalIdLabel ?? "product") : "product"} in other stores, starting
            from the {from ? marketplaceLabel(from.marketplace) : ""} listing's settings. Nothing is fetched until the first check.
          </DialogDescription>
        </DialogHeader>
        {from && <AddListingForm product={product} from={from} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

/** The path and query of a page address: a custom store listing's external ID. */
const pageRef = (url: string) => {
  const u = new URL(url);
  return u.pathname + u.search;
};

function AddListingForm({ product, from, onDone }: { product: ProductDetail; from?: Listing; onDone: () => void }) {
  const qc = useQueryClient();
  const { catalog, marketplaceLabel } = useLabels();
  const [url, setUrl] = useState(from?.url ?? "");
  const [parsed, setParsed] = useState<ParsedUrl | null>(
    from ? { store: from.store, marketplace: from.marketplace, externalId: from.externalId, canonicalUrl: from.url } : null,
  );
  // A shop the app doesn't know yet, and what loading its page found
  const [unknown, setUnknown] = useState<{ host: string; url: string } | null>(null);
  const [preview, setPreview] = useState<StorePreview | null>(null);
  // A price element picked on the page, for shops without product data, and its test without a browser
  const [pickOpen, setPickOpen] = useState(false);
  const [pick, setPick] = useState<SelectorTest | null>(null);
  const [storeName, setStoreName] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  // The listing whose settings were copied: the one the dialog was opened from, or one tracking the pasted ASIN
  const [copiedFrom, setCopiedFrom] = useState<Listing | null>(from ?? null);
  const [marketplaces, setMarketplaces] = useState<string[]>([]);
  const [condition, setCondition] = useState<Condition>(from?.condition ?? "new");
  const [intervalMinutes, setIntervalMinutes] = useState(from?.intervalMinutes ?? 180);
  const [include, setInclude] = useState<string[]>(from?.guardInclude ?? []);
  const [exclude, setExclude] = useState<string[]>(from?.guardExclude ?? []);

  const resetFound = () => {
    setParsed(null);
    setUnknown(null);
    setPreview(null);
    setPick(null);
    setParseError(null);
  };

  const parse = useMutation({
    mutationFn: () => post<ParseUrlResult>("/api/listings/parse-url", { url }),
    onSuccess: (result) => {
      resetFound();
      if (result.kind === "unknown") {
        setUnknown({ host: result.host, url: result.url });
        return;
      }
      const store = storeIn(catalog, result.store);
      if (!store?.implemented) {
        setParseError(`${store?.label ?? result.store} isn't supported yet.`);
        return;
      }
      setParsed(result);
      // Already tracking this page somewhere? Start from that listing's settings, so the version-check terms
      // don't have to be typed again
      const same = product.listings.filter((l) => storeFamily(result.store).includes(l.store) && l.externalId === result.externalId);
      const source = same.find((l) => l.enabled) ?? same[0] ?? null;
      setMarketplaces(same.some((l) => l.marketplace === result.marketplace) ? [] : [result.marketplace]);
      if (source) {
        setCondition(source.condition);
        setIntervalMinutes(source.intervalMinutes);
        setInclude(source.guardInclude);
        setExclude(source.guardExclude);
      } else {
        if (copiedFrom) {
          // The previous address's copied settings don't belong to this product page
          setCondition("new");
          setInclude([]);
          setExclude([]);
        }
        setIntervalMinutes(store.defaultIntervalMinutes);
      }
      setCopiedFrom(source);
    },
    onError: (e) => {
      resetFound();
      setParseError(errorMessage(e));
    },
  });

  const loadPreview = useMutation({
    mutationFn: (pageUrl: string) => post<StorePreview>("/api/custom-stores/preview", { url: pageUrl }),
    onSuccess: (p) => {
      setPreview(p);
      setStoreName(p.suggestedLabel);
      setIntervalMinutes(CUSTOM_STORE_DEFAULTS.defaultIntervalMinutes);
      if (p.condition) setCondition(p.condition);
    },
    onError: (e) => setParseError(errorMessage(e)),
  });

  const testPick = useMutation({
    mutationFn: (p: Pick) => post<SelectorTest>("/api/custom-stores/test-selector", { url: preview!.url, selector: p.selector }),
    onSuccess: (result) => {
      setPick(result);
      setPickOpen(false);
    },
  });

  // One request per store (Amazon and Amazon Business listings of an ASIN can be added together)
  const create = useProductMutation(
    product.id,
    async (bodies: ListingCreate[]) => {
      let detail: ProductDetail | null = null;
      for (const body of bodies) detail = await post<ProductDetail>(`/api/products/${product.id}/listings`, body);
      return detail!;
    },
    "Listing added. Its first check is queued.",
  );

  // New shop: create the store, then the listing. The preview's request becomes the listing's first check.
  const createWithStore = useProductMutation(
    product.id,
    async (p: StorePreview) => {
      try {
        const updated = await post<Catalog>("/api/custom-stores", {
          host: p.host,
          label: storeName.trim() || p.suggestedLabel,
          currency: p.currency ?? pick?.currency ?? "EUR",
          priceSelector: pick?.selector ?? null,
          fetchMethod: pick?.fetchMethod ?? "http",
        });
        qc.setQueryData(keys.catalog, updated);
      } catch (e) {
        // Already created (e.g. a retry after the listing failed): carry on with the listing
        if (!(e instanceof ApiRequestError && e.status === 409)) throw e;
      }
      return post<ProductDetail>(`/api/products/${product.id}/listings`, {
        store: p.storeId,
        externalId: pageRef(p.url),
        marketplaces: [p.storeId],
        condition,
        intervalMinutes,
        guardInclude: include,
        guardExclude: exclude,
      } satisfies ListingCreate);
    },
    "Store and listing added. The page you loaded counts as its first check.",
  );

  // The stores this page's ID works in: Amazon and Amazon Business share ASINs
  const familyStores = parsed ? storeFamily(parsed.store).filter((s) => storeIn(catalog, s)?.implemented) : [];
  const groups = familyStores.map((store) => ({ store, info: storeIn(catalog, store)!, options: marketplacesOfStore(catalog, store) }));
  const existing = new Set(
    product.listings.filter((l) => parsed && familyStores.includes(l.store) && l.externalId === parsed.externalId).map((l) => l.marketplace),
  );
  const options = groups.flatMap((g) => g.options);
  const parsedStore = parsed ? storeIn(catalog, parsed.store) : undefined;
  // A previewed shop can be added when its product data has a price, or once its price element is picked
  const canAddStore = !!preview && (preview.trackable || (pick !== null && !pick.protection));
  // The store the listing settings are for: a known one, or the shop just previewed
  const settingsStore = parsed?.store ?? (canAddStore ? preview!.storeId : null);
  const pending = create.isPending || createWithStore.isPending;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (parsed && marketplaces.length > 0) {
      const bodies = groups
        .map((g) => ({ store: g.store, marketplaces: marketplaces.filter((id) => g.options.some((m) => m.id === id)) }))
        .filter((b) => b.marketplaces.length > 0)
        .map((b): ListingCreate => ({ ...b, externalId: parsed.externalId, condition, intervalMinutes, guardInclude: include, guardExclude: exclude }));
      create.mutate(bodies, { onSuccess: onDone });
    } else if (preview && canAddStore) {
      createWithStore.mutate(preview, { onSuccess: onDone });
    }
  };

  return (
    <form className="space-y-5" onSubmit={submit}>
      <div className="space-y-2">
        <Label htmlFor="listing-url">Product page address</Label>
        <div className="flex gap-2">
          <Input
            id="listing-url"
            type="url"
            inputMode="url"
            autoFocus
            placeholder="https://www.amazon.de/dp/B0FH6K3HVC"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              resetFound();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (url.trim()) parse.mutate();
              }
            }}
            aria-invalid={parseError ? true : undefined}
            aria-describedby={parseError ? "listing-url-error" : undefined}
          />
          <Button type="button" variant="secondary" disabled={!url.trim() || parse.isPending} onClick={() => parse.mutate()}>
            Read address
          </Button>
        </div>
        {parseError && (
          <p id="listing-url-error" role="alert" className="text-sm text-destructive">
            {parseError}
          </p>
        )}
        {parsed && parsedStore && (
          <p className="text-sm text-muted-foreground">
            {parsedStore.label} · {parsedStore.externalIdLabel}{" "}
            <span className="font-mono break-all text-foreground">{parsed.externalId}</span>
          </p>
        )}
        {parsed && copiedFrom && (
          <p className="text-xs text-muted-foreground">
            Condition, interval and version check copied from the {marketplaceLabel(copiedFrom.marketplace)} listing.
          </p>
        )}
      </div>

      {unknown && !preview && (
        <div className="space-y-3 rounded-md border p-4 text-sm">
          <p className="flex items-start gap-2">
            <Store className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span>
              <span className="font-medium">{unknown.host}</span> isn't set up yet. To add it as a store, the tracker loads this page
              once and looks for the product data shops publish for search engines (price, stock, name).
            </span>
          </p>
          <Button type="button" variant="secondary" disabled={loadPreview.isPending} onClick={() => loadPreview.mutate(unknown.url)}>
            {loadPreview.isPending ? "Loading the page…" : `Load the page (1 request to ${unknown.host})`}
          </Button>
        </div>
      )}

      {preview && !pick && <PreviewResult preview={preview} onPick={() => setPickOpen(true)} picking={testPick.isPending} />}
      {preview && pick && <PickResult test={pick} onPickAgain={() => setPickOpen(true)} />}
      {preview && (
        <PickPriceDialog
          url={preview.url}
          open={pickOpen}
          onOpenChange={(open) => {
            setPickOpen(open);
            if (!open) testPick.reset();
          }}
          onUse={(p) => testPick.mutate(p)}
          busy={testPick.isPending}
          useError={testPick.error ? errorMessage(testPick.error) : null}
        />
      )}

      {canAddStore && (
        <div className="space-y-2">
          <Label htmlFor="store-name">Store name</Label>
          <Input id="store-name" className="max-w-xs" value={storeName} onChange={(e) => setStoreName(e.target.value)} />
          <p className="text-xs text-muted-foreground">
            {preview!.storeId} becomes a store of its own, with its own request budget on the Stores page.
          </p>
        </div>
      )}

      {parsed && options.length > 1 && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Track it in</legend>
          {familyStores.includes("amazon") && (
            <p className="text-xs text-muted-foreground">
              On Amazon an ASIN usually means the same product in every EU store, so you can track it everywhere at once. Each store
              is one listing and one request per check.
            </p>
          )}
          {groups.map((g) => {
            const selectable = g.options.filter((m) => !existing.has(m.id));
            const allSelected = selectable.length > 0 && selectable.every((m) => marketplaces.includes(m.id));
            const setGroup = (on: boolean) =>
              setMarketplaces((prev) => [...prev.filter((id) => !g.options.some((m) => m.id === id)), ...(on ? selectable.map((m) => m.id) : [])]);
            return (
              <div key={g.store} className="space-y-2">
                {groups.length > 1 && <div className="pt-1 text-sm font-medium">{g.info.label}</div>}
                {g.info.requiresSignIn && (
                  <p className="text-xs text-muted-foreground">
                    Your {g.info.label} account's prices: checked only while you're signed in to that store (Stores page). Usually
                    without VAT; compared with other listings with VAT added.
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <Checkbox id={`mp-all-${g.store}`} checked={allSelected} disabled={selectable.length === 0} onCheckedChange={(v) => setGroup(v === true)} />
                  <Label htmlFor={`mp-all-${g.store}`}>{groups.length > 1 ? `All ${g.info.label} stores` : "All stores"}</Label>
                </div>
                <div className="grid grid-cols-1 gap-2 pl-1 sm:grid-cols-3">
                  {g.options.map((m) => {
                    const already = existing.has(m.id);
                    return (
                      <div key={m.id} className="flex items-center gap-2">
                        <Checkbox
                          id={`mp-${m.id}`}
                          disabled={already}
                          checked={already || marketplaces.includes(m.id)}
                          onCheckedChange={(v) => setMarketplaces((prev) => (v === true ? [...prev, m.id] : prev.filter((x) => x !== m.id)))}
                        />
                        <Label htmlFor={`mp-${m.id}`} className="font-normal">
                          {m.host.replace(/^www\./, "")}
                          {m.currency !== "EUR" && <span className="text-xs text-muted-foreground">({m.currency})</span>}
                          {already && <span className="text-xs text-muted-foreground">(added)</span>}
                        </Label>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </fieldset>
      )}
      {parsed && options.length === 1 && existing.size > 0 && (
        <p className="text-sm text-muted-foreground">This product already tracks that page.</p>
      )}

      {settingsStore && (
        <>
          <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
            <div className="space-y-2">
              <Label htmlFor="listing-condition">Condition</Label>
              <Select value={condition} onValueChange={(v) => setCondition(v as Condition)}>
                <SelectTrigger id="listing-condition" className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONDITIONS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {conditionLabel(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <IntervalField
              id="listing-interval"
              store={settingsStore}
              value={intervalMinutes}
              onChange={setIntervalMinutes}
              count={Math.max(1, marketplaces.length)}
              newStoreLabel={canAddStore ? storeName.trim() : undefined}
            />
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">
            Condition is what this page sells, for any store: you set it{preview?.condition ? " (filled in from what the page states)" : ""}. The
            product's accepted conditions decide which listings count toward its best price.
          </p>

          <GuardFields idPrefix="listing" include={include} exclude={exclude} onIncludeChange={setInclude} onExcludeChange={setExclude} />
        </>
      )}

      <DialogFooter>
        {canAddStore ? (
          <Button type="submit" disabled={pending}>
            Add store and listing
          </Button>
        ) : (
          <Button type="submit" disabled={!parsed || marketplaces.length === 0 || pending}>
            {marketplaces.length > 1 ? `Add ${marketplaces.length} listings` : "Add listing"}
          </Button>
        )}
      </DialogFooter>
    </form>
  );
}

function PreviewResult({ preview: p, onPick, picking }: { preview: StorePreview; onPick: () => void; picking: boolean }) {
  if (!p.trackable && p.pickable) {
    return (
      <div className="space-y-3 rounded-md border p-4 text-sm">
        <p className="flex items-start gap-2">
          <Crosshair className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>
            {p.dataSource === null
              ? `${p.host} doesn't publish standard product data on this page.`
              : "The page's product data has no price."}{" "}
            You can still track it by picking the price on the page: the tracker then reads that element on every check.
          </span>
        </p>
        <Button type="button" variant="secondary" disabled={picking} onClick={onPick}>
          {picking ? "Testing the picked price…" : "Pick the price on the page"}
        </Button>
      </div>
    );
  }
  if (p.protection) {
    return (
      <div role="alert" className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
        <p className="flex items-start gap-2">
          <CircleX className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <span>
            {p.host} answered with a {p.protection} instead of the page: it blocks automated checks (like PcComponentes). You can
            open it in the browser view to see whether the check lets you through there. Tracking it would also need checks to
            reuse that visit (saved browser sessions), which isn't built yet.
          </span>
        </p>
        <Button type="button" variant="outline" disabled={picking} onClick={onPick}>
          Open it in the browser view anyway
        </Button>
      </div>
    );
  }
  if (!p.trackable) {
    const reason = p.dataSource === null
        ? `No product data on this page. ${p.host} doesn't publish the standard product data the tracker reads, so it can't be tracked yet.`
        : (p.error ?? "The page couldn't be read.");
    return (
      <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
        <CircleX className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
        <span>{reason}</span>
      </div>
    );
  }
  return (
    <div className="space-y-1 rounded-md border border-success/40 bg-success/5 p-4 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <CircleCheck className="size-4 shrink-0 text-success" aria-hidden /> {p.host} can be tracked
      </p>
      <p>{p.title ?? "Untitled product"}</p>
      <p className="text-muted-foreground">
        {p.price !== null ? formatMoney(p.price, p.currency ?? "EUR") : "No price"} · {p.availabilityText ?? (p.inStock ? "In stock" : "Stock unknown")}
        {p.seller && ` · sold by ${p.seller}`}
        {p.gtin && ` · EAN ${p.gtin}`}
      </p>
      <p className="text-xs text-muted-foreground">
        Read from the page's {p.dataSource === "json-ld" ? "JSON-LD" : p.dataSource} product data. Check it's the product you want.
      </p>
      <Button type="button" variant="link" className="h-auto p-0 text-xs" disabled={picking} onClick={onPick}>
        Price not the one on the page? Pick the price on the page instead
      </Button>
    </div>
  );
}

function PickResult({ test, onPickAgain }: { test: SelectorTest; onPickAgain: () => void }) {
  if (test.protection) {
    return (
      <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
        <CircleX className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
        <span>
          The shop answered with a {test.protection} when loaded without a browser, so it can't be tracked yet: checks would have to
          reuse your visit in the browser view (saved browser sessions, not built yet).
        </span>
      </div>
    );
  }
  return (
    <div className="space-y-1 rounded-md border border-success/40 bg-success/5 p-4 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <CircleCheck className="size-4 shrink-0 text-success" aria-hidden /> Price element picked
      </p>
      {test.title && <p>{test.title}</p>}
      <p className="font-mono text-xs break-all text-muted-foreground">{test.selector}</p>
      {test.worksWithoutBrowser ? (
        <p className="text-muted-foreground">
          Found it in the page as loaded without a browser: {test.price !== null ? formatMoney(test.price, test.currency ?? "EUR") : ""}. Checks are
          one plain page load.
        </p>
      ) : (
        <p className="text-muted-foreground">
          The price is added by the page's scripts, so checks will load the page in the browser on the server. That's heavier
          (around 400 MB of memory while a check runs), so keep the interval long.
        </p>
      )}
      <Button type="button" variant="link" className="h-auto p-0" onClick={onPickAgain}>
        Pick again
      </Button>
    </div>
  );
}
