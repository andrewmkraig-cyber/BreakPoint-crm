import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";

// Server-side proxy for YouTube Data API v3 search.list. The API key
// stays on the server — the floating panel hits this route, which
// requires an authenticated session and resolves the active org so
// only signed-in BreakPoint users can spin the quota.
//
// Two modes:
//   - ?q=…           free-text search; returns videos + channels
//                    interleaved with a `type` discriminator so the
//                    panel can render them in separate sections.
//   - ?channelId=…   fetches the channel's latest 10 uploads (videos
//                    only, ordered by date). Used by the "click a
//                    channel card to see their videos" flow.

type YouTubeId = {
  kind?: string;
  videoId?: string;
  channelId?: string;
};

type YouTubeThumbnail = { url?: string };
type YouTubeThumbnailSet = {
  default?: YouTubeThumbnail;
  medium?: YouTubeThumbnail;
  high?: YouTubeThumbnail;
};

type YouTubeSearchItem = {
  id?: YouTubeId;
  snippet?: {
    title?: string;
    channelId?: string;
    channelTitle?: string;
    thumbnails?: YouTubeThumbnailSet;
  };
};

type YouTubeSearchResponse = {
  items?: YouTubeSearchItem[];
};

type ResultItem =
  | {
      type: "video";
      videoId: string;
      title: string;
      channelId: string;
      channelTitle: string;
      thumbnail: string;
    }
  | {
      type: "channel";
      channelId: string;
      title: string;
      thumbnail: string;
    };

function pickThumbnail(t: YouTubeThumbnailSet | undefined): string {
  return t?.medium?.url ?? t?.high?.url ?? t?.default?.url ?? "";
}

function projectItem(item: YouTubeSearchItem): ResultItem | null {
  const videoId = item.id?.videoId ?? "";
  const channelId = item.id?.channelId ?? "";
  const title = item.snippet?.title ?? "";
  const thumbnail = pickThumbnail(item.snippet?.thumbnails);
  if (videoId) {
    return {
      type: "video",
      videoId,
      title,
      channelId: item.snippet?.channelId ?? "",
      channelTitle: item.snippet?.channelTitle ?? "",
      thumbnail,
    };
  }
  if (channelId) {
    return { type: "channel", channelId, title, thumbnail };
  }
  return null;
}

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

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const channelId = (url.searchParams.get("channelId") ?? "").trim();

  if (!q && !channelId) {
    return NextResponse.json({ ok: true, results: [] });
  }

  const yt = new URL("https://www.googleapis.com/youtube/v3/search");
  yt.searchParams.set("part", "snippet");
  yt.searchParams.set("maxResults", "10");
  yt.searchParams.set("key", apiKey);

  if (channelId) {
    // Channel-uploads mode: latest 10 videos from the channel.
    yt.searchParams.set("type", "video");
    yt.searchParams.set("channelId", channelId);
    yt.searchParams.set("order", "date");
    if (q) yt.searchParams.set("q", q);
  } else {
    // Free-text mode: videos + channels.
    yt.searchParams.set("type", "video,channel");
    yt.searchParams.set("q", q);
  }

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

  const results: ResultItem[] = (data.items ?? [])
    .map(projectItem)
    .filter((r): r is ResultItem => r !== null);

  return NextResponse.json({ ok: true, results });
}
