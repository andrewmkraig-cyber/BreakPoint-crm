import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ConnectorsView } from "@/app/settings/connectors-view";
import { CollapsibleSection } from "@/components/settings/collapsible-section";
import { getAllConnectorStatuses } from "@/lib/connectors";

export const dynamic = "force-dynamic";

export default async function ConnectorsSettingsPage() {
  // Ace 28.0: Connector statuses are computed server-side on page
  // load — Gmail hits Google's token endpoint, Claude + Quo each ping
  // a cheap health URL. The three checks run in parallel inside
  // getAllConnectorStatuses so the slowest one bounds total latency.
  const session = await getServerSession(authOptions);
  const sessionUserId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const connectors = await getAllConnectorStatuses(sessionUserId);

  return (
    <CollapsibleSection
      id="connectors"
      title="Connectors"
      description="Live health of Gmail, Claude, and Quo."
    >
      <ConnectorsView gmail={connectors.gmail} claude={connectors.claude} quo={connectors.quo} />
    </CollapsibleSection>
  );
}
