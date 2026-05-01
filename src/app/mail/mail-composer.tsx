"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  List,
  ListOrdered,
  Link as LinkIcon,
  Paperclip,
  X,
  Loader2,
  Send,
  FileText,
  Sparkles,
  Variable,
  ChevronDown,
  Minus,
  GripVertical,
  SquareArrowOutUpRight,
  Save,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { ActiveTemplateSummary } from "@/app/email/actions";
import { EditWithClaudeMenu, type EditType } from "@/components/edit-with-claude-menu";
import {
  MAIL_MERGE_FIELDS,
  applyMailMergeFields,
  type MailMergeContext,
} from "@/lib/mail-merge-fields";
import { useMinimizedDrafts } from "@/lib/minimized-drafts-context";

// Inline reply composer for the Mail Tab. Hangs off a thread, sends
// through /api/mail/threads/[id]/reply, then lets the parent refresh
// the thread detail so the sent message appears at the top.
//
// Rich text: StarterKit (bold, italic, bullet/ordered list) + Underline
// + Link + Image. Pasted images land as data:... base64 <img> tags —
// Gmail renders those fine inline, and we keep the message self-
// contained without introducing a second multipart/related layer for
// CID refs.
//
// File attachments: drag-drop OR the paperclip button. Any MIME is
// accepted (PDF, DOCX, images). Each file is read via FileReader and
// attached as base64 in the JSON payload; server-side buildRfc2822
// assembles the multipart/mixed message.

export type AttachmentDraft = {
  key: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  dataBase64: string;
};

// Snapshot of the composer's user-facing state. Emitted via onPopOut
// when the user clicks the Pop Out icon in the inline header so the
// parent can re-launch the same draft inside an asModal popup with
// nothing typed lost.
export type ComposerStateSnapshot = {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  bodyHtml: string;
  attachments: AttachmentDraft[];
  draftId: string | null;
};

type Props = {
  // Threaded reply when present; fresh send (click-to-email popup) when omitted.
  threadId?: string;
  defaultTo: string;
  defaultCc?: string;
  // Pre-fills BCC. Carried over when the inline composer pops out into
  // a modal so the recruiter doesn't lose recipients they already
  // typed. Omitted in the from-scratch click-to-email path.
  defaultBcc?: string;
  defaultSubject: string;
  // Pre-fills the editor body. Used by Forward to drop the quoted
  // original message in before the cursor lands; Reply / Reply All
  // leave this empty. Also seeded by the inline → modal pop-out so the
  // body's rich-text formatting transfers verbatim.
  defaultBody?: string;
  // Pre-fills attachments — used by the inline → modal pop-out so any
  // files the recruiter dragged in before popping out aren't dropped.
  defaultAttachments?: AttachmentDraft[];
  // When the recruiter has already saved a Gmail draft this session,
  // we carry the draft id through pop-outs so the Delete button knows
  // which draft to remove. Null/undefined means "no draft yet".
  defaultDraftId?: string | null;
  // Inline-only callback fired when the recruiter clicks the Pop Out
  // icon in the header. Receives the current composer state so the
  // parent can re-launch in modal mode with everything carried over.
  // Ignored in modal mode — the modal already has drag/resize +
  // sticky footer.
  onPopOut?: (snapshot: ComposerStateSnapshot) => void;
  // When true (Reply / Reply All / Forward), auto-focus the editor
  // body on mount so the recruiter can start typing without clicking
  // into the field. Skipped for click-to-email so the To row gets
  // the focus instead.
  autoFocusBody?: boolean;
  templates?: ActiveTemplateSummary[];
  mergeContext?: MailMergeContext;
  // Same-company CC picker source. When provided + non-empty, the CC
  // row exposes a dropdown button that lists these contacts so the
  // recruiter can click-to-add them. Suggestions are NOT applied as
  // type-ahead autocomplete — picking is always explicit. If omitted,
  // the composer self-fetches based on whatever's in the To field
  // (so it works for any launch surface, not just the candidate
  // profile that originally wired it).
  ccPickerOptions?: Array<{ name: string; email: string }>;
  // Optional To-field type-ahead source. The FAB pre-loads this with
  // the active client's contacts when launched from /clients/[id] so
  // the recruiter can start typing a name and pick from a dropdown
  // instead of memorizing the email. Empty by default — type-ahead
  // requires an explicit suggestion source to stay quiet on routes
  // where it'd be noise (mail thread reply, etc.).
  toSuggestions?: Array<{ name: string; email: string }>;
  // Phase 5A.2: smart context resolution. When set, the composer
  // fetches the candidate's active applied jobs on mount and
  // populates {{job.*}} / {{client.*}} fields based on how many
  // active jobs there are: 1 → auto-load, 2+ → render the
  // "Which job is this email about?" dropdown, 0 → leave job/client
  // fields literal.
  candidateRef?: string;
  // When true, render as a full-screen modal overlay (click-to-email
  // popup case). When false/absent, render inline (Mail Tab Reply).
  asModal?: boolean;
  // Header text shown in modal mode.
  modalTitle?: string;
  // When true (modal mode only), skip the dark backdrop and let pointer
  // events pass through the outer dialog wrapper so the user can keep
  // interacting with the rest of the app while the composer is open.
  // The composer card itself stays clickable. Used by the global
  // ComposeFAB so navigation, sidebar clicks, etc. aren't blocked.
  nonBlocking?: boolean;
  onClose: () => void;
  onSent: () => void;
};

// Tracks which input the caret was last in so Insert Field splices the
// token into whichever field the recruiter was typing in (subject or
// body). Defaults to body — it's the common case.
type LastFocused = "subject" | "body";

