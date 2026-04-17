"use client";

import { useRef, useState, useTransition, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Briefcase,
  CheckCircle2,
  DollarSign,
  Handshake,
  Loader2,
  Save,
  Sparkles,
  UploadCloud,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { LabeledField, LabeledTextarea } from "@/app/candidates/[id]/editable-helpers";
import {
  confirmStart,
  recordOffer,
  recordPlacement,
} from "@/app/candidates/[id]/placement-actions";

export type PlacementContextJob = {
  jobRfId: number;
  jobTitle: string;
  clientRfId: number;
  clientName: string;
  clientFeePct: number | null;
  rfStageBucket:
    | "submitted"
    | "interviewing"
    | "offer"
    | "pending_start"
    | "hired"
    | "sourced"
    | "rejected"
    | "other";
  placement: PlacementSnapshot | null;
};

export type PlacementSnapshot = {
  id: string;
  stage: "offer" | "pending_start" | "hired";
  offerSalary: number | null;
  offerCurrency: string | null;
  offerTitle: string | null;
  offerStartDate: string | null;
  offerNotes: string | null;
  acceptedSalary: number | null;
  acceptedCurrency: string | null;
  feePercentage: number | null;
  feeTotal: number | null;
  minFee: number | null;
  guaranteePeriodDays: number | null;
  billingContactName: string | null;
  billingContactEmail: string | null;
  hiringManagerName: string | null;
  hiringManagerEmail: string | null;
  expectedStartDate: string | null;
  placementNotes: string | null;
  startConfirmedAt: string | null;
};

export function PlacementActions({
  candidateRfId,
  jobs,
}: {
  candidateRfId: number;
  jobs: PlacementContextJob[];
}) {
  const [offerFor, setOfferFor] = useState<PlacementContextJob | null>(null);
  const [placementFor, setPlacementFor] = useState<PlacementContextJob | null>(null);
  const [confirmFor, setConfirmFor] = useState<PlacementContextJob | null>(null);

  if (jobs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/30 px-5 py-4 text-xs text-muted-foreground">
        No jobs linked to this candidate yet — add them in RecruiterFlow to unlock offer / placement actions.
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2">
        {jobs.map((j) => (
          <JobActionRow
            key={j.jobRfId}
            job={j}
            onOffer={() => setOfferFor(j)}
            onPlacement={() => setPlacementFor(j)}
            onConfirm={() => setConfirmFor(j)}
          />
        ))}
      </div>

      {offerFor && (
        <OfferDialog
          candidateRfId={candidateRfId}
          job={offerFor}
          onClose={() => setOfferFor(null)}
        />
      )}
      {placementFor && (
        <PlacementDialog
          candidateRfId={candidateRfId}
          job={placementFor}
          onClose={() => setPlacementFor(null)}
        />
      )}
      {confirmFor && confirmFor.placement && (
        <ConfirmStartDialog
          placementId={confirmFor.placement.id}
          jobTitle={confirmFor.jobTitle}
          onClose={() => setConfirmFor(null)}
        />
      )}
    </>
  );
}

function JobActionRow({
  job,
  onOffer,
  onPlacement,
  onConfirm,
}: {
  job: PlacementContextJob;
  onOffer: () => void;
  onPlacement: () => void;
  onConfirm: () => void;
}) {
  const effective = job.placement?.stage ?? job.rfStageBucket;
  const isInterviewing = effective === "interviewing" || effective === "submitted";
  const isOffer = effective === "offer";
  const isPendingStart = effective === "pending_start";
  const isHired = effective === "hired";

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-white p-4 shadow-sm md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-semibold text-navy">
          <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="truncate">{job.jobTitle}</span>
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {job.clientName}
          {" · "}
          <StageChip effective={effective} hasPlacement={Boolean(job.placement)} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {(isInterviewing || isOffer) && (
          <button
            type="button"
            onClick={onOffer}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-navy shadow-sm transition hover:border-brand/40 hover:text-brand-dark"
          >
            <DollarSign className="h-3.5 w-3.5" /> {job.placement?.offerSalary ? "Edit Offer" : "Offer Received"}
          </button>
        )}
        {(isOffer || isInterviewing) && (
          <button
            type="button"
            onClick={onPlacement}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark"
          >
            <Handshake className="h-3.5 w-3.5" /> Placement
          </button>
        )}
        {isPendingStart && (
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark"
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> Confirm Start
          </button>
        )}
        {isHired && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-700">
            <CheckCircle2 className="h-3 w-3" /> Hired{" "}
            {job.placement?.startConfirmedAt ? ` · ${new Date(job.placement.startConfirmedAt).toLocaleDateString()}` : ""}
          </span>
        )}
      </div>
    </div>
  );
}

