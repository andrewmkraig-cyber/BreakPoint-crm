import { NextRequest, NextResponse } from "next/server";
import { applyRefreshedSpotifyCookies, spotifyApiProxy } from "@/lib/spotify";

// GET /v1/playlists/{id} — full playlist payload (header + tracks).
// Caller can pass ?kind=album to route through /v1/albums/{id}
// instead so the panel's playlist view component can reuse the same
// fetch contract for both resource types.

export const dynamic = "force-dynamic";

type Image = { url?: string; width?: number };
type ArtistRef = { id?: string; name?: string };
type Track = {
  id?: string;
  name?: string;
  uri?: string;
  duration_ms?: number;
  artists?: ArtistRef[];
  album?: { name?: string; images?: Image[] };
};
type PlaylistTrack = { track?: Track | null };

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
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const id = params.id;
  const kind = (new URL(req.url).searchParams.get("kind") ?? "playlist").trim();
  const isAlbum = kind === "album";
  const path = isAlbum ? `/v1/albums/${id}` : `/v1/playlists/${id}`;

  const result = await spotifyApiProxy(path);
  if (!result.ok) {
    const res = NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status === 401 ? 401 : 502 },
    );
    return applyRefreshedSpotifyCookies(res, result.refreshed);
  }

  const data = result.data as {
    id?: string;
    name?: string;
    uri?: string;
    description?: string;
    images?: Image[];
    artists?: ArtistRef[];
    release_date?: string;
    owner?: { display_name?: string };
    tracks?: { items?: (PlaylistTrack | Track)[]; total?: number };
  };

  const tracksRaw = (data.tracks?.items ?? []) as Array<PlaylistTrack | Track>;
  const tracks = tracksRaw
    .map((entry, idx) => {
      const t = "track" in entry ? entry.track : (entry as Track);
      if (!t || !t.id || !t.uri || !t.name) return null;
      return {
        index: idx,
        id: t.id,
        uri: t.uri,
        name: t.name,
        artist: (t.artists ?? []).map((a) => a.name).filter(Boolean).join(", "),
        albumName: t.album?.name ?? data.name ?? "",
        albumArt:
          pickImage(t.album?.images, 64) || pickImage(data.images, 64),
        durationMs: t.duration_ms ?? 0,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const res = NextResponse.json({
    ok: true,
    kind: isAlbum ? "album" : "playlist",
    id: data.id ?? id,
    uri: data.uri ?? (isAlbum ? `spotify:album:${id}` : `spotify:playlist:${id}`),
    name: data.name ?? "",
    description: data.description ?? "",
    image: pickImage(data.images, 600),
    owner: isAlbum
      ? (data.artists ?? []).map((a) => a.name).filter(Boolean).join(", ")
      : data.owner?.display_name ?? "",
    year: isAlbum && data.release_date ? data.release_date.slice(0, 4) : "",
    trackCount: data.tracks?.total ?? tracks.length,
    tracks,
  });
  return applyRefreshedSpotifyCookies(res, result.refreshed);
}