export function MailComposer({
  threadId,
  defaultTo,
  defaultCc,
  defaultBcc,
  defaultSubject,
  defaultBody,
  defaultAttachments,
  defaultDraftId = null,
  autoFocusBody = false,
  templates = [],
  mergeContext = {},
  ccPickerOptions: ccPickerOptionsProp,
  toSuggestions = [],
  candidateRef,
  asModal = false,
  modalTitle = "New email",
  nonBlocking = false,
  onPopOut,
  onClose,
  onSent,
}: Props) {
  const [to, setTo] = useState(defaultTo);
  const [cc, setCc] = useState(defaultCc ?? "");
  const [bcc, setBcc] = useState(defaultBcc ?? "");
  const [subject, setSubject] = useState(defaultSubject);
  // Tracks the Gmail draft id the most recent Save Draft created. Set
  // by Save Draft on success, carried over from defaults when the
  // composer is re-opened from a pop-out, and cleared after Delete.
  // The Delete button uses this to decide whether to call Gmail or
  // just discard locally. Distinct from the local `draftId = useId()`
  // below, which keys the minimized-drafts tray entry.
  const [gmailDraftId, setGmailDraftId] = useState<string | null>(defaultDraftId);
  const [savingDraft, setSavingDraft] = useState(false);
  const [deletingDraft, setDeletingDraft] = useState(false);
  // CC picker options auto-resolve from the To value: whenever it
  // contains an email matching a Contact in our CRM, we pull the
  // peers at that Contact's clientId so the CC + Contact button
  // surfaces the rest of the company. Caller can still pre-seed via
  // the prop (e.g. mail-view ThreadDetail wants the picker primed
  // before the composer mounts) but in steady-state the composer
  // owns the fetch.
  const [ccPickerAutoOptions, setCcPickerAutoOptions] = useState<
    Array<{ name: string; email: string }>
  >([]);
  const ccPickerOptions = ccPickerOptionsProp ?? ccPickerAutoOptions;
  useEffect(() => {
    // Skip when the parent already supplied options — avoids a
    // duplicate fetch immediately after mount on the candidate-profile
    // path that pre-resolves the picker.
    if (ccPickerOptionsProp) return;
    const email = extractFirstEmail(to);
    if (!email) {
      setCcPickerAutoOptions([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(
            `/api/contacts/cc-suggestions?email=${encodeURIComponent(email)}`,
            { cache: "no-store" },
          );
          if (!res.ok) return;
          const body = (await res.json().catch(() => null)) as
            | { contacts?: Array<{ name: string; email: string }> }
            | null;
          if (!cancelled && body?.contacts) {
            setCcPickerAutoOptions(body.contacts);
          }
        } catch {
          // Silent: an empty picker is the worst case; recruiter can
          // still type CC addresses by hand.
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [to, ccPickerOptionsProp]);
  // Default CC to visible if we pre-populated it — otherwise the user
  // won't realize extra recipients are being carried over. Same for
  // BCC when the carry-over snapshot has values.
  const [showCc, setShowCc] = useState(Boolean(defaultCc && defaultCc.trim()));
  const [showBcc, setShowBcc] = useState(Boolean(defaultBcc && defaultBcc.trim()));
  const [attachments, setAttachments] = useState<AttachmentDraft[]>(
    defaultAttachments ? [...defaultAttachments] : [],
  );
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const subjectRef = useRef<HTMLInputElement | null>(null);

  // Dropdown open/close state for the three composer extras.
  const [openTemplateMenu, setOpenTemplateMenu] = useState(false);
  const [openFieldMenu, setOpenFieldMenu] = useState(false);
  const [openAiPanel, setOpenAiPanel] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  // When true, the next Generate call also asks Claude for a subject
  // line and pipes it back into the Subject input. Off by default —
  // most generations are replies where the existing subject is right.
  const [aiIncludeSubject, setAiIncludeSubject] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [editBusy, setEditBusy] = useState(false);

  // Insert Field splices at the caret position of whichever control was
  // last focused. Body is the default — tiptap's insertContent handles
  // the caret. Subject is a plain <input>, so we splice via selection
  // indices on the DOM element.
  const lastFocused = useRef<LastFocused>("body");

  // Modal-mode draggable / resizable state. Position is the top-left
  // corner of the card in viewport pixels; size is its width/height.
  // Initialize lazily in a useEffect so SSR doesn't read window. Once
  // mounted, drag/resize updates via document-level mouse listeners.
  const draftId = useId();
  // Pull stable callbacks out of the context so the effects below
  // don't re-run every time `drafts` changes (the whole context
  // object changes identity on each upsert otherwise, which would
  // trigger the unmount cleanup mid-life and orphan the pill).
  const { upsert: upsertDraft, remove: removeDraft, drafts: minimizedDrafts } = useMinimizedDrafts();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 720, h: 600 });
  const [isMinimized, setIsMinimized] = useState(false);
  const dragRef = useRef<{ offX: number; offY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);

  // Phase 5A.2 smart context. activeJobs is populated by an on-mount
  // fetch when candidateRef is set; selectedJobId picks one (auto-set
  // when there's exactly 1, user-set via dropdown when 2+, null when 0).
  type ActiveJob = {
    jobId: string;
    jobTitle: string;
    jobDescription: string;
    jobCity: string;
    jobState: string;
    clientId: string;
    clientName: string;
    primaryContactFirstName: string;
  };
  const [activeJobs, setActiveJobs] = useState<ActiveJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [contextLoaded, setContextLoaded] = useState(false);

  // Phase 5A.2-fix: keep the un-substituted source body on hand so we
  // can re-resolve merge tags when the user picks (or re-picks) a job
  // from the smart-context dropdown. Set when a template is applied
  // or when Claude generates a draft. Cleared when the user types
  // manually so we don't blow away their edits on the next context
  // change. Substituted result lives in the tiptap editor; the source
  // here is the canonical pre-substitution string with raw {{...}} tags.
  const templateSource = useRef<string | null>(null);
  // Internal flag so the editor's onUpdate handler can tell the
  // difference between the user typing and our own programmatic
  // setContent calls.
  const isProgrammaticEdit = useRef(false);

  useEffect(() => {
    if (!candidateRef) {
      setContextLoaded(true);
      return;
    }
    let cancelled = false;
    fetch(`/api/mail/candidate-context/${encodeURIComponent(candidateRef)}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setContextLoaded(true);
          return;
        }
        const body = (await res.json()) as { activeJobs: ActiveJob[] };
        setActiveJobs(body.activeJobs ?? []);
        // Auto-select when exactly one — saves the user a click.
        if ((body.activeJobs ?? []).length === 1) {
          setSelectedJobId(body.activeJobs[0].jobId);
        }
        setContextLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setContextLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [candidateRef]);

  // Effective merge context = caller-provided base, with job/client
  // overlaid from the selected active job (if any). Recomputed on
  // every render — cheap; the resolver only runs at send time + on
  // demand for the unresolved-fields banner.
  const selectedJob = activeJobs.find((j) => j.jobId === selectedJobId) ?? null;
  const effectiveContext: MailMergeContext = {
    ...mergeContext,
    job: selectedJob
      ? {
          title: selectedJob.jobTitle,
          clientName: selectedJob.clientName,
          city: selectedJob.jobCity,
          state: selectedJob.jobState,
          description: selectedJob.jobDescription,
        }
      : mergeContext.job,
    client: selectedJob
      ? {
          name: selectedJob.clientName,
          primaryContactFirstName: selectedJob.primaryContactFirstName,
        }
      : mergeContext.client,
  };

  // (Substitution-on-context-change effect is declared after the
  // tiptap editor is set up — see below the useEditor() call.)

  // Center the modal on first mount (in modal mode only). max-w-3xl
  // ≈ 720px; default 600 tall fits a typical 800px viewport with
  // padding. Subsequent open/close cycles re-center because the
  // composer is unmounted on close.
  useEffect(() => {
    if (!asModal || pos !== null) return;
    if (typeof window === "undefined") return;
    const w = Math.min(720, window.innerWidth - 40);
    const h = Math.min(600, window.innerHeight - 40);
    setSize({ w, h });
    setPos({
      x: Math.max(20, (window.innerWidth - w) / 2),
      y: Math.max(20, (window.innerHeight - h) / 2),
    });
  }, [asModal, pos]);

  const clampPos = useCallback((x: number, y: number, w: number, h: number) => {
    if (typeof window === "undefined") return { x, y };
    const maxX = Math.max(0, window.innerWidth - w);
    const maxY = Math.max(0, window.innerHeight - h);
    return {
      x: Math.min(Math.max(0, x), maxX),
      y: Math.min(Math.max(0, y), maxY),
    };
  }, []);

  // Document-level mouse handlers attach only while a drag or resize is
  // active. This avoids a global listener spinning when the modal is
  // closed/minimized.
  useEffect(() => {
    if (!isDragging) return;
    function onMove(e: MouseEvent) {
      if (!dragRef.current || !pos) return;
      const next = clampPos(
        e.clientX - dragRef.current.offX,
        e.clientY - dragRef.current.offY,
        size.w,
        size.h,
      );
      setPos(next);
    }
    function onUp() {
      setIsDragging(false);
      dragRef.current = null;
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    // Disable text selection during drag so the title bar text doesn't
    // get highlighted as the user drags.
    const prevSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = prevSelect;
    };
  }, [isDragging, pos, size.w, size.h, clampPos]);

  useEffect(() => {
    if (!isResizing) return;
    function onMove(e: MouseEvent) {
      if (!resizeRef.current || !pos) return;
      const dx = e.clientX - resizeRef.current.startX;
      const dy = e.clientY - resizeRef.current.startY;
      const maxW = window.innerWidth - 40 - pos.x;
      const maxH = window.innerHeight - 40 - pos.y;
      const w = Math.max(480, Math.min(maxW, resizeRef.current.startW + dx));
      const h = Math.max(400, Math.min(maxH, resizeRef.current.startH + dy));
      setSize({ w, h });
    }
    function onUp() {
      setIsResizing(false);
      resizeRef.current = null;
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    const prevSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = prevSelect;
    };
  }, [isResizing, pos]);

  function onTitleBarMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (!asModal || !pos) return;
    // Ignore drags initiated from interactive children (the X / minimize
    // buttons live in the title bar; clicking them shouldn't kick off a
    // drag).
    const target = e.target as HTMLElement;
    if (target.closest("button")) return;
    dragRef.current = { offX: e.clientX - pos.x, offY: e.clientY - pos.y };
    setIsDragging(true);
  }

  function onResizeMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (!asModal) return;
    e.stopPropagation();
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startW: size.w,
      startH: size.h,
    };
    setIsResizing(true);
  }

  // Minimize collapses the modal to a pill in the global tray. The
  // composer keeps all its state because we toggle isMinimized rather
  // than unmounting; restore just flips the flag.
  function onMinimize() {
    if (!asModal) return;
    setIsMinimized(true);
    upsertDraft({
      id: draftId,
      subject: subject || "New Email",
      onRestore: () => {
        setIsMinimized(false);
        removeDraft(draftId);
      },
      onDiscard: () => {
        removeDraft(draftId);
        onClose();
      },
    });
  }

  // Keep the tray pill's subject in sync as the user edits the subject
  // while the composer is restored. Only fires when the draft is
  // currently registered.
  useEffect(() => {
    if (!asModal) return;
    if (!minimizedDrafts.some((d) => d.id === draftId)) return;
    upsertDraft({
      id: draftId,
      subject: subject || "New Email",
      onRestore: () => {
        setIsMinimized(false);
        removeDraft(draftId);
      },
      onDiscard: () => {
        removeDraft(draftId);
        onClose();
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject]);

  // Drop the registry entry on unmount so the tray doesn't keep a stale
  // pill when the composer hard-closes. removeDraft is stable
  // (useCallback in the provider) so this effect runs exactly once.
  useEffect(() => {
    const id = draftId;
    return () => {
      removeDraft(id);
    };
  }, [draftId, removeDraft]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
      }),
      Underline,
      Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
      // `inline: true` + `allowBase64: true` lets pasted-image blobs be
      // spliced inline as data: URLs, which is what makes "paste a
      // screenshot in the composer" actually land in the sent email.
      Image.configure({ inline: true, allowBase64: true }),
    ],
    content: defaultBody ?? "",
    onUpdate: () => {
      // User-typed updates invalidate the saved template source so the
      // next context change doesn't overwrite their edits. Programmatic
      // setContent calls (via the substitution effect) skip this branch
      // — see the isProgrammaticEdit ref above.
      if (isProgrammaticEdit.current) {
        isProgrammaticEdit.current = false;
        return;
      }
      templateSource.current = null;
    },
    editorProps: {
      attributes: {
        class:
          "min-h-[180px] w-full whitespace-pre-wrap rounded-lg border border-court-border bg-court-surface px-3 py-2 font-sans text-sm leading-relaxed text-court-fg outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 prose prose-sm max-w-none prose-p:my-2 prose-strong:font-semibold",
      },
      handlePaste(view, event) {
        const items = event.clipboardData?.items;
        if (!items) return false;
        for (const item of Array.from(items)) {
          if (item.kind === "file" && item.type.startsWith("image/")) {
            const file = item.getAsFile();
            if (!file) continue;
            const reader = new FileReader();
            reader.onload = () => {
              const result = reader.result;
              if (typeof result !== "string") return;
              view.dispatch(
                view.state.tr.replaceSelectionWith(
                  view.state.schema.nodes.image.create({ src: result }),
                ),
              );
            };
            reader.readAsDataURL(file);
            event.preventDefault();
            return true;
          }
        }
        return false;
      },
    },
    immediatelyRender: false,
  });

  useEffect(() => {
    return () => {
      editor?.destroy();
    };
  }, [editor]);

  // Auto-focus the body when this composer opens as a reply / forward.
  // Cursor lands at the start of the editor for forwards (so the
  // recruiter types above the quoted original) and at the end for
  // empty replies. Runs once when the editor finishes constructing —
  // editor identity is stable for the life of the composer.
  useEffect(() => {
    if (!editor) return;
    if (!autoFocusBody) return;
    const pos = defaultBody ? "start" : "end";
    editor.commands.focus(pos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // Phase 5A.2-fix: re-substitute the saved templateSource whenever
  // smart-context selection changes (auto-load hits 1 active job, or
  // user picks/re-picks from the dropdown). Skipped when
  // templateSource is null — that means the user typed manually and
  // we shouldn't blow away their edits. setContent is marked
  // programmatic so the editor's onUpdate handler doesn't clear the
  // template source as a result of our own write.
  useEffect(() => {
    if (!editor) return;
    if (!templateSource.current) return;
    const { output } = applyMailMergeFields(templateSource.current, effectiveContext);
    if (editor.getHTML() === output) return;
    isProgrammaticEdit.current = true;
    editor.commands.setContent(output, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedJobId, editor]);

  async function addFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    for (const f of arr) {
      const dataBase64 = await fileToBase64(f);
      setAttachments((prev) => [
        ...prev,
        {
          key: `${f.name}-${f.size}-${Date.now()}`,
          filename: f.name,
          mimeType: f.type || "application/octet-stream",
          sizeBytes: f.size,
          dataBase64,
        },
      ]);
    }
  }

  function removeAttachment(key: string) {
    setAttachments((prev) => prev.filter((a) => a.key !== key));
  }

  // Apply a template: replace subject + body with the template's
  // content. Asks for confirmation if the body is already non-empty
  // to avoid trashing a draft.
  function pickTemplate(template: ActiveTemplateSummary) {
    const currentBody = editor?.getHTML() ?? "";
    const bodyHasContent = stripHtml(currentBody).trim().length > 0;
    if (bodyHasContent && !confirm("Replace the current draft with this template?")) {
      setOpenTemplateMenu(false);
      return;
    }
    setSubject(template.subject);
    // Template bodies come in two flavors: legacy plain-text and
    // richer HTML. If the body has any tag, we assume HTML; else we
    // wrap in a <p>. Either way tiptap normalizes on insert.
    const looksHtml = /<[a-z][^>]*>/i.test(template.body);
    const html = looksHtml ? template.body : `<p>${escapeHtml(template.body).replace(/\n/g, "<br/>")}</p>`;
    // Phase 5A.2-fix: stash the un-substituted source so we can re-
    // resolve when the user picks a different job from the smart-
    // context dropdown. The first substitution happens here against
    // the current effectiveContext.
    templateSource.current = html;
    const { output } = applyMailMergeFields(html, effectiveContext);
    isProgrammaticEdit.current = true;
    editor?.commands.setContent(output, false);
    setOpenTemplateMenu(false);
  }

  // Insert Field: splice the tag at the last-focused position.
  function insertMergeTag(tag: string) {
    if (lastFocused.current === "subject") {
      const el = subjectRef.current;
      if (!el) {
        setSubject((s) => s + tag);
      } else {
        const start = el.selectionStart ?? el.value.length;
        const end = el.selectionEnd ?? el.value.length;
        const next = el.value.slice(0, start) + tag + el.value.slice(end);
        setSubject(next);
        // Restore caret position after React re-renders.
        requestAnimationFrame(() => {
          el.focus();
          const pos = start + tag.length;
          el.setSelectionRange(pos, pos);
        });
      }
    } else {
      editor?.chain().focus().insertContent(tag).run();
    }
    setOpenFieldMenu(false);
  }

  // Generate with Claude: POSTs the user's prompt + thread id; server
  // returns { bodyHtml } which we drop into the editor (replacing the
  // current draft, with the same confirm prompt as Use Template).
  async function onGenerate() {
    const prompt = aiPrompt.trim();
    if (!prompt) return;
    const currentBody = editor?.getHTML() ?? "";
    const bodyHasContent = stripHtml(currentBody).trim().length > 0;
    if (bodyHasContent && !confirm("Replace the current draft with the generated email?")) {
      return;
    }
    setAiBusy(true);
    try {
      const res = await fetch("/api/mail/ai-compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          threadId,
          includeSubject: aiIncludeSubject,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = body?.error ?? `Generation failed (${res.status})`;
        toast.error("Claude couldn't draft that", { description: msg });
        return;
      }
      const html = body?.bodyHtml ?? "";
      const generatedSubject =
        typeof body?.subject === "string" ? body.subject.trim() : "";
      if (html) {
        // Same pattern as pickTemplate — stash the un-substituted
        // source so a subsequent dropdown pick re-resolves merge tags
        // in Claude's draft.
        templateSource.current = html;
        const { output } = applyMailMergeFields(html, effectiveContext);
        isProgrammaticEdit.current = true;
        editor?.commands.setContent(output, false);
        // Apply the AI subject only when the user opted in AND the
        // server returned one. Substitute through the same merge-field
        // resolver so {{candidate.first_name}} etc. land filled.
        if (aiIncludeSubject && generatedSubject) {
          const { output: subjectOut } = applyMailMergeFields(
            generatedSubject,
            effectiveContext,
          );
          setSubject(subjectOut);
        }
        toast.success("Draft generated");
        setAiPrompt("");
        setOpenAiPanel(false);
      } else {
        toast.error("Claude returned an empty draft");
      }
    } catch (e) {
      toast.error("Claude couldn't draft that", {
        description: e instanceof Error ? e.message : "unknown error",
      });
    } finally {
      setAiBusy(false);
    }
  }

  // Edit with Claude: revises the user's existing draft instead of
  // writing one from scratch. The edited HTML is pushed back through
  // the editor's chain() so the swap lands in ProseMirror's history —
  // Cmd+Z restores the pre-edit body. Disabled when the body is empty.
  async function onEditWithClaude(editType: EditType) {
    if (!editor) return;
    const currentHtml = editor.getHTML();
    if (!stripHtml(currentHtml).trim()) {
      toast.error("Type something in the body first.");
      return;
    }
    setEditBusy(true);
    try {
      const res = await fetch("/api/email/edit-with-claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: currentHtml,
          editType,
          format: "html",
        }),
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as
        | { body?: string; error?: string }
        | null;
      if (!res.ok) {
        const msg = json?.error ?? `Edit failed (${res.status})`;
        toast.error("Couldn't edit draft", { description: msg });
        return;
      }
      const next = (json?.body ?? "").trim();
      if (!next) {
        toast.error("Claude returned an empty edit.");
        return;
      }
      // chain().focus().selectAll().insertContent(...) records the swap
      // as a single ProseMirror transaction so Cmd+Z restores the prior
      // draft. Plain editor.commands.setContent would clear history.
      isProgrammaticEdit.current = true;
      editor.chain().focus().selectAll().insertContent(next).run();
      toast.success("Draft revised", { description: "Cmd+Z to restore your original." });
    } catch (e) {
      toast.error("Couldn't edit draft", {
        description: e instanceof Error ? e.message : "unknown error",
      });
    } finally {
      setEditBusy(false);
    }
  }

  // Fix 4c — Save Draft hits the Gmail drafts endpoint via our wrapper
  // route. Same payload shape as /api/mail/send; the route reuses
  // createGmailDraft so the user's stored Account-row refresh token is
  // the boundary. On success we record the draft id so a subsequent
  // Delete click can DELETE the same row at Gmail; we then close the
  // composer and toast. We deliberately do NOT resolve merge fields
  // here — drafts are work-in-progress and the recruiter usually
  // wants the literal {{...}} tags preserved so they can pick a job
  // before sending. (Send still resolves them at send time.)
  async function onSaveDraft() {
    setError(null);
    const toArr = splitAddresses(to);
    if (toArr.length === 0) {
      setError("Add at least one To: recipient before saving a draft.");
      return;
    }
    const ccArr = showCc ? splitAddresses(cc) : [];
    const bccArr = showBcc ? splitAddresses(bcc) : [];
    const bodyHtml = editor?.getHTML() ?? "";
    setSavingDraft(true);
    try {
      const res = await fetch(`/api/mail/drafts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          to: toArr,
          cc: ccArr.length > 0 ? ccArr : undefined,
          bcc: bccArr.length > 0 ? bccArr : undefined,
          subject: subject || "(no subject)",
          bodyHtml,
          attachments: attachments.map((a) => ({
            filename: a.filename,
            mimeType: a.mimeType,
            dataBase64: a.dataBase64,
          })),
          // When a previous Save Draft already created a draft this
          // session, pass the id so the route can replace the prior
          // draft instead of stacking duplicates in Gmail's Drafts
          // label. New row otherwise.
          draftId: gmailDraftId ?? undefined,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = body?.error ?? `Save Draft failed (${res.status})`;
        setError(msg);
        toast.error("Couldn't save draft", { description: msg });
        return;
      }
      const newDraftId = (body?.draftId as string | undefined) ?? null;
      if (newDraftId) setGmailDraftId(newDraftId);
      toast.success("Draft saved.");
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Save Draft failed";
      setError(msg);
      toast.error("Couldn't save draft", { description: msg });
    } finally {
      setSavingDraft(false);
    }
  }

  // Fix 4c — Delete: discard the in-progress message. If a Gmail draft
  // was already saved this session, DELETE it through our wrapper so
  // Gmail's Drafts label doesn't accumulate ghost rows. If nothing
  // was saved yet, we just close the composer locally — no remote call
  // needed.
  async function onDelete() {
    setError(null);
    if (!gmailDraftId) {
      // Nothing to delete on Gmail — just discard locally.
      onClose();
      return;
    }
    setDeletingDraft(true);
    try {
      const res = await fetch(
        `/api/mail/drafts/${encodeURIComponent(gmailDraftId)}`,
        { method: "DELETE" },
      );
      if (!res.ok && res.status !== 404) {
        // 404 = already gone; treat as success.
        const body = await res.json().catch(() => null);
        const msg = body?.error ?? `Delete failed (${res.status})`;
        toast.error("Couldn't delete draft", { description: msg });
        return;
      }
      toast.success("Draft deleted.");
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Delete failed";
      toast.error("Couldn't delete draft", { description: msg });
    } finally {
      setDeletingDraft(false);
    }
  }

  async function onSend() {
    setError(null);
    const toArr = splitAddresses(to);
    if (toArr.length === 0) {
      setError("At least one To: recipient is required.");
      return;
    }
    const ccArr = showCc ? splitAddresses(cc) : [];
    const bccArr = showBcc ? splitAddresses(bcc) : [];
    let bodyHtml = editor?.getHTML() ?? "";
    let subjectOut = subject;
    if (!stripHtml(bodyHtml).trim() && attachments.length === 0) {
      setError("Write a reply, paste content, or attach a file before sending.");
      return;
    }

    // Phase 5A.2: resolve merge tags against the effective context
    // (smart-context-aware). Unresolved tags pass through as literal
    // {{...}} text in the sent email — the visible inline banner
    // above the footer warns the recruiter before they hit Send.
    // No confirm() dialog: the user already saw the banner.
    const bodyMerge = applyMailMergeFields(bodyHtml, effectiveContext);
    const subjectMerge = applyMailMergeFields(subjectOut, effectiveContext);
    bodyHtml = bodyMerge.output;
    subjectOut = subjectMerge.output;

    setSending(true);
    try {
      const res = await fetch(`/api/mail/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          to: toArr,
          cc: ccArr.length > 0 ? ccArr : undefined,
          bcc: bccArr.length > 0 ? bccArr : undefined,
          subject: subjectOut,
          bodyHtml,
          attachments: attachments.map((a) => ({
            filename: a.filename,
            mimeType: a.mimeType,
            dataBase64: a.dataBase64,
          })),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = body?.error ?? `Send failed (${res.status})`;
        setError(msg);
        toast.error("Couldn't send email", { description: msg });
        return;
      }
      toast.success(threadId ? "Reply sent" : "Email sent");
      onSent();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Send failed";
      setError(msg);
      toast.error("Couldn't send email", { description: msg });
    } finally {
      setSending(false);
    }
  }

  // Phase 5A.2 derived state for the unresolved-fields banner. Reads
  // the current draft + subject and runs them through the merge
  // resolver against the effective context. Cheap to compute every
  // render — the resolver is regex + string substitution.
  const draftBodyHtml = editor?.getHTML() ?? "";
  const draftMerge = applyMailMergeFields(draftBodyHtml, effectiveContext);
  const draftSubjectMerge = applyMailMergeFields(subject, effectiveContext);
  const allUnresolved = Array.from(
    new Set([...draftMerge.unresolved, ...draftSubjectMerge.unresolved]),
  );
  const unresolvedNote =
    activeJobs.length === 0 && candidateRef && contextLoaded
      ? "[No active job]"
      : activeJobs.length >= 2 && !selectedJobId
      ? "[Pick job above]"
      : "";

  const composerBody = (
    <div
      className={
        asModal
          ? "flex h-full w-full flex-col overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-2xl"
          : // Inline mode (Mail Tab Reply / Reply All / Forward + the
            // Floating Thread Window's reply pane). Same flex-column +
            // overflow-hidden chassis as the modal so the chrome rows
            // pin top, the editor scrolls in its own region, and the
            // footer (Send / Save Draft / Delete) stays glued to the
            // bottom. Composer is capped at 65% of the parent so the
            // recruiter has a meaningful body region by default while
            // still leaving the messages list scrollable above to read
            // the message they're replying to.
            "flex max-h-[65%] max-h-[min(72vh,65%)] flex-col overflow-hidden border-t border-court-border bg-court-surface-subtle/30"
      }
    >
      <div
        onMouseDown={onTitleBarMouseDown}
        className={cn(
          "flex shrink-0 items-center justify-between border-b border-court-border px-5 py-2",
          // shrink-0 across every chrome row (in BOTH modal and inline
          // modes) so flex distribution never robs the footer of its
          // declared height. Without this, an open AI panel +
          // smart-context dropdown + a long unresolved-fields banner
          // can compress the row stack far enough that Send slides
          // under the wrapper's bottom edge.
          asModal && "select-none",
          asModal && !isDragging && "cursor-grab",
          asModal && isDragging && "cursor-grabbing",
        )}
      >
        <div className="flex items-center gap-2">
          {asModal && <GripVertical className="h-3.5 w-3.5 text-court-fg-muted" />}
          <div className="text-xs font-semibold uppercase tracking-wider text-court-fg-muted">
            {asModal ? modalTitle : "Reply"}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {!asModal && onPopOut && (
            // Inline-only Pop Out icon. Reads the editor's current HTML
            // (so rich-text formatting carries over verbatim) plus the
            // form state, hands the snapshot to the parent, and the
            // parent re-launches in modal mode via composer-manager.
            // No state lives here past the call — onPopOut is paired
            // with onClose by the parent so the inline pane closes
            // immediately, leaving exactly one composer on screen.
            <button
              type="button"
              onClick={() => {
                onPopOut({
                  to,
                  cc,
                  bcc,
                  subject,
                  bodyHtml: editor?.getHTML() ?? "",
                  attachments,
                  draftId: gmailDraftId,
                });
              }}
              className="rounded-md p-1 text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
              aria-label="Pop out composer into a floating window"
              title="Pop out into a floating window"
            >
              <SquareArrowOutUpRight className="h-4 w-4" />
            </button>
          )}
          {asModal && (
            <button
              type="button"
              onClick={onMinimize}
              onMouseDown={(e) => e.stopPropagation()}
              className="rounded-md p-1 text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
              aria-label="Minimize composer"
            >
              <Minus className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            onMouseDown={(e) => e.stopPropagation()}
            className="rounded-md p-1 text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
            aria-label="Close composer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="shrink-0 space-y-1 px-5 py-1.5">
        <AddressRow
          label="To"
          value={to}
          onChange={setTo}
          suggestions={toSuggestions}
        />
        <div className="flex gap-2 text-[10px] text-court-fg-muted">
          <button
            type="button"
            onClick={() => {
              // Collapsing the CC field clears anything the recruiter
              // typed there — matches the user expectation that the
              // "− CC" button removes the field cleanly. Same for BCC.
              if (showCc) setCc("");
              setShowCc(!showCc);
            }}
            className="hover:text-court-fg"
          >
            {showCc ? "− CC" : "+ CC"}
          </button>
          <button
            type="button"
            onClick={() => {
              if (showBcc) setBcc("");
              setShowBcc(!showBcc);
            }}
            className="hover:text-court-fg"
          >
            {showBcc ? "− BCC" : "+ BCC"}
          </button>
        </div>
        {showCc && (
          <AddressRow
            label="CC"
            value={cc}
            onChange={setCc}
            pickerOptions={ccPickerOptions}
          />
        )}
        {showBcc && (
          <AddressRow
            label="BCC"
            value={bcc}
            onChange={setBcc}
            // Both wirings on BCC: typeahead surfaces Austin when the
            // recruiter starts typing his name OR clicks the focused
            // empty field; the picker button surfaces him as an
            // explicit one-click add. Belt + suspenders so "BCC
            // Austin" always works regardless of how the recruiter
            // approaches the field.
            suggestions={ORG_MEMBER_SUGGESTIONS}
            pickerOptions={ORG_MEMBER_SUGGESTIONS}
          />
        )}
        <label className="flex items-center gap-2 text-sm">
          <span className="w-14 shrink-0 text-[10px] uppercase tracking-wider text-court-fg-muted">
            Subject
          </span>
          <input
            ref={subjectRef}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            onFocus={() => (lastFocused.current = "subject")}
            className="h-7 w-full rounded-md border border-court-border bg-court-surface px-2 text-sm text-court-fg outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </label>
      </div>

      <ComposerAddonToolbar
        templates={templates}
        openTemplate={openTemplateMenu}
        setOpenTemplate={setOpenTemplateMenu}
        onPickTemplate={pickTemplate}
        openField={openFieldMenu}
        setOpenField={setOpenFieldMenu}
        onInsertField={insertMergeTag}
        openAi={openAiPanel}
        setOpenAi={setOpenAiPanel}
        editBusy={editBusy}
        editDisabled={!stripHtml(editor?.getHTML() ?? "").trim()}
        onEditWithClaude={onEditWithClaude}
      />
      {openAiPanel && (
        <div className="shrink-0 space-y-2 border-b border-court-border bg-court-surface px-5 py-3">
          <label className="block text-[11px] uppercase tracking-wider text-court-fg-muted">
            Describe what you want to say
          </label>
          <textarea
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            rows={3}
            placeholder="e.g. Tell Linda her interview moved to Monday 10am and apologize for the late notice."
            className="w-full rounded-md border border-court-border bg-court-surface px-2 py-1.5 text-sm text-court-fg placeholder:text-court-fg-muted/60 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setOpenAiPanel(false);
                setAiPrompt("");
              }}
              disabled={aiBusy}
              className="rounded-md px-2 py-1 text-[11px] font-medium text-court-fg-muted transition hover:text-court-fg disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onGenerate}
              disabled={aiBusy || !aiPrompt.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
              data-includes-subject={aiIncludeSubject ? "1" : "0"}
            >
              {aiBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              Generate
            </button>
          </div>
          {/* Opt-in subject-line generation. Sits below the action
              row so the visual hierarchy is body-first; checking it
              just adds a subject to the same one Generate click. */}
          <label className="flex cursor-pointer items-center gap-2 pt-1 text-[11px] text-court-fg-muted">
            <input
              type="checkbox"
              checked={aiIncludeSubject}
              onChange={(e) => setAiIncludeSubject(e.target.checked)}
              disabled={aiBusy}
              className="h-3.5 w-3.5 cursor-pointer accent-brand disabled:cursor-not-allowed"
            />
            Generate subject line with Claude
          </label>
        </div>
      )}

      {/* Smart-context: show "Which job is this email about?" when
          the candidate has 2+ active applied jobs. The dropdown sits
          right above the rich-text toolbar so the user can resolve
          context before they start typing. */}
      {candidateRef && contextLoaded && activeJobs.length >= 2 && (
        <div className="shrink-0 border-b border-court-border bg-court-surface-subtle/40 px-5 py-2">
          <label className="flex items-center gap-2 text-sm">
            <span className="shrink-0 text-[11px] uppercase tracking-wider text-court-fg-muted">
              Which job is this email about?
            </span>
            {/* min-w-0 lets flex-1 actually constrain the select's
                width — without it, the longest <option>'s intrinsic
                content width (e.g. "Tax Manager in Cleveland -
                Northeast Ohio at BreakPoint") wins and pushes the
                native chevron past the modal's right edge. With
                min-w-0 + flex-1 the select shrinks to fit. We render
                our own chevron (appearance-none + absolute icon +
                pr-8) so the long truncated option text can never
                overlap the arrow at narrow widths. */}
            <div className="relative min-w-0 flex-1">
              <select
                value={selectedJobId ?? ""}
                onChange={(e) => setSelectedJobId(e.target.value || null)}
                className="w-full appearance-none truncate rounded-md border border-court-border bg-court-surface py-1 pl-2 pr-8 text-sm text-court-fg outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              >
                <option value="">— Pick a job —</option>
                {activeJobs.map((j) => {
                  const loc = [j.jobCity, j.jobState].filter(Boolean).join(", ");
                  const label = loc
                    ? `${j.jobTitle} - ${loc} at ${j.clientName}`
                    : `${j.jobTitle} at ${j.clientName}`;
                  return (
                    <option key={j.jobId} value={j.jobId}>
                      {label}
                    </option>
                  );
                })}
              </select>
              <ChevronDown
                aria-hidden="true"
                className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-court-fg-muted"
              />
            </div>
          </label>
        </div>
      )}

      <Toolbar editor={editor} />

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={async (e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length > 0) await addFiles(e.dataTransfer.files);
        }}
        onFocusCapture={() => (lastFocused.current = "body")}
        className={cn(
          "mx-5 rounded-lg transition",
          // Editor body is the only flex-1 region in BOTH inline and
          // modal modes so the footer (Send / Save Draft / Delete)
          // stays pinned at the bottom regardless of composer size.
          // min-h-0 lets the wrapper shrink below the editor's
          // intrinsic min-height when the wrapper is small.
          "flex-1 min-h-0 overflow-y-auto",
          dragOver && "ring-2 ring-brand/50 ring-offset-2 ring-offset-court-surface-subtle",
        )}
      >
        <EditorContent editor={editor} />
      </div>

      {attachments.length > 0 && (
        <ul className="mx-5 mt-2 shrink-0 space-y-1">
          {attachments.map((a) => (
            <li
              key={a.key}
              className="flex items-center justify-between rounded-md border border-court-border bg-court-surface px-3 py-1.5 text-xs text-court-fg"
            >
              <span className="truncate">
                <Paperclip className="mr-1 inline h-3 w-3 text-court-fg-muted" />
                {a.filename}
                <span className="ml-2 text-court-fg-muted">{formatBytes(a.sizeBytes)}</span>
              </span>
              <button
                type="button"
                onClick={() => removeAttachment(a.key)}
                className="rounded-md p-1 text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
                aria-label={`Remove ${a.filename}`}
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Phase 5A.2: unresolved merge-field banner. Replaces the old
          "Send anyway?" confirm() dialog. Shows the user the literal
          tags that will go through unsubstituted, plus a hint about
          why ([No active job] / [Pick job above]) when smart context
          is in play. Court Mode tokens only. */}
      {allUnresolved.length > 0 && (
        <div className="mx-5 mt-2 shrink-0 rounded-lg border border-court-border bg-court-surface-subtle/60 px-3 py-2 text-[11px] text-court-fg">
          <span className="font-medium text-court-fg-muted">
            {unresolvedNote ? `${unresolvedNote} — ` : ""}
            These fields will send literally:
          </span>{" "}
          {allUnresolved.map((tag, i) => (
            <span key={tag}>
              <code className="rounded bg-court-surface px-1 py-0.5 font-mono text-[10px] text-court-fg">
                {tag}
              </code>
              {i < allUnresolved.length - 1 ? " " : ""}
            </span>
          ))}
        </div>
      )}

      {error && (
        <div className="mx-5 mt-2 shrink-0 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-800">
          {error}
        </div>
      )}

      <div className="flex shrink-0 items-center justify-between border-t border-court-border bg-court-surface px-5 py-3">
        {/* Footer pins to the bottom of the composer in BOTH inline
            and modal modes — shrink-0 prevents the parent flex from
            collapsing it, so Send / Save Draft / Delete are always
            visible regardless of how much content sits in the editor
            above. Court tokens only. */}
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="application/pdf,.pdf,application/msword,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,image/*"
            className="hidden"
            onChange={(e) => {
              const files = e.target.files;
              if (files && files.length > 0) {
                void addFiles(files);
              }
              e.currentTarget.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg"
          >
            <Paperclip className="h-3 w-3" /> Attach
          </button>
          <span className="text-[11px] text-court-fg-muted">or drag files onto the body.</span>
        </div>
        <div className="flex items-center gap-2">
          {asModal && (
            <>
              {/* Fix 4c — Save Draft + Delete sit alongside Send only
                  in modal mode. Inline reply already commits on
                  Send and doesn't need draft persistence (Gmail's
                  inline pane is short-lived; the recruiter pops out
                  if they want to step away). */}
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={onDelete}
                disabled={deletingDraft || sending}
              >
                {deletingDraft ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="h-3 w-3" />
                )}
                Delete
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={onSaveDraft}
                disabled={savingDraft || sending}
              >
                {savingDraft ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Save className="h-3 w-3" />
                )}
                Save Draft
              </Button>
            </>
          )}
          <Button
            type="button"
            size="sm"
            onClick={onSend}
            disabled={sending || savingDraft || deletingDraft}
          >
            {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            Send
          </Button>
        </div>
      </div>
    </div>
  );

  if (asModal) {
    // Portal to document.body so the modal escapes whatever stacking
    // context the host page set up (transformed parents, fixed-position
    // headers, etc).
    if (typeof document === "undefined") return null;
    // While minimized, the modal renders nothing — the tray is the
    // visible affordance. We DON'T unmount the composer; that would
    // discard tiptap state, attachments, generated drafts, etc.
    if (isMinimized) return null;
    // Until pos is computed (first paint after mount), keep the
    // modal hidden so it doesn't flash at (0, 0).
    if (!pos) return null;
    return createPortal(
      <div
        role="dialog"
        aria-modal={nonBlocking ? "false" : "true"}
        className={cn(
          "fixed inset-0 z-[100]",
          // In non-blocking mode the wrapper itself must let pointer
          // events through so clicks on the page underneath aren't
          // intercepted. The composer card below re-enables pointer
          // events for itself via pointer-events-auto.
          nonBlocking && "pointer-events-none",
        )}
      >
        {/* Backdrop: only rendered in normal modal mode. Blocks clicks
            from bleeding through to the page underneath. The X button
            in the header is the only way to dismiss. Skipped entirely
            when nonBlocking is true so the user can keep interacting
            with the rest of the app. */}
        {!nonBlocking && <div className="absolute inset-0 bg-black/40" />}
        {/* Composer card — positioned absolutely with state-driven
            top/left/width/height so the user can drag and resize it. */}
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}
          className={cn("absolute", nonBlocking && "pointer-events-auto")}
        >
          {composerBody}
          {/* Resize handle in the bottom-right corner. The handle is a
              small square with a diagonal pattern that tells the user
              it's draggable. */}
          <div
            onMouseDown={onResizeMouseDown}
            aria-label="Resize composer"
            className={cn(
              "absolute bottom-1 right-1 h-4 w-4 rounded-sm",
              isResizing ? "cursor-nwse-resize bg-court-fg/10" : "cursor-nwse-resize hover:bg-court-fg/5",
            )}
            style={{
              backgroundImage:
                "linear-gradient(135deg, transparent 0 35%, currentColor 35% 45%, transparent 45% 65%, currentColor 65% 75%, transparent 75%)",
              color: "var(--court-fg-muted, #888)",
              opacity: 0.6,
            }}
          />
        </div>
      </div>,
      document.body,
    );
  }
  return composerBody;
}

// TODO: Replace with a dynamic fetch from /api/org/members once that
// endpoint exists. The OrganizationMembership table already carries
// the rows we need; the API stub just hasn't been written yet. Until
// then, hardcoding the BreakPoint roster's most-frequent BCC target
// (Austin) so recruiters can one-click-add him to a thread.
const ORG_MEMBER_SUGGESTIONS: Array<{ name: string; email: string }> = [
  { name: "Austin Barnard", email: "austin@breakpointtalent.com" },
];

function AddressRow({
  label,
  value,
  onChange,
  suggestions = [],
  pickerOptions = [],
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  // Typeahead source — surfaces matching contacts when the field is
  // focused. Picking one appends "Name <email>, " to the field —
  // same string-comma format the To and CC fields expect.
  suggestions?: Array<{ name: string; email: string }>;
  // Same-company / org-member contacts that should also surface in
  // the typeahead. Folded into `suggestions` here so a single
  // dropdown handles both sources — previously these were exposed
  // via a separate "+ Contact" picker button which spawned its own
  // absolutely-positioned dropdown that overlayed the next field
  // (CC's picker was sitting on top of the Subject input, blocking
  // every click in the row beneath it). Removed per Andrew's
  // request — typeahead is the single recipient-pick path now.
  pickerOptions?: Array<{ name: string; email: string }>;
}) {
  const [focused, setFocused] = useState(false);

  // The "current segment" is whatever the user is typing after the
  // last comma. We filter suggestions against this so the dropdown
  // narrows as they type "aust…".
  const lowerValue = value.toLowerCase();
  const lastCommaIdx = value.lastIndexOf(",");
  const currentSegment = value.slice(lastCommaIdx + 1).trim().toLowerCase();

  // Merge suggestions + pickerOptions, de-duped by email (lowercase).
  // Caller may pass overlap (the BCC field passes ORG_MEMBER_SUGGESTIONS
  // as both); the dedupe here keeps Austin from rendering twice in
  // the dropdown.
  const merged = (() => {
    const out: Array<{ name: string; email: string }> = [];
    const seen = new Set<string>();
    for (const s of [...suggestions, ...pickerOptions]) {
      const key = s.email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
    return out;
  })();

  const filtered = focused
    ? merged.filter((s) => {
        // Skip anyone already present in the field.
        if (lowerValue.includes(s.email.toLowerCase())) return false;
        // Empty segment → show every remaining suggestion.
        if (!currentSegment) return true;
        return (
          s.email.toLowerCase().includes(currentSegment) ||
          s.name.toLowerCase().includes(currentSegment)
        );
      })
    : [];

  function pick(s: { name: string; email: string }) {
    const addr = `${s.name} <${s.email}>`;
    // Drop the in-progress segment, replace with the full picked
    // address, and append a trailing comma+space so the user can keep
    // typing the next recipient without manual punctuation.
    const before =
      lastCommaIdx >= 0 ? value.slice(0, lastCommaIdx + 1) + " " : "";
    onChange(before + addr + ", ");
  }

  return (
    <div className="relative">
      <label className="flex items-center gap-2 text-sm">
        <span className="w-14 shrink-0 text-[10px] uppercase tracking-wider text-court-fg-muted">
          {label}
        </span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="h-7 w-full rounded-md border border-court-border bg-court-surface px-2 text-sm text-court-fg outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
      </label>
      {filtered.length > 0 && (
        <ul className="absolute left-[64px] right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-md border border-court-border bg-court-surface shadow-lg">
          {filtered.map((s) => (
            <li key={s.email}>
              <button
                type="button"
                // Run pick() on mousedown — earlier in the event
                // sequence than click — and call preventDefault to
                // block the focus shift away from the input. This
                // sidesteps the classic blur-before-click race that
                // dismisses the dropdown without registering the
                // selection. Single mouse press lands the address.
                onMouseDown={(e) => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  pick(s);
                }}
                className="block w-full px-3 py-2 text-left text-sm transition hover:bg-court-surface-subtle"
              >
                <div className="font-medium text-court-fg">{s.name}</div>
                <div className="text-[11px] text-court-fg-muted">{s.email}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Toolbar({ editor }: { editor: ReturnType<typeof useEditor> }) {
  if (!editor) return null;
  const btn = (active: boolean, onClick: () => void, icon: JSX.Element, label: string) => (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "rounded-md px-2 py-1 text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg",
        active && "bg-court-accent-tint/60 text-court-accent-dark",
      )}
    >
      {icon}
    </button>
  );
  return (
    <div className="mx-5 flex shrink-0 items-center gap-1 border-b border-court-border py-1">
      {btn(
        editor.isActive("bold"),
        () => editor.chain().focus().toggleBold().run(),
        <Bold className="h-3.5 w-3.5" />,
        "Bold",
      )}
      {btn(
        editor.isActive("italic"),
        () => editor.chain().focus().toggleItalic().run(),
        <Italic className="h-3.5 w-3.5" />,
        "Italic",
      )}
      {btn(
        editor.isActive("underline"),
        () => editor.chain().focus().toggleUnderline().run(),
        <UnderlineIcon className="h-3.5 w-3.5" />,
        "Underline",
      )}
      <div className="mx-1 h-4 w-px bg-court-border" />
      {btn(
        editor.isActive("bulletList"),
        () => editor.chain().focus().toggleBulletList().run(),
        <List className="h-3.5 w-3.5" />,
        "Bulleted list",
      )}
      {btn(
        editor.isActive("orderedList"),
        () => editor.chain().focus().toggleOrderedList().run(),
        <ListOrdered className="h-3.5 w-3.5" />,
        "Numbered list",
      )}
      <div className="mx-1 h-4 w-px bg-court-border" />
      {btn(
        editor.isActive("link"),
        () => {
          if (editor.isActive("link")) {
            editor.chain().focus().unsetLink().run();
            return;
          }
          const url = window.prompt("Link URL");
          if (!url) return;
          editor.chain().focus().setLink({ href: url }).run();
        },
        <LinkIcon className="h-3.5 w-3.5" />,
        "Link",
      )}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function ComposerAddonToolbar({
  templates,
  openTemplate,
  setOpenTemplate,
  onPickTemplate,
  openField,
  setOpenField,
  onInsertField,
  openAi,
  setOpenAi,
  editBusy,
  editDisabled,
  onEditWithClaude,
}: {
  templates: ActiveTemplateSummary[];
  openTemplate: boolean;
  setOpenTemplate: (v: boolean) => void;
  onPickTemplate: (t: ActiveTemplateSummary) => void;
  openField: boolean;
  setOpenField: (v: boolean) => void;
  onInsertField: (tag: string) => void;
  openAi: boolean;
  setOpenAi: (v: boolean) => void;
  editBusy: boolean;
  editDisabled: boolean;
  onEditWithClaude: (editType: EditType) => void;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-court-border px-5 py-2">
      {/* Use Template */}
      <div className="relative">
        <button
          type="button"
          onClick={() => {
            setOpenTemplate(!openTemplate);
            setOpenField(false);
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg"
        >
          <FileText className="h-3 w-3" /> Use Template <ChevronDown className="h-3 w-3" />
        </button>
        {openTemplate && (
          <div
            role="menu"
            className="absolute left-0 top-full z-20 mt-1 max-h-72 w-64 overflow-y-auto rounded-md border border-court-border bg-court-surface shadow-lg"
          >
            {templates.length === 0 ? (
              <div className="px-3 py-2 text-xs text-court-fg-muted">
                No templates yet. Create one in Settings &gt; Templates.
              </div>
            ) : (
              templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onPickTemplate(t)}
                  className="block w-full truncate px-3 py-1.5 text-left text-xs text-court-fg hover:bg-court-accent-tint/40"
                >
                  <span className="font-medium">{t.name}</span>
                  {t.category && (
                    <span className="ml-2 text-[10px] uppercase tracking-wider text-court-fg-muted">
                      {t.category}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Insert Field */}
      <div className="relative">
        <button
          type="button"
          onClick={() => {
            setOpenField(!openField);
            setOpenTemplate(false);
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg"
        >
          <Variable className="h-3 w-3" /> Insert Field <ChevronDown className="h-3 w-3" />
        </button>
        {openField && (
          <div
            role="menu"
            className="absolute left-0 top-full z-20 mt-1 max-h-72 w-72 overflow-y-auto rounded-md border border-court-border bg-court-surface shadow-lg"
          >
            {MAIL_MERGE_FIELDS.map((f) => (
              <button
                key={f.tag}
                type="button"
                onClick={() => onInsertField(f.tag)}
                className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-xs text-court-fg hover:bg-court-accent-tint/40"
              >
                <span className="truncate">{f.label}</span>
                <code className="shrink-0 rounded bg-court-surface-subtle px-1 py-0.5 text-[10px] text-court-fg-muted">
                  {f.tag}
                </code>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Generate with Claude */}
      <button
        type="button"
        onClick={() => setOpenAi(!openAi)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-ink-600 disabled:opacity-60"
      >
        <Sparkles className="h-3 w-3" /> Generate with Claude
      </button>

      {/* Edit with Claude — separate from Generate. Revises the
          existing draft instead of writing one from scratch. */}
      <EditWithClaudeMenu
        isEditing={editBusy}
        disabled={editDisabled}
        onPick={onEditWithClaude}
        variant="tinted"
      />
    </div>
  );
}

// Pulls the first bare email out of a free-form To string (handles
// "Name <addr>" + comma-separated lists). Returns null when nothing
// looks like an email — the CC-picker auto-fetch effect treats null
// as "clear the options," so the picker doesn't surface stale peers
// after the recruiter wipes the To field.
function extractFirstEmail(raw: string): string | null {
  if (!raw.trim()) return null;
  for (const part of raw.split(/[,;]/)) {
    const token = part.trim();
    if (!token) continue;
    const m = token.match(/<([^>]+)>/);
    const candidate = (m ? m[1] : token).trim();
    if (candidate.includes("@")) return candidate;
  }
  return null;
}

function splitAddresses(raw: string): string[] {
  return raw
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("FileReader did not return a string"));
        return;
      }
      // result is "data:<mime>;base64,<b64>"
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader error"));
    reader.readAsDataURL(file);
  });
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
