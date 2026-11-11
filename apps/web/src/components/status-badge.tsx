import type { ObservationStatus } from "@price-tracker/shared";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { STATUS_INFO } from "@/lib/format";
import { cn } from "@/lib/utils";

const TONE_CLASS = {
  ok: "border-success/40 bg-success/10 text-success",
  muted: "border-border bg-muted text-muted-foreground",
  warn: "border-warning/50 bg-warning/10 text-warning",
  bad: "border-destructive/40 bg-destructive/10 text-destructive",
} as const;

export function StatusBadge({ status, error }: { status: ObservationStatus; error?: string | null }) {
  const info = STATUS_INFO[status];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" tabIndex={0} className={cn("cursor-help", TONE_CLASS[info.tone])}>
          {info.label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p>{info.description}</p>
        {error && <p className="mt-1 font-mono text-[11px] opacity-80">{error}</p>}
      </TooltipContent>
    </Tooltip>
  );
}
