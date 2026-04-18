"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Globe, Loader2, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  createClient,
  parseClientWebsite,
  type CreateClientPayload,
} from "@/app/clients/new/actions";

const INDUSTRIES = [
  "Software / Technology",
  "Financial Services",
  "Healthcare",
  "Manufacturing",
  "Professional Services",
  "Retail / E-commerce",
  "Real Estate",
  "Energy",
  "Legal",
  "Media / Marketing",
  "Non-profit",
  "Education",
  "Telecommunications",
  "Transportation / Logistics",
  "Hospitality",
  "Other",
] as const;

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC",
] as const;

type FormState = CreateClientPayload;

const EMPTY: FormState = {
  name: "",
  website: "",
  industry: "",
  phone: "",
  city: "",
  state: "",
  linkedin: "",
  overview: "",
  primaryContact: { firstName: "", lastName: "", title: "", email: "", phone: "" },
};

export function NewClientForm() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [isParsing, startParse] = useTransition();
  const [isSaving, startSave] = useTransition();
  const [parseSource, setParseSource] = useState<"claude" | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const parseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastParsedUrl = useRef<string | null>(null);

  function onWebsiteChange(v: string) {
    setWebsiteUrl(v);
    // Mirror the raw URL into the form's `website` field so manual users don't
    // have to re-type it.
    setForm((prev) => ({ ...prev, website: v }));
  }

  // Debounced AUTO parse: fires 600ms after the user stops typing, and only
  // when the URL looks like a real domain. No button — per the AUTO rule for
  // structured extraction.
  function scheduleAutoParse(v: string) {
    if (parseTimer.current) clearTimeout(parseTimer.current);
    const normalized = v.trim();
    if (!normalized) return;
    if (!/[.][a-z]{2,}/i.test(normalized)) return; // looks URL-ish
    if (lastParsedUrl.current === normalized) return; // don't re-parse same URL
    parseTimer.current = setTimeout(() => {
      lastParsedUrl.current = normalized;
      runParse(normalized);
    }, 600);
  }

  function runParse(url: string) {
    const toastId = toast.loading("Reading website…");
    startParse(async () => {
      try {
        const result = await parseClientWebsite(url);
        if (!result.ok) {
          toast.error("Auto-fill failed", { id: toastId, description: result.error });
          return;
        }
        const f = result.value.fields;
        setForm((prev) => ({
          ...prev,
          name: f.name ?? prev.name,
          industry: f.industry ? matchIndustry(f.industry) ?? prev.industry : prev.industry,
          city: f.city ?? prev.city,
          state: f.state ? matchState(f.state) ?? prev.state : prev.state,
          phone: f.phone ?? prev.phone,
          linkedin: f.linkedin ?? prev.linkedin,
          overview: f.overview ?? prev.overview,
        }));
        setParseSource("claude");
        toast.success("Auto-fill complete", {
          id: toastId,
          description: "Review and edit any field before saving.",
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to parse website.";
        toast.error("Auto-fill failed", { id: toastId, description: msg });
      }
    });
  }

  function onSave() {
    setSaveError(null);
    if (!form.name.trim()) {
      setSaveError("Company Name is required.");
      return;
    }
    startSave(async () => {
      const result = await createClient(form);
      if (!result.ok) {
        setSaveError(result.error);
        toast.error("Couldn't save client", { description: result.error });
        return;
      }
      toast.success(`Saved ${form.name.trim()}`);
      router.push(`/clients/${result.value.id}`);
    });
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
      {/* Left: website + auto-fill */}
      <div className="space-y-6 lg:col-span-2">
        <div className="rounded-xl border border-border bg-white shadow-sm">
          <div className="border-b border-border px-5 py-3">
            <h2 className="font-serif text-base font-semibold text-navy">Website</h2>
            <p className="text-xs text-muted-foreground">
              Paste a company URL — we&apos;ll read the homepage and pre-fill the fields on the right.
            </p>
          </div>
          <div className="space-y-3 p-5">
            <label className="block text-sm">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Company URL</span>
              <div className="relative mt-1">
                <Globe className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="url"
                  value={websiteUrl}
                  onChange={(e) => {
                    onWebsiteChange(e.target.value);
                    scheduleAutoParse(e.target.value);
                  }}
                  placeholder="acme.com or https://acme.com"
                  className="w-full rounded-lg border border-border bg-white py-2 pl-8 pr-3 text-sm text-navy placeholder:text-muted-foreground/60 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                />
              </div>
            </label>
            <div className="flex items-center gap-2 text-[11px]">
              {isParsing ? (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Reading website…
                </span>
              ) : parseSource === "claude" ? (
                <span className="inline-flex items-center gap-1 text-brand-dark">
                  <Sparkles className="h-3 w-3" /> Auto-filled — edit anything on the right.
                </span>
              ) : (
                <span className="text-muted-foreground">Auto-fill runs a moment after you stop typing.</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Right: editable fields */}
      <div className="lg:col-span-3">
        <div className="rounded-xl border border-border bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <div>
              <h2 className="font-serif text-base font-semibold text-navy">Client fields</h2>
              <p className="text-xs text-muted-foreground">
                {parseSource === "claude"
                  ? "Pre-filled — review and edit before saving."
                  : "Drop a URL on the left or fill in manually."}
              </p>
            </div>
            <button
              type="button"
              onClick={onSave}
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
            >
              {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save to Ace
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
            <Field label="Company name" required value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
            <Field
              label="Website"
              type="url"
              value={form.website}
              onChange={(v) => setForm({ ...form, website: v })}
              placeholder="https://acme.com"
            />
            <label className="block text-sm">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Industry</span>
              <select
                value={form.industry}
                onChange={(e) => setForm({ ...form, industry: e.target.value })}
                className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-navy focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
              >
                <option value="">Select…</option>
                {INDUSTRIES.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </select>
            </label>
            <Field label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
            <Field label="City" value={form.city} onChange={(v) => setForm({ ...form, city: v })} />
            <label className="block text-sm">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">State</span>
              <select
                value={form.state}
                onChange={(e) => setForm({ ...form, state: e.target.value })}
                className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-navy focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
              >
                <option value="">Select…</option>
                {US_STATES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <div className="sm:col-span-2">
              <Field
                label="LinkedIn"
                type="url"
                value={form.linkedin}
                onChange={(v) => setForm({ ...form, linkedin: v })}
                placeholder="https://linkedin.com/company/acme"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Overview</span>
                <textarea
                  value={form.overview}
                  onChange={(e) => setForm({ ...form, overview: e.target.value })}
                  rows={3}
                  placeholder="Short description of what the company does."
                  className={cn(
                    "mt-1 w-full resize-vertical rounded-lg border border-border bg-white px-3 py-2 text-sm leading-relaxed text-navy",
                    "focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20",
                  )}
                />
              </label>
            </div>
          </div>

          <div className="border-t border-border px-5 py-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Primary Contact (optional)
            </h3>
          </div>
          <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
            <Field
              label="First name"
              value={form.primaryContact.firstName}
              onChange={(v) => setForm({ ...form, primaryContact: { ...form.primaryContact, firstName: v } })}
            />
            <Field
              label="Last name"
              value={form.primaryContact.lastName}
              onChange={(v) => setForm({ ...form, primaryContact: { ...form.primaryContact, lastName: v } })}
            />
            <Field
              label="Title"
              value={form.primaryContact.title}
              onChange={(v) => setForm({ ...form, primaryContact: { ...form.primaryContact, title: v } })}
              placeholder="Director of Talent"
            />
            <Field
              label="Email"
              type="email"
              value={form.primaryContact.email}
              onChange={(v) => setForm({ ...form, primaryContact: { ...form.primaryContact, email: v } })}
            />
            <Field
              label="Phone"
              value={form.primaryContact.phone}
              onChange={(v) => setForm({ ...form, primaryContact: { ...form.primaryContact, phone: v } })}
            />
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

// Map Claude's free-text industry into one of our dropdown options. Accepts
// loose matches like "SaaS" → "Software / Technology".
function matchIndustry(raw: string): string | null {
  const lower = raw.toLowerCase();
  for (const opt of INDUSTRIES) {
    if (opt.toLowerCase().includes(lower) || lower.includes(opt.toLowerCase())) return opt;
  }
  if (/\b(software|saas|tech|ai|platform)\b/.test(lower)) return "Software / Technology";
  if (/\b(bank|finance|fintech|capital|invest|accounting)\b/.test(lower)) return "Financial Services";
  if (/\b(health|medic|pharma|biotech|hospital)\b/.test(lower)) return "Healthcare";
  if (/\b(manufactur|industrial|factory)\b/.test(lower)) return "Manufacturing";
  if (/\b(consult|professional service|legal|law|accounting)\b/.test(lower)) return "Professional Services";
  if (/\b(retail|e-?commerce|shop)\b/.test(lower)) return "Retail / E-commerce";
  if (/\b(real estate|property|realty)\b/.test(lower)) return "Real Estate";
  if (/\b(energy|oil|gas|utility|solar)\b/.test(lower)) return "Energy";
  if (/\b(media|market|advertis|agency|pr)\b/.test(lower)) return "Media / Marketing";
  if (/\b(educat|school|university)\b/.test(lower)) return "Education";
  if (/\b(telecom|wireless|isp)\b/.test(lower)) return "Telecommunications";
  if (/\b(transport|logistic|freight|shipping)\b/.test(lower)) return "Transportation / Logistics";
  if (/\b(hotel|hospitality|restaur)\b/.test(lower)) return "Hospitality";
  return null;
}

function matchState(raw: string): string | null {
  const u = raw.trim().toUpperCase();
  if ((US_STATES as readonly string[]).includes(u)) return u;
  return null;
}
