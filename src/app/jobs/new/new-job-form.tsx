"use client";

import { useRef, useState, useTransition, type ChangeEvent, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, FileText, Loader2, Save, Sparkles, UploadCloud, X } from "lucide-react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { LabeledTextarea } from "@/app/candidates/[id]/editable-helpers";
import { createJob, extractFieldsFromGeneratedJd, generateJobDescriptionFromSource } from "@/app/jobs/new/actions";
import { Button, CLAUDE_PILL_CLASS } from "@/components/ui/button";
import { INPUT_FRAME_RECT_CLASS, INPUT_CONTROL_CLASS } from "@/components/ui/input";
import { TabStrip } from "@/components/ui/tab-strip";
import { cn } from "@/lib/utils";

const JOB_TYPES = ["Permanent", "Contract", "Contract to Hire", "Temporary", "Internship"] as const;
const EMPLOYMENT_TYPES = ["Full time", "Part time", "Contract"] as const;

type ParseUrlSuccess = {
  ok: true;
  extracted: string;
  fields: {
    title?: string;
    location?: string;
    city?: string;
    state?: string;
    zip?: string;
    salaryLow?: number;
    salaryHigh?: number;
  };
  urlSaved: boolean;
};

type ParseUrlFailure = {
  ok: false;
  error: "auth_required" | "bad_request" | "indeed_blocked" | "linkedin_blocked" | "fetch_failed" | "parse_failed";
  message: string;
  urlSaved: boolean;
};

function isParseSuccess(data: unknown): data is ParseUrlSuccess {
  return (
    !!data &&
    typeof data === "object" &&
    "ok" in data &&
    (data as { ok: unknown }).ok === true &&
    "extracted" in data &&
    typeof (data as { extracted: unknown }).extracted === "string"
  );
}

function isParseError(data: unknown): data is ParseUrlFailure {
  return (
    !!data &&
    typeof data === "object" &&
    "ok" in data &&
    (data as { ok: unknown }).ok === false &&
    "error" in data &&
    typeof (data as { error: unknown }).error === "string"
  );
}

// Backed by Job.salaryFrequency on the schema (existing column). "yearly"
// is the canonical default for new jobs — recruiters can flip to hourly
// for trades / temp / contract roles where the comp is quoted by the
// hour. The label flip on the salary inputs surfaces the unit choice so
// "20" doesn't get misread as $20k.
type SalaryFrequency = "yearly" | "hourly";

