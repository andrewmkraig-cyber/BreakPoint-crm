import { NextRequest, NextResponse } from "next/server";
import { applyRefreshedSpotifyCookies, spotifyApiProxy } from "@/lib/spotify";

// PUT /me/player/seek?position_ms=X — optional ?device_id. Spotify
// acks 204.

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest) {
  const url = new URL(req.url);
  const position = url.searchParams.get("position_ms");
  if (!position || Number.isNaN(Number(position))) {
    return NextResponse.json(
      { ok: false, error: "position_ms required" },
      { status: 400 },
    );
  }
  const deviceId = url.searchParams.get("device_id");
  let path = `/v1/me/player/seek?position_ms=${encodeURIComponent(position)}`;
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
