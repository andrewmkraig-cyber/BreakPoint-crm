import { prisma } from "@/lib/prisma";

// Matches an inbound Quo call / SMS phone number against existing
// Contact.phoneNumbers rows that belong to a Client. The webhook calls
// this AFTER the candidate-side phone match misses (or in parallel) so
// CallLog.clientId / SmsMessage.clientId get stamped at write-time —
// which is what the client profile's <CallLogs clientId={...}/> +
// <TextingExchanges clientId={...}/> read against.
//
// Contact.phoneNumbers is stored as `Json` shaped as
// `[{ number: "+1 216-870-4655" }, ...]` (legacy free-form data may
// occasionally store a bare string instead — the matcher handles both).
// We compare on the trailing 10 digits so formatting / country-code
// variations don't break the match.
//
// Returns the first matched client + org, or null when no Contact's
// phone matches. Cheap enough at desk scale (≈ few hundred contacts)
// to fetch + filter in-memory; if traffic grows we can move the
// matcher to a `$queryRaw` with `jsonb_array_elements`.

export type ClientMatch = { clientId: string; organizationId: string; ownerId: string | null };

export async function matchClientByPhone(raw: string): Promise<ClientMatch | null> {
  const lastTen = raw.replace(/\D/g, "").slice(-10);
  if (lastTen.length < 10) return null;

  const contacts = await prisma.contact.findMany({
    where: {
      clientId: { not: null },
      // Prisma uses `Prisma.JsonNull` etc. for explicit Json null checks;
      // an `equals: null` here would mistakenly match db-nulls only. We
      // skip the column filter and short-circuit in-loop instead.
    },
    select: { clientId: true, organizationId: true, phoneNumbers: true, client: { select: { ownerId: true } } },
  });

  for (const c of contacts) {
    if (!c.clientId) continue;
    const nums = c.phoneNumbers;
    if (!Array.isArray(nums)) continue;
    for (const entry of nums) {
      const rawNum =
        typeof entry === "string"
          ? entry
          : entry && typeof entry === "object" && "number" in entry
            ? String((entry as { number?: unknown }).number ?? "")
            : "";
      if (!rawNum) continue;
      const digits = rawNum.replace(/\D/g, "").slice(-10);
      if (digits.length === 10 && digits === lastTen) {
        return { clientId: c.clientId, organizationId: c.organizationId, ownerId: c.client?.ownerId ?? null };
      }
    }
  }
  return null;
}
