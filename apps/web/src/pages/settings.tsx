import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  AuthState,
  NotificationChannel,
  NotificationChannelCreate,
  NotificationChannelUpdate,
  Settings,
  SettingsUpdate,
} from "@price-tracker/shared";
import { Pencil, Plus, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ResetPasswordHint } from "@/components/reset-password-hint";
import { keys, useChannels, useSettings } from "@/hooks/queries";
import { del, errorMessage, patch, post } from "@/lib/api";

export function SettingsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Settings</h1>
      <ChannelsCard />
      <DailySummaryCard />
      <PasswordCard />
    </div>
  );
}

// ---- Notification channels ----

function useChannelMutation<V>(fn: (vars: V) => Promise<NotificationChannel[]>, success?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => {
      qc.setQueryData(keys.channels, data);
      if (success) toast.success(success);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

function ChannelsCard() {
  const channels = useChannels();
  const [editing, setEditing] = useState<NotificationChannel | "new" | null>(null);
  const [deleting, setDeleting] = useState<NotificationChannel | null>(null);

  const update = useChannelMutation(({ id, ...body }: NotificationChannelUpdate & { id: number }) =>
    patch<NotificationChannel[]>(`/api/notification-channels/${id}`, body),
  );
  const remove = useChannelMutation((id: number) => del<NotificationChannel[]>(`/api/notification-channels/${id}`), "Channel deleted");
  const test = useMutation({
    mutationFn: (id: number) => post<{ ok: true }>(`/api/notification-channels/${id}/test`),
    onSuccess: () => toast.success("Test notification sent"),
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>Alerts, the daily summary and store pauses are sent to every enabled Gotify channel.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {channels.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : channels.isError ? (
          <p className="text-sm text-destructive">Couldn't load the channels: {channels.error.message}</p>
        ) : channels.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No channels yet. Nothing will be sent until you add one.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {channels.data.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <Switch
                  checked={c.enabled}
                  onCheckedChange={(enabled) => update.mutate({ id: c.id, enabled })}
                  aria-label={`${c.enabled ? "Disable" : "Enable"} ${c.name}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {c.name}
                    <Badge variant="outline">Gotify</Badge>
                    {c.tokenSet ? (
                      <Badge variant="secondary">Token set</Badge>
                    ) : (
                      <Badge variant="outline" className="text-destructive">
                        No token
                      </Badge>
                    )}
                  </div>
                  <div className="truncate font-mono text-xs text-muted-foreground">{c.url}</div>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => test.mutate(c.id)} disabled={test.isPending}>
                    <Send aria-hidden /> Test
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}>
                    <Pencil aria-hidden />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Delete ${c.name}`} onClick={() => setDeleting(c)}>
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <Button size="sm" variant="secondary" onClick={() => setEditing("new")}>
          <Plus aria-hidden /> Add Gotify channel
        </Button>
      </CardContent>
      <ChannelDialog channel={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.name ?? "channel"}?`}
        description="Nothing more will be sent to it."
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </Card>
  );
}

function ChannelDialog({ channel, onClose }: { channel: NotificationChannel | "new" | null; onClose: () => void }) {
  return (
    <Dialog open={channel !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{channel === "new" ? "Add Gotify channel" : "Edit channel"}</DialogTitle>
          <DialogDescription>
            Create an application in Gotify and paste its token. The token is stored on the server and never shown again.
          </DialogDescription>
        </DialogHeader>
        {channel !== null && <ChannelForm channel={channel === "new" ? null : channel} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function ChannelForm({ channel, onDone }: { channel: NotificationChannel | null; onDone: () => void }) {
  const [name, setName] = useState(channel?.name ?? "Gotify");
  const [url, setUrl] = useState(channel?.url ?? "");
  const [token, setToken] = useState("");

  const create = useChannelMutation(
    (body: NotificationChannelCreate) => post<NotificationChannel[]>("/api/notification-channels", body),
    "Channel added",
  );
  const update = useChannelMutation(
    (body: NotificationChannelUpdate) => patch<NotificationChannel[]>(`/api/notification-channels/${channel?.id}`, body),
    "Channel saved",
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (channel) {
      // The token is write-only: only send it when a new one was typed
      update.mutate({ name, url, ...(token.trim() ? { token: token.trim() } : {}) }, { onSuccess: onDone });
    } else {
      create.mutate({ type: "gotify", name, url, token: token.trim(), enabled: true }, { onSuccess: onDone });
    }
  };

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="space-y-2">
        <Label htmlFor="channel-name">Name</Label>
        <Input id="channel-name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="channel-url">Gotify server</Label>
        <Input
          id="channel-url"
          type="url"
          required
          placeholder="http://127.0.0.1:8082"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="channel-token">Application token</Label>
        <Input
          id="channel-token"
          type="password"
          autoComplete="off"
          required={!channel}
          placeholder={channel?.tokenSet ? "Leave empty to keep the current token" : undefined}
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </div>
      <DialogFooter>
        <Button type="submit" disabled={create.isPending || update.isPending || !name.trim() || !url.trim() || (!channel && !token.trim())}>
          {channel ? "Save" : "Add channel"}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---- Daily summary ----

function DailySummaryCard() {
  const settings = useSettings();
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (body: SettingsUpdate) => patch<Settings>("/api/settings", body),
    onSuccess: (data) => {
      qc.setQueryData(keys.settings, data);
      toast.success("Saved");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Daily summary</CardTitle>
        <CardDescription>One message a day with every product's best price.</CardDescription>
      </CardHeader>
      <CardContent>
        {settings.isPending ? (
          <Skeleton className="h-10 w-full" />
        ) : settings.isError ? (
          <p className="text-sm text-destructive">Couldn't load the settings: {settings.error.message}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex items-center gap-3">
              <Switch
                id="summary-enabled"
                checked={settings.data.dailySummaryEnabled}
                onCheckedChange={(dailySummaryEnabled) => save.mutate({ dailySummaryEnabled })}
              />
              <Label htmlFor="summary-enabled">Send a daily summary</Label>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="summary-hour">at</Label>
              <Select
                value={String(settings.data.dailySummaryHour)}
                onValueChange={(v) => save.mutate({ dailySummaryHour: Number(v) })}
                disabled={!settings.data.dailySummaryEnabled}
              >
                <SelectTrigger id="summary-hour" className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 24 }, (_, h) => (
                    <SelectItem key={h} value={String(h)}>
                      {String(h).padStart(2, "0")}:00
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground">({settings.data.timeZone})</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Password ----

function PasswordCard() {
  const qc = useQueryClient();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const change = useMutation({
    mutationFn: () => post<AuthState>("/api/auth/password", { currentPassword: current, newPassword: next }),
    onSuccess: (state) => {
      qc.setQueryData(keys.auth, state);
      setCurrent("");
      setNext("");
      setRepeat("");
      toast.success("Password changed. Other sessions were signed out.");
    },
    onError: (e) => setFormError(errorMessage(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (next.length < 8) return setFormError("Use at least 8 characters.");
    if (next !== repeat) return setFormError("The new passwords don't match.");
    change.mutate();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>
          <ResetPasswordHint />
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid max-w-md gap-4" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="pw-current">Current password</Label>
            <Input id="pw-current" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pw-new">New password</Label>
            <Input id="pw-new" type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pw-repeat">Repeat the new password</Label>
            <Input id="pw-repeat" type="password" autoComplete="new-password" required value={repeat} onChange={(e) => setRepeat(e.target.value)} />
          </div>
          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          )}
          <div>
            <Button type="submit" variant="secondary" disabled={change.isPending || !current || !next}>
              Change password
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
