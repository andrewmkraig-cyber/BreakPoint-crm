import { prisma } from "@/lib/prisma";

// Helpers for the "Prompt to create client on BD reply" flow. The mail
// thread banner asks the GET endpoint whether it should render; on
// Yes/Skip the client posts back here so future visits to the same
// thread skip the prompt.

export type BdReplyPromptState =
  | { shouldShow: false }
  | {
      shouldShow: true;
      sender: { name: string; email: string; domain: string | null };
      suggestedCompanyName: string | null;
      suggestedContacts: Array<{
        firstName: string;
        lastName: string;
        title: string;
        linkedinUrl: string | null;
      }>;
    };

export async function isThreadPromptDismissed(
  organizationId: string,
  threadId: string,
): Promise<boolean> {
  const row = await prisma.bdReplyPromptDismissal.findUnique({
    where: { organizationId_threadId: { organizationId, threadId } },
    select: { id: true },
  });
  return Boolean(row);
}

export async function dismissThreadPrompt(input: {
  organizationId: string;
  threadId: string;
  action: "CREATED" | "SKIPPED";
}): Promise<void> {
  await prisma.bdReplyPromptDismissal.upsert({
    where: {
      organizationId_threadId: {
        organizationId: input.organizationId,
        threadId: input.threadId,
      },
    },
    create: {
      organizationId: input.organizationId,
      threadId: input.threadId,
      action: input.action,
    },
    update: { action: input.action },
  });
}

export function domainFromEmail(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const d = email.slice(at + 1).trim().toLowerCase();
  return d || null;
}

// Looks up the Apollo organization for a domain. Best-effort: returns
// null when APOLLO_API_KEY is unset, the API rejects, or the response
// shape doesn't carry an org name. Caller falls back to the email's
// domain string as a display label.
export async function fetchApolloCompanyName(domain: string): Promise<string | null> {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) return null;
  const norm = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "");
  if (!norm) return null;
  try {
    const url = new URL("https://api.apollo.io/api/v1/organizations/enrich");
    url.searchParams.set("domain", norm);
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "X-Api-Key": apiKey,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as {
      organization?: { name?: string };
    };
    const name = data.organization?.name?.trim();
    return name && name.length > 0 ? name : null;
  } catch {
    return null;
  }
}
