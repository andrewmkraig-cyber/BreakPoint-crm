import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { BillingTower } from "@/app/dashboard/billing-tower";
import { KpiTile } from "@/app/dashboard/kpi-tile";
import { UpcomingInterviews, type UpcomingInterviewRow } from "@/app/dashboard/upcoming-interviews";
import { prisma } from "@/lib/prisma";
import { recruiterflow, normalizeJob, normalizeClient } from "@/lib/recruiterflow";
import {
  Users,
  FileCheck2,
  Send,
  CalendarDays,
  PhoneCall,
} from "lucide-react";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  const firstName = session?.user?.name?.split(" ")[0] ?? "there";

  const now = new Date();
  const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [interviews, rfCandidates, rfJobs, rfClients] = await Promise.all([
    prisma.interview.findMany({
      where: { status: "scheduled", scheduledAt: { gte: now, lte: weekEnd } },
      orderBy: { scheduledAt: "asc" },
      include: {
        candidate: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
    recruiterflow.listAllCandidates({ perPage: 100 }).catch(() => []),
    recruiterflow.listAllJobs({ perPage: 100 }).catch(() => []),
    recruiterflow.listAllClients({ perPage: 100 }).catch(() => []),
  ]);

  const rfCandidateName = new Map<number, string>();
  for (const c of rfCandidates) {
    const name = c.name ?? [c.first_name, c.last_name].filter(Boolean).join(" ") ?? "(unnamed)";
    rfCandidateName.set(c.id, name);
  }
  const rfJobTitle = new Map<number, string>();
  for (const j of rfJobs) rfJobTitle.set(j.id, normalizeJob(j).title);
  const rfClientName = new Map<number, string>();
  for (const cl of rfClients) rfClientName.set(cl.id, normalizeClient(cl).name);

  const upcoming: UpcomingInterviewRow[] = interviews.map((iv) => {
    const candidateName = iv.candidateRfId != null
      ? rfCandidateName.get(iv.candidateRfId) ?? "(unknown)"
      : iv.candidate
        ? [iv.candidate.firstName, iv.candidate.lastName].filter(Boolean).join(" ") || "(unnamed)"
        : "(unknown)";
    const candidateHref = iv.candidateRfId != null
      ? `/candidates/${iv.candidateRfId}`
      : iv.candidateId
        ? `/candidates/${iv.candidateId}`
        : "/candidates";
    return {
      id: iv.id,
      candidateName,
      candidateHref,
      jobTitle: rfJobTitle.get(iv.jobRfId) ?? "(job)",
      clientName: rfClientName.get(iv.clientRfId) ?? "",
      scheduledAt: iv.scheduledAt.toISOString(),
      durationMin: iv.durationMin,
      type: iv.type as UpcomingInterviewRow["type"],
      source: iv.source as UpcomingInterviewRow["source"],
      meetLink: iv.meetLink,
    };
  });

  return (
    <div>
      <PageHeader
        eyebrow="This week"
        title={`Welcome back, ${firstName}.`}
        description="A quick look at the desk this week. Everything here is live activity — no targets, just actuals."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiTile label="New Clients" value={0} icon={Users} />
        <KpiTile label="Agreements Signed" value={0} icon={FileCheck2} />
        <KpiTile label="Submittals" value={0} icon={Send} />
        <KpiTile label="Interviews Scheduled" value={upcoming.length} icon={CalendarDays} />
        <KpiTile label="Calls Made" value={0} icon={PhoneCall} />
      </div>

      <div className="mt-8">
        <UpcomingInterviews rows={upcoming} />
      </div>

      <div className="mt-8">
        <BillingTower />
      </div>
    </div>
  );
}
