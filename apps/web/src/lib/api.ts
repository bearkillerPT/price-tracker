import type { AuthState } from "@price-tracker/shared";
import { ApiRequestError, queryClient } from "@/lib/query-client";

export { ApiRequestError };

export const authKey = ["auth"] as const;

type Method = "GET" | "POST" | "PATCH" | "DELETE";

/**
 * JSON in, JSON out. Throws ApiRequestError with the API's { error } message on non-2xx.
 * A 401 outside /api/auth marks the session as gone, which sends the app to /login.
 */
export async function api<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  }

  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/api/auth/")) {
      queryClient.setQueryData<AuthState>(authKey, (old) => ({ setupRequired: old?.setupRequired ?? false, authenticated: false }));
    }
    const err = data as { error?: string; details?: unknown } | undefined;
    throw new ApiRequestError(res.status, err?.error ?? `Request failed (${res.status} ${res.statusText})`, err?.details);
  }
  return data as T;
}

export const get = <T,>(path: string) => api<T>("GET", path);
export const post = <T,>(path: string, body?: unknown) => api<T>("POST", path, body ?? {});
export const patch = <T,>(path: string, body: unknown) => api<T>("PATCH", path, body);
export const del = <T,>(path: string) => api<T>("DELETE", path);

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : "Something went wrong");
