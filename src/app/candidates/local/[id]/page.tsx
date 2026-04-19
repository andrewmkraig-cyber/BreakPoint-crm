import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileDown, Link2, Mail, MapPin, Phone } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Exp = { designation?: string; organization?: string; from_year?: number | null; to_year?: number | null; description?: string };
type Edu = { school?: string; degree?: string; from_year?: number | null; to_year?: number | null; description?: string };

export default async function LocalCandidatePage({ params }: { params: { id: string } }) {
  const candidate = await prisma.candidate.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      currentDesignation: true,
      currentOrganization: true,
      location: true,
      linkedinProfile: true,
      skills: true,
      notes: true,
      experience: true,
      education: true,
      resumeFilename: true,
      resumeMimeType: true,
      resumeSize: true,
      resumeUploadedAt: true,
      createdAt: true,
    },
  });

  if (!candidate) notFound();

  const fullName = [candidate.firstName, candidate.lastName].filter(Boolean).join(" ") || "(unnamed)";
  const experience = (candidate.experience as unknown as Exp[] | null) ?? [];
  const education = (candidate.education as unknown as Edu[] | null) ?? [];

  return (
    <div className="space-y-6">
      <Link href="/candidates" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-navy">
        <ArrowLeft className="h-3 w-3" /> Back to candidates
      </Link>

      <PageHeader
        eyebrow="Ace candidate"
        title={fullName}
        description={
          candidate.currentDesignation || candidate.currentOrganization
            ? `${candidate.currentDesignation ?? ""}${candidate.currentDesignation && candidate.currentOrganization ? " · " : ""}${candidate.currentOrganization ?? ""}`
            : "Saved to Ace — not yet synced to RecruiterFlow."
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
            <h2 className="font-serif text-base font-semibold text-navy">Contact</h2>
            <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <Row icon={<Mail className="h-3.5 w-3.5" />} label="Email" value={candidate.email} href={candidate.email ? `mailto:${candidate.email}` : null} />
              <Row icon={<Phone className="h-3.5 w-3.5" />} label="Phone" value={candidate.phone} href={candidate.phone ? `tel:${candidate.phone}` : null} />
              <Row icon={<MapPin className="h-3.5 w-3.5" />} label="Location" value={candidate.location} />
              <Row icon={<Link2 className="h-3.5 w-3.5" />} label="LinkedIn" value={candidate.linkedinProfile} href={candidate.linkedinProfile} />
            </dl>
          </section>

          {candidate.skills.length > 0 && (
            <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
              <h2 className="font-serif text-base font-semibold text-navy">Skills</h2>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {candidate.skills.map((s) => (
                  <span key={s} className="rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-xs text-navy">
                    {s}
                  </span>
                ))}
              </div>
            </section>
          )}

          {experience.length > 0 && (
            <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
              <h2 className="font-serif text-base font-semibold text-navy">Experience</h2>
              <ul className="mt-3 space-y-3 text-sm">
                {experience.map((r, i) => (
                  <li key={`exp-${i}`} className="rounded-lg border border-border bg-muted/20 px-3 py-2">
                    <div className="font-medium text-navy">
                      {r.designation || "(role)"}{" "}
                      <span className="font-normal text-muted-foreground">· {r.organization || "(employer)"}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {[r.from_year, r.to_year ?? "present"].filter((x) => x !== null && x !== undefined).join(" – ") || "—"}
                    </div>
                    {r.description && <p className="mt-1 text-xs text-muted-foreground">{r.description}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {education.length > 0 && (
            <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
              <h2 className="font-serif text-base font-semibold text-navy">Education</h2>
              <ul className="mt-3 space-y-3 text-sm">
                {education.map((r, i) => (
                  <li key={`edu-${i}`} className="rounded-lg border border-border bg-muted/20 px-3 py-2">
                    <div className="font-medium text-navy">
                      {r.degree || "(degree)"}{" "}
                      <span className="font-normal text-muted-foreground">· {r.school || "(school)"}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {[r.from_year, r.to_year].filter((x) => x !== null && x !== undefined).join(" – ") || "—"}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {candidate.notes && (
            <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
              <h2 className="font-serif text-base font-semibold text-navy">Notes</h2>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-navy">{candidate.notes}</p>
            </section>
          )}
        </div>

        <aside className="space-y-6">
          <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
            <h2 className="font-serif text-base font-semibold text-navy">Resume</h2>
            {candidate.resumeFilename ? (
              <div className="mt-3 space-y-2 text-sm">
                <div className="truncate text-navy">{candidate.resumeFilename}</div>
                <div className="text-[11px] text-muted-foreground">
                  {candidate.resumeSize ? `${(candidate.resumeSize / 1024).toFixed(0)} KB` : ""}
                  {candidate.resumeUploadedAt ? ` · uploaded ${candidate.resumeUploadedAt.toLocaleDateString()}` : ""}
                </div>
                <a
                  href={`/candidates/local/${candidate.id}/resume`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-navy shadow-sm transition hover:bg-muted"
                >
                  <FileDown className="h-3 w-3" /> Download
                </a>
              </div>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">No resume on file.</p>
            )}
          </section>

          <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
            <h2 className="font-serif text-base font-semibold text-navy">About this record</h2>
            <dl className="mt-3 space-y-1 text-xs text-muted-foreground">
              <div>
                <span className="font-medium text-navy">ID:</span>{" "}
                <span className="font-mono">{candidate.id}</span>
              </div>
              <div>
                <span className="font-medium text-navy">Created:</span>{" "}
                {candidate.createdAt.toLocaleString()}
              </div>
              <div>
                <span className="font-medium text-navy">Source:</span> Ace (local)
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Row({
  icon,
  label,
  value,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  href?: string | null;
}) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-navy">
        {value ? (
          href ? (
            <a href={href} className="hover:underline" target={href.startsWith("http") ? "_blank" : undefined} rel={href.startsWith("http") ? "noreferrer" : undefined}>
              {value}
            </a>
          ) : (
            value
          )
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </dd>
    </div>
  );
}
