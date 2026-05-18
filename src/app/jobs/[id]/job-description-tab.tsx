"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, Pencil, Save, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { marked } from "marked";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { Button, CLAUDE_PILL_CLASS } from "@/components/ui/button";
import { FindMatchesButton } from "@/components/game-plan/find-matches-button";
import type { MatchTarget } from "@/lib/find-matches-context";
import {
  saveJobGeneratedDescription,
  saveJobSearchKeywords,
} from "@/app/jobs/[id]/job-overview-actions";

// Job Description tab — single card showing the polished JD with
// Copy / Regenerate / Edit affordances. Source URL parsing now lives on
// /jobs/new (parse-on-create); the raw paste and internal-notes cards
// were retired in Ace 41 along with the legacy override card.
export function JobDescriptionTab({
  jobId,
  initialDescription,
  initialDescriptionGeneratedAt,
  initialSearchKeywords,
  jobMeta,
  matchTarget,
}: {
  jobId: string;
  initialDescription: string | null;
  initialDescriptionGeneratedAt: string | null;
  initialSearchKeywords: string | null;
  jobMeta: {
    title: string;
    clientName: string;
    location: string;
    compensation: string;
  };
  matchTarget: MatchTarget;
}) {
  const router = useRouter();
  const [generated, setGenerated] = useState<string | null>(initialDescription);
  const [generatedAt, setGeneratedAt] = useState<string | null>(initialDescriptionGeneratedAt);
  const [generating, setGenerating] = useState(false);

  async function onGenerate() {
    setGenerating(true);
    try {
      const res = await fetch("/api/jobs/generate-jd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, jobMeta }),
      });
      const data: unknown = await res.json();
      if (!res.ok || !data || typeof data !== "object" || !("ok" in data) || (data as { ok: boolean }).ok !== true) {
        const errorMsg =
          data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
            ? (data as { error: string }).error
            : "Generate failed.";
        toast.error("Couldn't generate JD", { description: errorMsg });
        return;
      }
      const ok = data as { ok: true; description: string; generatedAt: string };
      setGenerated(ok.description);
      setGeneratedAt(ok.generatedAt);
      toast.success("Job description generated.");
      router.refresh();
    } catch (e) {
      toast.error("Couldn't generate JD", {
        description: e instanceof Error ? e.message : "Network error.",
      });
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <FindMatchesButton target={matchTarget} />
        <button
          type="button"
          onClick={onGenerate}
          disabled={generating}
          className={cn(CLAUDE_PILL_CLASS, generating && "opacity-60")}
        >
          {generating ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Sparkles className="h-3 w-3" />
          )}
          {generating ? "Generating…" : "Regenerate with Claude"}
        </button>
      </div>

      <GeneratedJdCard
        jobId={jobId}
        generated={generated}
        generatedAt={generatedAt}
        generating={generating}
        onGenerate={onGenerate}
        onSavedEdit={(next) => setGenerated(next || null)}
      />

      <SearchKeywordsCard
        jobId={jobId}
        initialKeywords={initialSearchKeywords}
      />
    </div>
  );
}

// Recruiter-tunable keyword list that feeds Find Matches scoring and
// any Boolean candidate search built off this job. Plain text — the
// readers (find-matches, boolean search) split + lowercase as needed.
// Save-on-blur lets the recruiter tab away without a save button.
function SearchKeywordsCard({
  jobId,
  initialKeywords,
}: {
  jobId: string;
  initialKeywords: string | null;
}) {
  const [value, setValue] = useState(initialKeywords ?? "");
  const [saving, setSaving] = useState(false);
  // Last value successfully committed to the server. Used to short-
  // circuit no-op blurs (open → focus → blur without typing) so we
  // don't fire a write or a toast for unchanged input.
  const lastSavedRef = useRef(initialKeywords ?? "");

  async function commit() {
    const next = value.trim();
    if (next === lastSavedRef.current.trim()) return;
    setSaving(true);
    try {
      const res = await saveJobSearchKeywords({ jobId, keywords: next });
      if (!res.ok) {
        toast.error("Couldn't save keywords", { description: res.error });
        return;
      }
      lastSavedRef.current = next;
      toast.success("Keywords saved");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-court-border/40 bg-court-surface p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-serif text-lg font-semibold text-court-fg">Search Keywords</h2>
          <p className="text-[11px] text-court-fg-muted">
            Used for Find Matches scoring and Boolean candidate search.
          </p>
        </div>
        {saving && (
          <span className="inline-flex items-center gap-1 text-[11px] text-court-fg-muted">
            <Loader2 className="h-3 w-3 animate-spin" /> Saving…
          </span>
        )}
      </div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void commit()}
        rows={3}
        placeholder="e.g. python, kubernetes, terraform, distributed systems"
        className={cn(
          "mt-3 w-full resize-y rounded-md border border-court-border bg-court-bg px-3 py-2 text-sm text-court-fg shadow-sm",
          "focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20",
        )}
      />
    </div>
  );
}

