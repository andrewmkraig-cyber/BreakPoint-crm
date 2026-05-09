import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";

// Server-side proxy for YouTube Data API v3 search.list. The API key
// stays on the server — the floating panel hits this route, which
// requires an authenticated session and resolves the active org so
// only signed-in BreakPoint users can spin the quota.
//
// Three input shapes:
//   - ?q=…           free-text search; returns videos + channels
//                    interleaved with a `type` discriminator so the
//                    panel can render them in separate sections.
//   - ?channelId=…   fetches the channel's latest 10 uploads (videos
//                    only, ordered by date). Used by the "click a
//                    channel card to see their videos" flow.
//   - ?mode=…        optional sort/filter for free-text search.
//                    top (default) | recent | popular | long.
//
// After search.list returns, any video IDs in the result set get
// hydrated with duration via a single batched videos.list call. The
// extra request is 1 quota unit (vs search.list's 100) so it's a
// rounding error on cost. Channels in the same response don't have a
// duration concept and are returned unchanged.

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
  nextPageToken?: string;
};

type YouTubeVideoDetailsItem = {
  id?: string;
  contentDetails?: { duration?: string };
  statistics?: { viewCount?: string };
};

type YouTubeVideoDetailsResponse = {
  items?: YouTubeVideoDetailsItem[];
};

type ResultItem =
  | {
      type: "video";
      videoId: string;
      title: string;
      channelId: string;
      channelTitle: string;
      thumbnail: string;
      // null when the video is a live stream or YouTube didn't return
      // a parseable contentDetails.duration. Panel renders the badge
      // only when both fields are present.
      durationSec: number | null;
      durationLabel: string | null;
    }
  | {
      type: "channel";
      channelId: string;
      title: string;
      thumbnail: string;
    };

type SearchMode = "top" | "recent" | "popular";

function parseMode(raw: string | null): SearchMode {
  switch (raw) {
    case "recent":
    case "popular":
      return raw;
    default:
      return "top";
  }
}

function pickThumbnail(t: YouTubeThumbnailSet | undefined): string {
  return t?.medium?.url ?? t?.high?.url ?? t?.default?.url ?? "";
}

// Parse YouTube's ISO 8601 duration (PT#H#M#S) into seconds. Returns
// null for live streams (PT0S without contentDetails matching), unknown
// shapes, or anything that won't fit a positive integer.
function parseIsoDuration(raw: string | undefined): number | null {
  if (!raw) return null;
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(raw);
  if (!match) return null;
  const h = Number(match[1] ?? 0);
  const m = Number(match[2] ?? 0);
  const s = Number(match[3] ?? 0);
  const total = h * 3600 + m * 60 + s;
  if (!Number.isFinite(total) || total <= 0) return null;
  return total;
}

// 8:42, 1:12:04. Seconds always 2-digit; minutes 2-digit only when an
// hour component is present (matches YouTube's own badge style).
function formatDurationLabel(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const ss = String(s).padStart(2, "0");
  if (h > 0) {
    const mm = String(m).padStart(2, "0");
    return `${h}:${mm}:${ss}`;
  }
  return `${m}:${ss}`;
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
      durationSec: null,
      durationLabel: null,
    };
  }
  if (channelId) {
    return { type: "channel", channelId, title, thumbnail };
  }
  return null;
}

// Hydrate every video result with duration via a single videos.list
// call. Channels pass through unchanged. Failures are logged and
// swallowed so a flaky details fetch never strands the search itself —
// the recruiter just sees results without duration badges in that case.
async function hydrateDurations(
  results: ResultItem[],
  apiKey: string,
): Promise<ResultItem[]> {
  const videoIds = results
    .filter((r): r is Extract<ResultItem, { type: "video" }> => r.type === "video")
    .map((r) => r.videoId);
  if (videoIds.length === 0) return results;

  const yt = new URL("https://www.googleapis.com/youtube/v3/videos");
  yt.searchParams.set("part", "contentDetails,statistics");
  yt.searchParams.set("id", videoIds.join(","));
  yt.searchParams.set("key", apiKey);

  let data: YouTubeVideoDetailsResponse;
  try {
    const res = await fetch(yt.toString(), { cache: "no-store" });
    if (!res.ok) {
      console.error("[youtube] videos.list", res.status);
      return results;
    }
    data = (await res.json()) as YouTubeVideoDetailsResponse;
  } catch (e) {
    console.error("[youtube] videos.list fetch failed", e);
    return results;
  }

  const byId = new Map<string, number>();
  for (const item of data.items ?? []) {
    const id = item.id;
    if (!id) continue;
    const sec = parseIsoDuration(item.contentDetails?.duration);
    if (sec !== null) byId.set(id, sec);
  }

  return results.map((r) => {
    if (r.type !== "video") return r;
    const sec = byId.get(r.videoId);
    if (sec === undefined) return r;
    return {
      ...r,
      durationSec: sec,
      durationLabel: formatDurationLabel(sec),
    };
  });
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
  const pageToken = (url.searchParams.get("pageToken") ?? "").trim();
  const mode = parseMode(url.searchParams.get("mode"));

  if (!q && !channelId) {
    return NextResponse.json({ ok: true, results: [], nextPageToken: null });
  }

  const yt = new URL("https://www.googleapis.com/youtube/v3/search");
  yt.searchParams.set("part", "snippet");
  // 50 is YouTube's per-request maximum for search.list. Combined
  // with the panel's "Load more" button (uses nextPageToken below)
  // the recruiter can scroll through hundreds of results without
  // running into a hard cap.
  yt.searchParams.set("maxResults", "50");
  yt.searchParams.set("key", apiKey);
  if (pageToken) yt.searchParams.set("pageToken", pageToken);

  if (channelId) {
    // Channel-uploads mode: a single channel's videos, ordered per
    // the requested mode. Default (top) maps to relevance; recent
    // maps to chronological — preserving the original "latest
    // videos" feel.
    yt.searchParams.set("type", "video");
    yt.searchParams.set("channelId", channelId);
    if (q) yt.searchParams.set("q", q);
    if (mode === "popular") {
      yt.searchParams.set("order", "viewCount");
    } else if (mode === "top") {
      yt.searchParams.set("order", "relevance");
    } else {
      // recent (default for channel browse — closest to the prior
      // "latest videos" behavior the panel always shipped with)
      yt.searchParams.set("order", "date");
    }
  } else {
    // Free-text mode. Mode picks the order across video,channel.
    yt.searchParams.set("q", q);
    yt.searchParams.set("type", "video,channel");
    if (mode === "recent") {
      yt.searchParams.set("order", "date");
    } else if (mode === "popular") {
      yt.searchParams.set("order", "viewCount");
    } else {
      yt.searchParams.set("order", "relevance");
    }
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

  const projected: ResultItem[] = (data.items ?? [])
    .map(projectItem)
    .filter((r): r is ResultItem => r !== null);

  const results = await hydrateDurations(projected, apiKey);

  return NextResponse.json({
    ok: true,
    results,
    nextPageToken: data.nextPageToken ?? null,
  });
}
