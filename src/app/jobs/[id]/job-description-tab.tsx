"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, Pencil, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { Button, CLAUDE_PILL_CLASS } from "@/components/ui/button";
import { FindMatchesButton } from "@/components/game-plan/find-matches-button";
import type { MatchTarget } from "@/lib/find-matches-context";
import { EditableJobDescription } from "@/app/jobs/[id]/editable-job-description";
import {
  saveJobInternalRecruiterNotes,
  saveJobRawDescription,
  saveJobSourceUrl,
} from "@/app/jobs/[id]/job-overview-actions";

// Job Description tab body. The recruiter flow is:
//   1. Paste the source URL (or skip).
//   2. Hit Parse Link to fetch + extract → populates the raw textarea.
//   3. Edit the raw paste and Save Raw.
//   4. Hit Generate with Claude → polished BreakPoint-format JD lands
//      on Job.description and renders in the preview card below.
//   5. Type recruiter-only context into Internal Recruiter Notes.
//
// State for the raw paste lives on the parent so the Parse Link flow on
// the Source URL row can hand its extracted text to the raw textarea
// without reaching across two unrelated client components.
export function JobDescriptionTab({
  jobId,
  jobRfId,
  jobCuid,
  rfDescription,
  initialOverride,
  initialSourceJobUrl,
  initialRawJobDescription,
  initialDescription,
  initialDescriptionGeneratedAt,
  initialInternalRecruiterNotes,
  jobMeta,
  matchTarget,
}: {
  jobId: string;
  jobRfId: number | null;
  jobCuid: string | null;
  rfDescription: string | null;
  initialOverride: string | null;
  initialSourceJobUrl: string | null;
  initialRawJobDescription: string | null;
  initialDescription: string | null;
  initialDescriptionGeneratedAt: string | null;
  initialInternalRecruiterNotes: string | null;
  jobMeta: {
    title: string;
    clientName: string;
    location: string;
    compensation: string;
  };
  matchTarget: MatchTarget;
}) {
  const router = useRouter();
  const [rawDraft, setRawDraft] = useState<string>(initialRawJobDescription ?? "");
  const [savedRaw, setSavedRaw] = useState<string>(initialRawJobDescription ?? "");

  const [generated, setGenerated] = useState<string | null>(initialDescription);
  const [generatedAt, setGeneratedAt] = useState<string | null>(initialDescriptionGeneratedAt);
  const [generating, setGenerating] = useState(false);

  function onParseSuccess(extractedText: string) {
    setRawDraft(extractedText);
    toast.success("Parsed the link. Review and Save Raw to keep the paste.");
  }

  async function onGenerate() {
    if (!savedRaw.trim()) {
      toast.error("Save the raw description first", {
        description: "Paste the source JD into the textarea and hit Save Raw before generating.",
      });
      return;
    }
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
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() =>
            toast.message("Edit job", {
              description: "Use the Edit toggle in the right-rail Overview card.",
            })
          }
        >
          <Pencil className="h-3.5 w-3.5" /> Edit Job
        </Button>
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
          {generating ? "Generating…" : "Generate with Claude"}
        </button>
      </div>

      <SourceJobLinkRow
        jobId={jobId}
        initial={initialSourceJobUrl}
        onParseSuccess={onParseSuccess}
      />

      <RawJobDescriptionRow
        jobId={jobId}
        value={rawDraft}
        savedValue={savedRaw}
        onChange={setRawDraft}
        onSaved={(v) => setSavedRaw(v)}
      />

      <GeneratedJdPreview generated={generated} generatedAt={generatedAt} />

      <InternalRecruiterNotesRow
        jobId={jobId}
        initial={initialInternalRecruiterNotes}
      />

      <EditableJobDescription
        jobRfId={jobRfId}
        jobCuid={jobCuid}
        rfDescription={rfDescription}
        initialOverride={initialOverride}
      />
    </div>
  );
}

