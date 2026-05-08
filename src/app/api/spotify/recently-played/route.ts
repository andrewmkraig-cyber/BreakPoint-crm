import { NextResponse } from "next/server";
import { applyRefreshedSpotifyCookies, spotifyApiProxy } from "@/lib/spotify";

// GET /me/player/recently-played — used by the home screen's
// horizontal-scroll "Recently Played" row. Spotify returns play
// history items wrapping `track` objects; we flatten + dedupe by
// track id so the same song heard twice in a row only shows once.

export const dynamic = "force-dynamic";

type Image = { url?: string; width?: number };
type Track = {
  id?: string;
  name?: string;
  uri?: string;
  duration_ms?: number;
  artists?: { name?: string }[];
  album?: { id?: string; name?: string; uri?: string; images?: Image[] };
};
type RecentItem = { track?: Track };

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

export async function GET() {
  const result = await spotifyApiProxy(
    "/v1/me/player/recently-played?limit=20",
  );
  if (!result.ok) {
    const res = NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status === 401 ? 401 : 502 },
    );
    return applyRefreshedSpotifyCookies(res, result.refreshed);
  }

  const seen = new Set<string>();
  const items =
    ((result.data as { items?: RecentItem[] })?.items ?? [])
      .map((item) => {
        const t = item.track;
        if (!t?.id || !t.uri || !t.name) return null;
        if (seen.has(t.id)) return null;
        seen.add(t.id);
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

  const res = NextResponse.json({ ok: true, tracks: items });
  return applyRefreshedSpotifyCookies(res, result.refreshed);
}
