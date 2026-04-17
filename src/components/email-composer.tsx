"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Loader2, Send, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export type EmailDraft = {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
};

export type EmailComposerProps = {
  title: string;
  subtitle?: string;
  initial: EmailDraft;
  onClose: () => void;
  onSend: (draft: EmailDraft) => Promise<void>;
  sendLabel?: string;
  sendingLabel?: string;
  helperText?: string;
  generateLabel?: string;
  onGenerate?: (current: EmailDraft) => Promise<string>;
  footerExtras?: ReactNode;
};

// Composable Gmail-backed editor. Handles To / CC / BCC / Subject / Body
// (plain text with preserved line breaks) + an optional "Generate with Claude"
// button that fills in the body from a parent-supplied generator.
export function EmailComposer({
  title,
  subtitle,
  initial,
  onClose,
  onSend,
  sendLabel = "Send",
  sendingLabel = "Sending…",
  helperText,
  generateLabel = "Generate with Claude",
  onGenerate,
  footerExtras,
}: EmailComposerProps) {
  const [to, setTo] = useState<string>(initial.to.join(", "));
  const [cc, setCc] = useState<string>(initial.cc.join(", "));
  const [bcc, setBcc] = useState<string>(initial.bcc.join(", "));
  const [showCcBcc, setShowCcBcc] = useState<boolean>(initial.cc.length > 0 || initial.bcc.length > 0);
  const [subject, setSubject] = useState<string>(initial.subject);
  const [body, setBody] = useState<string>(initial.body);
  const [err, setErr] = useState<string | null>(null);
  const [isSending, startSend] = useTransition();
  const [isGenerating, startGenerate] = useTransition();

  function parseList(raw: string): string[] {
    return raw
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function draftValue(): EmailDraft {
    return {
      to: parseList(to),
      cc: parseList(cc),
      bcc: parseList(bcc),
      subject: subject.trim(),
      body,
    };
  }

  function onGenerateClick() {
    if (!onGenerate) return;
    setErr(null);
    startGenerate(async () => {
      try {
        const text = await onGenerate(draftValue());
        setBody(text);
        toast.success("Draft generated", { description: "Edit before sending if needed." });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to generate draft.";
        setErr(msg);
        toast.error("Couldn't generate", { description: msg });
      }
    });
  }

  function onSendClick() {
    setErr(null);
    const draft = draftValue();
    if (draft.to.length === 0) {
      setErr("At least one recipient (To) is required.");
      return;
    }
    if (!draft.subject) {
      setErr("Subject is required.");
      return;
    }
    if (!draft.body.trim()) {
      setErr("Body is required.");
      return;
    }
    startSend(async () => {
      try {
        await onSend(draft);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Send failed.";
        setErr(msg);
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-4" onClick={onClose}>
      <div
        className="flex w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-white shadow-xl"
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

        <div className="flex flex-col gap-2 px-5 py-3 text-sm">
          <Row label="To">
            <Input value={to} onChange={setTo} placeholder="name@example.com, name2@example.com" />
          </Row>
          {showCcBcc ? (
            <>
              <Row label="Cc">
                <Input value={cc} onChange={setCc} placeholder="cc@example.com" />
              </Row>
              <Row label="Bcc">
                <Input value={bcc} onChange={setBcc} placeholder="bcc@example.com" />
              </Row>
            </>
          ) : (
            <div className="pl-16">
              <button
                type="button"
                onClick={() => setShowCcBcc(true)}
                className="text-xs font-medium text-brand-dark hover:underline"
              >
                Add Cc / Bcc
              </button>
            </div>
          )}
          <Row label="Subject">
            <Input value={subject} onChange={setSubject} placeholder="Subject" />
          </Row>
        </div>

        <div className="min-h-0 flex-1 px-5 pb-3">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={16}
            placeholder="Write your message, or click Generate with Claude below."
            className={cn(
              "w-full resize-vertical whitespace-pre-wrap rounded-lg border border-border bg-white px-3 py-2 font-sans text-sm leading-relaxed text-navy",
              "focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20",
            )}
          />
        </div>

        {helperText && <div className="px-5 pb-2 text-[11px] text-muted-foreground">{helperText}</div>}
        {err && <div className="mx-5 mb-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{err}</div>}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3">
          <div className="flex items-center gap-2">
            {onGenerate && (
              <button
                type="button"
                onClick={onGenerateClick}
                disabled={isGenerating || isSending}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-white px-3 py-2 text-xs font-semibold text-navy shadow-sm transition hover:border-brand/40 hover:text-brand-dark disabled:opacity-60"
              >
                {isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {generateLabel}
              </button>
            )}
            {footerExtras}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSending}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-3 py-2 text-xs font-medium text-navy-400 shadow-sm transition hover:text-navy disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSendClick}
              disabled={isSending}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
            >
              {isSending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> {sendingLabel}
                </>
              ) : (
                <>
                  <Send className="h-3.5 w-3.5" /> {sendLabel}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-14 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function Input({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-md border border-transparent bg-transparent px-0 py-1.5 text-sm text-navy placeholder:text-muted-foreground focus:border-brand focus:outline-none"
    />
  );
}
