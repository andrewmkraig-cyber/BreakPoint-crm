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
import {
  Input,
  Select,
  INPUT_FRAME_RECT_CLASS,
  INPUT_CONTROL_CLASS,
} from "@/components/ui/input";
import { LEAD_SOURCES } from "@/lib/lead-sources";
import {
  formatExpectedCompensation,
  getExpectedCompensationType,
  type ExpectedCompensationType,
} from "@/lib/candidate-compensation";
import { cn, formatLocation } from "@/lib/utils";
import {
  composeCandidateLocation,
  splitCandidateLocation,
  type CandidateLocationParts,
} from "@/lib/candidate-location-parts";
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
// style) flips all editable fields — Name, Title, Employer, Location,
// Source, Comp, Email(s), Phone(s) — into edit mode at once. Save commits
// every field together, Cancel discards. Email and Phone are multi-value: the first
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
  source,
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
  source: string | null;
  expectedSalary: CandidateCompactOverviewExpectedSalary | null;
  highlightTokens?: string[];
}) {
  const router = useRouter();

  const [firstNameSaved, setFirstNameSaved] = useState(firstName ?? "");
  const [lastNameSaved, setLastNameSaved] = useState(lastName ?? "");
  const [titleSaved, setTitleSaved] = useState(currentDesignation ?? "");
  const [employerSaved, setEmployerSaved] = useState(currentOrganization ?? "");
  const [locationSaved, setLocationSaved] = useState(location ?? "");
  const [linkedinSaved, setLinkedinSaved] = useState(linkedinProfile ?? "");
  const [sourceSaved, setSourceSaved] = useState(source ?? "");
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

  // Edit mode flips the full compact identity card at once. Drafts seed from the saved
  // values whenever editing flips off (matches the client overview card
  // model, so canceling restores the exact persisted shape).
  const [editing, setEditing] = useState(false);
  const [firstNameDraft, setFirstNameDraft] = useState(firstNameSaved);
  const [lastNameDraft, setLastNameDraft] = useState(lastNameSaved);
  const [titleDraft, setTitleDraft] = useState(titleSaved);
  const [employerDraft, setEmployerDraft] = useState(employerSaved);
  const [locationDraft, setLocationDraft] = useState<CandidateLocationParts>(() =>
    splitCandidateLocation(locationSaved),
  );
  const [linkedinDraft, setLinkedinDraft] = useState(linkedinSaved);
  const [sourceDraft, setSourceDraft] = useState(sourceSaved);
  const [compDraft, setCompDraft] = useState<string>(formatCompForEdit(compSaved));
  const [compTypeDraft, setCompTypeDraft] = useState<ExpectedCompensationType>(
    getExpectedCompensationType(compSaved),
  );
  const [emailsDraft, setEmailsDraft] = useState<string[]>(emailsSaved);
  const [phonesDraft, setPhonesDraft] = useState<string[]>(phonesSaved);
  const [isSaving, startSave] = useTransition();
  const displayName =
    [firstNameSaved, lastNameSaved].filter(Boolean).join(" ").trim() ||
    fullName ||
    "(unnamed)";

  useEffect(() => {
    if (editing) return;
    setFirstNameDraft(firstNameSaved);
    setLastNameDraft(lastNameSaved);
    setTitleDraft(titleSaved);
    setEmployerDraft(employerSaved);
    setLocationDraft(splitCandidateLocation(locationSaved));
    setLinkedinDraft(linkedinSaved);
    setSourceDraft(sourceSaved);
    setCompDraft(formatCompForEdit(compSaved));
    setCompTypeDraft(getExpectedCompensationType(compSaved));
    setEmailsDraft(emailsSaved);
    setPhonesDraft(phonesSaved);
  }, [
    editing,
    firstNameSaved,
    lastNameSaved,
    titleSaved,
    employerSaved,
    locationSaved,
    linkedinSaved,
    sourceSaved,
    compSaved,
    emailsSaved,
    phonesSaved,
  ]);

  const tokens = useMemo(
    () => (highlightTokens ?? []).filter((t) => t.trim().length > 0),
    [highlightTokens],
  );
  const colorMap = useMemo(() => buildTokenColorMap(tokens), [tokens]);

  function beginEdit() {
    setFirstNameDraft(firstNameSaved);
    setLastNameDraft(lastNameSaved);
    setTitleDraft(titleSaved);
    setEmployerDraft(employerSaved);
    setLocationDraft(splitCandidateLocation(locationSaved));
    setLinkedinDraft(linkedinSaved);
    setSourceDraft(sourceSaved);
    setCompDraft(formatCompForEdit(compSaved));
    setCompTypeDraft(getExpectedCompensationType(compSaved));
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
    const nextFirstName = firstNameDraft.trim();
    const nextLastName = lastNameDraft.trim();
    const nextTitle = titleDraft.trim();
    const nextEmployer = employerDraft.trim();
    const nextLocation = composeCandidateLocation(locationDraft);
    const nextLinkedin = linkedinDraft.trim();
    const nextSource = sourceDraft.trim();
    const nextCompNumber = parseCompensation(compDraft.trim(), compTypeDraft);
    const currency = (compSaved?.currency ?? "USD").toUpperCase().slice(0, 3) || "USD";
    const nextComp: CandidateCompactOverviewExpectedSalary | null =
      nextCompNumber == null ? null : { number: nextCompNumber, currency, type: compTypeDraft };

    const patch: Parameters<typeof updateCandidate>[0] = { id: candidateRef };
    let dirty = false;
    if (!nextFirstName) {
      toast.error("First name is required");
      return;
    }
    if (nextFirstName !== firstNameSaved.trim()) {
      patch.first_name = nextFirstName;
      dirty = true;
    }
    if (nextLastName !== lastNameSaved.trim()) {
      patch.last_name = nextLastName;
      dirty = true;
    }
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
    if (nextLinkedin !== linkedinSaved.trim()) {
      patch.linkedin_profile = nextLinkedin;
      dirty = true;
    }
    if (nextSource !== sourceSaved.trim()) {
      patch.source = nextSource || null;
      dirty = true;
    }
    const compSavedNumber = compSaved?.number ?? null;
    const compSavedCurrency = compSaved?.currency ?? null;
    const compSavedType = compSaved ? getExpectedCompensationType(compSaved) : "salary";
    const compNextCurrency = nextComp?.currency ?? null;
    const compNextType = nextComp ? getExpectedCompensationType(nextComp) : "salary";
    if (
      (nextComp?.number ?? null) !== compSavedNumber ||
      compNextCurrency !== compSavedCurrency ||
      compNextType !== compSavedType
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
      if (patch.first_name !== undefined) setFirstNameSaved(nextFirstName);
      if (patch.last_name !== undefined) setLastNameSaved(nextLastName);
      if (patch.current_designation !== undefined) setTitleSaved(nextTitle);
      if (patch.current_organization !== undefined) setEmployerSaved(nextEmployer);
      if (patch.location !== undefined) setLocationSaved(nextLocation);
      if (patch.linkedin_profile !== undefined) setLinkedinSaved(nextLinkedin);
      if (patch.source !== undefined) setSourceSaved(nextSource);
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
          <HighlightedText text={displayName} tokens={tokens} colorMap={colorMap} />
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
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <EditField label="First name">
              <Input
                type="text"
                value={firstNameDraft}
                disabled={isSaving}
                onChange={(e) => setFirstNameDraft(e.target.value)}
                className="px-2 py-1"
              />
            </EditField>
            <EditField label="Last name">
              <Input
                type="text"
                value={lastNameDraft}
                disabled={isSaving}
                onChange={(e) => setLastNameDraft(e.target.value)}
                className="px-2 py-1"
              />
            </EditField>
          </div>
          <EditField label="Title">
            <Input
              type="text"
              value={titleDraft}
              disabled={isSaving}
              onChange={(e) => setTitleDraft(e.target.value)}
              className="px-2 py-1"
            />
          </EditField>
          <EditField label="Employer">
            <Input
              type="text"
              value={employerDraft}
              disabled={isSaving}
              onChange={(e) => setEmployerDraft(e.target.value)}
              className="px-2 py-1"
            />
          </EditField>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <EditField label="City">
              <Input
                type="text"
                value={locationDraft.city}
                disabled={isSaving}
                onChange={(e) =>
                  setLocationDraft((prev) => ({ ...prev, city: e.target.value }))
                }
                className="px-2 py-1"
              />
            </EditField>
            <EditField label="State">
              <Input
                type="text"
                value={locationDraft.state}
                disabled={isSaving}
                onChange={(e) =>
                  setLocationDraft((prev) => ({ ...prev, state: e.target.value }))
                }
                className="px-2 py-1"
              />
            </EditField>
            <EditField label="ZIP">
              <Input
                type="text"
                value={locationDraft.zip}
                disabled={isSaving}
                onChange={(e) =>
                  setLocationDraft((prev) => ({ ...prev, zip: e.target.value }))
                }
                className="px-2 py-1"
              />
            </EditField>
          </div>
          <EditField label="Source">
            <Select
              value={sourceDraft}
              disabled={isSaving}
              onChange={(e) => setSourceDraft(e.target.value)}
              className="px-2 py-1"
            >
              <option value="">Select source...</option>
              {LEAD_SOURCES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
              {sourceDraft &&
                !LEAD_SOURCES.some(
                  (option) => option.toLowerCase() === sourceDraft.toLowerCase(),
                ) && <option value={sourceDraft}>{sourceDraft}</option>}
            </Select>
          </EditField>
          <EditField label="Comp">
            <CandidateCompEditor
              value={compDraft}
              type={compTypeDraft}
              disabled={isSaving}
              onValueChange={setCompDraft}
              onTypeChange={(nextType) => {
                setCompTypeDraft(nextType);
                setCompDraft((prev) => sanitizeCompDraft(prev, nextType));
              }}
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
          <EditField label="LinkedIn">
            <Input
              type="url"
              value={linkedinDraft}
              disabled={isSaving}
              onChange={(e) => setLinkedinDraft(e.target.value)}
              placeholder="https://linkedin.com/in/..."
              className="px-2 py-1"
            />
          </EditField>
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
              firstName={firstNameSaved}
              lastName={lastNameSaved}
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
          <Field label="LinkedIn">
            <ReadLinkedIn linkedinProfile={linkedinSaved} />
          </Field>
          <Field label="Source">
            <ReadCandidateSource source={sourceSaved} />
          </Field>
        </dl>
      )}
    </section>
  );
}


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
          <Input
            type={type}
            value={v}
            disabled={disabled}
            onChange={(e) => {
              const next = [...rows];
              next[i] = e.target.value;
              onChange(next);
            }}
            containerClassName="flex-1"
            className="px-2 py-1"
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

