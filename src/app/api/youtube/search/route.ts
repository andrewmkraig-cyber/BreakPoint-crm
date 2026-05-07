import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";

// Server-side proxy for YouTube Data API v3 search.list. The API key
// stays on the server — the floating panel hits this route, which
// requires an authenticated session and resolves the active org so
// only signed-in BreakPoint users can spin the quota. Returns a slim
// projection (videoId, title, channelTitle, thumbnail) so the panel
// doesn't have to crawl the raw YouTube envelope.

type YouTubeSearchItem = {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    channelTitle?: string;
    thumbnails?: {
      medium?: { url?: string };
    };
  };
};

type YouTubeSearchResponse = {
  items?: YouTubeSearchItem[];
};

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json(
      { ok: false, error: "Sign in required" },
      { status: 401 },
    );
  }
  // Tenant scope: any signed-in BreakPoint user can search; throws
  // if no org context exists, matching the rest of the app's posture.
  await getCurrentOrg();

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "YOUTUBE_API_KEY not configured" },
      { status: 500 },
    );
  }

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (!q) {
    return NextResponse.json({ ok: true, results: [] });
  }

  const yt = new URL("https://www.googleapis.com/youtube/v3/search");
  yt.searchParams.set("part", "snippet");
  yt.searchParams.set("type", "video");
  yt.searchParams.set("maxResults", "8");
  yt.searchParams.set("q", q);
  yt.searchParams.set("key", apiKey);

  let data: YouTubeSearchResponse;
  try {
    const res = await fetch(yt.toString(), { cache: "no-store" });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { ok: false, error: `YouTube API ${res.status}: ${text.slice(0, 200)}` },
        { status: 502 },
      );
    }
    data = (await res.json()) as YouTubeSearchResponse;
  } catch (e) {
    const message = e instanceof Error ? e.message : "YouTube fetch failed";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }

  const results = (data.items ?? [])
    .map((item) => {
      const videoId = item.id?.videoId ?? "";
      const title = item.snippet?.title ?? "";
      const channelTitle = item.snippet?.channelTitle ?? "";
      const thumbnail = item.snippet?.thumbnails?.medium?.url ?? "";
      if (!videoId) return null;
      return { videoId, title, channelTitle, thumbnail };
    })
    .filter((r): r is { videoId: string; title: string; channelTitle: string; thumbnail: string } => r !== null);

  return NextResponse.json({ ok: true, results });
}
