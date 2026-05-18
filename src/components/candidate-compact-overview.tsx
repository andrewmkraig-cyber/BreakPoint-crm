"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2, Mail, Phone as PhoneIcon } from "lucide-react";
import { toast } from "sonner";
import { EmailPopupLauncher } from "@/components/email-popup-launcher";
import { cn, formatLocation } from "@/lib/utils";
import { updateCandidate } from "@/app/candidates/[id]/actions";
import { buildTokenColorMap } from "@/app/candidates/[id]/resume-matches-rail";

// Right-rail compact overview shared by the candidate full-page profile
// and the candidates split-view embed.
//
// Two behaviors layered on top of the static read-only original:
//  1. Click-to-edit on Title, Employer, Location, Comp. Each field has
//     its own draft / save / cancel cycle so saving Title doesn't reset
//     a partially-typed Employer. Email / Phone / LinkedIn stay read-
//     only — they have dedicated surfaces (EmailPopupLauncher, tel:
//     handoff, sms-composer's Add Number).
//  2. Optional highlightTokens. When passed, Title / Employer / Location
//     wrap matching substrings in the same TOKEN_COLORS palette the
//     resume chip strip + in-PDF marks use, so a token's chip color and
//     its mention in the candidate header read as the same hue. The
//     split-view passes tokens here when a candidate has no resume so
//     the right rail still surfaces *where* the matches live.
export type CandidateCompactOverviewExpectedSalary = {
  number: number | null;
  currency: string | null;
};

