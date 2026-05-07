import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { CLAUDE_MODEL } from "@/lib/claude";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";

// Daily vocabulary card on the dashboard. One row per (org, ET day):
// the route checks for today's row first and returns it without
// touching Claude on every subsequent load. Only the first request of
// the ET day spends a Claude call.
//
// generatedDate is a Postgres DATE column; we send a UTC-noon Date so
// the calendar day matches ET regardless of server timezone.

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const anthropic = new Anthropic();

type WordPayload = {
  word: string;
  partOfSpeech: string;
  definition: string;
  exampleSentence: string;
};

function todayInEastern(): Date {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [y, m, d] = fmt.format(new Date()).split("-").map(Number);
  // UTC noon — far enough from any ET midnight boundary that the
  // Postgres DATE projection lands on the intended ET calendar day.
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

function parseWordJson(raw: string): WordPayload | null {
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  // If Claude prefaces the JSON with prose, grab the first {...} block.
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  s = s.slice(start, end + 1);
  try {
    const parsed = JSON.parse(s) as Partial<WordPayload>;
    if (
      typeof parsed.word === "string" &&
      typeof parsed.partOfSpeech === "string" &&
      typeof parsed.definition === "string" &&
      typeof parsed.exampleSentence === "string"
    ) {
      return parsed as WordPayload;
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

  const cached = await prisma.wordOfDay.findUnique({
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
      word: cached.word,
      partOfSpeech: cached.partOfSpeech,
      definition: cached.definition,
      exampleSentence: cached.exampleSentence,
    });
  }

  const system =
    "You are a vocabulary curator. Return a single sophisticated, uncommon English word that a sharp business professional would find useful. Pick a different word each day so that repeated calls on different dates produce different words. Respond with raw JSON only, no prose, no code fences. Schema: {\"word\": string, \"partOfSpeech\": string, \"definition\": string, \"exampleSentence\": string}.";
  const userMessage = `Today's date is ${generatedDate.toISOString().slice(0, 10)}. Return today's word.`;

  let payload: WordPayload | null;
  try {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 400,
      system,
      messages: [{ role: "user", content: userMessage }],
    });
    const first = response.content[0];
    const raw = first && first.type === "text" ? first.text : "";
    payload = parseWordJson(raw);
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

  // Use upsert in case a concurrent request beat us to the insert —
  // the unique (org, generatedDate) constraint would otherwise throw.
  const row = await prisma.wordOfDay.upsert({
    where: {
      organizationId_generatedDate: {
        organizationId: org.id,
        generatedDate,
      },
    },
    update: {},
    create: {
      organizationId: org.id,
      word: payload.word,
      partOfSpeech: payload.partOfSpeech,
      definition: payload.definition,
      exampleSentence: payload.exampleSentence,
      generatedDate,
    },
  });

  return NextResponse.json({
    ok: true,
    cached: false,
    word: row.word,
    partOfSpeech: row.partOfSpeech,
    definition: row.definition,
    exampleSentence: row.exampleSentence,
  });
}
