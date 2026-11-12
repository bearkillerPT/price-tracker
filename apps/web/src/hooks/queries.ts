import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BUILT_IN_CATALOG, marketplaceIn, storeIn } from "@price-tracker/shared";
import type {
  AuthState,
  Catalog,
  Listing,
  NotificationChannel,
  ProductDetail,
  ProductHistory,
  ProductSummary,
  RateGroupStatus,
  Settings,
  StoreSessionStatus,
} from "@price-tracker/shared";
import { toast } from "sonner";
import { authKey, errorMessage, get } from "@/lib/api";

export const keys = {
  auth: authKey,
  products: ["products"] as const,
  product: (id: number) => ["product", id] as const,
  history: (id: number, days: number) => ["history", id, days] as const,
  stores: ["stores"] as const,
  channels: ["notification-channels"] as const,
  settings: ["settings"] as const,
  catalog: ["catalog"] as const,
  storeSessions: ["store-sessions"] as const,
  storeIcons: ["store-icons"] as const,
};

/** Stores with a known icon, and its version (for the image's address). */
export const useStoreIcons = () =>
  useQuery({ queryKey: keys.storeIcons, queryFn: () => get<Record<string, string>>("/api/store-icons"), staleTime: 10 * 60_000 });

export const useStoreSessions = () =>
  useQuery({ queryKey: keys.storeSessions, queryFn: () => get<StoreSessionStatus[]>("/api/store-sessions") });

/** Built-in and custom stores. Starts from the built-in ones, so labels never flash while it loads. */
export function useCatalog(): Catalog {
  const q = useQuery({ queryKey: keys.catalog, queryFn: () => get<Catalog>("/api/catalog"), staleTime: 5 * 60_000 });
  return q.data ?? BUILT_IN_CATALOG;
}

/** Store and marketplace names from the catalog. */
export function useLabels() {
  const catalog = useCatalog();
  // Stable while the catalog is, so they can be memo dependencies
  return useMemo(
    () => ({
      catalog,
      marketplaceLabel: (id: string) => marketplaceIn(catalog, id)?.label ?? id,
      storeLabel: (id: string) => storeIn(catalog, id)?.label ?? id,
    }),
    [catalog],
  );
}

export const useAuthState = () => useQuery({ queryKey: keys.auth, queryFn: () => get<AuthState>("/api/auth/state"), staleTime: 60_000 });

export const useProducts = () =>
  useQuery({ queryKey: keys.products, queryFn: () => get<ProductSummary[]>("/api/products"), refetchInterval: 60_000 });

/** A check that came due less than this long ago is about to land (the store's queue takes under a minute). */
const PENDING_MS = 3 * 60_000;

/** Whether the listing's check is due, so its result should show up shortly ("Check now", or its turn came). */
export function checkPending(l: Listing, now = Date.now()): boolean {
  if (!l.enabled || !l.nextCheckAt) return false;
  const due = Date.parse(l.nextCheckAt);
  return due <= now && now - due < PENDING_MS;
}

/** Every few seconds while a check is about to land; else once a minute, or just after the next check comes due. */
function productRefetchDelay(detail: ProductDetail | undefined, now = Date.now()): number {
  if (!detail) return 60_000;
  if (detail.listings.some((l) => checkPending(l, now))) return 4_000;
  const next = Math.min(...detail.listings.filter((l) => l.enabled && l.nextCheckAt).map((l) => Date.parse(l.nextCheckAt!)));
  return Number.isFinite(next) && next - now < 60_000 ? Math.max(4_000, next - now + 4_000) : 60_000;
}

export function useProduct(id: number) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: keys.product(id),
    queryFn: async () => {
      const before = qc.getQueryData<ProductDetail>(keys.product(id));
      const detail = await get<ProductDetail>(`/api/products/${id}`);
      // A check landed: refresh the chart and the product list with it
      if (before && before.lastCheckedAt !== detail.lastCheckedAt) {
        void qc.invalidateQueries({ queryKey: ["history", id] });
        void qc.invalidateQueries({ queryKey: keys.products });
      }
      return detail;
    },
    refetchInterval: (query) => productRefetchDelay(query.state.data),
    enabled: Number.isFinite(id),
  });
}

export const useHistory = (id: number, days: number) =>
  useQuery({
    queryKey: keys.history(id, days),
    queryFn: () => get<ProductHistory>(`/api/products/${id}/history?days=${days}`),
    refetchInterval: 5 * 60_000,
  });

export const useStores = () =>
  useQuery({ queryKey: keys.stores, queryFn: () => get<RateGroupStatus[]>("/api/stores"), refetchInterval: 60_000 });

export const useChannels = () =>
  useQuery({ queryKey: keys.channels, queryFn: () => get<NotificationChannel[]>("/api/notification-channels") });

export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: () => get<Settings>("/api/settings") });

/**
 * A mutation on one product whose response is the updated ProductDetail: stores it, refreshes the
 * list, the request budget and the history, and toasts errors.
 */
export function useProductMutation<V>(productId: number, fn: (vars: V) => Promise<ProductDetail>, success?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (detail) => {
      qc.setQueryData(keys.product(productId), detail);
      void qc.invalidateQueries({ queryKey: keys.products });
      void qc.invalidateQueries({ queryKey: keys.stores });
      void qc.invalidateQueries({ queryKey: ["history", productId] });
      if (success) toast.success(success);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}
