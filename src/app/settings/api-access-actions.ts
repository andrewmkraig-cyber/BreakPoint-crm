"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import { isApiKeyScope, mintApiKey, type ApiKeyScope } from "@/lib/api-keys";

export type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiKeyScope[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

async function requireActor(): Promise<{ userId: string; orgId: string } | null> {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return null;
  const org = await getCurrentOrg();
  return { userId, orgId: org.id };
}

function toRow(r: {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}): ApiKeyRow {
  return {
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    scopes: r.scopes.filter(isApiKeyScope),
    createdAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
    revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
  };
}

// Every key in the org, newest first, revoked ones included so the list
// doubles as an audit trail of what used to have access.
export async function listApiKeys(): Promise<ApiKeyRow[]> {
  const actor = await requireActor();
  if (!actor) return [];
  const rows = await prisma.apiKey.findMany({
    where: { organizationId: actor.orgId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toRow);
}

// Mint a key. The raw key is returned ONCE here and never again; the
// view shows it with a copy button and then forgets it.
export async function createApiKey(input: {
  name: string;
  scopes: string[];
}): Promise<Result<{ row: ApiKeyRow; rawKey: string }>> {
  const actor = await requireActor();
  if (!actor) return { ok: false, error: "Session expired. Reload and sign in again." };
  const name = input.name.trim().slice(0, 80);
  if (!name) return { ok: false, error: "Give the key a name so you can tell keys apart later." };
  const scopes = Array.from(new Set(input.scopes.filter(isApiKeyScope)));
  if (scopes.length === 0) return { ok: false, error: "Pick at least one permission." };

  const minted = mintApiKey();
  const row = await prisma.apiKey.create({
    data: {
      organizationId: actor.orgId,
      userId: actor.userId,
      name,
      prefix: minted.prefix,
      keyHash: minted.keyHash,
      scopes,
    },
  });
  revalidatePath("/settings/api-access");
  return { ok: true, value: { row: toRow(row), rawKey: minted.raw } };
}

// Revoke is soft: the row stays (prefix, name, last used) so the list
// still shows what was connected, but the key fails auth immediately.
export async function revokeApiKey(id: string): Promise<Result<ApiKeyRow>> {
  const actor = await requireActor();
  if (!actor) return { ok: false, error: "Session expired. Reload and sign in again." };
  const existing = await prisma.apiKey.findFirst({
    where: { id, organizationId: actor.orgId },
    select: { id: true, revokedAt: true },
  });
  if (!existing) return { ok: false, error: "That key no longer exists." };
  const row = await prisma.apiKey.update({
    where: { id: existing.id },
    data: { revokedAt: existing.revokedAt ?? new Date() },
  });
  revalidatePath("/settings/api-access");
  return { ok: true, value: toRow(row) };
}
