"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type { JobBoardStatus } from "@prisma/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  MAJOR_BOARDS,
  nextStatusValue,
  type JobBoardStatusValueShared,
} from "@/lib/job-boards-shared";
import {
  addLocalNicheBoard,
  removeJobBoard,
  updateJobBoardFields,
  updateJobBoardStatus,
} from "@/app/jobs/[id]/job-board-actions";

// Promote tab body. Three sections:
//   1. Public Apply Link — read-only input, Copy + Open buttons.
//   2. Major Boards — six seeded rows (LinkedIn, Indeed, ZipRecruiter,
//      Glassdoor, SimplyHired, Monster). Status chip cycles through the
//      four enum values; notes + URL save on blur.
//   3. Local & Niche Boards — recruiter-added rows. Same shape as a
//      major row but addable / removable.
//
// "Suggest Boards with Claude" is a parked feature (per the project
// roadmap memory) — disabled stub button with a tooltip pointing at the
// future capability.

const STATUS_LABELS: Record<JobBoardStatusValueShared, string> = {
  NOT_CONFIGURED: "Not Configured",
  READY: "Ready",
  POSTED: "Posted",
  SKIPPED: "Skipped",
};

const STATUS_TONE: Record<JobBoardStatusValueShared, string> = {
  NOT_CONFIGURED:
    "border-court-border bg-court-surface-subtle text-court-fg-muted hover:border-court-fg-muted/40",
  READY: "border-amber-200 bg-amber-50 text-amber-800 hover:border-amber-300",
  POSTED: "border-brand bg-brand-tint text-brand-dark hover:border-brand/60",
  SKIPPED: "border-red-200 bg-red-50 text-red-700 hover:border-red-300",
};

const ACCOUNT_NEEDED_BY_BOARD = new Map<string, boolean>(
  MAJOR_BOARDS.map((b) => [b.name, b.accountNeeded]),
);

