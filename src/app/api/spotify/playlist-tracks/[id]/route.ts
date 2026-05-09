import { NextRequest, NextResponse } from "next/server";
import {
  applyRefreshedSpotifyCookies,
  getValidSpotifyAccessToken,
  spotifyApiProxy,
  type SpotifyApiResult,
} from "@/lib/spotify";

// Pull JUST the human-readable Spotify error message from a parsed
// error body. Spotify's shape is `{ error: { status, message } }` on
// REST endpoints. Strings are passed through truncated; anything else
// JSON-stringified, all clipped to 400 chars. No tokens, headers, or
// auth-bearing URLs ever land in the body so this is safe to log raw.
function sanitizeBody(body: unknown): string {
  if (body == null) return "(empty)";
  if (typeof body === "string") return body.slice(0, 400);
  if (typeof body === "object") {
    try {
      return JSON.stringify(body).slice(0, 400);
    } catch {
      return "(unserializable)";
    }
  }
  return String(body).slice(0, 400);
}

// Strip host + access_token query param from any Spotify path/URL so
// it's safe to log. We never put tokens in the URL ourselves but a
// `next`/`href` field returned by Spotify could in principle embed
// one — defensive scrub.
function safePath(p: string): string {
  try {
    const u = p.startsWith("http")
      ? new URL(p)
      : new URL(p, "https://api.spotify.com");
    u.searchParams.delete("access_token");
    return `${u.pathname}${u.search}`;
  } catch {
    return p.split("?")[0] ?? p;
  }
}

// Single chokepoint for emitting 403 diagnostics from this route.
// Always called after each fetch; only emits when the upstream really
// was 403 (other statuses still show up in the result line below and
// in spotifyApiProxy's per-call log). Never logs tokens, cookies, or
// auth headers.
function log403IfApplicable(
  tag: string,
  path: string,
  result: SpotifyApiResult,
  hasToken: boolean,
): void {
  if (result.ok || result.status !== 403) return;
  console.log(
    "[spotify-playlist-tracks 403]",
    JSON.stringify({
      tag,
      endpoint: safePath(path),
      hasToken,
      status: 403,
      error: result.error,
      body: sanitizeBody(result.body),
    }),
  );
}

