"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Briefcase, Building2 } from "lucide-react";
import { toast } from "sonner";
import {
  SectionCard,
  LabeledField,
} from "@/app/candidates/[id]/editable-helpers";
import { INPUT_FRAME_RECT_CLASS } from "@/components/ui/input";
import { EditBtn, SaveCancel } from "@/app/candidates/[id]/editable-contact";
import { updateCandidate } from "@/app/candidates/[id]/actions";

export type EmploymentState = {
  current_designation: string;
  current_organization: string;
  expectedSalary: string; // free-text for editing; parsed on save
  expectedCurrency: string;
};

export function EditableEmployment({
  candidateId,
  initial,
}: {
  candidateId: number;
  initial: EmploymentState;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startSave] = useTransition();

  function onSave() {
    setError(null);
    const salaryNumber = parseCompensation(draft.expectedSalary);
    const currency = (draft.expectedCurrency || "USD").toUpperCase().slice(0, 3);
    startSave(async () => {
      const result = await updateCandidate({
        id: candidateId,
        current_designation: draft.current_designation.trim(),
        current_organization: draft.current_organization.trim(),
        expected_salary:
          salaryNumber == null
            ? null
            : { number: salaryNumber, currency },
      });
      if (!result.ok) {
        setError(result.error);
        toast.error("Couldn't save employment", { description: result.error });
        return;
      }
      setSaved(draft);
      setEditing(false);
      toast.success("Employment saved");
      router.refresh();
    });
  }

  function onCancel() {
    setDraft(saved);
    setEditing(false);
    setError(null);
  }

  return (
    <SectionCard
      title="Employment"
      right={
        !editing ? (
          <EditBtn onClick={() => setEditing(true)} />
        ) : (
          <SaveCancel saving={isPending} onSave={onSave} onCancel={onCancel} />
        )
      }
    >
      {editing ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <LabeledField
              label="Current title"
              value={draft.current_designation}
              onChange={(v) => setDraft({ ...draft, current_designation: v })} frameClassName={INPUT_FRAME_RECT_CLASS}
            />
          </div>
          <div className="sm:col-span-2">
            <LabeledField
              label="Current employer"
              value={draft.current_organization}
              onChange={(v) => setDraft({ ...draft, current_organization: v })} frameClassName={INPUT_FRAME_RECT_CLASS}
            />
          </div>
          <LabeledField
            label="Expected comp"
            value={draft.expectedSalary}
            onChange={(v) => setDraft({ ...draft, expectedSalary: v })} frameClassName={INPUT_FRAME_RECT_CLASS}
          />
          <LabeledField
            label="Currency"
            value={draft.expectedCurrency}
            onChange={(v) => setDraft({ ...draft, expectedCurrency: v })} frameClassName={INPUT_FRAME_RECT_CLASS}
          />
          {error && <div className="sm:col-span-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{error}</div>}
        </div>
      ) : (
        <dl className="space-y-3 text-sm">
          <Row label="Current title" icon={<Briefcase className="h-3 w-3" />}>
            <span>{saved.current_designation || "—"}</span>
          </Row>
          <Row label="Current employer" icon={<Building2 className="h-3 w-3" />}>
            <span>{saved.current_organization || "—"}</span>
          </Row>
          <Row label="Expected compensation">
            <span>
              {formatSalaryForDisplay(saved.expectedSalary, saved.expectedCurrency) || "—"}
            </span>
          </Row>
        </dl>
      )}
    </SectionCard>
  );
}

function Row({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-court-fg-muted">{label}</dt>
      <dd className="mt-0.5 inline-flex items-center gap-1 text-court-fg">
        {icon}
        {children}
      </dd>
    </div>
  );
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

function formatSalaryForDisplay(raw: string, currency: string): string {
  const n = parseCompensation(raw);
  if (n == null) return "";
  const sym = (currency || "USD").toUpperCase() === "USD" ? "$" : `${currency.toUpperCase()} `;
  if (n >= 1000) return `${sym}${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return `${sym}${n}`;
}
