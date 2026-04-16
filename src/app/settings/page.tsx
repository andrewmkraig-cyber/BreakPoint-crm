import { PageHeader } from "@/components/page-header";
import { StubPanel } from "@/components/stub-panel";

export default function SettingsPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Admin"
        title="Settings"
        description="Email templates, trigger configuration, and user management. Coming Day 3."
      />
      <StubPanel
        title="Settings is coming in Day 3."
        description="Will include email template editor with variables, trigger assignments (submitted, interview scheduled, start confirmed, etc.), and user management (Andrew + Austin, both admin)."
      />
    </div>
  );
}
