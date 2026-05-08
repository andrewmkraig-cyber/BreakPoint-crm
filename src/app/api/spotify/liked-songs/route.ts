import { NextResponse } from "next/server";
import { applyRefreshedSpotifyCookies, spotifyApiProxy } from "@/lib/spotify";

// GET /me/tracks — the user's saved (Liked) tracks. The home
// screen's Liked Songs gradient card uses the `total` count for the
// caption; clicking through opens a virtual "Liked Songs" view that
// re-uses the same playlist track-row template.

export const dynamic = "force-dynamic";

type Image = { url?: string; width?: number };
type Track = {
  id?: string;
  name?: string;
  uri?: string;
  duration_ms?: number;
  artists?: { name?: string }[];
  album?: { name?: string; images?: Image[] };
};
type SavedItem = { added_at?: string; track?: Track };

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
  const result = await spotifyApiProxy("/v1/me/tracks?limit=50");
  if (!result.ok) {
    const res = NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status === 401 ? 401 : 502 },
    );
    return applyRefreshedSpotifyCookies(res, result.refreshed);
  }

  const data = result.data as { items?: SavedItem[]; total?: number };
  const tracks = (data.items ?? [])
    .map((item) => {
      const t = item.track;
      if (!t?.id || !t.uri || !t.name) return null;
      return {
        id: t.id,
        uri: t.uri,
        name: t.name,
        artist: (t.artists ?? []).map((a) => a.name).filter(Boolean).join(", "),
        albumName: t.album?.name ?? "",
        albumArt: pickImage(t.album?.images, 64),
        durationMs: t.duration_ms ?? 0,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const res = NextResponse.json({
    ok: true,
    total: data.total ?? tracks.length,
    tracks,
  });
  return applyRefreshedSpotifyCookies(res, result.refreshed);
}
