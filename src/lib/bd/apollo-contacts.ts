// Apollo decision-maker contact fetch used by the approval queue card to
// preview candidates before Andrew approves a discovery run. Distinct from
// apollo-enroll's people search: this one is keyed off the company's
// domain (not its name) and returns a structured shape the UI can render
// as removable/swappable chips. The curated list is persisted onto the
// BDRun's discoveredPayload at approval time, so the enroll step reads
// Andrew's edited list rather than re-fetching.

const APOLLO_BASE = "https://api.apollo.io";

// Decision-maker title keywords. Apollo's person_titles uses fuzzy
// matching, so these keywords pull common variants (Director of X, VP of
// Y, etc.) without needing exact title strings.
const DECISION_MAKER_TITLES = [
  "Director",
  "VP",
  "Manager",
  "Head",
  "Controller",
  "CFO",
  "COO",
  "CEO",
  "Partner",
  "Principal",
];

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
        person_titles: DECISION_MAKER_TITLES,
        per_page: 5,
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

    const out: ApolloContact[] = [];
    for (const p of raw) {
      const first = (p.first_name ?? "").trim();
      const last = (p.last_name ?? "").trim();
      const title = (p.title ?? "").trim();
      if (!first && !last) continue;
      out.push({
        id: p.id ?? `${first}-${last}-${title}`.toLowerCase().replace(/\s+/g, "-"),
        firstName: first,
        lastName: last,
        title,
        linkedinUrl: typeof p.linkedin_url === "string" && p.linkedin_url.trim() ? p.linkedin_url.trim() : null,
      });
      if (out.length >= 5) break;
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
