// Apollo decision-maker contact fetch used by the approval queue card to
// preview candidates before Andrew approves a discovery run. Distinct from
// apollo-enroll's people search: this one is keyed off the company's
// domain (not its name) and returns a structured shape the UI can render
// as removable/swappable chips. The curated list is persisted onto the
// BDRun's discoveredPayload at approval time, so the enroll step reads
// Andrew's edited list rather than re-fetching.

const APOLLO_BASE = "https://api.apollo.io";

// Three-tier title priority list. Apollo's person_titles uses fuzzy
// matching so we send the literal titles below; client-side ranking
// after the fetch decides which contacts survive the per-firm cap.
const PRIMARY_TITLES = [
  "Firm Administrator",
  "Practice Administrator",
  "Director of Operations",
  "COO",
  "HR Director",
  "Director of People",
  "People Operations Manager",
  "Recruiting Manager",
  "Talent Acquisition Manager",
  "Head of Talent Acquisition",
];

const SMALL_FIRM_FALLBACK_TITLES = [
  "Managing Partner",
  "Executive Partner",
  "Office Managing Partner",
  "Owner",
  "Shareholder",
  "Principal",
];

const PRACTICE_SPECIFIC_TITLES = [
  "Tax Partner",
  "Tax Director",
  "Tax Practice Leader",
  "Audit Partner",
  "Assurance Partner",
  "CAS Partner",
  "Client Accounting Services Director",
];

// Excluded as substring matches against the raw Apollo title. Lowercase
// — comparison is case-insensitive.
const EXCLUDED_KEYWORDS = ["staffing", "staff agency", "in-house"];
const EXCLUDED_EXACT_TITLES = new Set(
  [
    "Staff Accountant",
    "Senior Accountant",
    "Bookkeeper",
    "Accounting Clerk",
  ].map((t) => t.toLowerCase()),
);

const MAX_CONTACTS_PER_FIRM = 4;
const MAX_PRACTICE_SPECIFIC_PER_FIRM = 1;

export type ApolloContact = {
  id: string;
  firstName: string;
  lastName: string;
  title: string;
  linkedinUrl: string | null;
};

type ApolloPersonRaw = {
  id?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  linkedin_url?: string;
};

type Tier = "primary" | "small-firm" | "practice-specific";

function classify(title: string): Tier | null {
  const t = title.toLowerCase();
  if (PRIMARY_TITLES.some((p) => t.includes(p.toLowerCase()))) return "primary";
  if (PRACTICE_SPECIFIC_TITLES.some((p) => t.includes(p.toLowerCase()))) return "practice-specific";
  if (SMALL_FIRM_FALLBACK_TITLES.some((p) => t.includes(p.toLowerCase()))) return "small-firm";
  return null;
}

function isExcluded(title: string): boolean {
  const t = title.toLowerCase();
  if (EXCLUDED_EXACT_TITLES.has(t)) return true;
  return EXCLUDED_KEYWORDS.some((k) => t.includes(k));
}

export async function fetchApolloContacts(
  domain: string,
  orgId: string,
): Promise<ApolloContact[]> {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) return [];
  const normDomain = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  if (!normDomain) return [];

  try {
    const res = await fetch(`${APOLLO_BASE}/api/v1/mixed_people/search`, {
      method: "POST",
      headers: {
        "X-Api-Key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        organization_domains: [normDomain],
        person_titles: [
          ...PRIMARY_TITLES,
          ...SMALL_FIRM_FALLBACK_TITLES,
          ...PRACTICE_SPECIFIC_TITLES,
        ],
        per_page: 25,
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn(
        `[Apollo contacts] search failed for domain="${normDomain}" org=${orgId}: ${res.status} ${res.statusText}`,
      );
      return [];
    }
    const data = (await res.json().catch(() => ({}))) as {
      people?: ApolloPersonRaw[];
      contacts?: ApolloPersonRaw[];
    };
    const raw = data.people ?? data.contacts ?? [];
    if (!Array.isArray(raw)) return [];

    const primary: ApolloContact[] = [];
    const smallFirm: ApolloContact[] = [];
    const practiceSpecific: ApolloContact[] = [];

    for (const p of raw) {
      const first = (p.first_name ?? "").trim();
      const last = (p.last_name ?? "").trim();
      const title = (p.title ?? "").trim();
      if (!first && !last) continue;
      if (isExcluded(title)) continue;
      const tier = classify(title);
      if (!tier) continue;
      const contact: ApolloContact = {
        id: p.id ?? `${first}-${last}-${title}`.toLowerCase().replace(/\s+/g, "-"),
        firstName: first,
        lastName: last,
        title,
        linkedinUrl: typeof p.linkedin_url === "string" && p.linkedin_url.trim() ? p.linkedin_url.trim() : null,
      };
      if (tier === "primary") primary.push(contact);
      else if (tier === "small-firm") smallFirm.push(contact);
      else practiceSpecific.push(contact);
    }

    // Compose final list under the per-firm cap.
    // 1. Prefer primary/HR/ops first — take up to MAX_CONTACTS_PER_FIRM.
    // 2. Small-firm fallback ONLY when no primary contact was returned.
    // 3. Practice-specific is capped to MAX_PRACTICE_SPECIFIC_PER_FIRM
    //    and only fills remaining slots after primary/small-firm.
    const out: ApolloContact[] = [];
    if (primary.length > 0) {
      for (const c of primary) {
        if (out.length >= MAX_CONTACTS_PER_FIRM) break;
        out.push(c);
      }
    } else {
      for (const c of smallFirm) {
        if (out.length >= MAX_CONTACTS_PER_FIRM) break;
        out.push(c);
      }
    }
    let practiceSpecificAdded = 0;
    for (const c of practiceSpecific) {
      if (out.length >= MAX_CONTACTS_PER_FIRM) break;
      if (practiceSpecificAdded >= MAX_PRACTICE_SPECIFIC_PER_FIRM) break;
      out.push(c);
      practiceSpecificAdded += 1;
    }
    return out;
  } catch (err) {
    console.warn(
      `[Apollo contacts] threw for domain="${normDomain}" org=${orgId}:`,
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}
