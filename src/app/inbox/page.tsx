import { PageHeader } from "@/components/page-header";
import { StubPanel } from "@/components/stub-panel";

export default function InboxPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Pipeline"
        title="Inbox"
        description="Live submitted and active candidates across every open job. Coming Day 2."
      />
      <StubPanel
        title="Pipeline view is coming in Day 2."
        description="Stages: Submitted → Interviewing → Offer → Pending Start → Hired. One row per submittal; Kept is a tag, not a stage. Stage moves happen automatically from your actions."
      />
    </div>
  );
}
