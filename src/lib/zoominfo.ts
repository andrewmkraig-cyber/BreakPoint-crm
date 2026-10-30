import "server-only";

import { SignJWT, importPKCS8 } from "jose";

import { prisma } from "@/lib/prisma";

// ZoomInfo API client. Credentials live on the Organization (Settings >
// Connectors > ZoomInfo), the same way the Mercury key does, so Andrew
// can connect from the app without a redeploy.
//
// Auth, two ways, both ending in a one-hour API JWT that is cached in
// memory per org and refreshed five minutes early:
//   - password: POST /authenticate with { username, password }.
//   - PKI (a Custom App in the ZoomInfo Admin Portal): sign a five-minute
//     RS256 JWT with the app's private key (aud "enterprise_api", iss
//     "api-client@zoominfo.com", the admin's username and the client id)
//     and POST /authenticate with it as the Bearer token. No seat needed.
// When both are stored, PKI wins. Every other call sends the API JWT as a
// Bearer token.
//
// Only the reads Ace needs are wrapped here. Nothing in this module
// writes to ZoomInfo.

const BASE = "https://api.zoominfo.com";
const TOKEN_TTL_MS = 55 * 60 * 1000;

type Creds =
  | { kind: "password"; username: string; password: string }
  | { kind: "pki"; username: string; clientId: string; privateKey: string };

export type ZoomInfoAuthMode = Creds["kind"];

export type ZoomInfoFailure =
  | { ok: false; reason: "not_connected" }
  | { ok: false; reason: "invalid_credentials"; message: string }
  | { ok: false; reason: "unreachable"; message: string }
  | { ok: false; reason: "upstream"; status: number; message: string };

async function loadCreds(orgId: string): Promise<Creds | null> {
  const row = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      zoomInfoUsername: true,
      zoomInfoPassword: true,
      zoomInfoClientId: true,
      zoomInfoPrivateKey: true,
    },
  });
  if (!row?.zoomInfoUsername) return null;
  if (row.zoomInfoClientId && row.zoomInfoPrivateKey) {
    return {
      kind: "pki",
      username: row.zoomInfoUsername,
      clientId: row.zoomInfoClientId,
      privateKey: row.zoomInfoPrivateKey,
    };
  }
  if (row.zoomInfoPassword) {
    return { kind: "password", username: row.zoomInfoUsername, password: row.zoomInfoPassword };
  }
  return null;
}

// Normalize a pasted PEM: Windows line endings, surrounding quotes, and
// the "\n" literal that a one-line paste from a JSON file carries.
export function normalizePem(raw: string): string {
  return raw
    .trim()
    .replace(/^"|"$/g, "")
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n")
    .trim();
}

async function signPkiAssertion(creds: Extract<Creds, { kind: "pki" }>): Promise<string> {
  const key = await importPKCS8(normalizePem(creds.privateKey), "RS256");
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    aud: "enterprise_api",
    iss: "api-client@zoominfo.com",
    username: creds.username,
    client_id: creds.clientId,
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuedAt(now)
    .setExpirationTime(now + 5 * 60)
    .sign(key);
}

export async function isZoomInfoConfigured(orgId: string): Promise<boolean> {
  return (await loadCreds(orgId)) != null;
}

const tokenCache = new Map<string, { jwt: string; expiresAt: number }>();

export function clearZoomInfoTokenCache(orgId?: string): void {
  if (orgId) tokenCache.delete(orgId);
  else tokenCache.clear();
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string; error?: string; errors?: unknown };
    return body.message ?? body.error ?? JSON.stringify(body).slice(0, 300);
  } catch {
    return `${res.status} ${res.statusText}`;
  }
}

type TokenResult = { ok: true; jwt: string } | ZoomInfoFailure;

