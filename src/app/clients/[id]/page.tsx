import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShieldCheck, Briefcase } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import {
  canonicalStage,
  emptyJobCounts,
  type JobPipelineCounts,
  type RFClient,
} from "@/lib/rf-payload-shapes";
import { getClientByIdentifier } from "@/lib/clients";
import { cn } from "@/lib/utils";
import { prisma } from "@/lib/prisma";
import { ContactsTab } from "@/app/clients/[id]/contacts-tab";
import { AgreementsTab } from "@/app/clients/[id]/agreements-tab";
import { BenefitsTab } from "@/app/clients/[id]/benefits-tab";
import { EditableCompany, type CompanyState } from "@/app/clients/[id]/editable-company";
import { DeleteClientButton } from "@/app/clients/[id]/delete-client-button";
import { AddClientNote } from "@/app/clients/[id]/add-client-note";
import { ClientLogo } from "@/components/clients/client-logo";
import AiWorkspace from "@/components/AiWorkspace";
import { FindMatchesButton } from "@/components/game-plan/find-matches-button";
import { ActivityFeed } from "@/components/activity-feed";
import { EntityNotesSection } from "@/components/notes/entity-notes-section";
import { CallLogs } from "@/components/call-logs";
import { TextingExchanges } from "@/components/texting-exchanges";
import { TaggedThreadList } from "@/components/mail/tagged-thread-list";
import { TabStrip, type TabStripItem } from "@/components/ui/tab-strip";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ClientTab = "overview" | "contacts" | "agreements" | "benefits" | "game-plan" | "notes" | "activity" | "email";

