import { NextResponse } from "next/server";
import { applyRefreshedSpotifyCookies, spotifyApiProxy } from "@/lib/spotify";

// GET /me/player/recently-played — used by the home screen's
// horizontal-scroll "Recently Played" row. Spotify returns play
// history items wrapping `track` objects; we flatten + dedupe by
// track id so the same song heard twice in a row only shows once.
//
// Recency-derived sidecar fields (added 2026-05-09):
//   - recentPlaylistIds: unique playlist context IDs in recency order,
//     capped at 10. Spotify has no "recently played playlists" API, so
//     this is the closest we can get — playlist contexts of recently
//     played tracks. Items with non-playlist contexts (album, artist,
//     null) don't contribute. The panel uses these IDs to assemble a
//     "Recently played playlists" home section and to prioritize the
//     Library Playlists tab; metadata is resolved either from the
//     user's already-loaded playlists list or via /playlists-meta.
//   - recentArtists: unique artists in recency order, capped at 10,
//     each hydrated with image via a single batched /v1/artists call.
//     Same caveat — derived from recently played track artists, not a
//     personalized "your top artists" ranking.

export const dynamic = "force-dynamic";

const MAX_RECENT_PLAYLISTS = 10;
const MAX_RECENT_ARTISTS = 10;
const PLAYLIST_URI_RE = /^spotify:playlist:([A-Za-z0-9]+)$/;

type Image = { url?: string; width?: number };
type ArtistRef = { id?: string; name?: string };
type Track = {
  id?: string;
  name?: string;
  uri?: string;
  duration_ms?: number;
  artists?: ArtistRef[];
  album?: { id?: string; name?: string; uri?: string; images?: Image[] };
};
type Context = {
  type?: string;
  uri?: string;
} | null;
type RecentItem = { track?: Track; context?: Context };

type ArtistDetails = {
  id?: string;
  uri?: string;
  name?: string;
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

// Pulls unique playlist IDs out of recently-played items. Each item's
// `context` is either null or an object with `type` + `uri`. We only
// keep `playlist` contexts. Recency order is preserved; the first
// occurrence of an ID wins.
function deriveRecentPlaylistIds(items: RecentItem[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (out.length >= MAX_RECENT_PLAYLISTS) break;
    const ctx = item.context;
    if (!ctx || ctx.type !== "playlist" || typeof ctx.uri !== "string") continue;
    const m = PLAYLIST_URI_RE.exec(ctx.uri);
    if (!m) continue;
    const id = m[1];
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

// Walks recently-played items collecting unique artist IDs across
// every track's artists[] in recency order. The first occurrence of
// an ID wins, so a featured artist on track #1 still ranks higher
// than a primary artist on track #5.
function deriveRecentArtistIds(items: RecentItem[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (out.length >= MAX_RECENT_ARTISTS) break;
    const artists = item.track?.artists ?? [];
    for (const a of artists) {
      if (out.length >= MAX_RECENT_ARTISTS) break;
      if (!a?.id) continue;
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      out.push(a.id);
    }
  }
  return out;
}

// Hydrates the recent artist IDs via a single /v1/artists?ids=… call
// (max 50 per request — we cap at 10). Returns artists in the same
// order as the input IDs. Fail-soft: a 4xx/5xx returns an empty list
// rather than throwing, so the recently-played payload still ships.
async function hydrateRecentArtists(
  ids: string[],
): Promise<{
  artists: { id: string; uri: string; name: string; image: string }[];
  refreshed: ReturnType<typeof Object> | null;
}> {
  if (ids.length === 0) return { artists: [], refreshed: null };
  const result = await spotifyApiProxy(
    `/v1/artists?ids=${encodeURIComponent(ids.join(","))}`,
    { tag: "artists/batch" },
  );
  if (!result.ok) {
    return { artists: [], refreshed: result.refreshed };
  }
  const items = ((result.data as { artists?: ArtistDetails[] })?.artists ?? [])
    .map((a) => {
      if (!a?.id || !a.uri || !a.name) return null;
      return {
        id: a.id,
        uri: a.uri,
        name: a.name,
        image: pickImage(a.images, 300),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  // Spotify usually preserves input order, but we re-sort defensively
  // so the panel's recency-first contract isn't load-bearing on
  // upstream behavior.
  const byId = new Map(items.map((a) => [a.id, a]));
  const ordered = ids
    .map((id) => byId.get(id))
    .filter((a): a is NonNullable<typeof a> => a !== undefined);
  return { artists: ordered, refreshed: result.refreshed };
}

export async function GET() {
  const result = await spotifyApiProxy(
    "/v1/me/player/recently-played?limit=50",
  );
  if (!result.ok) {
    const res = NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status === 401 ? 401 : 502 },
    );
    return applyRefreshedSpotifyCookies(res, result.refreshed);
  }

  const rawItems =
    (result.data as { items?: RecentItem[] })?.items ?? [];

  const seenTracks = new Set<string>();
  const tracks = rawItems
    .map((item) => {
      const t = item.track;
      if (!t?.id || !t.uri || !t.name) return null;
      if (seenTracks.has(t.id)) return null;
      seenTracks.add(t.id);
      return {
        id: t.id,
        uri: t.uri,
        name: t.name,
        artist: (t.artists ?? []).map((a) => a.name).filter(Boolean).join(", "),
        albumName: t.album?.name ?? "",
        albumId: t.album?.id ?? "",
        albumUri: t.album?.uri ?? "",
        albumArt: pickImage(t.album?.images, 300),
        durationMs: t.duration_ms ?? 0,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const recentPlaylistIds = deriveRecentPlaylistIds(rawItems);
  const recentArtistIds = deriveRecentArtistIds(rawItems);
  const { artists: recentArtists, refreshed: artistsRefreshed } =
    await hydrateRecentArtists(recentArtistIds);

  // The artists call may have refreshed the access token; merge that
  // refresh into the response so the cookie write isn't lost.
  const refreshed = artistsRefreshed ?? result.refreshed;

  const res = NextResponse.json({
    ok: true,
    tracks,
    recentPlaylistIds,
    recentArtists,
  });
  return applyRefreshedSpotifyCookies(res, refreshed);
}
