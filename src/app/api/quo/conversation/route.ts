import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Resolves a Quo (OpenPhone) conversation deep-link from a candidate's
// phone number. Used by the candidate-profile SMS composer and the
// Phone tab's thread header — both call this with the counterpart
// number and open the returned URL in a new tab.
//
// Failure mode is silent on purpose: if the OpenPhone lookup throws or
// returns nothing, we fall back to the inbox URL so the recruiter
// always lands somewhere useful in Quo. The button never errors at the
// caller.
export async function GET(req: NextRequest) {
  const phoneNumberId = process.env.QUO_PHONE_NUMBER_ID;
  const apiKey = process.env.QUO_API_KEY;
  const inputPhone = req.nextUrl.searchParams.get("phoneNumber") ?? "";

  // The fallback URL is what we return whenever we can't pin down a
  // specific conversation. Computed once so every error path returns
  // the same shape.
  const fallback = phoneNumberId
    ? `https://my.quo.com/inbox/${phoneNumberId}`
    : "https://my.quo.com/inbox";

  if (!phoneNumberId || !apiKey) {
    return NextResponse.json({ url: fallback });
  }

  const e164 = toE164(inputPhone);
  if (!e164) {
    return NextResponse.json({ url: fallback });
  }

  try {
    const url = new URL("https://api.openphone.com/v1/conversations");
    url.searchParams.set("phoneNumberId", phoneNumberId);
    url.searchParams.append("participants[]", e164);

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      // Don't cache — conversation ids can shift if a new participant
      // is added; always ask Quo.
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json({ url: fallback });
    }

    const body = (await res.json().catch(() => null)) as
      | { data?: Array<{ id?: string }>; conversations?: Array<{ id?: string }> }
      | null;
    // OpenPhone's conversations.list returns `{ data: [...] }`. We
    // also accept `{ conversations: [...] }` defensively in case the
    // shape ever shifts.
    const conversationId =
      body?.data?.[0]?.id ?? body?.conversations?.[0]?.id ?? null;

    if (!conversationId) {
      return NextResponse.json({ url: fallback });
    }

    return NextResponse.json({
      url: `https://my.quo.com/inbox/${phoneNumberId}/c/${conversationId}`,
    });
  } catch {
    return NextResponse.json({ url: fallback });
  }
}

// Normalize whatever the caller passes (raw 10-digit, +1-formatted,
// (216) 870-4655, etc.) into E.164. Returns null when there aren't
// enough digits to be a real number — caller falls back to inbox.
function toE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 11) return `+${digits}`;
  return null;
}
