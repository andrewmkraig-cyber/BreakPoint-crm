"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Save, X, Mail, Phone as PhoneIcon, MapPin, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { SectionCard, LabeledField } from "@/app/candidates/[id]/editable-helpers";
import { updateCandidate } from "@/app/candidates/[id]/actions";
import { formatPhone, telHref, normalizeToE164 } from "@/lib/rf-payload-shapes";
import { EmailPopupLauncher } from "@/components/email-popup-launcher";
import { cn, formatLocation } from "@/lib/utils";

export type ContactState = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  location: string;
  linkedin_profile: string;
};

export function EditableContact({ candidateId, initial }: { candidateId: number; initial: ContactState }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState<ContactState>(initial);
  const [draft, setDraft] = useState<ContactState>(initial);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startSave] = useTransition();
  // Click-to-call confirmation state. Clicking the displayed phone number
  // opens a small dialog ("Call [name] at [number]?") instead of firing the
  // tel: handler directly — lets Andrew cancel an accidental click before
  // the browser dispatches to the system dialer (or Krispcall, if set as
  // the default).
  const [callDialogOpen, setCallDialogOpen] = useState(false);
  const [callingBusy, setCallingBusy] = useState(false);

  function onSave() {
    setError(null);
    const phone = normalizeToE164(draft.phone) ?? "";
    const next: ContactState = { ...draft, phone };
    startSave(async () => {
      const result = await updateCandidate({
        id: candidateId,
        first_name: next.first_name.trim(),
        last_name: next.last_name.trim(),
        email: next.email.trim() || undefined,
        phone_number: next.phone.trim() || undefined,
        linkedin_profile: next.linkedin_profile.trim() || undefined,
        location: { location: next.location.trim() || undefined },
      });
      if (!result.ok) {
        setError(result.error);
        toast.error("Couldn't save contact", { description: result.error });
        return;
      }
      setSaved(next);
      setEditing(false);
      toast.success("Contact saved");
      router.refresh();
    });
  }

  function onCancel() {
    setDraft(saved);
    setEditing(false);
    setError(null);
  }

  // Fires the tel: link AND persists a CallLog row. We log FIRST (via fetch,
  // don't await its Promise before the tel: nav) so an accidental page
  // navigation or dialer handoff doesn't orphan the log call. The log POST
  // runs in the background with keepalive so the request survives the
  // navigation. tel: handoff is synchronous on the current window: the
  // browser either opens the system dialer or hands off to Krispcall's
  // registered protocol handler.
  async function onConfirmCall() {
    const number = saved.phone;
    if (!number) return;
    setCallingBusy(true);
    try {
      // Fire-and-forget log write. keepalive: true lets the request survive
      // the window navigation that tel: triggers on some browsers.
      void fetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          candidateId: String(candidateId),
          direction: "outbound",
          fromNumber: "",
          toNumber: number,
          status: "initiated",
        }),
      }).catch(() => {
        // swallow — the Call button UX should not block on a log write.
      });
      // Hand off to the default tel: handler (Krispcall when set as default,
      // else the OS dialer / FaceTime / etc.).
      window.location.href = telHref(number);
    } finally {
      setCallingBusy(false);
      setCallDialogOpen(false);
    }
  }

  const candidateFullName =
    [saved.first_name, saved.last_name].filter(Boolean).join(" ").trim() || "this candidate";

  return (
    <SectionCard
      title="Contact"
      right={
        !editing ? (
          <EditBtn onClick={() => setEditing(true)} />
        ) : (
          <SaveCancel saving={isPending} onSave={onSave} onCancel={onCancel} />
        )
      }
    >
      {editing ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <LabeledField label="First name" value={draft.first_name} onChange={(v) => setDraft({ ...draft, first_name: v })} />
          <LabeledField label="Last name" value={draft.last_name} onChange={(v) => setDraft({ ...draft, last_name: v })} />
          <LabeledField label="Email" type="email" value={draft.email} onChange={(v) => setDraft({ ...draft, email: v })} />
          <LabeledField label="Phone" value={draft.phone} onChange={(v) => setDraft({ ...draft, phone: v })} placeholder="+1 216-555-5555" />
          <div className="sm:col-span-2">
            <LabeledField label="Location" value={draft.location} onChange={(v) => setDraft({ ...draft, location: v })} placeholder="Cleveland, OH" />
          </div>
          <div className="sm:col-span-2">
            <LabeledField label="LinkedIn URL" type="url" value={draft.linkedin_profile} onChange={(v) => setDraft({ ...draft, linkedin_profile: v })} placeholder="https://linkedin.com/in/…" />
          </div>
          {error && <div className="sm:col-span-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{error}</div>}
        </div>
      ) : (
        <dl className="space-y-3 text-sm">
          <Row label="Email" icon={<Mail className="h-3 w-3" />}>
            {saved.email ? (
              <EmailPopupLauncher
                email={saved.email}
                className="text-brand-dark hover:underline"
                // RF-imported page: candidateId here is the legacy
                // numeric rfId. Smart-context API accepts either rfId
                // or cuid as the path segment.
                candidateRef={String(candidateId)}
                context={{
                  candidate: {
                    firstName: saved.first_name,
                    lastName: saved.last_name,
                    email: saved.email,
                  },
                }}
              >
                {saved.email}
              </EmailPopupLauncher>
            ) : (
              <span className="text-court-fg-muted">—</span>
            )}
          </Row>
          <Row label="Phone" icon={<PhoneIcon className="h-3 w-3" />}>
            {saved.phone ? (
              <button
                type="button"
                onClick={() => setCallDialogOpen(true)}
                className="text-court-fg underline-offset-2 hover:text-brand-dark hover:underline"
                title="Click to call"
              >
                {formatPhone(saved.phone)}
              </button>
            ) : (
              <span className="text-court-fg-muted">—</span>
            )}
          </Row>
          <Row label="LinkedIn">
            {saved.linkedin_profile ? (
              <a href={saved.linkedin_profile} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-dark hover:underline">
                Profile <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <span className="text-court-fg-muted">—</span>
            )}
          </Row>
          <Row label="Location" icon={<MapPin className="h-3 w-3" />}>
            <span>{formatLocation(saved.location) || "—"}</span>
          </Row>
        </dl>
      )}
      {callDialogOpen && saved.phone && (
        <CallConfirmDialog
          candidateName={candidateFullName}
          phone={saved.phone}
          busy={callingBusy}
          onCancel={() => setCallDialogOpen(false)}
          onConfirm={() => void onConfirmCall()}
        />
      )}
    </SectionCard>
  );
}

