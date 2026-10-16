import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

// API Access keys: minting, hashing, and request authentication for the
// side door (/api/mcp, /api/v1/*). See prisma ApiKey for the storage
// rules. The raw key is `ace_` + 32 random bytes (base64url); we persist
// SHA-256(raw) and look keys up by that hash, so the key itself never
// touches the database or the logs.

export {
  API_KEY_SCOPES,
  SCOPE_LABELS,
  isApiKeyScope,
  type ApiKeyScope,
} from "@/lib/api-key-scopes";
import { isApiKeyScope, type ApiKeyScope } from "@/lib/api-key-scopes";

const KEY_PREFIX = "ace_";

export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export function mintApiKey(): { raw: string; prefix: string; keyHash: string } {
  const raw = KEY_PREFIX + randomBytes(32).toString("base64url");
  return { raw, prefix: raw.slice(0, KEY_PREFIX.length + 8), keyHash: hashApiKey(raw) };
}

export type ApiActor = {
  keyId: string;
  orgId: string;
  userId: string;
  userEmail: string | null;
  scopes: ApiKeyScope[];
};

export type ApiAuthResult =
  | { ok: true; actor: ApiActor }
  | { ok: false; status: 401 | 403; error: string };

// Pull the bearer token out of a request. Accepts `Authorization: Bearer
// <key>` (what MCP clients and most agent platforms send) and, as a
// fallback for tools that only let you set a custom header, `X-Api-Key`.
function extractKey(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth) {
    const m = /^Bearer\s+(\S+)$/i.exec(auth.trim());
    if (m) return m[1];
  }
  const x = req.headers.get("x-api-key");
  return x ? x.trim() : null;
}

// Authenticate a side-door request. Resolves the key to its org + the
// recruiter who minted it. Revoked keys fail closed. lastUsedAt is
// touched at most once a minute so a chatty agent doesn't turn every
// read into a write.
export async function authenticateApiRequest(req: Request): Promise<ApiAuthResult> {
  const raw = extractKey(req);
  if (!raw || !raw.startsWith(KEY_PREFIX)) {
    return { ok: false, status: 401, error: "Missing or malformed API key." };
  }
  const keyHash = hashApiKey(raw);
  const row = await prisma.apiKey.findUnique({
    where: { keyHash },
    select: {
      id: true,
      organizationId: true,
      userId: true,
      scopes: true,
      revokedAt: true,
      lastUsedAt: true,
    },
  });
  if (!row) {
    return { ok: false, status: 401, error: "Unknown API key." };
  }
  if (row.revokedAt) {
    return { ok: false, status: 401, error: "This API key has been revoked." };
  }
  const user = await prisma.user.findUnique({
    where: { id: row.userId },
    select: { email: true },
  });
  const now = Date.now();
  if (!row.lastUsedAt || now - row.lastUsedAt.getTime() > 60_000) {
    void prisma.apiKey
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date(now) } })
      .catch(() => undefined);
  }
  return {
    ok: true,
    actor: {
      keyId: row.id,
      orgId: row.organizationId,
      userId: row.userId,
      userEmail: user?.email ?? null,
      scopes: row.scopes.filter(isApiKeyScope),
    },
  };
}
