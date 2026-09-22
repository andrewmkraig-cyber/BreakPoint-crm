import { DEALS_FROM_EMAIL } from "@/lib/deal-announcement";
import { getFreshAccessToken } from "@/lib/gmail";

// Whether an address is a verified "Send mail as" on this user's Gmail.
//
// This check matters because Gmail does NOT error when it isn't: it
// silently REWRITES the From header to the account's own address and
// reports a successful send. Without asking first, a teammate who hasn't
// added the alias would produce mail that looks personal, and nothing
// would signal that anything went wrong.
//
// Each person who sends as an alias adds it once under Gmail Settings,
// Accounts, "Send mail as". Returns null rather than throwing on an API
// failure: callers treat that as "can't confirm, don't claim the alias",
// which is the safe direction. On a match the alias's Gmail display name
// comes back so the From label can read as the alias, not the person.
export type VerifiedSendAs = { sendAsEmail: string; displayName: string };

export async function findVerifiedSendAs(
  userId: string,
  email: string,
): Promise<VerifiedSendAs | null> {
  const wanted = email.trim().toLowerCase();
  if (!wanted) return null;
  try {
    const accessToken = await getFreshAccessToken(userId);
    const res = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs",
      { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      sendAs?: Array<{
        sendAsEmail?: string;
        displayName?: string;
        isPrimary?: boolean;
        verificationStatus?: string;
      }>;
    };
    const match = (json.sendAs ?? []).find(
      (a) =>
        a.sendAsEmail?.toLowerCase() === wanted &&
        (a.isPrimary ||
          !a.verificationStatus ||
          a.verificationStatus === "accepted"),
    );
    if (!match?.sendAsEmail) return null;
    return { sendAsEmail: match.sendAsEmail, displayName: match.displayName ?? "" };
  } catch {
    return null;
  }
}

// deals@ is the original caller of this check (the announcement refuses
// without it; the cancellation notice falls back and says so).
export async function canSendAsDeals(userId: string): Promise<boolean> {
  return (await findVerifiedSendAs(userId, DEALS_FROM_EMAIL)) != null;
}