function CandidateCompEditor({
  value,
  type,
  disabled,
  onValueChange,
  onTypeChange,
}: {
  value: string;
  type: ExpectedCompensationType;
  disabled: boolean;
  onValueChange: (nextValue: string) => void;
  onTypeChange: (nextType: ExpectedCompensationType) => void;
}) {
  return (
    <div className="grid w-full grid-cols-[minmax(0,1fr)_7.25rem] gap-2">
      <div className={cn(INPUT_FRAME_RECT_CLASS, "min-w-0 px-2", disabled && "opacity-60")}>
        <span aria-hidden="true" className="shrink-0 text-sm text-court-fg-muted">
          $
        </span>
        <input
          type="text"
          inputMode={type === "hourly" ? "decimal" : "numeric"}
          value={formatCompDraftForInput(value, type)}
          disabled={disabled}
          onChange={(e) => onValueChange(sanitizeCompDraft(e.target.value, type))}
          placeholder={type === "hourly" ? "25.00" : "120,000"}
          className={cn(INPUT_CONTROL_CLASS, "min-w-0 px-1 py-1 text-sm")}
        />
        {type === "hourly" ? (
          <span className="ml-1 shrink-0 text-xs font-medium text-court-fg-muted">
            /hr
          </span>
        ) : null}
      </div>
      <Select
        value={type}
        disabled={disabled}
        onChange={(e) => onTypeChange(e.target.value === "hourly" ? "hourly" : "salary")}
        containerClassName="min-w-0"
        className="px-2 py-1 text-sm font-medium"
      >
        <option value="salary">Salary</option>
        <option value="hourly">Hourly</option>
      </Select>
    </div>
  );
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
      // target="_top" so the tel: handoff fires against the top window
      // instead of navigating the candidates split-view iframe to a
      // tel: URL it can't render (which left the right pane blank with
      // a broken-image glyph). The OS still catches the tel: and routes
      // it to Quo Desktop; the embedded profile pane stays put.
      target="_top"
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

function ReadCandidateSource({ source }: { source: string }) {
  if (!source.trim()) return <span className="text-court-fg-muted">—</span>;
  return <>{source}</>;
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
  if (getExpectedCompensationType(value) === "hourly") {
    return formatExpectedCompensation(value);
  }
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

// Seed for the inline Comp input. Salary drafts stay clean digits
// ("120000") and render with commas; hourly drafts can carry one decimal.
// parseCompensation strips "$"/commas on save so persisted comp stays numeric.
function formatCompForEdit(
  value: CandidateCompactOverviewExpectedSalary | null,
): string {
  if (!value?.number || !Number.isFinite(value.number)) return "";
  if (getExpectedCompensationType(value) === "hourly") {
    return trimTrailingZeros(value.number);
  }
  return String(Math.round(value.number));
}

function parseCompensation(raw: string, type: ExpectedCompensationType): number | null {
  const trimmed = raw.trim().toLowerCase().replace(/[\s,$]/g, "");
  if (!trimmed) return null;
  const m = trimmed.match(/^(\d+(?:\.\d+)?)([km])?$/);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (type === "hourly") return Math.round(n * 100) / 100;
  if (m[2] === "k") n *= 1000;
  if (m[2] === "m") n *= 1_000_000;
  return Math.round(n);
}

function sanitizeCompDraft(raw: string, type: ExpectedCompensationType): string {
  const cleaned = raw.replace(/[$,\s]/g, "").replace(/-/g, "");
  if (type === "salary") {
    return cleaned.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  }
  let out = "";
  let sawDecimal = false;
  for (const ch of cleaned) {
    if (/\d/.test(ch)) {
      out += ch;
    } else if (ch === "." && !sawDecimal) {
      out += ch;
      sawDecimal = true;
    }
  }
  return out.startsWith(".") ? `0${out}` : out;
}

function formatCompDraftForInput(raw: string, type: ExpectedCompensationType): string {
  const clean = sanitizeCompDraft(raw, type);
  if (type === "hourly") return clean;
  if (!clean) return "";
  return clean.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function trimTrailingZeros(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/, "");
}
