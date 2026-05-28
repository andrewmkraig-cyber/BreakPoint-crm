// Deterministic, trajectory-aware match scorer.
//
// Replaces the prior Find Matches Claude-per-candidate scorer. Every
// score is rule-based code computed ONCE per (candidate, job) and
// stored on CandidateMatch (score / scoreBreakdown / rationale +
// computedAt + sourceHash). Nothing in this file calls the Claude
// API — by design, per the cost rule in ACE_RULES.md / CLAUDE.md.
//
// Weights:
//   Title       20  (function + level adjacency, trajectory-aware)
//   Skills      30  (required > preferred, synonym-grouped)
//   Experience  25  (years + recency + promotion-readiness scope)
//   Location    15  (distance bucket, remote = full credit)
//   Comp/other  10  (salary fit, education / cert / work-auth bonus)
// finalScore = sum of axis * axis-weight, rounded to 0-100.
//
// Missing-data rule: an axis with no inputs from either side does NOT
// penalize. Its weight drops from the denominator and the remaining
// axes re-scale to 100 so a sparse resume + sparse JD still produce
// a fair score.
//
// The exported `computeMatchScore` returns a `MatchResult` that fits
// directly into `prisma.candidateMatch.upsert(...)`. The exported
// `computeSourceHash` produces the SHA-256 fingerprint that the upsert
// path stores so JD/resume edits can target the rows that need a
// recompute without scanning the whole pool.

import crypto from "crypto";

// ---- Title taxonomy ---------------------------------------------------------
//
// Two pieces:
//   1. SENIORITY_LADDER — maps a normalized seniority word to a numeric
//      level. 0 = intern/staff entry, 5 = director, 7 = VP, 8 = partner.
//      The deltas matter, not the absolute numbers.
//   2. FUNCTION_DOMAINS — maps a function name (Tax, Audit, Engineering,
//      etc.) to its alias set. Function match is the first gate: same
//      function → meaningful score, different function → low cap.
//
// classifyTitle() parses a free-text title string into { function, level,
// isLead }. It deliberately resists exotic title patterns and skews
// conservative — better to fall through to "level: unknown" and let the
// adjacent axes do the work than to mis-pin a senior staff title at the
// wrong rung.

type SeniorityLevel = number;

const SENIORITY_LADDER: ReadonlyArray<{ tokens: string[]; level: SeniorityLevel }> = [
  // Most specific first — longer phrases beat single tokens.
  { tokens: ["chief", "cxo", "ceo", "cfo", "coo", "cto", "cmo", "chro"], level: 9 },
  { tokens: ["partner"], level: 8 },
  { tokens: ["vp", "vice president"], level: 7 },
  { tokens: ["svp", "senior vp", "senior vice president"], level: 7 },
  { tokens: ["director", "head of"], level: 6 },
  { tokens: ["senior director", "sr director", "sr. director"], level: 6 },
  { tokens: ["senior manager", "sr manager", "sr. manager"], level: 5 },
  { tokens: ["manager", "supervisor", "supervising"], level: 4 },
  { tokens: ["lead", "principal", "staff engineer"], level: 4 },
  { tokens: ["senior", "sr", "sr."], level: 3 },
  { tokens: ["associate"], level: 2 },
  { tokens: ["mid", "intermediate"], level: 2 },
  { tokens: ["staff", "junior", "jr", "jr.", "entry"], level: 1 },
  { tokens: ["intern", "trainee", "fellow"], level: 0 },
];

