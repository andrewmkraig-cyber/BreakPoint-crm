import assert from "node:assert/strict";
import { checkGmailWebhookSecret } from "@/lib/gmail-webhook-auth";

assert.deepEqual(
  checkGmailWebhookSecret({ expected: "abc123", provided: "abc123" }),
  { accepted: true, reason: "matched" },
);

assert.deepEqual(
  checkGmailWebhookSecret({ expected: "abc123", provided: "wrong" }),
  { accepted: false, reason: "mismatch" },
);

assert.deepEqual(
  checkGmailWebhookSecret({ expected: "", provided: null }),
  { accepted: true, reason: "missing-secret-fallback" },
);

assert.deepEqual(
  checkGmailWebhookSecret({ expected: undefined, provided: "legacy-url-secret" }),
  { accepted: true, reason: "missing-secret-fallback" },
);

console.log("gmail-webhook-auth tests passed");
