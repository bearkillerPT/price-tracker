import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import type { LiveClientMessage, LiveServerMessage, LiveSession } from "@price-tracker/shared";
import { ArrowLeft, ArrowRight, Crosshair, Loader2, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { del, errorMessage, post } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface Pick {
  selector: string;
  text: string;
  price: number | null;
}

type Status = { kind: "starting" } | { kind: "live" } | { kind: "closed"; reason: string } | { kind: "error"; message: string };

const BUTTONS = ["left", "middle", "right"] as const;

/**
 * A browser running on the server, shown live: its screen arrives as frames, and clicks, scrolling and
 * typing on it are sent back. In pick mode, clicking an element picks it instead of pressing it.
 */
export function LiveBrowser({
  url = "",
  start,
  pickable = true,
  footer,
  onUse,
  useLabel = "Use this price",
  busy = false,
  useError = null,
}: {
  /** Page to open (with the default start). */
  url?: string;
  /** Opens the server-side session; defaults to opening `url` for browsing. */
  start?: () => Promise<LiveSession>;
  /** Offer "Pick the price". */
  pickable?: boolean;
  /** Extra controls under the view, e.g. "I'm signed in". */
  footer?: (sessionId: string | null) => ReactNode;
  onUse?: (pick: Pick) => void;
  useLabel?: string;
  /** onUse is working (e.g. testing the pick); shown on the button. */
  busy?: boolean;
  /** Why the last onUse failed. */
  useError?: string | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const frameSize = useRef({ w: 1280, h: 800 });
  const frameSeq = useRef(0);
  const pendingMove = useRef<{ x: number; y: number } | null>(null);
  const pressedKeys = useRef(new Set<string>());
  const pressedButtons = useRef(new Set<"left" | "middle" | "right">());
  const hadFocus = useRef(false);
  const [focused, setFocused] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "starting" });
  const [page, setPage] = useState({ url, title: "", loading: true });
  const [address, setAddress] = useState(url);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Pick | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  // Held in a ref: a new function on each render mustn't reopen the browser
  const startRef = useRef(start ?? (() => post<LiveSession>("/api/browser/sessions", { url })));

  const send = useCallback((m: LiveClientMessage) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  }, []);

  // Open the session, then its socket; close both when the component goes away
  useEffect(() => {
    let id: string | null = null;
    let disposed = false;
    (async () => {
      try {
        id = (await startRef.current()).id;
        if (disposed) return void del(`/api/browser/sessions/${id}`).catch(() => {});
        setSessionId(id);
        const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/browser/live?id=${id}`);
        wsRef.current = ws;
        ws.onopen = () => {
          setStatus({ kind: "live" });
          const area = areaRef.current;
          if (area) ws.send(JSON.stringify({ t: "viewport", width: area.clientWidth, height: area.clientHeight } satisfies LiveClientMessage));
        };
        ws.onclose = () => setStatus((s) => (s.kind === "live" || s.kind === "starting" ? { kind: "closed", reason: "Disconnected" } : s));
        ws.onmessage = (event) => {
          const m = JSON.parse(String(event.data)) as LiveServerMessage;
          if (m.t === "frame") void draw(m);
          else if (m.t === "state") {
            setPage({ url: m.url, title: m.title, loading: m.loading });
            setAddress(m.url);
          } else if (m.t === "picked") setPicked({ selector: m.selector, text: m.text, price: m.price });
          else if (m.t === "error") setNotice(m.message);
          else if (m.t === "closed") setStatus({ kind: "closed", reason: m.reason });
        };
      } catch (e) {
        setStatus({ kind: "error", message: errorMessage(e) });
      }
    })();
    return () => {
      disposed = true;
      wsRef.current?.close();
      wsRef.current = null;
      if (id) void del(`/api/browser/sessions/${id}`).catch(() => {});
    };
  }, [url]);

  // Frames decode asynchronously; drop any that finish after a newer one
  async function draw(m: Extract<LiveServerMessage, { t: "frame" }>) {
    const seq = ++frameSeq.current;
    const bytes = Uint8Array.from(atob(m.data), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
    const canvas = canvasRef.current;
    if (!canvas || seq !== frameSeq.current) return bitmap.close();
    frameSize.current = { w: m.w, h: m.h };
    if (canvas.width !== m.w || canvas.height !== m.h) {
      canvas.width = m.w;
      canvas.height = m.h;
    }
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, m.w, m.h);
    bitmap.close();
  }

  // The browser's viewport follows the size of the area it's shown in
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    let timer: number | undefined;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => send({ t: "viewport", width: area.clientWidth, height: area.clientHeight }), 200);
    });
    observer.observe(area);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [send]);

  // Wheel needs a non-passive listener to stop the dialog from scrolling
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { x, y } = toPage(e.clientX, e.clientY);
      send({ t: "wheel", x, y, dx: e.deltaX, dy: e.deltaY });
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [send]);

  function toPage(clientX: number, clientY: number) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * frameSize.current.w,
      y: ((clientY - rect.top) / rect.height) * frameSize.current.h,
    };
  }

  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const first = pendingMove.current === null;
    pendingMove.current = toPage(e.clientX, e.clientY);
    if (first) {
      requestAnimationFrame(() => {
        if (pendingMove.current) send({ t: "mouse", type: "move", ...pendingMove.current });
        pendingMove.current = null;
      });
    }
  };
  const onPointer = (type: "down" | "up") => (e: PointerEvent<HTMLCanvasElement>) => {
    if (type === "down") e.currentTarget.focus();
    const button = BUTTONS[e.button] ?? "left";
    if (type === "down") pressedButtons.current.add(button);
    else pressedButtons.current.delete(button);
    send({ t: "mouse", type, ...toPage(e.clientX, e.clientY), button, clickCount: Math.max(1, e.detail) });
  };
  const onKey = (type: "down" | "up") => (e: KeyboardEvent<HTMLCanvasElement>) => {
    if (e.key === "Escape") return; // closes the dialog
    // Ctrl/Cmd+V: let the browser fire "paste" with the clipboard, and type that instead of a "v"
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") return;
    e.preventDefault();
    if (type === "down") pressedKeys.current.add(e.key);
    else pressedKeys.current.delete(e.key);
    send({ t: "key", type, key: e.key, text: e.key.length === 1 ? e.key : undefined });
  };
  const onPaste = (e: ClipboardEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    if (text) send({ t: "text", text });
  };

  // Switching windows (Alt+Tab, Super...) sends the key down but not its "up": the server's browser would
  // keep it held and turn typing into shortcuts. Release whatever is pressed when the view loses focus.
  const releaseAll = useCallback(() => {
    for (const key of pressedKeys.current) send({ t: "key", type: "up", key });
    pressedKeys.current.clear();
    for (const button of pressedButtons.current) send({ t: "mouse", type: "up", x: 0, y: 0, button });
    pressedButtons.current.clear();
  }, [send]);

  // Coming back to the window: give the keyboard back to the view if it had it
  useEffect(() => {
    const onWindowBlur = () => {
      hadFocus.current = document.activeElement === canvasRef.current;
      releaseAll();
    };
    const onWindowFocus = () => {
      if (hadFocus.current) canvasRef.current?.focus();
    };
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("focus", onWindowFocus);
    return () => {
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("focus", onWindowFocus);
    };
  }, [releaseAll]);

  const togglePick = () => {
    const on = !picking;
    setPicking(on);
    if (!on) setPicked(null);
    send({ t: "pick", on });
  };

  const live = status.kind === "live";

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          send({ t: "nav", action: "goto", url: address });
        }}
      >
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Back" disabled={!live} onClick={() => send({ t: "nav", action: "back" })}>
          <ArrowLeft aria-hidden />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Forward" disabled={!live} onClick={() => send({ t: "nav", action: "forward" })}>
          <ArrowRight aria-hidden />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Reload" disabled={!live} onClick={() => send({ t: "nav", action: "reload" })}>
          {page.loading && live ? <Loader2 className="animate-spin" aria-hidden /> : <RotateCw aria-hidden />}
        </Button>
        <Input aria-label="Address" className="h-8 min-w-0 flex-1 font-mono text-xs" value={address} onChange={(e) => setAddress(e.target.value)} disabled={!live} />
        {pickable && (
          <Button type="button" size="sm" variant={picking ? "default" : "outline"} aria-pressed={picking} disabled={!live} onClick={togglePick}>
            <Crosshair aria-hidden /> {picking ? "Picking: click the price" : "Pick the price"}
          </Button>
        )}
      </form>

      {notice && (
        <p role="status" className="text-xs text-destructive">
          {notice}
        </p>
      )}

      <div ref={areaRef} className="relative min-h-0 flex-1 overflow-hidden rounded-md border bg-muted">
        <canvas
          ref={canvasRef}
          width={1280}
          height={800}
          tabIndex={0}
          role="img"
          aria-label={`Live view of ${page.title || page.url}. Click and type here to use the page.`}
          className={cn("block h-full w-full object-contain outline-none focus-visible:ring-2 focus-visible:ring-ring", picking && "cursor-crosshair")}
          onPointerMove={onPointerMove}
          onPointerDown={onPointer("down")}
          onPointerUp={onPointer("up")}
          onKeyDown={onKey("down")}
          onKeyUp={onKey("up")}
          onPaste={onPaste}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            releaseAll();
          }}
          onContextMenu={(e) => e.preventDefault()}
        />
        {status.kind === "live" && !focused && (
          <div className="pointer-events-none absolute top-2 right-2 rounded-md bg-foreground/80 px-2 py-1 text-xs text-background" aria-hidden>
            Click the page to type
          </div>
        )}
        {status.kind !== "live" && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 p-6 text-center text-sm">
            {status.kind === "starting" && (
              <span className="flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Starting the browser on the server…
              </span>
            )}
            {status.kind === "closed" && <span>The browser view closed: {status.reason}.</span>}
            {status.kind === "error" && <span className="text-destructive">{status.message}</span>}
          </div>
        )}
      </div>

      {picking && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm" aria-live="polite">
          {picked ? (
            <>
              <div className="min-w-0 flex-1">
                <div>
                  Picked: <span className="font-medium">{picked.text || "(empty)"}</span>
                  {picked.price !== null ? (
                    <span className="text-muted-foreground"> → reads as {formatMoney(picked.price, "EUR")}</span>
                  ) : (
                    <span className="text-destructive"> → no price in it</span>
                  )}
                </div>
                <div className="truncate font-mono text-xs text-muted-foreground" title={picked.selector}>
                  {picked.selector}
                </div>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => send({ t: "pickParent" })}>
                Pick the parent element
              </Button>
              <Button type="button" size="sm" disabled={picked.price === null || busy || !onUse} onClick={() => onUse?.(picked)}>
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : null} {busy ? "Testing…" : useLabel}
              </Button>
              {useError && (
                <p role="alert" className="basis-full text-xs text-destructive">
                  {useError}
                </p>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">
              Click the price on the page. If only part of it gets picked (e.g. the cents), use "Pick the parent element".
            </span>
          )}
        </div>
      )}
      {footer?.(sessionId)}
    </div>
  );
}

/** The live browser in a large dialog, for picking a shop's price element. */
export function PickPriceDialog({
  url,
  open,
  onOpenChange,
  onUse,
  busy,
  useError,
}: {
  url: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUse: (pick: Pick) => void;
  busy?: boolean;
  useError?: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[92dvh] max-w-[min(96vw,1400px)] flex-col sm:max-w-[min(96vw,1400px)]">
        <DialogHeader>
          <DialogTitle>Pick the price</DialogTitle>
          <DialogDescription>
            This is a browser running on the server, shown live. Accept the shop's cookie banner if it asks, then turn on "Pick the
            price" and click the product's price.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <div className="min-h-0 flex-1">
            <LiveBrowser url={url} onUse={onUse} busy={busy} useError={useError} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
