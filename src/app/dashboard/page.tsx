import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { BillingTower } from "@/app/dashboard/billing-tower";
import { KpiTile } from "@/app/dashboard/kpi-tile";
import { Users, FileCheck2, Send, CalendarDays, PhoneCall } from "lucide-react";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  const firstName = session?.user?.name?.split(" ")[0] ?? "there";

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
        <KpiTile label="Interviews Scheduled" value={0} icon={CalendarDays} />
        <KpiTile label="Calls Made" value={0} icon={PhoneCall} />
      </div>

      <div className="mt-8">
        <BillingTower />
      </div>
    </div>
  );
}
