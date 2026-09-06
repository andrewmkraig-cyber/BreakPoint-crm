"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import {
  CalendarCheck,
  Check,
  ChevronDown,
  Copy,
  FileText,
  Gauge,
  Image as ImageIcon,
  Loader2,
  Mail,
  Mic,
  PhoneCall,
  Send,
  Square,
  Trash2,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useComposerManager } from "@/lib/composer-manager";
import { GAME_PLAN_USER_MESSAGE_MAX_CHARS } from "@/lib/game-plan-limits";
import { uploadFileInChunks } from "@/lib/chunked-upload";
import { useVoiceDictation } from "@/lib/use-voice-dictation";
import { decodeCommonHtmlEntities } from "@/lib/ai-output-formatting";

// Per-entity AI chat surface. Drops onto a client or candidate detail page
// as a standalone card: loads its own history from /api/ai-workspace,
// persists every turn through the same endpoint, and scopes itself by
// (entityType, entityId) so two candidates can't see each other's threads.
//
// Theming: every surface uses the court-* token namespace so Hard / Clay /
// Grass flip automatically. The user bubble stays literal brand-green
// (#5A9642 == bg-brand) in every mode because that's the Ace primary
// action color.

export type AiWorkspaceProps = {
  entityType: "client" | "candidate" | "job";
  entityId: string;
  title?: string;
  // When provided, assistant bubbles render an "Email" button that
  // pops the in-app composer pre-filled with this address and the
  // bubble's clean HTML as the body. Lets the recruiter ship a Game
  // Plan response straight out of Ace without copy / paste.
  recipientEmail?: string | null;
  // Viewport height (in rem) reserved below the card. The card is
  // height: calc(100dvh - bottomGapRem). Pages with a taller header
  // (client / job carry the 5 KPI stat tiles) pass a larger value so
  // the composer ends above the fixed bottom-right Delete button
  // instead of overlapping it. Defaults to 22rem (the candidate-page
  // chrome budget the height was originally tuned to).
  bottomGapRem?: number;
  // Candidate quick actions use this to target one associated job.
  // Multiple jobs trigger a picker; one job is used automatically.
  candidateJobOptions?: CandidateGamePlanJobOption[];
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

type InterviewPrepContactOption = {
  key: string;
  name: string;
  title: string | null;
  email: string | null;
  linkedin: string | null;
  source: "scheduled" | "client_contact";
  defaultSelected: boolean;
};

type InterviewPrepInterview = {
  id: string;
  label: string;
  scheduledAt: string;
  clientName: string | null;
  jobTitle: string | null;
  contactOptions: InterviewPrepContactOption[];
  defaultContactKeys: string[];
};

type InterviewPrepData = {
  candidate: {
    id: string;
    name: string;
    firstName: string;
    email: string | null;
  };
  interviews: InterviewPrepInterview[];
};

export type CandidateGamePlanJobOption = {
  key: string;
  jobTitle: string;
  clientName: string | null;
  stage: string | null;
  location: string | null;
};

type CandidateQuickAction = "call-prep" | "rank";

type ImageAttachmentMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";
type DocxAttachmentMediaType =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
type WorkspaceAttachmentKind = "image" | "pdf" | "docx";
type WorkspaceAttachmentBase = {
  id: string;
  uploadId: string;
  name: string;
  size: number;
};
type WorkspaceAttachment =
  | (WorkspaceAttachmentBase & {
      kind: "image";
      mediaType: ImageAttachmentMediaType;
      previewUrl: string;
    })
  | (WorkspaceAttachmentBase & {
      kind: "pdf";
      mediaType: "application/pdf";
    })
  | (WorkspaceAttachmentBase & {
      kind: "docx";
      mediaType: DocxAttachmentMediaType;
    });
type WorkspaceAttachmentMeta =
  | { kind: "image"; mediaType: ImageAttachmentMediaType }
  | { kind: "pdf"; mediaType: "application/pdf" }
  | { kind: "docx"; mediaType: DocxAttachmentMediaType };

const TEMP_ID_PREFIX = "local-";
const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const ATTACHMENT_TOTAL_MAX_BYTES = 25 * 1024 * 1024;
const SUPPORTED_IMAGE_MIME = new Set<ImageAttachmentMediaType>([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const CANDIDATE_CALL_PREP_PROMPT =
  "Help me prep for a call with this candidate. Explain the company and opportunity simply, identify the most likely motivators or concerns, and give me 2-3 questions to ask.";
const CANDIDATE_RANK_PROMPT =
  "Rank this candidate out of 10 for overall marketability for BreakPoint's searches. Keep it brief: give the score as X/10, a short explanation, the main strength, the main concern, and one next step to improve or validate the score.";

// Drag-to-resize: the card's height is the default
// `calc(100dvh - bottomGapRem)` PLUS a user-dragged pixel delta. The
// delta is persisted globally (one preference, not per-entity) so once
// Andrew stretches the workspace taller it stays that way across
// candidates and reloads. Clamped so the card can shrink a little or
// grow well past the viewport (the page scrolls to reveal the rest),
// while the `min-h-[360px]` floor on the card keeps it usable at the
// negative end.
const HEIGHT_DELTA_KEY = "ace.aiWorkspace.heightDelta";
const HEIGHT_DELTA_MIN = -240;
const HEIGHT_DELTA_MAX = 1600;
function clampHeightDelta(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(HEIGHT_DELTA_MIN, Math.min(HEIGHT_DELTA_MAX, n));
}

function attachmentId(): string {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `shot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function attachmentMeta(file: File): WorkspaceAttachmentMeta | null {
  if (SUPPORTED_IMAGE_MIME.has(file.type as ImageAttachmentMediaType)) {
    return { kind: "image", mediaType: file.type as ImageAttachmentMediaType };
  }
  if (file.type === "application/pdf") return { kind: "pdf", mediaType: "application/pdf" };
  if (file.type === DOCX_MIME) return { kind: "docx", mediaType: DOCX_MIME };
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".png")) return { kind: "image", mediaType: "image/png" };
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return { kind: "image", mediaType: "image/jpeg" };
  }
  if (lower.endsWith(".gif")) return { kind: "image", mediaType: "image/gif" };
  if (lower.endsWith(".webp")) return { kind: "image", mediaType: "image/webp" };
  if (lower.endsWith(".pdf")) return { kind: "pdf", mediaType: "application/pdf" };
  if (lower.endsWith(".docx")) return { kind: "docx", mediaType: DOCX_MIME };
  return null;
}

function attachmentKindLabel(kind: WorkspaceAttachmentKind): string {
  if (kind === "image") return "screenshot";
  if (kind === "pdf") return "PDF";
  return "DOCX";
}

async function fileToBase64(file: File | Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const out = typeof reader.result === "string" ? reader.result : "";
      const comma = out.indexOf(",");
      resolve(comma >= 0 ? out.slice(comma + 1) : out);
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

async function readWorkspaceAttachment(file: File): Promise<WorkspaceAttachment | null> {
  const meta = attachmentMeta(file);
  if (!meta) {
    toast.error(`${file.name || "Attachment"} is not a supported file`, {
      description: "Drop a PNG, JPEG, GIF, WebP, PDF, or DOCX file.",
    });
    return null;
  }
  if (file.size > ATTACHMENT_MAX_BYTES) {
    toast.error(`${file.name || "Attachment"} is too large`, {
      description: `Files must be under ${formatFileSize(ATTACHMENT_MAX_BYTES)}.`,
    });
    return null;
  }
  const [upload, previewData] = await Promise.all([
    uploadFileInChunks(file, "/api/uploads/ai-workspace-attachment"),
    meta.kind === "image" ? fileToBase64(file) : Promise.resolve(""),
  ]);
  if (meta.kind === "pdf") {
    return {
      id: attachmentId(),
      uploadId: upload.id,
      kind: "pdf",
      name: file.name || "document.pdf",
      size: file.size,
      mediaType: meta.mediaType,
    };
  }
  if (meta.kind === "docx") {
    return {
      id: attachmentId(),
      uploadId: upload.id,
      kind: "docx",
      name: file.name || "document.docx",
      size: file.size,
      mediaType: meta.mediaType,
    };
  }
  return {
    id: attachmentId(),
    uploadId: upload.id,
    kind: "image",
    name: file.name || "screenshot.png",
    size: file.size,
    mediaType: meta.mediaType,
    previewUrl: `data:${meta.mediaType};base64,${previewData}`,
  };
}

function attachmentMarker(attachments: WorkspaceAttachment[]): string {
  if (attachments.length === 0) return "";
  return attachments
    .map((a) => `[Attached ${attachmentKindLabel(a.kind)}: ${a.name}]`)
    .join("\n");
}

function candidateJobPhrase(job: CandidateGamePlanJobOption): string {
  const title = job.jobTitle || "the selected job";
  const client = job.clientName ? ` at ${job.clientName}` : "";
  const location = job.location ? ` in ${job.location}` : "";
  const stage = job.stage ? `, current stage: ${job.stage}` : "";
  return `${title}${client}${location}${stage}`;
}

function candidateQuickActionPrompt(
  action: CandidateQuickAction,
  job: CandidateGamePlanJobOption | null,
): string {
  if (action === "call-prep") {
    if (!job) return CANDIDATE_CALL_PREP_PROMPT;
    return `Help me prep for a call with this candidate specifically about ${candidateJobPhrase(job)}. Use that associated job from ACTIVE APPLICATIONS as the target role, not the candidate's other jobs. Explain the company and opportunity simply, identify the most likely motivators or concerns, and give me 2-3 questions to ask.`;
  }

  if (!job) return CANDIDATE_RANK_PROMPT;
  return `Rank this candidate out of 10 specifically for ${candidateJobPhrase(job)}. Use that associated job from ACTIVE APPLICATIONS as the target role, not the candidate's other jobs. Keep it brief: give the score as X/10, a short explanation, the main strength, the main concern, and one next step to improve or validate the score.`;
}

export function AiWorkspace({
  entityType,
  entityId,
  title,
  recipientEmail,
  bottomGapRem = 22,
  candidateJobOptions = [],
}: AiWorkspaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [input, setInput] = useState("");
  // In-flight dictated words the recognizer has not finalized yet. Shown as
  // a live tail on the composer text but deliberately kept OUT of `input`,
  // so a half-heard phrase is never sent, never counted against the
  // character cap, and gets replaced cleanly when the recognizer settles on
  // the final wording. Clicking the mic to stop flushes whatever is pending
  // into `input` rather than dropping it.
  const [interimText, setInterimText] = useState("");
  const [attachments, setAttachments] = useState<WorkspaceAttachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [interviewPrepOpen, setInterviewPrepOpen] = useState(false);
  const [interviewPrepLoading, setInterviewPrepLoading] = useState(false);
  const [interviewPrepGenerating, setInterviewPrepGenerating] = useState(false);
  const [interviewPrepData, setInterviewPrepData] = useState<InterviewPrepData | null>(null);
  const [interviewPrepInterviewId, setInterviewPrepInterviewId] = useState("");
  const [interviewPrepContactKeys, setInterviewPrepContactKeys] = useState<string[]>([]);
  const [candidateJobAction, setCandidateJobAction] = useState<CandidateQuickAction | null>(null);

  const composer = useComposerManager();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Voice dictation. Each finalized phrase is appended to whatever is
  // already in the composer with a single separating space, so the
  // recruiter can type half a prompt, dictate the rest, and keep going.
  // Sentence-ending punctuation is left alone (the recognizer emits it on
  // Chrome; iOS mostly doesn't) — this only guarantees the words don't run
  // together.
  const appendDictatedText = useCallback((text: string) => {
    setInput((prev) => {
      const needsSpace = prev.length > 0 && !/\s$/.test(prev);
      const next = needsSpace ? `${prev} ${text}` : `${prev}${text}`;
      // The 50k cap is the server's, enforced in /api/ai-workspace. At
      // ~150 spoken words per minute that is roughly nine hours of talking,
      // so it is not a practical dictation limit — but truncate rather than
      // silently build a message the API will reject.
      if (next.length <= GAME_PLAN_USER_MESSAGE_MAX_CHARS) return next;
      toast.warning("Game Plan message limit reached", {
        description: `Dictation stopped at ${GAME_PLAN_USER_MESSAGE_MAX_CHARS.toLocaleString()} characters.`,
      });
      return next.slice(0, GAME_PLAN_USER_MESSAGE_MAX_CHARS);
    });
  }, []);

  const dictation = useVoiceDictation({
    onFinalText: appendDictatedText,
    onInterimText: setInterimText,
  });

  // Drag-to-resize state. heightDelta is the px added to the card's
  // default viewport-based height; resizeStart holds the pointer anchor
  // while a drag is in flight.
  const [heightDelta, setHeightDelta] = useState(0);
  const resizeStart = useRef<{ startY: number; startDelta: number } | null>(null);

  // Restore the saved height delta once on mount (client-only — guarded
  // against SSR by running inside an effect).
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(HEIGHT_DELTA_KEY);
      if (saved != null) setHeightDelta(clampHeightDelta(Number(saved)));
    } catch {
      // localStorage can be unavailable (private mode); default height is fine.
    }
  }, []);

  const onResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    resizeStart.current = { startY: e.clientY, startDelta: heightDelta };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onResizePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = resizeStart.current;
    if (!start) return;
    setHeightDelta(clampHeightDelta(start.startDelta + (e.clientY - start.startY)));
  };
  const onResizePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeStart.current) return;
    resizeStart.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Pointer may already be released; ignore.
    }
    try {
      window.localStorage.setItem(HEIGHT_DELTA_KEY, String(heightDelta));
    } catch {
      // Non-persistent fallback: the size still holds for this session.
    }
  };
  // Double-click the handle to snap back to the default height.
  const onResizeReset = () => {
    setHeightDelta(0);
    try {
      window.localStorage.setItem(HEIGHT_DELTA_KEY, "0");
    } catch {
      // ignore
    }
  };

  // Auto-scroll to the bottom on every message-count change (and on load).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, loading]);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/ai-workspace?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`Load failed (${res.status})`);
      const rows = (await res.json()) as Message[];
      setMessages(rows);
    } catch {
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    setCandidateJobAction(null);
  }, [entityId, entityType]);

  const emptyLabel =
    entityType === "client" ? "client" : entityType === "job" ? "job" : "candidate";
  const inputNearLimit = input.length >= GAME_PLAN_USER_MESSAGE_MAX_CHARS * 0.8;
  const selectedInterviewPrep =
    interviewPrepData?.interviews.find((interview) => interview.id === interviewPrepInterviewId) ??
    interviewPrepData?.interviews[0] ??
    null;

  const addFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setAttachmentUploading(true);
      const currentBytes = attachments.reduce((sum, a) => sum + a.size, 0);
      let nextBytes = currentBytes;
      const next: WorkspaceAttachment[] = [];
      try {
        for (const file of files) {
          if (!attachmentMeta(file)) {
            toast.error(`${file.name || "Attachment"} is not a supported file`, {
              description: "Game Plan can read PNG, JPEG, GIF, WebP, PDF, or DOCX files.",
            });
            continue;
          }
          if (nextBytes + file.size > ATTACHMENT_TOTAL_MAX_BYTES) {
            toast.error("Too many attachments", {
              description: `Keep the total under ${formatFileSize(ATTACHMENT_TOTAL_MAX_BYTES)} per message.`,
            });
            break;
          }
          try {
            const attachment = await readWorkspaceAttachment(file);
            if (attachment) {
              nextBytes += attachment.size;
              next.push(attachment);
            }
          } catch (err) {
            toast.error(`Couldn't attach ${file.name || "file"}`, {
              description: err instanceof Error ? err.message : "Upload failed.",
            });
          }
        }
        if (next.length > 0) setAttachments((prev) => [...prev, ...next]);
      } finally {
        setAttachmentUploading(false);
      }
    },
    [attachments],
  );

  async function onSend(promptOverride?: string) {
    const text = (promptOverride ?? input).trim();
    if ((!text && attachments.length === 0) || sending || attachmentUploading) return;

    // Sending closes the mic. Leaving it open would append the next
    // sentence into an already-cleared composer, which reads like the
    // dictation was lost.
    if (dictation.listening) dictation.stop();

    setErrorText(null);
    setSending(true);

    const outboundAttachments = attachments;
    const outboundText =
      text ||
      `Review the attached file${outboundAttachments.length === 1 ? "" : "s"} in the context of this ${emptyLabel}.`;
    const renderedUserContent = [outboundText, attachmentMarker(outboundAttachments)]
      .filter(Boolean)
      .join("\n\n");

    const now = new Date().toISOString();
    const optimisticUser: Message = {
      id: `${TEMP_ID_PREFIX}u-${Date.now()}`,
      role: "user",
      content: renderedUserContent,
      createdAt: now,
    };
    const pendingAssistantId = `${TEMP_ID_PREFIX}a-${Date.now()}`;
    const pendingAssistant: Message = {
      id: pendingAssistantId,
      role: "assistant",
      content: "Thinking…",
      createdAt: now,
    };

    // Optimistic render: show user message + "Thinking…" assistant bubble
    // while the POST is in flight.
    setMessages((prev) => [...prev, optimisticUser, pendingAssistant]);
    setInput("");
    setAttachments([]);

    try {
      const res = await fetch("/api/ai-workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType,
          entityId,
          userMessage: outboundText,
          attachments: outboundAttachments.map((a) => ({
            id: a.id,
            uploadId: a.uploadId,
            kind: a.kind,
            name: a.name,
            size: a.size,
            mediaType: a.mediaType,
          })),
        }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { content?: string; error?: string }
        | null;
      if (!res.ok) {
        // Surface the real reason (Anthropic timeout, rate limit, etc.)
        // so we're not staring at a generic "try again" while the chat
        // silently dies on every send.
        const reason = payload?.error ?? `HTTP ${res.status}`;
        throw new Error(reason);
      }
      const content = payload?.content ?? "";
      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingAssistantId
            ? { ...m, content, createdAt: new Date().toISOString() }
            : m,
        ),
      );
    } catch (err) {
      // Drop the "Thinking…" bubble but keep the optimistic user message
      // visible so the recruiter can see what they sent + retry.
      setMessages((prev) => prev.filter((m) => m.id !== pendingAssistantId));
      const detail = err instanceof Error ? err.message : "unknown error";
      setErrorText(`Failed to send: ${detail}`);
      setAttachments(outboundAttachments);
    } finally {
      setSending(false);
    }
  }

  function onCandidateQuickAction(action: CandidateQuickAction) {
    if (sending) return;
    if (candidateJobOptions.length > 1) {
      setCandidateJobAction((current) => (current === action ? null : action));
      return;
    }
    void onSend(candidateQuickActionPrompt(action, candidateJobOptions[0] ?? null));
  }

  function onPickCandidateQuickActionJob(job: CandidateGamePlanJobOption) {
    if (!candidateJobAction) return;
    const action = candidateJobAction;
    setCandidateJobAction(null);
    void onSend(candidateQuickActionPrompt(action, job));
  }

  async function loadInterviewPrepData(force = false): Promise<InterviewPrepData | null> {
    if (entityType !== "candidate") return null;
    if (interviewPrepData && !force) return interviewPrepData;

    setInterviewPrepLoading(true);
    try {
      const res = await fetch(
        `/api/ai-workspace/interview-prep?candidateId=${encodeURIComponent(entityId)}`,
        { cache: "no-store" },
      );
      const payload = (await res.json().catch(() => null)) as
        | (InterviewPrepData & { error?: string })
        | null;
      if (!res.ok) {
        throw new Error(payload?.error ?? `Load failed (${res.status})`);
      }
      const data = payload as InterviewPrepData;
      const firstInterview = data.interviews[0] ?? null;
      const selected =
        data.interviews.find((interview) => interview.id === interviewPrepInterviewId) ??
        firstInterview;
      setInterviewPrepData(data);
      setInterviewPrepInterviewId(selected?.id ?? "");
      setInterviewPrepContactKeys(selected?.defaultContactKeys ?? []);
      return data;
    } finally {
      setInterviewPrepLoading(false);
    }
  }

  async function onInterviewPrepClick() {
    if (interviewPrepOpen) {
      setInterviewPrepOpen(false);
      return;
    }
    try {
      const data = await loadInterviewPrepData();
      if (!data) return;
      if (data.interviews.length === 0) {
        setInterviewPrepOpen(true);
        toast.warning("No scheduled interviews found", {
          description: "Schedule an interview first, then I can draft the prep email.",
        });
        return;
      }

      if (data.interviews.length > 1 && !interviewPrepInterviewId) {
        setInterviewPrepOpen(true);
        return;
      }

      const interview =
        data.interviews.find((item) => item.id === interviewPrepInterviewId) ??
        data.interviews[0];
      const contactKeys =
        interview.id === interviewPrepInterviewId
          ? interviewPrepContactKeys
          : interview.defaultContactKeys;
      await generateInterviewPrepDraft(interview, contactKeys, data);
    } catch (err) {
      toast.error("Couldn't load interview prep", {
        description: err instanceof Error ? err.message : "unknown error",
      });
    }
  }

  function onSelectInterviewPrep(interviewId: string) {
    setInterviewPrepInterviewId(interviewId);
    const next = interviewPrepData?.interviews.find((interview) => interview.id === interviewId);
    setInterviewPrepContactKeys(next?.defaultContactKeys ?? []);
  }

  function onToggleInterviewPrepContact(key: string) {
    setInterviewPrepContactKeys((prev) =>
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key],
    );
  }

  function onRemoveAttachment(attachment: WorkspaceAttachment) {
    setAttachments((prev) => prev.filter((a) => a.id !== attachment.id));
    void fetch("/api/uploads/ai-workspace-attachment", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: attachment.uploadId }),
    }).catch(() => {
      // Best-effort cleanup; stale staging rows are harmless.
    });
  }

  async function onGenerateInterviewPrepDraft() {
    if (entityType !== "candidate" || !selectedInterviewPrep || interviewPrepGenerating) return;
    await generateInterviewPrepDraft(
      selectedInterviewPrep,
      interviewPrepContactKeys,
      interviewPrepData,
    );
  }

  async function generateInterviewPrepDraft(
    interview: InterviewPrepInterview,
    contactKeys: string[],
    data: InterviewPrepData | null,
  ) {
    setInterviewPrepGenerating(true);
    try {
      const [initRes, draftRes] = await Promise.all([
        fetch("/api/mail/compose-init"),
        fetch("/api/ai-workspace/interview-prep", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            candidateId: entityId,
            interviewId: interview.id,
            contactKeys,
          }),
        }),
      ]);
      if (!initRes.ok) throw new Error(`compose-init failed (${initRes.status})`);
      const draftPayload = (await draftRes.json().catch(() => null)) as
        | { subject?: string; body?: string; error?: string }
        | null;
      if (!draftRes.ok) {
        throw new Error(draftPayload?.error ?? `interview-prep failed (${draftRes.status})`);
      }
      if (!draftPayload?.subject || !draftPayload.body) {
        throw new Error("interview-prep returned an empty draft");
      }
      const init = (await initRes.json()) as {
        templates: import("@/app/email/actions").ActiveTemplateSummary[];
        user: { firstName: string; fullName: string };
      };
      const toEmail =
        recipientEmail ?? data?.candidate.email ?? interviewPrepData?.candidate.email ?? "";
      if (!toEmail) {
        toast.warning("Candidate has no email", {
          description: "The draft opened with a blank To field.",
        });
      }
      composer.open({
        defaultTo: toEmail,
        defaultSubject: draftPayload.subject,
        defaultBody: markdownToCleanHtml(draftPayload.body),
        templates: init.templates,
        mergeContext: {
          user: {
            firstName: init.user.firstName,
            fullName: init.user.fullName,
          },
        },
        candidateRef: entityId,
        modalTitle: "Interview Prep",
        nonBlocking: true,
      });
      setInterviewPrepOpen(false);
    } catch (err) {
      toast.error("Couldn't prep interview email", {
        description: err instanceof Error ? err.message : "unknown error",
      });
    } finally {
      setInterviewPrepGenerating(false);
    }
  }

  async function onClear() {
    if (!confirm("Clear this conversation? This can't be undone.")) return;
    try {
      await fetch(
        `/api/ai-workspace?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`,
        { method: "DELETE" },
      );
    } catch {
      // Still clear locally — the server may have persisted partial state.
    }
    setMessages([]);
    setErrorText(null);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void onSend();
    }
  }

  // The greyed tail of not-yet-final dictated words, plus the separator
  // that will be inserted when it commits. Kept as one string so the
  // onChange handler below can strip exactly what it rendered.
  const interimSuffix = interimText
    ? `${input.length > 0 && !/\s$/.test(input) ? " " : ""}${interimText}`
    : "";
  const composerValue = input + interimSuffix;

  // The textarea renders `input + interimSuffix` but only `input` is real.
  // While dictating, a keystroke arrives as the full rendered string plus
  // the edit — so if the interim tail is still intact, peel it back off and
  // keep only the typed part. If the edit landed inside the tail (the
  // recruiter selected over it), drop the interim entirely and take the new
  // value as-is; the recognizer will re-emit those words as a final phrase
  // anyway.
  function onComposerChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value;
    if (interimSuffix && next.endsWith(interimSuffix)) {
      setInput(next.slice(0, next.length - interimSuffix.length));
      return;
    }
    if (interimSuffix) setInterimText("");
    setInput(next);
  }

  // Keep the caret pinned to the end while dictating. Each new interim
  // result re-renders a longer value; without this the caret would sit
  // wherever it was and the recruiter would watch text appear behind it.
  useEffect(() => {
    if (!dictation.listening) return;
    const el = textareaRef.current;
    if (!el || document.activeElement !== el) return;
    el.selectionStart = el.selectionEnd = el.value.length;
    el.scrollTop = el.scrollHeight;
  }, [composerValue, dictation.listening]);

  // Rows auto-expand between 2 and 6 based on the newline count in the
  // current input. Matches the user's spec: 2 rows default, 6 rows ceiling,
  // Enter sends, Shift+Enter newline.
  const rows = Math.min(6, Math.max(2, composerValue.split("\n").length));

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    if (sending) return;
    void addFiles(Array.from(e.dataTransfer.files));
  };

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (sending) return;
    const files = Array.from(e.clipboardData.files).filter((file) => Boolean(attachmentMeta(file)));
    if (files.length > 0) {
      e.preventDefault();
      void addFiles(files);
      return;
    }
    const pastedText = e.clipboardData.getData("text");
    if (!pastedText) return;
    const selectionLength = Math.max(
      0,
      e.currentTarget.selectionEnd - e.currentTarget.selectionStart,
    );
    const nextLength = input.length - selectionLength + pastedText.length;
    if (nextLength > GAME_PLAN_USER_MESSAGE_MAX_CHARS) {
      toast.warning("Game Plan paste limit reached", {
        description: `Only the first ${GAME_PLAN_USER_MESSAGE_MAX_CHARS.toLocaleString()} characters will be kept.`,
      });
    }
  };

  return (
    // Sticky-footer chassis: the card is a fixed-height flex column
    // sized to the visible viewport minus the page chrome above it
    // (app header + profile header + tabs + outer padding). The
    // messages region is `flex-1 min-h-0 overflow-y-auto` so it
    // claims all leftover height inside the card and scrolls
    // internally. The composer is `shrink-0` so it always anchors
    // the bottom of the card. `sticky top-4` keeps the card pinned
    // while the parent page scrolls behind it.
    //
    // Height = 100dvh − bottomGapRem (default 22rem). `dvh` (dynamic
    // viewport height) tracks the actually-visible viewport on mobile
    // when the URL bar collapses, so the composer doesn't fall off the
    // bottom there. bottomGapRem reserves the page chrome above plus a
    // clearance below for the fixed bottom-right Delete button; client
    // and job pages pass a larger value because their KPI stat row
    // makes the header taller than the candidate page this was first
    // tuned against. `min-h-[360px]` is a floor for very small
    // viewports so the card doesn't collapse below usable size; on
    // those screens the composer may sit a hair below the fold but the
    // layout stays coherent.
    //
    // Why a single `h-` instead of the prior `min-h` + `max-h`
    // pair: a min/max range produced an indeterminate intrinsic
    // height that, combined with an inner `maxHeight: 55vh` cap on
    // the messages region, let the composer slide below the
    // viewport on shorter screens. A single resolved height makes
    // the flex math deterministic.
    <div
      ref={cardRef}
      style={{ height: `calc(100dvh - ${bottomGapRem}rem + ${heightDelta}px)` }}
      onDragEnter={(e) => {
        e.preventDefault();
        if (!sending) setDragging(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!sending) setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDragging(false);
      }}
      onDrop={onDrop}
      className={cn(
        "sticky top-4 flex min-h-[360px] flex-col overflow-hidden rounded-xl border bg-white shadow-sm dark:bg-court-surface",
        dragging
          ? "border-brand ring-2 ring-brand/30"
          : "border-court-border",
      )}
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-court-border px-5 py-3">
        <h2 className="min-w-0 font-serif text-base font-semibold text-court-fg">
          {title ?? "AI Workspace"}
        </h2>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {entityType === "candidate" && (
            <div className="relative flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => onCandidateQuickAction("call-prep")}
                disabled={sending}
                className="h-7 gap-1 px-2 py-1 text-[11px] font-medium text-court-fg-muted hover:border-brand/60"
                title={CANDIDATE_CALL_PREP_PROMPT}
                aria-label="Ask Call Prep prompt"
              >
                <PhoneCall className="h-3 w-3" /> Call Prep
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => onCandidateQuickAction("rank")}
                disabled={sending}
                className="h-7 gap-1 px-2 py-1 text-[11px] font-medium text-court-fg-muted hover:border-brand/60"
                title={CANDIDATE_RANK_PROMPT}
                aria-label="Rank candidate"
              >
                <Gauge className="h-3 w-3" /> Rank
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void onInterviewPrepClick()}
                disabled={sending || interviewPrepLoading || interviewPrepGenerating}
                className="h-7 gap-1 px-2 py-1 text-[11px] font-medium text-court-fg-muted hover:border-brand/60"
                title="Draft an interview prep email"
                aria-expanded={interviewPrepOpen}
                aria-label="Draft Interview Prep Email"
              >
                {interviewPrepGenerating || interviewPrepLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <CalendarCheck className="h-3 w-3" />
                )}
                Interview Prep
              </Button>
              {candidateJobAction && candidateJobOptions.length > 1 && (
                <div
                  role="menu"
                  aria-label={`Choose job for ${
                    candidateJobAction === "rank" ? "Rank" : "Call Prep"
                  }`}
                  className="absolute right-0 top-full z-30 mt-2 w-80 overflow-hidden rounded-lg border border-court-border bg-court-surface shadow-lg"
                >
                  <div className="flex items-center justify-between gap-3 border-b border-court-border px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-court-fg">
                        Which job?
                      </div>
                      <div className="truncate text-[11px] text-court-fg-muted">
                        {candidateJobAction === "rank" ? "Rank" : "Prep"} this candidate for one associated job.
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setCandidateJobAction(null)}
                      className="h-7 w-7 shrink-0 gap-0 p-0 shadow-none"
                      aria-label="Close job picker"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="max-h-72 overflow-y-auto py-1">
                    {candidateJobOptions.map((job) => (
                      <Button
                        key={job.key}
                        type="button"
                        variant="ghost"
                        size="sm"
                        role="menuitem"
                        onClick={() => onPickCandidateQuickActionJob(job)}
                        className="block h-auto w-full rounded-none px-3 py-2 text-left shadow-none hover:bg-court-accent-tint/40"
                      >
                        <div className="truncate text-xs font-medium text-court-fg">
                          {job.jobTitle || "Untitled job"}
                        </div>
                        <div className="truncate text-[11px] text-court-fg-muted">
                          {[job.clientName, job.location, job.stage]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={() => void onClear()}
            disabled={messages.length === 0 || sending}
            className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:border-red-300 hover:text-red-600 disabled:opacity-40"
            title="Clear this conversation"
          >
            <Trash2 className="h-3 w-3" /> Clear
          </button>
        </div>
      </div>

      {entityType === "candidate" && interviewPrepOpen && (
        <InterviewPrepPanel
          data={interviewPrepData}
          loading={interviewPrepLoading}
          generating={interviewPrepGenerating}
          selectedInterviewId={selectedInterviewPrep?.id ?? interviewPrepInterviewId}
          selectedContactKeys={interviewPrepContactKeys}
          onSelectInterview={onSelectInterviewPrep}
          onToggleContact={onToggleInterviewPrepContact}
          onGenerate={() => void onGenerateInterviewPrepDraft()}
          onClose={() => setInterviewPrepOpen(false)}
        />
      )}

      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto px-5 py-4"
      >
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-court-fg-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-center text-sm text-court-fg-muted">
            No conversation yet. Ask anything about this {emptyLabel}.
          </div>
        ) : (
          <ul className="space-y-4">
            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                recipientEmail={recipientEmail ?? null}
                entityType={entityType}
                entityId={entityId}
                candidateRef={
                  entityType === "candidate" ? entityId : undefined
                }
              />
            ))}
          </ul>
        )}
      </div>

      <div className="shrink-0 border-t border-court-border bg-white p-4 pb-6 dark:bg-court-surface">
        {dragging && (
          <div className="mb-3 rounded-lg border border-dashed border-brand bg-brand/10 px-3 py-2 text-sm font-medium text-court-fg">
            Drop a screenshot, PDF, or DOCX here and I’ll read it with this {emptyLabel} context.
          </div>
        )}
        {attachments.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {attachments.map((attachment) => (
              <div
                key={attachment.id}
                className="group flex max-w-full items-center gap-2 rounded-lg border border-court-border bg-court-surface-subtle/60 px-2 py-1.5 text-xs text-court-fg"
              >
                {attachment.kind === "image" && attachment.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={attachment.previewUrl}
                    alt=""
                    className="h-8 w-8 rounded border border-court-border object-cover"
                  />
                ) : (
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-court-border bg-court-surface text-court-fg-muted">
                    <FileText className="h-4 w-4" />
                  </span>
                )}
                <div className="min-w-0">
                  <div className="max-w-[160px] truncate font-medium">{attachment.name}</div>
                  <div className="text-[11px] text-court-fg-muted">{formatFileSize(attachment.size)}</div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onRemoveAttachment(attachment)}
                  className="h-7 w-7 shrink-0 rounded p-0 text-court-fg-muted hover:bg-court-border/50 hover:text-red-600"
                  aria-label={`Remove ${attachment.name}`}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
        {dictation.listening && (
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-red-600">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-70" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-600" />
            </span>
            Listening… talk as long as you like, then click the mic to stop.
          </div>
        )}
        {dictation.error && !dictation.listening && (
          <div className="mb-2 text-xs text-red-600">{dictation.error}</div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={composerValue}
            onChange={onComposerChange}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            maxLength={GAME_PLAN_USER_MESSAGE_MAX_CHARS}
            rows={rows}
            // No example text inside the compose box. The box stays empty
            // on job, client, and candidate Game Plan alike (one textarea
            // serves all three entityTypes). Same empty-placeholder
            // convention as the Matches tab filter inputs. The
            // "No conversation yet" line above the composer still says
            // what this workspace is for.
            placeholder=""
            disabled={sending || attachmentUploading}
            className={cn(
              "flex-1 resize-none rounded-lg border border-court-border bg-court-surface-subtle/40 px-3 py-2 text-sm text-court-fg",
              "focus:border-brand focus:bg-court-surface focus:outline-none focus:ring-2 focus:ring-brand/20",
              "disabled:cursor-not-allowed disabled:opacity-60",
            )}
          />
          {/* Voice dictation. Hidden outright on browsers with no
              SpeechRecognition (Firefox) rather than shown dead — the
              recruiter uses Chrome and Safari on the laptop and the
              installed PWA on iOS, all three of which support it. There is
              no time or character limit on a session: the hook restarts
              recognition under the hood whenever the browser ends it, so
              one click holds the mic open until the next click. */}
          {dictation.supported && (
            <Button
              type="button"
              size="md"
              variant={dictation.listening ? "reject" : "secondary"}
              onClick={dictation.toggle}
              disabled={sending || attachmentUploading}
              aria-pressed={dictation.listening}
              aria-label={dictation.listening ? "Stop dictation" : "Dictate with your voice"}
              title={dictation.listening ? "Stop dictation" : "Dictate with your voice"}
              className="shrink-0 px-3"
            >
              {dictation.listening ? (
                <Square className="h-4 w-4 fill-current" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
            </Button>
          )}
          <Button
            type="button"
            size="md"
            onClick={() => void onSend()}
            disabled={
              (!input.trim() && attachments.length === 0) ||
              sending ||
              attachmentUploading
            }
          >
            {sending || attachmentUploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : attachments.length > 0 && !input.trim() ? (
              attachments.some((a) => a.kind === "pdf" || a.kind === "docx") ? (
                <FileText className="h-4 w-4" />
              ) : (
                <ImageIcon className="h-4 w-4" />
              )
            ) : (
              <Send className="h-4 w-4" />
            )}
            Send
          </Button>
        </div>
        {errorText && (
          <div className="mt-2 text-xs text-red-600">{errorText}</div>
        )}
        {inputNearLimit && (
          <div className="mt-1 text-right text-[11px] text-court-fg-muted">
            {input.length.toLocaleString()} / {GAME_PLAN_USER_MESSAGE_MAX_CHARS.toLocaleString()}
          </div>
        )}
      </div>

      {/* Drag-to-resize handle. Pointer-captured so the drag keeps
          tracking even when the cursor leaves the thin strip; grows the
          card height as the recruiter drags down. Double-click resets to
          the default height. touch-none stops the page from scrolling
          mid-drag on touch devices. */}
      <div
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        onPointerCancel={onResizePointerUp}
        onDoubleClick={onResizeReset}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Drag to resize the workspace. Double-click to reset."
        title="Drag to resize · double-click to reset"
        className="group flex shrink-0 cursor-ns-resize touch-none select-none items-center justify-center border-t border-court-border bg-court-surface py-1.5 transition hover:bg-court-surface-subtle"
      >
        <span className="h-1 w-10 rounded-full bg-court-border transition group-hover:bg-court-fg-muted/60" />
      </div>
    </div>
  );
}

function InterviewPrepPanel({
  data,
  loading,
  generating,
  selectedInterviewId,
  selectedContactKeys,
  onSelectInterview,
  onToggleContact,
  onGenerate,
  onClose,
}: {
  data: InterviewPrepData | null;
  loading: boolean;
  generating: boolean;
  selectedInterviewId: string;
  selectedContactKeys: string[];
  onSelectInterview: (interviewId: string) => void;
  onToggleContact: (key: string) => void;
  onGenerate: () => void;
  onClose: () => void;
}) {
  const selectedInterview =
    data?.interviews.find((interview) => interview.id === selectedInterviewId) ??
    data?.interviews[0] ??
    null;
  const contactOptions = selectedInterview?.contactOptions ?? [];
  const selectedCount = selectedContactKeys.length;
  const hasInterviews = Boolean(data && data.interviews.length > 0);

  return (
    <div className="shrink-0 border-b border-court-border bg-court-surface-subtle/40 px-5 py-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
        <label className="min-w-0 flex-1">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-court-fg-muted">
            Interview
          </span>
          {loading && !data ? (
            <div className="flex h-9 items-center gap-2 rounded-md border border-court-border bg-court-surface px-3 text-xs text-court-fg-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading interviews…
            </div>
          ) : hasInterviews ? (
            <select
              value={selectedInterview?.id ?? ""}
              onChange={(event) => onSelectInterview(event.target.value)}
              className="h-9 w-full rounded-md border border-court-border bg-court-surface px-3 text-sm text-court-fg shadow-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
            >
              {data!.interviews.map((interview) => (
                <option key={interview.id} value={interview.id}>
                  {interview.label}
                </option>
              ))}
            </select>
          ) : (
            <div className="flex h-9 items-center rounded-md border border-court-border bg-court-surface px-3 text-xs text-court-fg-muted">
              No scheduled interviews found.
            </div>
          )}
        </label>

        <div className="relative min-w-0 lg:w-[260px]">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-court-fg-muted">
            Interviewing With
          </span>
          <details className="group relative">
            <summary
              className={cn(
                "flex h-9 cursor-pointer list-none items-center justify-between gap-2 rounded-md border border-court-border bg-court-surface px-3 text-sm text-court-fg shadow-sm transition hover:border-brand/50 [&::-webkit-details-marker]:hidden",
                (!hasInterviews || loading) && "pointer-events-none opacity-60",
              )}
            >
              <span className="truncate">
                {contactOptions.length === 0
                  ? "No contacts"
                  : selectedCount === 0
                    ? "Choose contacts"
                    : `${selectedCount} selected`}
              </span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-court-fg-muted transition group-open:rotate-180" />
            </summary>
            <div className="absolute right-0 z-20 mt-1 max-h-72 w-full min-w-[260px] overflow-y-auto rounded-md border border-court-border bg-court-surface p-1 shadow-lg">
              {contactOptions.length === 0 ? (
                <div className="px-3 py-2 text-xs text-court-fg-muted">
                  No client contacts are attached to this interview.
                </div>
              ) : (
                contactOptions.map((contact) => (
                  <label
                    key={contact.key}
                    className="flex cursor-pointer items-start gap-2 rounded px-2 py-2 text-sm text-court-fg transition hover:bg-court-surface-subtle"
                  >
                    <input
                      type="checkbox"
                      checked={selectedContactKeys.includes(contact.key)}
                      onChange={() => onToggleContact(contact.key)}
                      className="mt-0.5 h-4 w-4 rounded border-court-border accent-brand"
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{contact.name}</span>
                      <span className="block truncate text-xs text-court-fg-muted">
                        {[contact.title, contact.linkedin ? "LinkedIn" : null, contact.source === "scheduled" ? "scheduled" : null]
                          .filter(Boolean)
                          .join(" · ") || contact.email || "Client contact"}
                      </span>
                    </span>
                  </label>
                ))
              )}
            </div>
          </details>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={onGenerate}
            disabled={!selectedInterview || loading || generating}
            className="h-9 gap-1.5"
          >
            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
            Draft
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-9 w-9 p-0 text-court-fg-muted"
            aria-label="Close Interview Prep"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  recipientEmail,
  entityType,
  entityId,
  candidateRef,
}: {
  message: Message;
  recipientEmail: string | null;
  entityType: "client" | "candidate" | "job";
  entityId: string;
  candidateRef?: string;
}) {
  const isUser = message.role === "user";
  // Hide the copy affordance on the "Thinking…" placeholder — copying that
  // placeholder text is never useful and would just be noise while the
  // real response streams in.
  const showCopy = !isUser && message.content.trim().length > 0 && message.content !== "Thinking…";

  // Copy interceptor: when the recruiter selects an assistant bubble and
  // Cmd+C's it into Gmail / Outlook / etc., the browser would normally
  // serialize the selection with the bubble's computed styles
  // (bg-court-surface-subtle in particular). That painted a black
  // background onto the pasted email body and the destination's own
  // theme couldn't override it.
  //
  // We rewrite the clipboard payload here. If the user picked the whole
  // bubble (or nearly all of it), we hand over the full markdown source
  // converted to clean semantic HTML — same headings + bullets + links
  // as the rendered bubble but with zero classes / inline styles, so
  // Gmail can paint it on its own white canvas. For partial selections
  // we fall back to the selection toString (we can't infer which slice
  // of the source markdown the user selected).
  const onCopy = (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (isUser) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;
    if (!e.clipboardData) return;
    const selected = selection.toString();
    // Heuristic: if the selection covers most of the rendered bubble
    // (within ~10% of the message length), assume the user wanted the
    // whole thing and use the full markdown source. Otherwise fall back
    // to a per-selection cleanup so we don't include text the user
    // didn't actually pick.
    const wholeBubble =
      selected.length >= Math.max(40, message.content.length * 0.7);
    if (wholeBubble) {
      e.clipboardData.setData("text/html", markdownToCleanHtml(message.content));
      e.clipboardData.setData(
        "text/plain",
        flattenMarkdownForClipboard(message.content),
      );
    } else {
      const range = selection.getRangeAt(0);
      const wrapper = document.createElement("div");
      wrapper.appendChild(range.cloneContents());
      wrapper.querySelectorAll("*").forEach((el) => {
        if (!(el instanceof HTMLElement)) return;
        el.removeAttribute("style");
        el.removeAttribute("class");
      });
      e.clipboardData.setData("text/html", wrapper.innerHTML);
      e.clipboardData.setData(
        "text/plain",
        flattenMarkdownForClipboard(selected),
      );
    }
    e.preventDefault();
  };

  return (
    <li className={cn("flex flex-col", isUser ? "items-end" : "items-start")}>
      <div
        onCopy={onCopy}
        className={cn(
          // Bubble recipe copied verbatim from phone-view.tsx so the Game
          // Plan chat reads identically to the SMS thread: user = outbound
          // (right, solid brand green, white), Claude = inbound (left,
          // court-fg/10, court-fg).
          "relative max-w-[75%] break-words rounded-2xl px-4 py-2.5 font-sans text-sm shadow-sm",
          isUser
            ? "rounded-br-sm bg-court-brand text-white"
            : "rounded-bl-sm bg-court-fg/10 text-court-fg",
          // Extra bottom padding on assistant bubbles so the Copy button at
          // absolute bottom-right doesn't overlap the last line of text.
          showCopy && "pb-7",
        )}
      >
        {isUser ? (
          // User messages stay literal — no markdown parsing of recruiter
          // input. Whitespace + line breaks preserved with the same
          // splitter the bubble used to use for both roles.
          renderWithLineBreaks(message.content)
        ) : (
          <MarkdownContent content={message.content} />
        )}
        {showCopy && <CopyButton text={message.content} />}
      </div>
      {/* Per-bubble action row. Only on assistant bubbles, only when
          there's real content to send. The Email button always runs
          the bubble through /api/ai-workspace/format-email first, so
          the popup opens with a generated subject line and a clean
          candidate-ready body (greeting + content, no recruiter-side
          meta commentary, no "Want me to draft outreach?" trailing
          questions, no double signature). */}
      {!isUser && showCopy && recipientEmail && (
        <div className="mt-1 flex items-center gap-2">
          <EmailThisButton
            email={recipientEmail}
            entityType={entityType}
            entityId={entityId}
            candidateRef={candidateRef}
            content={message.content}
          />
        </div>
      )}
      <div className="mt-1 text-xs text-court-fg-muted">
        {formatTimestamp(message.createdAt)}
      </div>
    </li>
  );
}

// Markdown renderer for assistant bubbles. react-markdown handles the
// link / bold / list / paragraph cases the system prompt asks Claude to
// emit; remark-gfm adds bare-URL autolinks and tables. Links are forced
// to open in a new tab with rel="noopener noreferrer" so a candidate
// page never gets navigated away when the recruiter clicks a job
// listing. Tailwind classes mirror the bubble's existing token palette
// — no global "prose" plugin needed for this scope.
//
// Exported for reuse in the global Claude Panel so both surfaces render
// assistant content identically.
export function MarkdownContent({
  content,
  onInternalLinkClick,
}: {
  content: string;
  onInternalLinkClick?: (href: string) => void;
}) {
  return (
    <div className="space-y-2 [&_p]:my-0 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_strong]:font-semibold [&_h1]:mt-2 [&_h1]:font-semibold [&_h2]:mt-2 [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:font-semibold [&_code]:rounded [&_code]:bg-court-border/40 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children, ...rest }) => {
            const internalHref = resolveInternalMarkdownHref(href);
            const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
              if (!internalHref || !onInternalLinkClick) return;
              event.preventDefault();
              onInternalLinkClick(internalHref);
            };
            return (
              <a
                {...rest}
                href={href}
                target={internalHref && onInternalLinkClick ? undefined : "_blank"}
                rel={internalHref && onInternalLinkClick ? undefined : "noopener noreferrer"}
                onClick={handleClick}
                className="text-court-accent-dark underline underline-offset-2 hover:opacity-80"
              >
                {children}
              </a>
            );
          },
        }}
      >
        {escapeBareOrderedMarkers(collapseProseHardBreaks(content))}
      </ReactMarkdown>
    </div>
  );
}

