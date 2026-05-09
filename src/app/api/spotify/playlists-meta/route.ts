import { NextRequest, NextResponse } from "next/server";
import { applyRefreshedSpotifyCookies, spotifyApiProxy } from "@/lib/spotify";

// GET /api/spotify/playlists-meta?ids=a,b,c — fetches lightweight
// metadata for a comma-separated list of playlist IDs in parallel.
// Spotify has no batch playlist endpoint, so this is N parallel
// /v1/playlists/{id} calls. Capped at 10 IDs per request to bound
// the API spend; the recently-played derivation already limits to
// the 10 most recent playlist contexts.
//
// Used only for "Recently played playlists" the recruiter doesn't
// follow themselves — for playlists they DO follow, the panel reuses
// the data from /api/spotify/playlists rather than refetching here.
//
// Output preserves input order so the panel can render in recency
// order without resorting client-side.

export const dynamic = "force-dynamic";

const MAX_IDS = 10;
const ID_RE = /^[A-Za-z0-9]+$/;

type Image = { url?: string; width?: number };
type PlaylistDetails = {
  id?: string;
  name?: string;
  uri?: string;
  images?: Image[];
  owner?: { display_name?: string };
  tracks?: { total?: number };
};

function pickImage(images: Image[] | undefined, preferred: number): string {
  if (!images || images.length === 0) return "";
  return [...images]
    .filter((i) => i.url)
    .sort(
      (a, b) =>
        Math.abs((a.width ?? 0) - preferred) -
        Math.abs((b.width ?? 0) - preferred),
    )[0]?.url ?? "";
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const raw = (url.searchParams.get("ids") ?? "").trim();
  if (!raw) {
    return NextResponse.json({ ok: true, playlists: [] });
  }
  const ids = raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => ID_RE.test(id))
    .slice(0, MAX_IDS);
  if (ids.length === 0) {
    return NextResponse.json({ ok: true, playlists: [] });
  }

  // Fan out concurrently — these are independent /v1/playlists/{id}
  // calls and the cap is 10. spotifyApiProxy reuses the same access
  // token for every call (refresh, if needed, runs once on the first
  // resolved token call).
  const settled = await Promise.all(
    ids.map((id) =>
      spotifyApiProxy(`/v1/playlists/${id}?fields=id,uri,name,images,owner.display_name,tracks.total`, {
        tag: "playlists/meta",
      }),
    ),
  );

  // Project per-id results, preserving input order. A single failed
  // call doesn't poison the rest — that ID just gets dropped from the
  // returned list. The token-refresh, if any, comes from whichever
  // call performed it; setting cookies for the LAST refresh is a
  // safe choice because any later request would observe it on the
  // next refresh cycle anyway.
  const playlists: {
    id: string;
    uri: string;
    name: string;
    owner: string;
    image: string;
    trackCount: number;
  }[] = [];
  const lastRefreshed = settled.find((r) => r.refreshed)?.refreshed ?? null;
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (!r.ok) continue;
    const p = r.data as PlaylistDetails | null;
    if (!p?.id || !p.uri || !p.name) continue;
    playlists.push({
      id: p.id,
      uri: p.uri,
      name: p.name,
      owner: p.owner?.display_name ?? "",
      image: pickImage(p.images, 300),
      trackCount: p.tracks?.total ?? 0,
    });
  }

  const res = NextResponse.json({ ok: true, playlists });
  return applyRefreshedSpotifyCookies(res, lastRefreshed);
}
