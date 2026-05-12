import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { CollapsibleSection } from "@/components/settings/collapsible-section";
import { BdInPageNav } from "./in-page-nav";
import { VerticalsSection, type SavedSearchRow, type VerticalRow } from "./verticals-section";
import { ApolloSection, type SequencePreview } from "./apollo-section";
import { DomainsSection, type DomainRow } from "./domains-section";
import { LimitsSection, type LimitsConfig } from "./limits-section";
import { ReplyRoutingSection, type ReplyRoutingConfig } from "./reply-routing-section";

export const dynamic = "force-dynamic";

// Phase 3 BD Settings — five sections all on one page. Each section
// reads its own slice of state from the same server render and writes
// back via server actions (see ./actions.ts). The /bd/launch page
// reads BdOrgConfig.pauseAll on every render so the Section 4 toggle
// gates the Launch CTA without a build redeploy.
export default async function BdSettingsPage() {
  const org = await getCurrentOrg();

  const [verticalsRaw, sendingDomainsRaw, config, lastReply, versionCounts, lastRuns] =
    await Promise.all([
      prisma.vertical.findMany({
        where: { organizationId: org.id },
        orderBy: { name: "asc" },
        include: {
          savedSearches: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              name: true,
              criteria: true,
              contactCap: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      }),
      prisma.sendingDomain.findMany({
        where: { organizationId: org.id },
        orderBy: { lastUsedAt: "asc" },
        select: {
          id: true,
          domain: true,
          status: true,
          inboxOwner: true,
          dailyCap: true,
          lastUsedAt: true,
          updatedAt: true,
        },
      }),
      prisma.bdOrgConfig.findUnique({ where: { organizationId: org.id } }),
      prisma.bDActivity.findFirst({
        where: { organizationId: org.id, kind: "REPLY" },
        orderBy: { occurredAt: "desc" },
        select: { occurredAt: true },
      }),
      prisma.savedSearchVersion.groupBy({
        by: ["savedSearchId"],
        where: { organizationId: org.id },
        _count: { _all: true },
      }),
      prisma.bDRun.groupBy({
        by: ["savedSearchId"],
        where: { organizationId: org.id },
        _max: { createdAt: true },
      }),
    ]);

  const versionCountBySearchId = new Map(
    versionCounts.map((row) => [row.savedSearchId, row._count._all]),
  );
  const lastRunBySearchId = new Map(
    lastRuns.map((row) => [row.savedSearchId, row._max.createdAt]),
  );

  const verticals: VerticalRow[] = verticalsRaw.map((v) => ({
    id: v.id,
    name: v.name,
    slug: v.slug,
    dailyCap: v.dailyCap ?? null,
    savedSearches: v.savedSearches.map<SavedSearchRow>((s) => ({
      id: s.id,
      name: s.name,
      contactCap: s.contactCap ?? null,
      criteria: (s.criteria ?? {}) as SavedSearchRow["criteria"],
      version: versionCountBySearchId.get(s.id) ?? 0,
      lastRunIso: lastRunBySearchId.get(s.id)?.toISOString() ?? null,
    })),
  }));

  // Phase 3 sequences are hardcoded placeholders until the Apollo
  // integration ships in Phase 4. The dropdown in Section 1 sources
  // from the same list so the UI is consistent end-to-end.
  const sequences: SequencePreview[] = [
    { name: "BD Outbound v1", verticalName: verticals[0]?.name ?? "—", steps: 5 },
    { name: "Public Accounting Cold Sequence", verticalName: "Public Accounting", steps: 6 },
    { name: "Legal Outreach v2", verticalName: "Legal", steps: 4 },
  ];

  const domains: DomainRow[] = sendingDomainsRaw.map((d, i) => ({
    id: d.id,
    domain: d.domain,
    status: d.status,
    inboxOwner: d.inboxOwner ?? "Andrew",
    priority: i + 1,
    lastCooldownIso: null,
    reputation: 85,
  }));

  const limitsConfig: LimitsConfig = {
    globalDailyCap: config?.globalDailyCap ?? 80,
    pauseAll: config?.pauseAll ?? false,
    blackoutWeekends: config?.blackoutWeekends ?? false,
    blackoutHolidays: config?.blackoutHolidays ?? false,
    blackoutBefore7am: config?.blackoutBefore7am ?? false,
    blackoutAfter530pm: config?.blackoutAfter530pm ?? false,
  };

  const replyConfig: ReplyRoutingConfig = {
    replyForwardApollo: config?.replyForwardApollo ?? false,
    replyAutoCreateCandidate: config?.replyAutoCreateCandidate ?? true,
    replyOooFilter: config?.replyOooFilter ?? true,
  };

  const apolloKey = process.env.APOLLO_API_KEY ?? null;
  const maskedApolloKey = apolloKey
    ? `apl_${"•".repeat(12)}${apolloKey.slice(-4)}`
    : null;

  return (
    <div className="flex flex-col gap-5">
      <BdInPageNav />

      <CollapsibleSection
        id="verticals"
        title="Verticals & Saved Searches"
        description="Targets for the morning Indeed scan. Each saved search defines who Apollo enriches and which sequence picks them up."
      >
        <VerticalsSection verticals={verticals} sequences={sequences.map((s) => s.name)} />
      </CollapsibleSection>

      <CollapsibleSection
        id="apollo"
        title="Apollo Integration"
        description="Outbound execution layer. Ace orchestrates, Apollo sends."
      >
        <ApolloSection
          isConfigured={!!apolloKey}
          maskedKey={maskedApolloKey}
          sequences={sequences}
        />
      </CollapsibleSection>

      <CollapsibleSection
        id="sending-domains"
        title="Sending Domains"
        description="Warmed domains Apollo rotates outbound across. Five healthy slots is the rotation pool."
      >
        <DomainsSection domains={domains} />
      </CollapsibleSection>

      <CollapsibleSection
        id="daily-limits"
        title="Daily Limits"
        description="Org and per-vertical contact caps plus blackout windows and the kill switch."
      >
        <LimitsSection config={limitsConfig} verticals={verticals} />
      </CollapsibleSection>

      <CollapsibleSection
        id="reply-routing"
        title="Reply Routing"
        description="Replies land in Ace Mail tagged BD. Toggles below shape the downstream behavior."
      >
        <ReplyRoutingSection
          config={replyConfig}
          lastReplyIso={lastReply?.occurredAt?.toISOString() ?? null}
          webhookPath="/api/webhooks/apollo/reply"
        />
      </CollapsibleSection>
    </div>
  );
}
