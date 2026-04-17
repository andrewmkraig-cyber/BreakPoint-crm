"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { LabeledField, LabeledTextarea } from "@/app/candidates/[id]/editable-helpers";
import { createJob } from "@/app/jobs/new/actions";
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
      toast.success("Job created", { description: "Pushed to RecruiterFlow." });
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
        <div className="md:col-span-2">
          <LabeledTextarea label="Description" value={description} onChange={setDescription} rows={6} placeholder="Paste or write the job description. Leave blank to fill it in later." />
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