function resolveInternalMarkdownHref(href: string | undefined): string | null {
  if (!href) return null;
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  if (typeof window === "undefined") return null;
  try {
    const url = new URL(href, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

// Strip CommonMark hard-break syntax from prose so a wrap mid-sentence
// in the model output doesn't render as a visible <br>. Two trailing
// spaces before \n and a backslash before \n both signal "force <br>"
// to ReactMarkdown; removing them turns them into ordinary newlines,
// which CommonMark collapses to a space within a paragraph. Paragraph
// breaks (blank lines = \n\n) are untouched, so structure survives.
function collapseProseHardBreaks(content: string): string {
  return content.replace(/[ \t]{2,}\n/g, "\n").replace(/\\\n/g, "\n");
}

// A line holding nothing but a number and a dot is valid CommonMark for an
// ordered list — "94608." parses to <ol start="94608"><li></li></ol>, an
// EMPTY list item whose "94608." marker is rendered by the browser outside
// the content box (list-outside). In the chat bubble that marker escaped the
// bubble's left edge and got clipped, so asking Ace for a zip code printed a
// half-visible number hanging off the panel.
//
// Escaping the delimiter makes the line render as the plain paragraph it was
// always meant to be. Real lists are untouched: this only matches when the
// marker is ALONE on the line, and a genuine list item has its content on the
// same line ("1. First"), so it never matches. CommonMark accepts both "1."
// and "1)" as ordered markers, hence both delimiters here.
//
// Only the delimiter is escaped, not the digits, so the visible text is
// unchanged — the reader still sees exactly "94608."
function escapeBareOrderedMarkers(content: string): string {
  return content.replace(/^([ \t]*\d{1,9})([.)])[ \t]*$/gm, "$1\\$2");
}

// Flatten Game Plan markdown into clean plaintext for the clipboard.
// Drops `### / ## / #` heading markers, `**bold**` / `*italic*` markers,
// normalizes bullets (`-`, `*`, `•`) to a clean `- `, collapses blank
// lines to single newlines, and converts `[text](url)` to `text - url`
// so a paste into Gmail / iMessage / SMS reads as formatted text and
// not as raw markdown punctuation.
export function flattenMarkdownForClipboard(input: string): string {
  let out = input.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_match, text: string, url: string) => `${text} - ${url}`,
  );
  // Strip leading heading markers.
  out = out.replace(/^#{1,6}\s+/gm, "");
  // Normalize bullets BEFORE italic strip so a "* item" line never
  // gets eaten by the italic regex.
  out = out.replace(/^[ \t]*[-*•]\s+/gm, "- ");
  // Bold before italic so a single `*` inside `**...**` doesn't trigger
  // the italic rule early.
  out = out.replace(/\*\*([^*]+)\*\*/g, "$1");
  // Italic — word-boundary-ish guards stop us from eating stray `*` in
  // URLs or unmatched single asterisks.
  out = out.replace(/(^|[^*\w])\*([^*\n]+)\*(?=[^*\w]|$)/g, "$1$2");
  // Collapse 2+ consecutive newlines (blank lines) to a single newline.
  out = out.replace(/\n{2,}/g, "\n");
  return out;
}

// Lightweight markdown → semantic HTML for clipboard payloads. Handles
// the cases Claude actually emits in the AI Workspace: links, bold,
// italic, headings, ordered + unordered lists, paragraphs, line breaks.
// Output uses zero classes / inline styles, so a paste into Gmail /
// Outlook / Word inherits the destination's theme — no dark background
// dragged along from the source bubble.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderMarkdownInline(text: string): string {
  // Process inline markdown — link / bold / italic — on a single string.
  // The regex order matters: bold before italic (so **x** doesn't get
  // half-eaten by the italic rule), links last so the inner [text] hasn't
  // been touched yet.
  let out = text.replace(
    /\*\*([^*]+)\*\*/g,
    (_m, inner) => `<strong>${escapeHtml(inner)}</strong>`,
  );
  out = out.replace(
    /(^|\W)\*([^*]+)\*(\W|$)/g,
    (_m, pre, inner, post) =>
      `${pre}<em>${escapeHtml(inner)}</em>${post}`,
  );
  out = out.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_m, label: string, url: string) =>
      `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`,
  );
  // Auto-link bare URLs that aren't already wrapped in an anchor.
  out = out.replace(
    /(^|[\s])(https?:\/\/[^\s<]+)/g,
    (_m, pre: string, url: string) =>
      `${pre}<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`,
  );
  return out;
}

