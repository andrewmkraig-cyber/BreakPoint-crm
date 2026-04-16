"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, Sparkles, X } from "lucide-react";
import { DocumentDropzone } from "@/components/document-dropzone";
import { cn } from "@/lib/utils";
import {
  createCandidate,
  parseCandidate,
  type CreateCandidatePayload,
} from "@/app/candidates/new/actions";

type FormState = CreateCandidatePayload & { skillsText: string };

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
};

export function NewCandidateForm() {
  const router = useRouter();
  const [resume, setResume] = useState<File | null>(null);
  const [pastedText, setPastedText] = useState<string>("");
  const [linkedinUrl, setLinkedinUrl] = useState<string>("");
  const [form, setForm] = useState<FormState>(EMPTY);
  const [prefilled, setPrefilled] = useState<boolean>(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isParsing, startParse] = useTransition();
  const [isSaving, startSave] = useTransition();

  function onFiles(files: File[]) {
    setResume(files[0] ?? null);
    setParseError(null);
  }

  function onParse() {
    setParseError(null);
    if (!resume && !pastedText.trim() && !linkedinUrl.trim()) {
      setParseError("Upload a resume, paste profile text, or enter a LinkedIn URL first.");
      return;
    }
    const data = new FormData();
    if (resume) data.append("resume", resume);
    if (pastedText.trim()) data.append("pastedText", pastedText.trim());
    if (linkedinUrl.trim()) data.append("linkedinUrl", linkedinUrl.trim());

    startParse(async () => {
      const result = await parseCandidate(data);
      if (!result.ok) {
        setParseError(result.error);
        return;
      }
      const p = result.value.parsed;
      setForm({
        first_name: p.first_name ?? "",
        last_name: p.last_name ?? "",
        email: p.email ?? "",
        phone: p.phone ?? "",
        current_designation: p.current_designation ?? "",
        current_organization: p.current_organization ?? "",
        location: p.location ?? "",
        linkedin_profile: p.linkedin_profile ?? linkedinUrl.trim() ?? "",
        skills: p.skills,
        skillsText: p.skills.join(", "),
        notes: p.notes ?? "",
      });
      setPrefilled(true);
    });
  }

  function onSave() {
    setSaveError(null);
    const payload: CreateCandidatePayload = {
      ...form,
      skills: form.skillsText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    };
    if (!payload.first_name.trim()) {
      setSaveError("First name is required.");
      return;
    }
    startSave(async () => {
      const result = await createCandidate(payload);
      if (!result.ok) {
        setSaveError(result.error);
        return;
      }
      router.push(`/candidates/${result.value.id}`);
    });
  }

  function onReset() {
    setResume(null);
    setPastedText("");
    setLinkedinUrl("");
    setForm(EMPTY);
    setPrefilled(false);
    setParseError(null);
    setSaveError(null);
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
      {/* Left: inputs */}
      <div className="space-y-6 lg:col-span-2">
        <div className="rounded-xl border border-border bg-white shadow-sm">
          <div className="border-b border-border px-5 py-3">
            <h2 className="font-serif text-base font-semibold text-navy">Resume</h2>
            <p className="text-xs text-muted-foreground">PDF works best — Claude reads the document natively.</p>
          </div>
          <div className="p-5">
            <DocumentDropzone
              multiple={false}
              accept="application/pdf,.pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,.txt"
              onFiles={onFiles}
              emptyHint="PDF, DOC/DOCX, or TXT up to 15MB"
            />
            {resume && (
              <div className="mt-3 flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
                <span className="truncate text-navy">{resume.name}</span>
                <button type="button" onClick={() => setResume(null)} className="text-muted-foreground hover:text-navy">
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
              Paste the URL — it&apos;ll be saved on the candidate. For full enrichment, also copy-paste the profile text below (LinkedIn blocks automated fetching).
            </p>
          </div>
          <div className="space-y-3 p-5">
            <Field label="Profile URL" type="url" value={linkedinUrl} onChange={setLinkedinUrl} placeholder="https://linkedin.com/in/…" />
            <div>
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Pasted profile text (optional)</label>
              <textarea
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                rows={8}
                placeholder="Paste the LinkedIn About / Experience section here for best parsing…"
                className={cn(
                  "mt-1 w-full resize-vertical rounded-lg border border-border bg-white px-3 py-2 font-sans text-sm leading-relaxed text-navy",
                  "focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20",
                )}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onParse}
            disabled={isParsing}
            className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-navy-600 disabled:opacity-60"
          >
            {isParsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {prefilled ? "Re-parse with Claude" : "Parse with Claude"}
          </button>
          {prefilled && (
            <button
              type="button"
              onClick={onReset}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-medium text-navy-400 shadow-sm transition hover:text-navy"
            >
              Clear
            </button>
          )}
        </div>
        {parseError && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{parseError}</div>}
      </div>

      {/* Right: editable fields */}
      <div className="lg:col-span-3">
        <div className="rounded-xl border border-border bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <div>
              <h2 className="font-serif text-base font-semibold text-navy">Candidate fields</h2>
              <p className="text-xs text-muted-foreground">
                {prefilled ? "Pre-filled by Claude — review and edit before saving." : "Fill these in or parse a resume above."}
              </p>
            </div>
            <button
              type="button"
              onClick={onSave}
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
            >
              {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save to RecruiterFlow
            </button>
          </div>
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
