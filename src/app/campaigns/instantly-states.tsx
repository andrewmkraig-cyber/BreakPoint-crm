"use client";

import type { ReactNode } from "react";
import { AlertTriangle, Inbox, KeyRound, Clock, CloudOff } from "lucide-react";

// Shared empty / error states for the Campaigns surface.
//
// Chrome is the dashed-box empty state already used across the app
// (candidate lists, settings sections) - no new visual language. The
// point of this component is that the five error kinds from
// lib/instantly/errors each get an honest, actionable message instead of
// one generic "something went wrong".

export function InstantlyEmptyState({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-court-border bg-court-surface-subtle/40 px-6 py-12 text-center">
      <Inbox aria-hidden="true" className="mx-auto mb-3 h-6 w-6 text-court-fg-muted" />
      <div className="text-sm font-semibold text-court-fg">{title}</div>
      {children ? (
        <div className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-court-fg-muted">
          {children}
        </div>
      ) : null}
    </div>
  );
}

const KIND_ICON: Record<string, typeof AlertTriangle> = {
  not_configured: KeyRound,
  bad_key: KeyRound,
  insufficient_scope: KeyRound,
  rate_limited: Clock,
  unavailable: CloudOff,
};

// Transient failures read as amber (wait and retry); credential and
// request failures read as red (something must be changed).
function toneFor(kind: string): "warn" | "error" {
  return kind === "rate_limited" || kind === "unavailable" ? "warn" : "error";
}

export function InstantlyErrorState({
  kind,
  message,
  hint,
}: {
  kind: string;
  message: string;
  hint?: string;
}) {
  const Icon = KIND_ICON[kind] ?? AlertTriangle;
  const tone = toneFor(kind);
  return (
    <div
      className={
        "rounded-xl border border-dashed px-6 py-10 text-center " +
        (tone === "warn"
          ? "border-amber-500/40 bg-amber-500/5"
          : "border-red-500/40 bg-red-500/5")
      }
    >
      <Icon
        aria-hidden="true"
        className={
          "mx-auto mb-3 h-6 w-6 " +
          (tone === "warn" ? "text-amber-600" : "text-red-600")
        }
      />
      <div className="text-sm font-semibold text-court-fg">{message}</div>
      {hint ? (
        <div className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-court-fg-muted">
          {hint}
        </div>
      ) : null}
      <div className="mt-3 text-[10px] uppercase tracking-[0.18em] text-court-fg-muted">
        {kind.replace(/_/g, " ")}
      </div>
    </div>
  );
}
