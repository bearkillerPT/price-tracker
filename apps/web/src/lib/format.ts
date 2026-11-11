import {
  CONDITION_LABELS,
  type Condition,
  type Currency,
  type ObservationStatus,
} from "@price-tracker/shared";

const moneyFormats = new Map<string, Intl.NumberFormat>();

export function formatMoney(amount: number | null | undefined, currency: Currency | string | null | undefined): string {
  if (amount == null || !currency) return "—";
  let f = moneyFormats.get(currency);
  if (!f) {
    f = new Intl.NumberFormat(undefined, { style: "currency", currency });
    moneyFormats.set(currency, f);
  }
  return f.format(amount);
}

export const formatEur = (amount: number | null | undefined) => formatMoney(amount, "EUR");

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const units: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** "5 minutes ago", "in 2 hours", "now". */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const seconds = (new Date(iso).getTime() - now) / 1000;
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return Math.abs(seconds) < 45 ? "just now" : rtf.format(Math.round(seconds), "second");
}

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
export const formatDateTime = (iso: string | null | undefined) => (iso ? dateTime.format(new Date(iso)) : "—");

const shortDate = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
export const formatShortDate = (ms: number) => shortDate.format(new Date(ms));

/** 30 -> "30 min", 180 -> "3 h", 1440 -> "1 day". */
export function formatInterval(minutes: number): string {
  if (minutes % (24 * 60) === 0) {
    const d = minutes / (24 * 60);
    return `${d} ${d === 1 ? "day" : "days"}`;
  }
  if (minutes % 60 === 0) return `${minutes / 60} h`;
  if (minutes > 60) return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  return `${minutes} min`;
}

export const formatRate = (perHour: number) => (perHour < 10 ? perHour.toFixed(1) : Math.round(perHour).toString());

export const conditionLabel = (c: Condition) => CONDITION_LABELS[c] ?? c;

export const STATUS_INFO: Record<ObservationStatus, { label: string; tone: "ok" | "muted" | "warn" | "bad"; description: string }> = {
  ok: { label: "OK", tone: "ok", description: "The price was read." },
  unavailable: { label: "Unavailable", tone: "muted", description: "The page was read, but the product can't be bought right now." },
  variant_mismatch: {
    label: "Wrong version",
    tone: "warn",
    description: "The page doesn't match this listing's guard terms (e.g. it shows the barebone), so its price wasn't recorded.",
  },
  not_found: { label: "Not found", tone: "warn", description: "The store says this page doesn't exist any more." },
  captcha: {
    label: "Captcha",
    tone: "bad",
    description: "The store showed a captcha instead of the page. Checks for this store are paused for a while.",
  },
  blocked: { label: "Blocked", tone: "bad", description: "The store refused the request (a bot challenge or an error page)." },
  signed_out: {
    label: "Signed out",
    tone: "warn",
    description: "This store's prices need your account and it isn't signed in (or the sign-in expired). Sign in on the Stores page.",
  },
  error: { label: "Error", tone: "bad", description: "The check failed: a network error or a page the tracker didn't understand." },
};

export const INTERVAL_PRESETS = [30, 60, 120, 180, 240, 360, 480, 720, 1440, 2880, 10080];
