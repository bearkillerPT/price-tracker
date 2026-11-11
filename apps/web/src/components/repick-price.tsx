import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Catalog, Listing, ProductDetail, SelectorTest } from "@price-tracker/shared";
import { toast } from "sonner";

import { PickPriceDialog, type Pick } from "@/components/live-browser";
import { keys, useLabels } from "@/hooks/queries";
import { errorMessage, patch, post } from "@/lib/api";

/**
 * Picks a custom store's price element again on one of its listings' pages (e.g. after the shop changed its
 * layout), saves it for the whole store and queues a check of this listing.
 */
export function RepickPriceDialog({ listing, onClose }: { listing: Listing | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { storeLabel } = useLabels();
  const save = useMutation({
    mutationFn: async ({ listing: l, pick }: { listing: Listing; pick: Pick }) => {
      const test = await post<SelectorTest>("/api/custom-stores/test-selector", { url: l.url, selector: pick.selector });
      if (test.protection) throw new Error(`The shop answered with a ${test.protection}; the price element wasn't saved`);
      const catalog = await patch<Catalog>(`/api/custom-stores/${encodeURIComponent(l.store)}`, {
        priceSelector: test.selector,
        fetchMethod: test.fetchMethod,
      });
      qc.setQueryData(keys.catalog, catalog);
      const product = await post<ProductDetail>(`/api/listings/${l.id}/check`);
      return { test, product };
    },
    onSuccess: ({ test, product }, { listing: l }) => {
      qc.setQueryData(keys.product(l.productId), product);
      void qc.invalidateQueries({ queryKey: keys.stores });
      toast.success(
        `Price element saved for ${storeLabel(l.store)}${test.worksWithoutBrowser ? "" : "; its checks will load pages in the browser"}. A check is queued.`,
      );
      onClose();
    },
  });

  if (!listing) return null;
  return (
    <PickPriceDialog
      url={listing.url}
      open
      onOpenChange={(open) => !open && onClose()}
      onUse={(pick) => save.mutate({ listing, pick })}
      busy={save.isPending}
      useError={save.error ? errorMessage(save.error) : null}
    />
  );
}
