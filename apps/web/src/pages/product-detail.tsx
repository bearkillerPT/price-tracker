import { lazy, Suspense, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ProductCreate, ProductDetail, ProductUpdate } from "@price-tracker/shared";
import { Archive, ArchiveRestore, ArrowLeft, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";

import { AddListingDialog } from "@/components/add-listing-dialog";
import { AlertRules } from "@/components/alert-rules";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ListingsTable } from "@/components/listings-table";
import { ProductFormDialog } from "@/components/product-form-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { keys, useLabels, useProduct, useProductMutation } from "@/hooks/queries";
import { del, errorMessage, patch } from "@/lib/api";
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
  const { marketplaceLabel } = useLabels();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const update = useProductMutation(product.id, (body: ProductUpdate) => patch<ProductDetail>(`/api/products/${product.id}`, body));
  const remove = useMutation({
    mutationFn: () => del<{ ok: true }>(`/api/products/${product.id}`),
    onSuccess: () => {
      qc.removeQueries({ queryKey: keys.product(product.id) });
      void qc.invalidateQueries({ queryKey: keys.products });
      void qc.invalidateQueries({ queryKey: keys.stores });
      toast.success("Product deleted");
      navigate("/", { replace: true });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const best = product.best;

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
              <span>Counts: {product.acceptedConditions.map(conditionLabel).join(", ")}</span>
            </div>
            {product.notes && <p className="max-w-prose text-sm whitespace-pre-line text-muted-foreground">{product.notes}</p>}
          </div>
          <div className="flex items-start gap-3">
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Best price</div>
              {best ? (
                <>
                  <div className="text-2xl font-semibold tabular-nums">{formatMoney(best.headlinePrice, best.currency)}</div>
                  {best.currency !== "EUR" && best.headlineEur != null && (
                    <div className="text-xs text-muted-foreground tabular-nums">≈ {formatEur(best.headlineEur)}</div>
                  )}
                  <div className="text-xs text-muted-foreground">
                    {marketplaceLabel(best.marketplace)} · {conditionLabel(best.condition)} ·{" "}
                    <time title={formatDateTime(best.checkedAt)}>{relativeTime(best.checkedAt)}</time>
                  </div>
                </>
              ) : (
                <div className="text-2xl text-muted-foreground">—</div>
              )}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon-sm" aria-label="Product actions">
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setEditing(true)}>
                  <Pencil aria-hidden /> Edit
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => update.mutate({ archived: !product.archived })}>
                  {product.archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
                  {product.archived ? "Unarchive" : "Archive"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                  <Trash2 aria-hidden /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
              Prices include the VAT for the delivery location shown. VAT can change at checkout depending on the address.
            </p>
          </div>
          <AddListingDialog product={product} />
        </div>
        <ListingsTable product={product} />
      </section>

      <Separator />
      <Suspense fallback={<Skeleton className="h-72 w-full" />}>
        <PriceHistoryChart productId={product.id} />
      </Suspense>
      <Separator />
      <AlertRules product={product} />

      <ProductFormDialog
        open={editing}
        onOpenChange={setEditing}
        title="Edit product"
        submitLabel="Save"
        initial={product}
        pending={update.isPending}
        onSubmit={(values: ProductCreate) => update.mutateAsync(values).then(() => setEditing(false))}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this product?"
        description="Its listings, price history and alerts will be deleted. Archive it instead to keep the history."
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}
