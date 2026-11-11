// Failed logins per client IP: after 10 in 15 minutes, logins from that IP are refused until the window ends.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const failures = new Map<string, { count: number; resetAt: number }>();

export function loginBlockedFor(ip: string, now = Date.now()): number {
  const f = failures.get(ip);
  if (!f || f.resetAt <= now) return 0;
  return f.count >= MAX_FAILURES ? Math.ceil((f.resetAt - now) / 1000) : 0;
}

export function recordLoginFailure(ip: string, now = Date.now()): void {
  const f = failures.get(ip);
  if (!f || f.resetAt <= now) failures.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  else f.count++;
}

export function clearLoginFailures(ip: string): void {
  failures.delete(ip);
}
