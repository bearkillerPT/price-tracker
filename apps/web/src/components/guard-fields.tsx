import { Label } from "@/components/ui/label";
import { TagInput } from "@/components/tag-input";

/** Include/exclude terms that make sure a check reads the right version of the product. */
export function GuardFields({
  idPrefix,
  include,
  exclude,
  onIncludeChange,
  onExcludeChange,
}: {
  idPrefix: string;
  include: string[];
  exclude: string[];
  onIncludeChange: (terms: string[]) => void;
  onExcludeChange: (terms: string[]) => void;
}) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">Version check</legend>
      <p id={`${idPrefix}-guard-help`} className="text-xs text-muted-foreground">
        Stores often group versions on one page (Amazon puts the barebone next to the 32GB/1TB one). A check only records
        the price when the page title or the selected option contains every "must contain" term and none of the "must not
        contain" ones. Case, spaces and punctuation are ignored. Example: must contain <code className="font-mono">32GB</code> and{" "}
        <code className="font-mono">1TB</code>, must not contain <code className="font-mono">barebone</code>.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-include`}>Must contain</Label>
          <TagInput
            id={`${idPrefix}-include`}
            value={include}
            onChange={onIncludeChange}
            placeholder="Type a term, press Enter"
            describedBy={`${idPrefix}-guard-help`}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-exclude`}>Must not contain</Label>
          <TagInput
            id={`${idPrefix}-exclude`}
            value={exclude}
            onChange={onExcludeChange}
            placeholder="Type a term, press Enter"
            describedBy={`${idPrefix}-guard-help`}
          />
        </div>
      </div>
    </fieldset>
  );
}
