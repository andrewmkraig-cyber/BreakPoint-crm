"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2, Save, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { DocumentDropzone } from "@/components/document-dropzone";
import { uploadFileInChunks } from "@/lib/chunked-upload";
import { cn } from "@/lib/utils";
import { Button, CLAUDE_PILL_CLASS } from "@/components/ui/button";
import { INPUT_FRAME_RECT_CLASS, INPUT_CONTROL_CLASS } from "@/components/ui/input";
import {
  checkCandidateEmail,
  createCandidate,
  discardResumeUpload,
  parseCandidate,
  type CreateCandidatePayload,
  type ParsedEducationRow,
  type ParsedExperienceRow,
  type ParseSource,
} from "@/app/candidates/new/actions";

type FormState = CreateCandidatePayload & {
  skillsText: string;
  experience: ParsedExperienceRow[];
  education: ParsedEducationRow[];
};

const EMPTY: FormState = {
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  current_designation: "",
  current_organization: "",
  location: "",
  linkedin_profile: "",
  skills: [],
  skillsText: "",
  notes: "",
  experience: [],
  education: [],
};

export function NewCandidateForm() {
  const router = useRouter();
  const [resume, setResume] = useState<File | null>(null);
  const [pastedText, setPastedText] = useState<string>("");
  const [linkedinUrl, setLinkedinUrl] = useState<string>("");
  const [form, setForm] = useState<FormState>(EMPTY);
  const [parseSource, setParseSource] = useState<ParseSource | null>(null);
  const [claudeError, setClaudeError] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isParsing, startParse] = useTransition();
  const [isSaving, startSave] = useTransition();

  const [resumeUploadId, setResumeUploadId] = useState<string | null>(null);
  const [emailDuplicate, setEmailDuplicate] = useState<{ id: string; name: string } | null>(null);
  // Email dup-check is a tri-state past "has a value":
  //   idle      — no check has run yet for the current email string
  //   checking  — server roundtrip in flight
  //   clean     — no row found for this (lowercased) email
  //   duplicate — a row exists; emailDuplicate holds the existing candidate
  // Save is gated on status === "clean" so recruiters can't submit before
  // the check resolves.
  const [emailCheckStatus, setEmailCheckStatus] = useState<
    "idle" | "checking" | "clean" | "duplicate"
  >("idle");

  function runParse(args: { file?: File } = {}) {
    setParseError(null);
    setClaudeError(null);
    // Prefer the file passed in (from the drop handler, where state hasn't
    // flushed yet) over the React state.
    const nextFile = args.file ?? resume;
    const nextText = pastedText;
    const nextUrl = linkedinUrl;

    if (!nextFile && !nextText.trim() && !nextUrl.trim()) {
      toast.error("Nothing to parse", { description: "Drop a resume, paste text, or enter a LinkedIn URL." });
      return;
    }

    const toastId = toast.loading("Preparing resume…");

    startParse(async () => {
      try {
        let uploadId = args.file ? null : resumeUploadId;
        if (nextFile && !uploadId) {
          const res = await uploadFileInChunks(
            nextFile,
            "/api/uploads/resume",
            {},
            {
              onProgress: (pct) => {
                toast.loading(`Uploading resume — ${pct}%`, { id: toastId });
              },
            },
          );
          uploadId = res.id;
          setResumeUploadId(res.id);
        }

        toast.loading("Parsing with Claude…", { id: toastId });
        const result = await parseCandidate({
          resumeUploadId: uploadId,
          pastedText: nextText,
          linkedinUrl: nextUrl,
        });

        if (!result.ok) {
          setParseError(result.error);
          const isUnparseableDocx = result.error.includes("DOCX_UNPARSEABLE");
          toast.error(
            isUnparseableDocx ? "Could not parse this resume format" : "Parse failed",
            {
              id: toastId,
              description: isUnparseableDocx
                ? "Please paste the resume text manually or try uploading as PDF instead."
                : result.error,
            },
          );
          return;
        }
        const p = result.value.parsed;
        // A "success" from the server can still contain all-null fields if
        // the resume was a complex .docx and neither mammoth nor the raw-XML
        // fallback could pull readable text. Counting populated fields up-
        // front means the "parsed with Claude" badge only appears when
        // something actually filled in.
        const populatedFieldCount =
          [
            p.first_name,
            p.last_name,
            p.email,
            p.phone,
            p.current_designation,
            p.current_organization,
            p.location,
            p.linkedin_profile,
          ].filter((v) => typeof v === "string" && v.trim().length > 0).length +
          (p.skills?.length ?? 0) +
          (p.experience?.length ?? 0) +
          (p.education?.length ?? 0);
        if (populatedFieldCount === 0) {
          setParseError("No fields could be extracted from this resume.");
          toast.error("Could not parse this resume format", {
            id: toastId,
            description:
              "Please paste the resume text manually or try uploading as PDF instead.",
          });
          return;
        }
        // Claude sometimes omits current_designation/current_organization even
        // when the resume clearly has them — backfill from the first experience
        // row that looks "current" (to_year === null) so the form always
        // shows a value the user can confirm or edit. `??` alone would pass
        // an empty string through; use a truthy-trim check instead.
        const firstNonEmpty = (...v: Array<string | null | undefined>): string =>
          v.find((x) => typeof x === "string" && x.trim().length > 0) ?? "";
        const currentExp =
          (p.experience ?? []).find(
            (r) => r.to_year == null && ((r.designation ?? "").trim() || (r.organization ?? "").trim()),
          ) ??
          (p.experience && p.experience.length > 0 ? p.experience[0] : null);
        const backfillDesignation = firstNonEmpty(
          p.current_designation,
          currentExp?.designation,
        );
        const backfillOrganization = firstNonEmpty(
          p.current_organization,
          currentExp?.organization,
        );
        const expRows: ParsedExperienceRow[] = (p.experience ?? []).map((r) => ({
          designation: r.designation ?? "",
          organization: r.organization ?? "",
          from_year: r.from_year ?? null,
          to_year: r.to_year ?? null,
          description: r.description ?? "",
        }));
        const eduRows: ParsedEducationRow[] = (p.education ?? []).map((r) => ({
          school: r.school ?? "",
          degree: r.degree ?? "",
          from_year: r.from_year ?? null,
          to_year: r.to_year ?? null,
          description: r.description ?? "",
        }));
        setForm((prev) => ({
          ...prev,
          first_name: p.first_name ?? prev.first_name,
          last_name: p.last_name ?? prev.last_name,
          email: p.email ?? prev.email,
          phone: p.phone ?? prev.phone,
          current_designation: backfillDesignation || prev.current_designation,
          current_organization: backfillOrganization || prev.current_organization,
          location: p.location ?? prev.location,
          linkedin_profile: p.linkedin_profile ?? nextUrl.trim() ?? prev.linkedin_profile,
          skills: p.skills.length ? p.skills : prev.skills,
          skillsText: p.skills.length ? p.skills.join(", ") : prev.skillsText,
          notes: p.notes ?? prev.notes,
          experience: expRows.length ? expRows : prev.experience,
          education: eduRows.length ? eduRows : prev.education,
        }));
        setParseSource(result.value.source);
        setClaudeError(result.value.claudeError);
        // Auto-run the dup-check against the parser-extracted email so the
        // banner / green checkmark appears without the recruiter having to
        // manually focus + blur the field.
        const parsedEmail = (p.email ?? "").trim();
        if (parsedEmail) void runEmailDupCheck(parsedEmail);
        toast.success(result.value.source === "claude" ? "Parsed with Claude" : "Basic extraction only", {
          id: toastId,
          description:
            result.value.source === "claude"
              ? "Review and edit any field before saving."
              : result.value.claudeError ?? undefined,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Parse failed.";
        setParseError(msg);
        toast.error("Couldn't parse resume", { id: toastId, description: msg });
      }
    });
  }

  // Auto-parse on drop per the auto-vs-manual rule — resume parsing is
  // structured data extraction, so it runs immediately. (Summaries /
  // writeups stay explicit-button-only.)
  function onFiles(files: File[]) {
    const file = files[0] ?? null;
    // Clean up any prior staging row so the table doesn't accumulate dead rows.
    if (resumeUploadId) void discardResumeUpload(resumeUploadId);
    setResume(file);
    setResumeUploadId(null);
    setParseSource(null);
    if (file) runParse({ file });
  }

  function onLinkedinChange(v: string) {
    setLinkedinUrl(v);
    setForm((prev) => (prev.linkedin_profile ? prev : { ...prev, linkedin_profile: v }));
  }

  async function runEmailDupCheck(emailRaw: string) {
    const email = emailRaw.trim();
    if (!email) {
      setEmailDuplicate(null);
      setEmailCheckStatus("idle");
      return;
    }
    setEmailCheckStatus("checking");
    try {
      const res = await checkCandidateEmail(email);
      if (!res.ok) {
        setEmailDuplicate(null);
        setEmailCheckStatus("idle");
        return;
      }
      if (res.duplicate) {
        setEmailDuplicate(res.duplicate);
        setEmailCheckStatus("duplicate");
      } else {
        setEmailDuplicate(null);
        setEmailCheckStatus("clean");
      }
    } catch {
      setEmailDuplicate(null);
      setEmailCheckStatus("idle");
    }
  }

  function onEmailBlur() {
    void runEmailDupCheck(form.email);
  }

  function onSave() {
    setSaveError(null);
    const payload: CreateCandidatePayload = {
      ...form,
      skills: form.skillsText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      experience: form.experience,
      education: form.education,
    };
    if (!payload.email.trim()) {
      const msg = "Email is required — every candidate must have an email on file.";
      setSaveError(msg);
      toast.error("Can't save yet", { description: msg });
      return;
    }
    if (!payload.first_name.trim()) {
      const msg = "First name is required — resume parsing didn't fill it in, please type it manually.";
      setSaveError(msg);
      toast.error("Can't save yet", { description: msg });
      return;
    }
    const toastId = toast.loading("Saving candidate…");
    startSave(async () => {
      try {
        // Hard gate: always run the dup check server-side at submit time,
        // regardless of whether blur already ran. Prevents a race where the
        // client state is stale (e.g. user typed an email, never blurred,
        // and the backing row was just inserted by a parallel tab).
        const email = payload.email.trim();
        const dupCheck = await checkCandidateEmail(email);
        if (dupCheck.ok && dupCheck.duplicate) {
          setEmailDuplicate(dupCheck.duplicate);
          setEmailCheckStatus("duplicate");
          toast.error("Duplicate email", { id: toastId });
          return;
        }
        if (!dupCheck.ok) {
          setSaveError(dupCheck.error);
          toast.error("Couldn't verify email", { id: toastId, description: dupCheck.error });
          return;
        }
        const result = await createCandidate({ ...payload, resumeUploadId });
        if (!result.ok) {
          if (result.duplicate) {
            setEmailDuplicate(result.duplicate);
            setEmailCheckStatus("duplicate");
            toast.error("Duplicate email", { id: toastId });
            return;
          }
          setSaveError(result.error);
          toast.error("Couldn't save candidate", { id: toastId, description: result.error });
          return;
        }
        // Staging row was consumed server-side — no need to discard on the client.
        toast.success(`Saved ${payload.first_name} ${payload.last_name}`.trim(), { id: toastId });
        router.push(`/candidates/${result.value.id}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unexpected save error.";
        // eslint-disable-next-line no-console
        console.error("[createCandidate] client caught:", err);
        setSaveError(msg);
        toast.error("Couldn't save candidate", { id: toastId, description: msg });
      }
    });
  }

  function onReset() {
    if (resumeUploadId) void discardResumeUpload(resumeUploadId);
    setResume(null);
    setResumeUploadId(null);
    setPastedText("");
    setLinkedinUrl("");
    setForm(EMPTY);
    setParseSource(null);
    setClaudeError(null);
    setParseError(null);
    setEmailDuplicate(null);
    setEmailCheckStatus("idle");
    setSaveError(null);
  }

  const showFallbackBanner = parseSource === "fallback";

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
      {/* Left: inputs */}
      <div className="space-y-6 lg:col-span-2">
        <div className="rounded-xl border border-court-border/40 bg-court-surface shadow-sm">
          <div className="border-b border-court-border px-5 py-3">
            <h2 className="font-serif text-base font-semibold text-court-fg">Resume</h2>
            <p className="text-xs text-court-fg-muted">
              Drop a PDF and we&apos;ll parse it automatically. If Claude is unavailable, a basic extractor fills in name / email / phone. Re-parse manually after editing the LinkedIn fields below.
            </p>
          </div>
          <div className="p-5">
            <DocumentDropzone
              multiple={false}
              isBusy={isParsing}
              accept="application/pdf,.pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,.txt"
              onFiles={onFiles}
              emptyHint="PDF, DOC/DOCX, or TXT up to 15MB"
            />
            {resume && (
              <div className="mt-3 flex items-center justify-between rounded-lg border border-court-border bg-court-surface-subtle/40 px-3 py-2 text-xs">
                <span className="truncate text-court-fg">
                  {resume.name}
                  {isParsing && <span className="ml-2 text-court-fg-muted">· parsing…</span>}
                  {!isParsing && !parseSource && <span className="ml-2 text-court-fg-muted">· ready to parse</span>}
                  {!isParsing && parseSource === "claude" && <span className="ml-2 text-brand-dark">· parsed with Claude</span>}
                  {!isParsing && parseSource === "fallback" && <span className="ml-2 text-amber-700">· basic extraction</span>}
                </span>
                <button
                  type="button"
                  onClick={() => setResume(null)}
                  className="text-court-fg-muted hover:text-court-fg"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-court-border/40 bg-court-surface shadow-sm">
          <div className="border-b border-court-border px-5 py-3">
            <h2 className="font-serif text-base font-semibold text-court-fg">LinkedIn</h2>
            <p className="text-xs text-court-fg-muted">
              URL is saved on the record. For full enrichment, paste the profile text below and re-parse from the resume dropzone (LinkedIn blocks automated URL fetches).
            </p>
          </div>
          <div className="space-y-3 p-5">
            <Field label="Profile URL" type="url" value={linkedinUrl} onChange={onLinkedinChange} placeholder="https://linkedin.com/in/…" />
            <div>
              <label className="text-[11px] uppercase tracking-wider text-court-fg-muted">Pasted profile text (optional)</label>
              <div className={`${INPUT_FRAME_RECT_CLASS} mt-1 w-full`}>
                <textarea
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  rows={6}
                  placeholder="Paste the LinkedIn About / Experience section here — included in the next parse."
                  className={`${INPUT_CONTROL_CLASS} resize-none font-sans text-sm leading-relaxed`}
                />
              </div>
            </div>
            <button
              type="button"
              onClick={() => runParse()}
              disabled={isParsing || (!resume && !pastedText.trim() && !linkedinUrl.trim())}
              className={cn(CLAUDE_PILL_CLASS, "w-full justify-center")}
            >
              {isParsing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              {parseSource ? "Re-parse with Claude" : "Parse with Claude"}
            </button>
          </div>
        </div>

        {parseSource && (
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1.5 rounded-lg border border-court-border bg-court-surface px-3 py-2 text-xs font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg"
          >
            Clear and start over
          </button>
        )}
        {parseError && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{parseError}</div>}
      </div>

      {/* Right: editable fields */}
      <div className="lg:col-span-3">
        <div className="rounded-xl border border-court-border/40 bg-court-surface shadow-sm">
          <div className="flex items-center justify-between border-b border-court-border px-5 py-3">
            <div>
              <h2 className="font-serif text-base font-semibold text-court-fg">Candidate fields</h2>
              <p className="text-xs text-court-fg-muted">
                {parseSource === "claude"
                  ? "Pre-filled by Claude — review and edit before saving."
                  : parseSource === "fallback"
                    ? "Basic extraction only — please review every field."
                    : "Drop a resume on the left or fill these in manually."}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={onSave}
              // Save is gated on four things:
              //   - no pending save or parse
              //   - email is non-empty (required field)
              //   - dup-check has resolved cleanly (not "duplicate" / "checking" / "idle")
              // The hard-gate recheck inside onSave is still the source of
              // truth; this just prevents obvious UX dead-ends.
              disabled={
                isSaving ||
                isParsing ||
                !form.email.trim() ||
                emailCheckStatus !== "clean"
              }
              title={
                emailCheckStatus === "duplicate"
                  ? "This candidate already exists in Ace"
                  : isParsing
                    ? "Wait for parsing to finish first"
                    : emailCheckStatus === "checking"
                      ? "Checking email…"
                      : emailCheckStatus === "idle" && form.email.trim()
                        ? "Tab out of the email field to run the duplicate check"
                        : !form.email.trim()
                          ? "Email is required"
                          : undefined
              }
            >
              {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              {isParsing ? "Waiting for parse…" : "Save to Ace"}
            </Button>
          </div>

          {showFallbackBanner && (
            <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-5 py-3 text-xs text-amber-900">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div>
                Claude parsing wasn&apos;t available — we fell back to regex-based extraction. Name, email, and phone are likely correct; title / employer / skills need manual entry.
                {claudeError && <div className="mt-1 font-mono text-[10px] opacity-70">Claude said: {claudeError}</div>}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field
                label="Email"
                type="email"
                required
                value={form.email}
                onChange={(v) => {
                  setForm({ ...form, email: v });
                  // Any edit invalidates the last dup-check result — reset to
                  // "idle" so the green checkmark clears and the next blur
                  // (or onSave hard-gate) re-runs against the new value.
                  setEmailDuplicate(null);
                  setEmailCheckStatus("idle");
                }}
                onBlur={onEmailBlur}
                hint={
                  emailCheckStatus === "checking" ? (
                    "Checking…"
                  ) : emailCheckStatus === "clean" ? (
                    <span className="inline-flex items-center gap-1 text-green-700">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Available
                    </span>
                  ) : emailCheckStatus === "duplicate" ? (
                    "Duplicate detected"
                  ) : undefined
                }
                hintTone={emailCheckStatus === "duplicate" ? "error" : "muted"}
              />
              {emailDuplicate && (
                <div className="mt-2 flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <div>
                      This candidate already exists in Ace.
                      <span className="ml-1 text-red-800/80">({emailDuplicate.name})</span>
                    </div>
                  </div>
                  <Link
                    href={`/candidates/${emailDuplicate.id}`}
                    className="shrink-0 rounded-md border border-red-300 bg-court-surface px-2.5 py-1 text-[11px] font-semibold text-red-800 shadow-sm transition hover:bg-red-100"
                  >
                    View Profile
                  </Link>
                </div>
              )}
            </div>
            <Field label="First name" required value={form.first_name} onChange={(v) => setForm({ ...form, first_name: v })} />
            <Field label="Last name" value={form.last_name} onChange={(v) => setForm({ ...form, last_name: v })} />
            <Field label="Current title" value={form.current_designation} onChange={(v) => setForm({ ...form, current_designation: v })} />
            <Field label="Current employer" value={form.current_organization} onChange={(v) => setForm({ ...form, current_organization: v })} />
            <Field label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} placeholder="+1 216-555-5555" />
            <Field label="Location" value={form.location} onChange={(v) => setForm({ ...form, location: v })} placeholder="Cleveland, OH" />
            <Field label="LinkedIn" type="url" value={form.linkedin_profile} onChange={(v) => setForm({ ...form, linkedin_profile: v })} />
            <div className="sm:col-span-2">
              <Field
                label="Skills"
                value={form.skillsText}
                onChange={(v) => setForm({ ...form, skillsText: v })}
                placeholder="Comma-separated, e.g. Java, GAAP, SOX, NetSuite"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-[11px] uppercase tracking-wider text-court-fg-muted">Notes</label>
              <div className={`${INPUT_FRAME_RECT_CLASS} mt-1 w-full`}>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={5}
                  placeholder="Short summary of the candidate's background, or internal recruiter notes."
                  className={`${INPUT_CONTROL_CLASS} resize-none text-sm leading-relaxed`}
                />
              </div>
            </div>
          </div>
          {(form.experience.length > 0 || form.education.length > 0) && (
            <div className="grid grid-cols-1 gap-4 border-t border-court-border px-5 py-5 sm:grid-cols-2">
              {form.experience.length > 0 && (
                <div>
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-court-fg-muted">
                    Experience (will save to Ace)
                  </h3>
                  <ul className="mt-2 space-y-2 text-sm">
                    {form.experience.map((r, i) => (
                      <li key={`exp-${i}`} className="rounded-lg border border-court-border bg-court-surface-subtle/40 px-3 py-2">
                        <div className="font-medium text-court-fg">{r.designation || "(role)"} <span className="font-normal text-court-fg-muted">· {r.organization || "(employer)"}</span></div>
                        <div className="text-[11px] text-court-fg-muted">
                          {[r.from_year, r.to_year ?? "present"].filter(Boolean).join(" – ") || "—"}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {form.education.length > 0 && (
                <div>
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-court-fg-muted">
                    Education (will save to Ace)
                  </h3>
                  <ul className="mt-2 space-y-2 text-sm">
                    {form.education.map((r, i) => (
                      <li key={`edu-${i}`} className="rounded-lg border border-court-border bg-court-surface-subtle/40 px-3 py-2">
                        <div className="font-medium text-court-fg">{r.degree || "(degree)"} <span className="font-normal text-court-fg-muted">· {r.school || "(school)"}</span></div>
                        <div className="text-[11px] text-court-fg-muted">
                          {[r.from_year, r.to_year].filter(Boolean).join(" – ") || "—"}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          {saveError && (
            <div className="border-t border-court-border px-5 py-3 text-xs text-red-800">
              <div className="rounded-lg border border-red-200 bg-red-50 p-3">{saveError}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  onBlur,
  type = "text",
  required,
  placeholder,
  hint,
  hintTone = "muted",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
  hint?: ReactNode;
  hintTone?: "muted" | "error";
}) {
  return (
    <label className="block text-sm">
      <span className="flex items-baseline justify-between text-[11px] uppercase tracking-wider text-court-fg-muted">
        <span>
          {label}
          {required && <span className="ml-0.5 text-red-500">*</span>}
        </span>
        {hint && (
          <span
            className={cn(
              "normal-case tracking-normal",
              hintTone === "error" ? "text-red-600" : "text-court-fg-muted",
            )}
          >
            {hint}
          </span>
        )}
      </span>
      <div className={`${INPUT_FRAME_RECT_CLASS} mt-1 w-full`}>
        <input
          type={type}
          value={value}
          required={required}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          className={`${INPUT_CONTROL_CLASS} text-sm`}
        />
      </div>
    </label>
  );
}
