import { prisma } from "@/lib/prisma";

// Builds the "PERSONAL TRAINER RULES" appendix string that every
// Claude system prompt across Ace ends with. Rules are managed by
// recruiters in Settings > Personal Trainer and stored in Neon, so
// this read is always against the live source of truth — no caching.
//
// Returns an empty string when the org has no rules so callers can
// `systemPrompt += await buildPersonalTrainerBlock(orgId)` without
// emitting a stray header.
export async function buildPersonalTrainerBlock(orgId: string): Promise<string> {
  const rules = await prisma.personalTrainerRule.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: "asc" },
    select: { text: true },
  });
  if (rules.length === 0) return "";
  const numbered = rules.map((r, i) => `${i + 1}. ${r.text}`).join("\n");
  return `\n\nPERSONAL TRAINER RULES (apply to every response without exception):\n${numbered}`;
}
