"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Briefcase,
  Building2,
  ExternalLink,
  Loader2,
  Mail,
  MapPin,
  Pencil,
  Phone as PhoneIcon,
  Save,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { LabeledField } from "@/app/candidates/[id]/editable-helpers";
import { updateCandidate } from "@/app/candidates/[id]/actions";
import { formatPhone, telHref, normalizeToE164 } from "@/lib/rf-payload-shapes";
import { EmailPopupLauncher } from "@/components/email-popup-launcher";
import { cn, formatLocation } from "@/lib/utils";

// Consolidated identity card - replaces the old triple of standalone
// header band + EditableContact + EditableEmployment. Renders the
// candidate's name as the card heading (same big serif weight the
// header band used) and stacks every editable identity field below
// (email, phone, location, linkedin, current title, current employer,
// expected comp) inside one Edit/Save flow. Single updateCandidate
// call commits all fields together so the recruiter never has to
// click Edit twice.

export type IdentityState = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  location: string;
  linkedin_profile: string;
  current_designation: string;
  current_organization: string;
  expected_salary: string; // free-text in the editor; parsed on save
  expected_currency: string;
};

export function EditableIdentity({
  candidateId,
  initial,
}: {
  candidateId: number;
  initial: IdentityState;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState<IdentityState>(initial);
  const [draft, setDraft] = useState<IdentityState>(initial);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startSave] = useTransition();

  // Click-to-call confirmation reuses the same dialog the old
  // EditableContact had. Logs the call to /api/calls (keepalive) before
  // handing off to the system tel: handler so the row never orphans.
  const [callDialogOpen, setCallDialogOpen] = useState(false);
  const [callingBusy, setCallingBusy] = useState(false);

  function onSave() {
    setError(null);
    const phone = normalizeToE164(draft.phone) ?? "";
    const next: IdentityState = { ...draft, phone };
    const salaryNumber = parseCompensation(next.expected_salary);
    const currency = (next.expected_currency || "USD").toUpperCase().slice(0, 3);
    startSave(async () => {
      const result = await updateCandidate({
        id: candidateId,
        first_name: next.first_name.trim(),
        last_name: next.last_name.trim(),
        email: next.email.trim() || undefined,
        phone_number: next.phone.trim() || undefined,
        linkedin_profile: next.linkedin_profile.trim() || undefined,
        location: { location: next.location.trim() || undefined },
        current_designation: next.current_designation.trim(),
        current_organization: next.current_organization.trim(),
        expected_salary:
          salaryNumber == null ? null : { number: salaryNumber, currency },
      });
      if (!result.ok) {
        setError(result.error);
        toast.error("Couldn't save identity", { description: result.error });
        return;
      }
      setSaved(next);
      setEditing(false);
      toast.success("Identity saved");
      router.refresh();
    });
  }

  function onCancel() {
    setDraft(saved);
    setEditing(false);
    setError(null);
  }

  async function onConfirmCall() {
    const number = saved.phone;
    if (!number) return;
    setCallingBusy(true);
    try {
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
        // background log; never block the dialer handoff.
      });
      window.location.href = telHref(number);
    } finally {
      setCallingBusy(false);
      setCallDialogOpen(false);
    }
  }

  const candidateFullName =
    [saved.first_name, saved.last_name].filter(Boolean).join(" ").trim() ||
    "(unnamed)";

  return (
    <div className="rounded-xl border border-court-border bg-court-surface shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-court-border px-5 py-4">
        <h1 className="break-words font-serif text-2xl font-bold leading-tight text-court-fg">
          {candidateFullName}
        </h1>
        {!editing ? (
          <EditBtn onClick={() => setEditing(true)} />
        ) : (
          <SaveCancel saving={isPending} onSave={onSave} onCancel={onCancel} />
        )}
      </div>
      <div className="p-5">
        {editing ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <LabeledField
              label="First name"
              value={draft.first_name}
              onChange={(v) => setDraft({ ...draft, first_name: v })}
            />
            <LabeledField
              label="Last name"
              value={draft.last_name}
              onChange={(v) => setDraft({ ...draft, last_name: v })}
            />
            <LabeledField
              label="Email"
              type="email"
              value={draft.email}
              onChange={(v) => setDraft({ ...draft, email: v })}
            />
            <LabeledField
              label="Phone"
              value={draft.phone}
              onChange={(v) => setDraft({ ...draft, phone: v })}
              placeholder="+1 216-555-5555"
            />
            <div className="sm:col-span-2">
              <LabeledField
                label="Location"
                value={draft.location}
                onChange={(v) => setDraft({ ...draft, location: v })}
                placeholder="Cleveland, OH"
              />
            </div>
            <div className="sm:col-span-2">
              <LabeledField
                label="LinkedIn URL"
                type="url"
                value={draft.linkedin_profile}
                onChange={(v) => setDraft({ ...draft, linkedin_profile: v })}
                placeholder="https://linkedin.com/in/…"
              />
            </div>
            <div className="sm:col-span-2">
              <LabeledField
                label="Current title"
                value={draft.current_designation}
                onChange={(v) => setDraft({ ...draft, current_designation: v })}
              />
            </div>
            <div className="sm:col-span-2">
              <LabeledField
                label="Current employer"
                value={draft.current_organization}
                onChange={(v) =>
                  setDraft({ ...draft, current_organization: v })
                }
              />
            </div>
            <LabeledField
              label="Expected comp"
              value={draft.expected_salary}
              onChange={(v) => setDraft({ ...draft, expected_salary: v })}
              placeholder="e.g. 120000 or 120k"
            />
            <LabeledField
              label="Currency"
              value={draft.expected_currency}
              onChange={(v) => setDraft({ ...draft, expected_currency: v })}
              placeholder="USD"
            />
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800 sm:col-span-2">
                {error}
              </div>
            )}
          </div>
        ) : (
          <dl className="space-y-3 text-sm">
            <Row label="Email" icon={<Mail className="h-3 w-3" />}>
              {saved.email ? (
                <EmailPopupLauncher
                  email={saved.email}
                  className="text-brand-dark hover:underline"
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
            <Row label="Location" icon={<MapPin className="h-3 w-3" />}>
              <span>{formatLocation(saved.location) || "—"}</span>
            </Row>
            <Row label="LinkedIn">
              {saved.linkedin_profile ? (
                <a
                  href={saved.linkedin_profile}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-brand-dark hover:underline"
                >
                  Profile <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                <span className="text-court-fg-muted">—</span>
              )}
            </Row>
            <Row label="Current title" icon={<Briefcase className="h-3 w-3" />}>
              <span>{saved.current_designation || "—"}</span>
            </Row>
            <Row
              label="Current employer"
              icon={<Building2 className="h-3 w-3" />}
            >
              <span>{saved.current_organization || "—"}</span>
            </Row>
            <Row label="Expected compensation">
              <span>
                {formatSalaryForDisplay(
                  saved.expected_salary,
                  saved.expected_currency,
                ) || "—"}
              </span>
            </Row>
          </dl>
        )}
      </div>
      {callDialogOpen && saved.phone && (
        <CallConfirmDialog
          candidateName={candidateFullName}
          phone={saved.phone}
          busy={callingBusy}
          onCancel={() => setCallDialogOpen(false)}
          onConfirm={() => void onConfirmCall()}
        />
      )}
    </div>
  );
}

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
          <h3 className="font-serif text-base font-semibold text-court-fg">
            Place a call
          </h3>
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
            {busy ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <PhoneIcon className="h-3 w-3" />
            )}
            Call
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-court-fg-muted">
        {label}
      </dt>
      <dd className="mt-0.5 inline-flex items-center gap-1 text-court-fg">
        {icon}
        {children}
      </dd>
    </div>
  );
}

function EditBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:border-court-brand/40 hover:text-court-fg"
    >
      <Pencil className="h-3 w-3" /> Edit
    </button>
  );
}

function SaveCancel({
  saving,
  onSave,
  onCancel,
}: {
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
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
        className="inline-flex items-center gap-1 rounded-md bg-court-brand px-3 py-1 text-[11px] font-semibold text-white shadow-sm transition hover:bg-court-brand-dark disabled:opacity-60"
      >
        {saving ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Save className="h-3 w-3" />
        )}
        Save
      </button>
    </div>
  );
}

function parseCompensation(raw: string): number | null {
  const trimmed = raw.trim().toLowerCase().replace(/[\s,$]/g, "");
  if (!trimmed) return null;
  const m = trimmed.match(/^(\d+(?:\.\d+)?)([km])?$/);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (m[2] === "k") n *= 1000;
  if (m[2] === "m") n *= 1_000_000;
  return Math.round(n);
}

function formatSalaryForDisplay(raw: string, currency: string): string {
  const n = parseCompensation(raw);
  if (n == null) return "";
  const sym =
    (currency || "USD").toUpperCase() === "USD"
      ? "$"
      : `${currency.toUpperCase()} `;
  if (n >= 1000)
    return `${sym}${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return `${sym}${n}`;
}
