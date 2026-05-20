import { NextResponse } from "next/server";

import {
  applyRefreshedSpotifyCookies,
  getValidSpotifyAccessToken,
} from "@/lib/spotify";

// Lightweight endpoint the Settings > Connectors Spotify row hits on
// mount to decide between the green Connected pill + Disconnect button
// and the red Disconnected pill. Returns only { connected }, never the
// access token. A failed refresh (revoked grant) reports disconnected.
// When the cookied token was refreshed in the process we persist the
// new credentials so the check does not waste a refresh.

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await getValidSpotifyAccessToken();
    if (!result.ok) {
      return NextResponse.json({ connected: false });
    }
    const res = NextResponse.json({ connected: true });
    return applyRefreshedSpotifyCookies(res, result.refreshed);
  } catch {
    return NextResponse.json({ connected: false });
  }
}
