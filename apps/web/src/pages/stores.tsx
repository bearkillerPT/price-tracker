import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  MIN_INTERVAL_MINUTES,
  marketplaceIn,
  storeIn,
  type FetchMethod,
  type Catalog,
  type CustomStoreUpdate,
  type ObservationStatus,
  type RateGroupStatus,
  type StoreInfo,
} from "@price-tracker/shared";
import { CirclePause, Pencil, Trash2, TriangleAlert } from "lucide-react";
import { useLocation } from "react-router";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { BudgetMeter, RiskLabel, isPaused } from "@/components/request-budget";
import { StatusBadge } from "@/components/status-badge";
import { StoreIcon } from "@/components/store-icon";
import { StoreAccounts } from "@/components/store-accounts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { keys, useCatalog, useStores } from "@/hooks/queries";
import { del, errorMessage, patch, post } from "@/lib/api";
import { INTERVAL_PRESETS, formatDateTime, formatInterval, formatRate, relativeTime } from "@/lib/format";

export function StoresPage() {
  const stores = useStores();
  const { hash } = useLocation();

  // Arriving from a store's request card (#store-<group>): show that store's card
  useEffect(() => {
    if (!hash || !stores.data) return;
    const card = document.getElementById(decodeURIComponent(hash.slice(1)));
    card?.scrollIntoView({ block: "center" });
    card?.focus({ preventScroll: true });
  }, [hash, stores.data]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Stores</h1>
      <Alert>
        <TriangleAlert aria-hidden className="text-warning" />
        <AlertTitle>Keep checks infrequent</AlertTitle>
        <AlertDescription>
          Stores don't want automated checks. Checking too often can get the server's IP blocked, or your account banned on
          stores you've signed in to. Stores in the same group share one budget, because they're the same company seeing the
          same IP. After a captcha or a block, the group pauses on its own for a while.
        </AlertDescription>
      </Alert>
      <p className="text-sm text-muted-foreground">
        To add a shop, paste one of its product links in <span className="font-medium text-foreground">Add listing</span> on a
        product. Shops that publish standard product data can be tracked; each gets its own card here.
      </p>

      {stores.isPending ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
      ) : stores.isError ? (
        <p className="text-destructive">Couldn't load the stores: {stores.error.message}</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {stores.data.map((g) => (
            <RateGroupCard key={g.group} group={g} />
          ))}
        </div>
      )}

      <StoreAccounts />
    </div>
  );
}

