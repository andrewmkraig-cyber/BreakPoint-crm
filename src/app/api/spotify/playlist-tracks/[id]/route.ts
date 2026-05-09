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
// Step A: header        /v1/playlists/{id}        (or /v1/albums/{id})
// Step B: items         /v1/playlists/{id}/items?limit=50&offset=0
//                       &market={country}&additional_types=track
//                       (PLAYLISTS ONLY — Spotify's current canonical
//                       playlist-items endpoint; the older
//                       /v1/playlists/{id}/tracks 403s on owned
//                       playlists in dev-mode for some accounts.)
// Step B': tracks       /v1/playlists/{id}/tracks?limit=50&offset=0
//                       (PLAYLISTS — fallback only, when /items fails)
//                       /v1/albums/{id}/tracks?limit=50&offset=0&market
//                       (ALBUMS — primary; albums don't have /items)
// Step C: tracks (href) header.tracks.href            — second-chance
// Step D: tracks (embedded) header.tracks.items[]     — last-ditch
//
// Every request emits ONE [spotify-playlist-tracks result] line via a
// finally block, regardless of which path was taken (header fail,
// tracks fail, or full success). The line carries hasToken,
// headerStatus, primaryItemsStatus, fallbackTracksStatus,
// hrefTracksStatus, tracksSource, trackCount, tracksLoaded, plus a
// sanitized error string for the last failed stage. Greppable from
// Vercel without joining multiple log lines.

export const dynamic = "force-dynamic";

