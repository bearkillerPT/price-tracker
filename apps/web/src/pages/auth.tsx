import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AuthState } from "@price-tracker/shared";
import { Tag } from "lucide-react";
import { Navigate, useLocation, useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { keys, useAuthState } from "@/hooks/queries";
import { errorMessage, post } from "@/lib/api";

/** /setup creates the single account's password on first run; /login signs in with it. */
export function AuthPage({ mode }: { mode: "setup" | "login" }) {
  const auth = useAuthState();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: () => post<AuthState>(mode === "setup" ? "/api/auth/setup" : "/api/auth/login", { password }),
    onSuccess: (state) => {
      qc.setQueryData(keys.auth, state);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== "/login" ? from : "/", { replace: true });
    },
    onError: (e) => setFormError(errorMessage(e)),
  });

  if (auth.isPending) {
    return (
      <div className="mx-auto mt-24 max-w-sm p-4">
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }
  if (auth.data) {
    if (auth.data.authenticated) return <Navigate to="/" replace />;
    if (auth.data.setupRequired && mode === "login") return <Navigate to="/setup" replace />;
    if (!auth.data.setupRequired && mode === "setup") return <Navigate to="/login" replace />;
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (mode === "setup") {
      if (password.length < 8) return setFormError("Use at least 8 characters.");
      if (password !== confirm) return setFormError("The passwords don't match.");
    }
    submit.mutate();
  };

  return (
    <div className="mx-auto mt-16 max-w-sm p-4 sm:mt-24">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Tag className="size-4 text-success" aria-hidden />
            {mode === "setup" ? "Set up Price Tracker" : "Sign in"}
          </CardTitle>
          <CardDescription>
            {mode === "setup"
              ? "This app has one account. Choose its password."
              : "Enter the password for this Price Tracker."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit} noValidate>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === "setup" ? "new-password" : "current-password"}
                autoFocus
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={formError ? true : undefined}
                aria-describedby={formError ? "auth-error" : undefined}
              />
            </div>
            {mode === "setup" && (
              <div className="space-y-2">
                <Label htmlFor="confirm">Repeat the password</Label>
                <Input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>
            )}
            {formError && (
              <p id="auth-error" role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={submit.isPending || !password}>
              {mode === "setup" ? "Save password" : "Sign in"}
            </Button>
            {mode === "login" && (
              <p className="text-xs text-muted-foreground">
                Forgot it? On the server, run <code className="font-mono">price-tracker reset-password</code>. Products and
                history are kept.
              </p>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