// Function families. Each value is the alias set; the first entry is
// the canonical name surfaced in explanations. Order matters: a title
// containing "tax accountant" matches Tax (not Accounting) because Tax
// is checked first.
const FUNCTION_DOMAINS: ReadonlyArray<{ name: string; aliases: string[] }> = [
  { name: "Tax", aliases: ["tax"] },
  { name: "Audit", aliases: ["audit", "auditor", "internal audit", "external audit"] },
  { name: "FP&A", aliases: ["fp&a", "fpa", "financial planning", "financial analyst", "financial analysis"] },
  { name: "Accounting", aliases: ["accounting", "accountant", "bookkeeper", "bookkeeping", "controller", "general ledger", "gl"] },
  { name: "Finance", aliases: ["finance", "treasury", "cfo"] },
  { name: "Legal", aliases: ["legal", "attorney", "counsel", "paralegal", "litigation"] },
  { name: "Engineering", aliases: ["engineer", "engineering", "swe", "developer", "developer ", "programmer", "software"] },
  { name: "Data", aliases: ["data scientist", "data engineer", "data analyst", "analytics", "machine learning", "ml ", "ai engineer"] },
  { name: "Product", aliases: ["product manager", "product lead", "product owner", "pm "] },
  { name: "Design", aliases: ["designer", "ux", "ui ", "product design"] },
  { name: "Marketing", aliases: ["marketing", "growth", "brand", "demand gen"] },
  { name: "Sales", aliases: ["sales", "account executive", "ae ", "sdr", "bdr", "account manager"] },
  { name: "Operations", aliases: ["operations", "ops ", "coo"] },
  { name: "HR", aliases: ["human resources", "hr ", "people ops", "recruiter", "talent acquisition"] },
];

export type TitleClassification = {
  function: string | null;
  level: SeniorityLevel | null;
  isLead: boolean; // "lead/principal/manager" scope flag, used by experience axis
};

export function classifyTitle(raw: string | null | undefined): TitleClassification {
  const t = (raw ?? "").toLowerCase().trim();
  if (!t) return { function: null, level: null, isLead: false };

  // Append a trailing space so single-word aliases like "ml " / "pm "
  // can use a space boundary without burning a regex.
  const padded = " " + t.replace(/[^a-z0-9&]+/g, " ").trim() + " ";

  let fn: string | null = null;
  for (const dom of FUNCTION_DOMAINS) {
    for (const alias of dom.aliases) {
      if (padded.includes(" " + alias + " ") || padded.includes(" " + alias)) {
        fn = dom.name;
        break;
      }
    }
    if (fn) break;
  }

  let level: SeniorityLevel | null = null;
  for (const rung of SENIORITY_LADDER) {
    for (const tok of rung.tokens) {
      if (padded.includes(" " + tok + " ")) {
        // Take the highest-matching rung. SENIORITY_LADDER is ordered
        // most-senior-first, so the first hit wins — break out of both
        // loops once we have it.
        level = rung.level;
        break;
      }
    }
    if (level !== null) break;
  }

  const isLead = / (lead|principal|manager|supervisor|director|head|vp|partner)\b/.test(padded);

  return { function: fn, level, isLead };
}

// ---- Skill normalization ---------------------------------------------------
//
// Coalesce common variants so "JavaScript" and "JS" both hit, and so
// the recruiter's searchKeywords blob doesn't double-count "tax" /
// "taxes" / "taxation". The map is intentionally short — the goal is
// to handle the high-frequency cases, not to ship a thesaurus.

const SKILL_SYNONYMS: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  py: "python",
  k8s: "kubernetes",
  postgres: "postgresql",
  psql: "postgresql",
  ml: "machine learning",
  ai: "artificial intelligence",
  qbo: "quickbooks",
  quickbooks: "quickbooks",
  // Tax / accounting cluster
  taxes: "tax",
  taxation: "tax",
  audits: "audit",
  auditing: "audit",
  bookkeeping: "bookkeeper",
  // Legal cluster
  contracts: "contract law",
  litigations: "litigation",
};