function StageChip({ effective, hasPlacement }: { effective: string; hasPlacement: boolean }) {
  const label = effective.replace(/_/g, " ");
  const cls = {
    submitted: "text-brand-dark",
    interviewing: "text-blue-700",
    offer: "text-amber-700",
    pending_start: "text-purple-700",
    hired: "text-emerald-700",
    sourced: "text-muted-foreground",
    rejected: "text-red-700",
    other: "text-muted-foreground",
  }[effective as keyof { submitted: 0 }] ?? "text-muted-foreground";
  return (
    <span className={cn("font-medium capitalize", cls)}>
      {label}
      {hasPlacement ? " (Ace)" : ""}
    </span>
  );
}

// ---------------- Offer dialog ----------------

function OfferDialog({
  candidateRfId,
  job,
  onClose,
}: {
  candidateRfId: number;
  job: PlacementContextJob;
  onClose: () => void;
}) {
  const router = useRouter();
  const [salary, setSalary] = useState(job.placement?.offerSalary ? String(job.placement.offerSalary) : "");
  const [currency, setCurrency] = useState(job.placement?.offerCurrency ?? "USD");
  const [title, setTitle] = useState(job.placement?.offerTitle ?? job.jobTitle);
  const [startDate, setStartDate] = useState(
    job.placement?.offerStartDate ? job.placement.offerStartDate.slice(0, 10) : "",
  );
  const [notes, setNotes] = useState(job.placement?.offerNotes ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startSave] = useTransition();

  function onSave() {
    setErr(null);
    const salaryNum = parseCompensation(salary);
    startSave(async () => {
      const result = await recordOffer({
        candidateRfId,
        jobRfId: job.jobRfId,
        clientRfId: job.clientRfId,
        salary: salaryNum,
        currency: currency.toUpperCase().slice(0, 3),
        title: title.trim(),
        startDate: startDate || null,
        notes: notes.trim(),
      });
      if (!result.ok) {
        setErr(result.error);
        toast.error("Couldn't save offer", { description: result.error });
        return;
      }
      toast.success("Offer recorded");
      onClose();
      router.refresh();
    });
  }

  return (
    <Modal title="Offer received" subtitle={`${job.jobTitle} · ${job.clientName}`} onClose={onClose}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <LabeledField label="Offered salary" value={salary} onChange={setSalary} placeholder="e.g. 120000 or 120k" />
        <LabeledField label="Currency" value={currency} onChange={setCurrency} />
        <div className="sm:col-span-2">
          <LabeledField label="Offered title" value={title} onChange={setTitle} />
        </div>
        <LabeledField label="Proposed start date" type="date" value={startDate} onChange={setStartDate} />
        <div className="sm:col-span-2">
          <LabeledTextarea label="Notes" value={notes} onChange={setNotes} rows={3} />
        </div>
      </div>
      {err && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{err}</div>}
      <ModalFooter onCancel={onClose} onSave={onSave} saving={isPending} />
    </Modal>
  );
}

// ---------------- Placement dialog ----------------

