import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { storeIn, type SignInResult, type StoreSessionStatus } from "@price-tracker/shared";
import { LogIn, UserRound } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { SignInDialog } from "@/components/sign-in-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { keys, useLabels, useStoreSessions } from "@/hooks/queries";
import { del, errorMessage } from "@/lib/api";
import { formatDateTime, relativeTime } from "@/lib/format";

/** Sign-ins per Amazon store: Amazon keeps a separate session for each domain. */
export function StoreAccounts() {
  const sessions = useStoreSessions();
  const { catalog, marketplaceLabel, storeLabel } = useLabels();
  const qc = useQueryClient();
  const [signingIn, setSigningIn] = useState<StoreSessionStatus | null>(null);
  // Stores chosen to sign in to next, one after another; and how far along that run is
  const [queue, setQueue] = useState<StoreSessionStatus[]>([]);
  const [run, setRun] = useState<{ done: number; total: number } | null>(null);
  // After a sign-in on its own: ask about the other stores
  const [asking, setAsking] = useState<{ result: SignInResult; signedIn: StoreSessionStatus } | null>(null);

  const startRun = (stores: StoreSessionStatus[]) => {
    setAsking(null);
    if (!stores.length) return;
    setRun({ done: 0, total: stores.length });
    setQueue(stores.slice(1));
    setSigningIn(stores[0]!);
  };
  const stopRun = () => {
    setSigningIn(null);
    setQueue([]);
    setRun(null);
  };
  const onSaved = (result: SignInResult) => {
    const just = signingIn!;
    if (run) {
      // Next in the run, skipping stores Amazon signed you in to along the way
      const active = new Set(result.sessions.filter((s) => s.status === "active").map((s) => `${s.store}/${s.marketplace}`));
      const rest = queue.filter((s) => !active.has(`${s.store}/${s.marketplace}`));
      if (rest.length) {
        setRun({ done: run.total - rest.length, total: run.total });
        setQueue(rest.slice(1));
        setSigningIn(rest[0]!);
      } else {
        toast.success("Done: every store you picked is signed in");
        stopRun();
      }
      return;
    }
    setSigningIn(null);
    if (result.sessions.some((s) => s.status !== "active")) setAsking({ result, signedIn: just });
  };
  const [forgetting, setForgetting] = useState<StoreSessionStatus | null>(null);
  const forget = useMutation({
    mutationFn: (s: StoreSessionStatus) => del<StoreSessionStatus[]>(`/api/store-sessions/${encodeURIComponent(s.store)}/${encodeURIComponent(s.marketplace)}`),
    onSuccess: (data, s) => {
      qc.setQueryData(keys.storeSessions, data);
      toast.success(`${marketplaceLabel(s.marketplace)}: sign-in forgotten`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <section aria-labelledby="accounts-heading" className="space-y-3">
      <div>
        <h2 id="accounts-heading" className="font-semibold">
          Amazon accounts
        </h2>
        <p className="text-sm text-muted-foreground">
          Signed in, checks of that store see your account's prices (Prime) and delivery to your address. Amazon keeps a separate
          sign-in for each store, so sign in to the ones you track. Checking with your account means Amazon could flag it for
          automated use: keep intervals long. If a check finds you signed out, you get a notification and checks carry on without
          the account.
        </p>
      </div>
      {sessions.isPending ? (
        <Skeleton className="h-40" />
      ) : sessions.isError ? (
        <p className="text-sm text-destructive">Couldn't load the sign-ins: {sessions.error.message}</p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Store</TableHead>
                <TableHead>Sign-in</TableHead>
                <TableHead className="hidden md:table-cell">Listings</TableHead>
                <TableHead className="hidden sm:table-cell">Last used</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.data.map((s) => (
                <TableRow key={`${s.store}/${s.marketplace}`}>
                  <TableCell>
                    <div className="font-medium">{marketplaceLabel(s.marketplace)}</div>
                    {s.store !== "amazon" && <div className="text-xs text-muted-foreground">{storeLabel(s.store)}</div>}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {s.status === "active" && (
                      <span className="inline-flex items-center gap-1.5">
                        <UserRound className="size-3.5 text-success" aria-hidden />
                        Signed in{s.accountName ? ` as ${s.accountName}` : ""}
                        <span className="text-xs text-muted-foreground" title={formatDateTime(s.signedInAt)}>
                          {relativeTime(s.signedInAt)}
                        </span>
                      </span>
                    )}
                    {s.status === "expired" && (
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className="border-warning text-warning">
                          Signed out
                        </Badge>
                        <span className="text-xs text-muted-foreground">Amazon ended it {relativeTime(s.expiredAt)}</span>
                      </span>
                    )}
                    {s.status === "none" && <span className="text-muted-foreground">Not signed in</span>}
                    {s.status !== "active" && s.listingCount > 0 && storeIn(catalog, s.store)?.requiresSignIn && (
                      <Badge variant="outline" className="ml-2 border-warning text-warning" title="Its listings are only checked while you're signed in">
                        Needed
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-sm tabular-nums md:table-cell">
                    {s.listingCount > 0 ? s.listingCount : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                    <time dateTime={s.lastUsedAt ?? undefined} title={formatDateTime(s.lastUsedAt)}>
                      {relativeTime(s.lastUsedAt)}
                    </time>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant={s.status === "active" ? "ghost" : "outline"} onClick={() => {
                          stopRun();
                          setSigningIn(s);
                        }}
                      >
                        <LogIn aria-hidden /> {s.status === "none" ? "Sign in" : "Sign in again"}
                      </Button>
                      {s.status !== "none" && (
                        <Button size="sm" variant="ghost" onClick={() => setForgetting(s)}>
                          Forget
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {signingIn && (
        <SignInDialog
          key={`${signingIn.store}/${signingIn.marketplace}`}
          store={signingIn.store}
          marketplace={signingIn.marketplace}
          label={marketplaceLabel(signingIn.marketplace)}
          step={run ? `${run.done + 1} of ${run.total}` : undefined}
          onClose={stopRun}
          onSaved={onSaved}
        />
      )}
      {asking && (
        <MoreSignInsDialog
          result={asking.result}
          signedIn={asking.signedIn}
          onStart={startRun}
          onClose={() => setAsking(null)}
        />
      )}
      <ConfirmDialog
        open={forgetting !== null}
        onOpenChange={(open) => !open && setForgetting(null)}
        title={`Forget the ${forgetting ? marketplaceLabel(forgetting.marketplace) : ""} sign-in?`}
        description="Checks of that store go on without your account. You stay signed in at Amazon itself; sign out there (Your Account, Sign out of all devices) to end it everywhere."
        confirmLabel="Forget"
        onConfirm={() => forgetting && forget.mutate(forgetting)}
      />
    </section>
  );
}

/**
 * After a sign-in: "sign in to more stores?" The stores still not signed in, grouped by kind, with the
 * ones that have listings but need a sign-in (Amazon Business) ticked.
 */
function MoreSignInsDialog({
  result,
  signedIn,
  onStart,
  onClose,
}: {
  result: SignInResult;
  signedIn: StoreSessionStatus;
  onStart: (stores: StoreSessionStatus[]) => void;
  onClose: () => void;
}) {
  const { catalog, marketplaceLabel, storeLabel } = useLabels();
  const open = result.sessions.filter((s) => s.status !== "active");
  const needed = (s: StoreSessionStatus) => s.listingCount > 0 && !!storeIn(catalog, s.store)?.requiresSignIn;
  const id = (s: StoreSessionStatus) => `${s.store}/${s.marketplace}`;
  const [picked, setPicked] = useState(() => new Set(open.filter(needed).map(id)));
  // The kind just signed in to first
  const stores = [...new Set([signedIn.store, ...open.map((s) => s.store)])].filter((store) => open.some((s) => s.store === store));
  const toggle = (key: string, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  const chosen = open.filter((s) => picked.has(id(s)));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Sign in to more stores?</DialogTitle>
          <DialogDescription>
            Signed in to {marketplaceLabel(signedIn.marketplace)}
            {result.alsoSignedIn.length ? ` (and ${result.alsoSignedIn.map(marketplaceLabel).join(", ")})` : ""}. Amazon keeps a separate
            sign-in for each store: pick the ones to sign in to next, and they open one after another.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[50dvh] space-y-4 overflow-y-auto">
          {stores.map((store) => (
            <fieldset key={store} className="space-y-2">
              <legend className="text-sm font-medium">{storeLabel(store)}</legend>
              {open
                .filter((s) => s.store === store)
                .map((s) => (
                  <div key={id(s)} className="flex items-center gap-2">
                    <Checkbox id={`more-${id(s)}`} checked={picked.has(id(s))} onCheckedChange={(v) => toggle(id(s), v === true)} />
                    <Label htmlFor={`more-${id(s)}`} className="font-normal">
                      {marketplaceLabel(s.marketplace)}
                      {s.listingCount > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {s.listingCount} listing{s.listingCount === 1 ? "" : "s"}
                        </span>
                      )}
                      {needed(s) && (
                        <Badge variant="outline" className="border-warning text-warning">
                          Needed
                        </Badge>
                      )}
                      {s.status === "expired" && <span className="text-xs text-muted-foreground">(signed out)</span>}
                    </Label>
                  </div>
                ))}
            </fieldset>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Not now
          </Button>
          <Button disabled={!chosen.length} onClick={() => onStart(chosen)}>
            {chosen.length ? `Sign in to ${chosen.length} store${chosen.length === 1 ? "" : "s"}` : "Pick stores to sign in to"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
