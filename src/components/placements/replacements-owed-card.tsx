import Link from "next/link";
import { UserMinus } from "lucide-react";

import { formatDate } from "@/lib/utils";
import { FELL_OFF_REASON_LABEL, normalizeFellOffReason } from "@/lib/placement-fell-off";
import type { ReplacementOwedRow } from "@/lib/replacements-owed";

// "Replacements Owed": every fell-off placement the client paid for and is
// owed a free replacement on. Renders nothing when the list is empty so the
// placements tab stays quiet in the normal case. Server component; no state.

function money(n: number | null): string {
  return n != null && n > 0 ? `$${Math.round(n).toLocaleString("en-US")}` : "—";
}

export function ReplacementsOwedCard({ rows }: { rows: ReplacementOwedRow[] }) {
  if (rows.length === 0) return null;
  const open = rows.filter((r) => !r.replacedBy).length;

  return (
    <div className="rounded-3xl bg-court-surface shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_20px_rgba(0,0,0,0.08)]">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
        <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-court-fg-muted">
          <UserMinus className="h-3 w-3 text-amber-600" />
          Replacements Owed
        </p>
        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {open} open
        </span>
      </div>
      <div className="mt-2.5 overflow-x-auto px-4 pb-2">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-y border-court-border-soft text-left text-[10px] uppercase tracking-wide text-court-fg-muted">
              <th className="py-1.5 pr-3 font-semibold">Candidate</th>
              <th className="px-3 py-1.5 font-semibold">Client</th>
              <th className="px-3 py-1.5 font-semibold">Role</th>
              <th className="px-3 py-1.5 font-semibold">Fell off</th>
              <th className="px-3 py-1.5 font-semibold">Why</th>
              <th className="px-3 py-1.5 text-right font-semibold">Fee</th>
              <th className="px-3 py-1.5 text-right font-semibold">Refunded</th>
              <th className="py-1.5 pl-3 font-semibold">Replacement</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.placementId} className="border-b border-court-border-soft last:border-b-0">
                <td className="py-3 pr-3 align-middle font-medium text-court-fg">
                  {r.candidateId ? (
                    <Link href={`/candidates/${r.candidateId}`} className="hover:text-court-accent-dark">
                      {r.candidateName}
                    </Link>
                  ) : (
                    r.candidateName
                  )}
                </td>
                <td className="px-3 py-3 align-middle text-court-fg">{r.clientName}</td>
                <td className="px-3 py-3 align-middle text-court-fg-muted">{r.roleTitle ?? "—"}</td>
                <td className="px-3 py-3 align-middle tabular-nums text-court-fg-muted">
                  {formatDate(r.fellOffAtIso)}
                </td>
                <td className="px-3 py-3 align-middle text-court-fg-muted" title={r.fellOffNotes ?? undefined}>
                  {FELL_OFF_REASON_LABEL[normalizeFellOffReason(r.fellOffReason)]}
                </td>
                <td className="px-3 py-3 text-right align-middle tabular-nums text-court-fg">{money(r.feeTotal)}</td>
                <td className="px-3 py-3 text-right align-middle tabular-nums text-court-fg-muted">
                  {money(r.refundAmount)}
                </td>
                <td className="py-3 pl-3 align-middle">
                  {r.replacedBy ? (
                    <span className="inline-flex items-center gap-1 text-[12px] text-court-fg">
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                        Booked
                      </span>
                      {r.replacedBy.candidateId ? (
                        <Link href={`/candidates/${r.replacedBy.candidateId}`} className="hover:text-court-accent-dark">
                          {r.replacedBy.candidateName}
                        </Link>
                      ) : (
                        r.replacedBy.candidateName
                      )}
                    </span>
                  ) : (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                      Owed
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
