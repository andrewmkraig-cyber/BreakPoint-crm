import { NextResponse } from "next/server";
import { applyRefreshedSpotifyCookies, spotifyApiProxy } from "@/lib/spotify";

// Artist detail: header + Popular + More-from-this-artist + Discography.
//
// /v1/artists/{id}/top-tracks is intentionally NOT used — Spotify's
// dev-mode policy (Nov 2024) 403s it for apps that aren't in Extended
// Quota mode. We derive both Popular and More from the artist's first
// few albums' track listings instead, which never 403s for browsable
// catalog content.
//
// Calls (parallelized):
//   /v1/artists/{id}                                                — header
//   /v1/artists/{id}/albums?include_groups=album,single&limit=20    — discography (also feeds track scan)
// Then a dependent batch: /v1/albums/{id}/tracks for the first
// SCAN_ALBUMS albums (parallel). All track items are flattened,
// deduped by track id and by (lowercased-name + duration), then sliced
// into Popular (first 10) and More (next 20).

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

const SCAN_ALBUMS = 4;
const POPULAR_LIMIT = 10;
const MORE_LIMIT = 20;

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

  const [artistRes, discographyRes] = await Promise.all([
    spotifyApiProxy(`/v1/artists/${id}`),
    spotifyApiProxy(
      `/v1/artists/${id}/albums?include_groups=album,single&limit=20&market=US`,
    ),
  ]);

  let refreshed = artistRes.refreshed ?? discographyRes.refreshed;

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
  if (!discographyRes.ok) {
    console.error(
      "[spotify-artist] discography albums fetch failed",
      discographyRes.status,
      discographyRes.error,
    );
  }

  const discographyData = discographyRes.ok
    ? (discographyRes.data as { items?: Album[] })
    : { items: [] };
  const discographyItems = (discographyData.items ?? []).filter(
    (al) => al && al.id && al.name && al.uri,
  );

  // Scan the first SCAN_ALBUMS for tracks. We don't dedupe the album
  // list here — the artist might release multiple "deluxe" editions of
  // the same album, and we'll dedupe at the track level below.
  const albumsToScan = discographyItems.slice(0, SCAN_ALBUMS);
  const albumTracksResults = await Promise.all(
    albumsToScan.map((al) =>
      spotifyApiProxy(`/v1/albums/${al.id}/tracks?market=US&limit=50`),
    ),
  );
  for (const r of albumTracksResults) {
    refreshed = refreshed ?? r.refreshed ?? null;
  }

  // Flatten + dedupe by track id and by (lowercased-name + duration).
  // Carry album art down from the parent album because /albums/{id}/tracks
  // doesn't embed album images on each track.
  const seenIds = new Set<string>();
  const seenSig = new Set<string>();
  const allTracks: {
    id: string;
    uri: string;
    name: string;
    durationMs: number;
    albumArt: string;
  }[] = [];
  for (let i = 0; i < albumsToScan.length; i++) {
    const album = albumsToScan[i];
    const res = albumTracksResults[i];
    if (!res.ok) {
      console.error(
        "[spotify-artist] album-tracks fetch failed",
        album.id,
        res.status,
        res.error,
      );
      continue;
    }
    const data = res.data as { items?: AlbumTrack[] };
    const albumArt = pickImage(album.images, 64);
    for (const t of data.items ?? []) {
      if (!t || !t.id || !t.uri || !t.name) continue;
      if (seenIds.has(t.id)) continue;
      const sig = `${t.name.toLowerCase()}|${t.duration_ms ?? 0}`;
      if (seenSig.has(sig)) continue;
      seenIds.add(t.id);
      seenSig.add(sig);
      allTracks.push({
        id: t.id,
        uri: t.uri,
        name: t.name,
        durationMs: t.duration_ms ?? 0,
        albumArt,
      });
    }
  }

  const topTracks = allTracks.slice(0, POPULAR_LIMIT);
  const moreTracks = allTracks.slice(
    POPULAR_LIMIT,
    POPULAR_LIMIT + MORE_LIMIT,
  );

  // Discography (UI grid). Dedupe by lowercased name to collapse
  // re-issues that Spotify returns side by side.
  const seenAlbumNames = new Set<string>();
  const albums = discographyItems
    .map((al) => {
      if (!al.id || !al.uri || !al.name) return null;
      const dedupeKey = al.name.toLowerCase();
      if (seenAlbumNames.has(dedupeKey)) return null;
      seenAlbumNames.add(dedupeKey);
      return {
        id: al.id,
        uri: al.uri,
        name: al.name,
        year: al.release_date ? al.release_date.slice(0, 4) : "",
        albumArt: pickImage(al.images, 300),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const artist = artistRes.data as {
    id?: string;
    name?: string;
    uri?: string;
    images?: Image[];
    genres?: string[];
    followers?: { total?: number };
  };

  const followers =
    typeof artist.followers?.total === "number"
      ? artist.followers.total
      : null;

  const debug = {
    headerStatus: artistRes.status,
    albumsScanned: albumsToScan.length,
    albumTracksOk: albumTracksResults.filter((r) => r.ok).length,
    albumTracksFailed: albumTracksResults.filter((r) => !r.ok).length,
    rawTopTracksCount: topTracks.length,
    rawMoreTracksCount: moreTracks.length,
    rawAlbumsCount: albums.length,
    discographyStatus: discographyRes.status,
    discographyError: discographyRes.ok ? null : discographyRes.error,
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
    uri: artist.uri ?? `spotify:artist:${id}`,
    name: artist.name ?? "",
    image: pickImage(artist.images, 600),
    followers,
    genres: (artist.genres ?? []).slice(0, 3),
    topTracks,
    moreTracks,
    albums,
    debug,
  });
  return applyRefreshedSpotifyCookies(res, refreshed);
}