function PlacementDialog({
  candidateRfId,
  job,
  onClose,
}: {
  candidateRfId: number;
  job: PlacementContextJob;
  onClose: () => void;
}) {
  const router = useRouter();
  const seedSalary = job.placement?.acceptedSalary ?? job.placement?.offerSalary ?? null;
  const seedFeePct = job.placement?.feePercentage ?? job.clientFeePct ?? null;
  const [acceptedSalary, setAcceptedSalary] = useState(seedSalary ? String(seedSalary) : "");
  const [acceptedCurrency, setAcceptedCurrency] = useState(job.placement?.acceptedCurrency ?? job.placement?.offerCurrency ?? "USD");
  const [feePct, setFeePct] = useState(seedFeePct != null ? String(seedFeePct) : "");
  const [minFee, setMinFee] = useState(job.placement?.minFee ? String(job.placement.minFee) : "");
  const [guarantee, setGuarantee] = useState(job.placement?.guaranteePeriodDays ? String(job.placement.guaranteePeriodDays) : "");
  const [billingName, setBillingName] = useState(job.placement?.billingContactName ?? "");
  const [billingEmail, setBillingEmail] = useState(job.placement?.billingContactEmail ?? "");
  const [hiringName, setHiringName] = useState(job.placement?.hiringManagerName ?? "");
  const [hiringEmail, setHiringEmail] = useState(job.placement?.hiringManagerEmail ?? "");
  const [startDate, setStartDate] = useState(
    job.placement?.expectedStartDate
      ? job.placement.expectedStartDate.slice(0, 10)
      : job.placement?.offerStartDate
        ? job.placement.offerStartDate.slice(0, 10)
        : "",
  );
  const [notes, setNotes] = useState(job.placement?.placementNotes ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startSave] = useTransition();

  const salaryNum = parseCompensation(acceptedSalary);
  const pctNum = parseFloat(feePct) || 0;
  const minFeeNum = parseCompensation(minFee);
  const rawFee = salaryNum && pctNum ? Math.round(salaryNum * (pctNum / 100)) : 0;
  const feeTotal = minFeeNum && rawFee < minFeeNum ? minFeeNum : rawFee;
  const usedMinFee = minFeeNum != null && rawFee < minFeeNum;

  function onSave() {
    setErr(null);
    if (!salaryNum) return setErr("Accepted salary required.");
    if (!pctNum) return setErr("Fee percentage required.");
    if (!startDate) return setErr("Expected start date required.");

    startSave(async () => {
      const result = await recordPlacement({
        candidateRfId,
        jobRfId: job.jobRfId,
        clientRfId: job.clientRfId,
        acceptedSalary: salaryNum,
        acceptedCurrency: acceptedCurrency.toUpperCase().slice(0, 3),
        feePercentage: pctNum,
        feeTotal,
        minFee: minFeeNum,
        guaranteePeriodDays: guarantee ? Number(guarantee) : null,
        billingContactName: billingName.trim(),
        billingContactEmail: billingEmail.trim(),
        hiringManagerName: hiringName.trim(),
        hiringManagerEmail: hiringEmail.trim(),
        expectedStartDate: startDate,
        notes: notes.trim(),
      });
      if (!result.ok) {
        setErr(result.error);
        toast.error("Couldn't save placement", { description: result.error });
        return;
      }
      toast.success("Placement recorded", { description: "Candidate moved to Pending Start." });
      onClose();
      router.refresh();
    });
  }

  return (
    <Modal title="Placement" subtitle={`${job.jobTitle} · ${job.clientName}`} onClose={onClose} wide>
      <div className="rounded-lg border border-brand/30 bg-brand-tint/20 p-3 text-xs text-brand-dark">
        <div className="flex items-start gap-2">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            Client agreement default: <strong>{job.clientFeePct != null ? `${job.clientFeePct}% fee` : "no fee % on file"}</strong>.
            Override below if this placement has different terms.
          </div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <LabeledField label="Accepted salary" value={acceptedSalary} onChange={setAcceptedSalary} placeholder="120000 or 120k" />
        <LabeledField label="Currency" value={acceptedCurrency} onChange={setAcceptedCurrency} />
        <LabeledField label="Fee %" value={feePct} onChange={setFeePct} placeholder="25" />
        <LabeledField label="Min fee" value={minFee} onChange={setMinFee} placeholder="20000 (optional)" />
        <LabeledField label="Guarantee period (days)" value={guarantee} onChange={setGuarantee} placeholder="90" />
        <LabeledField label="Expected start date" type="date" value={startDate} onChange={setStartDate} />
      </div>

      <div className="mt-4 rounded-lg border border-border bg-muted/30 p-3">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Calculated fee</div>
        <div className="mt-1 text-2xl font-serif font-semibold text-navy">
          {formatMoney(feeTotal, acceptedCurrency)}
          {usedMinFee && <span className="ml-2 text-xs text-amber-700">(min fee applied)</span>}
        </div>
        {salaryNum && pctNum ? (
          <div className="mt-1 text-xs text-muted-foreground">
            {formatMoney(salaryNum, acceptedCurrency)} × {pctNum}% = {formatMoney(rawFee, acceptedCurrency)}
          </div>
        ) : (
          <div className="mt-1 text-xs text-muted-foreground">Enter salary + fee % to calculate.</div>
        )}
      </div>

      <h3 className="mt-5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Billing contact</h3>
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <LabeledField label="Name" value={billingName} onChange={setBillingName} />
        <LabeledField label="Email" type="email" value={billingEmail} onChange={setBillingEmail} />
      </div>
      <h3 className="mt-5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Hiring manager</h3>
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <LabeledField label="Name" value={hiringName} onChange={setHiringName} />
        <LabeledField label="Email" type="email" value={hiringEmail} onChange={setHiringEmail} />
      </div>

      <div className="mt-5">
        <LabeledTextarea label="Placement notes" value={notes} onChange={setNotes} rows={3} />
      </div>

      {err && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{err}</div>}
      <ModalFooter onCancel={onClose} onSave={onSave} saving={isPending} saveLabel="Record placement" />
    </Modal>
  );
}

