"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, X, Save, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBdDate } from "@/app/bd/date-format";
import {
  createSendingDomain,
  updateSendingDomain,
  deleteSendingDomain,
  type SendingDomainStatus,
} from "./actions";

export type DomainRow = {
  id: string;
  domain: string;
  status: string;
  inboxOwner: string;
  priority: number;
  lastCooldownIso: string | null;
  reputation: number;
};

const STATUSES: SendingDomainStatus[] = ["HEALTHY", "WARMING", "COOLED"];
const OWNERS = ["Andrew", "Austin"];

export function DomainsSection({ domains }: { domains: DomainRow[] }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-court-fg-muted">
          Priority is the rotation order — slot 1 picks next.
        </p>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-court-border bg-court-surface px-3 py-1.5 text-xs font-medium text-court-fg shadow-sm transition hover:bg-court-surface-subtle"
          >
            <Plus className="h-3.5 w-3.5" /> Add domain
          </button>
        )}
      </div>

      {adding && <AddDomainForm onClose={() => setAdding(false)} />}

      <div className="overflow-hidden rounded-lg border border-court-border bg-court-surface">
        <table className="w-full text-sm">
          <thead className="bg-court-surface-subtle text-[11px] uppercase tracking-wide text-court-fg-muted">
            <tr>
              <Th className="w-12">#</Th>
              <Th>Domain</Th>
              <Th>Status</Th>
              <Th>Reputation</Th>
              <Th>Inbox owner</Th>
              <Th>Last cooldown</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-court-border">
            {domains.length === 0 && (
              <tr>
                <Td colSpan={7} className="text-center text-court-fg-muted">
                  No sending domains yet. Add five warmed domains to seed the rotation pool.
                </Td>
              </tr>
            )}
            {domains.map((d) => (
              <DomainRowView
                key={d.id}
                row={d}
                isEditing={editingId === d.id}
                onEdit={() => setEditingId(d.id)}
                onClose={() => setEditingId(null)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DomainRowView({
  row,
  isEditing,
  onEdit,
  onClose,
}: {
  row: DomainRow;
  isEditing: boolean;
  onEdit: () => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [domain, setDomain] = useState(row.domain);
  const [status, setStatus] = useState<SendingDomainStatus>(row.status as SendingDomainStatus);
  const [owner, setOwner] = useState(row.inboxOwner);

  if (isEditing) {
    return (
      <tr className="bg-court-surface-subtle/40">
        <Td className="font-mono tabular-nums text-court-fg-dim">{row.priority}</Td>
        <Td>
          <input
            type="text"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            className="block w-full rounded-md border border-court-border bg-court-surface px-2 py-1 font-mono text-[12px] text-court-fg"
          />
        </Td>
        <Td>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as SendingDomainStatus)}
            className="block w-full rounded-md border border-court-border bg-court-surface px-2 py-1 text-xs text-court-fg"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Td>
        <Td>
          <ReputationBar value={row.reputation} />
        </Td>
        <Td>
          <select
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            className="block w-full rounded-md border border-court-border bg-court-surface px-2 py-1 text-xs text-court-fg"
          >
            {OWNERS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </Td>
        <Td>{row.lastCooldownIso ? formatBdDate(new Date(row.lastCooldownIso)) : "—"}</Td>
        <Td className="text-right">
          <div className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="rounded-md p-1.5 text-court-fg-muted hover:bg-court-surface hover:text-court-fg disabled:opacity-50"
              aria-label="Cancel"
            >
              <X className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                startTransition(async () => {
                  await updateSendingDomain(row.id, { domain, status, inboxOwner: owner });
                  router.refresh();
                  onClose();
                });
              }}
              className="inline-flex items-center gap-1 rounded-md border border-court-brand bg-court-brand-tint px-2.5 py-1 text-xs font-semibold text-court-brand-dark transition hover:bg-court-brand/25 disabled:opacity-60"
            >
              {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save
            </button>
          </div>
        </Td>
      </tr>
    );
  }

  return (
    <tr>
      <Td className="font-mono tabular-nums text-court-fg-dim">{row.priority}</Td>
      <Td className="font-mono text-[12px] text-court-fg">{row.domain}</Td>
      <Td>
        <StatusPill status={row.status} />
      </Td>
      <Td>
        <ReputationBar value={row.reputation} />
      </Td>
      <Td className="text-court-fg-muted">{row.inboxOwner}</Td>
      <Td className="text-court-fg-muted">
        {row.lastCooldownIso ? formatBdDate(new Date(row.lastCooldownIso)) : "—"}
      </Td>
      <Td className="text-right">
        <div className="inline-flex items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            className="rounded-md p-1.5 text-court-fg-muted hover:bg-court-surface-subtle hover:text-court-fg"
            aria-label={`Edit ${row.domain}`}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <DeleteDomainBtn id={row.id} domain={row.domain} />
        </div>
      </Td>
    </tr>
  );
}

function AddDomainForm({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [domain, setDomain] = useState("");
  const [owner, setOwner] = useState("Andrew");
  const [status, setStatus] = useState<SendingDomainStatus>("WARMING");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await createSendingDomain({ domain, inboxOwner: owner, status });
        router.refresh();
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed");
      }
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded-lg border border-court-brand bg-court-surface p-4"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-court-brand-dark">
          Add domain
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cancel"
          className="rounded-md p-1 text-court-fg-muted hover:bg-court-surface-subtle hover:text-court-fg"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block sm:col-span-2">
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-court-fg-muted">
            Domain
          </span>
          <input
            type="text"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="outreach6.breakpointconnect.com"
            required
            className="mt-1 block w-full rounded-md border border-court-border bg-court-surface px-2.5 py-1.5 font-mono text-[12px] text-court-fg shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-court-brand/40"
          />
        </label>
        <label className="block">
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-court-fg-muted">
            Inbox owner
          </span>
          <select
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            className="mt-1 block w-full rounded-md border border-court-border bg-court-surface px-2.5 py-1.5 text-sm text-court-fg shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-court-brand/40"
          >
            {OWNERS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset>
        <span className="block text-[11px] font-semibold uppercase tracking-wide text-court-fg-muted">
          Starting status
        </span>
        <div className="mt-1 inline-flex items-center gap-2">
          {(["WARMING", "HEALTHY"] as const).map((s) => (
            <label
              key={s}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
                status === s
                  ? "border-court-brand bg-court-brand-tint text-court-brand-dark"
                  : "border-court-border bg-court-surface text-court-fg-muted hover:text-court-fg",
              )}
            >
              <input
                type="radio"
                value={s}
                checked={status === s}
                onChange={() => setStatus(s)}
                className="sr-only"
              />
              {s}
            </label>
          ))}
        </div>
      </fieldset>

      {error && <p className="text-xs text-red-600 dark:text-red-300">{error}</p>}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="inline-flex items-center rounded-md border border-court-border bg-court-surface px-3 py-1.5 text-xs font-medium text-court-fg shadow-sm transition hover:bg-court-surface-subtle disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md border border-court-brand bg-court-brand-tint px-3 py-1.5 text-xs font-semibold text-court-brand-dark shadow-sm transition hover:bg-court-brand/25 disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Add
        </button>
      </div>
    </form>
  );
}

function DeleteDomainBtn({ id, domain }: { id: string; domain: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(`Remove ${domain} from the rotation pool?`)) return;
        startTransition(async () => {
          try {
            await deleteSendingDomain(id);
            router.refresh();
          } catch (e) {
            alert(e instanceof Error ? e.message : "Delete failed");
          }
        });
      }}
      className="rounded-md p-1.5 text-court-fg-muted transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-300 disabled:opacity-50"
      aria-label={`Remove ${domain}`}
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
    </button>
  );
}

function StatusPill({ status }: { status: string }) {
  const cls =
    status === "HEALTHY"
      ? "border-court-brand/30 bg-court-brand-tint text-court-brand-dark"
      : status === "WARMING"
        ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
        : "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200";
  const label = status === "HEALTHY" ? "Healthy" : status === "WARMING" ? "Warming" : "Cooled";
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold", cls)}>
      {label}
    </span>
  );
}

function ReputationBar({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-court-surface-subtle">
        <div
          className={cn(
            "h-full rounded-full",
            clamped >= 80
              ? "bg-court-brand"
              : clamped >= 50
                ? "bg-amber-400"
                : "bg-red-500",
          )}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="tabular-nums text-[11px] text-court-fg-muted">{clamped}</span>
    </div>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={cn("px-3 py-2 text-left font-medium", className)}>{children}</th>;
}

function Td({
  children,
  className,
  colSpan,
}: {
  children: React.ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td className={cn("px-3 py-2 text-court-fg", className)} colSpan={colSpan}>
      {children}
    </td>
  );
}
