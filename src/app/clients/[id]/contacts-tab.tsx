"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Mail, Phone as PhoneIcon, Plus, UserPlus, X, ExternalLink } from "lucide-react";
import { formatPhone, telHref } from "@/lib/recruiterflow";
import { addContact } from "@/app/clients/[id]/actions";
import { EmailLink } from "@/components/email-link";
import { cn } from "@/lib/utils";

export type ContactRow = {
  id: string;
  legacyRfId: number | null;
  name: string;
  title: string;
  email: string;
  phone: string;
  linkedIn: string | null;
  lastContactedAt: string | null;
};

export function ContactsTab({
  clientCuid,
  clientName,
  initialContacts,
}: {
  clientCuid: string;
  clientName: string;
  initialContacts: ContactRow[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const form = e.currentTarget;
    const data = new FormData(form);

    startTransition(async () => {
      const result = await addContact(clientCuid, data);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSuccess("Contact added.");
      form.reset();
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-court-fg-muted">
          {initialContacts.length === 0
            ? "No contacts on file yet."
            : `${initialContacts.length} ${initialContacts.length === 1 ? "contact" : "contacts"} on file`}
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen((v) => !v);
            setError(null);
            setSuccess(null);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark"
        >
          {open ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
          {open ? "Close" : "Add contact"}
        </button>
      </div>

      {success && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{success}</div>
      )}

      {open && (
        <form onSubmit={onSubmit} className="rounded-xl border border-court-border bg-court-surface p-5 shadow-sm">
          <div className="flex items-center gap-2 border-b border-court-border pb-3 text-sm font-semibold text-court-fg">
            <UserPlus className="h-4 w-4 text-brand-dark" /> New contact
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="First name" name="first_name" required autoFocus />
            <Field label="Last name" name="last_name" />
            <Field label="Title" name="current_designation" placeholder="e.g. VP Engineering" />
            <Field label="Email" name="email" type="email" placeholder="name@company.com" />
            <Field label="Phone" name="phone_number" placeholder="(555) 555-5555" />
            <Field label="LinkedIn URL" name="linkedin_profile" placeholder="https://linkedin.com/in/…" />
          </div>
          {error && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{error}</div>
          )}
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg border border-court-border bg-court-surface px-3 py-2 text-xs font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
            >
              {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              Save contact
            </button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-court-border bg-court-surface-subtle/60 text-[11px] uppercase tracking-wider text-court-fg-muted">
            <tr>
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 font-medium">Title</th>
              <th className="px-5 py-3 font-medium">Email</th>
              <th className="px-5 py-3 font-medium">Phone</th>
              <th className="px-5 py-3 font-medium">Last Activity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {initialContacts.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-12 text-center text-sm text-court-fg-muted">
                  No contacts for this client yet. Add one with the button above.
                </td>
              </tr>
            ) : (
              initialContacts.map((c) => (
                <tr key={c.id} className="transition hover:bg-brand-tint/40">
                  <td className="px-5 py-3 align-top">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-court-surface-subtle text-[11px] font-semibold text-court-fg-muted">
                        {initials(c.name)}
                      </div>
                      <div>
                        <div className="font-medium text-court-fg">{c.name}</div>
                        {c.linkedIn && (
                          <a
                            href={c.linkedIn}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-brand-dark hover:underline"
                          >
                            LinkedIn <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3 align-top text-court-fg-muted">{c.title || "—"}</td>
                  <td className="px-5 py-3 align-top">
                    {c.email ? (
                      <EmailLink
                        email={c.email}
                        className="inline-flex items-center gap-1 text-court-fg hover:text-brand-dark"
                        mergeValues={{
                          clientContactFullName: c.name,
                          clientContactFirstName: c.name.trim().split(/\s+/)[0] ?? "",
                          clientCompanyName: clientName,
                        }}
                      >
                        <Mail className="h-3 w-3 text-court-fg-muted" /> {c.email}
                      </EmailLink>
                    ) : (
                      <span className="text-court-fg-muted">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3 align-top">
                    {c.phone ? (
                      <a href={telHref(c.phone)} className="inline-flex items-center gap-1 text-court-fg hover:text-brand-dark">
                        <PhoneIcon className="h-3 w-3 text-court-fg-muted" /> {formatPhone(c.phone)}
                      </a>
                    ) : (
                      <span className="text-court-fg-muted">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3 align-top text-xs text-court-fg-muted">
                    {c.lastContactedAt ? new Date(c.lastContactedAt).toLocaleDateString() : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Field({
  label,
  name,
  type = "text",
  required,
  placeholder,
  autoFocus,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      <input
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={cn(
          "mt-1 w-full rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg placeholder:text-court-fg-muted/60",
          "focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20",
        )}
      />
    </label>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");
}
