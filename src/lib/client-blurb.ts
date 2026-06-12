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
