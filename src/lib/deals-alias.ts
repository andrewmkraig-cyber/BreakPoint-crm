import { DEALS_FROM_EMAIL } from "@/lib/deal-announcement";
import { getFreshAccessToken } from "@/lib/gmail";

// Whether deals@ is a verified "Send mail as" on this user's Gmail.
//
// This check matters because Gmail does NOT error when it isn't: it
// silently REWRITES the From header to the account's own address and
// reports a successful send. Without asking first, a teammate who hasn't
// added the alias would produce deal mail that looks personal, and nothing
// would signal that anything went wrong.
//
// Each person who announces or cancels deals adds the alias once under
// Gmail Settings, Accounts, "Send mail as".
//
// Returns false rather than throwing on an API failure: callers treat that
// as "can't confirm, don't claim deals@", which is the safe direction.
export async function canSendAsDeals(userId: string): Promise<boolean> {
  try {
    const accessToken = await getFreshAccessToken(userId);
    const res = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs",
      { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" },
    );
    if (!res.ok) return false;
    const json = (await res.json()) as {
      sendAs?: Array<{
        sendAsEmail?: string;
        isPrimary?: boolean;
        verificationStatus?: string;
      }>;
    };
    return (json.sendAs ?? []).some(
      (a) =>
        a.sendAsEmail?.toLowerCase() === DEALS_FROM_EMAIL &&
        (a.isPrimary ||
          !a.verificationStatus ||
          a.verificationStatus === "accepted"),
    );
  } catch {
    return false;
  }
}
