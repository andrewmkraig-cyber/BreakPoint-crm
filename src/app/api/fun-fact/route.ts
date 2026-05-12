import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { CLAUDE_MODEL, getClaude } from "@/lib/claude";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";

// Daily fun fact for the briefing chip. One row per (org, ET day):
// the route checks for today's row first and only invokes Claude on
// the first request of the ET day. Topic is chosen server-side by
// weighted random — each user's thumbs feedback nudges the weights
// toward what they like and away from what they don't.

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Topic = "history" | "technology" | "science" | "geography" | "trivia";

const TOPICS: Topic[] = ["history", "technology", "science", "geography", "trivia"];

type FactPayload = {
  topic: Topic;
  year: number | null;
  text: string;
};

type FunFactApiResponse = {
  ok: boolean;
  cached?: boolean;
  id?: string;
  topic?: Topic;
  year?: number | null;
  text?: string;
  myVote?: 1 | -1 | null;
  error?: string;
};

function todayInEastern(): Date {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [y, m, d] = fmt.format(new Date()).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

function isTopic(value: string): value is Topic {
  return (TOPICS as readonly string[]).includes(value);
}

function parseFactJson(raw: string): FactPayload | null {
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  s = s.slice(start, end + 1);
  try {
    const parsed = JSON.parse(s) as Partial<FactPayload> & { year?: unknown };
    if (
      typeof parsed.topic === "string" &&
      isTopic(parsed.topic) &&
      typeof parsed.text === "string" &&
      parsed.text.length > 0
    ) {
      const year =
        typeof parsed.year === "number" && Number.isFinite(parsed.year)
          ? Math.trunc(parsed.year)
          : null;
      return { topic: parsed.topic, year, text: parsed.text };
    }
  } catch {
    // fall through
  }
  return null;
}

// Returns a weighted topic pick. Each topic starts at weight 1.0;
// per-user votes in the last 60 days bump or cut that weight (cap at
// 0.1 floor so even a strongly-disliked topic can still surface once
// in a while and let the user adjust their stance).
function pickTopic(userVotes: Array<{ topic: string; vote: number }>): Topic {
  const weights: Record<Topic, number> = {
    history: 1,
    technology: 1,
    science: 1,
    geography: 1,
    trivia: 1,
  };
  for (const v of userVotes) {
    if (!isTopic(v.topic)) continue;
    weights[v.topic] = Math.max(0.1, weights[v.topic] + (v.vote > 0 ? 0.5 : -0.4));
  }
  const total = TOPICS.reduce((sum, t) => sum + weights[t], 0);
  let r = Math.random() * total;
  for (const t of TOPICS) {
    r -= weights[t];
    if (r <= 0) return t;
  }
  return TOPICS[0];
}

export async function GET(): Promise<NextResponse<FunFactApiResponse>> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json(
      { ok: false, error: "Sign in required" },
      { status: 401 },
    );
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  });
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Unknown user" },
      { status: 401 },
    );
  }
  const org = await getCurrentOrg();
  const generatedDate = todayInEastern();

  const cached = await prisma.funFact.findUnique({
    where: {
      organizationId_generatedDate: {
        organizationId: org.id,
        generatedDate,
      },
    },
  });
  if (cached) {
    const myVote = await prisma.funFactFeedback.findUnique({
      where: { factId_userId: { factId: cached.id, userId: user.id } },
      select: { vote: true },
    });
    return NextResponse.json({
      ok: true,
      cached: true,
      id: cached.id,
      topic: isTopic(cached.topic) ? cached.topic : "trivia",
      year: cached.year,
      text: cached.text,
      myVote: myVote ? (myVote.vote > 0 ? 1 : -1) : null,
    });
  }

  const recent = await prisma.funFact.findMany({
    where: {
      organizationId: org.id,
      generatedDate: { lt: generatedDate },
    },
    orderBy: { generatedDate: "desc" },
    take: 14,
    select: { text: true, topic: true },
  });

  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const userVotes = await prisma.funFactFeedback.findMany({
    where: {
      userId: user.id,
      createdAt: { gte: since },
      fact: { organizationId: org.id },
    },
    select: { vote: true, fact: { select: { topic: true } } },
  });
  const flatVotes = userVotes.map((v) => ({ topic: v.fact.topic, vote: v.vote }));
  const topic = pickTopic(flatVotes);

  const recentTextLines = recent
    .slice(0, 14)
    .map((r) => `- (${r.topic}) ${r.text.slice(0, 120)}`)
    .join("\n");

  const today = generatedDate.toISOString().slice(0, 10);
  const topicGuidance: Record<Topic, string> = {
    history:
      "A historical event, battle, invention, or surprising story from any era. Include the year. Skip anything tragic or grim — go for memorable and conversation-worthy.",
    technology:
      "A surprising fact about how a technology, gadget, software, or company came to be. Include a year if it sharpens the story.",
    science:
      "A counterintuitive or wonder-inducing fact from biology, physics, chemistry, astronomy, or psychology. Year optional.",
    geography:
      "An odd, unexpected fact about a place, country, city, river, or landmark. Year optional.",
    trivia:
      "A random, useful-in-conversation fun fact — sports, food, language origins, pop culture, animals. Year optional.",
  };

  const system =
    "You curate one short, conversation-worthy fun fact per day for a senior recruiter to drop into client small talk. " +
    "Respond with raw JSON only — no prose, no code fences. Schema: {\"topic\": \"history\"|\"technology\"|\"science\"|\"geography\"|\"trivia\", \"year\": number|null, \"text\": string}. " +
    "The text should be one to three sentences, factual, specific, and end with a complete thought. Avoid ChatGPT-flavored phrasing — no em dashes, no 'fascinatingly', no 'did you know'. Just state the fact.";

  const userMessage =
    `Today's date is ${today}. Generate one fun fact in the topic: "${topic}".\n\n` +
    `Guidance for this topic: ${topicGuidance[topic]}\n\n` +
    (recentTextLines
      ? `Do NOT repeat any of these facts already shown in the last ${recent.length} days:\n${recentTextLines}\n\n`
      : "") +
    `Return JSON with topic="${topic}".`;

  let payload: FactPayload | null;
  try {
    const anthropic = getClaude();
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 500,
      system,
      messages: [{ role: "user", content: userMessage }],
    });
    const first = response.content[0];
    const raw = first && first.type === "text" ? first.text : "";
    payload = parseFactJson(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Claude call failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
  if (!payload) {
    return NextResponse.json(
      { ok: false, error: "Claude returned no parseable JSON" },
      { status: 502 },
    );
  }

  const row = await prisma.funFact.upsert({
    where: {
      organizationId_generatedDate: {
        organizationId: org.id,
        generatedDate,
      },
    },
    update: {},
    create: {
      organizationId: org.id,
      topic: payload.topic,
      year: payload.year,
      text: payload.text,
      generatedDate,
    },
  });

  return NextResponse.json({
    ok: true,
    cached: false,
    id: row.id,
    topic: isTopic(row.topic) ? row.topic : payload.topic,
    year: row.year,
    text: row.text,
    myVote: null,
  });
}
