"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Save, X, Mail, Phone as PhoneIcon, MapPin, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { SectionCard, LabeledField } from "@/app/candidates/[id]/editable-helpers";
import { updateCandidate } from "@/app/candidates/[id]/actions";
import { formatPhone, telHref, normalizeToE164 } from "@/lib/recruiterflow";
import { EmailLink } from "@/components/email-link";

export type ContactState = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  location: string;
  linkedin_profile: string;
};

export function EditableContact({ candidateId, initial }: { candidateId: number; initial: ContactState }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState<ContactState>(initial);
  const [draft, setDraft] = useState<ContactState>(initial);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startSave] = useTransition();

  function onSave() {
    setError(null);
    const phone = normalizeToE164(draft.phone) ?? "";
    const next: ContactState = { ...draft, phone };
    startSave(async () => {
      const result = await updateCandidate({
        id: candidateId,
        first_name: next.first_name.trim(),
        last_name: next.last_name.trim(),
        email: next.email.trim() || undefined,
        phone_number: next.phone.trim() || undefined,
        linkedin_profile: next.linkedin_profile.trim() || undefined,
        location: { location: next.location.trim() || undefined },
      });
      if (!result.ok) {
        setError(result.error);
        toast.error("Couldn't save contact", { description: result.error });
        return;
      }
      setSaved(next);
      setEditing(false);
      toast.success("Contact saved");
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
      title="Contact"
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
          <LabeledField label="First name" value={draft.first_name} onChange={(v) => setDraft({ ...draft, first_name: v })} />
          <LabeledField label="Last name" value={draft.last_name} onChange={(v) => setDraft({ ...draft, last_name: v })} />
          <LabeledField label="Email" type="email" value={draft.email} onChange={(v) => setDraft({ ...draft, email: v })} />
          <LabeledField label="Phone" value={draft.phone} onChange={(v) => setDraft({ ...draft, phone: v })} placeholder="+1 216-555-5555" />
          <div className="sm:col-span-2">
            <LabeledField label="Location" value={draft.location} onChange={(v) => setDraft({ ...draft, location: v })} placeholder="Cleveland, OH" />
          </div>
          <div className="sm:col-span-2">
            <LabeledField label="LinkedIn URL" type="url" value={draft.linkedin_profile} onChange={(v) => setDraft({ ...draft, linkedin_profile: v })} placeholder="https://linkedin.com/in/…" />
          </div>
          {error && <div className="sm:col-span-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{error}</div>}
        </div>
      ) : (
        <dl className="space-y-3 text-sm">
          <Row label="Email" icon={<Mail className="h-3 w-3" />}>
            {saved.email ? (
              <EmailLink
                email={saved.email}
                className="text-brand-dark hover:underline"
                mergeValues={{
                  candidateFirstName: saved.first_name,
                  candidateLastName: saved.last_name,
                  candidateFullName: [saved.first_name, saved.last_name].filter(Boolean).join(" "),
                  candidateEmail: saved.email,
                }}
              >
                {saved.email}
              </EmailLink>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Row>
          <Row label="Phone" icon={<PhoneIcon className="h-3 w-3" />}>
            {saved.phone ? (
              <a href={telHref(saved.phone)} className="text-navy hover:text-brand-dark">
                {formatPhone(saved.phone)}
              </a>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Row>
          <Row label="LinkedIn">
            {saved.linkedin_profile ? (
              <a href={saved.linkedin_profile} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-dark hover:underline">
                Profile <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Row>
          <Row label="Location" icon={<MapPin className="h-3 w-3" />}>
            <span>{saved.location || "—"}</span>
          </Row>
        </dl>
      )}
    </SectionCard>
  );
}

function Row({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 inline-flex items-center gap-1 text-navy">
        {icon}
        {children}
      </dd>
    </div>
  );
}

export function EditBtn({ onClick, label = "Edit" }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-2 py-1 text-[11px] font-medium text-navy-400 shadow-sm transition hover:border-brand/40 hover:text-navy"
    >
      <Pencil className="h-3 w-3" /> {label}
    </button>
  );
}

export function SaveCancel({
  saving,
  onSave,
  onCancel,
}: {
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onCancel}
        disabled={saving}
        className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-2 py-1 text-[11px] font-medium text-navy-400 shadow-sm transition hover:text-navy disabled:opacity-60"
      >
        <X className="h-3 w-3" /> Cancel
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-1 text-[11px] font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
      >
        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
        Save
      </button>
    </div>
  );
}
