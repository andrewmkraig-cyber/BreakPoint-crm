import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { CollapsibleSection } from "@/components/settings/collapsible-section";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import { DeleteConversationButton } from "../delete-button";

// Read-only thread view for one conversation. `key` is either a
// conversationId or a "legacy-YYYY-MM-DD" synthetic that targets the
// pre-conversationId NULL bucket for that day.

export const dynamic = "force-dynamic";

type ConversationRow = {
  id: string;
  role: string;
  content: string;
  createdAt: Date;
};

async function loadConversation(
  orgId: string,
  key: string,
): Promise<ConversationRow[] | null> {
  const legacyMatch = /^legacy-(\d{4}-\d{2}-\d{2})$/.exec(key);
  if (legacyMatch) {
    const date = legacyMatch[1];
    const start = new Date(`${date}T00:00:00.000Z`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return prisma.claudePanelMessage.findMany({
      where: {
        organizationId: orgId,
        conversationId: null,
        createdAt: { gte: start, lt: end },
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, role: true, content: true, createdAt: true },
    });
  }
  return prisma.claudePanelMessage.findMany({
    where: { organizationId: orgId, conversationId: key },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, content: true, createdAt: true },
  });
}

export default async function HistoryDetailPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key: rawKey } = await params;
  const key = decodeURIComponent(rawKey);
  if (!key) notFound();

  const org = await getCurrentOrg();
  const rows = await loadConversation(org.id, key);
  if (!rows || rows.length === 0) notFound();

  const isLegacy = key.startsWith("legacy-");
  const dateLabel = rows[0].createdAt.toISOString().slice(0, 10);

  return (
    <CollapsibleSection
      id={`history-${key}`}
      title={`Conversation · ${dateLabel}`}
      description={`${rows.length} message${rows.length === 1 ? "" : "s"} archived.${isLegacy ? " (Legacy bucket: predates conversation ids.)" : ""}`}
    >
      <div className="mb-4 flex items-center justify-between">
        <Link
          href="/settings/history"
          className="inline-flex items-center gap-1 text-xs font-medium text-court-fg-muted transition hover:text-court-fg"
        >
          <ChevronLeft className="h-3 w-3" /> Back to history
        </Link>
        <DeleteConversationButton conversationKey={key} />
      </div>

      <div className="flex flex-col gap-3 rounded-md border border-court-border bg-court-surface px-4 py-4">
        {rows.map((m) => {
          const isUser = m.role === "user";
          const time = m.createdAt.toISOString().slice(11, 16);
          return (
            <div
              key={m.id}
              className={isUser ? "flex flex-col items-end" : "flex flex-col items-start"}
            >
              <div
                className={
                  isUser
                    ? "ml-auto max-w-[85%] rounded-2xl bg-court-brand px-3 py-2 text-sm text-white"
                    : "mr-auto max-w-[85%] rounded-2xl bg-court-surface-subtle px-3 py-2 text-sm text-court-fg"
                }
              >
                <div className="whitespace-pre-wrap break-words">
                  {m.content}
                </div>
              </div>
              <div className="mt-0.5 text-[10px] text-court-fg-muted">
                {isUser ? "you" : "Wilson"} · {time} UTC
              </div>
            </div>
          );
        })}
      </div>
    </CollapsibleSection>
  );
}
