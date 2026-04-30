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

  try {
    const res = await fetch("https://api.openphone.com/v1/calls", {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromNumber,
        to: [to],
        phoneNumberId,
      }),
      cache: "no-store",
    });

    if (!res.ok) {
      // Try to surface OpenPhone's own error message if we can parse
      // their JSON; fall back to the status text otherwise so the
      // user sees something actionable instead of an opaque 500.
      const upstream = (await res.json().catch(() => null)) as
        | { message?: string; error?: { message?: string }; errors?: Array<{ message?: string }> }
        | null;
      const message =
        upstream?.message ||
        upstream?.error?.message ||
        upstream?.errors?.[0]?.message ||
        `Quo rejected the call (HTTP ${res.status})`;
      return NextResponse.json({ error: message }, { status: res.status });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to place call." },
      { status: 502 },
    );
  }
}

function toE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 11) return `+${digits}`;
  return null;
}