// Playlist / album detail fetch.
//
// Step A: header             /v1/playlists/{id}        (or /v1/albums/{id})
// Step B: tracks (primary)   /v1/playlists/{id}/tracks?limit=50&offset=0
// Step C: tracks (href)      header.tracks.href            — second-chance
// Step D: tracks (embedded)  header.tracks.items[]         — last-ditch
//
// Every request emits ONE [spotify-playlist-tracks result] line via a
// finally block, regardless of which path was taken (header fail,
// tracks fail, or full success). The line carries hasToken,
// headerStatus, primaryTracksStatus, hrefTracksStatus, tracksSource,
// trackCount, tracksLoaded, plus a sanitized error string for the
// last failed stage. Greppable from Vercel without joining multiple
// log lines.

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

  // Token probe — runs the same auth resolver every spotifyApiProxy
  // call uses, just to surface whether the request EVER had a usable
  // token before any Spotify call ran. Logged once before any other
  // work so a 401 cluster can be triaged immediately.
  const tokenProbe = await getValidSpotifyAccessToken();
  const hasToken = tokenProbe.ok;
  console.log(
    "[spotify-playlist-tracks token]",
    JSON.stringify({
      kind: isAlbum ? "album" : "playlist",
      id,
      hasToken,
      tokenError: tokenProbe.ok ? null : tokenProbe.error,
    }),
  );

  // Result accumulator — populated as we go, logged unconditionally
  // in the finally block below so even an early-return path produces
  // one [...result] line.
  const summary: {
    kind: "album" | "playlist";
    id: string;
    hasToken: boolean;
    headerStatus: number | null;
    primaryTracksStatus: number | null;
    hrefTracksStatus: number | null;
    embeddedItemsCount: number;
    tracksSource: "primary" | "href" | "embedded" | "none";
    trackCount: number | null;
    trackCountKnown: boolean;
    tracksLoaded: boolean;
    ownerMatchesMe: boolean;
    error: string | null;
    errorBody: string | null;
  } = {
    kind: isAlbum ? "album" : "playlist",
    id,
    hasToken,
    headerStatus: null,
    primaryTracksStatus: null,
    hrefTracksStatus: null,
    embeddedItemsCount: 0,
    tracksSource: "none",
    trackCount: null,
    trackCountKnown: false,
    tracksLoaded: false,
    ownerMatchesMe: false,
    error: null,
    errorBody: null,
  };

  try {
    // Step A — header.
    // Albums use market=US (region-relinking). Playlists OMIT it on
    // the primary call: 36.x added market=US for relinking but it
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
    summary.headerStatus = headerRes.status;
    log403IfApplicable(
      isAlbum ? "album/header" : "playlist/header",
      headerPath,
      headerRes,
      hasToken,
    );

    let refreshed = headerRes.refreshed ?? meRes?.refreshed ?? null;

    if (!headerRes.ok) {
      summary.error = headerRes.error;
      summary.errorBody = sanitizeBody(headerRes.body);
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

    summary.embeddedItemsCount = Array.isArray(header.tracks?.items)
      ? header.tracks!.items!.length
      : 0;

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
    summary.primaryTracksStatus = tracksRes.status;
    log403IfApplicable(
      isAlbum ? "album/tracks" : "playlist/tracks-primary",
      tracksPath,
      tracksRes,
      hasToken,
    );
    refreshed = refreshed ?? tracksRes.refreshed ?? null;

    let tracks: ReturnType<typeof projectItems> = [];
    let tracksTotal: number | null = null;
    let tracksSource: "primary" | "href" | "embedded" | "none" = "none";
    let tracksStatus: number | null = tracksRes.ok ? null : tracksRes.status;
    let lastTracksError: { msg: string; body: unknown } | null = tracksRes.ok
      ? null
      : { msg: tracksRes.error, body: tracksRes.body };

    if (tracksRes.ok) {
      const data = tracksRes.data as TracksPayload;
      tracksTotal = typeof data.total === "number" ? data.total : null;
      tracks = projectItems(data.items, fallbackName, fallbackImages);
      tracksSource = "primary";
    }

    // Step C — href fallback.
    if (
      !tracksRes.ok &&
      !isAlbum &&
      typeof header.tracks?.href === "string" &&
      header.tracks.href.includes("/tracks")
    ) {
      const hrefRes = await spotifyApiProxy(header.tracks.href, {
        tag: "playlist/tracks-href",
      });
      summary.hrefTracksStatus = hrefRes.status;
      log403IfApplicable(
        "playlist/tracks-href",
        header.tracks.href,
        hrefRes,
        hasToken,
      );
      refreshed = refreshed ?? hrefRes.refreshed ?? null;
      if (hrefRes.ok) {
        const data = hrefRes.data as TracksPayload;
        tracksTotal = typeof data.total === "number" ? data.total : tracksTotal;
        tracks = projectItems(data.items, fallbackName, fallbackImages);
        if (tracks.length > 0) {
          tracksSource = "href";
          tracksStatus = null;
          lastTracksError = null;
        }
      } else {
        lastTracksError = { msg: hrefRes.error, body: hrefRes.body };
      }
    }

    // Step D — embedded fallback.
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
        lastTracksError = null;
      }
    }

    summary.tracksSource = tracksSource;

    const me = meRes && meRes.ok ? (meRes.data as { id?: string }) : null;
    const meId = me?.id ?? null;
    summary.ownerMatchesMe =
      !!header.owner?.id && !!meId && header.owner.id === meId;

    const headerTotal =
      typeof header.tracks?.total === "number" ? header.tracks.total : null;
    const trackCount =
      headerTotal ?? tracksTotal ?? (tracksSource !== "none" ? tracks.length : 0);
    const trackCountKnown = headerTotal !== null || tracksTotal !== null;
    const tracksLoaded = tracksSource !== "none";

    summary.trackCount = trackCount;
    summary.trackCountKnown = trackCountKnown;
    summary.tracksLoaded = tracksLoaded;
    if (lastTracksError) {
      summary.error = lastTracksError.msg;
      summary.errorBody = sanitizeBody(lastTracksError.body);
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
      ownerId: isAlbum ? null : header.owner?.id ?? null,
      meId,
      year:
        isAlbum && header.release_date ? header.release_date.slice(0, 4) : "",
      trackCount,
      trackCountKnown,
      tracksLoaded,
      tracks,
      tracksStatus,
      tracksError: lastTracksError ? lastTracksError.msg : null,
      externalUrl: header.external_urls?.spotify ?? "",
      debug: {
        headerStatus: headerRes.status,
        tracksStatus,
        tracksError: lastTracksError ? lastTracksError.msg : null,
        meStatus: meRes ? meRes.status : null,
        meError: meRes && !meRes.ok ? meRes.error : null,
        ownerMatchesMe: summary.ownerMatchesMe,
        embeddedItemsCount: summary.embeddedItemsCount,
        projectedTracks: tracks.length,
        tracksSource,
        trackCountKnown,
        tracksLoaded,
      },
    });
    return applyRefreshedSpotifyCookies(res, refreshed);
  } catch (e) {
    summary.error =
      e instanceof Error ? e.message : "Unknown error in playlist-tracks route";
    // Return a 502 so the panel can render error state. The finally
    // block still emits the [...result] line below.
    return NextResponse.json(
      { ok: false, error: summary.error },
      { status: 502 },
    );
  } finally {
    console.log(
      "[spotify-playlist-tracks result]",
      JSON.stringify(summary),
    );
  }
}
