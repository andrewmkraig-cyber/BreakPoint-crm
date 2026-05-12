"use client";

import { useRef, useState, useTransition, type ChangeEvent, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, FileText, Loader2, Save, Sparkles, UploadCloud, X } from "lucide-react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { LabeledTextarea } from "@/app/candidates/[id]/editable-helpers";
import { createJob, extractFieldsFromGeneratedJd, generateJobDescriptionFromSource } from "@/app/jobs/new/actions";
import { CLAUDE_PILL_CLASS } from "@/components/ui/button";
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
export function NewJobForm({ clients }: { clients: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [clientId, setClientId] = useState<string>("");
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
  const [currency, setCurrency] = useState("USD");
  const [openings, setOpenings] = useState("1");
  const [description, setDescription] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startSave] = useTransition();

  const jdInputRef = useRef<HTMLInputElement>(null);
  const [jdFile, setJdFile] = useState<File | null>(null);
  const [isGenerating, startGenerate] = useTransition();

  const [sourceUrl, setSourceUrl] = useState("");
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
      toast.error("Claude API is busy — try again in a moment. Your file is still staged.");
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

  function onSubmit() {
    setErr(null);

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
    <div className="space-y-3">
      {/* 1. Source Material card — merges Source Job Link URL input and
            Upload JD drop zone into one container, separated by an "or"
            divider. Parse & Generate JD with Claude lives with the URL row. */}
      <div className="rounded-xl border border-court-border bg-court-surface p-4 shadow-sm">
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
          Source Material
        </label>
        <p className="mt-0.5 text-[11px] text-court-fg-muted">
          Paste a URL, upload a file, or both — then click Parse & Generate JD with Claude.
        </p>

        <div className="mt-2">
          <input
            type="url"
            value={sourceUrl}
            onChange={(e) => {
              setSourceUrl(e.target.value);
              if (parseInlineError) setParseInlineError(null);
              if (linkSaved) setLinkSaved(false);
            }}
            placeholder="https://…"
            className={cn(
              "w-full rounded-md border border-court-border bg-court-bg px-3 py-1.5 text-xs text-court-fg shadow-sm",
              "focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20",
            )}
          />
        </div>
        {parseInlineError && (
          <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
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
                  Save Link
                </button>
              )}
            </div>
          </div>
        )}

        {/* "or" divider between URL row and Upload JD drop zone */}
        <div className="my-2.5 flex items-center gap-3" aria-hidden="true">
          <div className="h-px flex-1 bg-court-border" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">or</span>
          <div className="h-px flex-1 bg-court-border" />
        </div>

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
            "mt-3 w-full justify-center py-1.5",
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

      {/* 3. Structured fields card. 4. Description textarea (with Parse &
            Edit JD button beneath when it has content) and Preview at the
            bottom of the same card. The compensation row (Salary Type /
            Low / High / Currency / Openings) sits in a single 5-col sub-
            grid on md+ so the form doesn't burn rows on small fields. */}
      <div className="rounded-xl border border-court-border bg-court-surface p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <CompactField label="Job title" value={title} onChange={setTitle} />
          <CompactSelect
            label="Client"
            value={clientId}
            onChange={setClientId}
          >
            <option value="">Select a client…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </CompactSelect>
          {/* Location is split into three searchable inputs on a single
              row. City takes the most horizontal space; State and Zip
              are narrower because their content is short. The composed
              "City, ST Zip" string is reassembled server-side. */}
          <div className="md:col-span-2 grid grid-cols-1 gap-2 sm:grid-cols-6">
            <div className="sm:col-span-3">
              <CompactField label="City" value={locationCity} onChange={setLocationCity} />
            </div>
            <div className="sm:col-span-2">
              <CompactField label="State" value={locationState} onChange={setLocationState} />
            </div>
            <div className="sm:col-span-1">
              <CompactField label="Zip" value={locationZip} onChange={setLocationZip} />
            </div>
          </div>
          <CompactSelect label="Employment type" value={employmentType} onChange={setEmploymentType}>
            {EMPLOYMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </CompactSelect>
          <CompactSelect label="Job type" value={jobType} onChange={setJobType}>
            {JOB_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </CompactSelect>
          <div className="md:col-span-2 grid grid-cols-2 gap-2 md:grid-cols-5">
            <CompactSelect
              label="Salary type"
              value={salaryFrequency}
              onChange={(v) => setSalaryFrequency(v === "hourly" ? "hourly" : "yearly")}
            >
              <option value="yearly">Salary</option>
              <option value="hourly">Hourly</option>
            </CompactSelect>
            <SalaryField
              label={salaryFrequency === "hourly" ? "Hourly low" : "Salary low"}
              value={salaryLow}
              onChange={setSalaryLow}
              onBlur={onSalaryLowBlur}
              invalid={rangeInvalid}
              step={salaryFrequency === "hourly" ? "0.01" : "1"}
            />
            <SalaryField
              label={salaryFrequency === "hourly" ? "Hourly high" : "Salary high"}
              value={salaryHigh}
              onChange={setSalaryHigh}
              onBlur={onSalaryHighBlur}
              invalid={rangeInvalid}
              step={salaryFrequency === "hourly" ? "0.01" : "1"}
            />
            <CompactField label="Currency" value={currency} onChange={setCurrency} />
            <CompactNumber label="Openings" value={openings} onChange={setOpenings} min={1} />
          </div>
          <div className="md:col-span-2 space-y-2">
            <LabeledTextarea
              label="Description"
              value={description}
              onChange={setDescription}
              rows={10}
              placeholder="Blank canvas. Paste or write the job description — or drop a JD file above and let Claude reformat it into the BreakPoint format (A Bit About Us / Why Join Us / Job Details)."
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
              <div className="rounded-lg border border-court-border bg-court-surface-subtle/40 p-4">
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
        </div>

        {rangeInvalid && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            Salary low is greater than salary high. We&apos;ll swap them automatically when you tab out.
          </div>
        )}
        {err && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{err}</div>}

        <div className="mt-4 flex items-center justify-end gap-2 border-t border-court-border pt-3">
          <button
            type="button"
            onClick={() => router.push("/jobs")}
            disabled={isPending || isCombinedRunning}
            className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-3 py-1.5 text-xs font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={isPending || isCombinedRunning || rangeInvalid}
            className="inline-flex items-center gap-1 rounded-md bg-brand px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
          >
            {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            Create job
          </button>
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

// The "Compact*" helpers below mirror LabeledField/LabeledSelect but with
// tighter padding (py-1.5 / mt-0.5) so the structured-fields card stays
// dense on /jobs/new without affecting other pages that depend on the
// roomier shared LabeledField helpers.
const COMPACT_LABEL_CLASS = "text-[10px] uppercase tracking-wider text-court-fg-muted";
const COMPACT_INPUT_CLASS =
  "mt-0.5 w-full rounded-md border border-court-border bg-court-surface px-2.5 py-1 text-xs text-court-fg placeholder:text-court-fg-muted/60 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

function CompactField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block text-sm">
      <span className={COMPACT_LABEL_CLASS}>{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={COMPACT_INPUT_CLASS}
      />
    </label>
  );
}

function CompactSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className={COMPACT_LABEL_CLASS}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={COMPACT_INPUT_CLASS}>
        {children}
      </select>
    </label>
  );
}

function CompactNumber({
  label,
  value,
  onChange,
  min,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  min?: number;
}) {
  return (
    <label className="block text-sm">
      <span className={COMPACT_LABEL_CLASS}>{label}</span>
      <input
        type="number"
        min={min}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={COMPACT_INPUT_CLASS}
      />
    </label>
  );
}

function SalaryField({
  label,
  value,
  onChange,
  onBlur,
  invalid,
  placeholder,
  step,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  invalid: boolean;
  placeholder?: string;
  step?: string;
}) {
  return (
    <label className="block text-sm">
      <span className={COMPACT_LABEL_CLASS}>{label}</span>
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
        onBlur={onBlur}
        className={cn(
          "mt-0.5 w-full rounded-md border px-2.5 py-1 text-xs text-court-fg focus:outline-none focus:ring-2",
          invalid
            ? "border-amber-300 bg-amber-50 focus:border-amber-400 focus:ring-amber-200"
            : "border-court-border bg-court-surface focus:border-brand focus:ring-brand/20",
        )}
      />
    </label>
  );
}
