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

  // Pass `market=US` on every call so region-restricted tracks still
  // get relinked into the response. We removed it briefly in 36.2
  // hoping token-default would work, but that surfaced as the artist
  // discography breaking, so we're back to a fixed ISO code that
  // matches the recruiter's account.
  const headerPath = isAlbum
    ? `/v1/albums/${id}?market=US`
    : `/v1/playlists/${id}?market=US`;
  const tracksPath = isAlbum
    ? `/v1/albums/${id}/tracks?market=US&limit=50`
    : `/v1/playlists/${id}/tracks?market=US&limit=100`;

  // /v1/me runs alongside header + tracks so the response can tell
  // the panel WHO the authenticated Spotify user is. The panel needs
  // owner-vs-me to classify a tracks 403 correctly: a 403 on the
  // recruiter's OWN playlist is an auth/permission issue (the dev-
  // mode policy doesn't restrict apps from reading playlists they
  // own), while a 403 on someone else's playlist is the actual
  // dev-mode restriction. Albums skip this — owner doesn't apply.
  const [headerRes, tracksRes, meRes] = await Promise.all([
    spotifyApiProxy(headerPath),
    spotifyApiProxy(tracksPath),
    isAlbum ? Promise.resolve(null) : spotifyApiProxy("/v1/me"),
  ]);

  const refreshed =
    headerRes.refreshed ?? tracksRes.refreshed ?? meRes?.refreshed ?? null;

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
    owner?: { id?: string; display_name?: string };
    tracks?: { total?: number; items?: (PlaylistTrackEntry | Track | null)[] };
    external_urls?: { spotify?: string };
  };

  // Tracks failure path: keep ok=true with the header we DID get,
  // but surface the upstream HTTP status verbatim (no collapsing 403
  // and 404 into a generic 502). The panel branches messaging off the
  // status + owner-vs-me classification — see classifyPlaylistTracksError
  // in SpotifyPanel.tsx. We DO NOT compose the user-facing message
  // server-side anymore.
  //
  // Embedded-items fallback: when the dedicated `/tracks` endpoint
  // fails (Spotify dev-mode is increasingly 403-ing it on owned
  // playlists too) the header response sometimes still contains
  // `tracks.items[]` populated from the same data path. We harvest
  // those as a last-ditch source so an owned playlist doesn't show
  // "0 songs" just because a single sub-call broke. The brief reports
  // "Lifting" rendering as 0 songs with no error — this fallback is
  // exactly for that case.
  let tracks: ReturnType<typeof projectTrack>[] = [];
  let totalFromTracks = 0;
  let tracksSource: "tracks-endpoint" | "header-embedded" | "none" = "none";
  const tracksStatus: number | null = tracksRes.ok ? null : tracksRes.status;
  const fallbackImages = header.images;
  const fallbackName = header.name ?? "";
  if (tracksRes.ok) {
    const tracksData = tracksRes.data as {
      items?: (PlaylistTrackEntry | Track | null)[];
      total?: number;
    };
    totalFromTracks = tracksData.total ?? 0;
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
    if (tracks.length > 0) tracksSource = "tracks-endpoint";
  } else {
    console.error(
      "[spotify-playlist-tracks] tracks fetch failed",
      tracksRes.status,
      tracksRes.error,
    );
  }

  // Embedded-items fallback when the dedicated /tracks endpoint
  // returned nothing. The header path's tracks.items array is the
  // same shape (PlaylistTrackEntry for playlists, bare Track for
  // albums) so projectTrack handles both forms identically.
  if (tracks.length === 0) {
    const embeddedItems = header.tracks?.items;
    if (Array.isArray(embeddedItems) && embeddedItems.length > 0) {
      tracks = embeddedItems
        .map((entry, idx) => {
          if (!entry) return null;
          const t =
            "track" in (entry as PlaylistTrackEntry)
              ? (entry as PlaylistTrackEntry).track
              : (entry as Track);
          return projectTrack(t, idx, fallbackName, fallbackImages);
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      if (tracks.length > 0) tracksSource = "header-embedded";
    }
  }

  // Authenticated user id — used by the panel's classifyPlaylistTracksError
  // to detect whether the playlist's owner is the recruiter. Null on
  // album requests (we skipped /v1/me there) or if /v1/me itself failed.
  const me =
    meRes && meRes.ok ? (meRes.data as { id?: string }) : null;
  const meId = me?.id ?? null;

  // Diagnostics — truncated raw responses + identity comparison so the
  // recruiter can copy a single console line back when an owned
  // playlist still comes up empty. Vercel logs receive the raw bodies;
  // the client receives the small `debug` envelope on the response.
  console.log(
    "[spotify-playlist-tracks] raw header:",
    headerRes.status,
    JSON.stringify(headerRes.data ?? null).slice(0, 600),
  );
  console.log(
    "[spotify-playlist-tracks] raw tracks:",
    tracksRes.status,
    tracksRes.ok
      ? JSON.stringify(tracksRes.data ?? null).slice(0, 600)
      : `(error) ${tracksRes.error}`,
  );
  console.log(
    "[spotify-playlist-tracks] raw me:",
    meRes ? meRes.status : "(skipped — album)",
    meRes && meRes.ok
      ? JSON.stringify(meRes.data ?? null).slice(0, 200)
      : meRes
        ? `(error) ${meRes.error}`
        : "",
  );
  console.log(
    "[spotify-playlist-tracks] decision:",
    JSON.stringify({
      ownerId: header.owner?.id ?? null,
      meId,
      ownerMatchesMe:
        !!header.owner?.id && !!meId && header.owner.id === meId,
      tracksStatus,
      embeddedItemsCount: Array.isArray(header.tracks?.items)
        ? header.tracks!.items!.length
        : 0,
      projectedTracks: tracks.length,
      tracksSource,
    }),
  );

  // Pick the most accurate trackCount we can. Spotify reports the
  // playlist's total in `header.tracks.total`; if that's missing we
  // fall back to the dedicated /tracks endpoint's total, then to the
  // number of rows we actually projected. Avoids the "5 songs" header
  // line above an empty list when /tracks returned a non-zero total
  // but the embedded items render is what we have.
  const trackCount =
    typeof header.tracks?.total === "number"
      ? header.tracks.total
      : totalFromTracks > 0
        ? totalFromTracks
        : tracks.length;

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
    // Owner id (playlists only) — the panel compares this to meId to
    // decide whether a 403 on /tracks is a dev-mode access issue or
    // an auth/permission issue on the recruiter's own playlist.
    ownerId: isAlbum ? null : header.owner?.id ?? null,
    meId,
    year: isAlbum && header.release_date ? header.release_date.slice(0, 4) : "",
    trackCount,
    tracks,
    tracksStatus,
    externalUrl: header.external_urls?.spotify ?? "",
    // Small client-readable diagnostic. Same fields as the server
    // log's `decision` line so the recruiter can paste either one
    // back if an owned playlist still comes up empty.
    debug: {
      headerStatus: headerRes.status,
      tracksStatus,
      tracksError: tracksRes.ok ? null : tracksRes.error,
      meStatus: meRes ? meRes.status : null,
      meError: meRes && !meRes.ok ? meRes.error : null,
      ownerMatchesMe:
        !!header.owner?.id && !!meId && header.owner.id === meId,
      embeddedItemsCount: Array.isArray(header.tracks?.items)
        ? header.tracks!.items!.length
        : 0,
      projectedTracks: tracks.length,
      tracksSource,
    },
  });
  return applyRefreshedSpotifyCookies(res, refreshed);
}
