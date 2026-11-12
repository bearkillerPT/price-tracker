import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ProductCreate, ProductDetail, ProductSummary } from "@price-tracker/shared";
import { Plus, TriangleAlert } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

import { ProductActions } from "@/components/product-actions";
import { ProductFormDialog } from "@/components/product-form-dialog";
import { RequestRates } from "@/components/request-budget";
import { MarketplaceName } from "@/components/store-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { keys, useLabels, useProducts, useStores } from "@/hooks/queries";
import { errorMessage, post } from "@/lib/api";
import { conditionLabel, formatDateTime, formatEur, formatMoney, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export function ProductsPage() {
  const products = useProducts();
  const stores = useStores();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);

  const create = useMutation({
    mutationFn: (body: ProductCreate) => post<ProductDetail>("/api/products", body),
    onSuccess: (detail) => {
      qc.setQueryData(keys.product(detail.id), detail);
      void qc.invalidateQueries({ queryKey: keys.products });
      setAdding(false);
      navigate(`/products/${detail.id}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  // The stores the enabled listings hit (or that are paused): how often, and how risky that is
  const active = (stores.data ?? []).filter((g) => g.enabledListings > 0 || g.pausedUntil !== null);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Products</h1>
        <ProductFormDialog
          open={adding}
          onOpenChange={setAdding}
          title="Add product"
          submitLabel="Add product"
          pending={create.isPending}
          onSubmit={(values) => create.mutateAsync(values)}
          trigger={
            <Button size="sm">
              <Plus aria-hidden /> Add product
            </Button>
          }
        />
      </div>

      {products.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : products.isError ? (
        <p className="text-destructive">Couldn't load products: {products.error.message}</p>
      ) : products.data.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="font-medium">No products yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add the thing you want to buy, then the store pages that sell it.
          </p>
        </div>
      ) : (
        <ProductTable products={products.data} />
      )}

      <RequestRates groups={active} />
    </div>
  );
}

function ProductTable({ products }: { products: ProductSummary[] }) {
  const { marketplaceLabel } = useLabels();
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Product</TableHead>
            <TableHead className="text-right">Best price</TableHead>
            <TableHead className="hidden md:table-cell">Where</TableHead>
            <TableHead className="hidden sm:table-cell">Last checked</TableHead>
            <TableHead className="w-10">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((p) => (
            <TableRow key={p.id} className={cn(p.archived && "opacity-60")}>
              <TableCell className="max-w-[16rem] whitespace-normal">
                <Link to={`/products/${p.id}`} className="font-medium hover:underline">
                  {p.name}
                </Link>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">
                    {p.listingCount} {p.listingCount === 1 ? "listing" : "listings"}
                  </span>
                  {p.archived && <Badge variant="outline">Archived</Badge>}
                  {p.issueCount > 0 && (
                    <Badge variant="outline" className="border-warning/50 bg-warning/10 text-warning">
                      <TriangleAlert aria-hidden />
                      {p.issueCount} {p.issueCount === 1 ? "issue" : "issues"}
                    </Badge>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-right align-top">
                {p.best ? (
                  <>
                    <div className="font-semibold tabular-nums">
                      {formatMoney(p.best.headlinePrice, p.best.currency)}
                      {p.best.priceIncludesVat === false && <span className="ml-1 text-xs font-normal text-muted-foreground">excl. VAT</span>}
                    </div>
                    {p.best.currency !== "EUR" && p.best.headlineEur != null && (
                      <div className="text-xs text-muted-foreground tabular-nums">≈ {formatEur(p.best.headlineEur)}</div>
                    )}
                    <div className="text-xs text-muted-foreground md:hidden">{marketplaceLabel(p.best.marketplace)}</div>
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="hidden align-top md:table-cell">
                {p.best ? (
                  <>
                    <MarketplaceName marketplace={p.best.marketplace} />
                    <div className="pl-[22px] text-xs text-muted-foreground">{conditionLabel(p.best.condition)}</div>
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="hidden align-top text-muted-foreground sm:table-cell">
                <time dateTime={p.lastCheckedAt ?? undefined} title={formatDateTime(p.lastCheckedAt)}>
                  {relativeTime(p.lastCheckedAt)}
                </time>
              </TableCell>
              <TableCell className="align-top">
                <ProductActions product={p} showOpen />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