// ---------------- Confirm Start dialog ----------------

function ConfirmStartDialog({
  placementId,
  jobTitle,
  onClose,
}: {
  placementId: string;
  jobTitle: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startSave] = useTransition();

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setPreviewUrl(f ? URL.createObjectURL(f) : null);
  }

  async function onSave() {
    setErr(null);
    if (!file) {
      setErr("Upload a screenshot confirming the start.");
      return;
    }
    startSave(async () => {
      const buffer = await file.arrayBuffer();
      const base64 = arrayBufferToBase64(buffer);
      const result = await confirmStart({ placementId, screenshotBase64: base64, mimeType: file.type || "image/png" });
      if (!result.ok) {
        setErr(result.error);
        toast.error("Couldn't confirm start", { description: result.error });
        return;
      }
      toast.success("Start confirmed — candidate moved to Hired", {
        description: "Invoicing flag set. Invoice workflow lands later.",
      });
      onClose();
      router.refresh();
    });
  }

  return (
    <Modal title="Confirm start" subtitle={jobTitle} onClose={onClose}>
      <p className="text-sm text-muted-foreground">
        Upload a screenshot of the start confirmation (email, portal, HR tool). This seals the placement and flags it for invoicing.
      </p>
      <label
        onClick={() => inputRef.current?.click()}
        className={cn(
          "mt-3 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/30 px-6 py-8 text-center transition hover:border-brand/40 hover:bg-brand-tint/20",
          file ? "border-brand/40 bg-brand-tint/20" : "",
        )}
      >
        <UploadCloud className="h-5 w-5 text-muted-foreground" />
        <div className="text-sm font-semibold text-navy">{file ? file.name : "Click to upload screenshot"}</div>
        <div className="text-xs text-muted-foreground">PNG / JPG up to 4MB</div>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={onPick}
        />
      </label>
      {previewUrl && (
        <div className="mt-3 overflow-hidden rounded-lg border border-border bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="Start confirmation preview" className="max-h-64 w-full object-contain" />
        </div>
      )}
      {err && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{err}</div>}
      <ModalFooter onCancel={onClose} onSave={onSave} saving={isPending} saveLabel="Confirm start" />
    </Modal>
  );
}

// ---------------- Shared ----------------

function Modal({
  title,
  subtitle,
  onClose,
  children,
  wide,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-4" onClick={onClose}>
      <div
        className={cn(
          "w-full overflow-hidden rounded-xl border border-border bg-white shadow-xl",
          wide ? "max-w-2xl" : "max-w-lg",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-border px-5 py-3">
          <div>
            <h2 className="font-serif text-lg font-semibold text-navy">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

function ModalFooter({
  onCancel,
  onSave,
  saving,
  saveLabel = "Save",
}: {
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  saveLabel?: string;
}) {
  return (
    <div className="mt-5 flex items-center justify-end gap-2 border-t border-border pt-4">
      <button
        type="button"
        onClick={onCancel}
        disabled={saving}
        className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-3 py-2 text-xs font-medium text-navy-400 shadow-sm transition hover:text-navy disabled:opacity-60"
      >
        <X className="h-3 w-3" /> Cancel
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="inline-flex items-center gap-1 rounded-md bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
      >
        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
        {saveLabel}
      </button>
    </div>
  );
}

function parseCompensation(raw: string): number | null {
  const t = raw.trim().toLowerCase().replace(/[\s,$]/g, "");
  if (!t) return null;
  const m = t.match(/^(\d+(?:\.\d+)?)([km])?$/);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (m[2] === "k") n *= 1000;
  if (m[2] === "m") n *= 1_000_000;
  return Math.round(n);
}

function formatMoney(n: number | null, currency: string): string {
  if (!n) return "—";
  const sym = (currency || "USD").toUpperCase() === "USD" ? "$" : `${currency.toUpperCase()} `;
  return `${sym}${n.toLocaleString()}`;
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
