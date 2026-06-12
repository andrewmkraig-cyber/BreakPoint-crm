import { prisma } from "@/lib/prisma";
import { generateClientBlurb as generateClientBlurbWithClaude } from "@/lib/claude";
import { buildPersonalTrainerBlock } from "@/lib/personal-trainer";

// Loads the client (tenant-scoped), asks Claude for an anonymous
// candidate-facing blurb, saves it to Client.candidateBlurb, and returns
// the saved phrase. Shared by the client-page server action and the bulk
// email queue resolver so both produce identical blurbs and the column is
// the single source of truth. Throws on a missing client or a Claude
// failure — callers decide whether to surface the error (UI) or fall back
// to a generic placeholder (send path).
export async function generateAndSaveClientBlurb(params: {
  clientId: string;
  organizationId: string;
}): Promise<string> {
  const client = await prisma.client.findFirst({
    where: { id: params.clientId, organizationId: params.organizationId },
    select: {
      id: true,
      name: true,
      overview: true,
      industry: true,
      // Light context: titles of the client's currently-open roles.
      jobs: {
        where: { isOpen: true },
        select: { title: true },
        take: 5,
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!client) throw new Error("Client not found.");

  // Personal Trainer rules apply to every Claude response across Ace.
  const extraSystem = await buildPersonalTrainerBlock(params.organizationId);

  const blurb = await generateClientBlurbWithClaude({
    name: client.name,
    overview: client.overview,
    industry: client.industry,
    jobTitles: client.jobs.map((j) => j.title).filter(Boolean),
    extraSystem,
  });

  await prisma.client.update({
    where: { id: client.id },
    data: { candidateBlurb: blurb },
  });

  return blurb;
}

// Resolve the {{client_blurb}} merge value for any SEND path. Prefers the
// saved Client.candidateBlurb; if it's missing, generates one once (Claude)
// and caches it on the row; if generation fails, or there's no client in
// context, falls back to "a confidential client" so a sent email never
// renders the token blank ("This is with .") or literal. Single source of
// truth shared by the bulk email queue (bulk-actions) and the trigger /
// confirmation send path (merge-context → fireTemplatedEmail). The generate
// step is once-per-client: after the first send the saved column answers
// every later resolve for free.
export async function resolveClientBlurb(params: {
  clientId: string | null | undefined;
  organizationId: string | null | undefined;
  savedBlurb: string | null | undefined;
}): Promise<string> {
  const saved = (params.savedBlurb ?? "").trim();
  if (saved) return saved;
  if (params.clientId && params.organizationId) {
    try {
      return await generateAndSaveClientBlurb({
        clientId: params.clientId,
        organizationId: params.organizationId,
      });
    } catch {
      return "a confidential client";
    }
  }
  return "a confidential client";
}
