import { NextResponse } from "next/server";
import { applyRefreshedSpotifyCookies, spotifyApiProxy } from "@/lib/spotify";

// GET /me/playlists — slim projection so the panel's 2-column grid
// doesn't have to crawl Spotify's full envelope.

export const dynamic = "force-dynamic";

type Image = { url?: string; width?: number };
type Playlist = {
  id?: string;
  name?: string;
  uri?: string;
  images?: Image[];
  owner?: { display_name?: string };
  tracks?: { total?: number };
};

export async function GET() {
  const result = await spotifyApiProxy("/v1/me/playlists?limit=50");
  if (!result.ok) {
    const res = NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status === 401 ? 401 : 502 },
    );
    return applyRefreshedSpotifyCookies(res, result.refreshed);
  }

  const items =
    ((result.data as { items?: Playlist[] })?.items ?? []).map((p) => {
      if (!p.id || !p.uri || !p.name) return null;
      const image = (p.images ?? [])
        .filter((i) => i.url)
        .sort(
          (a, b) =>
            Math.abs((a.width ?? 0) - 300) - Math.abs((b.width ?? 0) - 300),
        )[0]?.url ?? "";
      return {
        id: p.id,
        uri: p.uri,
        name: p.name,
        owner: p.owner?.display_name ?? "",
        image,
        trackCount: p.tracks?.total ?? 0,
      };
    }).filter((x): x is NonNullable<typeof x> => x !== null);

  const res = NextResponse.json({ ok: true, playlists: items });
  return applyRefreshedSpotifyCookies(res, result.refreshed);
}
