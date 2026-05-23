"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { FileText, Image as ImageIcon, Loader2, Paperclip, Send, X } from "lucide-react";
import { toast } from "sonner";
import {
  CLAUDE_PANEL_MIN_H,
  CLAUDE_PANEL_MIN_W,
  useClaudePanel,
} from "@/lib/claude-panel-context";
import { useFloatingZ } from "@/lib/floating-z";
import { useComposerManager } from "@/lib/composer-manager";
import { Button } from "@/components/ui/button";
import { INPUT_FRAME_CLASS, INPUT_CONTROL_CLASS } from "@/components/ui/input";
import {
  CopyButton,
  EmailThisButton,
  MarkdownContent,
  markdownToCleanHtml,
} from "@/components/AiWorkspace";

// Floating, draggable, resizable Claude chat panel. Mirrors the
// FloatingThreadWindow pattern: portal to document.body, GPU-composited
// drag via translate3d, will-change + CSS contain so layout/paint stay
// scoped to the panel itself. Default dock is bottom-right of the
// viewport at 420x560 (set in claude-panel-context).
//
// Send flow: persist the user turn to /api/claude-panel/messages,
// append an empty assistant bubble locally, stream tokens from
// /api/claude-panel/chat into that bubble, then persist the assembled
// assistant turn. The chat route is computation-only — persistence
// stays exclusively in /messages so a stream interruption can't leave
// half a row in Neon.

type ChatMessage = {
  kind: "message";
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

// Server-resolved fields the card renders verbatim. The chat route
// looks up display names + canonical cuids before emitting so the
// card always shows real names ("Move Lesley Snell from Interviewing
// → Kept on Operations Administrator") instead of falling back to
// "(unknown)" when Claude hands us a numeric rfId.
type MoveResolved = {
  kind: "move_candidate_stage";
  description: string;
  candidateName: string;
  fromStage: string;
  toStage: string;
  jobTitle: string;
  candidateId: string | null;
  placementId: string | null;
};
type NoteResolved = {
  kind: "add_note";
  description: string;
  entityType: "candidate" | "client" | "job";
  entityId: string | null;
  entityName: string;
  note: string;
};
type DraftEmailResolved = {
  kind: "draft_email";
  description: string;
  to: string;
  subject: string;
  body: string;
};
type LifecycleJobResolved = {
  kind: "inactivate_job" | "privatize_job" | "reactivate_job";
  description: string;
  jobId: string | null;
  jobTitle: string;
  clientName: string;
  currentLifecycle: "active" | "private" | "inactive" | null;
  targetLifecycle: "active" | "private" | "inactive";
  noOp: boolean;
};
type DeleteJobResolved = {
  kind: "delete_job";
  description: string;
  jobId: string | null;
  jobTitle: string;
  clientName: string;
};
type DeleteCandidateResolved = {
  kind: "delete_candidate";
  description: string;
  candidateId: string | null;
  candidateName: string;
};
type ResetActivityLogResolved = {
  kind: "reset_activity_log";
  description: string;
  count: number;
  dateFromIso: string | null;
  dateToIso: string | null;
  dateFromLabel: string;
  dateToLabel: string;
};
type ResetPlacementsResolved = {
  kind: "reset_placements";
  description: string;
  count: number;
  placementIds: string[];
  previewRows: Array<{
    id: string;
    candidateName: string;
    jobTitle: string;
    stage: string;
    placedAtLabel: string;
  }>;
  dateFromIso: string | null;
  dateToIso: string | null;
  stage: string | null;
};
type UpdatePlacementFieldResolved = {
  kind: "update_placement_field";
  description: string;
  placementId: string | null;
  candidateName: string;
  jobTitle: string;
  fieldName: "placedAt" | "startConfirmedAt" | "stage" | "feeAmount" | "offerReceivedAt";
  oldValueLabel: string;
  newValueLabel: string;
  newValueRaw: string | number | null;
  validationError: string | null;
};
type UnknownResolved = { kind: "unknown"; description: string };
type ActionResolved =
  | MoveResolved
  | NoteResolved
  | DraftEmailResolved
  | LifecycleJobResolved
  | DeleteJobResolved
  | DeleteCandidateResolved
  | ResetActivityLogResolved
  | ResetPlacementsResolved
  | UpdatePlacementFieldResolved
  | UnknownResolved;

type ActionToolName =
  | "move_candidate_stage"
  | "add_note"
  | "draft_email"
  | "inactivate_job"
  | "privatize_job"
  | "reactivate_job"
  | "delete_job"
  | "delete_candidate"
  | "reset_activity_log"
  | "reset_placements"
  | "update_placement_field";

type ActionCard = {
  kind: "action";
  id: string;            // tool_use id from Anthropic
  name: ActionToolName;
  input: Record<string, unknown>;
  resolved: ActionResolved;
  status: "pending" | "running" | "confirmed" | "cancelled";
  resultMessage?: string;
};

type RenderItem = ChatMessage | ActionCard;

// Sentinel id assigned to the assistant bubble while it's streaming.
// Replaced with the persisted cuid once the final POST resolves.
const STREAMING_ID = "__streaming__";

// Composer attachment. Lives in component state until the user hits
// Send, at which point it's forwarded to /api/claude-panel/chat as a
// multi-block message and dropped. We never persist the binary payload
// — only a "[Attached: name]" marker is appended to the stored user
// content so the History tab still shows what was attached.
type Attachment = {
  id: string;
  kind: "image" | "pdf" | "text";
  name: string;
  size: number;
  // For image/pdf: base64-encoded payload (no data URL prefix).
  // For text: the file contents.
  data: string;
  // image/png, image/jpeg, application/pdf, etc.
  mediaType: string;
};

// Caps tuned to Anthropic's per-image guidance (~5MB) with headroom
// for inflation through base64. Total prevents wedging the request
// body past the Next.js / Vercel edge limit.
const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024; // 10MB per file
const ATTACHMENT_TOTAL_MAX_BYTES = 25 * 1024 * 1024; // 25MB combined
// Anthropic accepts these image media types natively; anything else
// has to fall through the text branch.
const ANTHROPIC_IMAGE_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);
// File extensions we'll happily slurp as plain text even when the MIME
// type is empty (drag-and-drop from some apps doesn't set one).
const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".jsonl",
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
  ".py", ".rb", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".hpp",
  ".html", ".htm", ".css", ".scss", ".sass", ".less",
  ".xml", ".yaml", ".yml", ".toml", ".ini", ".env",
  ".log", ".sql", ".sh", ".bash", ".zsh", ".fish",
  ".vue", ".svelte", ".astro",
]);

