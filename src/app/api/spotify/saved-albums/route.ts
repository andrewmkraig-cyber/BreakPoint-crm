import { NextResponse } from "next/server";
import { applyRefreshedSpotifyCookies, spotifyApiProxy } from "@/lib/spotify";

// GET /me/albums — the user's saved albums (the heart-toggled ones in
// Spotify mobile's Library tab). Slim projection: id, uri, name,
// primary artist, year, square art. Powers the Library tab's "Albums"
// filter in the floating panel.

export const dynamic = "force-dynamic";

type Image = { url?: string; width?: number };
type ArtistRef = { name?: string };
type Album = {
  id?: string;
  uri?: string;
  name?: string;
  release_date?: string;
  images?: Image[];
  artists?: ArtistRef[];
};
type SavedAlbumItem = {
  added_at?: string;
  album?: Album;
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
  const result = await spotifyApiProxy("/v1/me/albums?limit=50");
  if (!result.ok) {
    const res = NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status === 401 ? 401 : 502 },
    );
    return applyRefreshedSpotifyCookies(res, result.refreshed);
  }

  const items = ((result.data as { items?: SavedAlbumItem[] })?.items ?? [])
    .map((row) => {
      const a = row?.album;
      if (!a || !a.id || !a.uri || !a.name) return null;
      const artist = (a.artists ?? [])
        .map((x) => x?.name)
        .filter((n): n is string => Boolean(n))
        .join(", ");
      return {
        id: a.id,
        uri: a.uri,
        name: a.name,
        artist,
        year: a.release_date ? a.release_date.slice(0, 4) : "",
        image: pickImage(a.images, 300),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const res = NextResponse.json({ ok: true, albums: items });
  return applyRefreshedSpotifyCookies(res, result.refreshed);
}
