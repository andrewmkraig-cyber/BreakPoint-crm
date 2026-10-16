"use client";

import { useState, useTransition } from "react";
import { Check, Copy, KeyRound, ShieldOff } from "lucide-react";
import {
  createApiKey,
  revokeApiKey,
  type ApiKeyRow,
} from "@/app/settings/api-access-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { API_KEY_SCOPES, SCOPE_LABELS, type ApiKeyScope } from "@/lib/api-key-scopes";

type ToolSummary = { name: string; scope: ApiKeyScope };

export function ApiAccessView({
  initialKeys,
  origin,
  tools,
}: {
  initialKeys: ApiKeyRow[];
  origin: string;
  tools: ToolSummary[];
}) {
  const [keys, setKeys] = useState<ApiKeyRow[]>(initialKeys);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiKeyScope[]>(["read"]);
  const [error, setError] = useState<string | null>(null);
  const [freshKey, setFreshKey] = useState<{ name: string; raw: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function toggleScope(s: ApiKeyScope) {
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const r = await createApiKey({ name, scopes });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setKeys((prev) => [r.value.row, ...prev]);
      setFreshKey({ name: r.value.row.name, raw: r.value.rawKey });
      setName("");
      setScopes(["read"]);
    });
  }

  function revoke(id: string) {
    if (!window.confirm("Revoke this key? Anything using it loses access immediately.")) return;
    startTransition(async () => {
      const r = await revokeApiKey(id);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setKeys((prev) => prev.map((k) => (k.id === id ? r.value : k)));
    });
  }

  const active = keys.filter((k) => !k.revokedAt);
  const revoked = keys.filter((k) => k.revokedAt);

  return (
    <div className="space-y-6">
      {/* How it works */}
      <div className="rounded-lg border border-court-border bg-court-surface-subtle p-4 text-sm text-court-fg-muted">
        <p>
          A key is a side door into Ace for software, not people. Whatever you connect with it
          can use the same tools the Assistant uses, limited to the permissions you pick below,
          and only inside this organization. Writes are recorded as you.
        </p>
        <p className="mt-2">
          Deletes, stage moves, and bulk actions are never reachable through a key. Those stay
          behind the Assistant&apos;s Confirm card.
        </p>
      </div>

      {/* Fresh key reveal */}
      {freshKey ? (
        <div className="rounded-lg border border-court-accent bg-court-accent-tint p-4">
          <div className="flex items-start gap-2">
            <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-court-accent-dark" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-court-fg">
                Copy your new key for &ldquo;{freshKey.name}&rdquo; now
              </div>
              <div className="mt-0.5 text-xs text-court-fg-muted">
                This is the only time Ace will show it. Paste it into the connecting tool as the
                bearer token or API key. If you lose it, revoke it and create another.
              </div>
              <CopyRow value={freshKey.raw} mono className="mt-3" />
              <div className="mt-3">
                <Button variant="secondary" size="sm" type="button" onClick={() => setFreshKey(null)}>
                  I&apos;ve saved it
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Create */}
      <div className="rounded-lg border border-court-border bg-court-surface p-4">
        <div className="text-sm font-semibold text-court-fg">Create a key</div>
        <div className="mt-3 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <Input
            label="Name"
            placeholder="e.g. Grok"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            disabled={pending}
          />
          <Button type="button" variant="primary" onClick={submit} disabled={pending || !name.trim()}>
            Create key
          </Button>
        </div>
        <fieldset className="mt-4">
          <legend className="text-xs font-medium text-court-fg-muted">Permissions</legend>
          <div className="mt-2 space-y-2">
            {API_KEY_SCOPES.map((s) => (
              <label key={s} className="flex cursor-pointer items-start gap-2 text-sm text-court-fg">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-court-accent"
                  checked={scopes.includes(s)}
                  onChange={() => toggleScope(s)}
                  disabled={pending}
                />
                <span>
                  <span className="font-medium">{SCOPE_LABELS[s].label}</span>
                  <span className="block text-xs text-court-fg-muted">{SCOPE_LABELS[s].detail}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}
      </div>

      {/* Keys */}
      <div>
        <div className="text-sm font-semibold text-court-fg">Active keys ({active.length})</div>
        {active.length === 0 ? (
          <div className="mt-2 text-sm text-court-fg-muted">No keys yet. Nothing outside Ace can reach it.</div>
        ) : (
          <ul className="mt-2 divide-y divide-court-border rounded-lg border border-court-border bg-court-surface">
            {active.map((k) => (
              <KeyItem key={k.id} row={k} onRevoke={() => revoke(k.id)} pending={pending} />
            ))}
          </ul>
        )}
        {revoked.length > 0 ? (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-court-fg-muted">
              Revoked keys ({revoked.length})
            </summary>
            <ul className="mt-2 divide-y divide-court-border rounded-lg border border-court-border bg-court-surface-subtle opacity-70">
              {revoked.map((k) => (
                <KeyItem key={k.id} row={k} pending={pending} />
              ))}
            </ul>
          </details>
        ) : null}
      </div>

      {/* Connection details */}
      <div className="rounded-lg border border-court-border bg-court-surface p-4">
        <div className="text-sm font-semibold text-court-fg">Where to point the other tool</div>
        <div className="mt-1 text-xs text-court-fg-muted">
          Most agent platforms ask for one of these. Give it the key as the bearer token (or an
          <span className="font-mono"> X-Api-Key</span> header if that is the only option).
        </div>
        <dl className="mt-3 space-y-3 text-sm">
          <div>
            <dt className="text-xs font-medium text-court-fg-muted">MCP server URL</dt>
            <dd><CopyRow value={`${origin}/api/mcp`} mono className="mt-1" /></dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-court-fg-muted">REST base (list tools with GET, call with POST /api/v1/tools/&lt;name&gt;)</dt>
            <dd><CopyRow value={`${origin}/api/v1/tools`} mono className="mt-1" /></dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-court-fg-muted">OpenAPI description (for platforms that import a spec)</dt>
            <dd><CopyRow value={`${origin}/api/v1/openapi.json`} mono className="mt-1" /></dd>
          </div>
        </dl>
        <div className="mt-4 text-xs font-medium text-court-fg-muted">Tools a key can reach</div>
        <ul className="mt-1 flex flex-wrap gap-1.5">
          {tools.map((t) => (
            <li
              key={t.name}
              className="rounded-md border border-court-border bg-court-surface-subtle px-2 py-0.5 font-mono text-xs text-court-fg"
              title={t.scope === "write" ? "Needs: Create reminders and contacts" : "Needs: Read data"}
            >
              {t.name}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function KeyItem({
  row,
  onRevoke,
  pending,
}: {
  row: ApiKeyRow;
  onRevoke?: () => void;
  pending: boolean;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-court-fg">{row.name}</span>
          <span className="font-mono text-xs text-court-fg-muted">{row.prefix}…</span>
          {row.scopes.map((s) => (
            <span
              key={s}
              className="rounded-md border border-court-border bg-court-surface-subtle px-1.5 py-0.5 text-[11px] text-court-fg-muted"
            >
              {SCOPE_LABELS[s].label}
            </span>
          ))}
        </div>
        <div className="mt-0.5 text-xs text-court-fg-muted">
          Created {fmtDate(row.createdAt)}
          {row.revokedAt
            ? ` · Revoked ${fmtDate(row.revokedAt)}`
            : row.lastUsedAt
              ? ` · Last used ${fmtDate(row.lastUsedAt)}`
              : " · Never used"}
        </div>
      </div>
      {onRevoke ? (
        <Button type="button" variant="danger" size="sm" onClick={onRevoke} disabled={pending}>
          <ShieldOff className="h-3.5 w-3.5" aria-hidden />
          Revoke
        </Button>
      ) : null}
    </li>
  );
}

function CopyRow({ value, mono, className }: { value: string; mono?: boolean; className?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked (http, iframe); the value is still visible to select.
    }
  }
  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <code
        className={`min-w-0 flex-1 select-all overflow-x-auto rounded-md border border-court-border bg-court-surface-subtle px-2 py-1.5 text-xs text-court-fg ${mono ? "font-mono" : ""}`}
      >
        {value}
      </code>
      <Button type="button" variant="secondary" size="sm" onClick={copy} aria-label="Copy">
        {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