function attachmentId(): string {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function fileExtension(name: string): string {
  const ix = name.lastIndexOf(".");
  return ix >= 0 ? name.slice(ix).toLowerCase() : "";
}

function isTextLikeFile(file: File): boolean {
  if (file.type.startsWith("text/")) return true;
  if (file.type === "application/json") return true;
  if (file.type === "application/xml") return true;
  if (file.type === "application/x-yaml") return true;
  return TEXT_EXTENSIONS.has(fileExtension(file.name));
}

async function fileToBase64(file: File | Blob): Promise<string> {
  // FileReader.readAsDataURL gives us "data:<mime>;base64,<payload>".
  // The Anthropic image block wants only the <payload>, so we slice
  // past the comma.
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

async function fileToText(file: File | Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsText(file);
  });
}

async function readAttachment(file: File): Promise<Attachment | null> {
  if (file.size > ATTACHMENT_MAX_BYTES) {
    toast.error(`${file.name} is too large`, {
      description: `Files must be under ${Math.round(ATTACHMENT_MAX_BYTES / 1024 / 1024)}MB`,
    });
    return null;
  }
  const mime = file.type || "";
  // Images that Claude can read natively → base64 image block.
  if (mime.startsWith("image/")) {
    if (!ANTHROPIC_IMAGE_MIME.has(mime)) {
      toast.error(`${file.name}: unsupported image type`, {
        description: "PNG, JPEG, GIF, or WebP only",
      });
      return null;
    }
    const data = await fileToBase64(file);
    return {
      id: attachmentId(),
      kind: "image",
      name: file.name || "screenshot.png",
      size: file.size,
      data,
      mediaType: mime,
    };
  }
  // PDFs → base64 document block (Claude reads native PDFs).
  if (mime === "application/pdf" || fileExtension(file.name) === ".pdf") {
    const data = await fileToBase64(file);
    return {
      id: attachmentId(),
      kind: "pdf",
      name: file.name || "document.pdf",
      size: file.size,
      data,
      mediaType: "application/pdf",
    };
  }
  // Everything text-shaped → text block. We don't try to handle Word
  // docs, .pages, etc. — those need conversion the model can't do.
  if (isTextLikeFile(file)) {
    const text = await fileToText(file);
    return {
      id: attachmentId(),
      kind: "text",
      name: file.name || "file.txt",
      size: file.size,
      data: text,
      mediaType: mime || "text/plain",
    };
  }
  toast.error(`${file.name}: can't read this file`, {
    description: "Try an image, PDF, or text file",
  });
  return null;
}

