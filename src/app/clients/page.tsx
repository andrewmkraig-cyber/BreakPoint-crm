import { PageHeader } from "@/components/page-header";
import { StubPanel } from "@/components/stub-panel";

export default function ClientsPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Accounts"
        title="Clients"
        description="Client tiles with verified-agreement banner and submittal / interview / hire counts. Coming Day 2."
      />
      <StubPanel
        title="Clients board is coming in Day 2."
        description="Each tile drills into an overview tab (website, LinkedIn, industry, address, billing contact, fee agreement) plus a contacts tab."
      />
    </div>
  );
}
