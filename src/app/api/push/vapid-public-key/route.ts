import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  const key = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "")
    .trim()
    .replace(/^"|"$/g, "");

  if (!key) {
    return NextResponse.json(
      { error: "VAPID public key not configured" },
      { status: 503 },
    );
  }

  // This key is intentionally public: browsers need it to create/rotate a
  // Web Push subscription. The private VAPID key never leaves the server.
  return NextResponse.json({ key });
}
