import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { CollapsibleSection } from "@/components/settings/collapsible-section";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import { DeleteConversationButton } from "../delete-button";

// Read-only thread view for one day's bucket of Claude Panel
// messages. Same render shape as the live panel — user bubbles right-
// aligned with the brand colour, assistant bubbles left-aligned in
// surface-subtle — but stripped of compose/copy chrome since this is
// archive view, not chat.

export const dynamic = "force-dynamic";

export default async function HistoryDetailPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const org = await getCurrentOrg();
  const rows = await prisma.claudePanelMessage.findMany({
    where: {
      organizationId: org.id,
      createdAt: { gte: start, lt: end },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, content: true, createdAt: true },
  });

  if (rows.length === 0) notFound();

  return (
    <CollapsibleSection
      id={`history-${date}`}
      title={`Conversation · ${date}`}
      description={`${rows.length} message${rows.length === 1 ? "" : "s"} archived from this day.`}
    >
      <div className="mb-4 flex items-center justify-between">
        <Link
          href="/settings/history"
          className="inline-flex items-center gap-1 text-xs font-medium text-court-fg-muted transition hover:text-court-fg"
        >
          <ChevronLeft className="h-3 w-3" /> Back to history
        </Link>
        <DeleteConversationButton date={date} />
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
                {isUser ? "you" : "Ace"} · {time} UTC
              </div>
            </div>
          );
        })}
      </div>
    </CollapsibleSection>
  );
}
