import { NextRequest, NextResponse } from "next/server";
import { applyRefreshedSpotifyCookies, spotifyApiProxy } from "@/lib/spotify";

// PUT /me/player/play — accepts optional ?device_id and forwards the
// JSON body straight through ({ context_uri, uris, offset,
// position_ms } per Spotify's contract). Spotify acks with 204.
//
// Passes Spotify's status through verbatim instead of normalizing
// every non-2xx to 502. The panel needs to branch distinct messages
// off 401 (auth expired), 403 (Premium / device / scope), and 404
// (artist / track / context not found) — collapsing them all to 502
// stranded the panel on the "Premium required" copy even when the
// real cause was something else.
//
// Logs one [spotify-play] line per call with the BODY SHAPE only —
// hasContextUri, hasUris, uriCount, hasOffset, offsetUri. The body
// itself never contains tokens or auth headers (those live in cookies
// / Authorization on a separate request), but we still don't log the
// raw URIs except for offsetUri because that's the most useful
// debugging signal when individual track-clicks misbehave.

export const dynamic = "force-dynamic";

type PlayBody = {
  context_uri?: unknown;
  uris?: unknown;
  offset?: { uri?: unknown; position?: unknown } | null;
  position_ms?: unknown;
};

function describeBody(raw: string): {
  hasContextUri: boolean;
  hasUris: boolean;
  uriCount: number;
  hasOffset: boolean;
  offsetUri: string | null;
} {
  if (!raw) {
    return {
      hasContextUri: false,
      hasUris: false,
      uriCount: 0,
      hasOffset: false,
      offsetUri: null,
    };
  }
  let parsed: PlayBody = {};
  try {
    parsed = JSON.parse(raw) as PlayBody;
  } catch {
    return {
      hasContextUri: false,
      hasUris: false,
      uriCount: 0,
      hasOffset: false,
      offsetUri: null,
    };
  }
  const uris = Array.isArray(parsed.uris) ? parsed.uris : null;
  return {
    hasContextUri: typeof parsed.context_uri === "string",
    hasUris: uris !== null,
    uriCount: uris?.length ?? 0,
    hasOffset:
      parsed.offset != null && typeof parsed.offset === "object",
    offsetUri:
      parsed.offset && typeof parsed.offset === "object" &&
      typeof parsed.offset.uri === "string"
        ? parsed.offset.uri
        : null,
  };
}

export async function PUT(req: NextRequest) {
  const deviceId = new URL(req.url).searchParams.get("device_id");
  const path = `/v1/me/player/play${deviceId ? `?device_id=${deviceId}` : ""}`;
  const body = await req.text();
  const shape = describeBody(body);

  const result = await spotifyApiProxy(path, {
    method: "PUT",
    body: body.length > 0 ? body : undefined,
    tag: "player/play",
  });

  console.log(
    "[spotify-play]",
    JSON.stringify({
      hasDeviceId: Boolean(deviceId),
      ...shape,
      status: result.status,
      ok: result.ok,
      error: result.ok ? null : result.error,
    }),
  );

  if (!result.ok) {
    const status =
      result.status >= 400 && result.status < 600 ? result.status : 502;
    const res = NextResponse.json(
      { ok: false, error: result.error, status: result.status },
      { status },
    );
    return applyRefreshedSpotifyCookies(res, result.refreshed);
  }
  const res = NextResponse.json({ ok: true });
  return applyRefreshedSpotifyCookies(res, result.refreshed);
}
