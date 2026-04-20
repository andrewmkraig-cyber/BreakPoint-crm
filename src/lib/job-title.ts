// Job title resolver shared across the Applicants list, the Pipeline,
// and any other surface that has to display "this job's name". The RF
// data we receive is inconsistent — some jobs have `title`, some have
// `name`, some import with neither and rely on a custom field. The old
// resolver fell straight through to "(untitled job)" the moment `title`
// was empty, which meant rows whose name lived in `name` or
// `position_title` rendered as untitled even though the row was
// perfectly real.
//
// Priority:
//   1. JobOverride.title  — recruiter-authored Ace override
//   2. RF Job.title
//   3. RF Job.name
//   4. RF Job.position_title (or any other plausible RF field)
//   5. fallback "Untitled role"
//
// When we hit (5) we console.warn so we can audit which jobs are truly
// missing titles vs which are just hitting unknown RF fields.

type JobLike = {
  id?: number;
  title?: string | null;
  name?: string | null;
  position_title?: string | null;
} | Record<string, unknown> | null | undefined;

const FALLBACK = "Untitled role";

function nonBlank(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

export function resolveJobTitle(args: {
  override?: { title?: string | null } | null;
  job?: JobLike;
}): string {
  const overrideTitle = nonBlank(args.override?.title);
  if (overrideTitle) return overrideTitle;
  const j = args.job ?? null;
  if (j) {
    const t = nonBlank((j as { title?: unknown }).title);
    if (t) return t;
    const n = nonBlank((j as { name?: unknown }).name);
    if (n) return n;
    const p = nonBlank((j as { position_title?: unknown }).position_title);
    if (p) return p;
  }
  // eslint-disable-next-line no-console
  console.warn(
    "[resolveJobTitle] no title found for job",
    j && typeof j === "object" && "id" in j ? { jobId: (j as { id?: unknown }).id } : { jobId: null },
  );
  return FALLBACK;
}