// Phase 2: clients dropdown carries cuids (Ace-native + RF-imported) — the
// form submits clientId directly to the Neon-native createJob action.
export function NewJobForm({
  clients,
  defaultClientId = "",
}: {
  clients: Array<{ id: string; name: string }>;
  // Pre-selected client cuid when launched from a client overview's
  // "+ New Job" button. Validated against the org-scoped list server-side.
  defaultClientId?: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [clientId, setClientId] = useState<string>(defaultClientId);
  // Location is split into three searchable parts. The createJob action
  // composes the legacy `locations` array string ("City, ST Zip") from
  // these so existing readers stay untouched. State accepts the 2-letter
  // abbreviation or the full state name.
  const [locationCity, setLocationCity] = useState("");
  const [locationState, setLocationState] = useState("");
  const [locationZip, setLocationZip] = useState("");
  const [jobType, setJobType] = useState<string>(JOB_TYPES[0]);
  const [employmentType, setEmploymentType] = useState<string>(EMPLOYMENT_TYPES[0]);
  const [salaryFrequency, setSalaryFrequency] = useState<SalaryFrequency>("yearly");
  const [salaryLow, setSalaryLow] = useState("");
  const [salaryHigh, setSalaryHigh] = useState("");
  // True while either salary field has focus. Used to suppress the amber
  // "invalid range" tint WHILE the recruiter is typing: a multi-digit salary
  // is entered one digit at a time, so the in-progress second number is
  // transiently smaller than the other field (e.g. typing "1" then "100000"
  // against an existing "80000"), which briefly trips loNum > hiNum and
  // flashed both boxes pale yellow. The blur handlers auto-swap a reversed
  // range, so the range is only ever "invalid" mid-keystroke - never worth
  // showing then.
  const [salaryFocused, setSalaryFocused] = useState(false);
  const [currency, setCurrency] = useState("USD");
  const [openings, setOpenings] = useState("1");
  const [description, setDescription] = useState("");
  const [err, setErr] = useState<string | null>(null);
  // Inline field errors for the location validation pass that runs
  // before createJob. Cleared on every edit to the relevant field so
  // the message disappears as the recruiter retypes.
  const [cityErr, setCityErr] = useState<string | null>(null);
  const [stateErr, setStateErr] = useState<string | null>(null);
  const [zipErr, setZipErr] = useState<string | null>(null);
  const [validatingLocation, setValidatingLocation] = useState(false);
  const [isPending, startSave] = useTransition();

  const jdInputRef = useRef<HTMLInputElement>(null);
  const [jdFile, setJdFile] = useState<File | null>(null);
  const [isGenerating, startGenerate] = useTransition();

  const [sourceUrl, setSourceUrl] = useState("");
  // Which source the "Add Job Description" card is showing — paste a URL or
  // upload a JD file. Controlled TabStrip; defaults to the URL paste tab.
  const [sourceTab, setSourceTab] = useState<"url" | "file">("url");
  const [isParsing, setParsing] = useState(false);
  const [parseInlineError, setParseInlineError] = useState<string | null>(null);
  const [isCombinedRunning, setCombinedRunning] = useState(false);
  const [linkSaved, setLinkSaved] = useState(false);
  const [internalRecruiterNotes, setInternalRecruiterNotes] = useState("");
  const [isDragOver, setDragOver] = useState(false);
  // Drag events bubble from child elements, so a naive onDragLeave on the
  // outer row flips the highlight off whenever the cursor crosses a child.
  // The counter tracks net enters vs. leaves and only clears the highlight
  // when the cursor truly exits the drop zone.
  const dragCounter = useRef(0);

  function isAcceptedJdFile(f: File): boolean {
    const name = f.name.toLowerCase();
    return (
      f.type === "application/pdf" ||
      f.type === "application/msword" ||
      f.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      name.endsWith(".pdf") ||
      name.endsWith(".doc") ||
      name.endsWith(".docx")
    );
  }

  function clearJd() {
    setJdFile(null);
    if (jdInputRef.current) jdInputRef.current.value = "";
  }

  // The actual generate-JD work, with no transition wrapper. Callers pass
  // overrides to avoid racing setState — e.g. on file pick we already
  // have the File in hand, and onParseAndGenerate has fresh source text
  // from the route before React has flushed the description state.
  // fileOverride === null means "this generate is from typed text, ignore
  // any previously uploaded jdFile" (used by Parse & Edit JD).
  type GenerateOptions = { fileOverride?: File | null; sourceTextOverride?: string };
  async function doGenerate(opts: GenerateOptions = {}): Promise<void> {
    const fileToUse = opts.fileOverride !== undefined ? opts.fileOverride : jdFile;
    let filePayload: { filename: string; mimeType: string; base64: string } | null = null;
    if (fileToUse) {
      const buffer = await fileToUse.arrayBuffer();
      const base64 = arrayBufferToBase64(buffer);
      filePayload = {
        filename: fileToUse.name,
        mimeType: fileToUse.type || "application/octet-stream",
        base64,
      };
    }
    const result = await generateJobDescriptionFromSource({
      jobTitle: title.trim(),
      sourceText: opts.sourceTextOverride ?? description,
      file: filePayload,
    });
    if (!result.ok) {
      setErr(result.error);
      toast.error("Couldn't generate job description", { description: result.error });
      return;
    }
    // The server action returns { fallback: true, text: JD_FALLBACK_TEXT }
    // whenever the Claude call throws (529 overload, network blip, missing
    // API key, etc.). Loading that placeholder into Description would clobber
    // whatever the recruiter has so far, including a URL-parsed JD or the
    // freshly staged file's context. Surface the busy state instead and
    // leave the form exactly as it was so the user can retry.
    if (result.value.fallback) {
      toast.error("Claude API is busy. Try again in a moment. Your file is still staged.");
      return;
    }
    setDescription(result.value.text);
    toast.success("Job description generated", { description: "Edit before saving if needed." });
    // Fire-and-forget structured-field extraction. The JD preview renders
    // immediately above; this Claude follow-up backfills empty Job Title /
    // Location / Salary inputs a beat later. Same only-if-empty rules as the
    // URL parse path. Any failure (no key, Claude error, non-JSON) is
    // swallowed — auto-fill is best-effort, not a blocker.
    void extractFieldsFromGeneratedJd(result.value.text)
      .then((f) => {
        if (f.title && !title.trim()) setTitle(f.title);
        if (f.city && !locationCity.trim()) setLocationCity(f.city);
        if (f.state && !locationState.trim()) setLocationState(f.state);
        if (f.zip && !locationZip.trim()) setLocationZip(f.zip);
        if (typeof f.salaryLow === "number" && salaryLow === "") setSalaryLow(String(f.salaryLow));
        if (typeof f.salaryHigh === "number" && salaryHigh === "") setSalaryHigh(String(f.salaryHigh));
        // Salary Type dropdown — flip whenever Claude tells us the comp is
        // hourly vs salaried so the labels on the comp inputs match (Hourly
        // low/high vs Salary low/high). Mapping: HOURLY → "hourly",
        // SALARY → "yearly" (the form's internal SalaryFrequency value).
        // Absent → leave the dropdown untouched.
        if (f.salaryType === "HOURLY") setSalaryFrequency("hourly");
        else if (f.salaryType === "SALARY") setSalaryFrequency("yearly");
      })
      .catch(() => {
        // silent — field auto-fill is best-effort
      });
  }

  // Picking or dropping a JD only stages the file. The recruiter must
  // click "Parse & Generate JD with Claude" above to actually invoke
  // Claude — otherwise an accidental drop would burn a Claude call and
  // overwrite the Description textarea before the recruiter is ready.
  function onPickJd(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (!f) return;
    setJdFile(f);
  }

  function acceptDroppedFile(f: File | null) {
    if (!f) return;
    if (!isAcceptedJdFile(f)) {
      toast.error("Unsupported file type", { description: "Drop a PDF or DOCX." });
      return;
    }
    setJdFile(f);
  }

  function onDragEnter(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (dragCounter.current === 1) setDragOver(true);
  }

  function onDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setDragOver(false);
  }

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setDragOver(false);
    const f = e.dataTransfer.files?.[0] ?? null;
    acceptDroppedFile(f);
  }

  function onParseAndEditJd() {
    setErr(null);
    startGenerate(async () => {
      await doGenerate({ fileOverride: null });
    });
  }

  function onSaveLink() {
    const url = sourceUrl.trim();
    if (!url) return;
    const note = `Client Job Link: ${url}`;
    setInternalRecruiterNotes((prev) => {
      if (!prev.trim()) return note;
      if (prev.includes(note)) return prev;
      return `${prev}\n${note}`;
    });
    setLinkSaved(true);
  }

  async function onParseAndGenerate() {
    setErr(null);
    setParseInlineError(null);
    setLinkSaved(false);
    setCombinedRunning(true);
    try {
      let parsedText: string | undefined;
      if (sourceUrl.trim()) {
        // Capture the parsed text from the route response so doGenerate
        // doesn't race a stale `description` state read before React flushes.
        const url = sourceUrl.trim();
        setParsing(true);
        try {
          const res = await fetch("/api/jobs/parse-url", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url }),
          });
          const data: unknown = await res.json();
          if (!isParseSuccess(data)) {
            const errRes = isParseError(data) ? data : null;
            const code = errRes?.error ?? null;
            const message = errRes?.message ?? "Parse failed.";
            if (code === "indeed_blocked" || code === "linkedin_blocked") {
              setParseInlineError(message);
            } else {
              toast.error("Couldn't parse the link", { description: message });
            }
            return;
          }
          const f = data.fields ?? {};
          if (f.title && !title.trim()) setTitle(f.title);
          if (f.city && !locationCity.trim()) setLocationCity(f.city);
          if (f.state && !locationState.trim()) setLocationState(f.state);
          if (f.zip && !locationZip.trim()) setLocationZip(f.zip);
          if (typeof f.salaryLow === "number" && salaryLow === "") setSalaryLow(String(f.salaryLow));
          if (typeof f.salaryHigh === "number" && salaryHigh === "") setSalaryHigh(String(f.salaryHigh));
          setDescription(data.extracted);
          parsedText = data.extracted;
        } finally {
          setParsing(false);
        }
      }
      await doGenerate({ sourceTextOverride: parsedText });
    } finally {
      setCombinedRunning(false);
    }
  }

  const loNum = salaryLow === "" ? null : Number(salaryLow);
  const hiNum = salaryHigh === "" ? null : Number(salaryHigh);
  const rangeInvalid = loNum != null && hiNum != null && loNum > hiNum;
  // Only surface the invalid-range styling/message when the recruiter is NOT
  // actively typing in the salary fields. This keeps a genuinely reversed
  // range visible (e.g. a bad AI auto-fill, which the user can then correct)
  // while killing the mid-keystroke pale-yellow flash described above.
  const showRangeInvalid = rangeInvalid && !salaryFocused;

  function onSalaryLowBlur() {
    // Auto-swap for convenience when both values are present and reversed.
    if (loNum != null && hiNum != null && loNum > hiNum) {
      setSalaryLow(String(hiNum));
      setSalaryHigh(String(loNum));
    }
  }

  function onSalaryHighBlur() {
    if (loNum != null && hiNum != null && loNum > hiNum) {
      setSalaryLow(String(hiNum));
      setSalaryHigh(String(loNum));
    }
  }

  async function onSubmit() {
    setErr(null);
    setCityErr(null);
    setStateErr(null);
    setZipErr(null);

    if (!title.trim()) {
      setErr("Job title is required.");
      return;
    }
    if (loNum != null && loNum < 0) {
      setErr("Salary low can't be negative.");
      return;
    }
    if (hiNum != null && hiNum < 0) {
      setErr("Salary high can't be negative.");
      return;
    }
    if (loNum != null && hiNum != null && loNum > hiNum) {
      setErr("Salary low can't be greater than salary high.");
      return;
    }

    // City / State / Zip are REQUIRED on new jobs so a loose/region-only
    // location can never be entered again. Block submit with inline
    // errors when any is missing or malformed (State must be a 2-letter
    // abbreviation, Zip 5 digits). The same guards run again inside the
    // createJob server action — never trust client-only.
    const cityToCheck = locationCity.trim();
    const stateToCheck = locationState.trim();
    const zipToCheck = locationZip.trim();
    let locationInvalid = false;
    if (!cityToCheck) {
      setCityErr("City is required.");
      locationInvalid = true;
    }
    if (!stateToCheck) {
      setStateErr("State is required.");
      locationInvalid = true;
    } else if (!/^[A-Za-z]{2}$/.test(stateToCheck)) {
      setStateErr("Use the 2-letter state abbreviation.");
      locationInvalid = true;
    }
    if (!zipToCheck) {
      setZipErr("Zip is required.");
      locationInvalid = true;
    } else if (!/^\d{5}$/.test(zipToCheck)) {
      setZipErr("Enter a 5-digit US zip code.");
      locationInvalid = true;
    }
    if (locationInvalid) return;

    // Pre-save US location round-trip (Nominatim / Zippopotam). City +
    // zip are now always present, so this always runs. The same helpers
    // run again inside createJob as defense-in-depth; doing the call here
    // lets us point the recruiter at the right field on failure.
    {
      setValidatingLocation(true);
      try {
        const res = await fetch("/api/location/validate-us", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ city: cityToCheck, zip: zipToCheck }),
        });
        if (res.ok) {
          const data = (await res.json()) as {
            ok: boolean;
            errors: { city?: string; zip?: string };
          };
          if (!data.ok) {
            if (data.errors.city) setCityErr(data.errors.city);
            if (data.errors.zip) setZipErr(data.errors.zip);
            return;
          }
        }
        // Non-ok response → fail open (matches the lib's network
        // fail-open policy so a transient upstream blip can't gate the
        // recruiter's save).
      } catch {
        // Same fail-open behavior on network errors.
      } finally {
        setValidatingLocation(false);
      }
    }

    startSave(async () => {
      const result = await createJob({
        title: title.trim(),
        clientId,
        locationCity: locationCity.trim(),
        locationState: locationState.trim(),
        locationZip: locationZip.trim(),
        jobType,
        employmentType,
        salaryRangeStart: loNum,
        salaryRangeEnd: hiNum,
        salaryCurrency: currency.trim().toUpperCase().slice(0, 3) || "USD",
        salaryFrequency,
        openings: openings ? Number(openings) : null,
        description,
        sourceJobUrl: sourceUrl.trim() || null,
        internalRecruiterNotes: internalRecruiterNotes.trim() || null,
      });
      if (!result.ok) {
        setErr(result.error);
        toast.error("Couldn't create job", { description: result.error });
        return;
      }
      toast.success("Job created");
      router.push(`/jobs/${result.value.slug}`);
      router.refresh();
    });
  }

  return (
    <div className="max-w-[1100px] mx-auto px-6 pb-8">
      {/* Page header: title + helper on the left, Cancel / Save to Ace on
          the right (Save to Ace mirrors the New Client form's primary CTA). */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-court-fg">New Job</h1>
          <p className="mt-1 text-sm text-court-fg-muted">
            Create a new job by adding the details below. You can paste a job description or upload a JD to get started.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => router.push("/jobs")}
            disabled={isPending || isCombinedRunning}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void onSubmit()}
            disabled={isPending || isCombinedRunning || rangeInvalid || validatingLocation}
          >
            {isPending || validatingLocation ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Save className="h-3 w-3" />
            )}
            Save
          </Button>
        </div>
      </div>

      <div className="mt-6 space-y-6">
        {/* Section 1 — Add Job Description: paste a URL or upload a JD,
              then Parse & Generate with Claude. */}
        <div className="bg-court-surface rounded-2xl border border-court-border/40 p-6 space-y-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-court-surface border border-court-brand text-court-brand text-xs font-semibold flex items-center justify-center shrink-0">
                1
              </span>
              <h2 className="font-semibold text-court-fg">Add Job Description</h2>
            </div>
            <p className="mt-1 text-sm text-court-fg-muted">
              Provide a job description or upload a JD file. We&apos;ll parse the details for you using Claude.
            </p>
          </div>

          <TabStrip
            items={[
              { id: "url", label: "Paste URL" },
              { id: "file", label: "Upload File" },
            ]}
            activeId={sourceTab}
            onChange={setSourceTab}
            ariaLabel="Job description source"
          />

          {sourceTab === "url" ? (
            <div className="space-y-2">
              <div className={`${INPUT_FRAME_RECT_CLASS} w-full`}>
                <input
                  type="url"
                  value={sourceUrl}
                  onChange={(e) => {
                    setSourceUrl(e.target.value);
                    if (parseInlineError) setParseInlineError(null);
                    if (linkSaved) setLinkSaved(false);
                  }}
                  className={`${INPUT_CONTROL_CLASS} text-sm`}
                />
              </div>
              {parseInlineError && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <span className="min-w-0">{parseInlineError}</span>
                    {linkSaved ? (
                      <span className="inline-flex shrink-0 items-center gap-1 font-semibold text-amber-900">
                        <Check className="h-3 w-3" /> Link saved
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={onSaveLink}
                        disabled={!sourceUrl.trim()}
                        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-900 shadow-sm transition hover:bg-amber-100 disabled:opacity-60"
                      >
                        Save
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div
              onDragEnter={onDragEnter}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              className={cn(
                "flex flex-col gap-2 rounded-lg border-2 border-dashed px-3 py-2.5 transition sm:flex-row sm:items-center sm:justify-between",
                isDragOver
                  ? "border-brand bg-brand/10"
                  : "border-court-border bg-court-surface-subtle/40",
              )}
            >
              <div className="flex min-w-0 items-center gap-2 text-xs">
                {jdFile ? (
                  <>
                    <FileText className="h-3.5 w-3.5 shrink-0 text-brand-dark" />
                    <span className="truncate font-medium text-court-fg">{jdFile.name}</span>
                    <span className="text-[11px] text-court-fg-muted">{formatSize(jdFile.size)}</span>
                    <button
                      type="button"
                      onClick={clearJd}
                      className="ml-1 rounded-md p-1 text-court-fg-muted hover:bg-court-surface-subtle hover:text-court-fg"
                      aria-label="Remove uploaded JD"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </>
                ) : (
                  <>
                    <UploadCloud className="h-3.5 w-3.5 shrink-0 text-court-fg-muted" />
                    <span className="text-court-fg-muted">
                      {isDragOver
                        ? "Drop the PDF or DOCX to stage it."
                        : "Drop a PDF or DOCX here, or click to browse."}
                    </span>
                  </>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => jdInputRef.current?.click()}
                  disabled={isGenerating || isCombinedRunning}
                  className="inline-flex items-center gap-1.5 rounded-md border border-court-border bg-court-surface px-3 py-1.5 text-xs font-semibold text-court-fg shadow-sm transition hover:border-brand/40 hover:text-brand-dark disabled:opacity-60"
                >
                  <UploadCloud className="h-3.5 w-3.5" />
                  {jdFile ? "Replace file" : "Upload JD"}
                </button>
                <input
                  ref={jdInputRef}
                  type="file"
                  accept="application/pdf,.pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  className="hidden"
                  onChange={onPickJd}
                />
              </div>
            </div>
          )}

          <div className="flex justify-center">
            <button
              type="button"
              onClick={onParseAndGenerate}
              disabled={
                isCombinedRunning ||
                isParsing ||
                isGenerating ||
                (!sourceUrl.trim() && !description.trim() && !jdFile)
              }
              className={cn(
                CLAUDE_PILL_CLASS,
                "w-auto justify-center py-1.5",
                (isCombinedRunning || isParsing) && "opacity-60",
              )}
            >
              {isCombinedRunning || isParsing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              {isCombinedRunning ? "Parsing and generating…" : "Parse & Generate JD with Claude"}
            </button>
          </div>
        </div>

        {/* Section 2 — Job Details: the structured fields, laid out in
              flex rows, plus the Description textarea + preview. */}
        <div className="bg-court-surface rounded-2xl border border-court-border/40 p-6 space-y-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-court-surface border border-court-brand text-court-brand text-xs font-semibold flex items-center justify-center shrink-0">
                2
              </span>
              <h2 className="font-semibold text-court-fg">Job Details</h2>
            </div>
            <p className="mt-1 text-sm text-court-fg-muted">Review and edit the details below.</p>
          </div>

          {/* Row 1: Job Title | Client */}
          <div className="flex gap-4">
            <CompactField label="Job Title" value={title} onChange={setTitle} className="flex-1" />
            <CompactSelect label="Client" value={clientId} onChange={setClientId} className="flex-1">
              <option value="">Select a client…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </CompactSelect>
          </div>

          {/* Row 2: City | State | Zip — the composed "City, ST Zip"
              string is reassembled server-side. City + Zip carry the
              inline validation errors from the pre-save Nominatim /
              Zippopotam round-trip. Typing in either field clears its
              error so the message disappears as the recruiter retypes. */}
          <div className="flex gap-4">
            <CompactField
              label="City"
              value={locationCity}
              onChange={(v) => {
                setLocationCity(v);
                if (cityErr) setCityErr(null);
              }}
              className="flex-1"
              error={cityErr}
            />
            <CompactField
              label="State"
              value={locationState}
              onChange={(v) => {
                setLocationState(v);
                if (stateErr) setStateErr(null);
              }}
              className="flex-1"
              error={stateErr}
            />
            <CompactField
              label="Zip"
              value={locationZip}
              onChange={(v) => {
                setLocationZip(v);
                if (zipErr) setZipErr(null);
              }}
              className="w-32"
              error={zipErr}
            />
          </div>

          {/* Row 3: Employment Type | Job Type */}
          <div className="flex gap-4">
            <CompactSelect label="Employment Type" value={employmentType} onChange={setEmploymentType} className="flex-1">
              {EMPLOYMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </CompactSelect>
            <CompactSelect label="Job Type" value={jobType} onChange={setJobType} className="flex-1">
              {JOB_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </CompactSelect>
          </div>

          {/* Row 4: Salary Type | Salary Low | Salary High | Currency | Openings */}
          <div className="flex gap-4">
            <CompactSelect
              label="Salary Type"
              value={salaryFrequency}
              onChange={(v) => setSalaryFrequency(v === "hourly" ? "hourly" : "yearly")}
              className="flex-1"
            >
              <option value="yearly">Salary</option>
              <option value="hourly">Hourly</option>
            </CompactSelect>
            <SalaryField
              label={salaryFrequency === "hourly" ? "Hourly low" : "Salary low"}
              value={salaryLow}
              onChange={setSalaryLow}
              onFocus={() => setSalaryFocused(true)}
              onBlur={() => {
                setSalaryFocused(false);
                onSalaryLowBlur();
              }}
              invalid={showRangeInvalid}
              step={salaryFrequency === "hourly" ? "0.01" : "1"}
              className="flex-1"
            />
            <SalaryField
              label={salaryFrequency === "hourly" ? "Hourly high" : "Salary high"}
              value={salaryHigh}
              onChange={setSalaryHigh}
              onFocus={() => setSalaryFocused(true)}
              onBlur={() => {
                setSalaryFocused(false);
                onSalaryHighBlur();
              }}
              invalid={showRangeInvalid}
              step={salaryFrequency === "hourly" ? "0.01" : "1"}
              className="flex-1"
            />
            <CompactField label="Currency" value={currency} onChange={setCurrency} className="flex-1" />
            <CompactNumber label="Openings" value={openings} onChange={setOpenings} min={1} className="flex-1" />
          </div>

          {/* Description, full width */}
          <div className="space-y-2">
            <LabeledTextarea
              label="Description"
              value={description}
              onChange={setDescription}
              rows={10}
              frameClassName={INPUT_FRAME_RECT_CLASS}
              controlClassName="min-h-[180px]"
              placeholder=""
            />
            {description.trim() && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={onParseAndEditJd}
                  disabled={isGenerating || isCombinedRunning}
                  className="inline-flex items-center gap-1.5 rounded-md border border-court-border bg-court-surface px-3 py-1.5 text-xs font-semibold text-court-fg shadow-sm transition hover:border-brand/40 hover:text-brand-dark disabled:opacity-60"
                >
                  {isGenerating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  Parse & Edit JD
                </button>
              </div>
            )}
            {description.trim() && (
              <div className="rounded-lg border border-court-border/40 bg-court-surface-subtle/40 p-4">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-court-fg-muted">
                  Preview
                </div>
                <div
                  className={cn(
                    "text-sm leading-relaxed text-court-fg",
                    "[&_p]:mb-3 [&_p]:text-sm [&_p]:leading-relaxed",
                    "[&_strong]:font-bold [&_strong]:text-court-fg",
                    "[&_em]:italic",
                    "[&_h1]:mb-3 [&_h1]:mt-6 [&_h1]:font-serif [&_h1]:text-2xl [&_h1]:font-extrabold [&_h1]:tracking-tight [&_h1]:text-court-fg first:[&_h1]:mt-0",
                    "[&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:font-serif [&_h2]:text-xl [&_h2]:font-extrabold [&_h2]:tracking-tight [&_h2]:text-court-fg first:[&_h2]:mt-0",
                    "[&_h3]:mb-1.5 [&_h3]:mt-4 [&_h3]:font-serif [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-court-fg",
                    "[&_ul]:mb-3 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5",
                    "[&_ul>li]:text-sm [&_ul>li]:leading-relaxed [&_ul>li]:text-court-fg",
                    "[&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5",
                    "[&_ol>li]:text-sm [&_ol>li]:leading-relaxed [&_ol>li]:text-court-fg",
                  )}
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{description}</ReactMarkdown>
                </div>
              </div>
            )}
          </div>

          {showRangeInvalid && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              Salary low is greater than salary high. We&apos;ll swap them automatically when you tab out.
            </div>
          )}
          {err && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{err}</div>}
        </div>
      </div>
    </div>
  );
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// The "Compact*" helpers below render a stacked field (label over a
// rectangular input frame). Each takes a `className` so the caller can size
// it in the parent flex row (flex-1, w-32, etc). Selects share the same
// INPUT_FRAME_RECT_CLASS frame + INPUT_CONTROL_CLASS control as the text
// inputs so the dropdowns match the text fields in height and width.
const FIELD_LABEL_CLASS = "text-xs uppercase tracking-wide text-court-fg-muted mb-1";

function CompactField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  className,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  className?: string;
  // Optional inline error message rendered below the field. Used by
  // the City + Zip controls to surface pre-save US location
  // validation failures.
  error?: string | null;
}) {
  return (
    <label className={cn("flex flex-col", className)}>
      <span className={FIELD_LABEL_CLASS}>{label}</span>
      <div
        className={cn(
          INPUT_FRAME_RECT_CLASS,
          "w-full",
          error && "border-red-300 bg-red-50",
        )}
      >
        <input
          type={type}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`${INPUT_CONTROL_CLASS} text-sm`}
        />
      </div>
      {error && (
        <span className="mt-1 text-[11px] font-medium text-red-700">{error}</span>
      )}
    </label>
  );
}

function CompactSelect({
  label,
  value,
  onChange,
  children,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col", className)}>
      <span className={FIELD_LABEL_CLASS}>{label}</span>
      <div className={`${INPUT_FRAME_RECT_CLASS} w-full`}>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${INPUT_CONTROL_CLASS} text-sm`}
        >
          {children}
        </select>
      </div>
    </label>
  );
}

function CompactNumber({
  label,
  value,
  onChange,
  min,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  min?: number;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col", className)}>
      <span className={FIELD_LABEL_CLASS}>{label}</span>
      <div className={`${INPUT_FRAME_RECT_CLASS} w-full`}>
        <input
          type="number"
          min={min}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${INPUT_CONTROL_CLASS} text-sm`}
        />
      </div>
    </label>
  );
}

function SalaryField({
  label,
  value,
  onChange,
  onFocus,
  onBlur,
  invalid,
  placeholder,
  step,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onFocus?: () => void;
  onBlur: () => void;
  invalid: boolean;
  placeholder?: string;
  step?: string;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col", className)}>
      <span className={FIELD_LABEL_CLASS}>{label}</span>
      <div className={cn(INPUT_FRAME_RECT_CLASS, "w-full", invalid && "border-amber-300 bg-amber-50")}>
        <input
          type="number"
          min={0}
          step={step}
          placeholder={placeholder}
          value={value}
          onChange={(e) => {
            const n = e.target.value;
            if (n === "" || Number(n) >= 0) onChange(n);
          }}
          onFocus={onFocus}
          onBlur={onBlur}
          className={`${INPUT_CONTROL_CLASS} text-sm`}
        />
      </div>
    </label>
  );
}
