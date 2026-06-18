export type GmailNotificationHistoryEntry = {
  messagesAdded?: Array<{
    message?: {
      id?: string;
      threadId?: string;
    };
  }>;
  labelsAdded?: Array<{
    message?: {
      id?: string;
      threadId?: string;
    };
    labelIds?: string[];
  }>;
};

export type GmailNotificationMessageRef = {
  messageId: string;
  threadId: string;
};

// Gmail history contains label changes that have nothing to do with new mail
// (IMPORTANT, STARRED, category changes, and other mailbox bookkeeping). Only
// an actual messageAdded record or an explicit transition into INBOX can be a
// new-mail candidate. This prevents an old unread thread from generating a
// notification merely because Gmail resurfaced or reclassified it.
export function collectGmailNotificationMessageRefs(
  entries: GmailNotificationHistoryEntry[],
): GmailNotificationMessageRef[] {
  const refs: GmailNotificationMessageRef[] = [];
  const seen = new Set<string>();
  const add = (message: { id?: string; threadId?: string } | undefined) => {
    if (!message?.id || !message.threadId) return;
    const key = `${message.id}:${message.threadId}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push({ messageId: message.id, threadId: message.threadId });
  };

  for (const entry of entries) {
    for (const item of entry.messagesAdded ?? []) add(item.message);
    for (const item of entry.labelsAdded ?? []) {
      if (item.labelIds?.includes("INBOX")) add(item.message);
    }
  }

  return refs;
}

const NEW_MAIL_INDEXING_GRACE_MS = 60_000;

function timestampMs(timestampIso: string | null | undefined): number | null {
  if (!timestampIso) return null;
  const parsed = Date.parse(timestampIso);
  return Number.isFinite(parsed) ? parsed : null;
}

// The unread poll only returns a small window of threads. Gmail can move an
// old thread into that window for a reply nudge, so an unseen thread id alone
// is not proof of new mail. A thread qualifies only when its last-message time
// advanced, or (for a thread outside the prior window) when the message itself
// arrived after the previous poll, allowing a short indexing-delay grace.
export function isNewMailPollCandidate({
  timestampIso,
  previousTimestampIso,
  previousPollAtMs,
}: {
  timestampIso: string | null;
  previousTimestampIso: string | null | undefined;
  previousPollAtMs: number;
}): boolean {
  const currentMs = timestampMs(timestampIso);
  if (currentMs === null) return false;

  const previousMs = timestampMs(previousTimestampIso);
  if (previousMs !== null) return currentMs > previousMs;

  return currentMs >= previousPollAtMs - NEW_MAIL_INDEXING_GRACE_MS;
}
