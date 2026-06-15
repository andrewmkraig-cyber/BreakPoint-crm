import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { CollapsibleSection } from "@/components/settings/collapsible-section";
import { BdInPageNav } from "./in-page-nav";
import { BdEngineSection } from "./bd-engine-section";
import { VerticalsSection, type SavedSearchRow, type VerticalRow } from "./verticals-section";
import { ApolloSection, type BdSequenceRow, type VerticalOption } from "./apollo-section";
import { APOLLO_SEQUENCES } from "@/lib/bd/apollo-sequences";
import { DomainsSection, type DomainRow } from "./domains-section";
import { fetchApolloMailboxes } from "@/lib/bd/apollo-email-accounts";
import {
  ContactTargetingSection,
  type ContactTargetingRow,
} from "./contact-targeting-section";
import { DEFAULT_CONTACT_TARGETING } from "@/lib/bd/apollo-contacts";
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

  const [verticalsRaw, sendingDomainsRaw, config, lastReply, versionCounts, lastRuns, apolloMailboxes, bdSequenceRows] =
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
              theirstackSavedSearchId: true,
              active: true,
              runFrequencyDays: true,
              lastDiscoveredAt: true,
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
      fetchApolloMailboxes(),
      prisma.bdSequence.findMany({
        where: { organizationId: org.id },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          name: true,
          apolloSequenceId: true,
          verticalId: true,
          active: true,
          vertical: { select: { name: true } },
        },
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
      theirstackSavedSearchId: s.theirstackSavedSearchId ?? null,
      active: s.active,
      runFrequencyDays: s.runFrequencyDays,
      lastDiscoveredIso: s.lastDiscoveredAt?.toISOString() ?? null,
      version: versionCountBySearchId.get(s.id) ?? 0,
      lastRunIso: lastRunBySearchId.get(s.id)?.toISOString() ?? null,
    })),
  }));

  // Verticals available to map a sequence to (Apollo Integration dropdown).
  const verticalOptions: VerticalOption[] = verticalsRaw.map((v) => ({ id: v.id, name: v.name }));

  // Sequences are now self-serve in the DB (BdSequence). The Apollo
  // Integration table + the Section 1 "Mapped Apollo Sequence" dropdown both
  // read from here, so a sequence added in Settings appears everywhere with no
  // code change. apollo-sequences.ts is the FALLBACK only when the table is
  // empty, so a fresh org (or a wiped table) still shows the default sequence
  // and existing saved searches keep resolving. The enroll path is untouched —
  // it still resolves its default from apollo-sequences.ts.
  const sequences: BdSequenceRow[] =
    bdSequenceRows.length > 0
      ? bdSequenceRows.map((s) => ({
          id: s.id,
          name: s.name,
          apolloSequenceId: s.apolloSequenceId,
          verticalId: s.verticalId,
          verticalName: s.vertical?.name ?? null,
          active: s.active,
        }))
      : APOLLO_SEQUENCES.map((s) => ({
          id: null,
          name: s.name,
          apolloSequenceId: s.apolloId,
          verticalId: null,
          verticalName: s.verticalName,
          active: s.status === "ACTIVE",
        }));

  // The saved-search dropdown picks a sequence by NAME (criteria.apolloSequenceId
  // stores the name string), so feed it the names from the same source.
  const sequenceNames = sequences.map((s) => s.name);

  const targetingRows = await prisma.bdContactTargeting.findMany({
    where: { organizationId: org.id },
    select: {
      verticalId: true,
      primaryTitles: true,
      smallFirmFallbackTitles: true,
      practiceSpecificTitles: true,
      maxPerFirm: true,
    },
  });
  const targetingByVertical = new Map(targetingRows.map((t) => [t.verticalId, t]));
  const contactTargeting: ContactTargetingRow[] = verticalsRaw.map((v) => {
    const existing = targetingByVertical.get(v.id);
    return {
      verticalId: v.id,
      verticalName: v.name,
      primaryTitles: existing?.primaryTitles ?? DEFAULT_CONTACT_TARGETING.primaryTitles,
      smallFirmFallbackTitles:
        existing?.smallFirmFallbackTitles ?? DEFAULT_CONTACT_TARGETING.smallFirmFallbackTitles,
      practiceSpecificTitles:
        existing?.practiceSpecificTitles ?? DEFAULT_CONTACT_TARGETING.practiceSpecificTitles,
      maxPerFirm: existing?.maxPerFirm ?? DEFAULT_CONTACT_TARGETING.maxPerFirm,
    };
  });

  // Match each sending mailbox by its FULL email address, not by domain.
  // Several mailboxes share one sending domain, so a domain-keyed map
  // collapsed them to a single Apollo status for every row. The
  // SendingDomain.domain column stores the full mailbox address.
  const mailboxByEmail = apolloMailboxes
    ? new Map(apolloMailboxes.map((m) => [m.email, m]))
    : null;
  const domains: DomainRow[] = sendingDomainsRaw.map((d, i) => {
    const match = mailboxByEmail?.get(d.domain.toLowerCase()) ?? null;
    return {
      id: d.id,
      domain: d.domain,
      status: d.status,
      inboxOwner: d.inboxOwner ?? "Andrew",
      priority: i + 1,
      lastCooldownIso: null,
      apollo:
        apolloMailboxes === null
          ? { state: "unavailable" }
          : match
            ? {
                state: "matched",
                connection: match.status,
                sendingDisabled: match.sendingDisabled,
                dailyLimit: match.dailyLimit,
                sentToday: match.sentToday,
              }
            : { state: "not-found" },
    };
  });

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
    replyPromptCreateClient: config?.replyPromptCreateClient ?? true,
    replyOooFilter: config?.replyOooFilter ?? true,
  };

  const apolloKey = process.env.APOLLO_API_KEY ?? null;
  const maskedApolloKey = apolloKey
    ? `apl_${"•".repeat(12)}${apolloKey.slice(-4)}`
    : null;

  return (
    <div className="flex flex-col gap-5">
      <BdInPageNav />

      <BdEngineSection
        config={{
          engineActive: config?.engineActive ?? false,
          globalDailyCap: config?.globalDailyCap ?? 80,
        }}
      />

      <CollapsibleSection
        id="verticals"
        title="Verticals & Saved Searches"
        description="Targets for the morning TheirStack discovery run. Each saved search defines who Apollo enriches and which sequence picks them up."
      >
        <VerticalsSection
          verticals={verticals}
          sequences={sequenceNames}
          globalDailyCap={limitsConfig.globalDailyCap}
        />
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
          verticals={verticalOptions}
        />
      </CollapsibleSection>

      <CollapsibleSection
        id="contact-targeting"
        title="Contact Targeting"
        description="Per-vertical title priority used by Apollo decision-maker fetches. Primary first, small-firm fallback only when no primary returned, max one practice-specific."
      >
        <ContactTargetingSection rows={contactTargeting} />
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
