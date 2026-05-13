import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ConnectorsView } from "@/app/settings/connectors-view";
import { MercuryConnectorCard } from "@/app/settings/connectors/mercury-card";
import { CollapsibleSection } from "@/components/settings/collapsible-section";
import { getAllConnectorStatuses } from "@/lib/connectors";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function maskMercuryKey(key: string): string {
  if (key.length <= 8) return "•".repeat(Math.max(key.length, 4));
  return `${key.slice(0, 4)}${"•".repeat(8)}${key.slice(-4)}`;
}

export default async function ConnectorsSettingsPage() {
  // Ace 28.0: Connector statuses are computed server-side on page
  // load — Gmail hits Google's token endpoint, Claude + Quo each ping
  // a cheap health URL. The three checks run in parallel inside
  // getAllConnectorStatuses so the slowest one bounds total latency.
  const session = await getServerSession(authOptions);
  const sessionUserId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const [connectors, org] = await Promise.all([
    getAllConnectorStatuses(sessionUserId),
    getCurrentOrg(),
  ]);
  const orgRow = await prisma.organization.findUnique({
    where: { id: org.id },
    select: { mercuryApiKey: true },
  });
  const mercuryMasked = orgRow?.mercuryApiKey
    ? maskMercuryKey(orgRow.mercuryApiKey)
    : null;

  return (
    <CollapsibleSection
      id="connectors"
      title="Connectors"
      description="Live health of Gmail, Claude, Quo, and Mercury."
    >
      <ConnectorsView gmail={connectors.gmail} claude={connectors.claude} quo={connectors.quo} />
      <div className="mt-2">
        <MercuryConnectorCard maskedKey={mercuryMasked} />
      </div>
    </CollapsibleSection>
  );
}