// Coerce the loose JsonValue / RFCandidate.expected_salary blob shape
// into the structured value the inline editor needs. Centralized here
// so every call site (full-page + embed across both RF + local-profile
// paths) stays in sync with the editor's value model.
export function toExpectedSalary(
  raw: unknown,
): CandidateCompactOverviewExpectedSalary | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as { number?: unknown; currency?: unknown };
  const num =
    typeof obj.number === "number" && Number.isFinite(obj.number)
      ? obj.number
      : typeof obj.number === "string" && obj.number.trim() !== ""
        ? Number(obj.number)
        : null;
  const currency =
    typeof obj.currency === "string" && obj.currency.trim() !== ""
      ? obj.currency.trim()
      : null;
  if (num == null && !currency) return null;
  return { number: num != null && Number.isFinite(num) ? num : null, currency };
}

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

  const tokens = useMemo(
    () => (highlightTokens ?? []).filter((t) => t.trim().length > 0),
    [highlightTokens],
  );
  const colorMap = useMemo(() => buildTokenColorMap(tokens), [tokens]);

  async function persist(
    patch: Parameters<typeof updateCandidate>[0],
    onSuccess: () => void,
  ): Promise<boolean> {
    const res = await updateCandidate(patch);
    if (!res.ok) {
      toast.error("Save failed", { description: res.error });
      return false;
    }
    onSuccess();
    // updateCandidate already revalidates the candidate path; refresh
    // pulls the new RSC payload so other surfaces on the page (compact
    // overview render in two places, activity card, etc.) see the
    // canonical value on the next render.
    router.refresh();
    return true;
  }

  return (
    <section className="rounded-xl border border-court-border bg-court-surface px-4 py-3 shadow-sm">
      <h1 className="break-words font-serif text-lg font-bold leading-tight text-court-fg">
        {fullName}
      </h1>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <Field label="Title" wide noTruncate>
          <InlineEditableText
            value={titleSaved}
            placeholder="Add title"
            tokens={tokens}
            colorMap={colorMap}
            onSave={(next) =>
              persist(
                { id: candidateRef, current_designation: next },
                () => setTitleSaved(next),
              )
            }
          />
        </Field>
        <Field label="Employer" wide noTruncate>
          <InlineEditableText
            value={employerSaved}
            placeholder="Add employer"
            tokens={tokens}
            colorMap={colorMap}
            onSave={(next) =>
              persist(
                { id: candidateRef, current_organization: next },
                () => setEmployerSaved(next),
              )
            }
          />
        </Field>
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
                  currentTitle: titleSaved,
                  currentCompany: employerSaved,
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
        <Field label="Location">
          <InlineEditableText
            value={locationSaved}
            placeholder="Add location"
            tokens={tokens}
            colorMap={colorMap}
            display={(v) => formatLocation(v) || ""}
            onSave={(next) =>
              persist(
                { id: candidateRef, location: { location: next } },
                () => setLocationSaved(next),
              )
            }
          />
        </Field>
        <Field label="Comp">
          <InlineEditableComp
            value={compSaved}
            onSave={async (next) => {
              const ok = await persist(
                { id: candidateRef, expected_salary: next },
                () => setCompSaved(next),
              );
              return ok;
            }}
          />
        </Field>
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

// Click-to-edit text field used for Title / Employer / Location.
// Display mode renders the value (or "—") and accepts a hover/focus
// affordance via the underline-on-hover style. Click flips to an
// autofocused input; Enter/blur saves, Esc cancels. The save handler
// is async so the input stays mounted (with a spinner) while the
// server action is in flight — flipping back to display before save
// completes would yank focus and confuse the recruiter on slow links.
function InlineEditableText({
  value,
  placeholder,
  onSave,
  tokens,
  colorMap,
  display,
}: {
  value: string;
  placeholder: string;
  onSave: (next: string) => Promise<boolean>;
  tokens: string[];
  colorMap: Map<string, string>;
  // Optional display formatter — used for Location so the persisted
  // raw string ("Cleveland, OH") still renders through formatLocation.
  display?: (raw: string) => string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [isPending, startSave] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  // Track whether we're currently mid-save. Without this guard, the
  // input's onBlur fires when the value is set externally and would
  // double-submit (or worse, re-open the editor after a successful
  // save). The savingRef is checked in onBlur to suppress re-entry.
  const savingRef = useRef(false);

  // Keep draft synced when the saved value changes from a parent
  // re-render (router.refresh after another field's save).
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function commit() {
    if (savingRef.current) return;
    const next = draft.trim();
    if (next === value.trim()) {
      setEditing(false);
      return;
    }
    savingRef.current = true;
    startSave(async () => {
      const ok = await onSave(next);
      savingRef.current = false;
      if (ok) setEditing(false);
    });
  }

  function cancel() {
    if (savingRef.current) return;
    setDraft(value);
    setEditing(false);
  }

  if (editing) {
    return (
      <span className="inline-flex w-full items-center gap-1">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          disabled={isPending}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          className="w-full rounded border border-court-border bg-court-surface px-1.5 py-0.5 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/30 disabled:opacity-60"
        />
        {isPending && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-court-fg-muted" />}
      </span>
    );
  }

  const shown = display ? display(value) : value;
  const isEmpty = !value || !shown;
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={cn(
        "-mx-1 inline-flex max-w-full items-baseline rounded px-1 text-left transition-colors hover:bg-court-surface-subtle/70",
        isEmpty && "text-court-fg-muted italic",
      )}
      title="Click to edit"
    >
      {isEmpty ? (
        <span>—</span>
      ) : (
        <HighlightedText text={shown} tokens={tokens} colorMap={colorMap} />
      )}
    </button>
  );
}

// Comp editor. Display reads from the structured {number, currency}
// pair (so currency stays in sync); edit accepts "120k" / "120000" /
// "1.2m" style entry and re-saves as {number, currency: existing||USD}.
// Currency itself isn't user-editable from the compact overview —
// recruiters change it from the full identity editor when needed.
function InlineEditableComp({
  value,
  onSave,
}: {
  value: CandidateCompactOverviewExpectedSalary | null;
  onSave: (next: CandidateCompactOverviewExpectedSalary | null) => Promise<boolean>;
}) {
  const display = useMemo(() => formatCompForDisplay(value), [value]);
  const draftSeed = useMemo(() => formatCompForEdit(value), [value]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(draftSeed);
  const [isPending, startSave] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(draftSeed);
  }, [draftSeed, editing]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function commit() {
    if (savingRef.current) return;
    const trimmed = draft.trim();
    const nextNumber = parseCompensation(trimmed);
    const currency = (value?.currency ?? "USD").toUpperCase().slice(0, 3) || "USD";
    const next: CandidateCompactOverviewExpectedSalary | null =
      nextNumber == null ? null : { number: nextNumber, currency };
    // No-op when the parsed value matches the current saved value.
    if (
      (next?.number ?? null) === (value?.number ?? null) &&
      (next?.currency ?? null) === (value?.currency ?? null)
    ) {
      setEditing(false);
      return;
    }
    savingRef.current = true;
    startSave(async () => {
      const ok = await onSave(next);
      savingRef.current = false;
      if (ok) setEditing(false);
    });
  }

  function cancel() {
    if (savingRef.current) return;
    setDraft(draftSeed);
    setEditing(false);
  }

  if (editing) {
    return (
      <span className="inline-flex w-full items-center gap-1">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          disabled={isPending}
          placeholder="e.g. 120k"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          className="w-full rounded border border-court-border bg-court-surface px-1.5 py-0.5 text-sm text-court-fg focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/30 disabled:opacity-60"
        />
        {isPending && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-court-fg-muted" />}
      </span>
    );
  }

  const isEmpty = !display;
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={cn(
        "-mx-1 inline-flex max-w-full items-baseline rounded px-1 text-left transition-colors hover:bg-court-surface-subtle/70",
        isEmpty && "text-court-fg-muted italic",
      )}
      title="Click to edit"
    >
      {isEmpty ? "—" : display}
    </button>
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
          <mark
            key={i}
            className={cn("rounded px-0.5", cls)}
          >
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
  const formatted = new Intl.NumberFormat("en-US").format(num);
  return currency ? `${formatted} ${currency}` : formatted;
}

// Seed for the inline input. Bare-number form keeps the editor terse
// — typing 1 character to bump 120k → 130k beats clearing "120,000 USD"
// first. parseCompensation accepts both shapes on save.
function formatCompForEdit(
  value: CandidateCompactOverviewExpectedSalary | null,
): string {
  if (!value?.number || !Number.isFinite(value.number)) return "";
  const n = value.number;
  if (n >= 1000 && n % 1000 === 0) return `${n / 1000}k`;
  return String(n);
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
