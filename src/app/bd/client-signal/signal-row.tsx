"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, MapPin, Clock, Mail, X } from "lucide-react";
import { toast } from "sonner";

import { ClientLogo } from "@/components/clients/client-logo";
import { EmailComposer, type EmailDraft } from "@/components/email-composer";
import { sendEmailAction, scheduleEmailAction } from "@/app/email/actions";
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
  // Primary client contact, resolved server-side. Null email opens the
  // Reach-out composer with To blank.
  contactEmail: string | null;
  contactFirstName: string | null;
};

type SignalRowProps = SignalRowData & {
  // Optimistic-list hooks supplied by SignalList. onRemove drops the row from
  // view immediately on Dismiss; onRestore puts it back if the write fails.
  onRemove?: (id: string) => void;
  onRestore?: (id: string) => void;
};

// Builds the Reach-out email pre-fill from the signal's job + contact data.
// Placeholders that have no data resolve to natural fallbacks so no raw
// bracket text ever leaks into the draft.
function buildReachOutDraft(props: SignalRowData): EmailDraft {
  const firstName = props.contactFirstName?.trim() || "there";
  const title = props.jobTitle?.trim();
  const titlePhrase = title || "the open";
  const location = props.jobLocation?.trim();
  const locationPhrase = location ? ` in ${location}` : "";
  const relevant = title ? `strong ${title}` : "strong";

  const subject = title
    ? `Quick question re: ${title} search`
    : "Quick question re: your search";

  const body = `Hi ${firstName},\n\nI noticed you have a ${titlePhrase} role posted${locationPhrase}. I work with a number of ${relevant} candidates and think I could help. Would you be open to a quick call to discuss the search?\n\nBest,\nAndrew`;

  return {
    to: props.contactEmail ? [props.contactEmail] : [],
    cc: [],
    bcc: [],
    subject,
    body,
  };
}

// Single client-signal row. Renders inert button states while a
// transition is in flight so a double-click can't fire two updates.
export function SignalRow(props: SignalRowProps) {
  const router = useRouter();
  const [isPending, start] = useTransition();
  const [composerOpen, setComposerOpen] = useState(false);
  const { id, status } = props;

  function onReachOut() {
    setComposerOpen(true);
  }

  function onDismiss() {
    // Optimistic: drop the row instantly, then persist. Restore on failure so
    // a NEW signal isn't silently hidden until the next full reload.
    props.onRemove?.(id);
    start(async () => {
      const r = await markSignalDismissed(id);
      if (!r.ok) {
        toast.error("Couldn't dismiss signal", { description: r.error });
        props.onRestore?.(id);
        return;
      }
      toast.success("Signal dismissed");
      router.refresh();
    });
  }

  const reachedOut = status === "ACTED";
  const dismissed = status === "DISMISSED";

  return (
    <>
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

    {composerOpen && (
      <EmailComposer
        title="Reach out"
        subtitle={props.companyName}
        initial={buildReachOutDraft(props)}
        onClose={() => setComposerOpen(false)}
        onSend={async (draft: EmailDraft) => {
          const result = await sendEmailAction({
            to: draft.to,
            cc: draft.cc,
            bcc: draft.bcc,
            subject: draft.subject,
            bodyText: draft.body,
          });
          if (!result.ok) {
            throw new Error(result.error);
          }
          toast.success("Email sent", { description: `Sent to ${draft.to.join(", ")}.` });
          setComposerOpen(false);
          // Sending IS the reach-out; record it so the signal moves to "Acted on".
          const acted = await markSignalActed(id);
          if (!acted.ok) {
            toast.error("Sent, but couldn't mark as reached out", { description: acted.error });
          }
          router.refresh();
        }}
        onSendLater={async (
          draft: EmailDraft,
          scheduledSendAtISO: string,
          timezone: string,
        ) => {
          const result = await scheduleEmailAction({
            to: draft.to,
            cc: draft.cc,
            bcc: draft.bcc,
            subject: draft.subject,
            bodyText: draft.body,
            scheduledSendAt: scheduledSendAtISO,
            timezone,
          });
          if (!result.ok) {
            throw new Error(result.error);
          }
          setComposerOpen(false);
          const acted = await markSignalActed(id);
          if (!acted.ok) {
            toast.error("Scheduled, but couldn't mark as reached out", { description: acted.error });
          }
          router.refresh();
        }}
      />
    )}
    </>
  );
}
