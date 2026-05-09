import { NextRequest, NextResponse } from "next/server";
import { applyRefreshedSpotifyCookies, spotifyApiProxy } from "@/lib/spotify";

// PUT /me/player/shuffle?state=<true|false> — optional ?device_id.
// Spotify acks with 204. Body shape: { state: boolean }. Pass status
// through verbatim (mirrors play/pause) so the panel can branch on
// 401 / 403 / 404 instead of seeing a flat 502.

export const dynamic = "force-dynamic";

type ShuffleBody = { state?: unknown };

export async function PUT(req: NextRequest) {
  let parsed: ShuffleBody = {};
  try {
    parsed = (await req.json()) as ShuffleBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "state must be a boolean" },
      { status: 400 },
    );
  }
  if (typeof parsed.state !== "boolean") {
    return NextResponse.json(
      { ok: false, error: "state must be a boolean" },
      { status: 400 },
    );
  }
  const deviceId = new URL(req.url).searchParams.get("device_id");
  let path = `/v1/me/player/shuffle?state=${parsed.state}`;
  if (deviceId) path += `&device_id=${encodeURIComponent(deviceId)}`;
  const result = await spotifyApiProxy(path, {
    method: "PUT",
    tag: "player/shuffle",
  });
  if (!result.ok) {
    const status =
      result.status >= 400 && result.status < 600 ? result.status : 502;
    const res = NextResponse.json(
      { ok: false, error: result.error, status: result.status },
      { status },
    );
    return applyRefreshedSpotifyCookies(res, result.refreshed);
  }
  const res = NextResponse.json({ ok: true, state: parsed.state });
  return applyRefreshedSpotifyCookies(res, result.refreshed);
}
