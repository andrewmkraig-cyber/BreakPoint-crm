import Link from "next/link";
import { CollapsibleSection } from "@/components/settings/collapsible-section";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import { DeleteConversationButton } from "./delete-button";

// Claude Panel chat history, grouped by conversationId. Clear Chat
// rotates the conversationId on the panel side instead of deleting
// rows — every prior conversation surfaces here as a separate entry.
//
// Rows that predate the conversationId column have NULL ids; we
// bucket those by calendar day so the legacy transcript still shows
// up cleanly. New buckets keyed by conversationId.

export const dynamic = "force-dynamic";

type ConversationSummary = {
  // URL-safe key — for legacy NULL rows we synthesize "legacy-<date>",
  // for new rows the actual conversationId.
  key: string;
  // Display label: ISO date for new buckets (most-recent message
  // timestamp), or YYYY-MM-DD for legacy buckets.
  dateLabel: string;
  count: number;
  firstUserMessage: string;
  latestAt: Date;
  isLegacy: boolean;
};

function summarize(
  rows: {
    role: string;
    content: string;
    conversationId: string | null;
    createdAt: Date;
  }[],
): ConversationSummary[] {
  const buckets = new Map<string, ConversationSummary>();
  for (const r of rows) {
    const date = r.createdAt.toISOString().slice(0, 10);
    const key = r.conversationId ?? `legacy-${date}`;
    let entry = buckets.get(key);
    if (!entry) {
      entry = {
        key,
        dateLabel: date,
        count: 0,
        firstUserMessage: "",
        latestAt: r.createdAt,
        isLegacy: r.conversationId == null,
      };
      buckets.set(key, entry);
    }
    entry.count++;
    if (r.createdAt > entry.latestAt) {
      entry.latestAt = r.createdAt;
      entry.dateLabel = r.createdAt.toISOString().slice(0, 10);
    }
    if (!entry.firstUserMessage && r.role === "user") {
      const t = r.content.trim();
      entry.firstUserMessage = t.length > 100 ? t.slice(0, 97) + "…" : t;
    }
  }
  const entries = Array.from(buckets.values());
  for (const entry of entries) {
    if (!entry.firstUserMessage) entry.firstUserMessage = "(no user messages)";
  }
  return entries.sort((a, b) => b.latestAt.getTime() - a.latestAt.getTime());
}

export default async function HistorySettingsPage() {
  const org = await getCurrentOrg();
  // 5000 rows is well above realistic single-org Panel volume but
  // bounded enough to keep this query cheap. asc so the per-bucket
  // "first user message" walk picks the actual earliest user turn.
  const rows = await prisma.claudePanelMessage.findMany({
    where: { organizationId: org.id },
    select: { role: true, content: true, conversationId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: 5000,
  });
  const conversations = summarize(rows);

  return (
    <CollapsibleSection
      id="history"
      title="Claude History"
      description="Past Ace Assistant conversations. Cleared chats are preserved here as separate entries."
    >
      {conversations.length === 0 ? (
        <div className="rounded-md border border-court-border bg-court-surface-subtle px-4 py-6 text-center text-sm text-court-fg-muted">
          No conversations yet. Open the Ace Assistant panel from the topbar to start one.
        </div>
      ) : (
        <ul className="divide-y divide-court-border rounded-md border border-court-border bg-court-surface">
          {conversations.map((c) => (
            <li
              key={c.key}
              className="flex items-center gap-3 px-4 py-3"
            >
              <Link
                href={`/settings/history/${encodeURIComponent(c.key)}`}
                className="min-w-0 flex-1 transition hover:opacity-80"
              >
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium text-court-fg">
                    {c.dateLabel}
                  </span>
                  <span className="text-xs text-court-fg-muted">
                    · {c.count} message{c.count === 1 ? "" : "s"}
                  </span>
                  {c.isLegacy && (
                    <span className="rounded bg-court-surface-subtle px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-court-fg-muted">
                      legacy
                    </span>
                  )}
                </div>
                <div className="mt-0.5 truncate text-xs text-court-fg-muted">
                  {c.firstUserMessage}
                </div>
              </Link>
              <DeleteConversationButton conversationKey={c.key} />
            </li>
          ))}
        </ul>
      )}
    </CollapsibleSection>
  );
}
