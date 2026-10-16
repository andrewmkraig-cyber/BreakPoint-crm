// Pure scope constants for API Access keys. Kept prisma-free so the
// Settings view (a client component) can import them; the server-side
// minting and auth helpers live in @/lib/api-keys and re-export these.

export const API_KEY_SCOPES = ["read", "write"] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const SCOPE_LABELS: Record<ApiKeyScope, { label: string; detail: string }> = {
  read: {
    label: "Read data",
    detail: "Search candidates, jobs, and clients; read pipeline, revenue, and call context.",
  },
  write: {
    label: "Create reminders and contacts",
    detail: "The two reversible writes the Assistant runs without a Confirm card. Nothing else.",
  },
};

export function isApiKeyScope(s: unknown): s is ApiKeyScope {
  return typeof s === "string" && (API_KEY_SCOPES as readonly string[]).includes(s);
}
