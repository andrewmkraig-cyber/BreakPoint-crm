"use client";

import { useEffect, useState } from "react";
import { Loader2, Send, X } from "lucide-react";
import { toast } from "sonner";
import {
  getInterviewInviteState,
  updateInterviewInvite,
  type InviteParty,
} from "./interview-invite-actions";

// Inline edit-and-resend popup mounted on the dashboard. Loads the live
// calendar event for each party so the recruiter is editing what's
// actually on the calendar — not a stale local copy. Each party is its
// own form with To / Subject / Body and an independent Send button so
// resending the client invite without touching the candidate side is one
// click. Falls through to the canonical sendInterviewInvite when no
// per-party event exists yet (first send).

type Props = {
  interviewId: string;
  whenLabel: string;
  jobLabel: string;
  onClose: () => void;
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | {
      status: "ready";
      candidateName: string;
      client: InviteParty;
      candidate: InviteParty;
    };

export function InterviewInvitePopup({ interviewId, whenLabel, jobLabel, onClose }: Props) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await getInterviewInviteState(interviewId);
      if (cancelled) return;
      if (!result.ok) {
        setState({ status: "error", error: result.error });
        return;
      }
      setState({
        status: "ready",
        candidateName: result.value.candidateName,
        client: result.value.client,
        candidate: result.value.candidate,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [interviewId]);

  function patchParty(party: "client" | "candidate", next: InviteParty) {
    setState((s) => (s.status === "ready" ? { ...s, [party]: next } : s));
  }

  return (
    <div
      role="dialog"
      aria-label="Edit calendar invite"
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-court-border bg-court-surface p-5 shadow-2xl"
      >
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-serif text-base font-semibold text-court-fg">
              Edit calendar invite
            </h2>
            <p className="mt-0.5 text-xs text-court-fg-muted">
              {whenLabel} · {jobLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {state.status === "loading" && (
          <div className="flex items-center gap-2 py-10 text-sm text-court-fg-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading current invite…
          </div>
        )}

        {state.status === "error" && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {state.error}
          </div>
        )}

        {state.status === "ready" && (
          <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
            <PartyForm
              title="Client invite"
              interviewId={interviewId}
              candidateName={state.candidateName}
              party={state.client}
              onChange={(next) => patchParty("client", next)}
            />
            <PartyForm
              title="Candidate invite"
              interviewId={interviewId}
              candidateName={state.candidateName}
              party={state.candidate}
              onChange={(next) => patchParty("candidate", next)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function PartyForm({
  title,
  interviewId,
  candidateName,
  party,
  onChange,
}: {
  title: string;
  interviewId: string;
  candidateName: string;
  party: InviteParty;
  onChange: (next: InviteParty) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function onSend() {
    if (!party.to.trim()) {
      toast.error("Add a recipient", { description: "The To: field is empty." });
      return;
    }
    setBusy(true);
    const result = await updateInterviewInvite({
      interviewId,
      party: party.party,
      attendeeEmail: party.to.trim(),
      attendeeName: party.party === "candidate" ? candidateName : undefined,
      subject: party.subject,
      body: party.body,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(`${title} failed`, { description: result.error });
      return;
    }
    toast.success(party.hasEvent ? `${title} updated` : `${title} sent`, {
      description: party.hasEvent
        ? "Google emailed attendees the updated invite."
        : "Google emailed the native invite with Accept / Maybe / Decline.",
    });
    // Mark hasEvent true so the CTA flips from "Send" to "Resend" without
    // needing to refetch state from the server.
    onChange({ ...party, hasEvent: true });
  }

  return (
    <section className="rounded-lg border border-court-border bg-court-surface-subtle/40 p-3">
      <header className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-court-fg-muted">
          {title}
        </h3>
        <span
          className={
            "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider " +
            (party.hasEvent
              ? "bg-court-accent-tint text-court-accent-dark"
              : "bg-amber-100 text-amber-800")
          }
        >
          {party.hasEvent ? "Sent" : "Not sent"}
        </span>
      </header>

      <label className="mb-2 block">
        <span className="mb-0.5 block text-[11px] font-medium text-court-fg-muted">To</span>
        <input
          type="email"
          value={party.to}
          onChange={(e) => onChange({ ...party, to: e.target.value })}
          disabled={busy}
          placeholder="name@example.com"
          className="w-full rounded-md border border-court-border bg-court-surface px-2 py-1.5 text-sm text-court-fg outline-none focus:ring-2 focus:ring-court-accent/30"
        />
      </label>

      <label className="mb-2 block">
        <span className="mb-0.5 block text-[11px] font-medium text-court-fg-muted">Subject</span>
        <input
          type="text"
          value={party.subject}
          onChange={(e) => onChange({ ...party, subject: e.target.value })}
          disabled={busy}
          className="w-full rounded-md border border-court-border bg-court-surface px-2 py-1.5 text-sm text-court-fg outline-none focus:ring-2 focus:ring-court-accent/30"
        />
      </label>

      <label className="block">
        <span className="mb-0.5 block text-[11px] font-medium text-court-fg-muted">Description</span>
        <textarea
          value={party.body}
          onChange={(e) => onChange({ ...party, body: e.target.value })}
          disabled={busy}
          rows={8}
          className="w-full resize-y rounded-md border border-court-border bg-court-surface px-2 py-1.5 text-sm text-court-fg outline-none focus:ring-2 focus:ring-court-accent/30"
        />
      </label>

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={onSend}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md border border-court-accent bg-court-accent-tint px-3 py-1.5 text-xs font-semibold text-court-accent-dark transition hover:bg-court-accent/20 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
          {party.hasEvent ? "Resend invite" : "Send invite"}
        </button>
      </div>
    </section>
  );
}
