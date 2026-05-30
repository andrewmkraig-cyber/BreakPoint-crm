import { notFound } from "next/navigation";
import { getCandidateByIdentifier } from "@/lib/candidates";
import { LocalCandidateProfile } from "@/app/candidates/[id]/local-profile";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type CandidateTab = "profile" | "game-plan" | "notes";

export default async function CandidateProfilePage({
  params,
  searchParams,
}: {
  params: { id: string };
  // `highlight` is a comma-separated list of search tokens passed by the
  // /candidates split-view iframe so the profile can wrap matching text on
  // mount. Optional — when absent the profile renders without any overlay.
  searchParams?: { tab?: CandidateTab; embed?: string; highlight?: string };
}) {
  // The URL segment can be a cuid (the canonical post-cutover form) or a
  // legacy numeric RF id; getCandidateByIdentifier resolves both, tenant-
  // scoped, to the cuid that LocalCandidateProfile reads.
  const candidate = await getCandidateByIdentifier(params.id);
  if (!candidate) notFound();

  // Embed mode: the candidates split-view loads this page inside an iframe
  // and passes ?embed=true. AppShell strips the sidebar/topbar chrome; the
  // profile drops its in-page back/prev/next nav so the iframe shows just
  // the profile content.
  const isEmbed = searchParams?.embed === "true";

  // Phase C2: the legacy RF candidate-profile render path is deleted. Every
  // candidate — legacy (rfId != null) and Ace-native alike — renders through
  // the Ace-native LocalCandidateProfile (the cutover was settled in Phase
  // C1; this removes the now-dead branch entirely per rule 7).
  return (
    <LocalCandidateProfile
      id={candidate.id}
      tab={searchParams?.tab}
      embed={isEmbed}
      highlight={isEmbed ? searchParams?.highlight ?? null : null}
    />
  );
}
