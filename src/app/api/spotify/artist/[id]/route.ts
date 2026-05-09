import { NextResponse } from "next/server";
import { applyRefreshedSpotifyCookies, spotifyApiProxy } from "@/lib/spotify";

// Artist detail.
//
// Step A — header:        /v1/artists/{id}
// Step B — discography:   /v1/artists/{id}/albums?include_groups=album,single&limit=20
// Step C — album scan:    /v1/albums/{id}/tracks for the first SCAN_ALBUMS
//                         albums; flatten + dedupe → Popular (10) + More (20)
// Step D — top-tracks:    /v1/artists/{id}/top-tracks?market=US
//                         FALLBACK only when Step C produced zero
//                         usable tracks. Used to 403 in dev mode but
//                         we try it anyway because the album scan
//                         can still come back empty for fringe artists.
//
// Visible track count never gates playback — artist Play hands the
// whole spotify:artist:{id} URI to /v1/me/player/play and Spotify's
// queue engine handles song-to-song advance.

export const dynamic = "force-dynamic";

type Image = { url?: string; width?: number };
type AlbumTrack = {
  id?: string;
  name?: string;
  uri?: string;
  duration_ms?: number;
  album?: { images?: Image[] } | null;
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
    spotifyApiProxy(`/v1/artists/${id}`, { tag: "artist/header" }),
    // limit=10 — Spotify rejected limit=20 with "Invalid limit" on
    // this endpoint despite docs claiming 1–50. 10 is the empirically
    // working cap. Hardcoded literal (no variable) so it can't be
    // accidentally changed by a refactor of unrelated constants.
    spotifyApiProxy(
      `/v1/artists/${id}/albums?include_groups=album,single&limit=10&market=US`,
      { tag: "artist/discography" },
    ),
  ]);

  let refreshed = artistRes.refreshed ?? discographyRes.refreshed;

  if (!artistRes.ok) {
    const res = NextResponse.json(
      {
        ok: false,
        error: `Header: ${artistRes.error}`,
        status: artistRes.status,
      },
      { status: artistRes.status === 401 ? 401 : 502 },
    );
    return applyRefreshedSpotifyCookies(res, refreshed);
  }

  const discographyData = discographyRes.ok
    ? (discographyRes.data as { items?: Album[] })
    : { items: [] };
  const discographyItems = (discographyData.items ?? []).filter(
    (al) => al && al.id && al.name && al.uri,
  );

  // Step C — album scan.
  const albumsToScan = discographyItems.slice(0, SCAN_ALBUMS);
  const albumTracksResults = await Promise.all(
    albumsToScan.map((al) =>
      spotifyApiProxy(`/v1/albums/${al.id}/tracks?market=US&limit=50`, {
        tag: "artist/album-tracks",
      }),
    ),
  );
  for (const r of albumTracksResults) {
    refreshed = refreshed ?? r.refreshed ?? null;
  }

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
    if (!res.ok) continue;
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

  // Step D — top-tracks fallback. Fires when the album scan yielded
  // nothing usable (no albums in discography, or every album-tracks
  // call failed, or every album returned tracks we couldn't project).
  // Used to 403 in dev mode; trying anyway because (a) some accounts
  // are in extended-quota mode and it works, and (b) when it does
  // fail the structured log shows the 403 and we fall through.
  let topTracksFallbackUsed = false;
  if (allTracks.length === 0) {
    const ttRes = await spotifyApiProxy(
      `/v1/artists/${id}/top-tracks?market=US`,
      { tag: "artist/top-tracks-fallback" },
    );
    refreshed = refreshed ?? ttRes.refreshed ?? null;
    if (ttRes.ok) {
      const data = ttRes.data as { tracks?: AlbumTrack[] };
      for (const t of data.tracks ?? []) {
        if (!t || !t.id || !t.uri || !t.name) continue;
        if (seenIds.has(t.id)) continue;
        seenIds.add(t.id);
        allTracks.push({
          id: t.id,
          uri: t.uri,
          name: t.name,
          durationMs: t.duration_ms ?? 0,
          albumArt: pickImage(t.album?.images, 64),
        });
      }
      topTracksFallbackUsed = true;
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

  console.log(
    "[spotify-artist]",
    JSON.stringify({
      id,
      headerStatus: artistRes.status,
      discographyStatus: discographyRes.status,
      discographyItems: discographyItems.length,
      albumsScanned: albumsToScan.length,
      albumTracksOk: albumTracksResults.filter((r) => r.ok).length,
      albumTracksFailed: albumTracksResults.filter((r) => !r.ok).length,
      topTracksFallbackUsed,
      topTracksCount: topTracks.length,
      moreTracksCount: moreTracks.length,
      albumsCount: albums.length,
    }),
  );

  const debug = {
    headerStatus: artistRes.status,
    discographyStatus: discographyRes.status,
    discographyError: discographyRes.ok ? null : discographyRes.error,
    albumsScanned: albumsToScan.length,
    albumTracksOk: albumTracksResults.filter((r) => r.ok).length,
    albumTracksFailed: albumTracksResults.filter((r) => !r.ok).length,
    topTracksFallbackUsed,
    rawTopTracksCount: topTracks.length,
    rawMoreTracksCount: moreTracks.length,
    rawAlbumsCount: albums.length,
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
