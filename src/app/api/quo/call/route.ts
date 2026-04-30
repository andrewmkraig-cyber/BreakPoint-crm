import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Outbound call dispatch. The Phone tab's CallPanel hits this endpoint
// when the recruiter clicks "Call now" — we forward to OpenPhone's
// /v1/calls with the configured Quo phone number id and number, and
// the user-supplied destination. OpenPhone rings the Quo apps signed
// in to that number and the call lands on whichever device picks up.
//
// Env contract:
//   QUO_API_KEY         — auth header (no Bearer prefix; OpenPhone
//                         expects the bare key)
//   QUO_PHONE_NUMBER_ID — id of the Quo number that should place the
//                         call
//   QUO_FROM_NUMBER     — E.164 of that same number, sent in the body
//                         as `from` (OpenPhone wants both)
//
// Returns { ok: true } on success or { error: <message> } with the
// upstream status mirrored when OpenPhone rejects the request.

type Body = { to?: string };

export async function POST(req: NextRequest) {
  const apiKey = process.env.QUO_API_KEY;
  const phoneNumberId = process.env.QUO_PHONE_NUMBER_ID;
  const fromNumber = process.env.QUO_FROM_NUMBER;

  if (!apiKey || !phoneNumberId || !fromNumber) {
    return NextResponse.json(
      {
        error:
          "Quo isn't configured for outbound calls. Set QUO_API_KEY, QUO_PHONE_NUMBER_ID, and QUO_FROM_NUMBER.",
      },
      { status: 500 },
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const to = toE164(body.to ?? "");
  if (!to) {
    return NextResponse.json(
      { error: "A valid phone number is required." },
      { status: 400 },
    );
  }

  // Log every detail of the outbound dispatch so the user can pinpoint
  // why OpenPhone is rejecting the request without redeploying.
  const requestBody = {
    from: fromNumber,
    to: [to],
    phoneNumberId,
  };
  const requestUrl = "https://api.openphone.com/v1/calls";
  console.log("[quo/call] dispatch", {
    url: requestUrl,
    body: requestBody,
    phoneNumberIdShape: phoneNumberIdShape(phoneNumberId),
    fromNumberShape: fromNumber,
    toShape: to,
  });

  try {
    const res = await fetch(requestUrl, {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      cache: "no-store",
    });

    // Always read the raw text first so we can log the upstream
    // response verbatim, then attempt to parse as JSON.
    const upstreamText = await res.text();
    console.log("[quo/call] response", {
      status: res.status,
      statusText: res.statusText,
      headers: Object.fromEntries(res.headers.entries()),
      bodyText: upstreamText,
    });

    if (!res.ok) {
      let upstream: { message?: string; error?: { message?: string }; errors?: Array<{ message?: string }> } | null = null;
      try {
        upstream = upstreamText ? JSON.parse(upstreamText) : null;
      } catch {
        upstream = null;
      }
      const message =
        upstream?.message ||
        upstream?.error?.message ||
        upstream?.errors?.[0]?.message ||
        `Quo rejected the call (HTTP ${res.status})`;
      return NextResponse.json(
        { error: message, upstreamStatus: res.status, upstreamBody: upstreamText },
        { status: res.status },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[quo/call] exception", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to place call." },
      { status: 502 },
    );
  }
}

// Tiny helper that describes the phoneNumberId without leaking it in
// logs in raw form. Helpful for spotting "did this start with PN... or
// is it a UUID, or is it the phone number itself?" without a redeploy.
function phoneNumberIdShape(id: string): string {
  return `${id.length} chars, prefix=${id.slice(0, 3)}…${id.slice(-3)}`;
}

function toE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 11) return `+${digits}`;
  return null;
}
