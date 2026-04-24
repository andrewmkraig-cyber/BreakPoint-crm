// Mail-Tab merge fields. Uses the handlebars-flavored `{{dot.path}}`
// token convention specifically for the Mail Tab composer (Phase 6.3).
// Kept separate from the legacy `[Square Bracket]` registry in
// src/lib/merge-fields.ts so the submittal / interview composers that
// depend on the old convention aren't affected.

export type MailMergeContext = {
  candidate?: {
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    currentTitle?: string | null;
    currentCompany?: string | null;
  } | null;
  job?: {
    title?: string | null;
    clientName?: string | null;
    city?: string | null;
    state?: string | null;
    description?: string | null;
  } | null;
  client?: {
    name?: string | null;
    primaryContactFirstName?: string | null;
  } | null;
  user?: {
    firstName?: string | null;
    fullName?: string | null;
  } | null;
};

// The canonical tag list surfaced by the Insert Field picker. Order
// here is the display order in the menu.
export const MAIL_MERGE_FIELDS = [
  { tag: "{{candidate.first_name}}", label: "Candidate first name" },
  { tag: "{{candidate.last_name}}", label: "Candidate last name" },
  { tag: "{{candidate.full_name}}", label: "Candidate full name" },
  { tag: "{{candidate.email}}", label: "Candidate email" },
  { tag: "{{candidate.current_title}}", label: "Candidate current title" },
  { tag: "{{candidate.current_company}}", label: "Candidate current company" },
  { tag: "{{job.title}}", label: "Job title" },
  { tag: "{{job.client_name}}", label: "Job — client name" },
  { tag: "{{job.city}}", label: "Job — city" },
  { tag: "{{job.state}}", label: "Job — state" },
  { tag: "{{job.description}}", label: "Job — full description" },
  { tag: "{{client.name}}", label: "Client name" },
  { tag: "{{client.primary_contact_first_name}}", label: "Client primary contact first name" },
  { tag: "{{user.first_name}}", label: "Your first name" },
  { tag: "{{user.full_name}}", label: "Your full name" },
] as const;

export type MailMergeTag = (typeof MAIL_MERGE_FIELDS)[number]["tag"];

function trimOr(v: string | null | undefined): string | undefined {
  const s = (v ?? "").trim();
  return s.length > 0 ? s : undefined;
}

// Resolves a single tag against context. Returns undefined if the
// tag's context branch is missing OR the specific field inside that
// branch is empty — callers treat either as "unresolved."
function resolveOne(tag: string, ctx: MailMergeContext): string | undefined {
  switch (tag) {
    case "{{candidate.first_name}}":
      return trimOr(ctx.candidate?.firstName);
    case "{{candidate.last_name}}":
      return trimOr(ctx.candidate?.lastName);
    case "{{candidate.full_name}}": {
      const f = trimOr(ctx.candidate?.firstName) ?? "";
      const l = trimOr(ctx.candidate?.lastName) ?? "";
      const joined = [f, l].filter(Boolean).join(" ");
      return joined || undefined;
    }
    case "{{candidate.email}}":
      return trimOr(ctx.candidate?.email);
    case "{{candidate.current_title}}":
      return trimOr(ctx.candidate?.currentTitle);
    case "{{candidate.current_company}}":
      return trimOr(ctx.candidate?.currentCompany);
    case "{{job.title}}":
      return trimOr(ctx.job?.title);
    case "{{job.client_name}}":
      return trimOr(ctx.job?.clientName);
    case "{{job.city}}":
      return trimOr(ctx.job?.city);
    case "{{job.state}}":
      return trimOr(ctx.job?.state);
    case "{{job.description}}":
      return trimOr(ctx.job?.description);
    case "{{client.name}}":
      return trimOr(ctx.client?.name);
    case "{{client.primary_contact_first_name}}":
      return trimOr(ctx.client?.primaryContactFirstName);
    case "{{user.first_name}}":
      return trimOr(ctx.user?.firstName);
    case "{{user.full_name}}":
      return trimOr(ctx.user?.fullName);
    default:
      return undefined;
  }
}

// Grep a body/subject for every `{{…}}` token, normalizing whitespace
// inside braces so `{{ candidate.first_name }}` and the tight form
// dedupe to one entry.
const TAG_REGEX = /\{\{\s*[a-z_.]+\s*\}\}/gi;

export function extractMailMergeTags(text: string): string[] {
  const matches = text.match(TAG_REGEX) ?? [];
  const normalized = matches.map((m) => m.replace(/\s+/g, ""));
  return Array.from(new Set(normalized));
}

// Replace every known tag with its resolved value. Unknown tags OR
// known-but-empty tags stay literal. Returns { output, unresolved }
// so the composer can show a "fields couldn't be resolved" warning.
export function applyMailMergeFields(
  input: string,
  ctx: MailMergeContext,
): { output: string; unresolved: string[] } {
  const tags = extractMailMergeTags(input);
  const unresolved: string[] = [];
  let out = input;
  for (const tag of tags) {
    const value = resolveOne(tag, ctx);
    if (value === undefined) {
      unresolved.push(tag);
      continue;
    }
    // Build a regex that matches both the tight form and the whitespaced
    // form of this tag so `{{ candidate.first_name }}` in the body gets
    // resolved even though the registry lists only the tight form.
    const inner = tag.slice(2, -2); // strip {{ }}
    const pattern = `\\{\\{\\s*${escapeForRegex(inner)}\\s*\\}\\}`;
    out = out.replace(new RegExp(pattern, "g"), escapeForHtml(value));
  }
  return { output: out, unresolved };
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeForHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
