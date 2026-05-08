import { NextRequest, NextResponse } from "next/server";
import { applyRefreshedSpotifyCookies, spotifyApiProxy } from "@/lib/spotify";

// Multi-type Spotify search proxy. Caller passes ?q= and an optional
// ?types= comma-list (defaults to track,artist,album,playlist) — each
// section in the panel renders independently from the matching key
// on the response.

export const dynamic = "force-dynamic";

type SpotifyImage = { url?: string; height?: number; width?: number };
type SpotifyArtistRef = { id?: string; name?: string };
type SpotifyTrack = {
  id?: string;
  name?: string;
  uri?: string;
  duration_ms?: number;
  artists?: SpotifyArtistRef[];
  album?: { id?: string; name?: string; images?: SpotifyImage[] };
};
type SpotifyArtist = {
  id?: string;
  name?: string;
  uri?: string;
  images?: SpotifyImage[];
  genres?: string[];
};
type SpotifyAlbum = {
  id?: string;
  name?: string;
  uri?: string;
  release_date?: string;
  images?: SpotifyImage[];
  artists?: SpotifyArtistRef[];
};
type SpotifyPlaylist = {
  id?: string;
  name?: string;
  uri?: string;
  images?: SpotifyImage[];
  owner?: { display_name?: string };
};
type SpotifySearchResponse = {
  tracks?: { items?: SpotifyTrack[] };
  artists?: { items?: SpotifyArtist[] };
  albums?: { items?: SpotifyAlbum[] };
  playlists?: { items?: SpotifyPlaylist[] };
};

// Spotify returns three image sizes (640/300/64) — pick the one
// closest to the panel's render size and fall back to whatever's
// there.
function pickImage(
  images: SpotifyImage[] | undefined,
  preferred: number,
): string {
  if (!images || images.length === 0) return "";
  const ranked = [...images]
    .filter((img) => img.url)
    .sort(
      (a, b) =>
        Math.abs((a.width ?? 0) - preferred) -
        Math.abs((b.width ?? 0) - preferred),
    );
  return ranked[0]?.url ?? "";
}

const ALLOWED_TYPES = new Set(["track", "artist", "album", "playlist"]);

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (!q) {
    return NextResponse.json({
      ok: true,
      tracks: [],
      artists: [],
      albums: [],
      playlists: [],
    });
  }

  const typesParam = (url.searchParams.get("types") ?? "track,artist,album,playlist")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => ALLOWED_TYPES.has(s));
  const types = typesParam.length > 0 ? typesParam : ["track"];

  const sp = new URL("https://api.spotify.com/v1/search");
  sp.searchParams.set("q", q);
  sp.searchParams.set("type", types.join(","));
  sp.searchParams.set("limit", "10");

  const result = await spotifyApiProxy(sp.toString());
  if (!result.ok) {
    const res = NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status === 401 ? 401 : 502 },
    );
    return applyRefreshedSpotifyCookies(res, result.refreshed);
  }

  const json = (result.data ?? {}) as SpotifySearchResponse;

  const tracks = (json.tracks?.items ?? [])
    .map((t) => {
      if (!t.id || !t.uri || !t.name) return null;
      const artist = (t.artists ?? []).map((a) => a.name).filter(Boolean).join(", ");
      return {
        id: t.id,
        uri: t.uri,
        name: t.name,
        artist,
        durationMs: t.duration_ms ?? 0,
        albumArt: pickImage(t.album?.images, 64),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const artists = (json.artists?.items ?? [])
    .map((a) => {
      if (!a.id || !a.uri || !a.name) return null;
      return {
        id: a.id,
        uri: a.uri,
        name: a.name,
        image: pickImage(a.images, 300),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const albums = (json.albums?.items ?? [])
    .map((al) => {
      if (!al.id || !al.uri || !al.name) return null;
      const artist = (al.artists ?? []).map((a) => a.name).filter(Boolean).join(", ");
      const year = al.release_date ? al.release_date.slice(0, 4) : "";
      return {
        id: al.id,
        uri: al.uri,
        name: al.name,
        artist,
        year,
        albumArt: pickImage(al.images, 300),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const playlists = (json.playlists?.items ?? [])
    .map((p) => {
      if (!p.id || !p.uri || !p.name) return null;
      return {
        id: p.id,
        uri: p.uri,
        name: p.name,
        owner: p.owner?.display_name ?? "",
        image: pickImage(p.images, 300),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const res = NextResponse.json({
    ok: true,
    tracks,
    artists,
    albums,
    playlists,
  });
  return applyRefreshedSpotifyCookies(res, result.refreshed);
}