export async function getZoomInfoToken(orgId: string): Promise<TokenResult> {
  const cached = tokenCache.get(orgId);
  if (cached && cached.expiresAt > Date.now()) return { ok: true, jwt: cached.jwt };

  const creds = await loadCreds(orgId);
  if (!creds) return { ok: false, reason: "not_connected" };

  let res: Response;
  try {
    if (creds.kind === "pki") {
      let assertion: string;
      try {
        assertion = await signPkiAssertion(creds);
      } catch (e) {
        return {
          ok: false,
          reason: "invalid_credentials",
          message: `The private key could not be read: ${e instanceof Error ? e.message : "bad PEM"}. Paste the whole key file, including the BEGIN and END lines.`,
        };
      }
      res = await fetch(`${BASE}/authenticate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${assertion}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({}),
        cache: "no-store",
      });
    } else {
      res = await fetch(`${BASE}/authenticate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ username: creds.username, password: creds.password }),
        cache: "no-store",
      });
    }
  } catch (e) {
    return { ok: false, reason: "unreachable", message: e instanceof Error ? e.message : "fetch failed" };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, reason: "invalid_credentials", message: await readError(res) };
  }
  if (!res.ok) {
    return { ok: false, reason: "upstream", status: res.status, message: await readError(res) };
  }
  const body = (await res.json()) as { jwt?: string };
  if (!body.jwt) {
    return { ok: false, reason: "upstream", status: res.status, message: "No token in the authenticate response." };
  }
  tokenCache.set(orgId, { jwt: body.jwt, expiresAt: Date.now() + TOKEN_TTL_MS });
  return { ok: true, jwt: body.jwt };
}

type CallResult<T> = { ok: true; data: T } | ZoomInfoFailure;

async function call<T>(orgId: string, path: string, body: unknown): Promise<CallResult<T>> {
  const token = await getZoomInfoToken(orgId);
  if (!token.ok) return token;
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.jwt}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (e) {
    return { ok: false, reason: "unreachable", message: e instanceof Error ? e.message : "fetch failed" };
  }
  if (res.status === 401) {
    // Token expired early or was revoked. Drop it so the next call
    // re-authenticates; report this one honestly.
    tokenCache.delete(orgId);
    return { ok: false, reason: "invalid_credentials", message: await readError(res) };
  }
  if (!res.ok) {
    return { ok: false, reason: "upstream", status: res.status, message: await readError(res) };
  }
  return { ok: true, data: (await res.json()) as T };
}

// ---- Probe (Settings > Connectors > Test connection) ----

export type ZoomInfoUsage = {
  // Credit lines as ZoomInfo reports them, e.g. "contact enrich" with
  // limit / used / remaining. Shape varies by plan; kept loose on purpose.
  usage: Array<{ description?: string; limitType?: string; totalLimit?: number; currentUsage?: number; remaining?: number }>;
};

export type ZoomInfoProbe =
  | { ok: true; username: string; mode: ZoomInfoAuthMode; usageSummary: string | null }
  | ZoomInfoFailure;

export async function probeZoomInfo(orgId: string): Promise<ZoomInfoProbe> {
  const creds = await loadCreds(orgId);
  if (!creds) return { ok: false, reason: "not_connected" };
  clearZoomInfoTokenCache(orgId);
  const token = await getZoomInfoToken(orgId);
  if (!token.ok) return token;
  // Usage is the cheapest authenticated read and tells the recruiter how
  // many credits are left. If the plan has no usage endpoint, the token
  // alone still proves the credentials.
  const usage = await call<ZoomInfoUsage>(orgId, "/lookup/usage", {});
  let usageSummary: string | null = null;
  if (usage.ok && Array.isArray(usage.data.usage) && usage.data.usage.length > 0) {
    usageSummary = usage.data.usage
      .slice(0, 3)
      .map((u) => {
        const label = u.description ?? u.limitType ?? "credits";
        const left = u.remaining ?? (u.totalLimit != null && u.currentUsage != null ? u.totalLimit - u.currentUsage : null);
        return left != null ? `${label}: ${left.toLocaleString("en-US")} left` : label;
      })
      .join(" · ");
  }
  return { ok: true, username: creds.username, mode: creds.kind, usageSummary };
}

// ---- Contact search (BD lists) ----

export type ZoomInfoContact = {
  id: string;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  companyName: string | null;
  companyDomain: string | null;
  city: string | null;
  state: string | null;
};

type RawContact = {
  id?: number | string;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  email?: string;
  phone?: string;
  directPhone?: string;
  externalUrls?: Array<{ type?: string; url?: string }>;
  company?: { name?: string; website?: string };
  city?: string;
  state?: string;
};

type SearchResponse<T> = { maxResults?: number; totalResults?: number; currentPage?: number; data?: T[] };

