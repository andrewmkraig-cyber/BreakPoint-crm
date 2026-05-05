"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useFloatingThread } from "@/lib/floating-thread-context";
import type { ActiveTemplateSummary } from "@/app/email/actions";

// Compact email row list for the candidate Activity tab and the client
// Email tab. Fetches `{ threads: [...] }` from the supplied URL,
// renders skeleton rows during load, an empty state when nothing's
// tagged, and clickable rows that pop open the floating thread viewer
// — same component the Mail Tab uses, hoisted to the providers layer
// so it survives navigation.

type ThreadRow = {
  threadId: string;
  subject: string;
  from: string;
  dateIso: string | null;
};

type ComposeInitPayload = {
  templates: ActiveTemplateSummary[];
  user: { firstName: string; fullName: string; email: string };
};

// Module-level promise caches so the second click on the page doesn't
// re-fetch compose-init / labels. Same pattern mail-notification-toast
// uses for the new-mail toast's "View" button.
let cachedInit: Promise<ComposeInitPayload> | null = null;
function fetchComposeInit(): Promise<ComposeInitPayload> {
  if (cachedInit) return cachedInit;
  cachedInit = (async () => {
    const res = await fetch("/api/mail/compose-init");
    if (!res.ok) {
      cachedInit = null;
      throw new Error(`compose-init failed (${res.status})`);
    }
    return (await res.json()) as ComposeInitPayload;
  })();
  return cachedInit;
}

type LabelRow = { id: string; name: string; type?: string };
let cachedLabels: Promise<LabelRow[]> | null = null;
function fetchLabels(): Promise<LabelRow[]> {
  if (cachedLabels) return cachedLabels;
  cachedLabels = (async () => {
    const res = await fetch("/api/mail/labels");
    if (!res.ok) {
      cachedLabels = null;
      throw new Error(`labels failed (${res.status})`);
    }
    const body = (await res.json()) as { labels?: LabelRow[] };
    return body.labels ?? [];
  })();
  return cachedLabels;
}

export function TaggedThreadList({
  url,
  pageSize = 5,
}: {
  url: string;
  pageSize?: number;
}) {
  const [rows, setRows] = useState<ThreadRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const floatingThread = useFloatingThread();

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    setPage(0);
    void (async () => {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) {
          if (!cancelled) setError(`HTTP ${res.status}`);
          return;
        }
        const body = (await res.json()) as { threads?: ThreadRow[] };
        if (!cancelled) setRows(body.threads ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "fetch failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  async function openThread(threadId: string) {
    setOpening(threadId);
    try {
      const [init, labels] = await Promise.all([
        fetchComposeInit(),
        fetchLabels().catch(() => [] as LabelRow[]),
      ]);
      floatingThread.open(threadId, {
        labels: labels.length > 0 ? labels : null,
        templates: init.templates,
        currentUserEmail: init.user.email,
        currentUserFirstName: init.user.firstName,
        currentUserFullName: init.user.fullName,
      });
    } catch (err) {
      toast.error("Couldn't open thread", {
        description: err instanceof Error ? err.message : "unknown error",
      });
    } finally {
      setOpening(null);
    }
  }

  if (error) {
    return <p className="text-sm text-court-fg-muted">No emails on file</p>;
  }

  if (rows === null) {
    return (
      <ul className="space-y-1.5">
        {[0, 1, 2].map((i) => (
          <li
            key={i}
            className="flex items-center gap-3 rounded-md border border-court-border bg-court-surface px-3 py-2"
          >
            <div className="h-3 w-24 animate-pulse rounded bg-court-surface-subtle" />
            <div className="h-3 flex-1 animate-pulse rounded bg-court-surface-subtle" />
            <div className="h-3 w-12 animate-pulse rounded bg-court-surface-subtle" />
          </li>
        ))}
      </ul>
    );
  }

  if (rows.length === 0) {
    return <p className="text-sm text-court-fg-muted">No emails on file</p>;
  }

  const total = rows.length;
  const totalPages = Math.ceil(total / pageSize);
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * pageSize;
  const end = Math.min(start + pageSize, total);
  const visible = rows.slice(start, end);

  return (
    <div className="space-y-2">
      <ul className="space-y-1.5">
        {visible.map((row) => (
          <li key={row.threadId}>
            <button
              type="button"
              onClick={() => openThread(row.threadId)}
              disabled={opening === row.threadId}
              className="flex w-full items-center gap-3 rounded-md border border-court-border bg-court-surface px-3 py-2 text-left transition hover:border-court-accent hover:shadow-sm disabled:opacity-60"
            >
              <span className="min-w-0 max-w-[40%] shrink-0 truncate text-xs font-semibold text-court-fg">
                {parseFromName(row.from)}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-court-fg-muted">
                {row.subject}
              </span>
              <span className="shrink-0 text-[10px] text-court-fg-muted">
                {opening === row.threadId ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  formatShortDate(row.dateIso)
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-1">
          <span className="text-[10px] text-court-fg-muted">
            {start + 1}-{end} of {total}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              aria-label="Newer emails"
              className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-1.5 py-0.5 text-[10px] font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft className="h-3 w-3" /> Newer
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={safePage >= totalPages - 1}
              aria-label="Older emails"
              className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-1.5 py-0.5 text-[10px] font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg disabled:cursor-not-allowed disabled:opacity-40"
            >
              Older <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// "Display Name <addr@host>" → "Display Name". Bare addresses pass
// through.
function parseFromName(raw: string): string {
  if (!raw) return "(unknown sender)";
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m && m[1].trim()) return m[1].trim();
  return raw.trim();
}

function formatShortDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return sameYear
    ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });
}
