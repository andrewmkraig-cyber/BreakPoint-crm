import { NextRequest, NextResponse } from "next/server";
import { applyRefreshedSpotifyCookies, spotifyApiProxy } from "@/lib/spotify";

// Playlist / album detail fetch.
//
// Step A: header             /v1/playlists/{id}        (or /v1/albums/{id})
// Step B: tracks (primary)   /v1/playlists/{id}/tracks?limit=50&offset=0
// Step C: tracks (href)      header.tracks.href            — second-chance
// Step D: tracks (embedded)  header.tracks.items[]         — last-ditch
//
// Each step logs its outcome through spotifyApiProxy's structured
// logger so we can see (in Vercel logs) exactly which Spotify status
// came back. We do NOT convert failures to "0 tracks" — when no
// step yields a real list the response carries `tracksLoaded: false`
// and the upstream status verbatim, so the panel can render error
// state instead of a fake empty list.

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
type TracksPayload = {
  items?: (PlaylistTrackEntry | Track | null)[];
  total?: number;
  href?: string | null;
};

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

function projectItems(
  items: (PlaylistTrackEntry | Track | null)[] | undefined,
  fallbackName: string,
  fallbackImages: Image[] | undefined,
) {
  return (items ?? [])
    .map((entry, idx) => {
      if (!entry) return null;
      const t =
        "track" in (entry as PlaylistTrackEntry)
          ? (entry as PlaylistTrackEntry).track
          : (entry as Track);
      return projectTrack(t, idx, fallbackName, fallbackImages);
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const id = params.id;
  const kind = (new URL(req.url).searchParams.get("kind") ?? "playlist").trim();
  const isAlbum = kind === "album";

  // Step A — header.
  // Albums DO use market=US for region-relinking. Playlists OMIT it
  // on the primary call: 36.x added market=US for relinking but it
  // turned out to make some owned playlists return as if they had
  // no tracks. Leaving it off matches what Spotify's own clients
  // send by default for playlist details.
  const headerPath = isAlbum
    ? `/v1/albums/${id}?market=US`
    : `/v1/playlists/${id}`;

  // Albums skip the /me call — owner doesn't apply.
  const [headerRes, meRes] = await Promise.all([
    spotifyApiProxy(headerPath, {
      tag: isAlbum ? "album/header" : "playlist/header",
    }),
    isAlbum
      ? Promise.resolve(null)
      : spotifyApiProxy("/v1/me", { tag: "playlist/me" }),
  ]);

  let refreshed = headerRes.refreshed ?? meRes?.refreshed ?? null;

  if (!headerRes.ok) {
    const res = NextResponse.json(
      {
        ok: false,
        error: `Header: ${headerRes.error}`,
        status: headerRes.status,
      },
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
    tracks?: TracksPayload;
    external_urls?: { spotify?: string };
  };

  const fallbackImages = header.images;
  const fallbackName = header.name ?? "";

  // Step B — primary /tracks fetch. Albums use market=US (region-
  // relink). Playlists deliberately OMIT market.
  const tracksPath = isAlbum
    ? `/v1/albums/${id}/tracks?market=US&limit=50&offset=0`
    : `/v1/playlists/${id}/tracks?limit=50&offset=0`;
  const tracksRes = await spotifyApiProxy(tracksPath, {
    tag: isAlbum ? "album/tracks" : "playlist/tracks-primary",
  });
  refreshed = refreshed ?? tracksRes.refreshed ?? null;

  let tracks: ReturnType<typeof projectItems> = [];
  let tracksTotal: number | null = null;
  let tracksSource: "primary" | "href" | "embedded" | "none" = "none";
  // The status that drove the user-visible classification — primary
  // by default, but if a fallback succeeds we report null because
  // tracks did load.
  let tracksStatus: number | null = tracksRes.ok ? null : tracksRes.status;

  if (tracksRes.ok) {
    const data = tracksRes.data as TracksPayload;
    tracksTotal = typeof data.total === "number" ? data.total : null;
    tracks = projectItems(data.items, fallbackName, fallbackImages);
    tracksSource = "primary";
  }

  // Step C — href fallback. Header carries tracks.href which is the
  // same endpoint; trying it directly sometimes succeeds when our
  // own constructed URL doesn't (different default query params).
  // Only run when the primary failed AND href differs from what we
  // already tried, to avoid re-firing the same failing call.
  if (
    !tracksRes.ok &&
    !isAlbum &&
    typeof header.tracks?.href === "string" &&
    header.tracks.href.includes("/tracks")
  ) {
    const hrefRes = await spotifyApiProxy(header.tracks.href, {
      tag: "playlist/tracks-href",
    });
    refreshed = refreshed ?? hrefRes.refreshed ?? null;
    if (hrefRes.ok) {
      const data = hrefRes.data as TracksPayload;
      tracksTotal = typeof data.total === "number" ? data.total : tracksTotal;
      tracks = projectItems(data.items, fallbackName, fallbackImages);
      if (tracks.length > 0) {
        tracksSource = "href";
        tracksStatus = null;
      }
    }
  }

  // Step D — embedded fallback. Header sometimes carries tracks.items
  // populated even when /tracks fails. Last-ditch source so an owned
  // playlist with a known-good header doesn't render empty just
  // because a single sub-call broke.
  if (tracks.length === 0 && Array.isArray(header.tracks?.items)) {
    const projected = projectItems(
      header.tracks!.items as (PlaylistTrackEntry | Track | null)[],
      fallbackName,
      fallbackImages,
    );
    if (projected.length > 0) {
      tracks = projected;
      tracksSource = "embedded";
      tracksStatus = null;
    }
  }

  // Authenticated user id — drives the panel's owner-vs-me check for
  // 403 classification. Null on album requests or if /me failed.
  const me = meRes && meRes.ok ? (meRes.data as { id?: string }) : null;
  const meId = me?.id ?? null;

  // Spotify-confirmed total: only when the header explicitly returned
  // a numeric tracks.total OR the /tracks endpoint did. Anything else
  // is unknown — UI must NOT fall back to "0 songs" on unknown.
  const headerTotal =
    typeof header.tracks?.total === "number" ? header.tracks.total : null;
  const trackCount =
    headerTotal ?? tracksTotal ?? (tracksSource !== "none" ? tracks.length : 0);
  const trackCountKnown = headerTotal !== null || tracksTotal !== null;

  // tracksLoaded: true iff at least one source produced a definitive
  // list. The "primary" source counts even when items=[] (Spotify
  // confirmed empty). False only when every step failed.
  const tracksLoaded = tracksSource !== "none";

  // Decision summary — single-line structured log so we can grep
  // Vercel for the post-fetch state.
  console.log(
    "[spotify-playlist-tracks]",
    JSON.stringify({
      kind: isAlbum ? "album" : "playlist",
      id,
      headerStatus: headerRes.status,
      tracksStatus,
      tracksSource,
      ownerId: header.owner?.id ?? null,
      meId,
      ownerMatchesMe:
        !!header.owner?.id && !!meId && header.owner.id === meId,
      headerTracksTotal: headerTotal,
      hrefPresent: typeof header.tracks?.href === "string",
      embeddedItemsCount: Array.isArray(header.tracks?.items)
        ? header.tracks!.items!.length
        : 0,
      projectedTracks: tracks.length,
      trackCount,
      trackCountKnown,
      tracksLoaded,
    }),
  );

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
    ownerId: isAlbum ? null : header.owner?.id ?? null,
    meId,
    year: isAlbum && header.release_date ? header.release_date.slice(0, 4) : "",
    trackCount,
    trackCountKnown,
    tracksLoaded,
    tracks,
    tracksStatus,
    externalUrl: header.external_urls?.spotify ?? "",
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
      trackCountKnown,
      tracksLoaded,
    },
  });
  return applyRefreshedSpotifyCookies(res, refreshed);
}
