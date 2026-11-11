import { useState, type FormEvent, type ReactNode } from "react";
import { CONDITIONS, type Condition, type ProductCreate } from "@price-tracker/shared";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { conditionLabel } from "@/lib/format";

export interface ProductFormValues {
  name: string;
  ean: string | null;
  notes: string | null;
  acceptedConditions: Condition[];
}

/** Create or edit a product's name, EAN, notes and accepted conditions. */
export function ProductFormDialog({
  trigger,
  title,
  submitLabel,
  initial,
  pending,
  onSubmit,
  open,
  onOpenChange,
}: {
  trigger?: ReactNode;
  title: string;
  submitLabel: string;
  initial?: Partial<ProductFormValues>;
  pending?: boolean;
  onSubmit: (values: ProductCreate) => Promise<unknown>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>A product is the thing you want to buy. Listings are the store pages selling it.</DialogDescription>
        </DialogHeader>
        {/* Remount the form each time the dialog opens, so it starts from `initial` */}
        {open && <ProductForm initial={initial} submitLabel={submitLabel} pending={pending} onSubmit={onSubmit} />}
      </DialogContent>
    </Dialog>
  );
}

function ProductForm({
  initial,
  submitLabel,
  pending,
  onSubmit,
}: {
  initial?: Partial<ProductFormValues>;
  submitLabel: string;
  pending?: boolean;
  onSubmit: (values: ProductCreate) => Promise<unknown>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [ean, setEan] = useState(initial?.ean ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [conditions, setConditions] = useState<Condition[]>(initial?.acceptedConditions ?? ["new"]);

  const toggle = (c: Condition, on: boolean) =>
    setConditions((prev) => (on ? [...prev, c] : prev.filter((x) => x !== c)).sort((a, b) => CONDITIONS.indexOf(a) - CONDITIONS.indexOf(b)));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void onSubmit({
      name: name.trim(),
      ean: ean.trim() || null,
      notes: notes.trim() || null,
      acceptedConditions: conditions,
    });
  };

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="space-y-2">
        <Label htmlFor="product-name">Name</Label>
        <Input
          id="product-name"
          required
          maxLength={200}
          autoFocus
          placeholder="Minisforum M1 Pro-125H 32GB/1TB"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="product-ean">
          EAN <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input id="product-ean" inputMode="numeric" maxLength={32} value={ean} onChange={(e) => setEan(e.target.value)} />
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Conditions that count toward the price</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {CONDITIONS.map((c) => (
            <div key={c} className="flex items-center gap-2">
              <Checkbox id={`cond-${c}`} checked={conditions.includes(c)} onCheckedChange={(v) => toggle(c, v === true)} />
              <Label htmlFor={`cond-${c}`} className="font-normal">
                {conditionLabel(c)}
              </Label>
            </div>
          ))}
        </div>
        {conditions.length === 0 && <p className="text-xs text-destructive">Pick at least one.</p>}
      </fieldset>
      <div className="space-y-2">
        <Label htmlFor="product-notes">
          Notes <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Textarea id="product-notes" maxLength={2000} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <DialogFooter>
        <Button type="submit" disabled={pending || !name.trim() || conditions.length === 0}>
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
