"use client";

import {
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  ExternalLink,
  Loader2,
  Mail,
  Pencil,
  Phone as PhoneIcon,
  Plus,
  Save,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { EmailPopupLauncher } from "@/components/email-popup-launcher";
import { Button } from "@/components/ui/button";
import { MaskedCurrencyInput } from "@/components/ui/masked-currency-input";
import { cn, formatLocation } from "@/lib/utils";
import { updateCandidate } from "@/app/candidates/[id]/actions";
import { buildTokenColorMap } from "@/app/candidates/[id]/resume-matches-rail";
import type { CandidateCompactOverviewExpectedSalary } from "@/components/candidate-overview-helpers";

// Re-export the shared type from the helper module so existing
// `import { CandidateCompactOverviewExpectedSalary } from
// "@/components/candidate-compact-overview"` callers keep working
// without a hop through a second module path. The runtime helper
// (toExpectedSalary) lives in candidate-overview-helpers.ts because
// server components need to call it during SSR — exporting it from
// here would make it a client reference and 500 the page render.
export type { CandidateCompactOverviewExpectedSalary };

// Right-rail compact overview shared by the candidate full-page profile
// and the candidates split-view embed.
//
// Edit model: a single Edit button (matching the client overview card
// style) flips all editable fields — Title, Employer, Location, Comp,
// Email(s), Phone(s) — into edit mode at once. Save commits every field
// together, Cancel discards. Email and Phone are multi-value: the first
// row is the primary (the unique Candidate.email / Candidate.phone), and
// any additional rows persist to Candidate.altEmails / altPhones. LinkedIn
// stays read-only; it has a dedicated surface elsewhere on the profile.
//
// highlightTokens is optional. When passed, name + title + employer +
// location wrap matching substrings in the same TOKEN_COLORS palette
// the resume chip strip + in-PDF marks use so a token's chip color and
// its mention in the candidate header read as the same hue. The
// split-view passes the tokens it surfaced from the rail (already
// filtered to ones that actually hit on this candidate).
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
  altEmails,
  altPhones,
  linkedinProfile,
  expectedSalary,
  highlightTokens,
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
  altEmails?: string[];
  altPhones?: string[];
  linkedinProfile: string | null;
  expectedSalary: CandidateCompactOverviewExpectedSalary | null;
  highlightTokens?: string[];
}) {
  const router = useRouter();

  const [titleSaved, setTitleSaved] = useState(currentDesignation ?? "");
  const [employerSaved, setEmployerSaved] = useState(currentOrganization ?? "");
  const [locationSaved, setLocationSaved] = useState(location ?? "");
  const [compSaved, setCompSaved] = useState<CandidateCompactOverviewExpectedSalary | null>(
    expectedSalary,
  );
  // Full ordered contact lists (index 0 is the primary, unique value).
  const [emailsSaved, setEmailsSaved] = useState<string[]>(
    [email ?? "", ...(altEmails ?? [])].map((e) => e.trim()).filter(Boolean),
  );
  const [phonesSaved, setPhonesSaved] = useState<string[]>(
    [phone ?? "", ...(altPhones ?? [])].map((p) => p.trim()).filter(Boolean),
  );

  // Edit mode flips all four fields at once. Drafts seed from the saved
  // values whenever editing flips off (matches the client overview card
  // model, so canceling restores the exact persisted shape).
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(titleSaved);
  const [employerDraft, setEmployerDraft] = useState(employerSaved);
  const [locationDraft, setLocationDraft] = useState(locationSaved);
  const [compDraft, setCompDraft] = useState<string>(formatCompForEdit(compSaved));
  const [emailsDraft, setEmailsDraft] = useState<string[]>(emailsSaved);
  const [phonesDraft, setPhonesDraft] = useState<string[]>(phonesSaved);
  const [isSaving, startSave] = useTransition();

  useEffect(() => {
    if (editing) return;
    setTitleDraft(titleSaved);
    setEmployerDraft(employerSaved);
    setLocationDraft(locationSaved);
    setCompDraft(formatCompForEdit(compSaved));
    setEmailsDraft(emailsSaved);
    setPhonesDraft(phonesSaved);
  }, [editing, titleSaved, employerSaved, locationSaved, compSaved, emailsSaved, phonesSaved]);

  const tokens = useMemo(
    () => (highlightTokens ?? []).filter((t) => t.trim().length > 0),
    [highlightTokens],
  );
  const colorMap = useMemo(() => buildTokenColorMap(tokens), [tokens]);

  function beginEdit() {
    setTitleDraft(titleSaved);
    setEmployerDraft(employerSaved);
    setLocationDraft(locationSaved);
    setCompDraft(formatCompForEdit(compSaved));
    // Seed at least one empty row so the recruiter can type straight away.
    setEmailsDraft(emailsSaved.length ? emailsSaved : [""]);
    setPhonesDraft(phonesSaved.length ? phonesSaved : [""]);
    setEditing(true);
  }

  function cancelEdit() {
    if (isSaving) return;
    setEditing(false);
  }

  function commitEdit() {
    const nextTitle = titleDraft.trim();
    const nextEmployer = employerDraft.trim();
    const nextLocation = locationDraft.trim();
    const nextCompNumber = parseCompensation(compDraft.trim());
    const currency = (compSaved?.currency ?? "USD").toUpperCase().slice(0, 3) || "USD";
    const nextComp: CandidateCompactOverviewExpectedSalary | null =
      nextCompNumber == null ? null : { number: nextCompNumber, currency };

    const patch: Parameters<typeof updateCandidate>[0] = { id: candidateRef };
    let dirty = false;
    if (nextTitle !== titleSaved.trim()) {
      patch.current_designation = nextTitle;
      dirty = true;
    }
    if (nextEmployer !== employerSaved.trim()) {
      patch.current_organization = nextEmployer;
      dirty = true;
    }
    if (nextLocation !== locationSaved.trim()) {
      patch.location = { location: nextLocation };
      dirty = true;
    }
    const compSavedNumber = compSaved?.number ?? null;
    const compSavedCurrency = compSaved?.currency ?? null;
    const compNextCurrency = nextComp?.currency ?? null;
    if (
      (nextComp?.number ?? null) !== compSavedNumber ||
      compNextCurrency !== compSavedCurrency
    ) {
      patch.expected_salary = nextComp;
      dirty = true;
    }

    // Email / phone lists: trim + drop blanks. Index 0 is the primary
    // (unique) value, the rest persist to altEmails / altPhones.
    const nextEmails = emailsDraft.map((e) => e.trim()).filter(Boolean);
    const nextPhones = phonesDraft.map((p) => p.trim()).filter(Boolean);
    if (!sameList(nextEmails, emailsSaved)) {
      patch.email = nextEmails[0] ?? "";
      patch.alt_emails = nextEmails.slice(1);
      dirty = true;
    }
    if (!sameList(nextPhones, phonesSaved)) {
      patch.phone_number = nextPhones[0] ?? "";
      patch.alt_phones = nextPhones.slice(1);
      dirty = true;
    }

    if (!dirty) {
      setEditing(false);
      return;
    }

    startSave(async () => {
      const res = await updateCandidate(patch);
      if (!res.ok) {
        toast.error("Save failed", { description: res.error });
        return;
      }
      if (patch.current_designation !== undefined) setTitleSaved(nextTitle);
      if (patch.current_organization !== undefined) setEmployerSaved(nextEmployer);
      if (patch.location !== undefined) setLocationSaved(nextLocation);
      if (patch.expected_salary !== undefined) setCompSaved(nextComp);
      if (patch.email !== undefined) setEmailsSaved(nextEmails);
      if (patch.phone_number !== undefined) setPhonesSaved(nextPhones);
      setEditing(false);
      // updateCandidate already revalidates the candidate path; refresh
      // pulls the new RSC payload so other surfaces on the page (compact
      // overview render in two places, activity card, etc.) see the
      // canonical value on the next render.
      router.refresh();
    });
  }

  return (
    <section className="relative isolate rounded-xl border border-court-border bg-court-surface px-4 py-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <h1 className="min-w-0 break-words font-serif text-lg font-bold leading-tight text-court-fg">
          <HighlightedText text={fullName} tokens={tokens} colorMap={colorMap} />
        </h1>
        {!editing && (
          <button
            type="button"
            onClick={beginEdit}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-0.5 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:border-brand/40 hover:text-court-fg"
          >
            <Pencil className="h-3 w-3" /> Edit
          </button>
        )}
      </div>

      {editing ? (
        <div className="mt-3 space-y-2 text-xs">
          <EditField label="Title">
            <input
              type="text"
              value={titleDraft}
              disabled={isSaving}
              onChange={(e) => setTitleDraft(e.target.value)}
              className={EDIT_INPUT_CLASS}
            />
          </EditField>
          <EditField label="Employer">
            <input
              type="text"
              value={employerDraft}
              disabled={isSaving}
              onChange={(e) => setEmployerDraft(e.target.value)}
              className={EDIT_INPUT_CLASS}
            />
          </EditField>
          <EditField label="Location">
            <input
              type="text"
              value={locationDraft}
              disabled={isSaving}
              onChange={(e) => setLocationDraft(e.target.value)}
              className={EDIT_INPUT_CLASS}
            />
          </EditField>
          <EditField label="Comp">
            <MaskedCurrencyInput
              value={compDraft}
              disabled={isSaving}
              onChange={setCompDraft}
              className={EDIT_INPUT_CLASS}
            />
          </EditField>
          <EditField label="Email">
            <StringListField
              values={emailsDraft}
              onChange={setEmailsDraft}
              type="email"
              disabled={isSaving}
              addLabel="Add email"
              removeLabel="Remove email"
            />
          </EditField>
          <EditField label="Phone">
            <StringListField
              values={phonesDraft}
              onChange={setPhonesDraft}
              type="tel"
              disabled={isSaving}
              addLabel="Add phone"
              removeLabel="Remove phone"
            />
          </EditField>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <Field label="LinkedIn" wide>
              <ReadLinkedIn linkedinProfile={linkedinProfile} />
            </Field>
          </dl>
          <div className="flex items-center justify-end gap-2 border-t border-court-border pt-2">
            <button
              type="button"
              onClick={cancelEdit}
              disabled={isSaving}
              className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2.5 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg disabled:opacity-60"
            >
              <X className="h-3 w-3" /> Cancel
            </button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={commitEdit}
              disabled={isSaving}
              className="px-2.5 py-1 text-[11px]"
            >
              {isSaving ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Save className="h-3 w-3" />
              )}
              Save
            </Button>
          </div>
        </div>
      ) : (
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <Field label="Title" wide noTruncate>
            <ReadText
              value={titleSaved}
              tokens={tokens}
              colorMap={colorMap}
              placeholder="Add title"
            />
          </Field>
          <Field label="Employer" wide noTruncate>
            <ReadText
              value={employerSaved}
              tokens={tokens}
              colorMap={colorMap}
              placeholder="Add employer"
            />
          </Field>
          <Field label="Email" wide noTruncate>
            <ReadEmailList
              emails={emailsSaved}
              candidateRef={candidateRef}
              firstName={firstName}
              lastName={lastName}
              title={titleSaved}
              employer={employerSaved}
            />
          </Field>
          <Field label="Phone" wide noTruncate>
            <ReadPhoneList phones={phonesSaved} />
          </Field>
          <Field label="Location">
            <ReadText
              value={locationSaved}
              tokens={tokens}
              colorMap={colorMap}
              placeholder="Add location"
              display={(v) => formatLocation(v) || ""}
            />
          </Field>
          <Field label="Comp">
            <ReadComp value={compSaved} />
          </Field>
          <Field label="LinkedIn" wide>
            <ReadLinkedIn linkedinProfile={linkedinProfile} />
          </Field>
        </dl>
      )}
    </section>
  );
}