export function markdownToCleanHtml(input: string): string {
  const lines = decodeCommonHtmlEntities(input).split(/\r?\n/);
  const out: string[] = [];
  let listKind: "ul" | "ol" | null = null;
  // Running counter so consecutive `<ol>` blocks separated by paragraph
  // text continue numbering. Game Plan output puts a description
  // paragraph + an apply link between each numbered role, which forces
  // us to close the `<ol>` and reopen it when the next number arrives.
  // Without `start=`, every reopened `<ol>` restarted at 1 and the
  // candidate's email read "1. … 1. … 1. …". Reset to 0 only when we
  // hit a real section break (heading, `---`, or a bold "Section …" /
  // "Open Roles" / "Broader …" pseudo-header).
  let olCount = 0;
  const closeList = () => {
    if (listKind) {
      out.push(`</${listKind}>`);
      listKind = null;
    }
  };
  for (const raw of lines) {
    const line = raw.replace(/^\s+|\s+$/g, "");
    if (!line) {
      // Blank lines between list items are normal markdown — they
      // don't terminate the list.
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      closeList();
      olCount = 0;
      const level = heading[1].length;
      out.push(`<h${level}>${renderMarkdownInline(heading[2])}</h${level}>`);
      continue;
    }
    if (/^---+$/.test(line)) {
      closeList();
      olCount = 0;
      out.push("<hr>");
      continue;
    }
    // Bold pseudo-header lines like `**Open Roles**` or
    // `**Broader job-board searches to watch**` mark the boundary
    // between Section 1 (numbered) and Section 2 (bullets), and they
    // mean the next `<ol>` should start fresh at 1.
    if (/^\*\*[^*]+\*\*\s*$/.test(line)) {
      closeList();
      olCount = 0;
      out.push(`<p>${renderMarkdownInline(line)}</p>`);
      continue;
    }
    const bullet = line.match(/^[-*•]\s+(.+)$/);
    if (bullet) {
      if (listKind !== "ul") {
        closeList();
        out.push("<ul>");
        listKind = "ul";
      }
      out.push(`<li>${renderMarkdownInline(bullet[1])}</li>`);
      continue;
    }
    const numbered = line.match(/^\d+\.\s+(.+)$/);
    if (numbered) {
      if (listKind !== "ol") {
        closeList();
        out.push(olCount > 0 ? `<ol start="${olCount + 1}">` : "<ol>");
        listKind = "ol";
      }
      out.push(`<li>${renderMarkdownInline(numbered[1])}</li>`);
      olCount++;
      continue;
    }
    closeList();
    out.push(`<p>${renderMarkdownInline(line)}</p>`);
  }
  closeList();
  return out.join("\n");
}

