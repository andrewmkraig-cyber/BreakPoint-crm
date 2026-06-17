"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Mail, Phone as PhoneIcon, Plus, UserPlus, X, ExternalLink } from "lucide-react";
import { formatPhone, linkedinUrlFrom, telHref } from "@/lib/rf-payload-shapes";
import { addContact, updateContact } from "@/app/clients/[id]/actions";
import { EmailPopupLauncher } from "@/components/email-popup-launcher";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";

// Phone-type labels offered in the per-row picker. New rows default to the
// first entry. Legacy phones imported without a type carry "" and render
// without a tag. Keep this list in sync with the server zip in actions.ts.
export const PHONE_TYPES = ["Office", "Mobile", "Direct", "Other"] as const;
export const DEFAULT_PHONE_TYPE = PHONE_TYPES[0];

export type ContactPhone = { number: string; extension: string; type: string };

function emptyPhone(): ContactPhone {
  return { number: "", extension: "", type: DEFAULT_PHONE_TYPE };
}

export type ContactRow = {
  id: string;
  legacyRfId: number | null;
  firstName: string;
  lastName: string;
  name: string;
  title: string;
  // Primary (index 0) single values, kept for back-compat with callers that
  // only read one email/phone.
  email: string;
  phone: string;
  extension: string;
  // Full ordered lists (index 0 is primary).
  emails: string[];
  phones: ContactPhone[];
  linkedIn: string | null;
  notes: string;
  lastContactedAt: string | null;
};


