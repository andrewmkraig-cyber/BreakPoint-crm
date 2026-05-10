import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { formatLocation } from "@/lib/utils";

export const dynamic = "force-dynamic";

function composeName(first: string | null, last: string | null): string {
  const parts = [first, last].map((p) => (p ?? "").trim()).filter(Boolean);
  return parts.length ? parts.join(" ") : "(unnamed)";
}

function formatSalary(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "—";
  const n = (raw as { number?: unknown }).number;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return "—";
  const ccy = (raw as { currency?: unknown }).currency;
  const symbol = ccy === "USD" || !ccy ? "$" : `${String(ccy)} `;
  return `${symbol}${n.toLocaleString()}`;
}

function relativeTime(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min${min === 1 ? "" : "s"} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo} mo${mo === 1 ? "" : "s"} ago`;
  const yr = Math.round(mo / 12);
  return `${yr} yr${yr === 1 ? "" : "s"} ago`;
}

export default async function CandidateListDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const org = await getCurrentOrg();
  // organizationId-scoped lookup keeps Rule 8 honest even though
  // CandidateListMembership cascades from CandidateList.organizationId
  // — a forged list id from another tenant returns null and falls
  // through to notFound() rather than leaking the row count or the
  // existence of the id.
  const list = await prisma.candidateList.findFirst({
    where: { id: params.id, organizationId: org.id },
    select: {
      id: true,
      name: true,
      memberships: {
        orderBy: { addedAt: "desc" },
        select: {
          candidate: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              currentDesignation: true,
              currentOrganization: true,
              location: true,
              expectedSalary: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      },
    },
  });
  if (!list) notFound();

  const memberCount = list.memberships.length;

  return (
    <div className="space-y-6">
      <Link
        href="/candidates/lists"
        className="inline-flex items-center gap-1 text-xs text-court-fg-muted hover:text-court-fg"
      >
        <ArrowLeft className="h-3 w-3" /> Back to Lists
      </Link>

      <div>
        <h1 className="text-xl font-semibold text-court-fg">{list.name}</h1>
        <p className="mt-1 text-xs text-court-fg-muted">
          {memberCount} member{memberCount === 1 ? "" : "s"}
        </p>
      </div>

      {memberCount === 0 ? (
        <div className="rounded-xl border border-dashed border-court-border bg-court-surface-subtle/40 px-6 py-12 text-center text-sm text-court-fg-muted">
          No candidates in this list yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-court-border bg-court-surface shadow-sm">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-court-border bg-court-surface-subtle/60 text-[10px] font-semibold uppercase tracking-widest text-court-fg-muted">
              <tr>
                <th className="px-3 py-2">Candidate</th>
                <th className="px-3 py-2">Current Title</th>
                <th className="px-3 py-2">Employer</th>
                <th className="px-3 py-2">Location</th>
                <th className="px-3 py-2 text-right">Salary</th>
                <th className="px-3 py-2">Last Apply</th>
                <th className="px-3 py-2">Last Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-court-border-soft">
              {list.memberships.map((m) => {
                const c = m.candidate;
                const name = composeName(c.firstName, c.lastName);
                return (
                  <tr key={c.id} className="h-12 transition hover:bg-court-accent-tint/40">
                    <td className="px-3 font-medium text-court-fg">
                      <Link href={`/candidates/${c.id}`} className="hover:underline">
                        {name}
                      </Link>
                    </td>
                    <td className="px-3 text-court-fg-muted">
                      {c.currentDesignation || "—"}
                    </td>
                    <td className="px-3 text-court-fg-muted">
                      {c.currentOrganization || "—"}
                    </td>
                    <td className="px-3 text-court-fg-muted">
                      {formatLocation(c.location) || "—"}
                    </td>
                    <td className="px-3 text-right tabular-nums text-court-fg-muted">
                      {formatSalary(c.expectedSalary)}
                    </td>
                    <td className="px-3 text-court-fg-muted">
                      {relativeTime(c.createdAt)}
                    </td>
                    <td className="px-3 text-court-fg-muted">
                      {relativeTime(c.updatedAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