// Ghost icon button pinned to the bottom-right of an assistant bubble.
// Copies the message after flattening markdown links to "text - url"
// form so a paste into iMessage / SMS / plaintext email leaves a bare
// URL the destination client can auto-linkify. Headers + bullet
// markers stay as-is — they're cosmetically harmless in plaintext and
// some clients still highlight them. Shows a checkmark for 2s on
// success.
export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(flattenMarkdownForClipboard(text));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can fail in non-secure contexts or with permissions
      // denied. Silent fail is fine here — the UX still works on localhost
      // and the deployed HTTPS site, which are the only places Ace runs.
    }
  }

  return (
    <button
      type="button"
      onClick={() => void onCopy()}
      aria-label={copied ? "Copied" : "Copy message"}
      title={copied ? "Copied" : "Copy to clipboard"}
      className="absolute bottom-1 right-1 inline-flex h-6 w-6 items-center justify-center rounded-md text-court-fg-muted/70 transition hover:bg-court-border/40 hover:text-court-fg"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

// Preserve hard newlines but don't parse markdown — spec said \n → <br>
// and nothing more. Rendered as fragments so React keeps its keying sane.
function renderWithLineBreaks(content: string): React.ReactNode {
  const parts = content.split("\n");
  return parts.map((line, idx) => (
    <span key={idx}>
      {line}
      {idx < parts.length - 1 && <br />}
    </span>
  ));
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (sameDay) return time;
    return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} · ${time}`;
  } catch {
    return iso;
  }
}

// "Email this" button on assistant bubbles. Always runs the bubble
// through /api/ai-workspace/format-email before opening the composer
// so the popup gets a generated subject line and a candidate-ready
// body — never the raw bubble (which often contains "Want me to
// draft outreach?" / "Let me know which interests you" recruiter-side
// commentary). Andrew's signature is set up in Ace and is appended on
// send, so the format endpoint strips any trailing "Talk soon, Andrew
// Kraig / BreakPoint Talent" the model emitted to avoid double-signing.
export function EmailThisButton({
  email,
  entityType,
  entityId,
  candidateRef,
  content,
}: {
  email: string;
  // "panel" is the sentinel used by the global Claude Panel — no
  // entity context, so format-email skips the candidate lookup and
  // defaults the greeting to "Hi there,". The recruiter retypes the
  // recipient in the composer's To: field.
  entityType: "client" | "candidate" | "job" | "panel";
  entityId: string;
  candidateRef?: string;
  content: string;
}) {
  const composer = useComposerManager();
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    try {
      const [initRes, formatRes] = await Promise.all([
        fetch("/api/mail/compose-init"),
        fetch("/api/ai-workspace/format-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entityType, entityId, content }),
        }),
      ]);
      if (!initRes.ok) {
        throw new Error(`compose-init failed (${initRes.status})`);
      }
      if (!formatRes.ok) {
        const errBody = await formatRes.json().catch(() => ({}));
        throw new Error(errBody?.error ?? `format-email failed (${formatRes.status})`);
      }
      const init = (await initRes.json()) as {
        templates: import("@/app/email/actions").ActiveTemplateSummary[];
        user: { firstName: string; fullName: string };
      };
      const { subject, body } = (await formatRes.json()) as {
        subject: string;
        body: string;
      };
      composer.open({
        defaultTo: email,
        defaultSubject: subject,
        defaultBody: markdownToCleanHtml(body),
        templates: init.templates,
        mergeContext: {
          user: {
            firstName: init.user.firstName,
            fullName: init.user.fullName,
          },
        },
        candidateRef,
        nonBlocking: true,
      });
    } catch (err) {
      toast.error("Couldn't prep email", {
        description: err instanceof Error ? err.message : "unknown error",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={busy}
      className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:border-brand/40 hover:text-court-fg disabled:opacity-60"
    >
      {busy ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Mail className="h-3 w-3" />
      )}
      {busy ? "Preparing…" : "Email this"}
    </button>
  );
}

export default AiWorkspace;