function RateGroupCard({ group: g }: { group: RateGroupStatus }) {
  const qc = useQueryClient();
  const catalog = useCatalog();
  const custom = g.custom ? storeIn(catalog, g.stores[0] ?? "") : undefined;
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const remove = useMutation({
    mutationFn: () => del<Catalog>(`/api/custom-stores/${encodeURIComponent(custom!.id)}`),
    onSuccess: (data) => {
      qc.setQueryData(keys.catalog, data);
      void qc.invalidateQueries({ queryKey: keys.stores });
      toast.success(`${g.label} removed`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const resume = useMutation({
    mutationFn: () => post<RateGroupStatus[]>(`/api/stores/${g.group}/resume`),
    onSuccess: (data) => {
      qc.setQueryData(keys.stores, data);
      toast.success(`${g.label}: checks resumed`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const paused = isPaused(g);
  const statuses = Object.entries(g.actualLastHour.byStatus).filter(([, n]) => (n ?? 0) > 0) as [ObservationStatus, number][];

  return (
    <Card id={`store-${g.group}`} tabIndex={-1} className="scroll-mt-20 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <StoreIcon store={g.stores[0] ?? g.group} label={g.label} className="size-5" />
          {g.label}
        </CardTitle>
        <CardDescription>
          {custom
            ? `${marketplaceIn(catalog, custom.id)?.host ?? custom.id} · checked every ${formatInterval(custom.defaultIntervalMinutes)} by default`
            : g.stores.map((s) => storeIn(catalog, s)?.label ?? s).join(", ")}{" "}
          · {g.enabledListings} enabled {g.enabledListings === 1 ? "listing" : "listings"}
        </CardDescription>
        {custom && (
          <CardAction className="flex gap-1">
            <Button variant="ghost" size="icon-sm" aria-label={`Edit ${g.label}`} onClick={() => setEditing(true)}>
              <Pencil aria-hidden />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label={`Remove ${g.label}`} onClick={() => setConfirmDelete(true)}>
              <Trash2 aria-hidden />
            </Button>
          </CardAction>
        )}
      </CardHeader>
      {custom && editing && <EditStoreDialog store={custom} open onOpenChange={setEditing} />}
      {custom && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={`Remove ${g.label}?`}
          description="Only stores without listings can be removed. Delete its listings first; their price history goes with them."
          confirmLabel="Remove"
          onConfirm={() => remove.mutate()}
        />
      )}
      <CardContent className="space-y-5">
        {paused && (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <CirclePause className="size-4 text-destructive" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="font-medium">
                Paused until <time title={formatDateTime(g.pausedUntil)}>{formatDateTime(g.pausedUntil)}</time> (
                {relativeTime(g.pausedUntil)})
              </div>
              {g.pauseReason && <div className="text-muted-foreground">{g.pauseReason}</div>}
            </div>
            <Button size="sm" variant="outline" onClick={() => resume.mutate()} disabled={resume.isPending}>
              Resume now
            </Button>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm">Planned</span>
            <span className="text-sm font-semibold tabular-nums">{formatRate(g.plannedPerHour)} requests/hour</span>
          </div>
          <BudgetMeter group={g} />
          <p className="text-xs text-muted-foreground">
            <RiskLabel level={g.level} className="mr-1 font-medium" /> Warning above {g.warnPerHour}/hour, strong warning above{" "}
            {g.dangerPerHour}/hour. It's what every enabled listing's check interval adds up to: a listing checked every 3 hours
            adds a third of a request per hour.
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm">Last hour</span>
            <span className="text-sm font-semibold tabular-nums">
              {g.actualLastHour.total} {g.actualLastHour.total === 1 ? "request" : "requests"}
            </span>
          </div>
          {statuses.length > 0 ? (
            <ul className="flex flex-wrap gap-2" aria-label="Requests in the last hour by result">
              {statuses.map(([status, n]) => (
                <li key={status} className="flex items-center gap-1 text-sm tabular-nums">
                  <StatusBadge status={status} /> {n}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">No requests in the last hour.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function EditStoreDialog({ store, open, onOpenChange }: { store: StoreInfo; open: boolean; onOpenChange: (open: boolean) => void }) {
  const qc = useQueryClient();
  const catalog = useCatalog();
  const marketplace = marketplaceIn(catalog, store.id);
  const [label, setLabel] = useState(store.label);
  const [intervalMinutes, setIntervalMinutes] = useState(store.defaultIntervalMinutes);
  const [selector, setSelector] = useState(marketplace?.priceSelector ?? "");
  const [fetchMethod, setFetchMethod] = useState<FetchMethod>(marketplace?.fetchMethod ?? "http");
  const save = useMutation({
    mutationFn: (body: CustomStoreUpdate) => patch<Catalog>(`/api/custom-stores/${encodeURIComponent(store.id)}`, body),
    onSuccess: (data) => {
      qc.setQueryData(keys.catalog, data);
      void qc.invalidateQueries({ queryKey: keys.stores });
      void qc.invalidateQueries({ queryKey: keys.products });
      toast.success("Store saved");
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({ label: label.trim(), defaultIntervalMinutes: intervalMinutes, priceSelector: selector.trim() || null, fetchMethod });
  };
  const options = [...new Set([...INTERVAL_PRESETS, intervalMinutes])].filter((m) => m >= MIN_INTERVAL_MINUTES).sort((a, b) => a - b);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit store</DialogTitle>
          <DialogDescription>{store.id}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="store-label">Name</Label>
            <Input id="store-label" value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={100} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="store-interval">Default check interval</Label>
            <Select value={String(intervalMinutes)} onValueChange={(v) => setIntervalMinutes(Number(v))}>
              <SelectTrigger id="store-interval" className="w-40">
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
            <p className="text-xs text-muted-foreground">For new listings. Existing listings keep their own interval.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="store-selector">Price element</Label>
            <Input
              id="store-selector"
              className="font-mono text-xs"
              placeholder="From the page's product data"
              value={selector}
              onChange={(e) => setSelector(e.target.value)}
              maxLength={1000}
            />
            <p className="text-xs text-muted-foreground">
              A CSS selector, usually picked on a product page ("Pick the price element…" in a listing's menu). Empty: read the
              page's product data.
            </p>
          </div>
          <div className="flex items-start gap-2">
            <Checkbox
              id="store-browser"
              checked={fetchMethod === "browser"}
              onCheckedChange={(v) => setFetchMethod(v === true ? "browser" : "http")}
            />
            <div className="grid gap-1">
              <Label htmlFor="store-browser">Load pages in the browser</Label>
              <p className="text-xs text-muted-foreground">
                For shops whose prices are added by the page's scripts. Heavier on the server than a plain page load.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={save.isPending || !label.trim()}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
