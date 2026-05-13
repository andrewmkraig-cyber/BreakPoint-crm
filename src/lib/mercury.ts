import { prisma } from "@/lib/prisma";

// Shared Mercury fetch + filter logic, used by both the
// /api/mercury/transactions route and any server component that needs
// the same YTD transaction list. Keeping the upstream call in one place
// means a key rotation, auth-header change, or response shape tweak
// only touches this file.

export type MercuryTransaction = {
  id?: string;
  postedAt?: string | null;
  createdAt?: string | null;
  amount?: number | null;
  bankDescription?: string | null;
  counterpartyName?: string | null;
  [key: string]: unknown;
};

type MercuryListResponse = {
  transactions?: MercuryTransaction[];
};

export type MercuryFetchResult =
  | { ok: true; transactions: MercuryTransaction[] }
  | {
      ok: false;
      reason: "not_connected" | "invalid_key" | "unreachable" | "upstream";
      status?: number;
    };

// Direct, thin Mercury call. Takes the apiKey, returns the transactions
// array (or [] on any failure). Use this from server components that
// already have the key in hand — no DB lookup, no structured errors,
// no year filtering. Year filtering is the consumer's job because the
// "what counts as YTD" question is product-shaped, not API-shaped.
//
// limit=500 covers a year of normal subscription spend with headroom.
// revalidate=300 caches the response for 5 min so a dashboard reload
// doesn't hammer Mercury.
export async function getMercuryTransactions(
  apiKey: string,
): Promise<MercuryTransaction[]> {
  try {
    const res = await fetch(
      "https://api.mercury.com/api/v1/transactions?limit=500",
      {
        method: "GET",
        headers: {
          Authorization: `Api-Key ${apiKey}`,
          Accept: "application/json",
        },
        next: { revalidate: 300 },
      },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as MercuryListResponse;
    return data.transactions ?? [];
  } catch {
    return [];
  }
}

// Structured variant for the /api/mercury/transactions route, which
// needs to surface specific failure modes (not_connected vs invalid_key
// vs upstream) back to the connector UI. Kept here so the route and
// thin helper share types and the upstream URL.
export async function fetchMercuryYtdTransactions(
  orgId: string,
): Promise<MercuryFetchResult> {
  const orgRow = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { mercuryApiKey: true },
  });
  const key = orgRow?.mercuryApiKey;
  if (!key) return { ok: false, reason: "not_connected" };

  let res: Response;
  try {
    res = await fetch("https://api.mercury.com/api/v1/transactions", {
      method: "GET",
      headers: {
        Authorization: `Api-Key ${key}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
  } catch {
    return { ok: false, reason: "unreachable" };
  }

  if (res.status === 401) return { ok: false, reason: "invalid_key" };
  if (!res.ok) return { ok: false, reason: "upstream", status: res.status };

  const body = (await res.json()) as MercuryListResponse;
  const all = body.transactions ?? [];
  const currentYear = new Date().getFullYear();
  const filtered = all.filter((t) => {
    const stamp = t.postedAt ?? t.createdAt;
    if (!stamp) return false;
    const d = new Date(stamp);
    return d.getFullYear() === currentYear;
  });
  return { ok: true, transactions: filtered };
}

export function mercuryTransactionDescription(t: MercuryTransaction): string {
  return (
    (t.bankDescription ?? "").trim() ||
    (t.counterpartyName ?? "").trim() ||
    ""
  );
}
