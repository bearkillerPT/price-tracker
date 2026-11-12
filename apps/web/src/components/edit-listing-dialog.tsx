import { useState, type FormEvent } from "react";
import { CONDITIONS, type Condition, type Listing, type ListingUpdate, type ProductDetail } from "@price-tracker/shared";

import { GuardFields } from "@/components/guard-fields";
import { IntervalField } from "@/components/interval-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useLabels, useProductMutation } from "@/hooks/queries";
import { patch, post } from "@/lib/api";
import { conditionLabel, relativeTime } from "@/lib/format";

const sameTerms = (a: string[], b: string[]) => a.length === b.length && a.every((t, i) => t === b[i]);

export function EditListingDialog({
  listing,
  open,
  onOpenChange,
}: {
  listing: Listing;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { marketplaceLabel } = useLabels();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit listing</DialogTitle>
          <DialogDescription>
            {marketplaceLabel(listing.marketplace)} · <span className="font-mono">{listing.externalId}</span>
          </DialogDescription>
        </DialogHeader>
        {open && <EditListingForm listing={listing} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function EditListingForm({ listing, onDone }: { listing: Listing; onDone: () => void }) {
  const [condition, setCondition] = useState<Condition>(listing.condition);
  const [intervalMinutes, setIntervalMinutes] = useState(listing.intervalMinutes);
  const [include, setInclude] = useState(listing.guardInclude);
  const [exclude, setExclude] = useState(listing.guardExclude);
  const [enabled, setEnabled] = useState(listing.enabled);

  // New version check terms only apply when the page is next read: say so, and offer to read it now
  const termsChanged = !sameTerms(include, listing.guardInclude) || !sameTerms(exclude, listing.guardExclude);
  const offerCheck = termsChanged && enabled;

  const save = useProductMutation(
    listing.productId,
    (body: ListingUpdate) => patch<ProductDetail>(`/api/listings/${listing.id}`, body),
    offerCheck ? "Listing saved. The new version check terms apply from its next check." : "Listing saved",
  );
  const saveAndCheck = useProductMutation(
    listing.productId,
    async (body: ListingUpdate) => {
      await patch<ProductDetail>(`/api/listings/${listing.id}`, body);
      return post<ProductDetail>(`/api/listings/${listing.id}/check`);
    },
    "Listing saved and its check queued. The result shows up here when the store's turn comes.",
  );
  const body = (): ListingUpdate => ({ condition, intervalMinutes, guardInclude: include, guardExclude: exclude, enabled });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(body(), { onSuccess: onDone });
  };

  // When paused, the listing adds nothing to the request rate; going from paused to enabled adds the full rate
  const previous = listing.enabled ? listing.intervalMinutes : undefined;

  return (
    <form className="space-y-5" onSubmit={submit}>
      <div className="flex items-center gap-3">
        <Switch id="edit-enabled" checked={enabled} onCheckedChange={setEnabled} />
        <Label htmlFor="edit-enabled">Check this listing</Label>
      </div>
      <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
        <div className="space-y-2">
          <Label htmlFor="edit-condition">Condition</Label>
          <Select value={condition} onValueChange={(v) => setCondition(v as Condition)}>
            <SelectTrigger id="edit-condition" className="w-40">
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
        {enabled ? (
          <IntervalField id="edit-interval" store={listing.store} value={intervalMinutes} onChange={setIntervalMinutes} previousMinutes={previous} />
        ) : (
          <p className="self-end text-sm text-muted-foreground">Paused listings aren't checked and add no requests.</p>
        )}
      </div>
      <GuardFields idPrefix="edit" include={include} exclude={exclude} onIncludeChange={setInclude} onExcludeChange={setExclude} />
      {offerCheck && (
        <p role="status" className="text-sm text-muted-foreground">
          The listing's latest result was read with the old terms. The new ones apply from its next check
          {listing.nextCheckAt ? ` (${relativeTime(listing.nextCheckAt)})` : ""}, or check now: one request to the store.
        </p>
      )}
      <DialogFooter>
        <Button type="submit" variant={offerCheck ? "outline" : "default"} disabled={save.isPending || saveAndCheck.isPending}>
          Save
        </Button>
        {offerCheck && (
          <Button type="button" disabled={save.isPending || saveAndCheck.isPending} onClick={() => saveAndCheck.mutate(body(), { onSuccess: onDone })}>
            Save and check now
          </Button>
        )}
      </DialogFooter>
    </form>
  );
}
