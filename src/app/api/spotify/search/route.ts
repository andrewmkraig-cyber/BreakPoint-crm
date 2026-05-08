import { NextRequest, NextResponse } from "next/server";
import {
  SPOTIFY_COOKIE,
  getValidSpotifyAccessToken,
  spotifyCookieOpts,
} from "@/lib/spotify";

// Server-side proxy for Spotify's /v1/search endpoint. Keeps the
// access_token off the client request graph (the client only sends
// `?q=…`) and folds in transparent refresh handling so a stale token
// doesn't bubble up as a 401 the panel has to disambiguate.

export const dynamic = "force-dynamic";

type SpotifyImage = { url?: string; height?: number; width?: number };
type SpotifyArtist = { name?: string };
type SpotifyTrack = {
  id?: string;
  name?: string;
  uri?: string;
  artists?: SpotifyArtist[];
  album?: { name?: string; images?: SpotifyImage[] };
};
type SpotifySearchResponse = {
  tracks?: { items?: SpotifyTrack[] };
};

export async function GET(req: NextRequest) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (!q) {
    return NextResponse.json({ ok: true, results: [] });
  }

  const tokenResult = await getValidSpotifyAccessToken();
  if (!tokenResult.ok) {
    return NextResponse.json(
      { ok: false, error: tokenResult.error },
      { status: 401 },
    );
  }

  const sp = new URL("https://api.spotify.com/v1/search");
  sp.searchParams.set("q", q);
  sp.searchParams.set("type", "track");
  sp.searchParams.set("limit", "10");

  let json: SpotifySearchResponse;
  try {
    const upstream = await fetch(sp.toString(), {
      headers: { Authorization: `Bearer ${tokenResult.accessToken}` },
      cache: "no-store",
    });
    if (!upstream.ok) {
      const text = await upstream.text();
      return NextResponse.json(
        {
          ok: false,
          error: `Spotify search ${upstream.status}: ${text.slice(0, 200)}`,
        },
        { status: 502 },
      );
    }
    json = (await upstream.json()) as SpotifySearchResponse;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Spotify fetch failed";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }

  const items = json.tracks?.items ?? [];
  const results = items
    .map((t) => {
      const id = t.id ?? "";
      const uri = t.uri ?? "";
      const name = t.name ?? "";
      if (!id || !uri || !name) return null;
      const artist = (t.artists ?? [])
        .map((a) => a.name)
        .filter(Boolean)
        .join(", ");
      // Spotify returns three images sized 640/300/64 — pick the
      // mid-size for thumbnail display, fall back to whatever's there.
      const images = t.album?.images ?? [];
      const albumArt =
        images.find((img) => (img.width ?? 0) >= 200 && (img.width ?? 0) <= 400)
          ?.url ??
        images[0]?.url ??
        "";
      return { id, uri, name, artist, albumArt };
    })
    .filter(
      (r): r is {
        id: string;
        uri: string;
        name: string;
        artist: string;
        albumArt: string;
      } => r !== null,
    );

  const res = NextResponse.json({ ok: true, results });

  // Mirror the cookie-rotation in /api/spotify/token so a refresh
  // triggered by this route also persists.
  if (tokenResult.refreshed) {
    const expiresAt = Date.now() + tokenResult.refreshed.expires_in * 1000;
    res.cookies.set(
      SPOTIFY_COOKIE.access,
      tokenResult.refreshed.access_token,
      spotifyCookieOpts(tokenResult.refreshed.expires_in),
    );
    res.cookies.set(
      SPOTIFY_COOKIE.expires,
      String(expiresAt),
      spotifyCookieOpts(60 * 60 * 24 * 30),
    );
    if (tokenResult.refreshed.refresh_token) {
      res.cookies.set(
        SPOTIFY_COOKIE.refresh,
        tokenResult.refreshed.refresh_token,
        spotifyCookieOpts(60 * 60 * 24 * 30),
      );
    }
  }

  return res;
}