const EDIT_INPUT_CLASS =
  "w-full rounded border border-court-border bg-court-surface px-2 py-1 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/30 disabled:opacity-60";

function EditField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wide text-court-fg-muted">
        {label}
      </span>
      <div className="mt-0.5">{children}</div>
    </label>
  );
}

// Repeatable string rows (email or phone) with a "+ Add" control. The
// first row has no remove button and is the primary value.
function StringListField({
  values,
  onChange,
  type,
  addLabel,
  removeLabel,
  disabled,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  type: string;
  addLabel: string;
  removeLabel: string;
  disabled?: boolean;
}) {
  const rows = values.length ? values : [""];
  return (
    <div className="space-y-1.5">
      {rows.map((v, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            type={type}
            value={v}
            disabled={disabled}
            onChange={(e) => {
              const next = [...rows];
              next[i] = e.target.value;
              onChange(next);
            }}
            className={EDIT_INPUT_CLASS}
          />
          {i > 0 && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(rows.filter((_, j) => j !== i))}
              className="shrink-0 rounded p-1 text-court-fg-muted transition hover:text-red-600 disabled:opacity-60"
              aria-label={removeLabel}
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange([...rows, ""])}
        className="inline-flex items-center gap-1 rounded text-[11px] font-medium text-court-fg-muted transition hover:text-brand-dark disabled:opacity-60"
      >
        <Plus className="h-3 w-3" /> {addLabel}
      </button>
    </div>
  );
}

// True when two cleaned string lists are identical in order and content.
function sameList(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function ReadEmailList({
  emails,
  candidateRef,
  firstName,
  lastName,
  title,
  employer,
}: {
  emails: string[];
  candidateRef: string;
  firstName: string | null;
  lastName: string | null;
  title: string;
  employer: string;
}) {
  if (!emails.length) return <span className="text-court-fg-muted">—</span>;
  return (
    <div className="space-y-0.5">
      {emails.map((em, i) => (
        <div key={i} className={i === 0 ? undefined : "text-xs"}>
          <ReadEmail
            email={em}
            candidateRef={candidateRef}
            firstName={firstName}
            lastName={lastName}
            title={title}
            employer={employer}
          />
        </div>
      ))}
    </div>
  );
}

function ReadPhoneList({ phones }: { phones: string[] }) {
  if (!phones.length) return <span className="text-court-fg-muted">—</span>;
  return (
    <div className="space-y-0.5">
      {phones.map((p, i) => (
        <div key={i} className={i === 0 ? undefined : "text-xs"}>
          <ReadPhone phone={p} />
        </div>
      ))}
    </div>
  );
}

function Field({
  label,
  children,
  wide,
  noTruncate,
}: {
  label: string;
  children: ReactNode;
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

function ReadText({
  value,
  placeholder,
  tokens,
  colorMap,
  display,
}: {
  value: string;
  placeholder: string;
  tokens: string[];
  colorMap: Map<string, string>;
  display?: (raw: string) => string;
}) {
  const shown = display ? display(value) : value;
  const isEmpty = !value || !shown;
  if (isEmpty) {
    return <span className="italic text-court-fg-muted">{placeholder}</span>;
  }
  return <HighlightedText text={shown} tokens={tokens} colorMap={colorMap} />;
}

function ReadComp({ value }: { value: CandidateCompactOverviewExpectedSalary | null }) {
  const display = formatCompForDisplay(value);
  if (!display) return <span className="italic text-court-fg-muted">—</span>;
  return <>{display}</>;
}

function ReadEmail({
  email,
  candidateRef,
  firstName,
  lastName,
  title,
  employer,
}: {
  email: string | null;
  candidateRef: string;
  firstName: string | null;
  lastName: string | null;
  title: string;
  employer: string;
}) {
  if (!email) return <span className="text-court-fg-muted">—</span>;
  return (
    <EmailPopupLauncher
      email={email}
      candidateRef={candidateRef}
      className="inline-flex max-w-full items-center gap-1 break-all text-brand-dark hover:underline"
      context={{
        candidate: {
          firstName: firstName ?? "",
          lastName: lastName ?? "",
          email,
          currentTitle: title,
          currentCompany: employer,
        },
      }}
    >
      <Mail className="h-3 w-3 shrink-0" />
      <span className="break-all">{email}</span>
    </EmailPopupLauncher>
  );
}

function ReadPhone({ phone }: { phone: string | null }) {
  if (!phone) return <span className="text-court-fg-muted">—</span>;
  return (
    <a
      href={`tel:${phone}`}
      className="inline-flex items-center gap-1 text-court-fg hover:text-brand-dark hover:underline"
    >
      <PhoneIcon className="h-3 w-3" />
      {phone}
    </a>
  );
}

function ReadLinkedIn({ linkedinProfile }: { linkedinProfile: string | null }) {
  if (!linkedinProfile) return <span className="text-court-fg-muted">—</span>;
  return (
    <a
      href={linkedinProfile}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-brand-dark hover:underline"
    >
      Profile <ExternalLink className="h-3 w-3" />
    </a>
  );
}

// Renders `text` with case-insensitive matches of any `tokens` wrapped
// in colored chip spans. When tokens is empty the text passes through
// unchanged so the component is safe to use even on rows that opt out
// of highlighting (e.g. the full-page profile that never receives a
// search context).
function HighlightedText({
  text,
  tokens,
  colorMap,
}: {
  text: string;
  tokens: string[];
  colorMap: Map<string, string>;
}) {
  if (!text || tokens.length === 0) return <>{text}</>;
  const pattern = tokens
    .filter((t) => t.length > 0)
    .map((t) => escapeForRegex(t))
    .join("|");
  if (!pattern) return <>{text}</>;
  const re = new RegExp(`(${pattern})`, "gi");
  const parts = text.split(re);
  return (
    <>
      {parts.map((part, i) => {
        if (!part) return null;
        const match = tokens.find((t) => t.toLowerCase() === part.toLowerCase());
        if (!match) return <span key={i}>{part}</span>;
        const cls = colorMap.get(match) ?? "";
        return (
          <mark key={i} className={cn("rounded px-0.5", cls)}>
            {part}
          </mark>
        );
      })}
    </>
  );
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// "120,000 USD" / "120,000" / null — matches formatExpectedSalaryBlob
// so the displayed value here keeps reading identically to the prior
// server-rendered version.
function formatCompForDisplay(
  value: CandidateCompactOverviewExpectedSalary | null,
): string {
  if (!value) return "";
  const num =
    typeof value.number === "number" && Number.isFinite(value.number)
      ? value.number
      : null;
  const currency =
    typeof value.currency === "string" && value.currency.trim()
      ? value.currency.trim()
      : null;
  if (num == null) return currency ?? "";
  const formatted = `$${new Intl.NumberFormat("en-US").format(num)}`;
  return currency ? `${formatted} ${currency}` : formatted;
}

// Seed for the inline Comp input. Returns clean digits only ("120000"),
// which MaskedCurrencyInput re-formats to "$120,000" for display — so an
// existing saved comp loads already formatted. parseCompensation strips
// "$"/commas on save, so the round-trip stays a plain number.
function formatCompForEdit(
  value: CandidateCompactOverviewExpectedSalary | null,
): string {
  if (!value?.number || !Number.isFinite(value.number)) return "";
  return String(Math.round(value.number));
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
