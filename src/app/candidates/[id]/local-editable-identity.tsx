"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Briefcase,
  Building2,
  ExternalLink,
  Loader2,
  Mail,
  MapPin,
  Pencil,
  Phone as PhoneIcon,
  Save,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { LabeledField } from "@/app/candidates/[id]/editable-helpers";
import { INPUT_FRAME_RECT_CLASS } from "@/components/ui/input";
import { updateLocalCandidate } from "@/app/candidates/[id]/local-candidate-update";
import { EmailPopupLauncher } from "@/components/email-popup-launcher";
import { formatLocation } from "@/lib/utils";

// Ace-native mirror of EditableIdentity. Same consolidated card shape
// (name + contact + employment in one Edit/Save flow) but writes to
// Neon directly via updateLocalCandidate instead of the RF API path.

export type LocalIdentityState = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  location: string;
  linkedinProfile: string;
  currentDesignation: string;
  currentOrganization: string;
};

export function LocalEditableIdentity({
  candidateId,
  initial,
}: {
  candidateId: string;
  initial: LocalIdentityState;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState<LocalIdentityState>(initial);
  const [draft, setDraft] = useState<LocalIdentityState>(initial);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startSave] = useTransition();

  function onSave() {
    setError(null);
    const next: LocalIdentityState = {
      firstName: draft.firstName.trim(),
      lastName: draft.lastName.trim(),
      email: draft.email.trim(),
      phone: draft.phone.trim(),
      location: draft.location.trim(),
      linkedinProfile: draft.linkedinProfile.trim(),
      currentDesignation: draft.currentDesignation.trim(),
      currentOrganization: draft.currentOrganization.trim(),
    };
    startSave(async () => {
      const result = await updateLocalCandidate({
        id: candidateId,
        firstName: next.firstName,
        lastName: next.lastName || null,
        email: next.email || null,
        phone: next.phone || null,
        location: next.location || null,
        linkedinProfile: next.linkedinProfile || null,
        currentDesignation: next.currentDesignation || null,
        currentOrganization: next.currentOrganization || null,
      });
      if (!result.ok) {
        setError(result.error);
        toast.error("Couldn't save identity", { description: result.error });
        return;
      }
      setSaved(next);
      setEditing(false);
      toast.success("Identity saved");
      router.refresh();
    });
  }

  function onCancel() {
    setDraft(saved);
    setEditing(false);
    setError(null);
  }

  const candidateFullName =
    [saved.firstName, saved.lastName].filter(Boolean).join(" ").trim() ||
    "(unnamed)";

  return (
    <div className="rounded-xl border border-court-border/40 bg-court-surface shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-court-border px-5 py-4">
        <h1 className="break-words font-serif text-2xl font-bold leading-tight text-court-fg">
          {candidateFullName}
        </h1>
        {!editing ? (
          <EditBtn onClick={() => setEditing(true)} />
        ) : (
          <SaveCancel saving={isPending} onSave={onSave} onCancel={onCancel} />
        )}
      </div>
      <div className="p-5">
        {editing ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <LabeledField
              label="First name"
              value={draft.firstName}
              onChange={(v) => setDraft({ ...draft, firstName: v })} frameClassName={INPUT_FRAME_RECT_CLASS}
            />
            <LabeledField
              label="Last name"
              value={draft.lastName}
              onChange={(v) => setDraft({ ...draft, lastName: v })} frameClassName={INPUT_FRAME_RECT_CLASS}
            />
            <LabeledField
              label="Email"
              type="email"
              value={draft.email}
              onChange={(v) => setDraft({ ...draft, email: v })} frameClassName={INPUT_FRAME_RECT_CLASS}
            />
            <LabeledField
              label="Phone"
              value={draft.phone}
              onChange={(v) => setDraft({ ...draft, phone: v })} frameClassName={INPUT_FRAME_RECT_CLASS}
            />
            <div className="sm:col-span-2">
              <LabeledField
                label="Location"
                value={draft.location}
                onChange={(v) => setDraft({ ...draft, location: v })} frameClassName={INPUT_FRAME_RECT_CLASS}
              />
            </div>
            <div className="sm:col-span-2">
              <LabeledField
                label="LinkedIn URL"
                type="url"
                value={draft.linkedinProfile}
                onChange={(v) => setDraft({ ...draft, linkedinProfile: v })} frameClassName={INPUT_FRAME_RECT_CLASS}
              />
            </div>
            <div className="sm:col-span-2">
              <LabeledField
                label="Current title"
                value={draft.currentDesignation}
                onChange={(v) => setDraft({ ...draft, currentDesignation: v })} frameClassName={INPUT_FRAME_RECT_CLASS}
              />
            </div>
            <div className="sm:col-span-2">
              <LabeledField
                label="Current employer"
                value={draft.currentOrganization}
                onChange={(v) =>
                  setDraft({ ...draft, currentOrganization: v })
                } frameClassName={INPUT_FRAME_RECT_CLASS}
              />
            </div>
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800 sm:col-span-2">
                {error}
              </div>
            )}
          </div>
        ) : (
          <dl className="space-y-3 text-sm">
            <Row label="Current title" icon={<Briefcase className="h-3 w-3" />}>
              <span>{saved.currentDesignation || "—"}</span>
            </Row>
            <Row label="Location" icon={<MapPin className="h-3 w-3" />}>
              <span>{formatLocation(saved.location) || "—"}</span>
            </Row>
            <Row label="Email" icon={<Mail className="h-3 w-3" />}>
              {saved.email ? (
                <EmailPopupLauncher
                  email={saved.email}
                  className="text-brand-dark hover:underline"
                  candidateRef={candidateId}
                  context={{
                    candidate: {
                      firstName: saved.firstName,
                      lastName: saved.lastName,
                      email: saved.email,
                      currentTitle: saved.currentDesignation,
                      currentCompany: saved.currentOrganization,
                    },
                  }}
                >
                  {saved.email}
                </EmailPopupLauncher>
              ) : (
                <span className="text-court-fg-muted">—</span>
              )}
            </Row>
            <Row label="Phone" icon={<PhoneIcon className="h-3 w-3" />}>
              {saved.phone ? (
                <a
                  href={`tel:${saved.phone}`}
                  className="text-court-fg underline-offset-2 hover:text-brand-dark hover:underline"
                  title="Call"
                >
                  {saved.phone}
                </a>
              ) : (
                <span className="text-court-fg-muted">—</span>
              )}
            </Row>
            <Row
              label="Current employer"
              icon={<Building2 className="h-3 w-3" />}
            >
              <span>{saved.currentOrganization || "—"}</span>
            </Row>
            {/* LinkedIn only renders when set - empty profiles drop the
                row entirely instead of showing a dash, since LinkedIn
                is optional and a "—" placeholder adds noise to the
                bottom of the card. Edit mode still surfaces the field
                so the recruiter can add one later. */}
            {saved.linkedinProfile && (
              <Row label="LinkedIn">
                <a
                  href={saved.linkedinProfile}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-brand-dark hover:underline"
                >
                  Profile <ExternalLink className="h-3 w-3" />
                </a>
              </Row>
            )}
          </dl>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-court-fg-muted">
        {label}
      </dt>
      <dd className="mt-0.5 inline-flex items-center gap-1 text-court-fg">
        {icon}
        {children}
      </dd>
    </div>
  );
}

function EditBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:border-court-brand/40 hover:text-court-fg"
    >
      <Pencil className="h-3 w-3" /> Edit
    </button>
  );
}

function SaveCancel({
  saving,
  onSave,
  onCancel,
}: {
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        onClick={onCancel}
        disabled={saving}
        className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg disabled:opacity-60"
      >
        <X className="h-3 w-3" /> Cancel
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="inline-flex items-center gap-1 rounded-md bg-court-brand px-3 py-1 text-[11px] font-semibold text-white shadow-sm transition hover:bg-court-brand-dark disabled:opacity-60"
      >
        {saving ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Save className="h-3 w-3" />
        )}
        Save
      </button>
    </div>
  );
}