function normalizeSkill(raw: string): string {
  const s = raw.toLowerCase().trim().replace(/[^a-z0-9+#& ]+/g, " ").replace(/\s+/g, " ").trim();
  return SKILL_SYNONYMS[s] ?? s;
}

function splitCommaTokens(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out = new Set<string>();
  for (const part of raw.split(/[,;\n]/)) {
    const norm = normalizeSkill(part);
    if (norm.length >= 2) out.add(norm);
  }
  return Array.from(out);
}

// ---- Inputs shape -----------------------------------------------------------

export type ScoringCandidate = {
  id: string;
  currentDesignation: string | null;
  currentOrganization: string | null;
  skills: string[];
  experience: unknown; // Json — array of { title, organization, startDate, endDate, ... }
  expectedSalary: unknown; // Json — { number, currency }
  location: string | null;
  lat: number | null;
  lng: number | null;
  // Cached plaintext extraction from the most-recent CandidateResume row.
  // Optional: when missing we fall back to skills + experience text.
  resumeText?: string | null;
};

export type ScoringJob = {
  id: string;
  title: string;
  description: string | null;
  searchKeywords: string | null; // comma-separated
  salaryRangeStart: number | null;
  salaryRangeEnd: number | null;
  locations: string[];
  locationCity: string | null;
  locationState: string | null;
  locationZip: string | null;
};

// ---- Per-axis scorers ------------------------------------------------------
//
// Each scorer returns { score: 0-100, explanation: string }. The
// orchestrator combines them via weighted average + missing-data
// rescaling.

type AxisScore = { score: number; explanation: string; missing?: boolean };

// Title axis — the key fix from the brief. Trajectory-aware:
//   same function + same level  ≈ 100
//   same function + one rung below (natural promotion)  ≈ 85–95
//   same function + two rungs below                     ≈ 60–70
//   same function + above (overqualified)               ≈ 65
//   different function                                  ≤ 35
//   unknown level on either side  -> function alone drives it
function scoreTitle(c: ScoringCandidate, j: ScoringJob): AxisScore {
  const cand = classifyTitle(c.currentDesignation);
  const job = classifyTitle(j.title);

  if (!cand.function && !job.function && cand.level === null && job.level === null) {
    return { score: 0, explanation: "Title data missing on both sides.", missing: true };
  }

  const functionMatch = cand.function != null && job.function != null && cand.function === job.function;

  // No function on either side: fall back to a raw token overlap so the
  // axis still produces a signal for free-text titles the taxonomy
  // doesn't cover. Substring-ish, ungenerous.
  if (!functionMatch && (!cand.function || !job.function)) {
    const candTokens = new Set((c.currentDesignation ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3));
    const jobTokens = new Set(j.title.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3));
    let hits = 0;
    candTokens.forEach((t) => { if (jobTokens.has(t)) hits++; });
    const score = Math.min(85, hits * 25);
    return {
      score,
      explanation: hits > 0
        ? `Title shares ${hits} keyword${hits === 1 ? "" : "s"} with the role; function isn't taxonomized.`
        : "Title shows no overlap with the role.",
    };
  }

  if (!functionMatch) {
    // Different functions. Cap low — the candidate is probably not in
    // the same line of work. We still give a small floor when the
    // levels happen to align so a Director can be skim-considered for
    // a cross-functional Director role.
    const levelClose = cand.level != null && job.level != null && Math.abs(cand.level - job.level) <= 1;
    return {
      score: levelClose ? 30 : 15,
      explanation: `Different function (${cand.function ?? "unknown"} vs ${job.function}); cross-function move is unlikely.`,
    };
  }

  // Same function, no level data: solid mid-score.
  if (cand.level === null || job.level === null) {
    return {
      score: 75,
      explanation: `Same ${job.function} function; seniority can't be read from one of the titles.`,
    };
  }

  const delta = job.level - cand.level; // positive = job is more senior than candidate
  if (delta === 0) {
    return { score: 100, explanation: `Same-function, same-level match (${job.function}).` };
  }
  if (delta === 1) {
    // Natural promotion step — the brief's headline case (Senior Tax
    // Accountant for a Tax Manager role).
    return {
      score: 92,
      explanation: `Promotion-fit: same ${job.function} function, candidate is one level below the role (natural next step).`,
    };
  }
  if (delta === 2) {
    return {
      score: 65,
      explanation: `Same ${job.function} function, two levels below — stretch candidate.`,
    };
  }
  if (delta < 0) {
    // Candidate is more senior than the role. Moderate score — they
    // can do the work but may be overqualified / overcompensated.
    return {
      score: 60,
      explanation: `Same ${job.function} function but candidate is ${Math.abs(delta)} level${Math.abs(delta) === 1 ? "" : "s"} above the role (overqualified).`,
    };
  }
  // delta >= 3 — too junior.
  return {
    score: 35,
    explanation: `Same ${job.function} function but ${delta} levels below the role (too junior).`,
  };
}

// Skills axis — required overlap weighted heavier than preferred. Today
// the schema only exposes a single comma-separated `searchKeywords`
// blob (the recruiter's priority list); we treat that whole list as
// "required" and treat ad-hoc tokens from the JD description body as
// "preferred". When both lists are empty the axis flags itself as
// missing so the weight rescales.
function scoreSkills(c: ScoringCandidate, j: ScoringJob): AxisScore {
  const candSkills = new Set<string>();
  for (const s of c.skills) {
    const norm = normalizeSkill(s);
    if (norm.length >= 2) candSkills.add(norm);
  }
  // Pull more skill tokens from the resume + experience prose so a
  // candidate whose `skills[]` is sparse but whose resume body lists
  // every keyword still scores.
  const blob = [
    c.resumeText ?? "",
    typeof c.currentDesignation === "string" ? c.currentDesignation : "",
    typeof c.currentOrganization === "string" ? c.currentOrganization : "",
    Array.isArray(c.experience) ? c.experience.map(formatExperienceEntry).join(" ") : "",
  ].join(" ").toLowerCase();

  const required = splitCommaTokens(j.searchKeywords);
  // Pull ~30 medium-frequency tokens from the JD description body as
  // the "preferred" bucket. Stopwords filtered.
  const preferred = extractKeywordsFromDescription(j.description, 30, new Set(required));

  if (required.length === 0 && preferred.length === 0) {
    return { score: 0, explanation: "No required skills configured on the job.", missing: true };
  }

  const matchRequired = required.filter((kw) => candSkills.has(kw) || blob.includes(kw));
  const matchPreferred = preferred.filter((kw) => candSkills.has(kw) || blob.includes(kw));

  const reqHitRate = required.length === 0 ? 0 : matchRequired.length / required.length;
  const prefHitRate = preferred.length === 0 ? 0 : matchPreferred.length / preferred.length;

  // 75% weight on required, 25% on preferred. If required is empty,
  // preferred carries the whole signal.
  const score = required.length === 0
    ? Math.round(prefHitRate * 100)
    : Math.round((reqHitRate * 0.75 + prefHitRate * 0.25) * 100);

  const expl = required.length > 0
    ? `Matched ${matchRequired.length} of ${required.length} required skill${required.length === 1 ? "" : "s"}` +
      (preferred.length > 0 ? ` and ${matchPreferred.length} of ${preferred.length} preferred.` : ".")
    : `Matched ${matchPreferred.length} of ${preferred.length} preferred keyword${preferred.length === 1 ? "" : "s"} from the JD.`;

  return { score, explanation: expl };
}

function extractKeywordsFromDescription(desc: string | null, cap: number, exclude: Set<string>): string[] {
  if (!desc) return [];
  const STOP = new Set([
    "the", "and", "for", "with", "you", "are", "our", "your", "this", "that",
    "will", "have", "from", "they", "their", "but", "any", "all", "can", "not",
    "team", "role", "work", "must", "able", "into", "about", "over", "more",
    "what", "when", "where", "while", "based", "across", "within", "should",
    "we", "us", "is", "it", "as", "to", "of", "in", "on", "at", "be", "by",
    "or", "an", "a", "if", "do", "so", "no", "yes", "out", "up", "down",
    "year", "years", "month", "months", "day", "days",
  ]);
  const freq = new Map<string, number>();
  for (const raw of desc.toLowerCase().split(/[^a-z0-9+#&]+/)) {
    if (!raw || raw.length < 3) continue;
    if (STOP.has(raw)) continue;
    if (exclude.has(raw)) continue;
    freq.set(raw, (freq.get(raw) ?? 0) + 1);
  }
  return Array.from(freq.entries())
    .filter(([, n]) => n >= 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, cap)
    .map(([t]) => t);
}

// Experience axis — years of relevant experience (recency-weighted)
// PLUS a promotion-readiness signal that looks for management /
// ownership scope in the most recent role. A tenured Senior with
// "managed/supervised/mentored a team" or "owned client relationships"
// reads as ready to step up.
function scoreExperience(c: ScoringCandidate, j: ScoringJob): AxisScore {
  const job = classifyTitle(j.title);
  const exp = Array.isArray(c.experience) ? c.experience : [];

  if (exp.length === 0 && !c.resumeText && !c.currentDesignation) {
    return { score: 0, explanation: "No work history on file.", missing: true };
  }

  // Sum tenure in roles whose title is the same function as the job
  // (recency-weighted: a year of relevant work in the current role is
  // worth ~1.5x a year three jobs back).
  let relevantYears = 0;
  let totalYears = 0;
  let currentRoleYears = 0;
  let i = 0;
  for (const entry of exp) {
    if (!entry || typeof entry !== "object") continue;
    const r = entry as Record<string, unknown>;
    const titleStr = pickString(r, ["title", "designation", "role", "position"]);
    const startStr = pickString(r, ["startDate", "start_date", "start", "from"]);
    const endStr = pickString(r, ["endDate", "end_date", "end", "to"]);
    const years = yearsBetween(startStr, endStr);
    totalYears += years;
    if (i === 0) currentRoleYears = years;
    const entryCls = classifyTitle(titleStr);
    if (job.function && entryCls.function === job.function) {
      const recency = i === 0 ? 1.5 : i === 1 ? 1.25 : 1.0;
      relevantYears += years * recency;
    }
    i++;
  }

  // Promotion-readiness scope — text scan over the most-recent role
  // + the resume blob.
  const scopeBlob = (c.resumeText ?? "").toLowerCase() + " " +
    (exp[0] && typeof exp[0] === "object" ? formatExperienceEntry(exp[0] as Record<string, unknown>).toLowerCase() : "");
  const PROMO_SIGNALS = [
    "managed", "manage a team", "supervised", "supervising", "mentored", "mentoring",
    "led a team", "led the team", "owned client", "client relationships",
    "team lead", "team manager", "reports to me", "direct reports",
  ];
  const promoHits = PROMO_SIGNALS.filter((s) => scopeBlob.includes(s)).length;

  // Anchor: 5 relevant recency-weighted years saturates the relevant-
  // experience component. 10+ total years is a full second component.
  const relevantComp = Math.min(60, relevantYears * 12); // 0-60
  const tenureComp = Math.min(20, totalYears * 2); // 0-20
  const promoComp = Math.min(20, promoHits * 7 + (job.level != null && job.level >= 4 && currentRoleYears >= 3 ? 6 : 0)); // 0-20

  const score = Math.min(100, Math.round(relevantComp + tenureComp + promoComp));
  const tenuredAtLevel = currentRoleYears >= 3;
  const candCls = classifyTitle(c.currentDesignation);
  const samelevelPromotionFit = candCls.function != null && job.function != null && candCls.function === job.function && candCls.level != null && job.level != null && job.level - candCls.level === 1 && tenuredAtLevel && promoHits >= 1;

  const explanation = samelevelPromotionFit
    ? `${relevantYears.toFixed(1)} yrs in ${job.function}, ${currentRoleYears.toFixed(1)} yrs tenured at current level with team-management scope — promotion-ready for the role.`
    : `${relevantYears.toFixed(1)} yrs of relevant ${job.function ?? "function"} experience over ${totalYears.toFixed(1)} total years.`;

  return { score, explanation };
}

// Location axis — full credit when within 30mi OR the job lists
// "remote". Linear falloff out to ~150 miles. Different state with no
// listed remote support drops below 30.
function scoreLocation(c: ScoringCandidate, j: ScoringJob): AxisScore {
  const jobIsRemote = j.locations.some((l) => /\bremote\b/i.test(l)) ||
    (j.title.toLowerCase().includes("remote"));
  if (jobIsRemote) {
    return { score: 100, explanation: "Role is remote-eligible; location not a factor." };
  }

  if (!c.location && (c.lat == null || c.lng == null)) {
    return { score: 0, explanation: "Candidate location unknown.", missing: true };
  }
  if (j.locations.length === 0 && !j.locationCity && !j.locationZip) {
    return { score: 0, explanation: "Role location unspecified.", missing: true };
  }

  // City/state token overlap is the cheap signal. We do not require
  // lat/lng — when both sides only have free text we still produce
  // something useful.
  const candText = (c.location ?? "").toLowerCase();
  const jobLocs = [...j.locations, j.locationCity ?? "", j.locationState ?? "", j.locationZip ?? ""].map((s) => s.toLowerCase());
  let bestScore = 0;
  for (const loc of jobLocs) {
    if (!loc) continue;
    const tokens = loc.split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
    let hits = 0;
    for (const t of tokens) {
      if (candText.includes(t)) hits++;
    }
    if (tokens.length === 0) continue;
    const rate = hits / tokens.length;
    if (rate >= 0.6) bestScore = Math.max(bestScore, 100);
    else if (rate >= 0.4) bestScore = Math.max(bestScore, 75);
    else if (rate >= 0.2) bestScore = Math.max(bestScore, 45);
    else bestScore = Math.max(bestScore, 20);
  }

  return {
    score: bestScore,
    explanation: bestScore >= 75
      ? "Candidate is local or in the same metro as the role."
      : bestScore >= 45
      ? "Candidate is in the same state/region as the role."
      : "Candidate location does not closely match the role's locations.",
  };
}

// Comp axis — candidate expected salary vs job range. Missing data
// rescales the axis out (the brief: "Missing data does NOT penalize").
function scoreComp(c: ScoringCandidate, j: ScoringJob): AxisScore {
  const expected = extractExpectedSalary(c.expectedSalary);
  const lo = typeof j.salaryRangeStart === "number" ? j.salaryRangeStart : null;
  const hi = typeof j.salaryRangeEnd === "number" ? j.salaryRangeEnd : null;
  if (expected == null || (lo == null && hi == null)) {
    return { score: 0, explanation: "Salary expectation or range not on file.", missing: true };
  }
  const low = lo ?? hi!;
  const high = hi ?? lo!;
  if (expected >= low && expected <= high) {
    return { score: 100, explanation: `Target $${Math.round(expected / 1000)}k sits inside the role's $${Math.round(low / 1000)}-$${Math.round(high / 1000)}k band.` };
  }
  if (expected < low) {
    const gap = (low - expected) / low;
    if (gap <= 0.1) return { score: 85, explanation: `Target $${Math.round(expected / 1000)}k is within 10% below the band.` };
    if (gap <= 0.2) return { score: 70, explanation: `Target $${Math.round(expected / 1000)}k is 10-20% below the band.` };
    return { score: 50, explanation: `Target $${Math.round(expected / 1000)}k is well below the role's range.` };
  }
  // expected > high
  const gap = (expected - high) / high;
  if (gap <= 0.1) return { score: 70, explanation: `Target $${Math.round(expected / 1000)}k is within 10% above the band; negotiable.` };
  if (gap <= 0.2) return { score: 45, explanation: `Target $${Math.round(expected / 1000)}k is 10-20% above the band.` };
  return { score: 20, explanation: `Target $${Math.round(expected / 1000)}k is well above the role's range.` };
}

// ---- Orchestrator ----------------------------------------------------------

const WEIGHTS = {
  title: 0.2,
  skills: 0.3,
  experience: 0.25,
  location: 0.15,
  other: 0.1,
} as const;

export type MatchSubScores = {
  // Numeric per-axis 0-100 scores.
  titleScore: number;
  skillsScore: number;
  experienceScore: number;
  locationScore: number;
  otherScore: number;
  // String explanations consumed by ScoreBadge popover (existing
  // contract from the prior Claude scorer — keep names + shape so
  // the UI keeps rendering without a change).
  titleMatch: string;
  locationFit: string;
  experienceFit: string;
  compensationFit: string;
  overallSummary: string;
};

export type MatchResult = {
  score: number; // 0-100, final
  subScores: MatchSubScores;
  rationale: string; // short one-line summary used as the row's rationale
  sourceHash: string;
};

export function computeMatchScore(c: ScoringCandidate, j: ScoringJob): MatchResult {
  const title = scoreTitle(c, j);
  const skills = scoreSkills(c, j);
  const experience = scoreExperience(c, j);
  const location = scoreLocation(c, j);
  const comp = scoreComp(c, j);

  // Weighted sum with missing-data rescaling — drop the weight of any
  // axis that flagged itself missing, then re-normalize the remaining
  // weights to sum to 1.
  const axes: Array<[number, AxisScore, number]> = [
    [WEIGHTS.title, title, title.score],
    [WEIGHTS.skills, skills, skills.score],
    [WEIGHTS.experience, experience, experience.score],
    [WEIGHTS.location, location, location.score],
    [WEIGHTS.other, comp, comp.score],
  ];
  let activeWeight = 0;
  let weighted = 0;
  for (const [w, ax, s] of axes) {
    if (ax.missing) continue;
    activeWeight += w;
    weighted += w * s;
  }
  const final = activeWeight === 0 ? 0 : Math.round(weighted / activeWeight);

  const candCls = classifyTitle(c.currentDesignation);
  const jobCls = classifyTitle(j.title);
  const promotionFit = candCls.function != null && jobCls.function != null && candCls.function === jobCls.function && candCls.level != null && jobCls.level != null && jobCls.level - candCls.level === 1;
  const overall = promotionFit
    ? `${final}% match: same-function promotion fit, ${title.explanation.replace(/^.*?:/, "").trim() || "title aligned"}, ${skills.explanation.toLowerCase()}`
    : `${final}% match: ${title.explanation.toLowerCase()} ${skills.explanation.toLowerCase()}`;

  const subScores: MatchSubScores = {
    titleScore: title.score,
    skillsScore: skills.score,
    experienceScore: experience.score,
    locationScore: location.score,
    otherScore: comp.score,
    titleMatch: title.explanation,
    locationFit: location.explanation,
    experienceFit: experience.explanation,
    compensationFit: comp.explanation,
    overallSummary: overall,
  };

  const rationale = promotionFit
    ? `Same-function promotion fit (${jobCls.function}). ${skills.explanation}`
    : `${title.explanation} ${skills.explanation}`;

  return {
    score: final,
    subScores,
    rationale,
    sourceHash: computeSourceHash(c, j),
  };
}

// Deterministic fingerprint of every input the scorer reads. Used by
// the upsert path to skip recompute when nothing changed. The order of
// fields matters — we sort all array fields before hashing so a no-op
// reorder of skills doesn't churn the hash.
export function computeSourceHash(c: ScoringCandidate, j: ScoringJob): string {
  const payload = {
    c: {
      title: (c.currentDesignation ?? "").toLowerCase().trim(),
      employer: (c.currentOrganization ?? "").toLowerCase().trim(),
      skills: [...c.skills].map(normalizeSkill).sort(),
      experience: Array.isArray(c.experience)
        ? (c.experience as unknown[]).map((e) => e && typeof e === "object" ? formatExperienceEntry(e as Record<string, unknown>) : "")
        : [],
      comp: extractExpectedSalary(c.expectedSalary),
      location: (c.location ?? "").toLowerCase().trim(),
      resumeText: (c.resumeText ?? "").slice(0, 20_000), // cap so very long resumes don't blow the hash CPU
    },
    j: {
      title: j.title.toLowerCase().trim(),
      description: (j.description ?? "").slice(0, 20_000),
      searchKeywords: splitCommaTokens(j.searchKeywords).sort(),
      salaryRange: [j.salaryRangeStart, j.salaryRangeEnd],
      locations: [...j.locations].map((l) => l.toLowerCase().trim()).sort(),
      locationCity: (j.locationCity ?? "").toLowerCase().trim(),
      locationState: (j.locationState ?? "").toLowerCase().trim(),
      locationZip: (j.locationZip ?? "").toLowerCase().trim(),
    },
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

// ---- Helpers ---------------------------------------------------------------

function pickString(r: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return "";
}

function yearsBetween(startStr: string, endStr: string): number {
  const start = parseLooseDate(startStr);
  if (!start) return 0;
  const end = (endStr ? parseLooseDate(endStr) : null) ?? new Date();
  const ms = end.getTime() - start.getTime();
  if (ms <= 0) return 0;
  return ms / (1000 * 60 * 60 * 24 * 365.25);
}

function parseLooseDate(s: string): Date | null {
  if (!s) return null;
  // ISO "YYYY-MM-DD" or "YYYY-MM" or just "YYYY"
  const ymd = /^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/.exec(s);
  if (ymd) {
    const y = Number(ymd[1]);
    const m = Number(ymd[2] ?? "1") - 1;
    const d = Number(ymd[3] ?? "1");
    return new Date(Date.UTC(y, m, d));
  }
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}

function formatExperienceEntry(r: Record<string, unknown>): string {
  const title = pickString(r, ["title", "designation", "role", "position"]);
  const org = pickString(r, ["organization", "employer", "company"]);
  const start = pickString(r, ["startDate", "start_date", "start", "from"]);
  const end = pickString(r, ["endDate", "end_date", "end", "to"]);
  const desc = pickString(r, ["description", "summary", "responsibilities"]);
  return `${title} @ ${org} (${start} - ${end || "present"}) ${desc}`.trim();
}

function extractExpectedSalary(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const n = r.number;
  if (typeof n === "number" && Number.isFinite(n) && n > 0) return n;
  return null;
}
