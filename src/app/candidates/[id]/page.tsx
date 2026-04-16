import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Bookmark,
  Briefcase,
  Building2,
  CalendarPlus,
  ExternalLink,
  FileText,
  MapPin,
  Mail,
  NotebookPen,
  Phone as PhoneIcon,
  Send,
  XCircle,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { prisma } from "@/lib/prisma";
import {
  recruiterflow,
  formatPhone,
  telHref,
  canonicalStage,
  PIPELINE_LABELS,
  daysBetween,
  type RFCandidate,
  type RFFile,
} from "@/lib/recruiterflow";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function CandidateProfilePage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) notFound();

  const [candidates, activity] = await Promise.all([
    recruiterflow.listAllCandidates({ perPage: 100 }),
    prisma.actionLog.findMany({
      where: { subjectType: "candidate", subjectId: String(id) },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { user: { select: { name: true, email: true } } },
    }),
  ]);

  const c = candidates.find((x) => x.id === id);
  if (!c) notFound();

  const name = c.name ?? [c.first_name, c.last_name].filter(Boolean).join(" ") ?? "(unnamed)";
  const email = normalizeEmail(c.email);
  const phone = normalizePhone(c.phone_number);
  const location = c.location?.location ?? [c.location?.city, c.location?.state].filter(Boolean).join(", ") ?? "";
  const resume = pickResumeFile(c);
  const tagSet = collectTags(c);
  const isKept = tagSet.has("kept") || tagSet.has("keep");
  const displayTags = Array.from(tagSet).filter((t) => t !== "kept" && t !== "keep");

  const skills = Array.isArray(c.skills) ? (c.skills as unknown[]).filter((s): s is string => typeof s === "string") : [];
  const experience = Array.isArray(c.experience) ? (c.experience as ExperienceItem[]) : [];
  const notes = Array.isArray(c.notes) ? c.notes : [];
  const expectedSalary = formatSalary(c.expected_salary);

  const linkedSubmittals = (Array.isArray(c.jobs) ? c.jobs : []).filter((j) => typeof j?.job_id === "number");

  return (
    <div className="space-y-6">
      <Link href="/candidates" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-navy">
        <ArrowLeft className="h-3 w-3" /> Back to candidates
      </Link>

      <PageHeader
        eyebrow={c.current_organization ? `Currently at ${c.current_organization}` : "Candidate"}
        title={name}
        description={[c.current_designation, location].filter(Boolean).join(" · ") || undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {isKept && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-amber-800">
                <Bookmark className="h-3 w-3" /> Kept
              </span>
            )}
            {displayTags.slice(0, 3).map((t) => (
              <span key={t} className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-navy-400">
                {t}
              </span>
            ))}
          </div>
        }
      />

      <ActionRow />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Left column — contact + profile */}
        <div className="space-y-6 lg:col-span-2">
          <div className="rounded-xl border border-border bg-white p-5 shadow-sm">
            <h2 className="font-serif text-base font-semibold text-navy">Contact</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <Detail label="Email" icon={<Mail className="h-3 w-3" />}>
                {email ? (
                  <a href={`mailto:${email}`} className="inline-flex items-center gap-1 text-brand-dark hover:underline">
                    {email}
                  </a>
                ) : (
                  <span>—</span>
                )}
              </Detail>
              <Detail label="Phone" icon={<PhoneIcon className="h-3 w-3" />}>
                {phone ? (
                  <a href={telHref(phone)} className="text-navy hover:text-brand-dark">
                    {formatPhone(phone)}
                  </a>
                ) : (
                  <span>—</span>
                )}
              </Detail>
              <Detail label="LinkedIn">
                {c.linkedin_profile ? (
                  <a
                    href={c.linkedin_profile}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-brand-dark hover:underline"
                  >
                    Profile <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  <span>—</span>
                )}
              </Detail>
              <Detail label="Location" icon={<MapPin className="h-3 w-3" />}>
                <span>{location || "—"}</span>
              </Detail>
            </dl>
          </div>

          <div className="rounded-xl border border-border bg-white p-5 shadow-sm">
            <h2 className="font-serif text-base font-semibold text-navy">Employment</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <Detail label="Current title" icon={<Briefcase className="h-3 w-3" />}>
                <span>{c.current_designation || "—"}</span>
              </Detail>
              <Detail label="Current employer" icon={<Building2 className="h-3 w-3" />}>
                <span>{c.current_organization || "—"}</span>
              </Detail>
              <Detail label="Expected compensation">
                <span>{expectedSalary || "—"}</span>
              </Detail>
              <Detail label="Source">
                <span>{c.source_name || "—"}</span>
              </Detail>
              <Detail label="Distance from job">
                <span className="text-muted-foreground">Google Maps integration coming later</span>
              </Detail>
            </dl>
          </div>

          {skills.length > 0 && (
            <div className="rounded-xl border border-border bg-white p-5 shadow-sm">
              <h2 className="font-serif text-base font-semibold text-navy">Skills</h2>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {skills.map((s) => (
                  <span key={s} className="inline-flex items-center rounded-full bg-brand-tint px-2 py-0.5 text-[11px] font-medium text-brand-dark">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-border bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="font-serif text-base font-semibold text-navy">Notes</h2>
              <span className="text-[11px] text-muted-foreground">
                {notes.length} {notes.length === 1 ? "note" : "notes"}
              </span>
            </div>
            {notes.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No notes yet. Add Note comes online Day 3.</p>
            ) : (
              <ul className="mt-3 space-y-3 text-sm">
                {notes.slice(0, 8).map((n, i) => (
                  <li key={n.id ?? i} className="rounded-lg border border-border bg-muted/30 p-3">
                    <div className="whitespace-pre-wrap text-navy">{n.note}</div>
                    <div className="mt-2 text-[11px] text-muted-foreground">
                      {n.added_by?.name ?? "Unknown"}
                      {n.added_time ? ` · ${new Date(n.added_time).toLocaleString()}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Right column — resume + experience */}
        <div className="space-y-6 lg:col-span-3">
          <div className="rounded-xl border border-border bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <div>
                <h2 className="font-serif text-base font-semibold text-navy">Resume</h2>
                {resume && (
                  <p className="text-xs text-muted-foreground">
                    {resume.filename ?? "Resume"}
                    {resume.upload_time ? ` · uploaded ${new Date(resume.upload_time).toLocaleDateString()}` : ""}
                  </p>
                )}
              </div>
              {resume?.link && (
                <Link
                  href={resume.link}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg border border-border bg-white px-3 py-1.5 text-[11px] font-medium text-navy-400 shadow-sm transition hover:text-navy"
                >
                  Open <ExternalLink className="h-3 w-3" />
                </Link>
              )}
            </div>
            {resume?.link ? (
              <iframe
                title="Resume preview"
                src={resume.link}
                className="h-[700px] w-full rounded-b-xl border-0"
              />
            ) : (
              <div className="flex h-64 flex-col items-center justify-center gap-2 border-t border-dashed border-border bg-muted/20 text-sm text-muted-foreground">
                <FileText className="h-6 w-6 text-muted-foreground" />
                No resume on file in RecruiterFlow.
              </div>
            )}
          </div>

          {experience.length > 0 && (
            <div className="rounded-xl border border-border bg-white shadow-sm">
              <div className="border-b border-border px-5 py-3">
                <h2 className="font-serif text-base font-semibold text-navy">Experience</h2>
              </div>
              <ol className="divide-y divide-border">
                {experience.slice(0, 10).map((e, i) => (
                  <li key={i} className="px-5 py-3">
                    <div className="flex items-start gap-3">
                      <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand" />
                      <div className="min-w-0">
                        <div className="font-medium text-navy">{e.designation ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">
                          {e.organization ?? "—"}
                          {formatExperienceRange(e) ? ` · ${formatExperienceRange(e)}` : ""}
                        </div>
                        {e.description && (
                          <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">{e.description}</p>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </div>

      {/* Activity timeline */}
      <div className="rounded-xl border border-border bg-white shadow-sm">
        <div className="border-b border-border px-5 py-3">
          <h2 className="font-serif text-base font-semibold text-navy">Activity</h2>
          <p className="text-xs text-muted-foreground">
            Newest first. Actions taken in Ace write here; RF stage moves and imports appear alongside.
          </p>
        </div>
        <ul className="divide-y divide-border">
          {activity.length === 0 && linkedSubmittals.length === 0 && !c.added_time && (
            <li className="px-5 py-8 text-center text-sm text-muted-foreground">No activity yet.</li>
          )}
          {activity.map((a) => (
            <li key={a.id} className="flex items-start gap-3 px-5 py-3">
              <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand" />
              <div>
                <div className="text-sm text-navy">
                  <span className="font-medium">{a.user?.name ?? a.user?.email ?? "Someone"}</span>{" "}
                  <span className="text-muted-foreground">· {formatActionType(a.actionType)}</span>
                </div>
                <div className="text-[11px] text-muted-foreground">{new Date(a.createdAt).toLocaleString()}</div>
              </div>
            </li>
          ))}
          {linkedSubmittals.map((j, i) => (
            <li key={`rf-${j.job_id}-${i}`} className="flex items-start gap-3 px-5 py-3">
              <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-muted-foreground/50" />
              <div className="min-w-0">
                <div className="text-sm text-navy">
                  <span className="font-medium">Stage: {stageLabel(j.stage_name)}</span>
                  <span className="text-muted-foreground"> on </span>
                  <Link href={`/jobs/${j.job_id}`} className="font-medium text-brand-dark hover:underline">
                    {j.title ?? j.name ?? "(untitled job)"}
                  </Link>
                  {j.client_company_name && <span className="text-muted-foreground"> at {j.client_company_name}</span>}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {j.stage_moved
                    ? `${new Date(j.stage_moved).toLocaleString()} · ${daysBetween(j.stage_moved) ?? 0}d in stage`
                    : "—"}
                </div>
              </div>
            </li>
          ))}
          {c.added_time && (
            <li className="flex items-start gap-3 px-5 py-3">
              <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-muted-foreground/50" />
              <div>
                <div className="text-sm text-navy">
                  <span className="font-medium">Added to RecruiterFlow</span>
                  {c.added_by?.name && <span className="text-muted-foreground"> by {c.added_by.name}</span>}
                </div>
                <div className="text-[11px] text-muted-foreground">{new Date(c.added_time).toLocaleString()}</div>
              </div>
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

function ActionRow() {
  return (
    <div className="flex flex-wrap gap-2">
      <ActionButton icon={<Send className="h-3.5 w-3.5" />} label="Submit" />
      <ActionButton icon={<XCircle className="h-3.5 w-3.5" />} label="Reject" tone="red" />
      <ActionButton icon={<CalendarPlus className="h-3.5 w-3.5" />} label="Schedule Interview" />
      <ActionButton icon={<Bookmark className="h-3.5 w-3.5" />} label="Keep" tone="amber" />
      <ActionButton icon={<Briefcase className="h-3.5 w-3.5" />} label="Apply to Job" />
      <ActionButton icon={<NotebookPen className="h-3.5 w-3.5" />} label="Add Note" />
    </div>
  );
}

function ActionButton({
  icon,
  label,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  tone?: "default" | "red" | "amber";
}) {
  const toneCls = {
    default: "border-border bg-white text-navy hover:border-brand/40 hover:text-brand-dark",
    red: "border-border bg-white text-red-700 hover:border-red-300 hover:bg-red-50",
    amber: "border-border bg-white text-amber-800 hover:border-amber-300 hover:bg-amber-50",
  }[tone];
  return (
    <button
      type="button"
      disabled
      title="Coming Day 3"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60",
        toneCls,
      )}
    >
      {icon}
      {label}
    </button>
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

// ---- helpers ----

type ExperienceItem = {
  designation?: string | null;
  organization?: string | null;
  description?: string | null;
  from?: [number | null, number | null];
  to?: [number | null, number | null];
};

function normalizeEmail(raw: RFCandidate["email"]): string {
  if (Array.isArray(raw)) return raw[0] ?? "";
  return raw ?? "";
}

function normalizePhone(raw: RFCandidate["phone_number"]): string {
  if (!raw) return "";
  if (Array.isArray(raw)) {
    const first = raw[0];
    if (typeof first === "string") return first;
    return first?.number ?? "";
  }
  return typeof raw === "string" ? raw : "";
}

function pickResumeFile(c: RFCandidate): RFFile | null {
  const files = Array.isArray(c.files) ? c.files : [];
  if (files.length === 0) return null;
  // Prefer a file marked primary, then any PDF, then the first file.
  const primary = files.find((f) => f.is_primary);
  if (primary) return primary;
  const pdf = files.find((f) => (f.filename ?? "").toLowerCase().endsWith(".pdf"));
  if (pdf) return pdf;
  return files[0];
}

function collectTags(c: RFCandidate): Set<string> {
  const out = new Set<string>();
  const push = (t: unknown) => {
    if (!t) return;
    const name = typeof t === "string" ? t : typeof (t as { name?: string }).name === "string" ? (t as { name: string }).name : "";
    if (name) out.add(name.toLowerCase().trim());
  };
  (c.tags ?? []).forEach(push);
  (c.attributes ?? []).forEach(push);
  return out;
}

function formatSalary(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const s = raw as { number?: number | null; currency?: string | null };
  if (!s.number) return "";
  const sym = (s.currency ?? "USD") === "USD" ? "$" : `${s.currency} `;
  const n = s.number;
  if (n >= 1000) return `${sym}${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return `${sym}${n}`;
}

function formatExperienceRange(e: ExperienceItem): string {
  const fromM = e.from?.[0];
  const fromY = e.from?.[1];
  const toM = e.to?.[0];
  const toY = e.to?.[1];
  const fmt = (m: number | null | undefined, y: number | null | undefined): string => {
    if (!y) return "";
    const mon = m ? String(m).padStart(2, "0") + "/" : "";
    return `${mon}${y}`;
  };
  const start = fmt(fromM, fromY);
  const end = fmt(toM, toY) || "Present";
  if (!start) return "";
  return `${start} – ${end}`;
}

function stageLabel(stageName: string | null | undefined): string {
  const bucket = canonicalStage(stageName ?? "");
  if (bucket in PIPELINE_LABELS) return PIPELINE_LABELS[bucket as keyof typeof PIPELINE_LABELS];
  return stageName ?? "—";
}

function formatActionType(t: string): string {
  return t.replace(/_/g, " ");
}
