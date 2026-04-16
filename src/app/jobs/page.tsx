import { PageHeader } from "@/components/page-header";
import { StubPanel } from "@/components/stub-panel";

export default function JobsPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Requisitions"
        title="Jobs"
        description="Active and inactive jobs, pulled live from RecruiterFlow. Coming Day 2."
      />
      <StubPanel
        title="Jobs list is coming in Day 2."
        description="Will show client, title, location, comp, last edited, and submitted/interviewing/hired counts per job."
      />
    </div>
  );
}
