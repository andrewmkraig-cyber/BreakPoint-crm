// Apollo email_accounts fetcher used by the Sending Domains settings
// section to render real mailbox state instead of a hardcoded
// reputation score. Returns null when the API key is missing or the
// call fails so callers can degrade silently to "—".

const APOLLO_BASE = "https://api.apollo.io";

export type ApolloMailbox = {
  email: string;
  domain: string;
  status: "Connected" | "Disconnected";
  // Apollo reports the account as linked but with outbound sending turned
  // off (paused/disabled). Distinct from Disconnected — the mailbox is
  // present, it just won't send. Surfaced as a red "Disabled" chip.
  sendingDisabled: boolean;
  dailyLimit: number | null;
  sentToday: number | null;
};

type ApolloEmailAccountRaw = {
  email?: string;
  active?: boolean;
  status?: string;
  send_limit_per_day?: number;
  daily_email_limit?: number;
  sending_limit_per_day?: number;
  emails_sent_today?: number;
  sent_today?: number;
  emails_sent?: number;
  // Sending-disabled signals. Apollo's shape varies by account type, so
  // accept any of the known flags / a "disabled" status string.
  sending_disabled?: boolean;
  is_sending_disabled?: boolean;
  sending_enabled?: boolean;
};

function domainFromEmail(email: string): string {
  const at = email.lastIndexOf("@");
  return at < 0 ? "" : email.slice(at + 1).toLowerCase();
}

function pickNumber(...vals: Array<number | undefined>): number | null {
  for (const v of vals) if (typeof v === "number" && !Number.isNaN(v)) return v;
  return null;
}

export async function fetchApolloMailboxes(): Promise<ApolloMailbox[] | null> {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(`${APOLLO_BASE}/api/v1/email_accounts`, {
      method: "GET",
      headers: {
        "X-Api-Key": apiKey,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as
      | { email_accounts?: ApolloEmailAccountRaw[] }
      | ApolloEmailAccountRaw[]
      | null;
    const list = Array.isArray(data) ? data : data?.email_accounts;
    if (!Array.isArray(list)) return null;

    const out: ApolloMailbox[] = [];
    for (const a of list) {
      const email = (a.email ?? "").trim().toLowerCase();
      if (!email) continue;
      const statusStr = typeof a.status === "string" ? a.status.toLowerCase() : "";
      const isActive =
        typeof a.active === "boolean"
          ? a.active
          : statusStr
            ? statusStr === "active" || statusStr === "connected"
            : true;
      const sendingDisabled =
        a.sending_disabled === true ||
        a.is_sending_disabled === true ||
        a.sending_enabled === false ||
        statusStr.includes("disabled");
      out.push({
        email,
        domain: domainFromEmail(email),
        status: isActive ? "Connected" : "Disconnected",
        sendingDisabled,
        dailyLimit: pickNumber(a.send_limit_per_day, a.daily_email_limit, a.sending_limit_per_day),
        sentToday: pickNumber(a.emails_sent_today, a.sent_today, a.emails_sent),
      });
    }
    return out;
  } catch {
    return null;
  }
}
