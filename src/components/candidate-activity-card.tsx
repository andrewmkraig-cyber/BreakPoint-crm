"use client";

import { useEffect, useState } from "react";
import { Mail, MessageSquare, Phone } from "lucide-react";
import { SmsComposer } from "@/components/sms-composer";
import { TextingExchanges } from "@/components/texting-exchanges";
import { CallLogs } from "@/components/call-logs";
import { cn } from "@/lib/utils";

type SubTab = "email" | "call" | "text";

type ActivityRow = {
  id: string;
  description: string;
  createdAt: string;
};

// Right-sidebar Activity card. Email/Call/Text sub-tabs in an underline
// strip; the active sub-tab swaps the body. The TextingExchanges and
// CallLogs children are passed `defaultOpen` so they auto-expand inside
// the sub-tab — the recruiter doesn't need to click a second accordion
// to see content. A "Recent activity" footer pulls the last 3 rows from
// /api/activity so the recruiter sees the freshest events without
// switching to a separate page.
export function CandidateActivityCard({
  candidateId,
  toNumber,
}: {
  candidateId: string;
  toNumber: string | null;
}) {
  const [tab, setTab] = useState<SubTab>("text");
  const [recent, setRecent] = useState<ActivityRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/activity/candidate/${encodeURIComponent(candidateId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: { activities?: ActivityRow[] }) => {
        if (!cancelled && Array.isArray(data?.activities)) {
          setRecent(data.activities.slice(0, 3));
        }
      })
      .catch(() => {
        // Soft fail — the recent feed is a nice-to-have; the rest of
        // the card still works without it.
      });
    return () => {
      cancelled = true;
    };
  }, [candidateId]);

  return (
    <section className="rounded-2xl border border-court-border bg-court-surface shadow-sm">
      <div className="px-4 pt-4">
        <h3 className="font-serif text-base font-semibold text-court-fg">Activity</h3>
        <div className="mt-2 flex gap-4 border-b border-court-border">
          <SubTabButton icon={<Mail className="h-3.5 w-3.5" />} label="Email" active={tab === "email"} onClick={() => setTab("email")} />
          <SubTabButton icon={<Phone className="h-3.5 w-3.5" />} label="Call" active={tab === "call"} onClick={() => setTab("call")} />
          <SubTabButton icon={<MessageSquare className="h-3.5 w-3.5" />} label="Text" active={tab === "text"} onClick={() => setTab("text")} />
        </div>
      </div>

      <div className="space-y-3 px-4 py-4">
        {tab === "email" && (
          <p className="text-sm text-court-fg-muted">Email history coming soon.</p>
        )}
        {tab === "call" && <CallLogs candidateId={candidateId} defaultOpen />}
        {tab === "text" && (
          <>
            <SmsComposer candidateId={candidateId} toNumber={toNumber} />
            <TextingExchanges candidateId={candidateId} defaultOpen />
          </>
        )}
      </div>

      {recent.length > 0 && (
        <div className="border-t border-court-border px-4 py-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-court-fg-muted">
            Recent activity
          </div>
          <ul className="space-y-2">
            {recent.map((r) => (
              <li key={r.id} className="flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate text-court-fg">{r.description}</span>
                <span className="shrink-0 text-[10px] text-court-fg-muted">
                  {formatRelative(r.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function SubTabButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "-mb-px inline-flex items-center gap-1.5 border-b-2 pb-2 text-xs font-medium transition-colors",
        active
          ? "border-court-accent text-court-accent-dark"
          : "border-transparent text-court-fg-muted hover:text-court-fg",
      )}
      aria-pressed={active}
    >
      {icon}
      {label}
    </button>
  );
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d`;
  const wk = Math.round(day / 7);
  return `${wk}w`;
}
