"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, useTransition, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Clock, Loader2, Send, Sparkles, Variable, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
// Aliased: this file already has a local borderless `Input` (the chip-combo
// typeahead field). RectInput is the shared rect-frame form input.
import { Input as RectInput, Textarea } from "@/components/ui/input";
import { useSendLater } from "@/components/mail/send-later-popover";
import { formatScheduledTime } from "@/lib/timezone";
import { listActiveTemplates, type ActiveTemplateSummary } from "@/app/email/actions";
import { MERGE_FIELDS, applyMergeFields, htmlToReadableText, type MergeFieldValues } from "@/lib/merge-fields";
import type { RichTextBodyEditorHandle } from "@/components/rich-text-body-editor";
import { EditWithClaudeMenu, EditWithClaudeCustomPanel, type EditType } from "@/components/edit-with-claude-menu";
import { CLAUDE_PILL_CLASS } from "@/components/ui/button";
import { TEAM_BCC_OPTIONS } from "@/lib/team-contacts";

// Lazy-load the Tiptap editor — pulls in ProseMirror and pdfjs-sized helpers,
// so we keep it out of the initial bundle for every composer. Only composers
// that opt in via `richTextBody` pay the cost, and only when the modal opens.
const RichTextBodyEditor = dynamic(
  () => import("@/components/rich-text-body-editor").then((m) => m.RichTextBodyEditor),
  { ssr: false },
);

export type EmailDraft = {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  // When the composer is in rich-text mode, `body` holds HTML. Consumers that
  // need to preserve the rich structure end-to-end (submittal → Gmail html
  // alternative) should read this explicit field; text-mode consumers can
  // continue ignoring it and using `body` as the single string source.
  bodyHtml?: string;
  // Submittal-only: reflects the "Send candidate confirmation email"
  // checkbox when the composer is opened with showCandidateConfirmationToggle.
  // Undefined for composers that don't surface the toggle.
  sendCandidateConfirmation?: boolean;
};

export type ResolveTemplateFn = (template: ActiveTemplateSummary) => Promise<{ subject: string; body: string }> | { subject: string; body: string };

export type ContactOption = { id: string; name: string; email: string };

export type EmailComposerProps = {
  title: string;
  subtitle?: string;
  // Floating-stack mode. When `floatingZ` is provided the composer drops
  // its blocking `z-[200]` + dim backdrop and instead renders as a
  // non-blocking floating window at the supplied z-index, so it can sit
  // alongside another floating surface (the Find Matches panel) and the
  // two can be click-raised past each other. `onBringToFront` fires on
  // pointerdown so the parent's shared floating-z counter can raise this
  // composer. Omitting both keeps the default blocking centered modal —
  // every other caller is unaffected.
  floatingZ?: number;
  onBringToFront?: () => void;
  initial: EmailDraft;
  onClose: () => void;
  onSend: (draft: EmailDraft) => Promise<void>;
  // When provided, a "Send Later" button renders next to Send and opens a
  // date / time / timezone picker. The parent receives the same resolved
  // draft as onSend plus the chosen absolute instant (ISO UTC) and zone,
  // and is responsible for persisting it as a scheduled email. Throw to
  // surface an error and keep the picker open.
  onSendLater?: (
    draft: EmailDraft,
    scheduledSendAtISO: string,
    timezone: string,
  ) => Promise<void>;
  sendLabel?: string;
  sendingLabel?: string;
  // Optional "step backward" hook. When provided, a Back button
  // renders next to Cancel and clicking it calls this handler. Used
  // by the interview invite chain so the recruiter can return to the
  // previous composer (or the underlying Schedule modal) without
  // discarding the in-flight draft entirely.
  onBack?: () => void;
  backLabel?: string;
  helperText?: string;
  generateLabel?: string;
  onGenerate?: (current: EmailDraft) => Promise<string>;
  // When true, the toolbar shows an "Edit with Claude" dropdown next to
  // Generate. Disabled until the body has content. The dropdown's 5
  // options POST the current body + editType to /api/email/edit-with-
  // claude and replace the body with the response. Native Cmd+Z undo
  // works on the textarea path because we apply via execCommand.
  enableEditWithClaude?: boolean;
  // When set, "Generate with Claude" also auto-populates the subject line
  // with this string — but only if the subject field is currently empty.
  // Lets flows like the submittal composer hand recruiters a sendable
  // email in one click (body + subject) without overwriting any subject
  // the recruiter already typed or that a picked template applied. The
  // caller owns the format so the fallback stays in lock-step with what
  // the send path falls back to for empty-subject sends.
  generateFallbackSubject?: string;
  footerExtras?: ReactNode;
  // When enabled, the composer loads active templates and renders a
  // "Use Template" dropdown. Selecting one replaces subject + body with the
  // resolved output from resolveTemplate (or the raw template text if no
  // resolver is provided). Templates stay opt-in so the submittal flow can
  // scope to specific templates via resolveTemplate.
  showTemplatePicker?: boolean;
  resolveTemplate?: ResolveTemplateFn;
  templateFilter?: (t: ActiveTemplateSummary) => boolean;
  // When provided, the To / Cc text inputs are swapped for contact pickers:
  // To is a single-select dropdown, Cc is a multi-select chip list. Useful
  // for scoped flows (submittal) where recipients must come from a curated
  // client contact list.
  recipientOptions?: ContactOption[];
  // When provided, the To field becomes a multi-recipient pick-or-type chip
  // input (the same ContactComboMulti used for Cc/Bcc) seeded from these
  // options, instead of the single-select dropdown / plain text input. Lets
  // a recruiter add more than one To recipient (pick a contact or type an
  // address) on invite/submittal composers. Takes precedence over
  // recipientOptions for the To field only — Cc/Bcc are unaffected.
  toOptions?: ContactOption[];
  // When true, the To / Cc / Bcc row block is not rendered and the
  // "at least one recipient" validation is skipped. Used by the bulk-
  // email dialog where recipients are resolved server-side per
  // candidate, not from the composer's draft. Wins over
  // recipientOptions — if both are passed, the recipient block stays
  // hidden.
  hideRecipientFields?: boolean;
  // Calendar invites do not support all Gmail recipient buckets. These
  // flags let callers hide individual rows while keeping the normal To row.
  hideCcField?: boolean;
  hideBccField?: boolean;
  // When provided, Cc and Bcc become multi-select dropdowns (contacts +
  // free-text entry). Cc and Bcc are sourced separately because their
  // intent is different:
  //   Cc  = client contacts on the current job/interview's Client. The
  //         recruiter is openly looping the client team in.
  //   Bcc = Ace team members (currently Andrew + Austin, scales as the
  //         team grows). The recruiter is keeping ops/colleagues
  //         informed without exposing them to the recipient.
  // ccBccOptions is the legacy single-pool prop kept for back-compat;
  // when ccOptions / bccOptions are provided they take precedence.
  ccOptions?: ContactOption[];
  bccOptions?: ContactOption[];
  ccBccOptions?: ContactOption[];
  ccBccPinned?: ContactOption[];
  // When provided, the composer will run applyMergeFields on the final
  // subject + body right before calling onSend. Fixes the case where a
  // user inserts a merge token via "Insert Field" and then sends without
  // going through resolveTemplate (which is template-path-only). Leaving
  // unset keeps the send behavior literal.
  mergeValues?: MergeFieldValues;
  // Optional stable id for autosave. When set, the composer mirrors
  // subject + body into localStorage on every keystroke so a stray
  // browser select-all+Backspace, accidental modal close, or refresh
  // doesn't nuke a half-written email. On send success the entry is
  // cleared. Pass a key that's stable per intent (e.g.
  // `interview-invite-${interviewId}-${party}`) so distinct composers
  // don't collide.
  draftKey?: string;
  // Rendered in its own row above the Send / Cancel buttons. Used by the
  // submittal composer to surface the resume attachment picker, but
  // intentionally generic so other flows can reuse it.
  attachmentsSlot?: ReactNode;
  // When true, the Send button is disabled regardless of internal state.
  // Parent supplies the reason so the composer can surface it as the
  // button tooltip.
  sendDisabled?: boolean;
  sendDisabledReason?: string;
  // When true, Cmd/Ctrl+B and Cmd/Ctrl+U in the body textarea wrap the
  // current selection in `**…**` / `__…__` markers (unwraps if already
  // wrapped). The submittal send path converts these markers into real
  // <strong> / <u> tags on the Gmail draft. Opt-in per composer so
  // non-submittal flows keep the plain textarea behavior.
  bodyFormattingShortcuts?: boolean;
  // When true, the body is a Tiptap rich-text editor instead of a plain
  // textarea. Cmd/Ctrl+B and Cmd/Ctrl+U format the selection as real bold /
  // underline in the editor; onSend receives the rendered HTML in
  // EmailDraft.bodyHtml and a plain-text version in EmailDraft.body.
  // Mutually exclusive with bodyFormattingShortcuts (rich text has its own
  // keyboard handling) and with generator/template output that relies on
  // marker syntax — parents that enable this must hand the editor HTML via
  // the optional toEditorHtml prop below.
  richTextBody?: boolean;
  // Converts generator / template output (which arrives as marker-flavored
  // plain text like `**About Alice:**\n…`) into HTML the editor can set.
  // Only used when richTextBody is true. If unset the raw string is handed
  // to the editor as-is, which is fine for callers that already produce HTML.
  toEditorHtml?: (source: string) => string;
  // Declarative apply hook. When this prop's object identity changes the
  // composer syncs its subject + body to the new values. Bulk email uses
  // this to drive the composer's draft from its own template picker —
  // pass a fresh object each pick to retrigger. The composer's own
  // showTemplatePicker stays off in that flow.
  externalDraft?: { subject: string; body: string } | null;
  // When true, the composer renders a banner under the body listing any
  // unresolved candidate-shaped merge tokens (e.g. [Candidate First Name]
  // or {{candidate.first_name}}) and notes that they'll be filled per
  // recipient at send time. Opt-in so non-bulk callers (submittal,
  // interview invite) stay unchanged.
  perRecipientCandidateHint?: boolean;
  // Submittal-only: when true, a "Send candidate confirmation email"
  // checkbox renders below the body and above the toolbar row (default
  // checked). Its state flows to onSend via draft.sendCandidateConfirmation
  // so the caller can suppress the post-send candidate confirmation for
  // this one send.
  showCandidateConfirmationToggle?: boolean;
};

