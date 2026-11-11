import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AuthState } from "@price-tracker/shared";
import { LogOut, Tag } from "lucide-react";
import { Link, NavLink, Outlet, useNavigate } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { keys } from "@/hooks/queries";
import { errorMessage, post } from "@/lib/api";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Products", end: true },
  { to: "/stores", label: "Stores", end: false },
  { to: "/settings", label: "Settings", end: false },
];

export function Layout() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const logout = useMutation({
    mutationFn: () => post<AuthState>("/api/auth/logout"),
    onSuccess: (state) => {
      qc.clear();
      qc.setQueryData(keys.auth, state);
      navigate("/login", { replace: true });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
          <Link to="/" className="mr-2 flex items-center gap-2 font-semibold">
            <Tag className="size-4 text-success" aria-hidden />
            <span className="hidden sm:inline">Price Tracker</span>
          </Link>
          <nav aria-label="Main" className="flex items-center gap-1">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    "rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                    isActive && "bg-accent font-medium text-foreground",
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => logout.mutate()} disabled={logout.isPending}>
            <LogOut aria-hidden />
            <span className="hidden sm:inline">Sign out</span>
            <span className="sr-only sm:hidden">Sign out</span>
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
