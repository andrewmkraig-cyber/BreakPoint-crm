import { NextRequest, NextResponse } from "next/server";
import { applyRefreshedSpotifyCookies, spotifyApiProxy } from "@/lib/spotify";

// PUT /me/player/pause — optional ?device_id. Spotify acks with 204.
//
// Pass Spotify's status through verbatim instead of normalizing every
// non-2xx to 502. The browser console kept showing "502 Bad Gateway"
// for plain "no active device" 404s, which made every benign pause
// failure look like a server outage. 401 still flips the panel into
// the unauthenticated state via the client check.

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest) {
  const deviceId = new URL(req.url).searchParams.get("device_id");
  const path = `/v1/me/player/pause${deviceId ? `?device_id=${deviceId}` : ""}`;
  const result = await spotifyApiProxy(path, { method: "PUT" });
  if (!result.ok) {
    const status =
      result.status >= 400 && result.status < 600 ? result.status : 502;
    const res = NextResponse.json(
      { ok: false, error: result.error },
      { status },
    );
    return applyRefreshedSpotifyCookies(res, result.refreshed);
  }
  const res = NextResponse.json({ ok: true });
  return applyRefreshedSpotifyCookies(res, result.refreshed);
}
