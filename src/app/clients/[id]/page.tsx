import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ExternalLink,
  FileText,
  Globe,
  MapPin,
  Phone,
  ShieldCheck,
  Briefcase,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import {
  recruiterflow,
  normalizeClient,
  buildClientCounts,
  emptyJobCounts,
  formatPhone,
  telHref,
} from "@/lib/recruiterflow";
import { cn } from "@/lib/utils";
import { prisma } from "@/lib/prisma";
import { ContactsTab } from "@/app/clients/[id]/contacts-tab";
import { AgreementsTab } from "@/app/clients/[id]/agreements-tab";
import { BenefitsTab } from "@/app/clients/[id]/benefits-tab";

export const dynamic = "force-dynamic";
// Claude summarization on a 25-page PDF can take 30–60s. Default Hobby
// function timeout is 10s; bump to the Hobby ceiling.
export const maxDuration = 60;

type ClientTab = "overview" | "contacts" | "agreements" | "benefits";

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { tab?: ClientTab };
}) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) notFound();

  const tab: ClientTab =
    searchParams?.tab === "contacts" ||
    searchParams?.tab === "agreements" ||
    searchParams?.tab === "benefits"
      ? searchParams.tab
      : "overview";

  const [clients, candidates, contacts, agreements, benefits, benefitsFiles] = await Promise.all([
    recruiterflow.listAllClients({ perPage: 100 }),
    recruiterflow.listAllCandidates({ perPage: 100 }),
    recruiterflow.listAllContacts({ perPage: 100 }),
    prisma.clientAgreement.findMany({
      where: { clientRfId: id },
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
    }),
    prisma.clientBenefits.findUnique({
      where: { clientRfId: id },
      select: {
        body: true,
        updatedAt: true,
        updatedBy: { select: { name: true, email: true } },
      },
    }),
    prisma.clientBenefitsFile.findMany({
      where: { clientRfId: id },
      orderBy: { uploadedAt: "desc" },
      select: {
        id: true,
        filename: true,
        mimeType: true,
        size: true,
        uploadedAt: true,
        uploadedBy: { select: { name: true, email: true } },
      },
    }),
  ]);

  const raw = clients.find((c) => c.id === id);
  if (!raw) notFound();

  const client = normalizeClient(raw);
  const counts = buildClientCounts(candidates).get(id) ?? emptyJobCounts();
  const clientContacts = contacts.filter((c) => c.client_company_id === id);

  const openJobs = Array.isArray(raw.open_jobs) ? raw.open_jobs : [];
  const closedJobs = Array.isArray(raw.closed_jobs) ? raw.closed_jobs : [];

  const addressLines: string[] = [];
  if (raw.location?.street_address_1) addressLines.push(raw.location.street_address_1);
  if (raw.location?.street_address_2) addressLines.push(raw.location.street_address_2);
  const cityStateZip = [raw.location?.city, raw.location?.state, raw.location?.postal_code].filter(Boolean).join(", ");
  if (cityStateZip) addressLines.push(cityStateZip);
  if (raw.location?.country) addressLines.push(raw.location.country);

  return (
    <div className="space-y-6">
      <Link href="/clients" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-navy">
        <ArrowLeft className="h-3 w-3" /> Back to clients
      </Link>

      <PageHeader
        eyebrow="Client"
        title={client.name || "(unnamed)"}
        description={[client.industry, client.location].filter(Boolean).join(" · ") || undefined}
        actions={
          client.isVerified ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-tint px-3 py-1 text-xs font-semibold text-brand-dark">
              <ShieldCheck className="h-3 w-3" /> Verified · signed agreement
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">
              No signed agreement on file
            </span>
          )
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Submitted" value={counts.submitted} tone="brand" />
        <Stat label="Interviewing" value={counts.interviewing} tone="blue" />
        <Stat label="Hired" value={counts.hired} tone="emerald" />
        <Stat label="Open Jobs" value={openJobs.length} tone="muted" />
      </div>

      <Tabs
        tab={tab}
        clientId={id}
        contactsCount={clientContacts.length}
        agreementsCount={agreements.length}
        benefitsFilesCount={benefitsFiles.length}
        hasBenefits={Boolean(benefits?.body?.trim())}
      />

      {tab === "overview" ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="rounded-xl border border-border bg-white p-5 shadow-sm lg:col-span-2">
            <h2 className="font-serif text-lg font-semibold text-navy">Company</h2>
            <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Detail label="Website" icon={<Globe className="h-3 w-3" />}>
                {client.website ? (
                  <a href={client.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-dark hover:underline">
                    {client.domain || client.website} <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  <span>—</span>
                )}
              </Detail>
              <Detail label="LinkedIn">
                {client.linkedIn ? (
                  <a href={client.linkedIn} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-dark hover:underline">
                    Company page <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  <span>—</span>
                )}
              </Detail>
              <Detail label="Industry">
                <span>{client.industry || "—"}</span>
              </Detail>
              <Detail label="Phone" icon={<Phone className="h-3 w-3" />}>
                {client.phone ? (
                  <a href={telHref(client.phone)} className="text-navy hover:text-brand-dark">
                    {formatPhone(client.phone)}
                  </a>
                ) : (
                  <span>—</span>
                )}
              </Detail>
              <Detail label="Address" icon={<MapPin className="h-3 w-3" />}>
                {addressLines.length ? (
                  <div className="space-y-0.5 text-navy">
                    {addressLines.map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                  </div>
                ) : (
                  <span>—</span>
                )}
              </Detail>
              <Detail label="Status (RF)">
                <span>{client.statusName || "—"}</span>
              </Detail>
            </dl>
          </div>

          <div className="rounded-xl border border-border bg-white p-5 shadow-sm">
            <h2 className="font-serif text-lg font-semibold text-navy">Fee Agreement</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <Detail label="Status" icon={<ShieldCheck className="h-3 w-3" />}>
                <span className={client.isVerified ? "font-medium text-brand-dark" : "text-muted-foreground"}>
                  {client.isVerified ? "Signed" : "Unsigned"}
                </span>
              </Detail>
              <Detail label="Signed On">
                <span>{client.agreementDate ? new Date(client.agreementDate).toLocaleDateString() : "—"}</span>
              </Detail>
              <Detail label="Fee">
                <span>{client.feePct != null ? `${client.feePct}%` : "—"}</span>
              </Detail>
              <Detail label="Billing Contact">
                <span>{client.billingContact || "—"}</span>
              </Detail>
              <Detail label="Agreement File" icon={<FileText className="h-3 w-3" />}>
                {client.agreementFileUrl ? (
                  <a href={client.agreementFileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-dark hover:underline">
                    {client.agreementFileName ?? "Open PDF"} <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  <span>—</span>
                )}
              </Detail>
            </dl>
          </div>

          <div className="rounded-xl border border-border bg-white shadow-sm lg:col-span-3">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <h2 className="font-serif text-lg font-semibold text-navy">Jobs</h2>
              <span className="text-xs text-muted-foreground">
                {openJobs.length} open · {closedJobs.length} closed
              </span>
            </div>
            {openJobs.length + closedJobs.length === 0 ? (
              <div className="px-5 py-12 text-center text-sm text-muted-foreground">No jobs yet for this client.</div>
            ) : (
              <ul className="divide-y divide-border">
                {[...openJobs, ...closedJobs].map((j) => (
                  <li key={j.id}>
                    <Link
                      href={`/jobs/${j.id}`}
                      className="flex items-center justify-between px-5 py-3 transition hover:bg-brand-tint/40"
                    >
                      <div className="flex items-center gap-3 text-sm">
                        <Briefcase className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <div className="font-medium text-navy">{j.name ?? j.title ?? "(untitled)"}</div>
                          <div className="text-xs text-muted-foreground">
                            {j.department_name ?? ""}
                            {openJobs.includes(j) ? " · Active" : " · Closed"}
                          </div>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {typeof j.candidates_submitted === "number" ? `${j.candidates_submitted} submitted` : ""}
                        {typeof j.candidates_hired === "number" ? ` · ${j.candidates_hired} hired` : ""}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : tab === "contacts" ? (
        <ContactsTab
          clientId={id}
          initialContacts={clientContacts.map((c) => ({
            id: c.id,
            name: [c.first_name, c.last_name].filter(Boolean).join(" ") || c.name || "(unnamed)",
            title: c.current_designation ?? "",
            email: Array.isArray(c.email) ? c.email[0] ?? "" : c.email ?? "",
            phone:
              Array.isArray(c.phone_number) && c.phone_number.length > 0
                ? typeof c.phone_number[0] === "string"
                  ? c.phone_number[0]
                  : c.phone_number[0]?.number ?? ""
                : "",
            linkedIn: c.linkedin_profile ?? null,
            lastContactedAt: c.latest_activity_time ?? c.added_time ?? null,
          }))}
        />
      ) : tab === "agreements" ? (
        <AgreementsTab
          clientId={id}
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
      ) : (
        <BenefitsTab
          clientId={id}
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
      )}
    </div>
  );
}

function Tabs({
  tab,
  clientId,
  contactsCount,
  agreementsCount,
  benefitsFilesCount,
  hasBenefits,
}: {
  tab: ClientTab;
  clientId: number;
  contactsCount: number;
  agreementsCount: number;
  benefitsFilesCount: number;
  hasBenefits: boolean;
}) {
  return (
    <div className="inline-flex flex-wrap rounded-lg border border-border bg-white p-1 shadow-sm">
      <TabLink label="Overview" href={`/clients/${clientId}?tab=overview`} active={tab === "overview"} />
      <TabLink label="Contacts" count={contactsCount} href={`/clients/${clientId}?tab=contacts`} active={tab === "contacts"} />
      <TabLink label="Agreements" count={agreementsCount} href={`/clients/${clientId}?tab=agreements`} active={tab === "agreements"} />
      <TabLink
        label="Benefits"
        count={benefitsFilesCount > 0 ? benefitsFilesCount : undefined}
        dot={hasBenefits && benefitsFilesCount === 0}
        href={`/clients/${clientId}?tab=benefits`}
        active={tab === "benefits"}
      />
    </div>
  );
}

function TabLink({ label, href, active, count, dot }: { label: string; href: string; active: boolean; count?: number; dot?: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        active ? "bg-brand-tint text-brand-dark" : "text-navy-400 hover:bg-muted",
      )}
    >
      <span>{label}</span>
      {dot && (
        <span
          aria-hidden
          className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-brand" : "bg-brand/60")}
        />
      )}
      {typeof count === "number" && (
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
            active ? "bg-brand text-white" : "bg-muted text-muted-foreground",
          )}
        >
          {count.toLocaleString()}
        </span>
      )}
    </Link>
  );
}

function Detail({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 inline-flex items-center gap-1 text-navy">
        {icon}
        {children}
      </dd>
    </div>
  );
}

function Stat({ label, value, tone = "default" }: { label: string; value: string | number; tone?: "default" | "brand" | "blue" | "emerald" | "muted" }) {
  const cls = {
    default: "text-navy",
    brand: "text-brand-dark",
    blue: "text-blue-700",
    emerald: "text-emerald-700",
    muted: "text-navy-400",
  }[tone];
  const effective = (typeof value === "number" && value === 0) ? "text-muted-foreground/60" : cls;
  return (
    <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("mt-1 font-serif text-2xl font-semibold", effective)}>{value}</div>
    </div>
  );
}

