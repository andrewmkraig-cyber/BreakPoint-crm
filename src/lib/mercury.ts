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
