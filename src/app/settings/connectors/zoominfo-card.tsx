"use client";

// ZoomInfo connector card. Mirrors the Mercury card: credentials are
// saved in-app on the Organization, no redeploy. Adds a Test connection
// button that authenticates against ZoomInfo and reports credits left.

import { useState, useTransition } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { disconnectZoomInfo, saveZoomInfoCredentials } from "./zoominfo-actions";

type TestState = { state: "connected" | "degraded" | "disconnected"; detail: string } | null;

export function ZoomInfoConnectorCard({ username }: { username: string | null }) {
  const isConnected = username != null;
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [pending, startTransition] = useTransition();
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestState>(null);

  function onSave() {
    if (!user.trim() || !pass) {
      toast.error("Enter the ZoomInfo API username and password first.");
      return;
    }
    startTransition(async () => {
      try {
        await saveZoomInfoCredentials({ username: user, password: pass });
        setUser("");
        setPass("");
        toast.success("ZoomInfo credentials saved.", { description: "Click Test connection to confirm." });
      } catch (e) {
        toast.error("Couldn't save ZoomInfo credentials", {
          description: e instanceof Error ? e.message : "Try again in a moment.",
        });
      }
    });
  }

  function onDisconnect() {
    startTransition(async () => {
      try {
        await disconnectZoomInfo();
        setTest(null);
        toast.success("ZoomInfo disconnected.");
      } catch (e) {
        toast.error("Couldn't disconnect ZoomInfo", {
          description: e instanceof Error ? e.message : "Try again in a moment.",
        });
      }
    });
  }

  async function onTest() {
    setTesting(true);
    try {
      const res = await fetch("/api/zoominfo/test", { method: "POST" });
      const data = (await res.json()) as {
        ok: boolean;
        state: "connected" | "not_configured" | "error";
        account: string | null;
        message: string;
        hint?: string;
      };
      setTest({
        state: data.state === "connected" ? "connected" : data.state === "not_configured" ? "disconnected" : "degraded",
        detail: data.message,
      });
      if (data.ok) toast.success("ZoomInfo connected", { description: data.message });
      else toast.error("ZoomInfo test failed", { description: data.hint ?? data.message });
    } catch (e) {
      toast.error("ZoomInfo test failed", {
        description: e instanceof Error ? e.message : "Could not reach the test route.",
      });
    } finally {
      setTesting(false);
    }
  }

  const dotCls = test
    ? test.state === "connected"
      ? "bg-court-brand"
      : test.state === "degraded"
        ? "bg-amber-500"
        : "bg-red-500"
    : isConnected
      ? "bg-amber-500"
      : "bg-red-500";

  return (
    <div className="rounded-lg border border-court-border bg-court-surface-subtle/40 px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-full ${dotCls}`} />
            <span className="text-sm font-semibold text-court-fg">ZoomInfo</span>
            {isConnected ? (
              <span className="text-[11px] font-semibold uppercase tracking-wider text-court-brand-dark">
                {test?.state === "connected" ? "Connected" : test?.state === "degraded" ? "Degraded" : "Credentials saved"}
              </span>
            ) : (
              <span className="text-[11px] font-semibold uppercase tracking-wider text-court-fg-muted">
                Not connected
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-court-fg-muted">
            {isConnected ? (
              <>
                <span className="font-mono">{username}</span>
                {" · "}
                {test?.detail ?? "Contact search and company enrichment for BD. Click Test connection to confirm."}
              </>
            ) : (
              "Contact search and company enrichment for BD. Needs an API user from the ZoomInfo admin portal."
            )}
          </div>
          {!isConnected ? (
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <div className="w-56">
                <Input
                  label="API username"
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                  placeholder="api-user@breakpointtalent.com"
                  disabled={pending}
                  autoComplete="off"
                />
              </div>
              <div className="w-56">
                <Input
                  label="API password"
                  type="password"
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                  placeholder="••••••••"
                  disabled={pending}
                  autoComplete="new-password"
                />
              </div>
              <Button type="button" variant="primary" size="sm" onClick={onSave} disabled={pending || !user.trim() || !pass}>
                {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                Save
              </Button>
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isConnected ? (
            <>
              <Button type="button" variant="secondary" size="sm" onClick={() => void onTest()} disabled={testing || pending}>
                {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                Test connection
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={onDisconnect} disabled={pending || testing}>
                Disconnect
              </Button>
            </>
          ) : null}
        </div>
      </div>
      <div className="mt-1.5 text-[11px] italic text-court-fg-muted">
        Read-only. Ace only searches and enriches; it never writes to ZoomInfo. The password is stored on the organization record like the Mercury key.
      </div>
    </div>
  );
}
