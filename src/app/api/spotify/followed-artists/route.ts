import { NextResponse } from "next/server";
import { applyRefreshedSpotifyCookies, spotifyApiProxy } from "@/lib/spotify";

// GET /me/following?type=artist — artists the user follows. Powers
// the Library tab's "Artists" filter. Requires the user-follow-read
// scope (added to SPOTIFY_SCOPES); existing connections from before
// the scope was added need to reconnect.
//
// The followed-artists endpoint nests the array under
// `artists.items`, unlike /me/albums where it's top-level `items`.

export const dynamic = "force-dynamic";

type Image = { url?: string; width?: number };
type Artist = {
  id?: string;
  uri?: string;
  name?: string;
  images?: Image[];
};

function pickImage(images: Image[] | undefined, preferred: number): string {
  if (!images || images.length === 0) return "";
  const ranked = [...images]
    .filter((i) => i.url)
    .sort(
      (a, b) =>
        Math.abs((a.width ?? 0) - preferred) -
        Math.abs((b.width ?? 0) - preferred),
    );
  return ranked[0]?.url ?? "";
}

export async function GET() {
  const result = await spotifyApiProxy(
    "/v1/me/following?type=artist&limit=50",
  );
  if (!result.ok) {
    const res = NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status === 401 ? 401 : 502 },
    );
    return applyRefreshedSpotifyCookies(res, result.refreshed);
  }

  const items = (
    (result.data as { artists?: { items?: Artist[] } })?.artists?.items ?? []
  )
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

  const res = NextResponse.json({ ok: true, artists: items });
  return applyRefreshedSpotifyCookies(res, result.refreshed);
}
