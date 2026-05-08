import { NextResponse } from "next/server";
import { applyRefreshedSpotifyCookies, spotifyApiProxy } from "@/lib/spotify";

// GET /v1/artists/{id} + /albums + first-album /tracks. The /top-tracks
// endpoint is intentionally NOT used — Spotify's dev-mode policy (Nov
// 2024) 403s it for apps that aren't in Extended Quota mode. Instead
// we derive a "Popular" row from the first album the artist has on
// Spotify: cheap, scopes already-granted, and never 403s for browsable
// catalog content. If the album-derived path also can't resolve, the
// panel hides the Popular section silently — no error state.
//
// Three calls run in parallel:
//   /v1/artists/{id}                                              — header
//   /v1/artists/{id}/albums?include_groups=single,album&limit=5   — top source
//   /v1/artists/{id}/albums?include_groups=album,single&limit=20  — discography
// Then a fourth dependent call once the top-source's first album id
// is known:
//   /v1/albums/{firstAlbumId}/tracks?market=US&limit=5
// The discography call's limit is hardcoded to 20 (Spotify max 50,
// min 1) per the brief — anything outside [1, 50] returns 400.

export const dynamic = "force-dynamic";

type Image = { url?: string; width?: number };
type AlbumTrack = {
  id?: string;
  name?: string;
  uri?: string;
  duration_ms?: number;
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

  // Three parallel calls; the fourth (album tracks) waits on the top-
  // source response. market=US matches the playlist/album detail route
  // so region-restricted albums relink consistently across surfaces.
  const [artistRes, popAlbumsRes, discographyRes] = await Promise.all([
    spotifyApiProxy(`/v1/artists/${id}`),
    spotifyApiProxy(
      `/v1/artists/${id}/albums?include_groups=single,album&market=US&limit=5`,
    ),
    spotifyApiProxy(
      `/v1/artists/${id}/albums?include_groups=album,single&limit=20&market=US`,
    ),
  ]);

  let refreshed =
    artistRes.refreshed ?? popAlbumsRes.refreshed ?? discographyRes.refreshed;

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
  if (!popAlbumsRes.ok) {
    console.error(
      "[spotify-artist] popular-source albums fetch failed",
      popAlbumsRes.status,
      popAlbumsRes.error,
    );
  }
  if (!discographyRes.ok) {
    console.error(
      "[spotify-artist] discography albums fetch failed",
      discographyRes.status,
      discographyRes.error,
    );
  }

  // Extract first album id from the popular-source response — this is
  // what we hand to /v1/albums/{id}/tracks for the dependent call.
  const popAlbumsData = popAlbumsRes.ok
    ? (popAlbumsRes.data as { items?: Album[] })
    : { items: [] };
  const firstPopAlbum = (popAlbumsData.items ?? []).find(
    (al) => al && al.id && al.name,
  );

  // Dependent call: only fires if the popular-source actually returned
  // an album. Bumps the existing `refreshed` cookie state if it
  // happens to refresh the access token, so the response reflects the
  // freshest credentials.
  let albumTracksRes: Awaited<ReturnType<typeof spotifyApiProxy>> | null = null;
  if (firstPopAlbum?.id) {
    albumTracksRes = await spotifyApiProxy(
      `/v1/albums/${firstPopAlbum.id}/tracks?market=US&limit=5`,
    );
    if (!albumTracksRes.ok) {
      console.error(
        "[spotify-artist] album-derived tracks fetch failed",
        albumTracksRes.status,
        albumTracksRes.error,
      );
    }
    refreshed = refreshed ?? albumTracksRes.refreshed ?? null;
  }

  // Diagnostic logs (truncated). Helps confirm the album-derived path
  // is producing what we expect when the panel reports empty Popular.
  console.log(
    "[spotify-artist] raw artist:",
    JSON.stringify(artistRes.data ?? null).slice(0, 600),
  );
  console.log(
    "[spotify-artist] raw pop-albums:",
    popAlbumsRes.status,
    JSON.stringify(
      popAlbumsRes.ok ? popAlbumsRes.data : { error: popAlbumsRes.error },
    ).slice(0, 600),
  );
  console.log(
    "[spotify-artist] raw discography:",
    discographyRes.status,
    JSON.stringify(
      discographyRes.ok ? discographyRes.data : { error: discographyRes.error },
    ).slice(0, 600),
  );
  if (albumTracksRes) {
    console.log(
      "[spotify-artist] raw album-tracks:",
      albumTracksRes.status,
      JSON.stringify(
        albumTracksRes.ok
          ? albumTracksRes.data
          : { error: albumTracksRes.error },
      ).slice(0, 600),
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

  // Build Popular from the first album's tracks. The album endpoint's
  // tracks payload doesn't embed album art on each track (the album
  // already has it at the parent), so we reuse firstPopAlbum's
  // images for every derived row.
  const albumTracksData =
    albumTracksRes && albumTracksRes.ok
      ? (albumTracksRes.data as { items?: AlbumTrack[] })
      : { items: [] };
  const albumArtFallback = pickImage(firstPopAlbum?.images, 64);
  const topTracks = (albumTracksData.items ?? [])
    .slice(0, 5)
    .map((t) => {
      if (!t || !t.id || !t.uri || !t.name) return null;
      return {
        id: t.id,
        uri: t.uri,
        name: t.name,
        durationMs: t.duration_ms ?? 0,
        albumArt: albumArtFallback,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // Discography from the limit=20 fetch. Dedupe by lowercased name to
  // collapse same-album-different-edition rows Spotify sometimes
  // returns side by side.
  const discographyData = discographyRes.ok
    ? (discographyRes.data as { items?: Album[] })
    : { items: [] };
  const seen = new Set<string>();
  const albums = (discographyData.items ?? [])
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

  // Followers must distinguish "Spotify said zero" from "Spotify
  // didn't include the field at all" — defaulting both to 0 was the
  // bug on real artists. Null when the field is missing/undefined so
  // the panel can hide the row instead of pretending Spotify reported
  // zero followers.
  const followers =
    typeof artist.followers?.total === "number"
      ? artist.followers.total
      : null;

  // Debug envelope kept for client-side console diagnostics. Field
  // names match the panel's existing expectations from 36.9.
  const debug = {
    headerStatus: artistRes.status,
    // topTracksStatus is now the album-tracks dependent call's status
    // when it ran, otherwise the popular-source albums status — these
    // are the two upstreams that gate Popular rendering.
    topTracksStatus: albumTracksRes ? albumTracksRes.status : popAlbumsRes.status,
    topTracksError: albumTracksRes
      ? albumTracksRes.ok
        ? null
        : albumTracksRes.error
      : popAlbumsRes.ok
        ? null
        : popAlbumsRes.error,
    rawTopTracksCount: topTracks.length,
    albumsStatus: discographyRes.status,
    albumsError: discographyRes.ok ? null : discographyRes.error,
    rawAlbumsCount:
      discographyRes.ok &&
      Array.isArray((discographyRes.data as { items?: Album[] })?.items)
        ? (discographyRes.data as { items?: Album[] }).items!.length
        : 0,
    followersField:
      artist.followers === undefined
        ? "missing"
        : artist.followers === null
          ? "null"
          : typeof artist.followers.total === "number"
            ? "ok"
            : "no-total",
  };

  const res = NextResponse.json({
    ok: true,
    id: artist.id ?? id,
    // Always emit a context_uri the panel's Play button can hand to
    // /v1/me/player/play — fall back to the spotify: URI built from
    // the path id so we never ship an empty string here.
    uri: artist.uri ?? `spotify:artist:${id}`,
    name: artist.name ?? "",
    image: pickImage(artist.images, 600),
    followers,
    genres: (artist.genres ?? []).slice(0, 3),
    topTracks,
    albums,
    debug,
  });
  return applyRefreshedSpotifyCookies(res, refreshed);
}
