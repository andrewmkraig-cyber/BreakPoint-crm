import { NextResponse } from "next/server";

import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type MercuryTransaction = {
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

export async function GET() {
  const org = await getCurrentOrg();
  const orgRow = await prisma.organization.findUnique({
    where: { id: org.id },
    select: { mercuryApiKey: true },
  });
  const key = orgRow?.mercuryApiKey;
  if (!key) {
    return NextResponse.json({ error: "not_connected" }, { status: 400 });
  }

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
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "mercury_unreachable" },
      { status: 502 },
    );
  }

  if (res.status === 401) {
    return NextResponse.json({ error: "invalid_key" }, { status: 401 });
  }
  if (!res.ok) {
    return NextResponse.json(
      { error: `mercury_${res.status}` },
      { status: 502 },
    );
  }

  const body = (await res.json()) as MercuryListResponse;
  const all = body.transactions ?? [];
  const currentYear = new Date().getFullYear();
  const filtered = all.filter((t) => {
    const stamp = t.postedAt ?? t.createdAt;
    if (!stamp) return false;
    const d = new Date(stamp);
    return d.getFullYear() === currentYear;
  });

  return NextResponse.json({ transactions: filtered });
}
