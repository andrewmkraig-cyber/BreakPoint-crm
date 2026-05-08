import { NextRequest, NextResponse } from "next/server";
import { applyRefreshedSpotifyCookies, spotifyApiProxy } from "@/lib/spotify";

// PUT /me/player/play — accepts optional ?device_id and forwards the
// JSON body straight through ({ context_uri, uris, offset,
// position_ms } per Spotify's contract). Spotify acks with 204.

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
    const res = NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status === 401 ? 401 : 502 },
    );
    return applyRefreshedSpotifyCookies(res, result.refreshed);
  }
  const res = NextResponse.json({ ok: true });
  return applyRefreshedSpotifyCookies(res, result.refreshed);
}
