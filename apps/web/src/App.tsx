import { Navigate, Route, Routes, useLocation } from "react-router";

import { Layout } from "@/components/layout";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthState } from "@/hooks/queries";
import { AuthPage } from "@/pages/auth";
import { NotFoundPage } from "@/pages/not-found";
import { ProductDetailPage } from "@/pages/product-detail";
import { ProductsPage } from "@/pages/products";
import { SettingsPage } from "@/pages/settings";
import { StoresPage } from "@/pages/stores";

export default function App() {
  return (
    <Routes>
      <Route path="/setup" element={<AuthPage mode="setup" />} />
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route element={<RequireAuth />}>
        <Route index element={<ProductsPage />} />
        <Route path="products/:id" element={<ProductDetailPage />} />
        <Route path="stores" element={<StoresPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

function RequireAuth() {
  const auth = useAuthState();
  const location = useLocation();

  if (auth.isPending) {
    return (
      <div className="mx-auto max-w-6xl space-y-3 p-6" aria-busy="true">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (auth.isError) {
    return <p className="p-6 text-destructive">Can't reach the server: {auth.error.message}</p>;
  }
  if (auth.data.setupRequired) return <Navigate to="/setup" replace />;
  if (!auth.data.authenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Layout />;
}
