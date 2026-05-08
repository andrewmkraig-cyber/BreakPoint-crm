import { NextResponse } from "next/server";
import { applyRefreshedSpotifyCookies, spotifyApiProxy } from "@/lib/spotify";

// GET /v1/artists/{id} + /top-tracks + /albums in parallel so the
// artist view can render header, top-track row, and album grid from
// a single fetch.

export const dynamic = "force-dynamic";

type Image = { url?: string; width?: number };
type Track = {
  id?: string;
  name?: string;
  uri?: string;
  duration_ms?: number;
  album?: { name?: string; images?: Image[] };
};
type Album = {
  id?: string;
  name?: string;
  uri?: string;
  release_date?: string;
  images?: Image[];
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

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const id = params.id;
  // top-tracks REQUIRES a market param. We tried `from_token` here
  // briefly but Spotify deprecated that magic value in 2025 and the
  // call now 400s — empty top tracks and (because the recruiter saw
  // it) empty discography were the visible regression. Pin to a
  // hard-coded ISO country code; albums + the artist header don't
  // need market but pass it anyway so all three sub-calls share one
  // shape and we don't see an album appear in one view but vanish in
  // another for region-restricted releases.
  const [artistRes, topRes, albumsRes] = await Promise.all([
    spotifyApiProxy(`/v1/artists/${id}`),
    spotifyApiProxy(`/v1/artists/${id}/top-tracks?market=US`),
    spotifyApiProxy(
      `/v1/artists/${id}/albums?include_groups=album,single&limit=20&market=US`,
    ),
  ]);

  // Pick whichever sub-call refreshed (at most one will, since they
  // share the cookie state at request entry).
  const refreshed =
    artistRes.refreshed ?? topRes.refreshed ?? albumsRes.refreshed;

  if (!artistRes.ok) {
    console.error(
      "[spotify-artist] header fetch failed",
      artistRes.status,
      artistRes.error,
    );
    const res = NextResponse.json(
      { ok: false, error: `Header: ${artistRes.error}` },
      { status: artistRes.status === 401 ? 401 : 502 },
    );
    return applyRefreshedSpotifyCookies(res, refreshed);
  }
  if (!topRes.ok) {
    console.error(
      "[spotify-artist] top-tracks fetch failed",
      topRes.status,
      topRes.error,
    );
  }
  if (!albumsRes.ok) {
    console.error(
      "[spotify-artist] albums fetch failed",
      albumsRes.status,
      albumsRes.error,
    );
  }

  const artist = artistRes.data as {
    id?: string;
    name?: string;
    uri?: string;
    images?: Image[];
    genres?: string[];
    followers?: { total?: number };
  };

  const topTracksData = topRes.ok
    ? (topRes.data as { tracks?: Track[] })
    : { tracks: [] };
  const topTracks = (topTracksData.tracks ?? [])
    .slice(0, 5)
    .map((t) => {
      if (!t.id || !t.uri || !t.name) return null;
      return {
        id: t.id,
        uri: t.uri,
        name: t.name,
        durationMs: t.duration_ms ?? 0,
        albumArt: pickImage(t.album?.images, 64),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const albumsData = albumsRes.ok
    ? (albumsRes.data as { items?: Album[] })
    : { items: [] };
  const seen = new Set<string>();
  const albums = (albumsData.items ?? [])
    .map((al) => {
      if (!al.id || !al.uri || !al.name) return null;
      const dedupeKey = al.name.toLowerCase();
      if (seen.has(dedupeKey)) return null;
      seen.add(dedupeKey);
      return {
        id: al.id,
        uri: al.uri,
        name: al.name,
        year: al.release_date ? al.release_date.slice(0, 4) : "",
        albumArt: pickImage(al.images, 300),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const res = NextResponse.json({
    ok: true,
    id: artist.id ?? id,
    uri: artist.uri ?? `spotify:artist:${id}`,
    name: artist.name ?? "",
    image: pickImage(artist.images, 600),
    followers: artist.followers?.total ?? 0,
    genres: (artist.genres ?? []).slice(0, 3),
    topTracks,
    albums,
  });
  return applyRefreshedSpotifyCookies(res, refreshed);
}
