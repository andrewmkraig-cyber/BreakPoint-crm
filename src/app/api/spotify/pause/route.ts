import { NextRequest, NextResponse } from "next/server";
import { applyRefreshedSpotifyCookies, spotifyApiProxy } from "@/lib/spotify";

// PUT /me/player/pause — optional ?device_id. Spotify acks with 204.

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest) {
  const deviceId = new URL(req.url).searchParams.get("device_id");
  const path = `/v1/me/player/pause${deviceId ? `?device_id=${deviceId}` : ""}`;
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
