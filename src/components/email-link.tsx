"use client";

import { useState, type MouseEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { applyMergeFields, type MergeFieldValues } from "@/lib/merge-fields";
import { EmailComposer, type EmailDraft } from "@/components/email-composer";
import { sendEmailAction } from "@/app/email/actions";
import { cn } from "@/lib/utils";

type ComposerSeed = {
  subject?: string;
  body?: string;
};

// Wraps a rendered email address so clicking opens the Ace composer instead
// of falling through to mailto:. Keeps the visual parity of an anchor but
// hijacks navigation. The composer opens with To pre-filled and the user
// can pick a saved template from the dropdown. Callers pass `mergeValues`
// so template tokens like [Candidate First Name] resolve against the
// actual entity context (candidate, client contact, placement, etc.).
export function EmailLink({
  email,
  children,
  className,
  seed,
  subjectHint,
  mergeValues,
}: {
  email: string;
  children?: ReactNode;
  className?: string;
  seed?: ComposerSeed;
  subjectHint?: string;
  mergeValues?: MergeFieldValues;
}) {
  const [open, setOpen] = useState(false);

  function onClick(e: MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (!email) return;
    setOpen(true);
  }

  const trimmedEmail = email.trim();

  return (
    <>
      <a
        href={trimmedEmail ? `mailto:${trimmedEmail}` : "#"}
        onClick={onClick}
        className={cn("cursor-pointer", className)}
      >
        {children ?? trimmedEmail}
      </a>
      {open && (
        <EmailComposer
          title="New email"
          subtitle={trimmedEmail}
          initial={{
            to: trimmedEmail ? [trimmedEmail] : [],
            cc: [],
            bcc: [],
            subject: seed?.subject ?? subjectHint ?? "",
            body: seed?.body ?? "",
          }}
          showTemplatePicker
          resolveTemplate={async (t) => {
            // Apply whatever merge context the caller gave us. Empty keys
            // become empty strings in the output — never left as raw tokens
            // like "[Candidate First Name]" that'd leak into a sent email.
            const values = mergeValues ?? {};
            // eslint-disable-next-line no-console
            console.log("[EmailLink.resolveTemplate]", {
              templateName: t.name,
              hasValues: Object.keys(values).length,
              sampleValues: {
                candidateFirstName: values.candidateFirstName,
                clientCompanyName: values.clientCompanyName,
                jobTitle: values.jobTitle,
              },
              bodySample: t.body.slice(0, 120),
            });
            const subject = applyMergeFields(t.subject, values);
            const body = applyMergeFields(t.body, values);
            return { subject, body };
          }}
          onClose={() => setOpen(false)}
          onSend={async (draft: EmailDraft) => {
            const result = await sendEmailAction({
              to: draft.to,
              cc: draft.cc,
              bcc: draft.bcc,
              subject: draft.subject,
              bodyText: draft.body,
            });
            if (!result.ok) {
              throw new Error(result.error);
            }
            toast.success("Email sent", { description: `Sent to ${draft.to.join(", ")}.` });
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