type Image = { url?: string; width?: number };
type ArtistRef = { id?: string; name?: string };
type Track = {
  id?: string;
  name?: string;
  uri?: string;
  type?: string;
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

type ProjectedTrack = {
  index: number;
  id: string;
  uri: string;
  name: string;
  artist: string;
  albumName: string;
  albumArt: string;
  durationMs: number;
};

type ProjectionCounts = {
  itemsReceived: number;
  nullTrackItems: number;
  nonTrackItems: number;
  missingUriItems: number;
  mappedTracks: number;
};

type ProjectionResult = {
  tracks: ProjectedTrack[];
  counts: ProjectionCounts;
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

// Spotify URIs are colon-delimited (`spotify:track:abc`). When `id` is
// absent we derive it from the URI tail so the UI still has a stable
// identifier to key on.
function deriveIdFromUri(uri: string): string {
  const parts = uri.split(":");
  return parts[parts.length - 1] ?? "";
}

// Project /v1/playlists/{id}/items (and /v1/albums/{id}/tracks, and the
// legacy /tracks shape) into Ace's flat track row.
//
// Normalization: every row is run through `item?.track ?? item`. Playlist
// items wrap the track (`{ added_at, track: {...} }`); album tracks and
// the legacy /tracks shape don't. The `??` collapses both into a single
// path. If `item.track` is explicitly `null` (Spotify's marker for an
// unavailable track in a playlist), we count it as nullTrack and skip
// rather than falling through to the wrapper.
//
// Skip ONLY:
//   - entry is null/undefined
//   - entry.track is explicitly null (unavailable track marker)
//   - track.type is set and not "track" (episodes etc.)
//   - BOTH track.uri and track.id are missing — uri is the canonical
//     queue handle, but when uri is absent we synthesize it from id
//     using Spotify's `spotify:track:${id}` URI grammar.
function projectItems(
  items: (PlaylistTrackEntry | Track | null)[] | undefined,
  fallbackName: string,
  fallbackImages: Image[] | undefined,
): ProjectionResult {
  const counts: ProjectionCounts = {
    itemsReceived: 0,
    nullTrackItems: 0,
    nonTrackItems: 0,
    missingUriItems: 0,
    mappedTracks: 0,
  };
  const list = items ?? [];
  const tracks: ProjectedTrack[] = [];

  for (let idx = 0; idx < list.length; idx++) {
    counts.itemsReceived += 1;
    const item = list[idx] as
      | (PlaylistTrackEntry & Track)
      | null
      | undefined;
    if (!item) {
      counts.nullTrackItems += 1;
      continue;
    }
    // Spotify uses `track: null` to mark unavailable tracks in a
    // playlist (deleted/region-locked). Detect that explicitly so we
    // don't fall through to the wrapper.
    if ((item as PlaylistTrackEntry).track === null) {
      counts.nullTrackItems += 1;
      continue;
    }
    const track: Track =
      ((item as PlaylistTrackEntry).track as Track | undefined) ??
      (item as Track);
    if (typeof track.type === "string" && track.type !== "track") {
      counts.nonTrackItems += 1;
      continue;
    }
    if (!track.uri && !track.id) {
      counts.missingUriItems += 1;
      continue;
    }
    const uri = track.uri ?? `spotify:track:${track.id}`;
    const id = track.id ?? deriveIdFromUri(uri);
    const name = track.name ?? "Unknown title";
    const artist = (track.artists ?? [])
      .map((a) => a?.name)
      .filter((n): n is string => Boolean(n))
      .join(", ");
    tracks.push({
      index: idx,
      id,
      uri,
      name,
      artist,
      albumName: track.album?.name ?? fallbackName ?? "",
      albumArt:
        pickImage(track.album?.images, 64) || pickImage(fallbackImages, 64),
      durationMs: track.duration_ms ?? 0,
    });
    counts.mappedTracks += 1;
  }

  return { tracks, counts };
}

// One-shot diagnostic: dump the keys (and a uri/id snippet) from the
// first entry of an items array so we can confirm Spotify's actual
// response shape from Vercel logs without leaking PII.
function logFirstItemShape(
  tag: string,
  items: unknown[] | undefined,
): void {
  if (!items || items.length === 0) return;
  const first = items[0];
  if (!first || typeof first !== "object") {
    console.log(
      "[spotify-playlist-tracks shape]",
      JSON.stringify({ tag, kind: typeof first }),
    );
    return;
  }
  const outerKeys = Object.keys(first as Record<string, unknown>);
  const wrapped = (first as { track?: unknown }).track;
  const innerKeys =
    wrapped && typeof wrapped === "object"
      ? Object.keys(wrapped as Record<string, unknown>)
      : null;
  const innerHasUri =
    wrapped && typeof wrapped === "object"
      ? "uri" in (wrapped as Record<string, unknown>)
      : false;
  const innerHasId =
    wrapped && typeof wrapped === "object"
      ? "id" in (wrapped as Record<string, unknown>)
      : false;
  console.log(
    "[spotify-playlist-tracks shape]",
    JSON.stringify({
      tag,
      outerKeys,
      hasTrackKey: "track" in (first as Record<string, unknown>),
      trackIsNull: wrapped === null,
      innerKeys,
      innerHasUri,
      innerHasId,
    }),
  );
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
    primaryItemsStatus: number | null;
    fallbackTracksStatus: number | null;
    hrefTracksStatus: number | null;
    embeddedItemsCount: number;
    tracksSource:
      | "items"
      | "tracks"
      | "href"
      | "embedded"
      | "none";
    trackCount: number | null;
    trackCountKnown: boolean;
    tracksLoaded: boolean;
    ownerMatchesMe: boolean;
    market: string | null;
    error: string | null;
    errorBody: string | null;
  } = {
    kind: isAlbum ? "album" : "playlist",
    id,
    hasToken,
    headerStatus: null,
    primaryItemsStatus: null,
    fallbackTracksStatus: null,
    hrefTracksStatus: null,
    embeddedItemsCount: 0,
    tracksSource: "none",
    trackCount: null,
    trackCountKnown: false,
    tracksLoaded: false,
    ownerMatchesMe: false,
    market: null,
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

    // Country code drives `market` on the items/tracks fetches so
    // region-restricted tracks relink to the user's region. Read from
    // /v1/me when available, default US.
    const meCountryRaw =
      meRes && meRes.ok ? (meRes.data as { country?: string }).country : null;
    const market =
      typeof meCountryRaw === "string" && meCountryRaw.length === 2
        ? meCountryRaw
        : "US";
    summary.market = market;

    // Step B — primary fetch.
    //
    // Playlists: /v1/playlists/{id}/items?additional_types=track is
    // Spotify's current canonical endpoint. The older /tracks endpoint
    // 403s on some owned playlists in dev-mode (confirmed via Vercel
    // logs: tracksStatus 403 with ownerMatchesMe true). additional_types=track
    // explicitly opts out of episodes — we don't render those.
    //
    // Albums: /v1/albums/{id}/tracks (no /items endpoint exists).
    // `fields=` explicitly enumerates every track property the mapper
    // reads. Without it, Spotify's /items endpoint has been observed
    // returning track objects without `uri` for entire pages — the
    // explicit field list forces uri+id+name+type+artists+album+
    // duration_ms back into the response. URL-encoded because the
    // fields grammar uses parens and commas.
    const playlistItemFields = encodeURIComponent(
      "items(track(id,uri,name,type,artists(id,name),album(name,images),duration_ms,external_urls,is_local)),total,next",
    );
    const primaryPath = isAlbum
      ? `/v1/albums/${id}/tracks?limit=50&offset=0&market=${market}`
      : `/v1/playlists/${id}/items?limit=50&offset=0&market=${market}&additional_types=track&fields=${playlistItemFields}`;
    const primaryRes = await spotifyApiProxy(primaryPath, {
      tag: isAlbum ? "album/tracks" : "playlist/items-primary",
    });
    summary.primaryItemsStatus = primaryRes.status;
    log403IfApplicable(
      isAlbum ? "album/tracks" : "playlist/items-primary",
      primaryPath,
      primaryRes,
      hasToken,
    );
    refreshed = refreshed ?? primaryRes.refreshed ?? null;

    let tracks: ProjectedTrack[] = [];
    let tracksTotal: number | null = null;
    let tracksSource: "items" | "tracks" | "href" | "embedded" | "none" =
      "none";
    let tracksStatus: number | null = primaryRes.ok ? null : primaryRes.status;
    let lastTracksError: { msg: string; body: unknown } | null = primaryRes.ok
      ? null
      : { msg: primaryRes.error, body: primaryRes.body };

    // Per-attempt mapper counts. Surfaced in `debug` so a "200 but zero
    // tracks" condition is diagnosable from the response body alone.
    let primaryCounts: ProjectionCounts | null = null;
    let fallbackCounts: ProjectionCounts | null = null;
    let hrefCounts: ProjectionCounts | null = null;
    let embeddedCounts: ProjectionCounts | null = null;

    // Per-attempt upstream snapshots — surfaced verbatim in the JSON
    // response so the recruiter can see Spotify's exact reason in the
    // browser Network tab without trawling Vercel logs. Bodies run
    // through sanitizeBody (clipped, no tokens — Spotify never puts
    // tokens in error bodies anyway).
    const upstreamPrimary = primaryRes.ok
      ? null
      : {
          status: primaryRes.status,
          error: primaryRes.error,
          body: sanitizeBody(primaryRes.body),
        };
    let upstreamFallback: {
      status: number;
      error: string;
      body: string;
    } | null = null;
    let upstreamHref: {
      status: number;
      error: string;
      body: string;
    } | null = null;

    if (primaryRes.ok) {
      const data = primaryRes.data as TracksPayload;
      tracksTotal = typeof data.total === "number" ? data.total : null;
      logFirstItemShape(
        isAlbum ? "album/tracks" : "playlist/items-primary",
        data.items as unknown[] | undefined,
      );
      const projection = projectItems(data.items, fallbackName, fallbackImages);
      tracks = projection.tracks;
      primaryCounts = projection.counts;
      tracksSource = isAlbum ? "tracks" : "items";
    }

    // Step B' — playlists only: fall back to the legacy /tracks
    // endpoint when /items fails. Some accounts/playlists still
    // succeed on /tracks even when /items is the documented current
    // path — try it before giving up.
    if (!primaryRes.ok && !isAlbum) {
      const fallbackPath = `/v1/playlists/${id}/tracks?limit=50&offset=0&market=${market}&fields=${playlistItemFields}`;
      const fallbackRes = await spotifyApiProxy(fallbackPath, {
        tag: "playlist/tracks-fallback",
      });
      summary.fallbackTracksStatus = fallbackRes.status;
      log403IfApplicable(
        "playlist/tracks-fallback",
        fallbackPath,
        fallbackRes,
        hasToken,
      );
      refreshed = refreshed ?? fallbackRes.refreshed ?? null;
      if (fallbackRes.ok) {
        const data = fallbackRes.data as TracksPayload;
        tracksTotal = typeof data.total === "number" ? data.total : tracksTotal;
        logFirstItemShape(
          "playlist/tracks-fallback",
          data.items as unknown[] | undefined,
        );
        const projection = projectItems(
          data.items,
          fallbackName,
          fallbackImages,
        );
        tracks = projection.tracks;
        fallbackCounts = projection.counts;
        tracksSource = "tracks";
        tracksStatus = null;
        lastTracksError = null;
      } else {
        lastTracksError = { msg: fallbackRes.error, body: fallbackRes.body };
        upstreamFallback = {
          status: fallbackRes.status,
          error: fallbackRes.error,
          body: sanitizeBody(fallbackRes.body),
        };
      }
    }

    // Step C — href fallback. Only fires when both primary AND
    // fallback already failed.
    if (
      tracksSource === "none" &&
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
        logFirstItemShape(
          "playlist/tracks-href",
          data.items as unknown[] | undefined,
        );
        const projection = projectItems(
          data.items,
          fallbackName,
          fallbackImages,
        );
        hrefCounts = projection.counts;
        if (projection.tracks.length > 0) {
          tracks = projection.tracks;
          tracksSource = "href";
          tracksStatus = null;
          lastTracksError = null;
        }
      } else {
        lastTracksError = { msg: hrefRes.error, body: hrefRes.body };
        upstreamHref = {
          status: hrefRes.status,
          error: hrefRes.error,
          body: sanitizeBody(hrefRes.body),
        };
      }
    }

    // Step D — embedded fallback.
    if (tracks.length === 0 && Array.isArray(header.tracks?.items)) {
      logFirstItemShape(
        "playlist/tracks-embedded",
        header.tracks!.items as unknown[],
      );
      const projection = projectItems(
        header.tracks!.items as (PlaylistTrackEntry | Track | null)[],
        fallbackName,
        fallbackImages,
      );
      embeddedCounts = projection.counts;
      if (projection.tracks.length > 0) {
        tracks = projection.tracks;
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
    let tracksLoaded = tracksSource !== "none";

    // Mapper guard: if Spotify returned items but our projection
    // dropped every one of them, surface that as a distinct failure
    // mode so the UI doesn't sit on tracksLoaded:true with an empty
    // array. Pick the counts from whichever attempt produced items
    // most recently — primary first, then fallback, href, embedded.
    const lastCounts: ProjectionCounts | null =
      embeddedCounts ?? hrefCounts ?? fallbackCounts ?? primaryCounts;
    let mapperError: string | null = null;
    if (
      trackCount > 0 &&
      lastCounts &&
      lastCounts.itemsReceived > 0 &&
      lastCounts.mappedTracks === 0
    ) {
      tracksLoaded = false;
      mapperError =
        `Projection dropped every item: itemsReceived=${lastCounts.itemsReceived}, ` +
        `nullTrack=${lastCounts.nullTrackItems}, nonTrack=${lastCounts.nonTrackItems}, ` +
        `missingUri=${lastCounts.missingUriItems}, mapped=${lastCounts.mappedTracks}`;
    }

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
      mapperError,
      // Per-attempt upstream snapshots — visible directly in the
      // browser Network tab when /items / /tracks / href all fail.
      // null when the attempt succeeded (or wasn't run at all).
      tracksUpstream: {
        primary: upstreamPrimary,
        fallback: upstreamFallback,
        href: upstreamHref,
      },
      market,
      externalUrl: header.external_urls?.spotify ?? "",
      debug: {
        headerStatus: headerRes.status,
        primaryItemsStatus: summary.primaryItemsStatus,
        fallbackTracksStatus: summary.fallbackTracksStatus,
        hrefTracksStatus: summary.hrefTracksStatus,
        market,
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
        mapperError,
        mapperCounts: {
          primary: primaryCounts,
          fallback: fallbackCounts,
          href: hrefCounts,
          embedded: embeddedCounts,
        },
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
