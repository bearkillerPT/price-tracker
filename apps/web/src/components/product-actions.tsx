import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ProductCreate, ProductDetail, ProductSummary, ProductUpdate } from "@price-tracker/shared";
import { Archive, ArchiveRestore, ExternalLink, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { ProductFormDialog } from "@/components/product-form-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { keys, useProductMutation } from "@/hooks/queries";
import { del, errorMessage, patch } from "@/lib/api";

/** A product's menu: open (from the list), edit, archive, delete. The same everywhere a product shows. */
export function ProductActions({
  product,
  showOpen = false,
  onDeleted,
  variant = "ghost",
}: {
  product: ProductSummary;
  showOpen?: boolean;
  onDeleted?: () => void;
  variant?: "ghost" | "outline";
}) {
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
      toast.success(`${product.name} deleted`);
      onDeleted?.();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const archive = () =>
    update.mutate(
      { archived: !product.archived },
      { onSuccess: () => toast.success(product.archived ? `${product.name} is back: its listings are checked again` : `${product.name} archived: its listings aren't checked`) },
    );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant={variant} size="icon-sm" aria-label={`Actions for ${product.name}`}>
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {showOpen && (
            <DropdownMenuItem onSelect={() => navigate(`/products/${product.id}`)}>
              <ExternalLink aria-hidden /> Open
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <Pencil aria-hidden /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={archive} disabled={update.isPending}>
            {product.archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
            {product.archived ? "Unarchive" : "Archive"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
            <Trash2 aria-hidden /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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
        title={`Delete ${product.name}?`}
        description="Its listings, price history and alerts will be deleted. Archive it instead to keep the history."
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}
