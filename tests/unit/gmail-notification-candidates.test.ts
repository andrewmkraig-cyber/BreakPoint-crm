import assert from "node:assert/strict";
import {
  collectGmailNotificationMessageRefs,
  isNewMailPollCandidate,
} from "@/lib/gmail-notification-candidates";

assert.deepEqual(
  collectGmailNotificationMessageRefs([
    {
      messagesAdded: [{ message: { id: "message-new", threadId: "thread-new" } }],
      labelsAdded: [
        {
          message: { id: "message-new", threadId: "thread-new" },
          labelIds: ["INBOX", "UNREAD"],
        },
        {
          message: { id: "message-old", threadId: "thread-old" },
          labelIds: ["IMPORTANT"],
        },
      ],
    },
  ]),
  [{ messageId: "message-new", threadId: "thread-new" }],
  "only actual additions and transitions into INBOX are candidates",
);

assert.deepEqual(
  collectGmailNotificationMessageRefs([
    {
      labelsAdded: [
        {
          message: { id: "message-inbox", threadId: "thread-inbox" },
          labelIds: ["INBOX"],
        },
      ],
    },
  ]),
  [{ messageId: "message-inbox", threadId: "thread-inbox" }],
  "a message that newly enters the inbox remains a candidate",
);

const pollAt = Date.parse("2026-06-18T18:00:00.000Z");

assert.equal(
  isNewMailPollCandidate({
    timestampIso: "2026-06-10T18:00:00.000Z",
    previousTimestampIso: undefined,
    previousPollAtMs: pollAt,
  }),
  false,
  "an old Gmail nudge entering the poll window is not new mail",
);

assert.equal(
  isNewMailPollCandidate({
    timestampIso: "2026-06-18T18:00:05.000Z",
    previousTimestampIso: undefined,
    previousPollAtMs: pollAt,
  }),
  true,
  "a newly arrived thread entering the poll window notifies",
);

assert.equal(
  isNewMailPollCandidate({
    timestampIso: "2026-06-18T18:02:00.000Z",
    previousTimestampIso: "2026-06-10T18:00:00.000Z",
    previousPollAtMs: pollAt,
  }),
  true,
  "a real reply in an existing thread notifies",
);

assert.equal(
  isNewMailPollCandidate({
    timestampIso: "2026-06-10T18:00:00.000Z",
    previousTimestampIso: "2026-06-10T18:00:00.000Z",
    previousPollAtMs: pollAt,
  }),
  false,
  "a resurfaced thread with the same last message stays quiet",
);

console.log("gmail-notification-candidates tests passed");
