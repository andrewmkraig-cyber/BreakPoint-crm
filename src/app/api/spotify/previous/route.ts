import { NextRequest, NextResponse } from "next/server";
import { applyRefreshedSpotifyCookies, spotifyApiProxy } from "@/lib/spotify";

// POST /me/player/previous — optional ?device_id. Spotify acks 204.

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const deviceId = new URL(req.url).searchParams.get("device_id");
  const path = `/v1/me/player/previous${deviceId ? `?device_id=${deviceId}` : ""}`;
  const result = await spotifyApiProxy(path, { method: "POST" });
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