// Composable Gmail-backed editor. Handles To / CC / BCC / Subject / Body
// (plain text with preserved line breaks) + an optional "Generate with Claude"
// button that fills in the body from a parent-supplied generator.
export function EmailComposer({
  title,
  subtitle,
  floatingZ,
  onBringToFront,
  initial,
  onClose,
  onSend,
  onSendLater,
  sendLabel = "Send",
  sendingLabel = "Sending…",
  onBack,
  backLabel = "Back",
  helperText,
  generateLabel = "Generate with Claude",
  onGenerate,
  enableEditWithClaude = false,
  generateFallbackSubject,
  footerExtras,
  showTemplatePicker = false,
  resolveTemplate,
  templateFilter,
  recipientOptions,
  toOptions,
  hideRecipientFields = false,
  hideCcField = false,
  hideBccField = false,
  ccOptions,
  bccOptions,
  ccBccOptions,
  ccBccPinned,
  mergeValues,
  draftKey,
  attachmentsSlot,
  sendDisabled = false,
  sendDisabledReason,
  bodyFormattingShortcuts = false,
  richTextBody = false,
  toEditorHtml,
  externalDraft,
  perRecipientCandidateHint = false,
  showCandidateConfirmationToggle = false,
}: EmailComposerProps) {
  // Resolve effective Cc / Bcc option pools. Explicit ccOptions/bccOptions
  // win over the legacy combined ccBccOptions. The BCC pool is always
  // unioned with Andrew's hardcoded teammate roster (Austin) so the
  // recruiter can BCC him on any email from any composer entry point
  // — submittal, interview invite, ad-hoc — without depending on the
  // caller wiring teammates through manually.
  const showCcField = !hideCcField;
  const showBccField = !hideBccField;
  const effectiveCcOptions = showCcField ? (ccOptions ?? ccBccOptions) : undefined;
  const baseBccOptions = showBccField ? (bccOptions ?? ccBccOptions ?? []) : [];
  const effectiveBccOptions = showBccField
    ? mergeContactOptionsByEmail(
        baseBccOptions,
        BCC_TEAMMATE_OPTIONS,
      )
    : [];
  const addCcBccLabel =
    showCcField && showBccField ? "Add Cc / Bcc" : showCcField ? "Add Cc" : "Add Bcc";
  // Read any saved draft for this draftKey BEFORE seeding state so the
  // restored values render on first paint — no flash of the seed body
  // and no race between the state setter and the localStorage read.
  // Defensive: localStorage isn't available during SSR; useState's lazy
  // initializer runs client-side only.
  const stored = useMemo(() => readDraft(draftKey), [draftKey]);
  const [to, setTo] = useState<string>(initial.to.join(", "));
  const [cc, setCc] = useState<string>(initial.cc.join(", "));
  const [bcc, setBcc] = useState<string>(initial.bcc.join(", "));
  const [showCcBcc, setShowCcBcc] = useState<boolean>(
    (showCcField && initial.cc.length > 0) ||
      (showBccField && initial.bcc.length > 0) ||
      Boolean(effectiveCcOptions && effectiveCcOptions.length > 0) ||
      Boolean(showBccField && effectiveBccOptions.length > 0),
  );
  const [subject, setSubject] = useState<string>(stored?.subject ?? initial.subject);
  const [body, setBody] = useState<string>(stored?.body ?? initial.body);
  const [showRestored, setShowRestored] = useState<boolean>(Boolean(stored));
  const [err, setErr] = useState<string | null>(null);
  // Send is gated only on a recipient + a subject. Body is optional - a
  // hand-typed submittal sends without ever clicking Generate, and an
  // empty body never blocks send. No other condition gates Send.
  const canSend =
    (hideRecipientFields || to.trim().length > 0) && subject.trim().length > 0;
  const [isSending, startSend] = useTransition();
  const [isGenerating, startGenerate] = useTransition();
  const [isEditing, startEdit] = useTransition();
  // Custom edit-with-Claude inline panel. Opens when the recruiter picks
  // "Custom…" from the Edit-with-Claude dropdown; the instruction is
  // POSTed alongside the current body so Claude rewrites in place.
  const [customEditOpen, setCustomEditOpen] = useState(false);
  const [customInstruction, setCustomInstruction] = useState("");
  // "Send candidate confirmation email" checkbox state. Default on so the
  // post-submittal confirmation fires unless the recruiter opts out for
  // this send. Only surfaced when showCandidateConfirmationToggle is set.
  const [sendCandidateConfirmation, setSendCandidateConfirmation] = useState(true);

  // Mirror every keystroke into localStorage when a draftKey is set.
  // Cheap (string write) and synchronous so we never race a wipe.
  useEffect(() => {
    if (!draftKey) return;
    writeDraft(draftKey, { subject, body });
  }, [draftKey, subject, body]);

  // Sync from a parent-supplied draft (bulk email's local template
  // picker). Fires when externalDraft's object identity changes — the
  // parent passes a fresh object on every pick so re-picking the same
  // template still reapplies.
  useEffect(() => {
    if (!externalDraft) return;
    setSubject(externalDraft.subject);
    setBody(externalDraft.body);
    if (richTextBody) {
      const html = toEditorHtml ? toEditorHtml(externalDraft.body) : externalDraft.body;
      richTextRef.current?.setHtml(html);
    }
  }, [externalDraft, richTextBody, toEditorHtml]);

  const [templates, setTemplates] = useState<ActiveTemplateSummary[]>([]);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [isApplying, startApply] = useTransition();

  // Insert Field: tracks which control the cursor was last in so "Insert
  // Field" knows whether to splice into the subject or the body. We also
  // remember the caret/selection position since opening the dropdown
  // (which triggers blur) would otherwise lose it.
  const subjectRef = useRef<HTMLInputElement | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  // Imperative handle on the Tiptap editor when richTextBody is true. Lets
  // Insert Field splice a merge token at the caret via the editor's command
  // chain instead of the textarea's substring manipulation.
  const richTextRef = useRef<RichTextBodyEditorHandle | null>(null);
  const [lastFocus, setLastFocus] = useState<"subject" | "body">("body");
  const lastCaretRef = useRef<{ start: number; end: number } | null>(null);
  const [fieldOpen, setFieldOpen] = useState(false);

  function rememberCaret(el: HTMLInputElement | HTMLTextAreaElement) {
    lastCaretRef.current = {
      start: el.selectionStart ?? el.value.length,
      end: el.selectionEnd ?? el.value.length,
    };
  }

  // Toggle the given marker around the body's current selection (or around
  // the word at the caret if no selection exists). Used by Cmd/Ctrl+B and
  // Cmd/Ctrl+U when bodyFormattingShortcuts is on. If the selection is
  // already wrapped in the marker we unwrap instead of double-wrapping.
  function toggleBodyMarker(marker: string) {
    const el = bodyRef.current;
    if (!el) return;
    const value = el.value;
    let start = el.selectionStart ?? value.length;
    let end = el.selectionEnd ?? value.length;
    if (start === end) {
      // No selection — expand to the nearest word so Cmd+B on a caret
      // still does something useful instead of dropping empty markers.
      let ws = start;
      let we = end;
      while (ws > 0 && !/\s/.test(value[ws - 1]!)) ws--;
      while (we < value.length && !/\s/.test(value[we]!)) we++;
      if (ws === we) return;
      start = ws;
      end = we;
    }
    const before = value.slice(0, start);
    const selected = value.slice(start, end);
    const after = value.slice(end);
    const m = marker;
    const alreadyWrapped =
      selected.startsWith(m) &&
      selected.endsWith(m) &&
      selected.length >= 2 * m.length;
    const inner = alreadyWrapped ? selected.slice(m.length, -m.length) : `${m}${selected}${m}`;
    const next = before + inner + after;
    setBody(next);
    const nextEnd = before.length + inner.length;
    const nextStart = before.length;
    requestAnimationFrame(() => {
      el.focus();
      try {
        el.setSelectionRange(nextStart, nextEnd);
      } catch {
        // Some browsers reject selection ranges on hidden elements; ignore.
      }
      lastCaretRef.current = { start: nextStart, end: nextEnd };
    });
  }

  function onBodyKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (!bodyFormattingShortcuts) return;
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    if (e.key === "b" || e.key === "B") {
      e.preventDefault();
      toggleBodyMarker("**");
    } else if (e.key === "u" || e.key === "U") {
      e.preventDefault();
      toggleBodyMarker("__");
    }
  }

  function insertMergeToken(token: string) {
    setFieldOpen(false);
    // Rich-text body + the body is the focused target → use the editor's
    // command chain so the token splices in at the ProseMirror selection and
    // the surrounding formatting stays intact.
    if (richTextBody && lastFocus === "body" && richTextRef.current) {
      richTextRef.current.insertPlainText(token);
      return;
    }
    const targetRef = lastFocus === "subject" ? subjectRef : bodyRef;
    const el = targetRef.current;
    if (!el) {
      // Ref not mounted yet — fall back to append.
      if (lastFocus === "subject") setSubject((prev) => prev + token);
      else setBody((prev) => prev + token);
      return;
    }
    const start = lastCaretRef.current?.start ?? el.value.length;
    const end = lastCaretRef.current?.end ?? el.value.length;
    const next = el.value.slice(0, start) + token + el.value.slice(end);
    if (lastFocus === "subject") setSubject(next);
    else setBody(next);
    const pos = start + token.length;
    requestAnimationFrame(() => {
      el.focus();
      try {
        el.setSelectionRange(pos, pos);
      } catch {
        // Some input types reject selection ranges; ignore.
      }
      lastCaretRef.current = { start: pos, end: pos };
    });
  }

  // Load templates once when the picker is first opened. Intentionally
  // omits templateFilter from deps: an inline filter prop is recreated
  // every render, which would cancel + restart this effect on every
  // re-render and leave the dropdown stuck on "Loading…". The filter
  // is applied at render time via visibleTemplates below.
  useEffect(() => {
    if (!showTemplatePicker || templatesLoaded) return;
    let cancelled = false;
    const timeoutId = setTimeout(() => {
      if (cancelled) return;
      setTemplatesError("Couldn't load templates");
      setTemplatesLoaded(true);
    }, 5000);
    listActiveTemplates()
      .then((list) => {
        if (cancelled) return;
        clearTimeout(timeoutId);
        setTemplates(list);
        setTemplatesError(null);
        setTemplatesLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        clearTimeout(timeoutId);
        setTemplatesError("Couldn't load templates");
        setTemplatesLoaded(true);
      });
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [showTemplatePicker, templatesLoaded]);

  const visibleTemplates = useMemo(
    () => (templateFilter ? templates.filter(templateFilter) : templates),
    [templates, templateFilter],
  );

  // Bulk-email helper: scan the current subject + body for candidate-shaped
  // merge tokens that bulkSendEmail will resolve per recipient on the
  // server. Used only when the caller opts in via perRecipientCandidateHint
  // — gives the recruiter the same visual reassurance the /mail composer
  // provides for unresolved fields, without changing the existing
  // composer behavior for submittal or interview-invite callers.
  const perRecipientTokens = useMemo<string[]>(() => {
    if (!perRecipientCandidateHint) return [];
    const haystack = `${subject}\n${body}`;
    const brackets = haystack.match(/\[Candidate [^\]\n]+\]/g) ?? [];
    const braces = haystack.match(/\{\{candidate\.[a-zA-Z0-9_]+\}\}/g) ?? [];
    return Array.from(new Set([...brackets, ...braces]));
  }, [perRecipientCandidateHint, subject, body]);

  function onPickTemplate(tpl: ActiveTemplateSummary) {
    // Defensive shape guard. A malformed template object (missing
    // id / subject / body) would either spin the transition forever
    // or throw a TypeError deep inside resolveTemplate that's hard
    // to attribute. Toast and bail cleanly so the recruiter sees
    // what's wrong instead of an infinite Use Template spinner.
    if (
      !tpl ||
      typeof tpl.id !== "string" ||
      typeof tpl.subject !== "string" ||
      typeof tpl.body !== "string"
    ) {
      toast.error("Couldn't apply template", {
        description: "Template data is incomplete.",
      });
      setTemplateOpen(false);
      return;
    }
    setTemplateOpen(false);
    setErr(null);
    startApply(async () => {
      try {
        const resolved = resolveTemplate ? await resolveTemplate(tpl) : { subject: tpl.subject, body: tpl.body };
        if (!subject.trim() || confirmReplace(subject, resolved.subject)) setSubject(resolved.subject);
        // Templates come in as marker-flavored text; for rich text mode we run
        // them through the caller-supplied HTML converter so the editor can
        // render bold/underline immediately. Text-mode callers keep the raw
        // string so the existing markdown-marker pipeline still works.
        // Rich-text callers convert to editor HTML; plain-text callers
        // flatten any HTML template body to readable text so a bolded
        // template never drops raw <strong> tags into a plain textarea.
        const incomingBody = richTextBody && toEditorHtml
          ? toEditorHtml(resolved.body)
          : htmlToReadableText(resolved.body);
        if (!body.trim() || confirmReplace(body, incomingBody)) setBody(incomingBody);
        toast.success("Template applied", { description: tpl.name });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to apply template.";
        setErr(msg);
        toast.error("Couldn't apply template", { description: msg });
      }
    });
  }

  function parseList(raw: string): string[] {
    return raw
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function draftValue(): EmailDraft {
    return {
      to: parseList(to),
      cc: showCcField ? parseList(cc) : [],
      bcc: showBccField ? parseList(bcc) : [],
      subject: subject.trim(),
      // In rich-text mode the `body` state IS the HTML Tiptap emits. We
      // expose it through both fields so callers that want HTML explicitly
      // (`bodyHtml`) and callers that want a single body string stay
      // consistent. Text-mode callers keep `bodyHtml` undefined.
      body,
      ...(richTextBody ? { bodyHtml: body } : {}),
      ...(showCandidateConfirmationToggle ? { sendCandidateConfirmation } : {}),
    };
  }

  // Replace the textarea contents while routing through execCommand so
  // the change lands in the browser's native undo stack. Falls back to
  // setBody if execCommand is unsupported (some embedded WebViews) — in
  // that fallback path Cmd+Z won't restore, but the edit still applies.
  function applyEditedBodyToTextarea(newBody: string) {
    const el = bodyRef.current;
    if (!el) {
      setBody(newBody);
      return;
    }
    el.focus();
    el.select();
    const ok = document.execCommand("insertText", false, newBody);
    if (!ok) {
      setBody(newBody);
    }
  }

  function onEditClick(editType: EditType) {
    if (editType === "custom") {
      // Open the inline instruction panel; the API call fires from
      // runCustomEdit once the recruiter hits Run.
      if (!body.trim()) return;
      setErr(null);
      setCustomEditOpen(true);
      return;
    }
    runEdit({ editType });
  }

  function runCustomEdit() {
    const instruction = customInstruction.trim();
    if (!instruction || !body.trim()) return;
    runEdit({ editType: "custom", customInstruction: instruction });
  }

  function runEdit(opts: { editType: EditType; customInstruction?: string }) {
    if (!body.trim()) return;
    setErr(null);
    startEdit(async () => {
      try {
        const res = await fetch("/api/email/edit-with-claude", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            body,
            editType: opts.editType,
            format: richTextBody ? "html" : "text",
            ...(opts.customInstruction
              ? { customInstruction: opts.customInstruction }
              : {}),
          }),
          cache: "no-store",
        });
        const json = (await res.json().catch(() => null)) as
          | { body?: string; error?: string }
          | null;
        if (!res.ok) {
          const msg = json?.error ?? `Edit failed (${res.status})`;
          throw new Error(msg);
        }
        const next = (json?.body ?? "").trim();
        if (!next) throw new Error("Claude returned an empty edit.");
        if (richTextBody) {
          // Route through the Tiptap chain so the swap is recorded to
          // ProseMirror's history — Cmd+Z then undoes the AI edit and
          // restores the user's original draft.
          if (richTextRef.current) {
            richTextRef.current.replaceWithUndo(next);
          } else {
            setBody(next);
          }
        } else {
          applyEditedBodyToTextarea(next);
        }
        if (opts.editType === "custom") {
          setCustomEditOpen(false);
          setCustomInstruction("");
        }
        toast.success("Draft revised", { description: "Cmd+Z to restore your original." });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to edit draft.";
        setErr(msg);
        toast.error("Couldn't edit draft", { description: msg });
      }
    });
  }

  function onGenerateClick() {
    if (!onGenerate) return;
    setErr(null);
    startGenerate(async () => {
      try {
        const text = await onGenerate(draftValue());
        // Defensive — reject anything that isn't a clean string. If a server
        // action got middleware-redirected to a sign-in/error HTML response,
        // it can reach us as HTML-ish content that should not land in the body.
        if (typeof text !== "string") {
          throw new Error("Generator returned a non-string response.");
        }
        if (/^<!DOCTYPE|^<html|<script\b|__next_f\.push\(/i.test(text.slice(0, 1000))) {
          throw new Error("Generator returned a page instead of text. Reload the tab and try again. Your session may have expired.");
        }
        // Generator output is marker-flavored plain text. In rich text mode
        // the editor needs HTML, so run it through the caller-supplied
        // converter before setBody — Tiptap will render bold headers and
        // dash bullets as real formatting.
        const nextBody = richTextBody && toEditorHtml ? toEditorHtml(text) : text;
        setBody(nextBody);
        // Auto-populate the subject when the caller supplied a fallback and
        // the recruiter hasn't typed (or template-picked) one yet. Mirrors
        // the empty-subject substitution on the send path so a single
        // Generate click yields a fully sendable email. Functional setter so
        // the empty-check reads the live subject — not the closure captured
        // when onGenerateClick was created, which could be stale by the time
        // the await resolves (e.g. a template apply or hand-typed character
        // landed in between). Whitespace-only counts as empty so a stray
        // space doesn't block the fill.
        if (generateFallbackSubject) {
          // Temp diagnostic logging — confirms the empty-subject auto-fill
          // path is reached and the value is the one the caller passed.
          // Gated on generateFallbackSubject so only the submittal flow
          // (the one that wires this prop) emits. Remove once Andrew has
          // confirmed the Ace-native submittal subject populates in prod.
          //   [submittal-subject-diag] tag for easy grep / DevTools filter.
          // eslint-disable-next-line no-console
          console.log(
            "[submittal-subject-diag] before setSubject — currentSubject=",
            JSON.stringify(subject),
            "fallback=",
            JSON.stringify(generateFallbackSubject),
          );
          setSubject((prev) => {
            const next = prev.trim().length === 0 ? generateFallbackSubject : prev;
            // eslint-disable-next-line no-console
            console.log(
              "[submittal-subject-diag] after setSubject — prev=",
              JSON.stringify(prev),
              "next=",
              JSON.stringify(next),
              "wouldFill=",
              prev.trim().length === 0,
            );
            return next;
          });
        }
        toast.success("Draft generated", { description: "Edit before sending if needed." });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to generate draft.";
        setErr(msg);
        toast.error("Couldn't generate", { description: msg });
      }
    });
  }

  // Shared validation + merge resolution for both Send and Send Later.
  // Returns the resolved draft, or null after setting the inline error.
  function buildFinalDraft(): EmailDraft | null {
    setErr(null);
    const draft = draftValue();
    if (!hideRecipientFields && draft.to.length === 0) {
      setErr("At least one recipient (To) is required.");
      return null;
    }
    if (!draft.subject) {
      setErr("Subject is required.");
      return null;
    }
    // If the caller provided merge values, resolve any leftover tokens
    // (e.g. ones the user inserted via "Insert Field" without going through
    // resolveTemplate). Fields with no value resolve to empty strings so
    // nothing literal like "[Client Company Website]" ships in the send.
    const finalDraft: EmailDraft = mergeValues
      ? {
          ...draft,
          subject: applyMergeFields(draft.subject, mergeValues),
          body: applyMergeFields(draft.body, mergeValues),
        }
      : draft;
    if (mergeValues) {
      // Browser-console audit so we can diagnose "field X didn't render"
      // reports without redeploying.
      const remaining = finalDraft.body.match(/\[[A-Z][A-Za-z ]+\]/g) ?? [];
      const blanks = Object.entries(mergeValues)
        .filter(([, v]) => v == null || (typeof v === "string" && v.trim() === ""))
        .map(([k]) => k);
      // eslint-disable-next-line no-console
      console.log("[EmailComposer] resolved merge fields", {
        bodyBefore: draft.body.slice(0, 400),
        bodyAfter: finalDraft.body.slice(0, 400),
        unresolvedTokensInBody: remaining,
        blankMergeKeys: blanks,
      });
    }
    return finalDraft;
  }

  // Send Later: resolve the same draft Send would, hand it to the parent's
  // onSendLater with the picked instant + zone. Throws so the picker keeps
  // itself open and shows the error.
  async function onSendLaterConfirm(
    scheduledSendAtISO: string,
    timezone: string,
  ) {
    if (!onSendLater) return;
    const finalDraft = buildFinalDraft();
    if (!finalDraft) {
      throw new Error("Fix the highlighted fields first.");
    }
    await onSendLater(finalDraft, scheduledSendAtISO, timezone);
    clearDraft(draftKey);
    toast.success(
      `Scheduled for ${formatScheduledTime(scheduledSendAtISO, timezone)}`,
    );
  }

  function onSendClick() {
    const finalDraft = buildFinalDraft();
    if (!finalDraft) return;
    startSend(async () => {
      try {
        await onSend(finalDraft);
        // Sent successfully — drop the local-storage backup so the
        // composer doesn't silently restore an obsolete draft the
        // next time the same intent is opened.
        clearDraft(draftKey);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Send failed.";
        setErr(msg);
      }
    });
  }

  function discardRestoredDraft() {
    setSubject(initial.subject);
    setBody(initial.body);
    setShowRestored(false);
    clearDraft(draftKey);
  }

  // Send Later picker, anchored to the footer's Send Later button. The
  // hook is always called for stable hook order; the button only renders
  // when the parent supplied onSendLater.
  const sendLater = useSendLater(onSendLaterConfirm);

  // Portal to document.body so the composer overlay escapes the
  // caller's React tree. Without the portal, ancestor stacking
  // contexts / containing blocks (backdrop-filter, transform, contain)
  // can trap `fixed inset-0` inside the page layout — the visible
  // symptom is the app shell (sidebar / topbar) bleeding through the
  // overlay because the backdrop no longer covers the full viewport.
  // Guard SSR with typeof document === "undefined".
  if (typeof document === "undefined") return null;
  // Floating mode (Find Matches): no dim backdrop and pointer-events pass
  // through the wrapper so the Find Matches panel underneath stays
  // clickable; the modal box itself stays interactive and raises its
  // shared z on pointerdown. Default mode: the blocking z-[200] dim modal
  // every other caller relies on (unchanged).
  const isFloating = floatingZ != null;
  return createPortal(
    // Backdrop has NO close handlers. A recruiter selecting text in the body
    // who drags past the panel boundary used to trigger the backdrop's
    // onClick={onClose} via the mouseup landing on the backdrop (whose click
    // target is the common ancestor of mousedown + mouseup). Closing on that
    // path destroyed half-written submittal drafts with no undo. Dismissal is
    // explicit only: the header X button or the footer Cancel button.
    <div
      style={isFloating ? { zIndex: floatingZ } : undefined}
      className={
        isFloating
          ? "pointer-events-none fixed inset-0 flex items-center justify-center p-4"
          : "fixed inset-0 z-[200] flex items-center justify-center bg-ink/40 p-4"
      }
    >
      <div
        onPointerDown={isFloating ? onBringToFront : undefined}
        className={cn(
          "flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-xl",
          isFloating && "pointer-events-auto",
        )}
      >

        <div className="flex shrink-0 items-start justify-between border-b border-court-border px-5 py-3">
          <div>
            <h2 className="font-serif text-lg font-semibold text-court-fg">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-court-fg-muted">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-court-fg-muted hover:bg-court-surface-subtle">
            <X className="h-4 w-4" />
          </button>
        </div>

        {showRestored && (
          <div className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-5 py-2 text-xs text-amber-900">
            <span>
              Restored an unsent draft from your last session. Edit and send, or discard to start fresh.
            </span>
            <button
              type="button"
              onClick={discardRestoredDraft}
              className="rounded-md border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-amber-900 hover:bg-amber-100"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Scrollable middle: To/Cc/Bcc/Subject + body + attachments scroll
            here while the header above and the footer below stay pinned, so
            a long generated submittal never pushes Send off screen. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="flex flex-col gap-2 px-5 py-3 text-sm">
          {hideRecipientFields ? null : recipientOptions ? (
            <>
              <Row label="To">
                {/* To is always a multi-recipient pick-or-type chip input
                    (the same ContactComboMulti used for Cc/Bcc) so the
                    recruiter can add more than one To recipient without
                    being forced into Cc. Seeds from toOptions when given,
                    otherwise falls back to the curated recipientOptions
                    pool; free-typed addresses are always allowed. */}
                <ContactComboMulti
                  value={to}
                  onChange={setTo}
                  options={toOptions ?? recipientOptions}
                  placeholder="Pick a contact or type an email…"
                />
              </Row>
              {showCcField && (
                <Row label="Cc">
                  <ContactMultiPicker value={cc} onChange={setCc} options={recipientOptions} />
                </Row>
              )}
              {showBccField && (
                <Row label="Bcc">
                  {effectiveBccOptions && effectiveBccOptions.length > 0 ? (
                    <ContactComboMulti
                      value={bcc}
                      onChange={setBcc}
                      options={effectiveBccOptions}
                      pinned={ccBccPinned}
                    />
                  ) : (
                    <Input value={bcc} onChange={setBcc} />
                  )}
                </Row>
              )}
            </>
          ) : (
            <>
              <Row label="To">
                {/* To is always a multi-recipient pick-or-type chip input
                    (same ContactComboMulti as Cc/Bcc). With no curated
                    pool the dropdown is empty but the recruiter can still
                    type any number of addresses as chips. */}
                <ContactComboMulti
                  value={to}
                  onChange={setTo}
                  options={toOptions ?? []}
                  placeholder="Pick a contact or type an email…"
                />
              </Row>
              {showCcBcc ? (
                <>
                  {showCcField && (
                    <Row label="Cc">
                      {effectiveCcOptions && effectiveCcOptions.length > 0 ? (
                        <ContactComboMulti
                          value={cc}
                          onChange={setCc}
                          options={effectiveCcOptions}
                          pinned={ccBccPinned}
                        />
                      ) : (
                        <Input value={cc} onChange={setCc} />
                      )}
                    </Row>
                  )}
                  {showBccField && (
                    <Row label="Bcc">
                      {effectiveBccOptions && effectiveBccOptions.length > 0 ? (
                        <ContactComboMulti
                          value={bcc}
                          onChange={setBcc}
                          options={effectiveBccOptions}
                          pinned={ccBccPinned}
                        />
                      ) : (
                        <Input value={bcc} onChange={setBcc} />
                      )}
                    </Row>
                  )}
                </>
              ) : showCcField || showBccField ? (
                <div className="pl-16">
                  <button
                    type="button"
                    onClick={() => setShowCcBcc(true)}
                    className="text-xs font-medium text-brand-dark hover:underline"
                  >
                    {addCcBccLabel}
                  </button>
                </div>
              ) : null}
            </>
          )}
          <Row label="Subject">
            <RectInput
              ref={subjectRef}
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              onFocus={(e) => {
                setLastFocus("subject");
                rememberCaret(e.currentTarget);
              }}
              onSelect={(e) => rememberCaret(e.currentTarget)}
              onKeyUp={(e) => rememberCaret(e.currentTarget)}
              onClick={(e) => rememberCaret(e.currentTarget)}
            />
          </Row>
        </div>

        <div className="min-h-0 flex-1 px-5 pb-3">
          {richTextBody ? (
            <div
              onFocus={() => setLastFocus("body")}
              onClick={() => setLastFocus("body")}
            >
              <RichTextBodyEditor
                ref={richTextRef}
                initialHtml={body}
                value={body}
                onChange={(html) => setBody(html)}
                placeholder="Write your message, or click Generate with Claude below."
              />
            </div>
          ) : (
            <Textarea
              ref={bodyRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onFocus={(e) => {
                setLastFocus("body");
                rememberCaret(e.currentTarget);
              }}
              onSelect={(e) => rememberCaret(e.currentTarget)}
              onKeyDown={onBodyKeyDown}
              onKeyUp={(e) => rememberCaret(e.currentTarget)}
              onClick={(e) => rememberCaret(e.currentTarget)}
              rows={16}
              placeholder="Write your message, or click Generate with Claude below."
              className="resize-vertical whitespace-pre-wrap font-sans leading-relaxed"
            />
          )}
        </div>

        {perRecipientCandidateHint && perRecipientTokens.length > 0 && (
          <div className="mx-5 mb-2 rounded-md border border-court-border/60 bg-court-surface-subtle/60 px-3 py-2 text-[11px] text-court-fg">
            <span className="font-medium text-court-fg-muted">
              These candidate fields will be filled per recipient at send time:
            </span>{" "}
            {perRecipientTokens.map((tag, i) => (
              <span key={tag}>
                <code className="rounded bg-court-surface px-1 py-0.5 font-mono text-[10px] text-court-fg">
                  {tag}
                </code>
                {i < perRecipientTokens.length - 1 ? " " : ""}
              </span>
            ))}
          </div>
        )}
        {helperText && <div className="px-5 pb-2 text-[11px] text-court-fg-muted">{helperText}</div>}
        {err && <div className="mx-5 mb-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{err}</div>}

        {attachmentsSlot && (
          <div className="border-t border-court-border px-5 py-3">{attachmentsSlot}</div>
        )}

        {customEditOpen && (
          <EditWithClaudeCustomPanel
            value={customInstruction}
            onChange={setCustomInstruction}
            onRun={runCustomEdit}
            onCancel={() => {
              setCustomEditOpen(false);
              setCustomInstruction("");
            }}
            isRunning={isEditing}
          />
        )}

        {showCandidateConfirmationToggle && (
          <div className="border-t border-court-border px-5 py-3">
            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-court-border/40 bg-court-surface-subtle/30 px-3 py-2 text-xs">
              <input
                type="checkbox"
                checked={sendCandidateConfirmation}
                onChange={(e) => setSendCandidateConfirmation(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 rounded border-court-border text-brand focus:ring-brand/30"
              />
              <span className="flex-1">
                <span className="font-semibold text-court-fg">Send candidate confirmation email</span>
                <span className="block text-court-fg-muted">
                  Automatically sends the candidate a submission confirmation after this email goes out.
                </span>
              </span>
            </label>
          </div>
        )}

        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-court-border px-5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            {showTemplatePicker && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setTemplateOpen((v) => !v)}
                  disabled={isApplying || isSending || isGenerating}
                  className="inline-flex items-center gap-1.5 rounded-md border border-court-border bg-court-surface px-3 py-2 text-xs font-semibold text-court-fg shadow-sm transition hover:border-brand/40 hover:text-brand-dark disabled:opacity-60"
                >
                  {isApplying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  Use Template
                </button>
                {templateOpen && (
                  <>
                    <div className="fixed inset-0 z-[60]" onClick={() => setTemplateOpen(false)} />
                    {/* z-[70] above the z-[60] dismiss overlay so the
                        template list is scrollable + clickable (same
                        fix as the Insert Field dropdown). */}
                    <div className="absolute bottom-full left-0 z-[70] mb-1 w-80 overflow-hidden rounded-lg border border-court-border bg-court-surface shadow-lg">
                      <ul className="max-h-80 overflow-y-auto py-1 text-sm">
                        {!templatesLoaded && (
                          <li className="px-3 py-2 text-xs text-court-fg-muted">Loading templates…</li>
                        )}
                        {templatesLoaded && templatesError && (
                          <li className="px-3 py-2 text-xs text-court-fg-muted">{templatesError}.</li>
                        )}
                        {templatesLoaded && !templatesError && visibleTemplates.length === 0 && (
                          <li className="px-3 py-2 text-xs text-court-fg-muted">No active templates.</li>
                        )}
                        {visibleTemplates.map((t) => (
                          <li key={t.id}>
                            <button
                              type="button"
                              onClick={() => onPickTemplate(t)}
                              className="flex w-full flex-col gap-0.5 px-3 py-1.5 text-left text-court-fg hover:bg-court-brand-tint"
                            >
                              <span className="font-medium">{t.name}</span>
                              <span className="truncate text-[11px] text-court-fg-muted">{t.subject}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </>
                )}
              </div>
            )}
            <div className="relative">
              <button
                type="button"
                onMouseDown={(e) => {
                  // Prevent the button from stealing focus; we need the last
                  // focused input/textarea to retain its caret so the token
                  // splices in at the right spot.
                  e.preventDefault();
                }}
                onClick={() => setFieldOpen((v) => !v)}
                disabled={isSending || isGenerating}
                className="inline-flex items-center gap-1.5 rounded-md border border-court-border bg-court-surface px-3 py-2 text-xs font-semibold text-court-fg shadow-sm transition hover:border-brand/40 hover:text-brand-dark disabled:opacity-60"
                title={`Insert a merge field into the ${lastFocus}`}
              >
                <Variable className="h-3.5 w-3.5" /> Insert Field
              </button>
              {fieldOpen && (
                <>
                  <div className="fixed inset-0 z-[60]" onClick={() => setFieldOpen(false)} />
                  {/* z-[70] puts the panel ABOVE the z-[60] dismiss
                      overlay so the list is both scrollable and clickable.
                      Previously at z-40 the overlay intercepted every
                      click that landed on a field button, and wheel
                      scroll events were captured by the overlay too. */}
                  <div className="absolute bottom-full left-0 z-[70] mb-1 w-80 overflow-hidden rounded-lg border border-court-border bg-court-surface shadow-lg">
                    <div className="border-b border-court-border bg-court-surface-subtle/40 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
                      Inserts into {lastFocus}
                    </div>
                    <ul className="max-h-80 overflow-y-auto py-1 text-sm">
                      {groupedMergeFields().map(({ group, items }) => (
                        <li key={group}>
                          <div className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
                            {group}
                          </div>
                          {items.map((f) => (
                            <button
                              key={f.token}
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => insertMergeToken(f.token)}
                              className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs text-court-fg hover:bg-court-brand-tint"
                            >
                              <span>{f.label}</span>
                              <code className="rounded bg-court-surface-subtle px-1 py-0.5 text-[10px] text-court-fg-muted">
                                {f.token}
                              </code>
                            </button>
                          ))}
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}
            </div>
            {onGenerate && (
              <button
                type="button"
                onClick={onGenerateClick}
                disabled={isGenerating || isSending || isEditing}
                className={CLAUDE_PILL_CLASS}
              >
                {isGenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                {generateLabel}
              </button>
            )}
            {enableEditWithClaude && (
              <EditWithClaudeMenu
                isEditing={isEditing}
                disabled={!body.trim() || isGenerating || isSending}
                onPick={onEditClick}
              />
            )}
            {footerExtras}
          </div>
          <div className="flex items-center gap-2">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                disabled={isSending}
                className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-3 py-2 text-xs font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg disabled:opacity-60"
              >
                ← {backLabel}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              disabled={isSending}
              className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-3 py-2 text-xs font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg disabled:opacity-60"
            >
              Cancel
            </button>
            {onSendLater && (
              <button
                type="button"
                ref={sendLater.triggerRef}
                onClick={() => sendLater.setOpen(true)}
                disabled={isSending || sendDisabled || !canSend}
                title={sendDisabled ? sendDisabledReason : undefined}
                className="inline-flex items-center gap-1.5 rounded-md border border-court-border bg-court-surface px-3 py-2 text-xs font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg disabled:opacity-60"
              >
                <Clock className="h-3.5 w-3.5" /> Send Later
              </button>
            )}
            {sendLater.popover}
            <button
              type="button"
              onClick={onSendClick}
              disabled={isSending || sendDisabled || !canSend}
              title={sendDisabled ? sendDisabledReason : undefined}
              className="inline-flex items-center gap-1.5 rounded-md border border-court-brand bg-court-brand-tint px-4 py-2 text-xs font-semibold text-court-brand-dark shadow-sm transition hover:bg-court-brand/25 disabled:opacity-60"
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
    </div>,
    document.body,
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-14 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-court-fg-muted">
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
      className="w-full rounded-md border border-transparent bg-transparent px-0 py-1.5 text-sm text-court-fg placeholder:text-court-fg-muted focus:border-brand focus:outline-none"
    />
  );
}

function confirmReplace(current: string, incoming: string): boolean {
  if (typeof window === "undefined") return true;
  if (!current.trim()) return true;
  if (current.trim() === incoming.trim()) return false;
  return window.confirm("Replace the current text with the template?");
}

function ContactMultiPicker({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: ContactOption[];
}) {
  const [open, setOpen] = useState(false);
  const selected = new Set(
    value
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  );

  function toggle(email: string) {
    if (!email) return;
    const next = new Set(selected);
    if (next.has(email)) next.delete(email);
    else next.add(email);
    onChange(Array.from(next).join(", "));
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-court-border bg-court-surface px-2 py-1.5 text-left text-sm text-court-fg hover:border-brand/40"
      >
        <span className="truncate">
          {selected.size === 0 ? (
            <span className="text-court-fg-muted">Pick contacts…</span>
          ) : (
            Array.from(selected).join(", ")
          )}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-court-fg-muted" />
      </button>
      {open && (
        <>
          {/* z-[60]/z-[70] sits ABOVE the modal backdrop's z-50 so a
              click outside the dropdown closes only the dropdown — its
              click never reaches the modal backdrop's onClose handler.
              Bubbling still goes up the React tree, where the modal
              panel's onClick={stopPropagation} prevents the modal
              from closing on the same click. */}
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-[70] mt-1 w-full overflow-hidden rounded-lg border border-court-border bg-court-surface shadow-lg">
            <ul className="max-h-64 overflow-y-auto py-1">
              {options.length === 0 && (
                <li className="px-3 py-2 text-xs text-court-fg-muted">No contacts on file.</li>
              )}
              {options.map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-court-fg hover:bg-court-brand-tint">
                    <input
                      type="checkbox"
                      checked={c.email ? selected.has(c.email) : false}
                      onChange={() => toggle(c.email)}
                      disabled={!c.email}
                      className="h-3.5 w-3.5 rounded border-court-border text-brand focus:ring-brand/30"
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{c.name}</span>
                      <span className="truncate text-[11px] text-court-fg-muted">
                        {c.email || "No email on file"}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

// Cc/Bcc picker that shows a known-contact dropdown, a pinned always-on-top
// row (e.g. Austin), and a free-text fallback. Multi-select via chips.
// Value is a comma-joined string of emails for parity with the text-input
// codepath, so callers can keep the same parseList + EmailDraft shape.
function ContactComboMulti({
  value,
  onChange,
  options,
  pinned,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: ContactOption[];
  pinned?: ContactOption[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const parseCsv = (raw: string): string[] =>
    raw.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  const selected = new Set(parseCsv(value));
  const pinnedList = pinned ?? [];
  const pinnedEmails = new Set(pinnedList.map((p) => p.email.toLowerCase()));
  const rest = options.filter((o) => !pinnedEmails.has(o.email.toLowerCase()));

  // Ref holds the authoritative chip string in sync with mutations.
  // Rapid-fire clicks on dropdown options hit React's batching: two
  // clicks before the first re-render would both compute `next` off
  // the same stale `selected` prop, and the second overwrote the
  // first. Reading through the ref lets each mutation see the latest
  // committed state regardless of render cadence.
  const latestValueRef = useRef(value);
  latestValueRef.current = value;

  function commit(next: Set<string>) {
    const joined = Array.from(next).join(", ");
    latestValueRef.current = joined;
    onChange(joined);
  }

  function add(email: string) {
    if (!email) return;
    const key = email.trim();
    if (!key) return;
    const next = new Set(parseCsv(latestValueRef.current));
    if (next.has(key)) return;
    next.add(key);
    commit(next);
  }

  // Use a ref so addTyped called from the document-mousedown closure
  // always reads the freshest typed value, not whatever was captured
  // when the listener was attached.
  const typedRef = useRef(typed);
  typedRef.current = typed;

  function addTyped() {
    const raw = typedRef.current.trim();
    if (!raw) return;
    // Allow comma/semicolon-separated bulk paste.
    const next = new Set(parseCsv(latestValueRef.current));
    for (const p of parseCsv(raw)) next.add(p);
    commit(next);
    setTyped("");
  }

  function removeChip(email: string) {
    const next = new Set(parseCsv(latestValueRef.current));
    next.delete(email);
    commit(next);
  }

  // Outside-click dismisses the dropdown via a document-level listener
  // (gated by `open` and scoped to this picker's container). Replaces
  // an earlier `fixed inset-0` overlay that sat on top of the entire
  // viewport and ate clicks on surrounding composer chrome.
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      const node = containerRef.current;
      if (node && node.contains(e.target as Node)) return;
      addTyped();
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <div
        className="flex min-h-[34px] w-full flex-wrap items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-sm focus-within:border-brand"
        onClick={() => setOpen(true)}
      >
        {Array.from(selected).map((email) => (
          <span
            key={email}
            className="inline-flex items-center gap-1 rounded-full bg-court-surface-subtle px-2 py-0.5 text-[11px] text-court-fg"
          >
            {email}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeChip(email);
              }}
              className="text-court-fg-muted hover:text-court-fg"
              aria-label={`Remove ${email}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          type="email"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "," || e.key === ";") {
              e.preventDefault();
              addTyped();
            } else if (e.key === "Tab") {
              // Commit on Tab without preventing native focus move.
              addTyped();
            }
          }}
          onBlur={addTyped}
          onFocus={() => setOpen(true)}
          placeholder={selected.size === 0 ? placeholder : ""}
          className="min-w-[140px] flex-1 bg-transparent px-1 py-0.5 text-sm text-court-fg outline-none placeholder:text-court-fg-muted/60"
        />
      </div>
      {open && (
        <div className="absolute left-0 top-full z-[70] mt-1 w-full overflow-hidden rounded-lg border border-court-border bg-court-surface shadow-lg">
          <ul className="max-h-64 overflow-y-auto py-1">
            {pinnedList.length > 0 && (
              <>
                <li className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
                  Quick pick
                </li>
                {pinnedList.map((c) => (
                  <ContactRow
                    key={`pinned-${c.id}`}
                    c={c}
                    checked={Boolean(c.email && selected.has(c.email))}
                    onAdd={() => add(c.email)}
                  />
                ))}
                <li className="mx-2 my-1 border-t border-court-border" />
              </>
            )}
            {rest.length === 0 && pinnedList.length === 0 && (
              <li className="px-3 py-2 text-xs text-court-fg-muted">
                No contacts on file. Type an email and press Enter.
              </li>
            )}
            {rest.map((c) => (
              <ContactRow
                key={c.id}
                c={c}
                checked={Boolean(c.email && selected.has(c.email))}
                onAdd={() => add(c.email)}
              />
            ))}
          </ul>
          <div className="border-t border-court-border bg-court-surface-subtle/40 px-3 py-1.5 text-[10px] text-court-fg-muted">
            Or type an email and press Enter to add.
          </div>
        </div>
      )}
    </div>
  );
}

function ContactRow({
  c,
  checked,
  onAdd,
}: {
  c: ContactOption;
  checked: boolean;
  onAdd: () => void;
}) {
  // mouseDown + preventDefault keeps focus on the typed input (no blur
  // → no stale-closure addTyped race). onClick with stopPropagation
  // commits the add cleanly without bubbling to the container or
  // document outside-click handler. Add-only — clicking an already-
  // selected contact is a no-op; the X on the chip removes it.
  return (
    <li>
      <button
        type="button"
        onMouseDown={(e) => {
          if (!c.email) return;
          e.preventDefault();
        }}
        onClick={(e) => {
          if (!c.email) return;
          e.preventDefault();
          e.stopPropagation();
          onAdd();
        }}
        disabled={!c.email}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm text-court-fg hover:bg-court-brand-tint disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span
          aria-hidden="true"
          className={cn(
            "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border",
            checked ? "border-brand bg-brand text-white" : "border-court-border bg-court-surface",
          )}
        >
          {checked && (
            <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M2 6.5l2.5 2.5L10 3" />
            </svg>
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{c.name}</span>
          <span className="truncate text-[11px] text-court-fg-muted">
            {c.email || "No email on file"}
          </span>
        </span>
      </button>
    </li>
  );
}

// Groups MERGE_FIELDS by their `group` tag, preserving the array order so
// the dropdown shows Candidate → Client → Job → Interview → Offer →
// Recruiter regardless of how the author defines them.
function groupedMergeFields(): { group: string; items: typeof MERGE_FIELDS[number][] }[] {
  const ordered: { group: string; items: typeof MERGE_FIELDS[number][] }[] = [];
  const seen = new Map<string, { group: string; items: typeof MERGE_FIELDS[number][] }>();
  for (const f of MERGE_FIELDS) {
    const key = f.group ?? "Other";
    let bucket = seen.get(key);
    if (!bucket) {
      bucket = { group: key, items: [] };
      seen.set(key, bucket);
      ordered.push(bucket);
    }
    bucket.items.push(f);
  }
  return ordered;
}

// ---- Draft autosave (localStorage) ----
//
// Why: recruiters have lost long email drafts to a stray select-all+
// Backspace, an accidental modal-overlay click that closes the
// composer, or a refresh. Native textarea undo (Cmd+Z) only survives
// while the element is mounted; closing the modal nukes the stack.
// Mirroring subject + body to localStorage on every keystroke gives
// us a recovery surface that survives all three failure modes —
// reopening the composer with the same draftKey re-seeds from the
// stored copy and shows a one-click Discard banner.
//
// We deliberately persist ONLY subject + body. Recipients (To/Cc/Bcc)
// are sourced from the calling page (candidate / job / interview
// state) and re-derived correctly on remount; storing them risks
// resurrecting stale recipients after a candidate switch.

const DRAFT_NS = "ace-draft:v1:";

type StoredDraft = { subject: string; body: string; savedAt: number };

function readDraft(key: string | undefined): StoredDraft | null {
  if (!key || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_NS + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredDraft>;
    if (typeof parsed.subject !== "string" || typeof parsed.body !== "string") return null;
    // Drop drafts older than 14 days so we don't resurrect ancient
    // half-typed messages months later when the same draftKey
    // happens to recur.
    const savedAt = typeof parsed.savedAt === "number" ? parsed.savedAt : 0;
    if (savedAt && Date.now() - savedAt > 14 * 24 * 60 * 60 * 1000) {
      window.localStorage.removeItem(DRAFT_NS + key);
      return null;
    }
    // Empty drafts aren't worth restoring.
    if (!parsed.subject.trim() && !parsed.body.trim()) return null;
    return { subject: parsed.subject, body: parsed.body, savedAt };
  } catch {
    return null;
  }
}

function writeDraft(key: string, value: { subject: string; body: string }): void {
  if (typeof window === "undefined") return;
  try {
    // Skip the very first write where both fields are empty (initial
    // state) so we don't pollute storage with no-op entries.
    if (!value.subject.trim() && !value.body.trim()) {
      window.localStorage.removeItem(DRAFT_NS + key);
      return;
    }
    window.localStorage.setItem(
      DRAFT_NS + key,
      JSON.stringify({ subject: value.subject, body: value.body, savedAt: Date.now() }),
    );
  } catch {
    // Quota errors / private mode — autosave is best-effort.
  }
}

function clearDraft(key: string | undefined): void {
  if (!key || typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(DRAFT_NS + key);
  } catch {
    // ignore
  }
}

// BCC teammate roster. Surfaced on every BCC field so the recruiter can
// pick Austin (or any future teammate) from the BCC dropdown regardless of
// which composer surfaced — submittal, interview invite, ad-hoc reply, etc.
// Sourced from src/lib/team-contacts.ts so the interview scheduler's
// CcBccPicker and this composer share one Bcc roster and can never drift.
const BCC_TEAMMATE_OPTIONS: ContactOption[] = TEAM_BCC_OPTIONS;

// Union two ContactOption lists by email (case-insensitive). Used to
// stitch the static teammate roster onto whatever per-call BCC
// options the caller passed without producing duplicates when a
// teammate happens to also be a client contact.
function mergeContactOptionsByEmail(
  base: ContactOption[],
  extra: ContactOption[],
): ContactOption[] {
  const seen = new Set<string>();
  const out: ContactOption[] = [];
  for (const o of [...base, ...extra]) {
    const key = (o.email ?? "").trim().toLowerCase();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(o);
  }
  return out;
}