export function PromoteTab({
  jobId,
  applyLink,
  rows,
}: {
  jobId: string;
  applyLink: string | null;
  rows: JobBoardStatus[];
}) {
  const majors = rows.filter((r) => r.category === "major");
  const locals = rows.filter((r) => r.category !== "major");

  return (
    <div className="space-y-5">
      <ApplyLinkCard applyLink={applyLink} />

      <section className="rounded-xl border border-court-border/40 bg-court-surface p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-serif text-lg font-semibold text-court-fg">Major Boards</h2>
            <p className="text-[11px] text-court-fg-muted">
              Status, notes, and external listing URL for the six big general-purpose boards.
            </p>
          </div>
          <button
            type="button"
            disabled
            title="Coming soon."
            className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-md border border-court-border bg-court-surface-subtle px-3 py-1.5 text-[11px] font-semibold text-court-fg-muted opacity-70"
          >
            <Sparkles className="h-3 w-3" /> Suggest Boards with Claude
          </button>
        </div>
        <div className="mt-3 divide-y divide-court-border overflow-hidden rounded-lg border border-court-border/40">
          {majors.length === 0 ? (
            <div className="px-4 py-3 text-xs text-court-fg-muted">
              Major boards aren&apos;t seeded yet. Refresh in a moment.
            </div>
          ) : (
            majors.map((row) => (
              <BoardRow key={row.id} jobId={jobId} row={row} kind="major" />
            ))
          )}
        </div>
      </section>

      <section className="rounded-xl border border-court-border/40 bg-court-surface p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-serif text-lg font-semibold text-court-fg">
              Local &amp; Niche Boards
            </h2>
            <p className="text-[11px] text-court-fg-muted">
              Industry, regional, association, or any other board you post to manually.
            </p>
          </div>
        </div>
        <AddLocalBoardForm jobId={jobId} />
        <div className="mt-3 divide-y divide-court-border overflow-hidden rounded-lg border border-court-border/40">
          {locals.length === 0 ? (
            <div className="px-4 py-3 text-xs text-court-fg-muted">
              No local or niche boards yet. Add one above.
            </div>
          ) : (
            locals.map((row) => (
              <BoardRow key={row.id} jobId={jobId} row={row} kind="local" />
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function ApplyLinkCard({ applyLink }: { applyLink: string | null }) {
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  async function onCopy() {
    if (!applyLink) return;
    try {
      await navigator.clipboard.writeText(applyLink);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1500);
      toast.success("Apply link copied");
    } catch {
      toast.error("Couldn't copy link");
    }
  }

  return (
    <section className="rounded-xl border border-court-border/40 bg-court-surface p-5 shadow-sm">
      <h2 className="font-serif text-lg font-semibold text-court-fg">Public Apply Link</h2>
      <p className="text-[11px] text-court-fg-muted">
        Share this URL on any board or social post. Inbound applicants land on the candidate
        intake form.
      </p>
      {applyLink ? (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="url"
            readOnly
            value={applyLink}
            onFocus={(e) => e.currentTarget.select()}
            className={cn(
              "flex-1 truncate rounded-md border border-court-border bg-court-bg px-3 py-2 text-sm text-court-fg shadow-sm",
              "focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20",
            )}
          />
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={onCopy}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <a
              href={applyLink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-court-border bg-court-surface px-3 py-1.5 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:bg-court-surface-subtle hover:text-court-fg"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Open
            </a>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-xs text-court-fg-muted">
          No public apply link set on this job yet. Add one from the Overview sidebar.
        </p>
      )}
    </section>
  );
}

function BoardRow({
  jobId,
  row,
  kind,
}: {
  jobId: string;
  row: JobBoardStatus;
  kind: "major" | "local";
}) {
  const router = useRouter();
  const [status, setStatus] = useState<JobBoardStatusValueShared>(row.status);
  const [notes, setNotes] = useState<string>(row.notes ?? "");
  const [url, setUrl] = useState<string>(row.externalUrl ?? "");
  const [boardName, setBoardName] = useState<string>(row.boardName);
  const [savingStatus, startStatusTransition] = useTransition();
  const [savingFields, startFieldsTransition] = useTransition();
  const [removing, startRemove] = useTransition();

  const accountNeeded = ACCOUNT_NEEDED_BY_BOARD.get(row.boardName) ?? false;

  function cycleStatus() {
    const next = nextStatusValue(status);
    setStatus(next);
    startStatusTransition(async () => {
      const res = await updateJobBoardStatus({ jobId, rowId: row.id, status: next });
      if (!res.ok) {
        toast.error("Couldn't update status", { description: res.error });
        setStatus(row.status);
        return;
      }
      router.refresh();
    });
  }

  function onBlurFields() {
    const dirty =
      notes !== (row.notes ?? "") ||
      url !== (row.externalUrl ?? "") ||
      (kind === "local" && boardName !== row.boardName);
    if (!dirty) return;
    startFieldsTransition(async () => {
      const res = await updateJobBoardFields({
        jobId,
        rowId: row.id,
        notes,
        externalUrl: url,
        boardName: kind === "local" ? boardName : undefined,
      });
      if (!res.ok) {
        toast.error("Couldn't save row", { description: res.error });
        return;
      }
      router.refresh();
    });
  }

  function onRemove() {
    if (kind !== "local") return;
    if (!confirm(`Remove ${row.boardName} from this job's promote list?`)) return;
    startRemove(async () => {
      const res = await removeJobBoard({ jobId, rowId: row.id });
      if (!res.ok) {
        toast.error("Couldn't remove", { description: res.error });
        return;
      }
      toast.success(`${row.boardName} removed`);
      router.refresh();
    });
  }

  const indicators: React.ReactNode[] = [];
  if (kind === "major" && accountNeeded) {
    indicators.push(
      <span
        key="acct"
        className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800"
        title="Posting requires a recruiter / employer account on this board."
      >
        <KeyRound className="h-3 w-3" /> Account needed
      </span>,
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2 px-4 py-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,2fr)_auto]">
      <div className="flex flex-wrap items-center gap-2">
        {kind === "local" ? (
          <input
            type="text"
            value={boardName}
            onChange={(e) => setBoardName(e.target.value)}
            onBlur={onBlurFields}
            placeholder="Board name"
            className="w-full rounded-md border border-court-border bg-court-bg px-2 py-1 text-sm font-semibold text-court-fg shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          />
        ) : (
          <span className="font-semibold text-court-fg">{row.boardName}</span>
        )}
        {indicators}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={cycleStatus}
          disabled={savingStatus}
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider transition",
            STATUS_TONE[status],
            savingStatus && "opacity-60",
          )}
          title="Click to cycle through statuses"
        >
          {savingStatus && <Loader2 className="h-3 w-3 animate-spin" />}
          {STATUS_LABELS[status]}
        </button>
      </div>
      <input
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onBlur={onBlurFields}
        placeholder="External URL (optional)"
        className="rounded-md border border-court-border bg-court-bg px-2 py-1 text-xs text-court-fg shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
      />
      <input
        type="text"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={onBlurFields}
        placeholder="Notes (account info, posting cadence, etc.)"
        className="rounded-md border border-court-border bg-court-bg px-2 py-1 text-xs text-court-fg shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
      />
      <div className="flex items-center justify-end gap-2">
        {url && /^https?:\/\//i.test(url) && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted hover:bg-court-surface-subtle hover:text-court-fg"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {savingFields && <Loader2 className="h-3 w-3 animate-spin text-court-fg-muted" />}
        {kind === "local" && (
          <button
            type="button"
            onClick={onRemove}
            disabled={removing}
            className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-100 disabled:opacity-60"
            title="Remove this board"
          >
            {removing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
          </button>
        )}
      </div>
    </div>
  );
}

function AddLocalBoardForm({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [category, setCategory] = useState("local_niche");
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();

  function onAdd() {
    if (!name.trim()) {
      toast.message("Add a board name first.");
      return;
    }
    startTransition(async () => {
      const res = await addLocalNicheBoard({
        jobId,
        boardName: name.trim(),
        externalUrl: url.trim() || undefined,
        notes: notes.trim() || undefined,
        category: category.trim() || undefined,
      });
      if (!res.ok) {
        toast.error("Couldn't add board", { description: res.error });
        return;
      }
      toast.success(`${name.trim()} added`);
      setName("");
      setUrl("");
      setNotes("");
      setCategory("local_niche");
      router.refresh();
    });
  }

  return (
    <div className="mt-3 rounded-lg border border-dashed border-court-border bg-court-surface-subtle/40 px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
        Add a board
      </div>
      <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,2fr)_auto]">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Board name (e.g. AICPA, Built In NYC)"
          className="rounded-md border border-court-border bg-court-bg px-2 py-1 text-sm text-court-fg shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        />
        <input
          type="text"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Category (e.g. local_niche, regional)"
          className="rounded-md border border-court-border bg-court-bg px-2 py-1 text-xs text-court-fg shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        />
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="External URL (optional)"
          className="rounded-md border border-court-border bg-court-bg px-2 py-1 text-xs text-court-fg shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        />
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (optional)"
          className="rounded-md border border-court-border bg-court-bg px-2 py-1 text-xs text-court-fg shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        />
        <Button type="button" size="sm" onClick={onAdd} disabled={pending}>
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          Add
        </Button>
      </div>
    </div>
  );
}