function SourceJobLinkRow({
  jobId,
  initial,
  onParseSuccess,
}: {
  jobId: string;
  initial: string | null;
  onParseSuccess: (extracted: string) => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState<string>(initial ?? "");
  const [pending, startSave] = useTransition();
  const [parsing, setParsing] = useState(false);

  function onSave() {
    startSave(async () => {
      const res = await saveJobSourceUrl({ jobId, url: value });
      if (!res.ok) {
        toast.error("Couldn't save URL", { description: res.error });
        return;
      }
      toast.success("Source URL saved");
      router.refresh();
    });
  }

  async function onParse() {
    const url = value.trim();
    if (!url) {
      toast.message("Paste a URL first.");
      return;
    }
    setParsing(true);
    try {
      const res = await fetch("/api/jobs/parse-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, url }),
      });
      const data: unknown = await res.json();
      const okRes =
        data && typeof data === "object" && "ok" in data && (data as { ok: boolean }).ok === true
          ? (data as { ok: true; extracted: string; urlSaved: boolean })
          : null;
      if (!okRes) {
        const errorMsg =
          data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
            ? (data as { error: string }).error
            : "Parse failed.";
        toast.error("Couldn't parse the link", { description: errorMsg });
        // URL was still saved by the route — refresh so the sidebar
        // reflects it. Do not clear the input.
        router.refresh();
        return;
      }
      onParseSuccess(okRes.extracted);
      router.refresh();
    } catch (e) {
      toast.error("Couldn't parse the link", {
        description: e instanceof Error ? e.message : "Network error.",
      });
    } finally {
      setParsing(false);
    }
  }

  return (
    <div className="rounded-xl border border-court-border bg-court-surface p-4 shadow-sm">
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
        Source Job Link
      </label>
      <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="url"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="https://…"
          className={cn(
            "flex-1 rounded-md border border-court-border bg-court-bg px-3 py-2 text-sm text-court-fg shadow-sm",
            "focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20",
          )}
        />
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onSave}
            disabled={pending}
          >
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Save URL
          </Button>
          <button
            type="button"
            onClick={onParse}
            disabled={parsing}
            className={cn(CLAUDE_PILL_CLASS, parsing && "opacity-60")}
          >
            {parsing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            {parsing ? "Parsing…" : "Parse Link"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RawJobDescriptionRow({
  jobId,
  value,
  savedValue,
  onChange,
  onSaved,
}: {
  jobId: string;
  value: string;
  savedValue: string;
  onChange: (next: string) => void;
  onSaved: (saved: string) => void;
}) {
  const router = useRouter();
  const [pending, startSave] = useTransition();
  const dirty = value !== savedValue;

  function onSave() {
    startSave(async () => {
      const res = await saveJobRawDescription({ jobId, rawDescription: value });
      if (!res.ok) {
        toast.error("Couldn't save raw description", { description: res.error });
        return;
      }
      onSaved(value);
      toast.success("Raw description saved");
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-court-border bg-court-surface p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
          Paste raw job description here
        </label>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onSave}
          disabled={pending || !dirty}
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          Save Raw
        </Button>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={8}
        placeholder="Paste the unedited copy from a job board, client email, or LinkedIn here…"
        className={cn(
          "mt-1.5 w-full resize-y rounded-md border border-court-border bg-court-bg px-3 py-2 text-sm text-court-fg shadow-sm",
          "focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20",
        )}
      />
    </div>
  );
}

function GeneratedJdPreview({
  generated,
  generatedAt,
}: {
  generated: string | null;
  generatedAt: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  if (!generated || !generated.trim()) return null;

  async function onCopy() {
    if (!generated) return;
    try {
      await navigator.clipboard.writeText(generated);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1600);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Couldn't copy. Select the text manually.");
    }
  }

  return (
    <div className="rounded-xl border border-court-border bg-court-surface p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-serif text-lg font-semibold text-court-fg">Generated job description</h2>
          {generatedAt ? (
            <p className="text-[11px] text-court-fg-muted">
              Last generated {formatRelativeOrAbsolute(generatedAt)}
            </p>
          ) : null}
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={onCopy}>
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy JD"}
        </Button>
      </div>
      <div
        className={cn(
          "mt-3 text-sm leading-relaxed text-court-fg",
          // Paragraphs + inline marks. Bullets default to disc list-style;
          // headings get an explicit two-step scale so H2 (top-level
          // sections like "A Bit About Us") sit visibly heavier than H3
          // (sub-sections like "Key Responsibilities and Duties"). H1 is
          // unused in the JD format but styled for safety.
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
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{generated}</ReactMarkdown>
      </div>
    </div>
  );
}

function InternalRecruiterNotesRow({
  jobId,
  initial,
}: {
  jobId: string;
  initial: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState<string>(initial ?? "");
  const [savedValue, setSavedValue] = useState<string>(initial ?? "");
  const [pending, startSave] = useTransition();

  function onBlur() {
    if (value === savedValue) return;
    startSave(async () => {
      const res = await saveJobInternalRecruiterNotes({ jobId, notes: value });
      if (!res.ok) {
        toast.error("Couldn't save notes", { description: res.error });
        return;
      }
      setSavedValue(value);
      toast.success("Notes saved");
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-court-border bg-court-surface p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
          Internal Recruiter Notes
          <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-800">
            Internal Only
          </span>
        </label>
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin text-court-fg-muted" /> : null}
      </div>
      <p className="mt-0.5 text-[11px] text-court-fg-muted">
        Recruiter-only context. Never shown to candidates and never fed into the generated JD.
      </p>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={onBlur}
        rows={4}
        placeholder="Comp flexibility, dealbreakers, client quirks, hiring-manager notes…"
        className={cn(
          "mt-2 w-full resize-y rounded-md border border-court-border bg-court-bg px-3 py-2 text-sm text-court-fg shadow-sm",
          "focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20",
        )}
      />
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
