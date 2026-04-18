"use client";

import { useRef, useState, useTransition, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Save, Sparkles, UploadCloud, X } from "lucide-react";
import { toast } from "sonner";
import { LabeledField, LabeledTextarea } from "@/app/candidates/[id]/editable-helpers";
import { createJob, generateJobDescriptionFromSource } from "@/app/jobs/new/actions";
import { PlainProse } from "@/components/plain-prose";
import { cn } from "@/lib/utils";

const JOB_TYPES = ["Permanent", "Contract", "Contract to Hire", "Temporary", "Internship"] as const;
const EMPLOYMENT_TYPES = ["Full time", "Part time", "Contract"] as const;

export function NewJobForm({ clients }: { clients: Array<{ id: number; name: string }> }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [clientId, setClientId] = useState<string>("");
  const [location, setLocation] = useState("");
  const [jobType, setJobType] = useState<string>(JOB_TYPES[0]);
  const [employmentType, setEmploymentType] = useState<string>(EMPLOYMENT_TYPES[0]);
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

  function onPickJd(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setJdFile(f);
  }

  function clearJd() {
    setJdFile(null);
    if (jdInputRef.current) jdInputRef.current.value = "";
  }

  function onGenerate() {
    setErr(null);
    startGenerate(async () => {
      let filePayload: { filename: string; mimeType: string; base64: string } | null = null;
      if (jdFile) {
        const buffer = await jdFile.arrayBuffer();
        const base64 = arrayBufferToBase64(buffer);
        filePayload = { filename: jdFile.name, mimeType: jdFile.type || "application/octet-stream", base64 };
      }
      const result = await generateJobDescriptionFromSource({
        jobTitle: title.trim(),
        sourceText: description,
        file: filePayload,
      });
      if (!result.ok) {
        setErr(result.error);
        toast.error("Couldn't generate job description", { description: result.error });
        return;
      }
      setDescription(result.value.text);
      if (result.value.fallback) {
        toast.info("Claude unavailable — template loaded", {
          description: result.value.reason ?? "Write the JD manually using the template below.",
        });
      } else {
        toast.success("Job description generated", { description: "Edit before saving if needed." });
      }
    });
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
        clientCompanyId: clientId ? Number(clientId) : null,
        locations: location.trim() ? [location.trim()] : [],
        jobType,
        employmentType,
        salaryRangeStart: loNum,
        salaryRangeEnd: hiNum,
        salaryCurrency: currency.trim().toUpperCase().slice(0, 3) || "USD",
        openings: openings ? Number(openings) : null,
        description,
      });
      if (!result.ok) {
        setErr(result.error);
        toast.error("Couldn't create job", { description: result.error });
        return;
      }
      toast.success("Job created");
      if (result.value.id) {
        router.push(`/jobs/${result.value.id}`);
      } else {
        router.push("/jobs");
      }
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-border bg-white p-6 shadow-sm">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <LabeledField label="Job title" value={title} onChange={setTitle} placeholder="e.g. Senior Full Stack Engineer" />
        </div>
        <label className="block text-sm">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Client</span>
          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-navy focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          >
            <option value="">Select a client…</option>
            {clients.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <LabeledField label="Location" value={location} onChange={setLocation} placeholder="Remote, New York, NY" />
        <label className="block text-sm">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Job type</span>
          <select
            value={jobType}
            onChange={(e) => setJobType(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-navy focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          >
            {JOB_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Employment type</span>
          <select
            value={employmentType}
            onChange={(e) => setEmploymentType(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-navy focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          >
            {EMPLOYMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <SalaryField
          label="Salary low"
          value={salaryLow}
          onChange={setSalaryLow}
          onBlur={onSalaryLowBlur}
          invalid={rangeInvalid}
        />
        <SalaryField
          label="Salary high"
          value={salaryHigh}
          onChange={setSalaryHigh}
          onBlur={onSalaryHighBlur}
          invalid={rangeInvalid}
        />
        <LabeledField label="Currency" value={currency} onChange={setCurrency} placeholder="USD" />
        <label className="block text-sm">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Openings</span>
          <input
            type="number"
            min={1}
            value={openings}
            onChange={(e) => setOpenings(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-navy focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          />
        </label>
        <div className="md:col-span-2 space-y-2">
          <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-2 text-sm">
              {jdFile ? (
                <>
                  <FileText className="h-4 w-4 shrink-0 text-brand-dark" />
                  <span className="truncate font-medium text-navy">{jdFile.name}</span>
                  <span className="text-xs text-muted-foreground">{formatSize(jdFile.size)}</span>
                  <button
                    type="button"
                    onClick={clearJd}
                    className="ml-1 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-navy"
                    aria-label="Remove uploaded JD"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </>
              ) : (
                <>
                  <UploadCloud className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="text-muted-foreground">Upload a JD file (PDF/DOCX) to reformat with Claude, or skip and write below.</span>
                </>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => jdInputRef.current?.click()}
                disabled={isGenerating}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-white px-3 py-1.5 text-xs font-semibold text-navy shadow-sm transition hover:border-brand/40 hover:text-brand-dark disabled:opacity-60"
              >
                <UploadCloud className="h-3.5 w-3.5" />
                {jdFile ? "Replace file" : "Upload JD"}
              </button>
              <button
                type="button"
                onClick={onGenerate}
                disabled={isGenerating || (!jdFile && !description.trim())}
                className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
              >
                {isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Generate Job Description with Claude
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
          <LabeledTextarea
            label="Description"
            value={description}
            onChange={setDescription}
            rows={10}
            placeholder="Blank canvas. Paste or write the job description — or upload a JD above and let Claude reformat it into the BreakPoint format (A Bit About Us / Why Join Us / Job Details)."
          />
          {description.trim() && (
            <div className="rounded-lg border border-border bg-muted/30 p-4">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Preview
              </div>
              <PlainProse text={description} />
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

      <div className="mt-5 flex items-center justify-end gap-2 border-t border-border pt-4">
        <button
          type="button"
          onClick={() => router.push("/jobs")}
          disabled={isPending}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-3 py-2 text-xs font-medium text-navy-400 shadow-sm transition hover:text-navy disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={isPending || rangeInvalid}
          className="inline-flex items-center gap-1 rounded-md bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
        >
          {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          Create job
        </button>
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

function SalaryField({
  label,
  value,
  onChange,
  onBlur,
  invalid,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  invalid: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => {
          const n = e.target.value;
          if (n === "" || Number(n) >= 0) onChange(n);
        }}
        onBlur={onBlur}
        className={cn(
          "mt-1 w-full rounded-lg border px-3 py-2 text-sm text-navy focus:outline-none focus:ring-2",
          invalid
            ? "border-amber-300 bg-amber-50 focus:border-amber-400 focus:ring-amber-200"
            : "border-border bg-white focus:border-brand focus:ring-brand/20",
        )}
      />
    </label>
  );
}
