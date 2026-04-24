"use client";

import { useEffect, useRef, useState } from "react";
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
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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

type AttachmentDraft = {
  key: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  dataBase64: string;
};

type Props = {
  threadId: string;
  defaultTo: string;
  defaultCc?: string;
  defaultSubject: string;
  onClose: () => void;
  onSent: () => void;
};

export function MailComposer({
  threadId,
  defaultTo,
  defaultCc,
  defaultSubject,
  onClose,
  onSent,
}: Props) {
  const [to, setTo] = useState(defaultTo);
  const [cc, setCc] = useState(defaultCc ?? "");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState(defaultSubject);
  // Default CC to visible if we pre-populated it — otherwise the user
  // won't realize extra recipients are being carried over.
  const [showCc, setShowCc] = useState(Boolean(defaultCc && defaultCc.trim()));
  const [showBcc, setShowBcc] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
    content: "",
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

  async function onSend() {
    setError(null);
    const toArr = splitAddresses(to);
    if (toArr.length === 0) {
      setError("At least one To: recipient is required.");
      return;
    }
    const ccArr = showCc ? splitAddresses(cc) : [];
    const bccArr = showBcc ? splitAddresses(bcc) : [];
    const bodyHtml = editor?.getHTML() ?? "";
    if (!stripHtml(bodyHtml).trim() && attachments.length === 0) {
      setError("Write a reply, paste content, or attach a file before sending.");
      return;
    }
    setSending(true);
    try {
      const res = await fetch(`/api/mail/threads/${encodeURIComponent(threadId)}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: toArr,
          cc: ccArr.length > 0 ? ccArr : undefined,
          bcc: bccArr.length > 0 ? bccArr : undefined,
          subject,
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
        toast.error("Couldn't send reply", { description: msg });
        return;
      }
      toast.success("Reply sent");
      onSent();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Send failed";
      setError(msg);
      toast.error("Couldn't send reply", { description: msg });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="border-t border-court-border bg-court-surface-subtle/30">
      <div className="flex items-center justify-between border-b border-court-border px-5 py-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-court-fg-muted">
          Reply
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
          aria-label="Close composer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-2 px-5 py-3">
        <AddressRow label="To" value={to} onChange={setTo} />
        <div className="flex gap-2 text-[11px] text-court-fg-muted">
          <button
            type="button"
            onClick={() => setShowCc((v) => !v)}
            className="hover:text-court-fg"
          >
            {showCc ? "− CC" : "+ CC"}
          </button>
          <button
            type="button"
            onClick={() => setShowBcc((v) => !v)}
            className="hover:text-court-fg"
          >
            {showBcc ? "− BCC" : "+ BCC"}
          </button>
        </div>
        {showCc && <AddressRow label="CC" value={cc} onChange={setCc} />}
        {showBcc && <AddressRow label="BCC" value={bcc} onChange={setBcc} />}
        <AddressRow label="Subject" value={subject} onChange={setSubject} />
      </div>

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
        className={cn(
          "mx-5 rounded-lg transition",
          dragOver && "ring-2 ring-brand/50 ring-offset-2 ring-offset-court-surface-subtle",
        )}
      >
        <EditorContent editor={editor} />
      </div>

      {attachments.length > 0 && (
        <ul className="mx-5 mt-2 space-y-1">
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

      {error && (
        <div className="mx-5 mt-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-800">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between px-5 py-3">
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
        <button
          type="button"
          onClick={onSend}
          disabled={sending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
        >
          {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
          Send
        </button>
      </div>
    </div>
  );
}

function AddressRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="w-16 shrink-0 text-[11px] uppercase tracking-wider text-court-fg-muted">
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-court-border bg-court-surface px-2 py-1 text-sm text-court-fg outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
      />
    </label>
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
    <div className="mx-5 flex items-center gap-1 border-b border-court-border py-1">
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
