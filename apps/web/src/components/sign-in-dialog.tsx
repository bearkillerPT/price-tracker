import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { LiveSession, SignInResult } from "@price-tracker/shared";
import { toast } from "sonner";

import { LiveBrowser } from "@/components/live-browser";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { keys, useLabels } from "@/hooks/queries";
import { errorMessage, post } from "@/lib/api";

/**
 * Signs in to a store's marketplace in the live browser. Nothing is typed for you and no password is
 * kept: once the store shows you signed in, its cookies are saved (encrypted) for checks to use.
 */
export function SignInDialog({
  store,
  marketplace,
  label,
  onClose,
  onSaved,
  step,
}: {
  store: string;
  marketplace: string;
  label: string;
  onClose: () => void;
  /** After saving; the caller decides what comes next (e.g. asks about other stores). */
  onSaved?: (result: SignInResult) => void;
  /** Where this is in a run of sign-ins, e.g. "2 of 3". */
  step?: string;
}) {
  const qc = useQueryClient();
  const { marketplaceLabel } = useLabels();
  const save = useMutation({
    mutationFn: (liveSessionId: string) => post<SignInResult>("/api/store-sessions/save", { store, marketplace, liveSessionId }),
    onSuccess: (result) => {
      const { sessions, alsoSignedIn, checked } = result;
      qc.setQueryData(keys.storeSessions, sessions);
      const name = sessions.find((s) => s.marketplace === marketplace)?.accountName;
      const others = alsoSignedIn.map(marketplaceLabel);
      toast.success(`Signed in to ${label}${name ? ` as ${name}` : ""}. Its checks now use your account.`, {
        description: others.length
          ? `Amazon also signed you in to ${others.join(", ")} with it, so ${others.length === 1 ? "that store is" : "those stores are"} saved too.`
          : checked.length
            ? `Amazon didn't carry it over to ${marketplaceLabel(checked[0]!)}: the other stores need their own sign-in.`
            : undefined,
        duration: 10_000,
      });
      if (onSaved) onSaved(result);
      else onClose();
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[92dvh] max-w-[min(96vw,1400px)] flex-col sm:max-w-[min(96vw,1400px)]">
        <DialogHeader>
          <DialogTitle>
            Sign in to {label}
            {step && <span className="ml-2 text-sm font-normal text-muted-foreground">({step})</span>}
          </DialogTitle>
          <DialogDescription>
            A browser on the server, shown live. Sign in {store === "amazon-business" ? "with your Amazon Business account" : "as you normally would"},
            including any code or puzzle Amazon asks for (this browser is new to it). When the page greets you by name, press "I'm
            signed in". Your password isn't kept, only the cookies Amazon sets, encrypted. You can paste (Ctrl+V) from your
            password manager, and ticking "Keep me signed in" makes the sign-in last longer.
            {store === "amazon-business" &&
              " Amazon Business leads with prices without VAT; checks keep that one, the lowest, and the price with VAT next to it."}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1">
          <LiveBrowser
            pickable={false}
            start={() => post<LiveSession>("/api/store-sessions/sign-in", { store, marketplace })}
            footer={(sessionId) => (
              <div className="flex flex-wrap items-center justify-end gap-3 rounded-md border p-3 text-sm">
                {save.error && (
                  <p role="alert" className="mr-auto text-destructive">
                    {errorMessage(save.error)}
                  </p>
                )}
                <Button type="button" disabled={!sessionId || save.isPending} onClick={() => sessionId && save.mutate(sessionId)}>
                  {save.isPending ? "Saving, and checking the other stores…" : "I'm signed in"}
                </Button>
              </div>
            )}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
