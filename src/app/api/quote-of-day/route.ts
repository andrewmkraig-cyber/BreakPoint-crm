import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { CLAUDE_MODEL } from "@/lib/claude";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";

// Daily curated quote on the dashboard. Mirrors /api/word-of-day:
// one row per (org, ET day) keyed on (organizationId, generatedDate).
// First request of the ET day costs a Claude call; subsequent loads
// hit the QuoteOfDay cache.

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const anthropic = new Anthropic();

type QuotePayload = {
  quote: string;
  author: string;
  context: string;
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

function parseQuoteJson(raw: string): QuotePayload | null {
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  s = s.slice(start, end + 1);
  try {
    const parsed = JSON.parse(s) as Partial<QuotePayload>;
    if (
      typeof parsed.quote === "string" &&
      typeof parsed.author === "string" &&
      typeof parsed.context === "string"
    ) {
      return parsed as QuotePayload;
    }
  } catch {
    // fall through
  }
  return null;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json(
      { ok: false, error: "Sign in required" },
      { status: 401 },
    );
  }
  const org = await getCurrentOrg();
  const generatedDate = todayInEastern();

  const cached = await prisma.quoteOfDay.findUnique({
    where: {
      organizationId_generatedDate: {
        organizationId: org.id,
        generatedDate,
      },
    },
  });
  if (cached) {
    return NextResponse.json({
      ok: true,
      cached: true,
      quote: cached.quote,
      author: cached.author,
      context: cached.context,
    });
  }

  // Pass the last 14 days back so Claude doesn't return the same
  // author / quote twice in a row — same fix as the word-of-day route
  // (Claude has no cross-call memory by default).
  const recent = await prisma.quoteOfDay.findMany({
    where: {
      organizationId: org.id,
      generatedDate: { lt: generatedDate },
    },
    orderBy: { generatedDate: "desc" },
    take: 14,
    select: { author: true, quote: true },
  });
  const recentLines = recent.map((r) => `${r.author}: "${r.quote}"`);

  const system =
    "You are a curator of memorable quotes. Return one sharp, specific quote from a respected business leader, athlete, philosopher, scientist, or historical figure — someone a sharp recruiting executive at a small firm would respect (founders, operators, generals, champions, thinkers). Avoid clichés and overused inspirational lines. Prefer specificity and bite over uplift. Respond with raw JSON only, no prose, no code fences. Schema: {\"quote\": string, \"author\": string, \"context\": string}. The context field is one sentence (under 20 words) describing who the author is and why they are worth quoting.";
  const userMessage =
    recentLines.length > 0
      ? `Today's date is ${generatedDate.toISOString().slice(0, 10)}. The following quotes have been used in the last ${recentLines.length} days — do NOT repeat any of them and pick a different author from any of these:\n${recentLines.join("\n")}\nReturn a new quote.`
      : `Today's date is ${generatedDate.toISOString().slice(0, 10)}. Return today's quote.`;

  let payload: QuotePayload | null;
  try {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 500,
      system,
      messages: [{ role: "user", content: userMessage }],
    });
    const first = response.content[0];
    const raw = first && first.type === "text" ? first.text : "";
    payload = parseQuoteJson(raw);
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

  const row = await prisma.quoteOfDay.upsert({
    where: {
      organizationId_generatedDate: {
        organizationId: org.id,
        generatedDate,
      },
    },
    update: {},
    create: {
      organizationId: org.id,
      quote: payload.quote,
      author: payload.author,
      context: payload.context,
      generatedDate,
    },
  });

  return NextResponse.json({
    ok: true,
    cached: false,
    quote: row.quote,
    author: row.author,
    context: row.context,
  });
}
