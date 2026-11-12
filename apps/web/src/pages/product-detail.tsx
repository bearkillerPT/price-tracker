import { lazy, Suspense } from "react";
import { requestsPerHour, type ProductDetail } from "@price-tracker/shared";
import { ArrowLeft } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";

import { AddListingDialog } from "@/components/add-listing-dialog";
import { AlertRules } from "@/components/alert-rules";
import { ListingsTable } from "@/components/listings-table";
import { ProductActions } from "@/components/product-actions";
import { RequestRates } from "@/components/request-budget";
import { MarketplaceName } from "@/components/store-icon";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useProduct, useStores } from "@/hooks/queries";
import { conditionLabel, formatDateTime, formatEur, formatMoney, relativeTime } from "@/lib/format";

// recharts is most of the bundle's weight: load it with the chart, not with the app
const PriceHistoryChart = lazy(() => import("@/components/price-history-chart").then((m) => ({ default: m.PriceHistoryChart })));

export function ProductDetailPage() {
  const id = Number(useParams().id);
  const product = useProduct(id);

  if (!Number.isInteger(id)) return <p>Unknown product.</p>;
  if (product.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (product.isError) return <p className="text-destructive">Couldn't load the product: {product.error.message}</p>;

  return <ProductView product={product.data} />;
}

function ProductView({ product }: { product: ProductDetail }) {
  const navigate = useNavigate();
  const stores = useStores();
  const best = product.best;

  // The store groups this product's listings hit, and how many requests an hour its own enabled listings add
  const own: Record<string, number> = {};
  const groups = (stores.data ?? []).filter((g) => {
    const mine = product.listings.filter((l) => g.stores.includes(l.store));
    if (!mine.length) return false;
    own[g.group] = product.archived ? 0 : mine.filter((l) => l.enabled).reduce((sum, l) => sum + requestsPerHour(l.intervalMinutes), 0);
    return true;
  });

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" aria-hidden /> Products
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <h1 className="text-xl font-semibold">{product.name}</h1>
            <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
              {product.archived && <Badge variant="outline">Archived</Badge>}
              {product.ean && <span className="font-mono text-xs">EAN {product.ean}</span>}
              <span>Best price from {product.acceptedConditions.map(conditionLabel).join(", ").toLowerCase()} listings</span>
            </div>
            {product.notes && <p className="max-w-prose text-sm whitespace-pre-line text-muted-foreground">{product.notes}</p>}
          </div>
          <div className="flex items-start gap-3">
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Best price</div>
              {best ? (
                <>
                  <div className="text-2xl font-semibold tabular-nums">
                    {formatMoney(best.headlinePrice, best.currency)}
                    {best.priceIncludesVat === false && <span className="ml-1 text-sm font-normal text-muted-foreground">excl. VAT</span>}
                  </div>
                  {best.currency !== "EUR" && best.headlineEur != null && (
                    <div className="text-xs text-muted-foreground tabular-nums">≈ {formatEur(best.headlineEur)}</div>
                  )}
                  <div className="flex flex-wrap items-center justify-end gap-x-1 text-xs text-muted-foreground">
                    <MarketplaceName marketplace={best.marketplace} /> · {conditionLabel(best.condition)} ·{" "}
                    <time title={formatDateTime(best.checkedAt)}>{relativeTime(best.checkedAt)}</time>
                  </div>
                </>
              ) : (
                <div className="text-2xl text-muted-foreground">—</div>
              )}
            </div>
            <ProductActions product={product} variant="outline" onDeleted={() => navigate("/", { replace: true })} />
          </div>
        </div>
      </div>

      <section aria-labelledby="listings-heading" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="listings-heading" className="font-semibold">
              Listings
            </h2>
            <p className="text-sm text-muted-foreground">
              Prices include VAT for the delivery location shown, unless marked "excl. VAT" (Amazon Business). VAT can change at
              checkout depending on the address.
            </p>
          </div>
          <AddListingDialog product={product} />
        </div>
        <ListingsTable product={product} />
      </section>

      <RequestRates groups={groups} own={own} title="Requests from this product's listings" />

      <Separator />
      <Suspense fallback={<Skeleton className="h-72 w-full" />}>
        <PriceHistoryChart productId={product.id} />
      </Suspense>
      <Separator />
      <AlertRules product={product} />
    </div>
  );
}
