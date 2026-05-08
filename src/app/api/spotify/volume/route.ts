import { NextRequest, NextResponse } from "next/server";
import { applyRefreshedSpotifyCookies, spotifyApiProxy } from "@/lib/spotify";

// PUT /me/player/volume?volume_percent=X — optional ?device_id.
// Spotify acks 204.

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest) {
  const url = new URL(req.url);
  const vol = url.searchParams.get("volume_percent");
  const n = Number(vol);
  if (!vol || Number.isNaN(n) || n < 0 || n > 100) {
    return NextResponse.json(
      { ok: false, error: "volume_percent must be 0-100" },
      { status: 400 },
    );
  }
  const deviceId = url.searchParams.get("device_id");
  let path = `/v1/me/player/volume?volume_percent=${n}`;
  if (deviceId) path += `&device_id=${encodeURIComponent(deviceId)}`;
  const result = await spotifyApiProxy(path, { method: "PUT" });
  if (!result.ok) {
    const res = NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status === 401 ? 401 : 502 },
    );
    return applyRefreshedSpotifyCookies(res, result.refreshed);
  }
  const res = NextResponse.json({ ok: true });
  return applyRefreshedSpotifyCookies(res, result.refreshed);
}
