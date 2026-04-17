"use client";

import { useState, type MouseEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { applyMergeFields } from "@/lib/merge-fields";
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
// can pick a saved template from the dropdown.
export function EmailLink({
  email,
  children,
  className,
  seed,
  subjectHint,
}: {
  email: string;
  children?: ReactNode;
  className?: string;
  seed?: ComposerSeed;
  subjectHint?: string;
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
            // Templates use merge-field tokens; at compose time we don't have
            // full context, so tokens are left intact if we can't resolve.
            // Best-effort: recipient-only tokens aren't useful here either.
            // We still pass through applyMergeFields with empty values so
            // resolved fields (none) don't leak placeholder text.
            const subject = applyMergeFields(t.subject, {});
            const body = applyMergeFields(t.body, {});
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
