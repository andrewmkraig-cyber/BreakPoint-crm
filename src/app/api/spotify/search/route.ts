import { NextRequest, NextResponse } from "next/server";
import { applyRefreshedSpotifyCookies, spotifyApiProxy } from "@/lib/spotify";

// Multi-type Spotify search proxy. Caller passes ?q= and an optional
// ?types= comma-list (defaults to track,artist,album,playlist) — each
// section in the panel renders independently from the matching key
// on the response.
//
// Spotify started returning literal `null` entries inside the
// per-type `items` arrays in late 2025 (esp. for `playlists.items`)
// — every map callback below tolerates that, and the whole handler
// is wrapped in try/catch so an upstream surprise never escapes as
// a Next 500.

export const dynamic = "force-dynamic";

type SpotifyImage = { url?: string; height?: number; width?: number };
type SpotifyArtistRef = { id?: string; name?: string };
type SpotifyTrack = {
  id?: string;
  name?: string;
  uri?: string;
  duration_ms?: number;
  artists?: (SpotifyArtistRef | null)[];
  album?: { id?: string; name?: string; images?: SpotifyImage[] } | null;
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
  artists?: (SpotifyArtistRef | null)[];
};
type SpotifyPlaylist = {
  id?: string;
  name?: string;
  uri?: string;
  images?: SpotifyImage[];
  owner?: { display_name?: string } | null;
};
type SpotifySearchResponse = {
  tracks?: { items?: (SpotifyTrack | null)[] } | null;
  artists?: { items?: (SpotifyArtist | null)[] } | null;
  albums?: { items?: (SpotifyAlbum | null)[] } | null;
  playlists?: { items?: (SpotifyPlaylist | null)[] } | null;
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
    .filter((img) => img && img.url)
    .sort(
      (a, b) =>
        Math.abs((a.width ?? 0) - preferred) -
        Math.abs((b.width ?? 0) - preferred),
    );
  return ranked[0]?.url ?? "";
}

const ALLOWED_TYPES = new Set(["track", "artist", "album", "playlist"]);

export async function GET(req: NextRequest) {
  try {
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

    const typesParam = (
      url.searchParams.get("types") ?? "track,artist,album,playlist"
    )
      .split(",")
      .map((s) => s.trim())
      .filter((s) => ALLOWED_TYPES.has(s));
    const types = typesParam.length > 0 ? typesParam : ["track"];

    const sp = new URL("https://api.spotify.com/v1/search");
    sp.searchParams.set("q", q);
    sp.searchParams.set("type", types.join(","));
    sp.searchParams.set("limit", "8");

    const result = await spotifyApiProxy(sp.toString());
    if (!result.ok) {
      console.error(
        "[spotify-search] upstream failed",
        result.status,
        result.error,
      );
      const res = NextResponse.json(
        { ok: false, error: result.error },
        { status: result.status === 401 ? 401 : 502 },
      );
      return applyRefreshedSpotifyCookies(res, result.refreshed);
    }

    const json = (result.data ?? {}) as SpotifySearchResponse;

    const tracks = (json.tracks?.items ?? [])
      .map((t) => {
        if (!t || !t.id || !t.uri || !t.name) return null;
        const artist = (t.artists ?? [])
          .map((a) => a?.name)
          .filter((n): n is string => Boolean(n))
          .join(", ");
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
        if (!a || !a.id || !a.uri || !a.name) return null;
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
        if (!al || !al.id || !al.uri || !al.name) return null;
        const artist = (al.artists ?? [])
          .map((a) => a?.name)
          .filter((n): n is string => Boolean(n))
          .join(", ");
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
        if (!p || !p.id || !p.uri || !p.name) return null;
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
  } catch (e) {
    // Catch-all so a malformed Spotify payload (null items, schema
    // drift, etc.) becomes a 502 with a body the client can render
    // instead of an empty 500 the panel can't surface.
    console.error("[spotify-search] handler crashed:", e);
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "Spotify search crashed",
      },
      { status: 502 },
    );
  }
}
