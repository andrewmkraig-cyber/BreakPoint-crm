import { ExternalLink, Mail, Phone as PhoneIcon } from "lucide-react";
import { EmailPopupLauncher } from "@/components/email-popup-launcher";
import { formatLocation } from "@/lib/utils";

// Embed-only compact overview. Replaces the full editable identity card
// in the candidates split-view iframe so the top-left of the embed reads
// as a tight summary (name + employment + contact) under ~180px and the
// resume gets the rest of the left column. Editing still happens on the
// full-page profile — the split-view is for triage scanning.
export function CandidateCompactOverview({
  candidateRef,
  fullName,
  firstName,
  lastName,
  currentDesignation,
  currentOrganization,
  location,
  email,
  phone,
  linkedinProfile,
  compensation,
}: {
  candidateRef: string;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  currentDesignation: string | null;
  currentOrganization: string | null;
  location: string | null;
  email: string | null;
  phone: string | null;
  linkedinProfile: string | null;
  compensation: string | null;
}) {
  return (
    <section className="rounded-xl border border-court-border bg-court-surface px-4 py-3 shadow-sm">
      <h1 className="break-words font-serif text-lg font-bold leading-tight text-court-fg">
        {fullName}
      </h1>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        {/* Title and Employer get their own full-width rows so long
            titles like "Senior Director, Strategic Partnerships" and
            multi-word company names ("Heat and Control Inc.") render
            in full instead of clipping with an ellipsis. Email and
            Phone already use the same `wide noTruncate` treatment. */}
        <Field label="Title" wide noTruncate>{currentDesignation || "—"}</Field>
        <Field label="Employer" wide noTruncate>{currentOrganization || "—"}</Field>
        <Field label="Email" wide noTruncate>
          {email ? (
            <EmailPopupLauncher
              email={email}
              candidateRef={candidateRef}
              className="inline-flex max-w-full items-center gap-1 break-all text-brand-dark hover:underline"
              context={{
                candidate: {
                  firstName: firstName ?? "",
                  lastName: lastName ?? "",
                  email,
                  currentTitle: currentDesignation,
                  currentCompany: currentOrganization,
                },
              }}
            >
              <Mail className="h-3 w-3 shrink-0" />
              <span className="break-all">{email}</span>
            </EmailPopupLauncher>
          ) : (
            <span className="text-court-fg-muted">—</span>
          )}
        </Field>
        <Field label="Phone" wide noTruncate>
          {phone ? (
            <a
              href={`tel:${phone}`}
              className="inline-flex items-center gap-1 text-court-fg hover:text-brand-dark hover:underline"
            >
              <PhoneIcon className="h-3 w-3" />
              {phone}
            </a>
          ) : (
            <span className="text-court-fg-muted">—</span>
          )}
        </Field>
        <Field label="Location">{formatLocation(location) || "—"}</Field>
        <Field label="Comp">{compensation || "—"}</Field>
        <Field label="LinkedIn" wide>
          {linkedinProfile ? (
            <a
              href={linkedinProfile}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-brand-dark hover:underline"
            >
              Profile <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            <span className="text-court-fg-muted">—</span>
          )}
        </Field>
      </dl>
    </section>
  );
}

function Field({
  label,
  children,
  wide,
  noTruncate,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
  noTruncate?: boolean;
}) {
  return (
    <div className={wide ? "col-span-2" : undefined}>
      <dt className="text-[10px] uppercase tracking-wide text-court-fg-muted">
        {label}
      </dt>
      <dd
        className={
          "mt-0.5 text-sm text-court-fg " +
          (noTruncate ? "break-words" : "truncate")
        }
      >
        {children}
      </dd>
    </div>
  );
}
