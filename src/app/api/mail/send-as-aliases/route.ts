import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getFreshAccessToken } from "@/lib/gmail";

export const dynamic = "force-dynamic";

// Lists the signed-in user's verified "Send mail as" aliases. Powers the
// From dropdown in the Mail composer. Primary address always appears
// (verificationStatus is empty for the primary); secondary aliases only
// surface once verified, otherwise Gmail rewrites the From on send.

type GmailSendAsListResponse = {
  sendAs?: Array<{
    sendAsEmail?: string;
    displayName?: string;
    isDefault?: boolean;
    isPrimary?: boolean;
    verificationStatus?: string;
  }>;
};

export type SendAsAlias = {
  sendAsEmail: string;
  displayName: string;
  isDefault: boolean;
};

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, email: true },
  });
  if (!user) return NextResponse.json({ error: "Unknown user" }, { status: 401 });

  try {
    const accessToken = await getFreshAccessToken(user.id);
    const res = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Gmail sendAs.list failed (${res.status}): ${text || "no body"}`);
    }
    const json = (await res.json()) as GmailSendAsListResponse;
    const aliases: SendAsAlias[] = (json.sendAs ?? [])
      .filter(
        // Primary has empty verificationStatus; everything else must be "accepted".
        (a) =>
          !!a.sendAsEmail &&
          (a.isPrimary || !a.verificationStatus || a.verificationStatus === "accepted"),
      )
      .map((a) => ({
        sendAsEmail: a.sendAsEmail!,
        displayName: a.displayName ?? "",
        isDefault: !!a.isDefault,
      }));

    return NextResponse.json({ aliases });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "sendAs list failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
