import { NextRequest, NextResponse } from "next/server";
import { applyRefreshedSpotifyCookies, spotifyApiProxy } from "@/lib/spotify";

// Playlist / album detail fetch.
//
// The original implementation pulled everything from /v1/playlists/{id}
// (header + embedded tracks). That endpoint started returning empty
// tracks for plenty of legitimate user-saved playlists after Spotify's
// late-2025 changes — the panel showed "0 songs" even with market=US.
//
// We now fetch metadata and tracks in parallel through the dedicated
// sub-endpoint:
//   /v1/playlists/{id}                — header (name, owner, image, total)
//   /v1/playlists/{id}/tracks         — actual tracks
// Same split for albums via /v1/albums/{id} + /v1/albums/{id}/tracks.
// market=US on every call so region-restricted tracks still come
// through.

export const dynamic = "force-dynamic";

type Image = { url?: string; width?: number };
type ArtistRef = { id?: string; name?: string };
type Track = {
  id?: string;
  name?: string;
  uri?: string;
  duration_ms?: number;
  artists?: (ArtistRef | null)[];
  album?: { name?: string; images?: Image[] } | null;
};
type PlaylistTrackEntry = { track?: Track | null };

function pickImage(images: Image[] | undefined, preferred: number): string {
  if (!images || images.length === 0) return "";
  return (
    [...images]
      .filter((i) => i && i.url)
      .sort(
        (a, b) =>
          Math.abs((a.width ?? 0) - preferred) -
          Math.abs((b.width ?? 0) - preferred),
      )[0]?.url ?? ""
  );
}

function projectTrack(
  t: Track | null | undefined,
  idx: number,
  fallbackName: string,
  fallbackImages: Image[] | undefined,
): {
  index: number;
  id: string;
  uri: string;
  name: string;
  artist: string;
  albumName: string;
  albumArt: string;
  durationMs: number;
} | null {
  if (!t || !t.id || !t.uri || !t.name) return null;
  const artist = (t.artists ?? [])
    .map((a) => a?.name)
    .filter((n): n is string => Boolean(n))
    .join(", ");
  return {
    index: idx,
    id: t.id,
    uri: t.uri,
    name: t.name,
    artist,
    albumName: t.album?.name ?? fallbackName ?? "",
    albumArt: pickImage(t.album?.images, 64) || pickImage(fallbackImages, 64),
    durationMs: t.duration_ms ?? 0,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const id = params.id;
  const kind = (new URL(req.url).searchParams.get("kind") ?? "playlist").trim();
  const isAlbum = kind === "album";

  // No `market` parameter: Spotify uses the access-token's profile
  // market and applies track relinking automatically. Hardcoding
  // `market=US` worked for some accounts but caused the panel to render
  // "0 songs" against playlists/albums whose tracks Spotify decided
  // weren't directly available in US — even when the recruiter's own
  // account could play them. Letting Spotify resolve the market off
  // the token is the safe default.
  const headerPath = isAlbum ? `/v1/albums/${id}` : `/v1/playlists/${id}`;
  const tracksPath = isAlbum
    ? `/v1/albums/${id}/tracks?limit=50`
    : `/v1/playlists/${id}/tracks?limit=100`;

  const [headerRes, tracksRes] = await Promise.all([
    spotifyApiProxy(headerPath),
    spotifyApiProxy(tracksPath),
  ]);

  // Whichever sub-call refreshed (at most one will, since both share
  // the cookie state at request entry).
  const refreshed = headerRes.refreshed ?? tracksRes.refreshed;

  if (!headerRes.ok) {
    console.error(
      "[spotify-playlist-tracks] header fetch failed",
      headerRes.status,
      headerRes.error,
    );
    const res = NextResponse.json(
      { ok: false, error: `Header: ${headerRes.error}` },
      { status: headerRes.status === 401 ? 401 : 502 },
    );
    return applyRefreshedSpotifyCookies(res, refreshed);
  }

  const header = headerRes.data as {
    id?: string;
    name?: string;
    uri?: string;
    description?: string;
    images?: Image[];
    artists?: ArtistRef[];
    release_date?: string;
    owner?: { display_name?: string };
    tracks?: { total?: number };
    external_urls?: { spotify?: string };
  };

  // 403 on /v1/playlists/{id}/tracks (and increasingly /albums/{id}/tracks)
  // is the post-Nov-2024 Spotify dev-mode restriction: apps that aren't in
  // "Extended Quota" mode lose API access to Spotify-owned editorial /
  // algorithmic playlists (Made For You, Daily Mix, Today's Top Hits,
  // etc.). Andrew's user-owned playlists still resolve. Rather than
  // strand the panel on a toast and "Loading…" we render the header we
  // *did* get plus a `tracksError` the panel can show inline next to an
  // Open-in-Spotify CTA. Other tracks failures (network, 401, 5xx) take
  // the same code path so the user always sees the upstream reason.
  let tracks: ReturnType<typeof projectTrack>[] = [];
  let totalFromTracks = 0;
  let tracksError: string | null = null;
  if (tracksRes.ok) {
    const tracksData = tracksRes.data as {
      items?: (PlaylistTrackEntry | Track | null)[];
      total?: number;
    };
    totalFromTracks = tracksData.total ?? 0;
    const fallbackImages = header.images;
    const fallbackName = header.name ?? "";
    tracks = (tracksData.items ?? [])
      .map((entry, idx) => {
        if (!entry) return null;
        // Playlist tracks: { track: {...} }. Album tracks: bare Track.
        const t =
          "track" in (entry as PlaylistTrackEntry)
            ? (entry as PlaylistTrackEntry).track
            : (entry as Track);
        return projectTrack(t, idx, fallbackName, fallbackImages);
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  } else {
    console.error(
      "[spotify-playlist-tracks] tracks fetch failed",
      tracksRes.status,
      tracksRes.error,
    );
    tracksError =
      tracksRes.status === 403
        ? "Spotify restricts API access to its editorial and algorithmic playlists. Open the playlist in Spotify to listen."
        : `Spotify ${tracksRes.status}: ${tracksRes.error}`;
  }

  const res = NextResponse.json({
    ok: true,
    kind: isAlbum ? "album" : "playlist",
    id: header.id ?? id,
    uri:
      header.uri ??
      (isAlbum ? `spotify:album:${id}` : `spotify:playlist:${id}`),
    name: header.name ?? "",
    description: header.description ?? "",
    image: pickImage(header.images, 600),
    owner: isAlbum
      ? (header.artists ?? [])
          .map((a) => a?.name)
          .filter((n): n is string => Boolean(n))
          .join(", ")
      : header.owner?.display_name ?? "",
    year: isAlbum && header.release_date ? header.release_date.slice(0, 4) : "",
    trackCount: header.tracks?.total ?? totalFromTracks ?? tracks.length,
    tracks,
    tracksError,
    externalUrl: header.external_urls?.spotify ?? "",
  });
  return applyRefreshedSpotifyCookies(res, refreshed);
}
