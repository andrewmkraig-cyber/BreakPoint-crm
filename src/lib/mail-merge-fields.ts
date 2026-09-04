// Mail-Tab merge fields. Uses the handlebars-flavored `{{dot.path}}`
// token convention specifically for the Mail Tab composer (Phase 6.3).
// Kept separate from the legacy `[Square Bracket]` registry in
// src/lib/merge-fields.ts so the submittal / interview composers that
// depend on the old convention aren't affected.

import { stripMarkdownToPlain } from "@/lib/markdown-to-plain";
import { extractCityFromLocation } from "@/lib/candidate-compensation";
import {
  decodeHtmlEntities,
  escapeHtml,
  markdownishTextToEmailHtml,
} from "@/lib/ai-output-formatting";

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
  { tag: "{{job.client_name}}", label: "Job: client name" },
  { tag: "{{job.city}}", label: "Job: city" },
  { tag: "{{job.state}}", label: "Job: state" },
  { tag: "{{job.description}}", label: "Job: full description" },
  { tag: "{{client.name}}", label: "Client name" },
  { tag: "{{client.primary_contact_first_name}}", label: "Client primary contact first name" },
  { tag: "{{user.first_name}}", label: "Your first name" },
  { tag: "{{user.full_name}}", label: "Your full name" },
] as const;

export type MailMergeTag = (typeof MAIL_MERGE_FIELDS)[number]["tag"];

// Phase 5A.2 — dual-format parser. Templates imported from RecruiterFlow
// use [Square Bracket Format] tokens; Ace's canonical form is
// {{double.curly}}. The Insert Field picker only inserts {{}}, but the
// resolver accepts both so old RF templates keep working without
// hand-rewrites. Bracket tokens are normalized to their {{}} canonical
// form BEFORE resolution; the rest of the pipeline only ever sees {{}}.
//
// Composite brackets (those that have no single canonical {{}} form)
// expand to a string literal containing multiple tags. [Job Location]
// is the only one today: "{{job.city}}, {{job.state}}".

const COMPOSITE_BRACKETS: ReadonlyArray<readonly [string, string]> = [
  ["[Job Location]", "{{job.city}}, {{job.state}}"],
];

const BRACKET_TO_TAG: ReadonlyArray<readonly [string, string]> = [
  ["[Candidate First Name]", "{{candidate.first_name}}"],
  ["[Candidate Last Name]", "{{candidate.last_name}}"],
  ["[Candidate Full Name]", "{{candidate.full_name}}"],
  ["[Candidate Email]", "{{candidate.email}}"],
  ["[Candidate Current Title]", "{{candidate.current_title}}"],
  ["[Candidate Current Company]", "{{candidate.current_company}}"],
  ["[Candidate Current Employer]", "{{candidate.current_company}}"], // RF alias
  ["[Job Title]", "{{job.title}}"],
  ["[Job Description]", "{{job.description}}"],
  ["[Client Name]", "{{client.name}}"],
  ["[Client Company Name]", "{{client.name}}"], // RF alias
  ["[Client Primary Contact First Name]", "{{client.primary_contact_first_name}}"],
  ["[User First Name]", "{{user.first_name}}"],
  ["[User Full Name]", "{{user.full_name}}"],
];

// Walks the input swapping every recognized bracket token for its
// canonical {{}} equivalent. Composites first (so [Job Location]
// resolves before the per-field aliases). Case-sensitive — RF
// templates write the tokens in title case consistently, and a
// case-insensitive match would risk matching arbitrary bracketed text
// in a body.
function normalizeBrackets(input: string): string {
  let out = input;
  for (const [bracket, expansion] of COMPOSITE_BRACKETS) {
    out = out.split(bracket).join(expansion);
  }
  for (const [bracket, tag] of BRACKET_TO_TAG) {
    out = out.split(bracket).join(tag);
  }
  return out;
}

// Exposed for tests and for the composer's "are there unresolved fields"
// banner — it can run normalize once, then extract.
export { normalizeBrackets };

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
    // {{job_city}} is the cross-path city token (what the legacy
    // [Square Bracket] resolver + bulk/trigger sends register, and what the
    // [Job Location] sweep writes into templates). Resolve via the shared
    // extractCityFromLocation and return a STRING (never undefined) so a
    // swept template never renders the token literal in the Mail composer —
    // it shows the city, or empty when missing, like the other send paths.
    case "{{job_city}}":
      return extractCityFromLocation(ctx.job?.city ?? "");
    case "{{job.state}}":
      return trimOr(ctx.job?.state);
    case "{{job.description}}":
      // Keep the raw markdown here. renderResolvedValue decides whether to
      // convert it to rich email HTML or strip it to plain text.
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
  // Normalize bracket form first so callers that count "unresolved"
  // tags see the canonical {{}} names regardless of source syntax.
  const canonical = normalizeBrackets(text);
  const matches = canonical.match(TAG_REGEX) ?? [];
  const normalized = matches.map((m) => m.replace(/\s+/g, ""));
  return Array.from(new Set(normalized));
}

// Replace every known tag with its resolved value. Unknown tags OR
// known-but-empty tags stay literal. Returns { output, unresolved }
// so the composer can show a "fields couldn't be resolved" warning.
// Accepts both {{double.curly}} and [Bracket Format] tokens — bracket
// tokens are normalized to canonical curly form first.
export function applyMailMergeFields(
  input: string,
  ctx: MailMergeContext,
): { output: string; unresolved: string[] } {
  // Step 1: rewrite bracket tokens to canonical {{}} form.
  const canonical = normalizeBrackets(input);
  const targetIsHtml = looksLikeHtml(canonical);
  // Step 2: resolve all tags against context.
  const tags = extractMailMergeTags(canonical);
  const unresolved: string[] = [];
  let out = canonical;
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
    const replacement = renderResolvedValue(tag, value, targetIsHtml);
    out = out.replace(new RegExp(pattern, "g"), () => replacement);
  }
  return { output: out, unresolved };
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderResolvedValue(tag: string, value: string, targetIsHtml: boolean): string {
  if (tag === "{{job.description}}" || looksStructuredMarkdown(value)) {
    return targetIsHtml
      ? markdownishTextToEmailHtml(value)
      : decodeHtmlEntities(stripMarkdownToPlain(value));
  }
  // A plain-text target is a subject line or a text/plain body - it is never
  // parsed as HTML, so escaping there is what PUTS "&amp;" in front of the
  // recruiter instead of "&". Decode instead: a client stored as
  // "Mowat Mackie &amp; Anderson" resolves to "Mowat Mackie & Anderson".
  if (!targetIsHtml) return decodeHtmlEntities(value);
  return escapeHtml(value).replace(/\r\n|\r|\n/g, "<br/>");
}

function looksLikeHtml(s: string): boolean {
  return /<[a-z][\s\S]*>/i.test(s);
}

function looksStructuredMarkdown(s: string): boolean {
  return /(^|\n)\s*(?:#{1,6}\s+|[-*+\u2022]\s+|\d+[.)]\s+|\*\*[^*\n]+:\*\*)/.test(s);
}
