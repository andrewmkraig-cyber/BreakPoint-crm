import Link from "next/link";
import { CollapsibleSection } from "@/components/settings/collapsible-section";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import { DeleteConversationButton } from "./delete-button";

// Claude Panel chat history, bucketed by calendar day per org. The
// schema doesn't carry a conversationId column — instead we derive it
// at read time from createdAt's date portion (UTC). One day per row
// keeps the list tractable without forcing a migration; if Andrew
// later wants explicit conversation boundaries we can layer a
// nullable conversationId on top.

export const dynamic = "force-dynamic";

type ConversationSummary = {
  date: string; // YYYY-MM-DD (UTC)
  count: number;
  firstUserMessage: string;
  latestAt: Date;
};

function summarizeConversations(
  rows: { role: string; content: string; createdAt: Date }[],
): ConversationSummary[] {
  const buckets = new Map<string, ConversationSummary>();
  for (const r of rows) {
    const date = r.createdAt.toISOString().slice(0, 10);
    let entry = buckets.get(date);
    if (!entry) {
      entry = {
        date,
        count: 0,
        firstUserMessage: "",
        latestAt: r.createdAt,
      };
      buckets.set(date, entry);
    }
    entry.count++;
    if (r.createdAt > entry.latestAt) entry.latestAt = r.createdAt;
    if (!entry.firstUserMessage && r.role === "user") {
      const t = r.content.trim();
      entry.firstUserMessage = t.length > 100 ? t.slice(0, 97) + "…" : t;
    }
  }
  const entries = Array.from(buckets.values());
  for (const entry of entries) {
    if (!entry.firstUserMessage) entry.firstUserMessage = "(no user messages)";
  }
  return entries.sort((a, b) => b.date.localeCompare(a.date));
}

export default async function HistorySettingsPage() {
  const org = await getCurrentOrg();
  // Pull rows in createdAt asc so the per-day "first user message"
  // walk picks the actual earliest user turn of the day. We cap at
  // 5000 rows — well above realistic single-org Panel volume but
  // bounded enough to keep this query cheap.
  const rows = await prisma.claudePanelMessage.findMany({
    where: { organizationId: org.id },
    select: { role: true, content: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: 5000,
  });
  const conversations = summarizeConversations(rows);

  return (
    <CollapsibleSection
      id="history"
      title="Claude History"
      description="Past Ace Assistant conversations grouped by day."
    >
      {conversations.length === 0 ? (
        <div className="rounded-md border border-court-border bg-court-surface-subtle px-4 py-6 text-center text-sm text-court-fg-muted">
          No conversations yet. Open the Ace Assistant panel from the topbar to start one.
        </div>
      ) : (
        <ul className="divide-y divide-court-border rounded-md border border-court-border bg-court-surface">
          {conversations.map((c) => (
            <li
              key={c.date}
              className="flex items-center gap-3 px-4 py-3"
            >
              <Link
                href={`/settings/history/${c.date}`}
                className="min-w-0 flex-1 transition hover:opacity-80"
              >
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium text-court-fg">{c.date}</span>
                  <span className="text-xs text-court-fg-muted">
                    · {c.count} message{c.count === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-xs text-court-fg-muted">
                  {c.firstUserMessage}
                </div>
              </Link>
              <DeleteConversationButton date={c.date} />
            </li>
          ))}
        </ul>
      )}
    </CollapsibleSection>
  );
}