export async function searchZoomInfoContacts(
  orgId: string,
  input: {
    companyName?: string;
    companyWebsite?: string;
    jobTitle?: string;
    managementLevel?: string[];
    rpp?: number;
    page?: number;
  },
): Promise<CallResult<{ total: number; contacts: ZoomInfoContact[] }>> {
  const body: Record<string, unknown> = { rpp: input.rpp ?? 25, page: input.page ?? 1 };
  if (input.companyName) body.companyName = input.companyName;
  if (input.companyWebsite) body.companyWebsite = input.companyWebsite;
  if (input.jobTitle) body.jobTitle = input.jobTitle;
  if (input.managementLevel?.length) body.managementLevel = input.managementLevel.join(",");
  const res = await call<SearchResponse<RawContact>>(orgId, "/search/contact", body);
  if (!res.ok) return res;
  const contacts = (res.data.data ?? []).map(normalizeContact);
  return { ok: true, data: { total: res.data.totalResults ?? contacts.length, contacts } };
}

function normalizeContact(r: RawContact): ZoomInfoContact {
  const linkedin = r.externalUrls?.find((u) => (u.type ?? "").toLowerCase().includes("linkedin"))?.url ?? null;
  return {
    id: String(r.id ?? ""),
    firstName: r.firstName ?? "",
    lastName: r.lastName ?? "",
    jobTitle: r.jobTitle ?? null,
    email: r.email ?? null,
    phone: r.directPhone ?? r.phone ?? null,
    linkedinUrl: linkedin,
    companyName: r.company?.name ?? null,
    companyDomain: r.company?.website ?? null,
    city: r.city ?? null,
    state: r.state ?? null,
  };
}

// ---- Company enrich (client profiles) ----

export type ZoomInfoCompany = {
  id: string;
  name: string;
  website: string | null;
  industry: string | null;
  employees: number | null;
  revenue: number | null;
  city: string | null;
  state: string | null;
  linkedinUrl: string | null;
  description: string | null;
};

type RawCompany = {
  id?: number | string;
  name?: string;
  website?: string;
  primaryIndustry?: string;
  employeeCount?: number;
  revenue?: number;
  city?: string;
  state?: string;
  socialMediaUrls?: Array<{ type?: string; url?: string }>;
  descriptionList?: Array<{ description?: string }>;
};

type EnrichResponse<T> = { success?: boolean; data?: { result?: Array<{ data?: T[] }> } };

export async function enrichZoomInfoCompany(
  orgId: string,
  input: { website?: string; name?: string },
): Promise<CallResult<ZoomInfoCompany | null>> {
  const match: Record<string, string> = {};
  if (input.website) match.companyWebsite = input.website;
  if (input.name) match.companyName = input.name;
  const res = await call<EnrichResponse<RawCompany>>(orgId, "/enrich/company", {
    matchCompanyInput: [match],
    outputFields: [
      "id", "name", "website", "primaryIndustry", "employeeCount", "revenue",
      "city", "state", "socialMediaUrls", "descriptionList",
    ],
  });
  if (!res.ok) return res;
  const raw = res.data.data?.result?.[0]?.data?.[0];
  if (!raw) return { ok: true, data: null };
  const linkedin = raw.socialMediaUrls?.find((u) => (u.type ?? "").toLowerCase().includes("linkedin"))?.url ?? null;
  return {
    ok: true,
    data: {
      id: String(raw.id ?? ""),
      name: raw.name ?? input.name ?? "",
      website: raw.website ?? input.website ?? null,
      industry: raw.primaryIndustry ?? null,
      employees: raw.employeeCount ?? null,
      revenue: raw.revenue ?? null,
      city: raw.city ?? null,
      state: raw.state ?? null,
      linkedinUrl: linkedin,
      description: raw.descriptionList?.[0]?.description ?? null,
    },
  };
}

// Recruiter-facing wording for a failure, shared by the test route and
// any BD surface that calls ZoomInfo.
export function describeZoomInfoFailure(f: ZoomInfoFailure): { message: string; hint?: string } {
  switch (f.reason) {
    case "not_connected":
      return { message: "ZoomInfo is not connected.", hint: "Add the API username and password under Settings > Connectors." };
    case "invalid_credentials":
      return { message: `ZoomInfo rejected the credentials: ${f.message}`, hint: "Check the credentials in the ZoomInfo Admin Portal (Custom Apps for a client ID + private key, or the API user's password), and that API access is active on the account." };
    case "unreachable":
      return { message: `Could not reach ZoomInfo: ${f.message}`, hint: "Try again in a moment." };
    case "upstream":
      return { message: `ZoomInfo returned ${f.status}: ${f.message}` };
  }
}
