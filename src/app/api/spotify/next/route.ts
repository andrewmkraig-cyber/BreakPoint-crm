import { NextRequest, NextResponse } from "next/server";
import {
  applyRefreshedSpotifyCookies,
  getValidSpotifyAccessToken,
  spotifyApiProxy,
} from "@/lib/spotify";

// POST /v1/me/player/next — optional ?device_id. Spotify acks 204 on
// success; spotifyApiProxy lifts that to ok=true. Non-2xx responses
// pass through verbatim (no collapsing every error to 502) so the
// panel can branch on Spotify's actual status — most commonly:
//   401  session expired (the panel forces a reconnect)
//   403  Premium / restricted-track / wrong active device
//   404  no active device / nothing to skip to
//   429  rate-limited
//
// Logs one [spotify-next] line per call, capturing hasToken, status,
// and the sanitized body when present. Never logs tokens or auth
// headers.

export const dynamic = "force-dynamic";

function sanitizeBody(body: unknown): string {
  if (body == null) return "(empty)";
  if (typeof body === "string") return body.slice(0, 400);
  if (typeof body === "object") {
    try {
      return JSON.stringify(body).slice(0, 400);
    } catch {
      return "(unserializable)";
    }
  }
  return String(body).slice(0, 400);
}

export async function POST(req: NextRequest) {
  const deviceId = new URL(req.url).searchParams.get("device_id");

  // hasToken probe — runs the same auth resolver every spotifyApiProxy
  // call uses. Surfaces an explicit "no token" log line before any
  // Spotify call so a 401-cluster can be triaged immediately.
  const tokenProbe = await getValidSpotifyAccessToken();
  const hasToken = tokenProbe.ok;

  const path = `/v1/me/player/next${deviceId ? `?device_id=${deviceId}` : ""}`;
  const result = await spotifyApiProxy(path, {
    method: "POST",
    tag: "player/next",
  });

  if (!result.ok) {
    console.log(
      "[spotify-next]",
      JSON.stringify({
        hasToken,
        hasDeviceId: Boolean(deviceId),
        status: result.status,
        error: result.error,
        body: sanitizeBody(result.body),
      }),
    );
    // Pass Spotify's status through verbatim. Only fall back to 502
    // when the upstream status isn't a real HTTP code (e.g., network
    // failure mapped to 502 internally).
    const status =
      result.status >= 400 && result.status < 600 ? result.status : 502;
    const res = NextResponse.json(
      {
        ok: false,
        error: result.error,
        status: result.status,
        body: result.body,
      },
      { status },
    );
    return applyRefreshedSpotifyCookies(res, result.refreshed);
  }

  console.log(
    "[spotify-next]",
    JSON.stringify({
      hasToken,
      hasDeviceId: Boolean(deviceId),
      status: result.status,
    }),
  );
  const res = NextResponse.json({ ok: true, status: result.status });
  return applyRefreshedSpotifyCookies(res, result.refreshed);
}