// Fresh conversationId generator. crypto.randomUUID is available in
// every browser the panel runs in (Next.js targets ES2020+); the
// time-prefix fallback is only there to satisfy TS narrowing in
// non-DOM rendering paths and shouldn't ever fire in production.
function newConversationId(): string {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID) {
    return `conv-${globalThis.crypto.randomUUID()}`;
  }
  return `conv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function ClaudePanel() {
  const {
    open,
    position,
    size,
    entityType,
    entityId,
    close,
    setPosition,
    setSize,
  } = useClaudePanel();
  const { z, bringToFront } = useFloatingZ(open);

  const composer = useComposerManager();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [items, setItems] = useState<RenderItem[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [entityName, setEntityName] = useState<string | null>(null);
  // Active Claude Panel conversation id. Persisted to localStorage so
  // a Clear-then-close-then-reopen cycle still shows the empty new
  // bucket (and the cleared transcript stays parked in History).
  // null on first mount before hydration; Clear Chat rotates it to a
  // fresh uuid so subsequent posts tag the new conversation.
  const [conversationId, setConversationId] = useState<string | null>(null);
  // Composer attachments. Cleared after each successful send. Never
  // persisted — see the Attachment type comment above.
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  // Dashed-border drop overlay visibility. Tracked separately from a
  // simple boolean because nested elements fire dragenter/dragleave
  // pairs as the cursor moves over them; a counter keeps the overlay
  // open until every nested enter has been matched by a leave.
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const dragDepthRef = useRef(0);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const addFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    const currentTotal = attachments.reduce((s, a) => s + a.size, 0);
    let runningTotal = currentTotal;
    const next: Attachment[] = [];
    for (const f of files) {
      if (runningTotal + f.size > ATTACHMENT_TOTAL_MAX_BYTES) {
        toast.error("Attachments too large", {
          description: `Total over ${Math.round(ATTACHMENT_TOTAL_MAX_BYTES / 1024 / 1024)}MB`,
        });
        break;
      }
      const att = await readAttachment(f);
      if (att) {
        next.push(att);
        runningTotal += f.size;
      }
    }
    if (next.length > 0) {
      setAttachments((prev) => [...prev, ...next]);
    }
  }, [attachments]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Hydrate transcript on first open. Resolves the active
  // conversationId from localStorage (or whatever the server says is
  // latest if there's no client-side override yet) and pulls the rows
  // for that conversation. Re-running on every open keeps the panel
  // in sync if another tab on the same org has been chatting.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const stored =
          typeof window !== "undefined"
            ? window.localStorage.getItem("claude-panel-conv-id")
            : null;
        const url = stored
          ? `/api/claude-panel/messages?conversationId=${encodeURIComponent(stored)}`
          : "/api/claude-panel/messages";
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          conversationId: string | null;
          messages: Array<{
            id: string;
            role: "user" | "assistant";
            content: string;
            createdAt: string;
          }>;
        };
        if (cancelled) return;
        // Resolve the active conversation id: client override wins,
        // then the server's "latest" wins, finally a freshly minted
        // id when there's no history at all.
        const resolvedId = stored ?? data.conversationId ?? newConversationId();
        setConversationId(resolvedId);
        if (typeof window !== "undefined") {
          window.localStorage.setItem("claude-panel-conv-id", resolvedId);
        }
        setItems(
          data.messages.map((m) => ({
            kind: "message" as const,
            id: m.id,
            role: m.role,
            content: m.content,
            createdAt: m.createdAt,
          })),
        );
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Auto-scroll to bottom on mount and whenever a new message lands.
  // listRef.scrollTop = scrollHeight is the cheapest way; behavior:
  // "smooth" feels laggy when the panel is already at-bottom.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [open, items]);

  // Resolve the active entity's display name for the header pill.
  // Runs on every type/id change (i.e. client navigation) so the pill
  // tracks the URL even when the panel stays open across pages.
  // Cleared when the route leaves a candidate/client/job page.
  useEffect(() => {
    if (!entityType || !entityId) {
      setEntityName(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/claude-panel/entity-name?type=${encodeURIComponent(entityType)}&id=${encodeURIComponent(entityId)}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { ok?: boolean; name?: string | null };
        if (cancelled) return;
        setEntityName(typeof data?.name === "string" ? data.name : null);
      } catch {
        if (!cancelled) setEntityName(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entityType, entityId]);

  // Auto-grow the textarea up to ~6 rows. Reset to auto first so
  // shrinking on backspace works.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  // Window-resize re-clamp. If the viewport shrinks (window resize,
  // dev-tools docking, browser zoom changing inner dimensions), pull a
  // now-out-of-bounds panel back inside so it doesn't get stranded
  // beyond the right/bottom edge with no way to grab it.
  useEffect(() => {
    if (!position) return;
    function onResize() {
      if (!position) return;
      const maxX = Math.max(0, window.innerWidth - size.w);
      const maxY = Math.max(0, window.innerHeight - size.h);
      const clampedX = Math.max(0, Math.min(maxX, position.x));
      const clampedY = Math.max(0, Math.min(maxY, position.y));
      if (clampedX !== position.x || clampedY !== position.y) {
        setPosition({ x: clampedX, y: clampedY });
      }
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [position, size.w, size.h, setPosition]);

  const onHeaderPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest("button")) return;
      const node = panelRef.current;
      if (!node || !position) return;
      // setPointerCapture routes all subsequent pointer events back to
      // the captured element until release — even if the cursor leaves
      // the browser window, drags across an iframe, or the user lifts
      // the mouse over a different app. The previous window-level
      // listener pattern stranded the drag in those cases (Mac users
      // releasing onto the desktop kept the panel "stuck" to the
      // cursor with no pointerup firing). We also handle pointercancel
      // and lostpointercapture as terminal events for the same reason.
      const target = e.currentTarget;
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        // Some browsers throw when the pointer is already captured
        // elsewhere; the rest of the drag still works without it.
      }
      e.preventDefault();
      e.stopPropagation();
      const startPx = e.clientX;
      const startPy = e.clientY;
      const startX = position.x;
      const startY = position.y;
      let dx = 0;
      let dy = 0;
      let rafId = 0;
      node.style.willChange = "transform";
      const flush = () => {
        rafId = 0;
        node.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      };
      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return;
        const rawDx = ev.clientX - startPx;
        const rawDy = ev.clientY - startPy;
        // Live clamp: derive dx/dy from a viewport-clamped absolute
        // position so the panel can't visibly leave the window during
        // drag. The pointerup commit at the bottom also clamps, but it
        // fires after the user has already seen the panel half off-
        // screen; clamping in the move loop keeps the edge "sticky".
        const maxX = Math.max(0, window.innerWidth - size.w);
        const maxY = Math.max(0, window.innerHeight - size.h);
        const clampedX = Math.max(0, Math.min(maxX, startX + rawDx));
        const clampedY = Math.max(0, Math.min(maxY, startY + rawDy));
        dx = clampedX - startX;
        dy = clampedY - startY;
        if (rafId === 0) rafId = requestAnimationFrame(flush);
      };
      const finish = () => {
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", finish);
        target.removeEventListener("pointercancel", finish);
        target.removeEventListener("lostpointercapture", finish);
        try {
          target.releasePointerCapture(e.pointerId);
        } catch {
          // ignore — capture may already be released by the browser
        }
        if (rafId !== 0) cancelAnimationFrame(rafId);
        node.style.transform = "";
        node.style.willChange = "";
        // Clamp to viewport so the panel can't be dragged off-screen.
        const maxX = Math.max(0, window.innerWidth - size.w);
        const maxY = Math.max(0, window.innerHeight - size.h);
        setPosition({
          x: Math.max(0, Math.min(maxX, startX + dx)),
          y: Math.max(0, Math.min(maxY, startY + dy)),
        });
      };
      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", finish);
      target.addEventListener("pointercancel", finish);
      target.addEventListener("lostpointercapture", finish);
    },
    [position, size, setPosition],
  );

  // Generic corner-resize handler. Each corner pins the OPPOSITE corner
  // and lets the dragged corner move — so a top-left drag grows the
  // panel up-and-left while the bottom-right corner stays put. Width
  // and height (and, for tl/bl, left/top) are mutated directly during
  // drag for the same GPU-friendly reason the BR-only handler used,
  // then committed to context state on pointerup so the next render
  // pins the new geometry via React style props.
  const onCornerPointerDown = useCallback(
    (corner: "tl" | "bl" | "br") =>
      (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        const node = panelRef.current;
        if (!node || !position) return;
        // Same setPointerCapture pattern as the header drag — see that
        // handler for why window listeners get stranded.
        const target = e.currentTarget;
        try {
          target.setPointerCapture(e.pointerId);
        } catch {
          // capture may be unavailable; rest of the resize still works
        }
        e.preventDefault();
        const startPx = e.clientX;
        const startPy = e.clientY;
        const startW = size.w;
        const startH = size.h;
        const startX = position.x;
        const startY = position.y;
        let nextW = startW;
        let nextH = startH;
        let nextX = startX;
        let nextY = startY;
        let rafId = 0;
        node.style.willChange = "width, height, left, top";
        const flush = () => {
          rafId = 0;
          node.style.width = `${nextW}px`;
          node.style.height = `${nextH}px`;
          node.style.left = `${nextX}px`;
          node.style.top = `${nextY}px`;
        };
        const onMove = (ev: PointerEvent) => {
          if (ev.pointerId !== e.pointerId) return;
          const dx = ev.clientX - startPx;
          const dy = ev.clientY - startPy;
          if (corner === "br") {
            nextW = Math.max(CLAUDE_PANEL_MIN_W, startW + dx);
            nextH = Math.max(CLAUDE_PANEL_MIN_H, startH + dy);
          } else if (corner === "bl") {
            nextW = Math.max(CLAUDE_PANEL_MIN_W, startW - dx);
            nextH = Math.max(CLAUDE_PANEL_MIN_H, startH + dy);
            // Pin the right edge: left moves only by however much the
            // width actually changed (which the MIN_W clamp may shrink).
            nextX = startX + (startW - nextW);
          } else {
            // tl: pin the bottom-right corner.
            nextW = Math.max(CLAUDE_PANEL_MIN_W, startW - dx);
            nextH = Math.max(CLAUDE_PANEL_MIN_H, startH - dy);
            nextX = startX + (startW - nextW);
            nextY = startY + (startH - nextH);
          }
          if (rafId === 0) rafId = requestAnimationFrame(flush);
        };
        const finish = () => {
          target.removeEventListener("pointermove", onMove);
          target.removeEventListener("pointerup", finish);
          target.removeEventListener("pointercancel", finish);
          target.removeEventListener("lostpointercapture", finish);
          try {
            target.releasePointerCapture(e.pointerId);
          } catch {
            // ignore
          }
          if (rafId !== 0) cancelAnimationFrame(rafId);
          node.style.willChange = "";
          setSize({ w: nextW, h: nextH });
          setPosition({ x: nextX, y: nextY });
        };
        target.addEventListener("pointermove", onMove);
        target.addEventListener("pointerup", finish);
        target.addEventListener("pointercancel", finish);
        target.addEventListener("lostpointercapture", finish);
      },
    [position, size, setPosition, setSize],
  );

  async function persist(role: "user" | "assistant", content: string): Promise<ChatMessage> {
    // Lazily mint a conversationId if the user types into the panel
    // before the hydrate effect has resolved one (e.g. a fresh page
    // load with localStorage cleared). Without this, the first
    // message of a brand-new conversation lands as NULL and joins the
    // legacy bucket on the History tab — surprising for the user.
    let convId = conversationId;
    if (!convId) {
      convId = newConversationId();
      setConversationId(convId);
      if (typeof window !== "undefined") {
        window.localStorage.setItem("claude-panel-conv-id", convId);
      }
    }
    const res = await fetch("/api/claude-panel/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, content, conversationId: convId }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const row = (await res.json()) as {
      id: string;
      role: "user" | "assistant";
      content: string;
      createdAt: string;
    };
    return { kind: "message", ...row };
  }

  async function send() {
    const text = draft.trim();
    // Send is allowed when there's text OR at least one attachment.
    // "Look at this screenshot" with no caption is a legitimate prompt.
    if ((!text && attachments.length === 0) || sending) return;
    setSending(true);
    setDraft("");
    // Snapshot attachments now and clear the composer chips; the in-flight
    // request still references the snapshot via `turnAttachments`.
    const turnAttachments = attachments;
    setAttachments([]);
    // Build the persisted user content: the user's text plus a short
    // marker per attachment so the History tab still shows what came
    // along. The binary payload itself never hits Postgres.
    const attachmentMarker = turnAttachments
      .map((a) => `[Attached: ${a.name}]`)
      .join("\n");
    const persistedUserText = [text, attachmentMarker]
      .filter((s) => s.length > 0)
      .join("\n\n");
    // Optimistic user bubble — replaced with the server-assigned cuid
    // once the /messages POST resolves.
    const tempUserId = `tmp-${Date.now()}`;
    const optimisticUser: ChatMessage = {
      kind: "message",
      id: tempUserId,
      role: "user",
      content: persistedUserText,
      createdAt: new Date().toISOString(),
    };
    // Snapshot the prior chat history BEFORE adding the optimistic user
    // bubble so we can hand Claude a clean transcript ending in this
    // turn's user content (built below) without the temp row's
    // unsaved client-only id. Action cards aren't part of the API
    // history — only message rows are.
    const priorHistory = items
      .filter((it): it is ChatMessage => it.kind === "message")
      .map((m) => ({ role: m.role, content: m.content }));
    setItems((prev) => [...prev, optimisticUser]);

    let userRow: ChatMessage;
    try {
      userRow = await persist("user", persistedUserText);
      setItems((prev) =>
        prev.map((it) =>
          it.kind === "message" && it.id === tempUserId ? userRow : it,
        ),
      );
    } catch {
      // /messages POST failed — roll back the optimistic bubble and
      // restore the draft so the user can retry without losing input.
      // Attachments don't come back (one-shot), same as ChatGPT.
      setItems((prev) =>
        prev.filter((it) => !(it.kind === "message" && it.id === tempUserId)),
      );
      setDraft(text);
      setSending(false);
      return;
    }

    // Append a streaming-placeholder assistant bubble that the NDJSON
    // deltas accumulate into. The pulsing cursor lives inside this
    // bubble while id === STREAMING_ID; the swap to the persisted
    // cuid (or removal on error) hides the cursor.
    setItems((prev) => [
      ...prev,
      {
        kind: "message",
        id: STREAMING_ID,
        role: "assistant",
        content: "",
        createdAt: new Date().toISOString(),
      },
    ]);

    let assembled = "";
    let streamErr: string | null = null;
    const pendingActions: ActionCard[] = [];
    try {
      const res = await fetch("/api/claude-panel/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // History stays as strings (text-only) so prior turns don't
          // re-upload images. The current turn carries `attachments`
          // separately so the server can convert just the last user
          // message into a multi-block content array.
          messages: [
            ...priorHistory,
            // Fallback to a one-character placeholder when the user
            // sent only attachments — Anthropic's API rejects an
            // empty trailing user text block, and the server's
            // existing trim/skip drops empty content. The attachments
            // themselves still carry the meaning.
            { role: "user", content: text || "(see attached)" },
          ],
          attachments: turnAttachments.map((a) => ({
            kind: a.kind,
            name: a.name,
            mediaType: a.mediaType,
            data: a.data,
          })),
          entityType,
          entityId,
        }),
      });
      if (!res.ok || !res.body) {
        let err = `Chat failed (${res.status})`;
        try {
          const j = await res.json();
          if (typeof j?.error === "string") err = j.error;
        } catch {
          // body wasn't JSON — keep the status-based error
        }
        throw new Error(err);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const handleLine = (raw: string) => {
        const line = raw.trim();
        if (!line) return;
        let event: {
          t?: unknown;
          text?: unknown;
          error?: unknown;
          id?: unknown;
          name?: unknown;
          input?: unknown;
          resolved?: unknown;
        };
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }
        if (event.t === "delta" && typeof event.text === "string") {
          assembled += event.text;
          setItems((prev) =>
            prev.map((it) =>
              it.kind === "message" && it.id === STREAMING_ID
                ? { ...it, content: assembled }
                : it,
            ),
          );
        } else if (
          event.t === "action_pending" &&
          typeof event.id === "string" &&
          (event.name === "move_candidate_stage" ||
            event.name === "add_note" ||
            event.name === "draft_email" ||
            event.name === "inactivate_job" ||
            event.name === "privatize_job" ||
            event.name === "reactivate_job" ||
            event.name === "delete_job" ||
            event.name === "delete_candidate" ||
            event.name === "reset_activity_log" ||
            event.name === "reset_placements" ||
            event.name === "update_placement_field")
        ) {
          const input =
            event.input && typeof event.input === "object"
              ? (event.input as Record<string, unknown>)
              : {};
          const resolvedRaw = event.resolved;
          const resolved: ActionResolved =
            resolvedRaw && typeof resolvedRaw === "object"
              ? (resolvedRaw as ActionResolved)
              : {
                  kind: "unknown",
                  description: `Confirm action: ${event.name}`,
                };
          const card: ActionCard = {
            kind: "action",
            id: event.id,
            name: event.name,
            input,
            resolved,
            status: "pending",
          };
          pendingActions.push(card);
        } else if (event.t === "error") {
          streamErr =
            typeof event.error === "string" ? event.error : "Stream error";
        }
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          handleLine(line);
        }
      }
      if (buffer.trim()) handleLine(buffer);
      if (streamErr) throw new Error(streamErr);
    } catch (e) {
      // Stream blew up — drop the empty assistant bubble and surface
      // the failure via toast. The user's persisted question stays so
      // they can retry without retyping; we deliberately don't keep
      // a partial / errored assistant turn in state because feeding
      // it back into the next request just makes Claude apologize
      // for an error it didn't produce.
      const message =
        e instanceof Error ? e.message : "Chat failed unexpectedly";
      setItems((prev) =>
        prev.filter((it) => !(it.kind === "message" && it.id === STREAMING_ID)),
      );
      toast.error("Ace couldn't respond", { description: message });
      setSending(false);
      return;
    }

    // Stream finished cleanly. Persist whatever assistant text Claude
    // streamed (often empty when the turn was just a tool_use) and
    // swap the streaming bubble. If the bubble has no content AND
    // there's at least one pending action card, drop the empty
    // bubble entirely — the action card carries the visible meaning.
    if (assembled.trim().length === 0 && pendingActions.length > 0) {
      setItems((prev) => [
        ...prev.filter((it) => !(it.kind === "message" && it.id === STREAMING_ID)),
        ...pendingActions,
      ]);
      setSending(false);
      return;
    }

    try {
      const assistantRow = await persist("assistant", assembled);
      setItems((prev) => [
        ...prev.map((it) =>
          it.kind === "message" && it.id === STREAMING_ID ? assistantRow : it,
        ),
        ...pendingActions,
      ]);
    } catch {
      // Stream succeeded but persistence failed — keep the bubble
      // visible with the assembled content but mark it as unsaved by
      // dropping the streaming sentinel. Next page load won't show
      // this turn; a subsequent send will continue cleanly.
      setItems((prev) => [
        ...prev.map((it) =>
          it.kind === "message" && it.id === STREAMING_ID
            ? { ...it, id: `unsaved-${Date.now()}` }
            : it,
        ),
        ...pendingActions,
      ]);
    } finally {
      setSending(false);
    }
  }

  // Confirm/Cancel handlers for action cards. Both flows persist a
  // synthetic assistant message describing the outcome so the History
  // tab and any future page-load shows a complete record. Cancel never
  // hits /api/claude-panel/action — there's nothing to roll back.
  async function handleConfirmAction(actionId: string) {
    const card = items.find(
      (it): it is ActionCard => it.kind === "action" && it.id === actionId,
    );
    if (!card || card.status !== "pending") return;
    setItems((prev) =>
      prev.map((it) =>
        it.kind === "action" && it.id === actionId
          ? { ...it, status: "running" as const }
          : it,
      ),
    );
    try {
      // Send `resolved` alongside `input` — the action route prefers
      // resolved.candidateId/placementId because those are already
      // canonical cuids in this org, sidestepping a second rfId↔cuid
      // round trip server-side.
      const res = await fetch("/api/claude-panel/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: card.name,
          input: card.input,
          resolved: card.resolved,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
        openComposer?: boolean;
        to?: string;
        subject?: string;
        body?: string;
        redirect?: string;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      // draft_email branch: pop the global mail composer with the
      // pre-filled draft. The recruiter still has to click Send.
      if (data.openComposer) {
        composer.open({
          defaultTo: data.to ?? "",
          defaultSubject: data.subject ?? "",
          defaultBody: markdownToCleanHtml(data.body ?? ""),
          templates: [],
          mergeContext: { user: { firstName: "", fullName: "" } },
          nonBlocking: true,
        });
      }
      // delete_job (and any future redirect-bearing action) sends the
      // recruiter off the now-deleted detail page back to the list.
      // Use router.push so Next preserves panel + composer state, then
      // refresh so the /jobs list reflects the missing row.
      if (typeof data.redirect === "string" && data.redirect.length > 0) {
        router.push(data.redirect);
        router.refresh();
      } else {
        // Non-redirecting actions (close_job, move_candidate_stage,
        // add_note) still need a refresh so the page the recruiter is
        // currently on shows the change.
        router.refresh();
      }
      const resultMessage = data.message ?? "Action completed.";
      setItems((prev) =>
        prev.map((it) =>
          it.kind === "action" && it.id === actionId
            ? { ...it, status: "confirmed" as const, resultMessage }
            : it,
        ),
      );
      try {
        const row = await persist("assistant", resultMessage);
        setItems((prev) => [...prev, row]);
      } catch {
        // Persistence failure is non-fatal — the card already shows
        // the result inline, and the user's next chat turn will work.
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Action failed";
      toast.error("Couldn't run action", { description: message });
      setItems((prev) =>
        prev.map((it) =>
          it.kind === "action" && it.id === actionId
            ? { ...it, status: "pending" as const }
            : it,
        ),
      );
    }
  }

  async function handleCancelAction(actionId: string) {
    const card = items.find(
      (it): it is ActionCard => it.kind === "action" && it.id === actionId,
    );
    if (!card || card.status !== "pending") return;
    setItems((prev) =>
      prev.map((it) =>
        it.kind === "action" && it.id === actionId
          ? {
              ...it,
              status: "cancelled" as const,
              resultMessage: "Action cancelled.",
            }
          : it,
      ),
    );
    try {
      const row = await persist("assistant", "Action cancelled.");
      setItems((prev) => [...prev, row]);
    } catch {
      // Persistence failure is non-fatal — see handleConfirmAction.
    }
  }

  async function clearChat() {
    if (clearing || items.length === 0) return;
    setClearing(true);
    try {
      // Rotate the active conversationId rather than DELETE'ing rows.
      // Old messages stay in Neon under the old conversationId and
      // surface as their own entry on Settings → Claude History; the
      // new id starts a fresh bucket once the user types again.
      const next = newConversationId();
      setConversationId(next);
      if (typeof window !== "undefined") {
        window.localStorage.setItem("claude-panel-conv-id", next);
      }
      setItems([]);
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Clear failed unexpectedly";
      toast.error("Couldn't clear chat", { description: message });
    } finally {
      setClearing(false);
    }
  }

  if (!mounted || !open || !position) return null;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Ace Assistant"
      onPointerDownCapture={bringToFront}
      // Native file drag/drop. dataTransfer.types includes "Files" only
      // when the drag originates from the OS file picker / Finder, not
      // for in-page text/element drags — that gate keeps the overlay
      // from flashing when the recruiter is just dragging selected
      // text around inside the panel.
      onDragEnter={(e) => {
        if (!Array.from(e.dataTransfer.types).includes("Files")) return;
        e.preventDefault();
        dragDepthRef.current += 1;
        if (dragDepthRef.current === 1) setIsDraggingFile(true);
      }}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes("Files")) e.preventDefault();
      }}
      onDragLeave={(e) => {
        if (!Array.from(e.dataTransfer.types).includes("Files")) return;
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setIsDraggingFile(false);
      }}
      onDrop={(e) => {
        if (!Array.from(e.dataTransfer.types).includes("Files")) return;
        e.preventDefault();
        dragDepthRef.current = 0;
        setIsDraggingFile(false);
        const dropped = Array.from(e.dataTransfer.files);
        if (dropped.length > 0) void addFiles(dropped);
      }}
      className="pointer-events-auto fixed flex flex-col overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-[0_8px_40px_rgba(0,0,0,0.35),0_2px_12px_rgba(0,0,0,0.25)] dark:shadow-[0_8px_40px_rgba(0,0,0,0.55),0_2px_12px_rgba(0,0,0,0.35)]"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: `${size.w}px`,
        height: `${size.h}px`,
        zIndex: z,
        contain: "layout paint",
      }}
    >
      <div
        onPointerDown={onHeaderPointerDown}
        style={{ touchAction: "none" }}
        className="flex shrink-0 cursor-grab select-none items-center gap-2 border-b border-court-border px-4 py-2 active:cursor-grabbing"
      >
        <div className="flex flex-1 items-center gap-2 min-w-0">
          <span className="font-serif text-base font-medium text-court-fg">
            Ace Assistant
          </span>
          {entityName && (
            <span
              title={entityName}
              className="truncate rounded-full bg-court-surface-subtle px-2 py-0.5 text-xs text-court-fg"
            >
              {entityName}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={clearChat}
          disabled={clearing || items.length === 0}
          className="rounded-md px-2 py-1 text-[11px] font-medium text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg disabled:opacity-50"
        >
          Clear chat
        </button>
        <button
          type="button"
          onClick={close}
          style={{ touchAction: "auto" }}
          className="rounded-md p-1 text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
          aria-label="Close panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div
        ref={listRef}
        style={{ touchAction: "pan-y" }}
        className="flex-1 overflow-y-auto px-4 py-3"
      >
        {loading && items.length === 0 ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-court-fg-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center text-sm text-court-fg-muted">
            <div className="font-serif text-court-fg">Ask Ace anything.</div>
            <div className="text-xs">
              This panel is org-scoped and persists across pages.
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {items.map((it) => {
              if (it.kind === "action") {
                return (
                  <ActionConfirmCard
                    key={it.id}
                    card={it}
                    onConfirm={() => void handleConfirmAction(it.id)}
                    onCancel={() => void handleCancelAction(it.id)}
                  />
                );
              }
              const m = it;
              const isStreaming = m.id === STREAMING_ID;
              const isUser = m.role === "user";
              const showActions = !isUser && !isStreaming && m.content.trim().length > 0;
              return (
                <div
                  key={m.id}
                  className={isUser ? "flex flex-col items-end" : "flex flex-col items-start"}
                >
                  <div
                    className={
                      // Bubble recipe copied verbatim from phone-view.tsx so
                      // the Claude panel reads identically to the SMS thread:
                      // user = outbound (solid brand green, white), Claude =
                      // inbound (court-fg/10, court-fg). max-w-[85%] stays
                      // because the floating panel is narrower than the page.
                      (isUser
                        ? "ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-court-brand px-4 py-2.5 font-sans text-sm text-white shadow-sm"
                        : "relative mr-auto max-w-[85%] rounded-2xl rounded-bl-sm bg-court-fg/10 px-4 py-2.5 font-sans text-sm text-court-fg shadow-sm") +
                      (showActions ? " pb-7" : "")
                    }
                  >
                    {isUser ? (
                      <div className="whitespace-pre-wrap break-words">
                        {m.content}
                      </div>
                    ) : (
                      <>
                        <MarkdownContent content={m.content} />
                        {isStreaming && (
                          <span
                            aria-hidden="true"
                            className="ml-0.5 inline-block h-3.5 w-[2px] -translate-y-px animate-pulse bg-court-brand align-middle"
                          />
                        )}
                      </>
                    )}
                    {showActions && <CopyButton text={m.content} />}
                  </div>
                  {showActions && (
                    <div className="mt-1 flex items-center gap-2">
                      <EmailThisButton
                        email=""
                        entityType="panel"
                        entityId="global"
                        content={m.content}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-court-border bg-court-surface px-3 py-2">
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachments.map((a) => (
              <AttachmentChip
                key={a.id}
                attachment={a}
                onRemove={() => removeAttachment(a.id)}
              />
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            // Images, PDFs, common text formats. Browsers honor this
            // loosely so readAttachment still gates everything by MIME +
            // extension server-side of the picker.
            accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/*,.md,.csv,.json,.ts,.tsx,.js,.jsx,.py,.go,.rs,.java,.html,.css,.yaml,.yml,.toml,.ini,.log,.sql,.sh,.xml"
            onChange={(e) => {
              const list = e.target.files;
              if (!list) return;
              void addFiles(Array.from(list));
              // Reset so picking the same file twice still fires onChange.
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={sending}
            aria-label="Attach files"
            title="Attach image, PDF, or text file"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-court-border bg-court-surface-subtle text-court-fg-muted transition hover:bg-court-surface hover:text-court-fg disabled:opacity-50"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <div className={`${INPUT_FRAME_CLASS} flex-1 min-w-0 !bg-white/10`}>
            <textarea
              ref={textareaRef}
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onPaste={(e) => {
                // Pull image blobs out of the clipboard so Cmd+V on a
                // screenshot drops it into the composer. Non-file paste
                // (plain text) falls through to the textarea's default
                // handler — we only preventDefault when we actually
                // claim a file.
                const items = e.clipboardData?.items;
                if (!items) return;
                const files: File[] = [];
                for (let i = 0; i < items.length; i++) {
                  const it = items[i];
                  if (it.kind === "file") {
                    const f = it.getAsFile();
                    if (f) files.push(f);
                  }
                }
                if (files.length > 0) {
                  e.preventDefault();
                  void addFiles(files);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="Message Ace…"
              style={{ touchAction: "manipulation" }}
              className={`${INPUT_CONTROL_CLASS} min-h-[44px] resize-none text-sm`}
            />
          </div>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => void send()}
            disabled={sending || (!draft.trim() && attachments.length === 0)}
            aria-label="Send message"
          >
            {sending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            Send
          </Button>
        </div>
      </div>

      {/* Corner resize handles. TL pins the bottom-right corner, BL
          pins the top-right, BR pins the top-left (the original
          mail-thread behavior). Each handle stops propagation so the
          header drag handler can't fire from a corner click. */}
      <div
        onPointerDown={onCornerPointerDown("tl")}
        aria-label="Resize from top-left"
        className="absolute left-0 top-0 z-10 h-3.5 w-3.5 cursor-nwse-resize"
        style={{
          background:
            "linear-gradient(315deg, transparent 50%, rgba(0,0,0,0.18) 50%)",
        }}
      />
      <div
        onPointerDown={onCornerPointerDown("bl")}
        aria-label="Resize from bottom-left"
        className="absolute bottom-0 left-0 z-10 h-3.5 w-3.5 cursor-nesw-resize"
        style={{
          background:
            "linear-gradient(225deg, transparent 50%, rgba(0,0,0,0.18) 50%)",
        }}
      />
      <div
        onPointerDown={onCornerPointerDown("br")}
        aria-label="Resize from bottom-right"
        className="absolute bottom-0 right-0 z-10 h-4 w-4 cursor-nwse-resize"
        style={{
          background:
            "linear-gradient(135deg, transparent 50%, rgba(0,0,0,0.18) 50%)",
        }}
      />

      {/* File drop overlay. pointer-events-none so the underlying
          dragleave/drop still fire on the real panel root; the visual
          is purely advisory. */}
      {isDraggingFile && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-court-brand bg-court-brand-tint/80">
          <div className="flex flex-col items-center gap-1 text-court-brand-dark">
            <Paperclip className="h-6 w-6" />
            <span className="font-serif text-sm font-semibold">Drop to attach</span>
            <span className="text-[11px] text-court-fg-muted">
              Images, PDFs, or text files
            </span>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: Attachment;
  onRemove: () => void;
}) {
  const Icon = attachment.kind === "image" ? ImageIcon : FileText;
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full border border-court-border bg-court-surface-subtle py-1 pl-2 pr-1 text-[11px] text-court-fg">
      <Icon className="h-3.5 w-3.5 shrink-0 text-court-fg-muted" />
      <span className="max-w-[140px] truncate" title={attachment.name}>
        {attachment.name}
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="rounded-full p-0.5 text-court-fg-muted transition hover:bg-court-surface hover:text-court-fg"
        aria-label={`Remove ${attachment.name}`}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

// Inline confirmation card. Pending state shows green Confirm + grey
// Cancel; running state disables both and spins; confirmed/cancelled
// states fade the card and show the result line so the recruiter
// has a permanent in-thread record of what happened.
function ActionConfirmCard({
  card,
  onConfirm,
  onCancel,
}: {
  card: ActionCard;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const isPending = card.status === "pending";
  const isRunning = card.status === "running";
  const isConfirmed = card.status === "confirmed";
  const isCancelled = card.status === "cancelled";
  return (
    <div
      className={
        "mr-auto w-full max-w-[95%] rounded-xl border px-3 py-2 text-sm shadow-sm" +
        (isCancelled
          ? " border-court-border bg-court-surface-subtle text-court-fg-muted"
          : isConfirmed
            ? " border-court-border bg-court-surface text-court-fg"
            : " border-court-accent/40 bg-court-surface text-court-fg")
      }
    >
      <div className="flex items-start gap-2">
        <span
          className={
            "mt-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider " +
            (card.name === "delete_job" ||
            card.name === "delete_candidate" ||
            card.name === "reset_activity_log" ||
            card.name === "reset_placements"
              ? "bg-red-100 text-red-700"
              : "bg-court-surface-subtle text-court-fg-muted")
          }
        >
          {card.name === "move_candidate_stage"
            ? "Stage move"
            : card.name === "add_note"
              ? "Note"
              : card.name === "draft_email"
                ? "Email draft"
                : card.name === "inactivate_job"
                  ? "Inactivate"
                  : card.name === "privatize_job"
                    ? "Make private"
                    : card.name === "reactivate_job"
                      ? "Reactivate"
                      : card.name === "delete_candidate"
                        ? "Delete candidate"
                        : card.name === "reset_activity_log"
                          ? "Reset activity log"
                          : card.name === "reset_placements"
                            ? "Reset placements"
                            : card.name === "update_placement_field"
                              ? "Update placement"
                              : "Delete job"}
        </span>
        <div className="min-w-0 flex-1 text-court-fg">
          <ActionCardLabel card={card} />
        </div>
      </div>
      {card.resolved.kind === "add_note" && (
        <div className="mt-2 rounded-md border border-court-border bg-court-surface-subtle px-2 py-1.5 text-xs text-court-fg-muted">
          {card.resolved.note}
        </div>
      )}
      {card.resolved.kind === "draft_email" && card.resolved.body && (
        <div className="mt-2 line-clamp-4 rounded-md border border-court-border bg-court-surface-subtle px-2 py-1.5 text-xs text-court-fg-muted">
          {card.resolved.body.slice(0, 400)}
        </div>
      )}
      {(isPending || isRunning) && (
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={onConfirm}
            disabled={isRunning}
            className="inline-flex items-center gap-1 rounded-md bg-court-brand px-3 py-1 text-xs font-semibold text-white transition hover:bg-brand-dark disabled:opacity-60"
          >
            {isRunning ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" /> Running…
              </>
            ) : (
              "Confirm"
            )}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={isRunning}
            className="rounded-md border border-court-border bg-court-surface-subtle px-3 py-1 text-xs font-medium text-court-fg-muted transition hover:bg-court-surface disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      )}
      {(isConfirmed || isCancelled) && card.resultMessage && (
        <div className="mt-2 text-xs italic text-court-fg-muted">
          {card.resultMessage}
        </div>
      )}
    </div>
  );
}

// Headline for the confirmation card. Renders the resolved fields
// directly (candidate name, from/to stages, job title) instead of a
// pre-baked sentence so the layout can emphasize the parts that
// matter — the recruiter's eye lands on names and the destination
// stage, not on grammar filler.
function ActionCardLabel({ card }: { card: ActionCard }) {
  const r = card.resolved;
  if (r.kind === "move_candidate_stage") {
    return (
      <div className="text-sm leading-snug">
        Move{" "}
        <span className="font-semibold">{r.candidateName}</span> from{" "}
        <span className="rounded bg-court-surface-subtle px-1 text-xs">
          {r.fromStage}
        </span>{" "}
        →{" "}
        <span className="rounded bg-court-brand-tint px-1 text-xs font-semibold text-court-brand-dark">
          {r.toStage || "(unknown stage)"}
        </span>{" "}
        on <span className="font-medium">{r.jobTitle}</span>.
      </div>
    );
  }
  if (r.kind === "add_note") {
    return (
      <div className="text-sm leading-snug">
        Add note to {r.entityType}{" "}
        <span className="font-semibold">{r.entityName}</span>.
      </div>
    );
  }
  if (r.kind === "draft_email") {
    return (
      <div className="text-sm leading-snug">
        Open mail composer to{" "}
        <span className="font-semibold">{r.to || "(no recipient)"}</span>{" "}
        — subject:{" "}
        <span className="italic">{r.subject || "(no subject)"}</span>
      </div>
    );
  }
  if (
    r.kind === "inactivate_job" ||
    r.kind === "privatize_job" ||
    r.kind === "reactivate_job"
  ) {
    const verb =
      r.kind === "inactivate_job"
        ? "Inactivate"
        : r.kind === "privatize_job"
          ? "Move to Private"
          : "Reactivate";
    const explainer =
      r.kind === "inactivate_job"
        ? "mark inactive — removes from the Active tab"
        : r.kind === "privatize_job"
          ? "hide from the Active tab — still searchable from Private"
          : "move back to the Active tab";
    return (
      <div className="text-sm leading-snug">
        {verb} <span className="font-semibold">{r.jobTitle}</span> at{" "}
        <span className="font-medium">{r.clientName}</span> — {explainer}.
        {r.noOp && (
          <span className="ml-1 text-xs italic text-court-fg-muted">
            (already {r.targetLifecycle})
          </span>
        )}
      </div>
    );
  }
  if (r.kind === "delete_job") {
    return (
      <div className="text-sm leading-snug">
        Permanently delete{" "}
        <span className="font-semibold">{r.jobTitle}</span> at{" "}
        <span className="font-medium">{r.clientName}</span>.{" "}
        <span className="text-xs italic text-red-600">
          This cannot be undone.
        </span>
      </div>
    );
  }
  if (r.kind === "delete_candidate") {
    return (
      <div className="text-sm leading-snug">
        Permanently delete{" "}
        <span className="font-semibold">{r.candidateName}</span>.{" "}
        <span className="text-xs italic text-red-600">
          This cannot be undone.
        </span>
      </div>
    );
  }
  if (r.kind === "reset_activity_log") {
    return (
      <div className="text-sm leading-snug">
        Delete{" "}
        <span className="font-semibold">{r.count}</span> activity log{" "}
        {r.count === 1 ? "entry" : "entries"} from{" "}
        <span className="rounded bg-court-surface-subtle px-1 text-xs">
          {r.dateFromLabel}
        </span>{" "}
        to{" "}
        <span className="rounded bg-court-surface-subtle px-1 text-xs">
          {r.dateToLabel}
        </span>
        .{" "}
        <span className="text-xs italic text-red-600">
          This cannot be undone.
        </span>
      </div>
    );
  }
  if (r.kind === "reset_placements") {
    const filterBits = [
      r.dateFromIso || r.dateToIso
        ? `${r.dateFromIso ? new Date(r.dateFromIso).toISOString().slice(0, 10) : "(beginning)"} → ${
            r.dateToIso ? new Date(r.dateToIso).toISOString().slice(0, 10) : "(now)"
          }`
        : null,
      r.stage ? `stage=${r.stage}` : null,
    ].filter(Boolean);
    return (
      <div className="text-sm leading-snug">
        <div>
          Delete <span className="font-semibold">{r.count}</span> placement
          {r.count === 1 ? "" : "s"}
          {filterBits.length > 0 && (
            <span className="text-xs text-court-fg-muted"> ({filterBits.join(", ")})</span>
          )}{" "}
          plus dependent Interview rows.{" "}
          <span className="text-xs italic text-red-600">
            This cannot be undone.
          </span>
        </div>
        {r.previewRows.length > 0 && (
          <ul className="mt-2 space-y-0.5 rounded-md border border-court-border bg-court-surface-subtle px-2 py-1.5 text-xs text-court-fg-muted">
            {r.previewRows.map((p) => (
              <li key={p.id} className="truncate">
                <span className="text-court-fg">{p.candidateName}</span>
                {" · "}
                <span>{p.jobTitle}</span>
                {" · "}
                <span className="rounded bg-court-surface px-1">{p.stage}</span>
                {" · "}
                <span>{p.placedAtLabel}</span>
              </li>
            ))}
            {r.count > r.previewRows.length && (
              <li className="italic">
                +{r.count - r.previewRows.length} more
              </li>
            )}
          </ul>
        )}
      </div>
    );
  }
  if (r.kind === "update_placement_field") {
    if (r.validationError) {
      return (
        <div className="text-sm leading-snug text-red-700">
          Cannot update <span className="font-semibold">{r.fieldName}</span> on{" "}
          <span className="font-semibold">{r.candidateName}</span>:{" "}
          <span className="italic">{r.validationError}</span>
        </div>
      );
    }
    return (
      <div className="text-sm leading-snug">
        Update <span className="font-semibold">{r.fieldName}</span> on{" "}
        <span className="font-semibold">{r.candidateName}</span> ·{" "}
        <span className="font-medium">{r.jobTitle}</span>:{" "}
        <span className="rounded bg-court-surface-subtle px-1 text-xs">
          {r.oldValueLabel}
        </span>{" "}
        →{" "}
        <span className="rounded bg-court-brand-tint px-1 text-xs font-semibold text-court-brand-dark">
          {r.newValueLabel}
        </span>
        .
      </div>
    );
  }
  return <div className="text-sm leading-snug">{r.description}</div>;
}
