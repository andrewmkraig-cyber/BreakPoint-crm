// Pure Client identity + fee helpers, split out of src/lib/clients.ts.
//
// The parser is pure - no Prisma, no session, no React - but it used to sit
// in a module that imports getCurrentOrg, so anything wanting just this
// function pulled the whole auth chain in with it (and could not be run
// outside a React server context at all). src/lib/goals/client-leaderboard.ts
// needs exactly this and nothing else, so it lives here now.
//
// src/lib/clients.ts re-exports both, so every existing
// `import { extractFeePctFromCustomFields } from "@/lib/clients"` keeps
// working untouched.
//
// CANONICAL FIELD IS `Client.feePct`. This reads the typed `customFields`
// JSON column as a FALLBACK for legacy imports that were never backfilled -
// it is NOT a read of the legacy RF `raw` blob, which is the
// thing the dfe3349 client-card fee bug was about and what
// scripts/check-rf-blob-reads.mjs guards. Resolve canonical-first:
//   client.feePct ?? extractFeePctFromCustomFields(client.customFields)
export function extractFeePctFromCustomFields(raw: unknown): number | null {
  if (!Array.isArray(raw)) return null;
  for (const f of raw) {
    if (!f || typeof f !== "object") continue;
    const name = (f as { name?: unknown }).name;
    if (typeof name !== "string") continue;
    const lower = name.toLowerCase();
    if (!(lower.includes("avg fee") || lower.includes("fee %") || lower.includes("fee percent"))) continue;
    const value = (f as { value?: unknown }).value;
    if (typeof value === "number") return value;
    if (typeof value === "string") {
      const n = parseFloat(value);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

// The URL segment /clients/[id] expects: the legacy RF numeric id for
// imported clients, the cuid for Ace-native ones.
//
// THIS IS THE ONE DEFINITION of that rule. `slugFor` in src/lib/clients.ts
// now delegates here, and src/lib/goals/client-leaderboard.ts imports it
// rather than restating it - a second copy would silently break every
// leaderboard link to an RF-imported client the moment the rule changed.
//
// This is why this file appears in the `RfId` Step 0 count. It reads a
// legacy identifier that is still load-bearing in live URLs; it is not a
// new RF dependency, and nothing here reads or calls RF.
export function clientSlug(row: ClientSlugFields): string {
  return row.legacyRfId != null ? String(row.legacyRfId) : row.id;
}

export type ClientSlugFields = { id: string; legacyRfId: number | null };

// The Prisma select that satisfies clientSlug, shipped WITH it so a caller
// cannot select the wrong columns and cannot drift if the slug rule ever
// needs a different field. Same convention as BILLING_EVENT_PLACEMENT_SELECT
// and RETAINED_INVOICE_SELECT in src/lib/billing-events.ts.
export const CLIENT_SLUG_SELECT = { id: true, legacyRfId: true } as const;
