"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Save, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { DocumentDropzone } from "@/components/document-dropzone";
import { uploadFileInChunks } from "@/lib/chunked-upload";
import { cn } from "@/lib/utils";
import {
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
    if (!payload.first_name.trim()) {
      const msg = "First name is required — resume parsing didn't fill it in, please type it manually.";
      setSaveError(msg);
      toast.error("Can't save yet", { description: msg });
      return;
    }
    const toastId = toast.loading("Saving candidate…");
    startSave(async () => {
      try {
        const result = await createCandidate({ ...payload, resumeUploadId });
        if (!result.ok) {
          if (result.duplicate) {
            const dupId = result.duplicate.id;
            const dupName = result.duplicate.name;
            toast.error("Duplicate email", {
              id: toastId,
              description: `A candidate with this email already exists: ${dupName}`,
              action: {
                label: "Open profile",
                onClick: () => router.push(`/candidates/${dupId}`),
              },
            });
            setSaveError(`A candidate with this email already exists: ${dupName}`);
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
    setSaveError(null);
  }

  const showFallbackBanner = parseSource === "fallback";

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
      {/* Left: inputs */}
      <div className="space-y-6 lg:col-span-2">
        <div className="rounded-xl border border-border bg-white shadow-sm">
          <div className="border-b border-border px-5 py-3">
            <h2 className="font-serif text-base font-semibold text-navy">Resume</h2>
            <p className="text-xs text-muted-foreground">
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
              <div className="mt-3 flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
                <span className="truncate text-navy">
                  {resume.name}
                  {isParsing && <span className="ml-2 text-muted-foreground">· parsing…</span>}
                  {!isParsing && !parseSource && <span className="ml-2 text-muted-foreground">· ready to parse</span>}
                  {!isParsing && parseSource === "claude" && <span className="ml-2 text-brand-dark">· parsed with Claude</span>}
                  {!isParsing && parseSource === "fallback" && <span className="ml-2 text-amber-700">· basic extraction</span>}
                </span>
                <button
                  type="button"
                  onClick={() => setResume(null)}
                  className="text-muted-foreground hover:text-navy"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-white shadow-sm">
          <div className="border-b border-border px-5 py-3">
            <h2 className="font-serif text-base font-semibold text-navy">LinkedIn</h2>
            <p className="text-xs text-muted-foreground">
              URL is saved on the record. For full enrichment, paste the profile text below and re-parse from the resume dropzone (LinkedIn blocks automated URL fetches).
            </p>
          </div>
          <div className="space-y-3 p-5">
            <Field label="Profile URL" type="url" value={linkedinUrl} onChange={onLinkedinChange} placeholder="https://linkedin.com/in/…" />
            <div>
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Pasted profile text (optional)</label>
              <textarea
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                rows={6}
                placeholder="Paste the LinkedIn About / Experience section here — included in the next parse."
                className={cn(
                  "mt-1 w-full resize-vertical rounded-lg border border-border bg-white px-3 py-2 font-sans text-sm leading-relaxed text-navy",
                  "focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20",
                )}
              />
            </div>
            <button
              type="button"
              onClick={() => runParse()}
              disabled={isParsing || (!resume && !pastedText.trim() && !linkedinUrl.trim())}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-navy px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-navy-600 disabled:cursor-not-allowed disabled:opacity-50"
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
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-medium text-navy-400 shadow-sm transition hover:text-navy"
          >
            Clear and start over
          </button>
        )}
        {parseError && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{parseError}</div>}
      </div>

      {/* Right: editable fields */}
      <div className="lg:col-span-3">
        <div className="rounded-xl border border-border bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <div>
              <h2 className="font-serif text-base font-semibold text-navy">Candidate fields</h2>
              <p className="text-xs text-muted-foreground">
                {parseSource === "claude"
                  ? "Pre-filled by Claude — review and edit before saving."
                  : parseSource === "fallback"
                    ? "Basic extraction only — please review every field."
                    : "Drop a resume on the left or fill these in manually."}
              </p>
            </div>
            <button
              type="button"
              onClick={onSave}
              // Block save while parsing — clicking before Claude's response
              // lands meant we'd write empty current_designation /
              // current_organization to the DB even though the parsed
              // values were seconds away from arriving.
              disabled={isSaving || isParsing}
              title={isParsing ? "Wait for parsing to finish first" : undefined}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
            >
              {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              {isParsing ? "Waiting for parse…" : "Save to Ace"}
            </button>
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
            <Field label="First name" required value={form.first_name} onChange={(v) => setForm({ ...form, first_name: v })} />
            <Field label="Last name" value={form.last_name} onChange={(v) => setForm({ ...form, last_name: v })} />
            <Field label="Current title" value={form.current_designation} onChange={(v) => setForm({ ...form, current_designation: v })} />
            <Field label="Current employer" value={form.current_organization} onChange={(v) => setForm({ ...form, current_organization: v })} />
            <Field label="Email" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
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
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={5}
                placeholder="Short summary of the candidate's background, or internal recruiter notes."
                className={cn(
                  "mt-1 w-full resize-vertical rounded-lg border border-border bg-white px-3 py-2 text-sm leading-relaxed text-navy",
                  "focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20",
                )}
              />
            </div>
          </div>
          {(form.experience.length > 0 || form.education.length > 0) && (
            <div className="grid grid-cols-1 gap-4 border-t border-border px-5 py-5 sm:grid-cols-2">
              {form.experience.length > 0 && (
                <div>
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Experience (will save to Ace)
                  </h3>
                  <ul className="mt-2 space-y-2 text-sm">
                    {form.experience.map((r, i) => (
                      <li key={`exp-${i}`} className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                        <div className="font-medium text-navy">{r.designation || "(role)"} <span className="font-normal text-muted-foreground">· {r.organization || "(employer)"}</span></div>
                        <div className="text-[11px] text-muted-foreground">
                          {[r.from_year, r.to_year ?? "present"].filter(Boolean).join(" – ") || "—"}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {form.education.length > 0 && (
                <div>
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Education (will save to Ace)
                  </h3>
                  <ul className="mt-2 space-y-2 text-sm">
                    {form.education.map((r, i) => (
                      <li key={`edu-${i}`} className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                        <div className="font-medium text-navy">{r.degree || "(degree)"} <span className="font-normal text-muted-foreground">· {r.school || "(school)"}</span></div>
                        <div className="text-[11px] text-muted-foreground">
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
            <div className="border-t border-border px-5 py-3 text-xs text-red-800">
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
  type = "text",
  required,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      <input
        type={type}
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-navy placeholder:text-muted-foreground/60 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
      />
    </label>
  );
}
