"use client";

// ZoomInfo connector card. Credentials are saved in-app on the
// Organization, no redeploy. Two ways in, picked with a TabStrip:
//   - Custom App (recommended): client ID + private key from the ZoomInfo
//     Admin Portal, plus the admin's login email. No extra seat.
//   - API user: a username + password for a user with API access.
// Test connection authenticates against ZoomInfo and reports credits.

import { useState, useTransition } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { TabStrip } from "@/components/ui/tab-strip";
import {
  disconnectZoomInfo,
  saveZoomInfoCredentials,
  saveZoomInfoPki,
} from "./zoominfo-actions";

type TestState = { state: "connected" | "degraded" | "disconnected"; detail: string } | null;
type Mode = "pki" | "password";

export function ZoomInfoConnectorCard({
  username,
  authMode,
}: {
  username: string | null;
  authMode: Mode | null;
}) {
  const isConnected = username != null;
  const [mode, setMode] = useState<Mode>("pki");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [clientId, setClientId] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [pending, startTransition] = useTransition();
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestState>(null);

  const canSave =
    user.trim().length > 0 &&
    (mode === "pki" ? clientId.trim().length > 0 && privateKey.trim().length > 0 : pass.length > 0);

  function onSave() {
    if (!canSave) {
      toast.error(
        mode === "pki"
          ? "Enter your login email, the client ID, and the private key first."
          : "Enter the API username and password first.",
      );
      return;
    }
    startTransition(async () => {
      try {
        if (mode === "pki") {
          await saveZoomInfoPki({ username: user, clientId, privateKey });
        } else {
          await saveZoomInfoCredentials({ username: user, password: pass });
        }
        setUser("");
        setPass("");
        setClientId("");
        setPrivateKey("");
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
                {authMode === "pki" ? "Custom App (client ID + private key)" : "API user (password)"}
                {" · "}
                {test?.detail ?? "Click Test connection to confirm."}
              </>
            ) : (
              "Contact search and company enrichment for BD. Connect with a Custom App from the ZoomInfo Admin Portal (no extra seat), or an API user's password."
            )}
          </div>
          {!isConnected ? (
            <div className="mt-3 space-y-3">
              <TabStrip
                ariaLabel="ZoomInfo sign-in method"
                items={[
                  { id: "pki", label: "Custom App (recommended)" },
                  { id: "password", label: "API user password" },
                ]}
                activeId={mode}
                onChange={(id) => setMode(id as Mode)}
              />
              <div className="flex flex-wrap items-end gap-2">
                <div className="w-64">
                  <Input
                    label={mode === "pki" ? "Your ZoomInfo login email" : "API username"}
                    value={user}
                    onChange={(e) => setUser(e.target.value)}
                    placeholder="andrew@breakpointtalent.com"
                    disabled={pending}
                    autoComplete="off"
                  />
                </div>
                {mode === "pki" ? (
                  <div className="w-64">
                    <Input
                      label="Client ID"
                      value={clientId}
                      onChange={(e) => setClientId(e.target.value)}
                      placeholder="From Admin Portal > Custom Apps"
                      disabled={pending}
                      autoComplete="off"
                    />
                  </div>
                ) : (
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
                )}
              </div>
              {mode === "pki" ? (
                <div className="max-w-2xl">
                  <Textarea
                    label="Private key (paste the whole .pem file)"
                    rows={4}
                    value={privateKey}
                    onChange={(e) => setPrivateKey(e.target.value)}
                    placeholder={"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"}
                    disabled={pending}
                    className="font-mono text-[11px]"
                  />
                </div>
              ) : null}
              <Button type="button" variant="primary" size="sm" onClick={onSave} disabled={pending || !canSave}>
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
        Read-only. Ace only searches and enriches; it never writes to ZoomInfo. Credentials are stored on the organization record like the Mercury key.
      </div>
    </div>
  );
}