export function ContactsTab({
  clientCuid,
  clientName,
  initialContacts,
  canWrite = true,
  openAddForm = false,
}: {
  clientCuid: string;
  clientName: string;
  initialContacts: ContactRow[];
  // When false (client you don't own) the add form and row-click editor
  // are suppressed; contacts stay readable with their email/phone links.
  canWrite?: boolean;
  openAddForm?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(openAddForm);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Local copy of the rows so edits from the slide-over apply without
  // needing a router.refresh() (SSR round-trip). When the add-contact
  // form succeeds we still router.refresh() since the new row needs to
  // come back from the server with its generated id.
  const [rows, setRows] = useState<ContactRow[]>(initialContacts);
  useEffect(() => setRows(initialContacts), [initialContacts]);
  useEffect(() => {
    if (openAddForm && canWrite) setOpen(true);
  }, [canWrite, openAddForm]);
  const [editing, setEditing] = useState<ContactRow | null>(null);
  const [addEmails, setAddEmails] = useState<string[]>([""]);
  const [addPhones, setAddPhones] = useState<ContactPhone[]>([emptyPhone()]);

  function resetAddLists() {
    setAddEmails([""]);
    setAddPhones([emptyPhone()]);
  }

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
      resetAddLists();
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-court-fg-muted">
          {rows.length === 0
            ? "No contacts on file yet."
            : `${rows.length} ${rows.length === 1 ? "contact" : "contacts"} on file`}
        </div>
        {canWrite && (
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setOpen((v) => !v);
              setError(null);
              setSuccess(null);
            }}
          >
            {open ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
            {open ? "Close" : "Add contact"}
          </Button>
        )}
      </div>

      {success && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{success}</div>
      )}

      {canWrite && open && (
        <form onSubmit={onSubmit} className="rounded-xl border border-court-border/40 bg-court-surface p-5 shadow-sm">
          <div className="flex items-center gap-2 border-b border-court-border pb-3 text-sm font-semibold text-court-fg">
            <UserPlus className="h-4 w-4 text-brand-dark" /> New contact
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="First name" name="first_name" required autoFocus />
            <Field label="Last name" name="last_name" />
            <Field label="Title" name="current_designation" />
            <EmailListField values={addEmails} onChange={setAddEmails} name="email" />
            <PhoneListField
              values={addPhones}
              onChange={setAddPhones}
              numberName="phone_number"
              extName="phone_extension"
              typeName="phone_type"
            />
            <Field label="LinkedIn URL" name="linkedin_profile" />
          </div>
          {error && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{error}</div>
          )}
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                resetAddLists();
              }}
              className="rounded-lg border border-court-border bg-court-surface px-3 py-2 text-xs font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg"
            >
              Cancel
            </button>
            <Button
              type="submit"
              size="sm"
              disabled={isPending}
            >
              {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              Save contact
            </Button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-xl border border-court-border/40 bg-court-surface shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-court-border/40 bg-court-surface-subtle/60 text-[11px] uppercase tracking-wider text-court-fg-muted">
            <tr>
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 font-medium">Title</th>
              <th className="px-5 py-3 font-medium">Email</th>
              <th className="px-5 py-3 font-medium">Phone</th>
              <th className="px-5 py-3 font-medium">Last Activity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-court-border/40">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-12 text-center text-sm text-court-fg-muted">
                  No contacts for this client yet. Add one with the button above.
                </td>
              </tr>
            ) : (
              rows.map((c) => {
                const emailList = c.emails.length ? c.emails : c.email ? [c.email] : [];
                const phoneList = c.phones.length
                  ? c.phones
                  : c.phone
                    ? [{ number: c.phone, extension: c.extension, type: "" }]
                    : [];
                return (
                <tr
                  key={c.id}
                  onClick={canWrite ? () => setEditing(c) : undefined}
                  className={cn(
                    "transition",
                    canWrite ? "cursor-pointer hover:bg-court-surface-subtle/60" : "",
                  )}
                >
                  <td className="px-5 py-3 align-top">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-court-surface-subtle text-[11px] font-semibold text-court-fg-muted">
                        {initials(c.name)}
                      </div>
                      <div>
                        <div className="font-medium text-court-fg">{c.name}</div>
                        {c.linkedIn && (
                          <a
                            href={linkedinUrlFrom(c.linkedIn)}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 text-[11px] text-brand-dark hover:underline"
                          >
                            LinkedIn <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3 align-top text-court-fg-muted">{c.title || "—"}</td>
                  <td
                    className="px-5 py-3 align-top"
                    onClick={(e) => {
                      // Let the email/phone links handle their own click so
                      // the row's open-editor handler doesn't swallow them.
                      if ((e.target as HTMLElement).closest("a")) e.stopPropagation();
                    }}
                  >
                    {emailList.length ? (
                      <div className="space-y-1">
                        {emailList.map((em, i) => (
                          <EmailPopupLauncher
                            key={i}
                            email={em}
                            className={cn(
                              "flex items-center gap-1 hover:text-brand-dark",
                              i === 0 ? "text-court-fg" : "text-xs text-court-fg-muted",
                            )}
                            context={{
                              client: {
                                name: clientName,
                                primaryContactFirstName:
                                  c.firstName || c.name.trim().split(/\s+/)[0] || "",
                              },
                            }}
                          >
                            <Mail className="h-3 w-3 text-court-fg-muted" /> {em}
                          </EmailPopupLauncher>
                        ))}
                      </div>
                    ) : (
                      <span className="text-court-fg-muted">—</span>
                    )}
                  </td>
                  <td
                    className="px-5 py-3 align-top"
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest("a")) e.stopPropagation();
                    }}
                  >
                    {phoneList.length ? (
                      <div className="space-y-1">
                        {phoneList.map((p, i) => (
                          <a
                            key={i}
                            href={telHref(p.number, p.extension)}
                            className={cn(
                              "flex items-center gap-1 hover:text-brand-dark",
                              i === 0 ? "text-court-fg" : "text-xs text-court-fg-muted",
                            )}
                          >
                            <PhoneIcon className="h-3 w-3 text-court-fg-muted" />
                            {p.type && (
                              <span className="text-[10px] font-semibold uppercase tracking-wide text-court-fg-muted">
                                {p.type}
                              </span>
                            )}
                            {formatPhone(p.number)}
                            {p.extension && (
                              <span className="text-court-fg-muted">ext. {p.extension}</span>
                            )}
                          </a>
                        ))}
                      </div>
                    ) : (
                      <span className="text-court-fg-muted">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3 align-top text-xs text-court-fg-muted">
                    {c.lastContactedAt ? new Date(c.lastContactedAt).toLocaleDateString() : "—"}
                  </td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <ContactEditor
          contact={editing}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setRows((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function ContactEditor({
  contact,
  onClose,
  onSaved,
}: {
  contact: ContactRow;
  onClose: () => void;
  onSaved: (row: ContactRow) => void;
}) {
  const [firstName, setFirstName] = useState(contact.firstName);
  const [lastName, setLastName] = useState(contact.lastName);
  const [title, setTitle] = useState(contact.title);
  const [emails, setEmails] = useState<string[]>(
    contact.emails.length ? contact.emails : contact.email ? [contact.email] : [""],
  );
  const [phones, setPhones] = useState<ContactPhone[]>(
    contact.phones.length
      ? contact.phones
      : contact.phone
        ? [{ number: contact.phone, extension: contact.extension, type: DEFAULT_PHONE_TYPE }]
        : [emptyPhone()],
  );
  const [linkedin, setLinkedin] = useState(contact.linkedIn ?? "");
  const [notes, setNotes] = useState(contact.notes);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startSaving(async () => {
      const res = await updateContact({
        contactId: contact.id,
        firstName,
        lastName,
        title,
        emails,
        phones,
        linkedin,
        notes,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSaved({
        ...contact,
        firstName: res.value.firstName,
        lastName: res.value.lastName,
        name: res.value.name || "(unnamed)",
        title: res.value.title,
        email: res.value.email,
        phone: res.value.phone,
        extension: res.value.extension,
        emails: res.value.emails,
        phones: res.value.phones,
        linkedIn: res.value.linkedin || null,
        notes: res.value.notes,
      });
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-label="Close contact editor"
      />
      <aside className="relative flex h-full w-full max-w-lg flex-col overflow-y-auto bg-court-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-court-border px-5 py-4">
          <h2 className="font-serif text-base font-semibold text-court-fg">Edit contact</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={onSubmit} className="flex flex-1 flex-col gap-4 px-5 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <EditorField label="First name" required value={firstName} onChange={setFirstName} autoFocus />
            <EditorField label="Last name" value={lastName} onChange={setLastName} />
          </div>
          <EditorField label="Title" value={title} onChange={setTitle} />
          <EmailListField values={emails} onChange={setEmails} />
          <PhoneListField values={phones} onChange={setPhones} />
          <EditorField label="LinkedIn URL" value={linkedin} onChange={setLinkedin} />
          <label className="block text-sm">
            <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">Notes</span>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={5}
              frameClassName="mt-1"
            />
          </label>
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{error}</div>
          )}
          <div className="mt-auto flex items-center justify-end gap-2 border-t border-court-border pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-lg border border-court-border bg-court-surface px-3 py-2 text-xs font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg disabled:opacity-60"
            >
              Cancel
            </button>
            <Button
              type="submit"
              size="sm"
              disabled={saving}
            >
              {saving && <Loader2 className="h-3 w-3 animate-spin" />}
              Save
            </Button>
          </div>
        </form>
      </aside>
    </div>
  );
}

function EditorField({
  label,
  value,
  onChange,
  type = "text",
  required,
  placeholder,
  autoFocus,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  return (
    <label className={cn("block text-sm", className)}>
      <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        placeholder={placeholder}
        autoFocus={autoFocus}
        frameClassName="mt-1"
      />
    </label>
  );
}

function Field({
  label,
  name,
  type = "text",
  required,
  placeholder,
  autoFocus,
  className,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  return (
    <label className={cn("block text-sm", className)}>
      <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      <Input
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        autoFocus={autoFocus}
        frameClassName="mt-1"
      />
    </label>
  );
}

// Repeatable email rows with a "+ Add email" control. When `name` is set the
// inputs participate in a FormData submit (the add form reads getAll(name));
// the inline editor uses it controlled-only (no name). The first row has no
// remove control and is the primary email.
function EmailListField({
  values,
  onChange,
  name,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  name?: string;
}) {
  const rows = values.length ? values : [""];
  return (
    <div className="block text-sm">
      <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">Email</span>
      <div className="mt-1 space-y-2">
        {rows.map((v, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              type="email"
              name={name}
              value={v}
              onChange={(e) => {
                const next = [...rows];
                next[i] = e.target.value;
                onChange(next);
              }}
              containerClassName="flex-1"
            />
            {i > 0 && (
              <button
                type="button"
                onClick={() => onChange(rows.filter((_, j) => j !== i))}
                className="rounded-md p-1 text-court-fg-muted transition hover:text-red-600"
                aria-label="Remove email"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange([...rows, ""])}
          className="inline-flex items-center gap-1 rounded-md text-xs font-medium text-court-fg-muted transition hover:text-brand-dark"
        >
          <Plus className="h-3 w-3" /> Add email
        </button>
      </div>
    </div>
  );
}

// Repeatable phone rows (type + number + extension) with a "+ Add phone"
// control. Same FormData-vs-controlled behavior as EmailListField
// (numberName / extName / typeName). Each row leads with a type picker
// (Office / Mobile / Direct / Other) so callers know which line to dial.
function PhoneListField({
  values,
  onChange,
  numberName,
  extName,
  typeName,
}: {
  values: ContactPhone[];
  onChange: (v: ContactPhone[]) => void;
  numberName?: string;
  extName?: string;
  typeName?: string;
}) {
  const rows = values.length ? values : [emptyPhone()];
  return (
    <div className="block text-sm">
      <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">Phone</span>
      <div className="mt-1 space-y-2">
        {rows.map((p, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="grid flex-1 grid-cols-[6.5rem_1fr_4.5rem] gap-2">
              <Select
                name={typeName}
                value={p.type || DEFAULT_PHONE_TYPE}
                onChange={(e) => {
                  const next = rows.map((r) => ({ ...r }));
                  next[i].type = e.target.value;
                  onChange(next);
                }}
                containerClassName="min-w-0"
                aria-label="Phone type"
              >
                {PHONE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
              <Input
                name={numberName}
                value={p.number}
                onChange={(e) => {
                  const next = rows.map((r) => ({ ...r }));
                  next[i].number = e.target.value;
                  onChange(next);
                }}
                containerClassName="min-w-0"
              />
              <Input
                name={extName}
                value={p.extension}
                onChange={(e) => {
                  const next = rows.map((r) => ({ ...r }));
                  next[i].extension = e.target.value;
                  onChange(next);
                }}
                placeholder="Ext."
                containerClassName="min-w-0"
              />
            </div>
            {i > 0 && (
              <button
                type="button"
                onClick={() => onChange(rows.filter((_, j) => j !== i))}
                className="rounded-md p-1 text-court-fg-muted transition hover:text-red-600"
                aria-label="Remove phone"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange([...rows, emptyPhone()])}
          className="inline-flex items-center gap-1 rounded-md text-xs font-medium text-court-fg-muted transition hover:text-brand-dark"
        >
          <Plus className="h-3 w-3" /> Add phone
        </button>
      </div>
    </div>
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
