import { useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

/** Free-text terms: type and press Enter or comma to add, Backspace on empty input to remove the last. */
export function TagInput({
  id,
  value,
  onChange,
  placeholder,
  describedBy,
}: {
  id: string;
  value: string[];
  onChange: (terms: string[]) => void;
  placeholder?: string;
  describedBy?: string;
}) {
  const [draft, setDraft] = useState("");

  const add = (raw: string) => {
    const term = raw.trim();
    if (!term || value.some((v) => v.toLowerCase() === term.toLowerCase())) return setDraft("");
    onChange([...value, term]);
    setDraft("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(draft);
    } else if (e.key === "Backspace" && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Terms">
          {value.map((term) => (
            <li key={term}>
              <Badge variant="secondary" className="gap-1 pr-1 font-mono">
                {term}
                <button
                  type="button"
                  className="rounded-sm p-0.5 hover:bg-background/60"
                  onClick={() => onChange(value.filter((v) => v !== term))}
                  aria-label={`Remove ${term}`}
                >
                  <X className="size-3" aria-hidden />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <Input
        id={id}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => add(draft)}
        aria-describedby={describedBy}
      />
    </div>
  );
}