function GeneratedJdCard({
  jobId,
  generated,
  generatedAt,
  generating,
  onGenerate,
  onSavedEdit,
}: {
  jobId: string;
  generated: string | null;
  generatedAt: string | null;
  generating: boolean;
  onGenerate: () => void;
  onSavedEdit: (next: string) => void;
}) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(generated ?? "");
  const [saving, startSave] = useTransition();

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  // Keep the draft in sync when the canonical generated value changes
  // (e.g. after a Regenerate round-trip refreshes the panel below).
  useEffect(() => {
    if (!editing) setDraft(generated ?? "");
  }, [generated, editing]);

  const hasDescription = !!(generated && generated.trim());

  async function onCopy() {
    if (!generated) return;
    const markdown = generated;
    const markPasted = () => {
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1600);
      toast.success("Copied to clipboard");
    };

    // Write HTML alongside plain text so a paste into Gmail / Word lands
    // with proper bold headers and bullets rather than literal '##'
    // characters. Surface the actual error if ClipboardItem rejects so
    // we can diagnose silent failures instead of fingerprinting them.
    try {
      const html = String(marked.parse(markdown, { gfm: true }));
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([markdown], { type: "text/plain" }),
        }),
      ]);
      // eslint-disable-next-line no-console
      console.log("copy path: ClipboardItem");
      markPasted();
      return;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("ClipboardItem write failed, falling back to writeText", e);
    }

    try {
      await navigator.clipboard.writeText(markdown);
      // eslint-disable-next-line no-console
      console.log("copy path: writeText fallback");
      markPasted();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("writeText fallback also failed", e);
      toast.error("Couldn't copy. Select the text manually.");
    }
  }

  function onStartEdit() {
    setDraft(generated ?? "");
    setEditing(true);
  }

  function onCancelEdit() {
    setDraft(generated ?? "");
    setEditing(false);
  }

  function onSaveEdit() {
    startSave(async () => {
      const res = await saveJobGeneratedDescription({ jobId, description: draft });
      if (!res.ok) {
        toast.error("Couldn't save", { description: res.error });
        return;
      }
      onSavedEdit(draft);
      setEditing(false);
      toast.success("Description saved");
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-court-border/40 bg-court-surface p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-serif text-lg font-semibold text-court-fg">Generated job description</h2>
          {generatedAt ? (
            <p className="text-[11px] text-court-fg-muted">
              Last generated {formatRelativeOrAbsolute(generatedAt)}
            </p>
          ) : null}
        </div>
        {!editing ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onCopy}
              disabled={!hasDescription}
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy JD"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onStartEdit}
              disabled={!hasDescription}
            >
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onCancelEdit} disabled={saving}>
              <X className="h-3.5 w-3.5" /> Cancel
            </Button>
            <Button type="button" variant="primary" size="sm" onClick={onSaveEdit} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save
            </Button>
          </div>
        )}
      </div>

      {editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={20}
          className={cn(
            "mt-3 w-full resize-y rounded-md border border-court-border bg-court-bg px-3 py-2 font-mono text-xs leading-relaxed text-court-fg shadow-sm",
            "focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20",
          )}
        />
      ) : hasDescription ? (
        <div
          className={cn(
            "mt-3 text-sm leading-relaxed text-court-fg",
            // Paragraphs + inline marks. Headings get an explicit two-step
            // scale so H2 ("A Bit About Us") sits visibly heavier than H3
            // ("Key Responsibilities"). H1 is unused in the JD format but
            // styled for safety.
            "[&_p]:mb-3 [&_p]:text-sm [&_p]:leading-relaxed",
            "[&_strong]:font-bold [&_strong]:text-court-fg",
            "[&_em]:italic",
            "[&_h1]:mb-3 [&_h1]:mt-6 [&_h1]:font-serif [&_h1]:text-2xl [&_h1]:font-extrabold [&_h1]:tracking-tight [&_h1]:text-court-fg first:[&_h1]:mt-0",
            "[&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:font-serif [&_h2]:text-xl [&_h2]:font-extrabold [&_h2]:tracking-tight [&_h2]:text-court-fg first:[&_h2]:mt-0",
            "[&_h3]:mb-1.5 [&_h3]:mt-4 [&_h3]:font-serif [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-court-fg",
            "[&_ul]:mb-3 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5",
            "[&_ul>li]:text-sm [&_ul>li]:leading-relaxed [&_ul>li]:text-court-fg",
            "[&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5",
            "[&_ol>li]:text-sm [&_ol>li]:leading-relaxed [&_ol>li]:text-court-fg",
          )}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{generated!}</ReactMarkdown>
        </div>
      ) : (
        <div className="mt-3 rounded-lg border border-dashed border-court-border bg-court-bg/40 p-6 text-center">
          <p className="text-sm text-court-fg-muted">
            No description yet. Click Regenerate with Claude above to draft one from this job&apos;s metadata.
          </p>
          <button
            type="button"
            onClick={onGenerate}
            disabled={generating}
            className={cn(CLAUDE_PILL_CLASS, "mt-3", generating && "opacity-60")}
          >
            {generating ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            {generating ? "Generating…" : "Generate with Claude"}
          </button>
        </div>
      )}
    </div>
  );
}

// "Last generated 4 minutes ago" / "Last generated on May 7, 2026 at 3:14 PM".
// Very recent timestamps render as relative; older ones fall back to a
// concrete date so the recruiter sees how stale the polished copy is.
function formatRelativeOrAbsolute(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diffMs = Date.now() - t;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `on ${new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
}