// Small centered confirmation modal. Keeps scope local to EditableContact
// rather than routing through the generic Modal used elsewhere (simpler, no
// extra imports, and its only job is two buttons + a one-sentence prompt).
function CallConfirmDialog({
  candidateName,
  phone,
  busy,
  onCancel,
  onConfirm,
}: {
  candidateName: string;
  phone: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-sm overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-xl">
        <div className="flex items-start justify-between border-b border-court-border px-5 py-3">
          <h3 className="font-serif text-base font-semibold text-court-fg">Place a call</h3>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md p-1 text-court-fg-muted hover:bg-court-surface-subtle disabled:opacity-60"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4 text-sm text-court-fg">
          Call <span className="font-semibold">{candidateName}</span> at{" "}
          <span className="font-mono">{formatPhone(phone)}</span>?
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-court-border bg-court-surface-subtle/30 px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-3 py-1.5 text-xs font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition",
              "bg-court-brand hover:bg-court-brand-dark disabled:opacity-60",
            )}
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <PhoneIcon className="h-3 w-3" />}
            Call
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-court-fg-muted">{label}</dt>
      <dd className="mt-0.5 inline-flex items-center gap-1 text-court-fg">
        {icon}
        {children}
      </dd>
    </div>
  );
}

export function EditBtn({ onClick, label = "Edit" }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:border-brand/40 hover:text-court-fg"
    >
      <Pencil className="h-3 w-3" /> {label}
    </button>
  );
}

export function SaveCancel({
  saving,
  onSave,
  onCancel,
}: {
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onCancel}
        disabled={saving}
        className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg disabled:opacity-60"
      >
        <X className="h-3 w-3" /> Cancel
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-1 text-[11px] font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
      >
        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
        Save
      </button>
    </div>
  );
}