type LocationJson = {
  street_address_1?: string | null;
  street_address_2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
} | null;

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { tab?: ClientTab };
}) {
  // Accept either a cuid (Ace-native, post-Phase-3 canonical) or a
  // numeric legacyRfId (back-compat with URLs that predate the cutover).
  const client = await getClientByIdentifier(params.id);
  if (!client) notFound();

  const tab: ClientTab =
    searchParams?.tab === "contacts" ||
    searchParams?.tab === "agreements" ||
    searchParams?.tab === "benefits" ||
    searchParams?.tab === "game-plan" ||
    searchParams?.tab === "notes" ||
    searchParams?.tab === "activity" ||
    searchParams?.tab === "email"
      ? searchParams.tab
      : "overview";

  const raw = (client.raw ?? null) as RFClient | null;
  const legacyRfId = client.legacyRfId;

  // Agreements / benefits are keyed by the legacy numeric id (Phase 5
  // drop). Ace-native Clients without a legacyRfId have no agreements
  // or benefits yet; skip the query rather than fetching with a sentinel.
  const [contacts, agreements, benefits, benefitsFiles] = await Promise.all([
    legacyRfId != null
      ? prisma.contact.findMany({
          where: { OR: [{ clientId: client.id }, { client: { legacyRfId } }] },
          select: {
            id: true,
            legacyRfId: true,
            firstName: true,
            lastName: true,
            name: true,
            emails: true,
            phoneNumbers: true,
            currentDesignation: true,
            linkedinProfile: true,
            notes: true,
            lastActivityAt: true,
            addedAt: true,
          },
        })
      : prisma.contact.findMany({
          where: { clientId: client.id },
          select: {
            id: true,
            legacyRfId: true,
            firstName: true,
            lastName: true,
            name: true,
            emails: true,
            phoneNumbers: true,
            currentDesignation: true,
            linkedinProfile: true,
            notes: true,
            lastActivityAt: true,
            addedAt: true,
          },
        }),
    legacyRfId != null
      ? prisma.clientAgreement.findMany({
          where: { clientRfId: legacyRfId, uploadComplete: true },
          orderBy: { uploadedAt: "desc" },
          select: {
            id: true,
            filename: true,
            mimeType: true,
            size: true,
            uploadedAt: true,
            summary: true,
            summaryUpdatedAt: true,
            uploadedBy: { select: { name: true, email: true } },
          },
        })
      : Promise.resolve([] as Array<never>),
    legacyRfId != null
      ? prisma.clientBenefits.findUnique({
          where: { clientRfId: legacyRfId },
          select: {
            body: true,
            updatedAt: true,
            updatedBy: { select: { name: true, email: true } },
          },
        })
      : Promise.resolve(null),
    legacyRfId != null
      ? prisma.clientBenefitsFile.findMany({
          where: { clientRfId: legacyRfId, uploadComplete: true },
          orderBy: { uploadedAt: "desc" },
          select: {
            id: true,
            filename: true,
            mimeType: true,
            size: true,
            uploadedAt: true,
            uploadedBy: { select: { name: true, email: true } },
          },
        })
      : Promise.resolve([] as Array<never>),
  ]);

  const location = (client.location as LocationJson) ?? null;
  const displayName = client.name || "(unnamed)";

  // Custom-field scraping from raw — only meaningful for RF-imported rows.
  const customField = (match: (name: string) => boolean): unknown => {
    if (!Array.isArray(raw?.custom_fields)) return undefined;
    return raw!.custom_fields!.find((f) => typeof f?.name === "string" && match(f.name.toLowerCase()))?.value;
  };
  const signedFlag = customField((n) => n.includes("signed agreement"));
  const agreementDate = customField((n) => n === "agreement date" || n.includes("agreement date"));
  const feePctRaw = customField((n) => n.includes("avg fee") || n.includes("fee %") || n.includes("fee percent"));
  const billingContact = customField((n) => n.includes("billing contact"));
  const agreementFile = Array.isArray(raw?.files)
    ? raw!.files!.find((f) => typeof f?.filename === "string" && f.filename.toLowerCase().includes("agreement")) ?? null
    : null;
  const feePct =
    typeof feePctRaw === "number" ? feePctRaw : typeof feePctRaw === "string" ? parseFloat(feePctRaw) || null : null;

  // Stat strip counts come from Neon Placement.stage (the canonical
  // source of truth post-Phase-5), not from RF payload stage_name.
  // The previous buildClientCounts(candidates) read RFCandidate.jobs[]
  // which lagged whenever an Ace stage move hadn't synced back to RF —
  // Sheehan Brothers showed Interviewing=0 for that reason. Prisma
  // groupBy here filters by Neon clientId cuid + organizationId (Rule 8).
  const placementGroups = await prisma.placement.groupBy({
    by: ["stage"],
    where: { clientId: client.id, organizationId: client.organizationId },
    _count: { _all: true },
  });
  const counts = emptyJobCounts();
  for (const g of placementGroups) {
    const bucket = canonicalStage(g.stage);
    const n = g._count._all;
    switch (bucket) {
      case "submitted":
        counts.submitted += n;
        counts.totalActive += n;
        break;
      case "interviewing":
        counts.interviewing += n;
        counts.totalActive += n;
        break;
      case "offer":
        counts.offer += n;
        counts.totalActive += n;
        break;
      case "pending_start":
        counts.pendingStart += n;
        counts.totalActive += n;
        break;
      case "hired":
        counts.hired += n;
        break;
      default:
        break;
    }
  }
  // Per-job row counters: another Prisma groupBy keyed by (jobRfId, stage)
  // so each job's row in the Jobs table reads from canonical Neon stages
  // rather than RFCandidate.jobs[]. Same pattern as the strip above.
  // Ace-native Jobs (jobRfId null) aren't in the openJobs/closedJobs RF
  // arrays anyway so excluding them here matches the table's data source.
  const jobPlacementGroups = await prisma.placement.groupBy({
    by: ["jobRfId", "stage"],
    where: {
      clientId: client.id,
      organizationId: client.organizationId,
      jobRfId: { not: null },
    },
    _count: { _all: true },
  });
  const jobCountsById = new Map<number, JobPipelineCounts>();
  for (const g of jobPlacementGroups) {
    if (g.jobRfId == null) continue;
    const bucket = canonicalStage(g.stage);
    const n = g._count._all;
    const pc = jobCountsById.get(g.jobRfId) ?? emptyJobCounts();
    switch (bucket) {
      case "submitted":
        pc.submitted += n;
        pc.totalActive += n;
        break;
      case "interviewing":
        pc.interviewing += n;
        pc.totalActive += n;
        break;
      case "offer":
        pc.offer += n;
        pc.totalActive += n;
        break;
      case "pending_start":
        pc.pendingStart += n;
        pc.totalActive += n;
        break;
      case "hired":
        pc.hired += n;
        break;
      default:
        break;
    }
    jobCountsById.set(g.jobRfId, pc);
  }

  const openJobs = Array.isArray(raw?.open_jobs) ? raw!.open_jobs! : [];
  const closedJobs = Array.isArray(raw?.closed_jobs) ? raw!.closed_jobs! : [];

  // Fee Agreement seed: prefer Ace-native columns; for clients imported
  // before these columns existed, fall through to the RF custom_fields
  // scrape so the recruiter sees the current value on first load. Once
  // they hit Save in the unified editor the Ace columns are canonical.
  const seedSignedAt =
    client.feeAgreementSignedAt ??
    (typeof agreementDate === "string" && agreementDate ? new Date(agreementDate) : null);
  const seedSignedAtIso =
    seedSignedAt instanceof Date && !Number.isNaN(seedSignedAt.getTime())
      ? seedSignedAt.toISOString().slice(0, 10)
      : "";
  const seedFeePct =
    client.feePct != null
      ? String(client.feePct)
      : feePct != null
        ? String(feePct)
        : "";
  const seedBillingContact =
    client.feeBillingContact ??
    (typeof billingContact === "string" ? billingContact : "") ??
    "";
  const seedSigned =
    client.feeAgreementSigned ??
    Boolean(signedFlag) ??
    false;

  const companyInitial: CompanyState = {
    website: client.domain ?? "",
    linkedin: client.linkedinPage ?? "",
    phone: firstPhone(client.phoneNumbers),
    industry: client.industry ?? "",
    street1: location?.street_address_1 ?? "",
    street2: location?.street_address_2 ?? "",
    city: location?.city ?? "",
    state: location?.state ?? "",
    postalCode: location?.postal_code ?? "",
    country: location?.country ?? "",
    feeAgreementSigned: seedSigned,
    feeAgreementSignedAt: seedSignedAtIso,
    feePct: seedFeePct,
    feeBillingContact: seedBillingContact,
  };

  const agreementFileForCard = agreementFile?.link
    ? { filename: agreementFile.filename ?? "Open PDF", link: agreementFile.link }
    : null;

  return (
    <div className="space-y-6">
      <Link href="/clients" className="inline-flex items-center gap-1 text-xs text-court-fg-muted hover:text-court-fg">
        <ArrowLeft className="h-3 w-3" /> Back to clients
      </Link>

      <PageHeader
        title={displayName}
        leading={<ClientLogo name={displayName} domain={client.domain} size={40} />}
        actions={
          agreements.length > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-tint px-3 py-1 text-xs font-semibold text-brand-dark">
              <ShieldCheck className="h-3 w-3" /> Verified · signed agreement
            </span>
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Submitted" value={counts.submitted} tone="brand" href={`/pipeline?clientId=${client.id}&stage=submitted`} />
        <Stat label="Interviewing" value={counts.interviewing} tone="brand" href={`/pipeline?clientId=${client.id}&stage=interviewing`} />
        <Stat label="Offer" value={counts.offer} tone="brand" href={`/pipeline?clientId=${client.id}&stage=offer`} />
        <Stat label="Pending Start" value={counts.pendingStart} tone="brand" href={`/pipeline?clientId=${client.id}&stage=pending_start`} />
        <Stat label="Hired" value={counts.hired} tone="brand" href={`/pipeline?clientId=${client.id}&stage=hired`} />
      </div>

      <Tabs
        tab={tab}
        slug={client.legacyRfId != null ? String(client.legacyRfId) : client.id}
        contactsCount={contacts.length}
        agreementsCount={agreements.length}
        benefitsFilesCount={benefitsFiles.length}
        hasBenefits={Boolean(benefits?.body?.trim())}
      />

      {tab === "overview" ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <EditableCompany
            clientCuid={client.id}
            initial={companyInitial}
            agreementFile={agreementFileForCard}
          />

          <div className="rounded-xl border border-court-border/40 bg-court-surface shadow-sm lg:col-span-3">
            <div className="flex items-center justify-between border-b border-court-border px-5 py-3">
              <h2 className="font-serif text-lg font-semibold text-court-fg">Jobs</h2>
              <span className="text-xs text-court-fg-muted">
                {openJobs.length} open · {closedJobs.length} closed
              </span>
            </div>
            {openJobs.length + closedJobs.length === 0 ? (
              <div className="px-5 py-12 text-center text-sm text-court-fg-muted">No jobs yet for this client.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-court-border bg-court-surface-subtle/60 text-[11px] uppercase tracking-wider text-court-fg-muted">
                    <tr>
                      <th className="px-5 py-2.5 font-medium">Job</th>
                      <th className="px-5 py-2.5 font-medium">Status</th>
                      <th className="px-5 py-2.5 text-right font-medium">Submitted</th>
                      <th className="px-5 py-2.5 text-right font-medium">Interviewing</th>
                      <th className="px-5 py-2.5 text-right font-medium">Offer</th>
                      <th className="px-5 py-2.5 text-right font-medium">Pending Start</th>
                      <th className="px-5 py-2.5 text-right font-medium">Hired</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-court-border">
                    {[...openJobs, ...closedJobs].map((j) => {
                      const isOpen = openJobs.includes(j);
                      const c = jobCountsById.get(j.id) ?? emptyJobCounts();
                      return (
                        <tr key={j.id} className="transition hover:bg-brand-tint/40">
                          <td className="px-5 py-2.5">
                            <Link
                              href={`/jobs/${j.id}`}
                              className="flex items-center gap-2 font-medium text-court-fg hover:text-brand-dark"
                            >
                              <Briefcase className="h-4 w-4 text-court-fg-muted" />
                              <span>{j.name ?? j.title ?? "(untitled)"}</span>
                            </Link>
                          </td>
                          <td className="px-5 py-2.5">
                            <span
                              className={cn(
                                "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
                                isOpen ? "bg-emerald-50 text-emerald-700" : "bg-court-surface-subtle text-court-fg-muted",
                              )}
                            >
                              {isOpen ? "Active" : "Closed"}
                            </span>
                          </td>
                          <td className="px-5 py-2.5 text-right">
                            <JobCountPill
                              value={c.submitted}
                              tone="submitted"
                              href={c.submitted > 0 ? `/pipeline?clientId=${client.id}&jobId=${j.id}&stage=submitted` : undefined}
                            />
                          </td>
                          <td className="px-5 py-2.5 text-right">
                            <JobCountPill
                              value={c.interviewing}
                              tone="interviewing"
                              href={c.interviewing > 0 ? `/pipeline?clientId=${client.id}&jobId=${j.id}&stage=interviewing` : undefined}
                            />
                          </td>
                          <td className="px-5 py-2.5 text-right">
                            <JobCountPill
                              value={c.offer}
                              tone="offer"
                              href={c.offer > 0 ? `/pipeline?clientId=${client.id}&jobId=${j.id}&stage=offer` : undefined}
                            />
                          </td>
                          <td className="px-5 py-2.5 text-right">
                            <JobCountPill
                              value={c.pendingStart}
                              tone="pendingStart"
                              href={c.pendingStart > 0 ? `/pipeline?clientId=${client.id}&jobId=${j.id}&stage=pending_start` : undefined}
                            />
                          </td>
                          <td className="px-5 py-2.5 text-right">
                            <JobCountPill
                              value={c.hired}
                              tone="hired"
                              href={c.hired > 0 ? `/pipeline?clientId=${client.id}&jobId=${j.id}&stage=hired` : undefined}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* TODO: Email thread display — pending auto-tagging. Raw
              GmailThreadTag.threadId list rendered useless without
              subject/preview metadata; cut until the auto-tagging
              fetch surfaces those. */}
        </div>
      ) : tab === "contacts" ? (
        <ContactsTab
          clientCuid={client.id}
          clientName={displayName}
          initialContacts={contacts.map((c) => ({
            id: c.id,
            legacyRfId: c.legacyRfId,
            firstName: c.firstName ?? "",
            lastName: c.lastName ?? "",
            name:
              [c.firstName, c.lastName].filter(Boolean).join(" ") ||
              c.name ||
              "(unnamed)",
            title: c.currentDesignation ?? "",
            email: Array.isArray(c.emails) && c.emails.length > 0 ? c.emails[0] : "",
            phone: firstPhone(c.phoneNumbers),
            extension: firstExtension(c.phoneNumbers),
            linkedIn: c.linkedinProfile ?? null,
            notes: c.notes ?? "",
            lastContactedAt:
              (c.lastActivityAt?.toISOString() ?? c.addedAt?.toISOString()) ?? null,
          }))}
        />
      ) : tab === "agreements" && legacyRfId != null ? (
        <AgreementsTab
          clientId={legacyRfId}
          items={agreements.map((a) => ({
            id: a.id,
            filename: a.filename,
            mimeType: a.mimeType,
            sizeBytes: a.size,
            uploadedAt: a.uploadedAt.toISOString(),
            uploadedByName: a.uploadedBy?.name ?? a.uploadedBy?.email ?? null,
            summary: a.summary,
            summaryUpdatedAt: a.summaryUpdatedAt?.toISOString() ?? null,
          }))}
        />
      ) : tab === "benefits" && legacyRfId != null ? (
        <BenefitsTab
          clientId={legacyRfId}
          initial={{
            body: benefits?.body ?? "",
            updatedAt: benefits?.updatedAt?.toISOString() ?? null,
            updatedByName: benefits?.updatedBy?.name ?? benefits?.updatedBy?.email ?? null,
          }}
          files={benefitsFiles.map((f) => ({
            id: f.id,
            filename: f.filename,
            mimeType: f.mimeType,
            sizeBytes: f.size,
            uploadedAt: f.uploadedAt.toISOString(),
            uploadedByName: f.uploadedBy?.name ?? f.uploadedBy?.email ?? null,
          }))}
        />
      ) : tab === "game-plan" && legacyRfId != null ? (
        <div className="space-y-4">
          <div className="flex items-center justify-end gap-3">
            <FindMatchesButton
              target={{
                kind: "client",
                clientId: client.id,
                label: client.name ?? "Client",
              }}
            />
          </div>
          <AiWorkspace entityType="client" entityId={String(legacyRfId)} />
        </div>
      ) : tab === "notes" ? (
        <section className="rounded-xl border border-court-border/40 bg-court-surface shadow-sm">
          <header className="border-b border-court-border px-5 py-3">
            <h2 className="font-serif text-base font-semibold text-court-fg">Notes</h2>
            <p className="mt-0.5 text-xs text-court-fg-muted">
              Recruiter notes attached to this client. Newest at the top.
            </p>
          </header>
          <div className="space-y-4 p-5">
            <AddClientNote clientId={client.id} />
            {client.notes ? (
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-court-fg">
                {client.notes}
              </pre>
            ) : (
              <p className="text-sm text-court-fg-muted">
                No notes yet for this client.
              </p>
            )}
          </div>
        </section>
      ) : tab === "activity" ? (
        <div className="space-y-6">
          {/* Calls & SMS — auto-populated through the Quo webhook. The
              call.completed / message.received branches now stamp
              clientId on the write path by matching Contact.phoneNumbers,
              so client-only conversations land here without manual
              tagging. CallLogs handles transcripts + AI summaries
              inline; TextingExchanges renders the inbound/outbound
              chat bubbles. */}
          <section className="space-y-3 rounded-2xl border border-court-border/40 bg-court-surface p-5 shadow-sm">
            <h2 className="font-serif text-lg font-semibold text-court-fg">Calls &amp; SMS</h2>
            <CallLogs clientId={client.id} defaultOpen />
            <TextingExchanges clientId={client.id} defaultOpen />
          </section>
          <EntityNotesSection entityType="client" entityId={client.id} />
          <ActivityFeed entityType="client" entityId={client.id} />
        </div>
      ) : tab === "email" ? (
        <section className="rounded-2xl border border-court-border/40 bg-court-surface p-5 shadow-sm">
          <h2 className="mb-3 font-serif text-lg font-semibold text-court-fg">Email</h2>
          <TaggedThreadList url={`/api/clients/${encodeURIComponent(client.id)}/email-threads`} pageSize={10} />
        </section>
      ) : (
        <div className="rounded-xl border border-court-border/40 bg-court-surface p-6 text-sm text-court-fg-muted">
          This tab isn&apos;t available yet for Ace-native clients.
        </div>
      )}

      <DeleteClientButton clientId={client.id} clientName={displayName} />
    </div>
  );
}

function Tabs({
  tab,
  slug,
  contactsCount,
  agreementsCount,
  benefitsFilesCount,
  hasBenefits,
}: {
  tab: ClientTab;
  slug: string;
  contactsCount: number;
  agreementsCount: number;
  benefitsFilesCount: number;
  hasBenefits: boolean;
}) {
  const items: ReadonlyArray<TabStripItem<ClientTab>> = [
    { id: "overview", label: "Overview", href: `/clients/${slug}?tab=overview` },
    { id: "contacts", label: "Contacts", count: contactsCount, href: `/clients/${slug}?tab=contacts` },
    { id: "agreements", label: "Agreements", count: agreementsCount, href: `/clients/${slug}?tab=agreements` },
    {
      id: "benefits",
      label: "Benefits",
      count: benefitsFilesCount > 0 ? benefitsFilesCount : undefined,
      dot: hasBenefits && benefitsFilesCount === 0,
      href: `/clients/${slug}?tab=benefits`,
    },
    { id: "game-plan", label: "Game Plan", href: `/clients/${slug}?tab=game-plan` },
    { id: "notes", label: "Notes", href: `/clients/${slug}?tab=notes` },
    { id: "activity", label: "Activity", href: `/clients/${slug}?tab=activity` },
    { id: "email", label: "Email", href: `/clients/${slug}?tab=email` },
  ];
  return <TabStrip<ClientTab> ariaLabel="Client section" activeId={tab} items={items} />;
}

function Stat({
  label,
  value,
  tone,
  href,
}: {
  label: string;
  value: string | number;
  tone: "brand" | "blue" | "purple" | "amber" | "emerald";
  href?: string;
}) {
  const cls = {
    brand: "text-brand-dark",
    blue: "text-blue-700",
    purple: "text-purple-700",
    amber: "text-amber-700",
    emerald: "text-emerald-700",
  }[tone];
  const effective = typeof value === "number" && value === 0 ? "text-court-fg-muted/60" : cls;
  const inner = (
    <>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">{label}</div>
      <div className={cn("font-serif text-[26px] font-extrabold leading-none tracking-tight", effective)}>{value}</div>
    </>
  );
  const wrapperCls =
    "flex items-baseline justify-between gap-3 rounded-xl border border-court-border/40 bg-court-surface px-3.5 py-2 shadow-sm";
  if (href) {
    return (
      <Link href={href} className={cn(wrapperCls, "transition hover:border-court-accent hover:shadow-sm")}>
        {inner}
      </Link>
    );
  }
  return <div className={wrapperCls}>{inner}</div>;
}

function JobCountPill({
  value,
  tone,
  href,
}: {
  value: number;
  tone: "submitted" | "interviewing" | "offer" | "pendingStart" | "hired";
  href?: string;
}) {
  // Zero counts always render as plain muted text — no link, no pill —
  // since there's nothing to navigate to.
  if (!value) return <span className="text-court-fg-muted/60">0</span>;
  const cls = {
    submitted: "bg-brand-tint text-brand-dark",
    interviewing: "bg-blue-50 text-blue-700",
    offer: "bg-purple-50 text-purple-700",
    pendingStart: "bg-amber-50 text-amber-700",
    hired: "bg-emerald-50 text-emerald-700",
  }[tone];
  const pillCls = cn("inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-xs font-bold", cls);
  if (href) {
    return (
      <Link href={href} className={cn(pillCls, "transition hover:brightness-110")}>
        {value}
      </Link>
    );
  }
  return <span className={pillCls}>{value}</span>;
}

function firstPhone(raw: unknown): string {
  if (!Array.isArray(raw) || raw.length === 0) return "";
  const first = raw[0];
  if (typeof first === "string") return first;
  if (first && typeof first === "object" && "number" in (first as object)) {
    const n = (first as { number?: string }).number;
    return typeof n === "string" ? n : "";
  }
  return "";
}

function firstExtension(raw: unknown): string {
  if (!Array.isArray(raw) || raw.length === 0) return "";
  const first = raw[0];
  if (first && typeof first === "object" && "extension" in (first as object)) {
    const ext = (first as { extension?: string | null }).extension;
    return typeof ext === "string" ? ext : "";
  }
  return "";
}
