"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, MapPin, Clock, Mail, X } from "lucide-react";
import { toast } from "sonner";

import { ClientLogo } from "@/components/clients/client-logo";
import { cn } from "@/lib/utils";
import { markSignalActed, markSignalDismissed } from "./actions";

export type SignalRowData = {
  id: string;
  companyName: string;
  // Client domain (Client.domain) - the SAME field the Clients page keys its
  // logo on, so Client Signals shows the identical favicon. null falls back to
  // the initials chip in ClientLogo.
  domain: string | null;
  matchedClientHref: string | null;
  jobTitle: string;
  jobLocation: string | null;
  postedLabel: string;
  jobPostingUrl: string | null;
  status: "NEW" | "ACTED" | "DISMISSED";
  source: "BD_DISCOVERY" | "CLIENT_MONITOR";
};

// Single client-signal row. Renders inert button states while a
// transition is in flight so a double-click can't fire two updates.
export function SignalRow(props: SignalRowData) {
  const router = useRouter();
  const [isPending, start] = useTransition();
  const { id, status } = props;

  function onReachOut() {
    start(async () => {
      const r = await markSignalActed(id);
      if (!r.ok) {
        toast.error("Couldn't mark as reached out", { description: r.error });
        return;
      }
      toast.success("Marked as reached out");
      router.refresh();
    });
  }

  function onDismiss() {
    start(async () => {
      const r = await markSignalDismissed(id);
      if (!r.ok) {
        toast.error("Couldn't dismiss signal", { description: r.error });
        return;
      }
      toast.success("Signal dismissed");
      router.refresh();
    });
  }

  const reachedOut = status === "ACTED";
  const dismissed = status === "DISMISSED";

  return (
    <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1.5fr)_auto] sm:items-center sm:p-5">
      <div className="flex items-center gap-3">
        <ClientLogo name={props.companyName} domain={props.domain} size={32} />
        <div className="min-w-0">
          {props.matchedClientHref ? (
            <a
              href={props.matchedClientHref}
              className="truncate text-sm font-semibold text-court-fg hover:text-court-brand-dark hover:underline"
            >
              {props.companyName}
            </a>
          ) : (
            <p className="truncate text-sm font-semibold text-court-fg">
              {props.companyName}
            </p>
          )}
          <p className="truncate text-xs text-court-fg-muted">
            {props.matchedClientHref ? "Existing client" : "Soft match"}
          </p>
        </div>
      </div>

      <div className="min-w-0 text-sm">
        <p className="truncate font-medium text-court-fg">{props.jobTitle || "Untitled posting"}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-court-fg-muted">
          {props.jobLocation && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" /> {props.jobLocation}
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" /> Posted {props.postedLabel}
          </span>
          <span
            title={
              props.source === "CLIENT_MONITOR"
                ? "Surfaced by the nightly direct scan of your existing clients"
                : "Surfaced by a BD discovery run that matched an existing client"
            }
            className={cn(
              "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              props.source === "CLIENT_MONITOR"
                ? "border-court-brand/30 bg-court-brand-tint text-court-brand-dark"
                : "border-court-border bg-court-surface-subtle text-court-fg-muted",
            )}
          >
            {props.source === "CLIENT_MONITOR" ? "Client monitor" : "BD discovery"}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {props.jobPostingUrl && (
          <a
            href={props.jobPostingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-court-border bg-court-surface px-3 py-1.5 text-xs font-medium text-court-fg shadow-sm transition hover:bg-court-surface-subtle"
          >
            <ExternalLink className="h-3.5 w-3.5" /> View listing
          </a>
        )}
        <button
          type="button"
          onClick={onReachOut}
          disabled={isPending || reachedOut}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-3.5 py-1.5 text-xs font-semibold shadow-sm transition",
            reachedOut
              ? "cursor-default border-court-brand bg-court-brand-tint text-court-brand-dark opacity-80"
              : "border-court-brand bg-court-brand-tint text-court-brand-dark hover:bg-court-brand hover:text-white",
            isPending && "opacity-60",
          )}
        >
          <Mail className="h-3.5 w-3.5" />
          {reachedOut ? "Reached out" : "Reach out"}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          disabled={isPending || dismissed}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border border-court-border bg-court-surface px-2.5 py-1.5 text-xs font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg",
            dismissed && "cursor-default opacity-60",
            isPending && "opacity-60",
          )}
        >
          <X className="h-3.5 w-3.5" />
          {dismissed ? "Dismissed" : "Dismiss"}
        </button>
      </div>
    </div>
  );
}
