import { NextRequest, NextResponse } from "next/server";
import { applyRefreshedSpotifyCookies, spotifyApiProxy } from "@/lib/spotify";

// PUT /me/player/play — accepts optional ?device_id and forwards the
// JSON body straight through ({ context_uri, uris, offset,
// position_ms } per Spotify's contract). Spotify acks with 204.
//
// Pass Spotify's status through verbatim instead of normalizing every
// non-2xx to 502. The panel needs to branch distinct messages off
// 401 (auth expired), 403 (Premium / device / scope), and 404
// (artist / track / context not found) — collapsing them all to 502
// stranded the panel on the "Premium required" copy even when the
// real cause was something else.

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest) {
  const deviceId = new URL(req.url).searchParams.get("device_id");
  const path = `/v1/me/player/play${deviceId ? `?device_id=${deviceId}` : ""}`;
  const body = await req.text();
  const result = await spotifyApiProxy(path, {
    method: "PUT",
    body: body.length > 0 ? body : undefined,
  });
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
