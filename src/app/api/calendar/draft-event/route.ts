import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
// Same 60s ceiling as the other Claude routes in Ace. This one writes two
// short strings, so it normally returns in 2-4s.
export const maxDuration = 60;

// Drafts the Title + Notes for a calendar event from whatever the recruiter
// has already filled into the drawer. Every event was being typed by hand,
// including the "Andrew to call Nicholas" title convention, so this route
// exists to produce both fields in one shot from the event type, guests,
// and date/time already on screen.
//
// Returns plain text for both fields. Notes go straight into the Google
// Calendar description, which the drawer treats as plain text unless the
// event came back from Google as HTML.

const anthropic = new Anthropic();

const EVENT_TYPES = ["interview", "client", "candidate", "reminder", "other"] as const;
type EventType = (typeof EVENT_TYPES)[number];

// What each event type is, in the recruiter's terms. Fed to Claude so the
// draft matches the audience: a candidate call is warm and outbound, a
// reminder is a note to self and gets no greeting at all.
const TYPE_CONTEXT: Record<EventType, string> = {
  interview:
    "An interview between a candidate and a client. Guests are the candidate and often the hiring manager.",
  client:
    "A call with a client contact (the hiring side). Professional and brief.",
  candidate:
    "An outbound call from the recruiter to a candidate. Warm, direct, and short.",
  reminder:
    "A personal reminder for the recruiter only. Nobody else ever reads it.",
  other: "A general calendar event.",
};

type Guest = { name?: string; email?: string };

type ApiRequest = {
  eventType: EventType;
  title?: string;
  guests?: Guest[];
  // Wall-clock strings straight off the drawer inputs, plus the IANA zone
  // so Claude can phrase relative dates ("tomorrow") correctly.
  date?: string;
  startTime?: string;
  endTime?: string;
  timeZone?: string;
  allDay?: boolean;
  meetingType?: string;
  location?: string;
};

type ApiResponse = { title: string; notes: string } | { error: string };

// Claude returns both fields in one response separated by markers rather
// than JSON. The notes are multi-line prose, and markers avoid a whole
// class of escaped-newline parsing failures that JSON would introduce.
const TITLE_MARKER = "TITLE:";
const NOTES_MARKER = "NOTES:";

function parseDraft(raw: string): { title: string; notes: string } {
  const titleAt = raw.indexOf(TITLE_MARKER);
  const notesAt = raw.indexOf(NOTES_MARKER);
  // No markers at all means Claude ignored the format. Rather than fail the
  // request, treat the whole response as notes and leave the title alone --
  // a usable draft in the field the recruiter actually asked about.
  if (titleAt === -1 || notesAt === -1 || notesAt < titleAt) {
    return { title: "", notes: raw.trim() };
  }
  const title = raw.slice(titleAt + TITLE_MARKER.length, notesAt).trim();
  const notes = raw.slice(notesAt + NOTES_MARKER.length).trim();
  return { title, notes };
}

// First name only. The title convention reads "Andrew to call Nicholas",
// never "Andrew Kraig to call Nicholas Gittings".
function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? "";
}

export async function POST(req: NextRequest): Promise<NextResponse<ApiResponse>> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Rule 8: resolve the tenant even though this route reads no tenant rows.
  // Keeps the posture identical to every other authenticated route.
  await getCurrentOrg();

  let payload: ApiRequest;
  try {
    payload = (await req.json()) as ApiRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const eventType: EventType = EVENT_TYPES.includes(payload.eventType)
    ? payload.eventType
    : "other";

  // The recruiter's own name drives the title convention. Fall back to the
  // account name, then to the email local-part, so the draft never renders
  // a blank where a first name belongs.
  const user = await prisma.user.findUnique({
    where: { email },
    select: { name: true, profile: { select: { fullName: true } } },
  });
  const senderName =
    firstName(user?.profile?.fullName ?? "") ||
    firstName(user?.name ?? "") ||
    email.split("@")[0];

  const guests = (payload.guests ?? [])
    .map((g) => (g.name ?? "").trim() || (g.email ?? "").trim())
    .filter(Boolean);

  const zone = (payload.timeZone ?? "America/New_York").trim();
  // "Today" in the recruiter's zone, not the server's, so "tomorrow" in the
  // drafted notes lines up with the date they picked in the drawer.
  const todayInZone = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const facts = [
    `Event type: ${TYPE_CONTEXT[eventType]}`,
    `Recruiter's first name: ${senderName}`,
    guests.length > 0 ? `Guests: ${guests.join(", ")}` : "Guests: none yet",
    payload.title?.trim() ? `Title the recruiter typed: ${payload.title.trim()}` : null,
    payload.date ? `Event date: ${payload.date}` : null,
    `Today's date: ${todayInZone}`,
    payload.allDay
      ? "All-day event."
      : payload.startTime
        ? `Starts ${payload.startTime}${payload.endTime ? ` and ends ${payload.endTime}` : ""} (${zone})`
        : null,
    payload.meetingType ? `Meeting type: ${payload.meetingType}` : null,
    payload.location?.trim() ? `Location or link: ${payload.location.trim()}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const system = [
    `You draft calendar events for ${senderName}, a recruiter at BreakPoint Talent.`,
    "You are given the details already filled into the event form. Write a title and a short note.",
    "",
    "Return EXACTLY this shape and nothing else. No preamble, no markdown, no code fences:",
    `${TITLE_MARKER} <the title on one line>`,
    `${NOTES_MARKER} <the note, which may span multiple lines>`,
    "",
    "Title rules:",
    "- Short enough to read at a glance in a calendar grid.",
    `- For a candidate call, use the house convention: "${senderName} to call <guest first name>".`,
    "- For an interview, name the candidate and the role when you know them.",
    "- For every other type, write a plain descriptive title. No quotes around it.",
    "- If the recruiter already typed a title, keep its intent and only tidy the wording.",
    "",
    "Notes rules:",
    "- Plain text. No markdown, no bullet characters, no subject line, no signature block.",
    "- Open with a greeting on its own line using the guest's first name, then a blank line, then one or two short sentences.",
    "- Say what the conversation is about and reference the timing naturally (today, tomorrow, the weekday) using the dates given.",
    "- For a reminder, skip the greeting entirely and write one line to self.",
    "- If there are no guests, skip the greeting and write one neutral line about the purpose.",
    "- Never invent a role, company, salary, or detail that is not in the facts below.",
    "- Use hyphens, never em dashes.",
  ].join("\n");

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 600,
      system,
      messages: [{ role: "user", content: facts }],
    });
    const raw = response.content
      .filter(
        (b): b is Extract<(typeof response.content)[number], { type: "text" }> =>
          b.type === "text",
      )
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (!raw) {
      console.error("[draft-event] no text content from Claude", {
        stop_reason: response.stop_reason,
      });
      return NextResponse.json({ error: "Claude returned nothing" }, { status: 502 });
    }
    const draft = parseDraft(raw);
    if (!draft.notes) {
      return NextResponse.json({ error: "Claude returned nothing" }, { status: 502 });
    }
    return NextResponse.json(draft);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Draft failed";
    console.error("[draft-event] failed", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
