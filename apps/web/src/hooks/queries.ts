import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BUILT_IN_CATALOG, marketplaceIn, storeIn } from "@price-tracker/shared";
import type {
  AuthState,
  Catalog,
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
};

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
  return {
    catalog,
    marketplaceLabel: (id: string) => marketplaceIn(catalog, id)?.label ?? id,
    storeLabel: (id: string) => storeIn(catalog, id)?.label ?? id,
  };
}

export const useAuthState = () => useQuery({ queryKey: keys.auth, queryFn: () => get<AuthState>("/api/auth/state"), staleTime: 60_000 });

export const useProducts = () =>
  useQuery({ queryKey: keys.products, queryFn: () => get<ProductSummary[]>("/api/products"), refetchInterval: 60_000 });

export const useProduct = (id: number) =>
  useQuery({
    queryKey: keys.product(id),
    queryFn: () => get<ProductDetail>(`/api/products/${id}`),
    refetchInterval: 60_000,
    enabled: Number.isFinite(id),
  });

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
