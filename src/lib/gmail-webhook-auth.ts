export type GmailWebhookSecretDecision =
  | { accepted: true; reason: "matched" | "missing-secret-fallback" }
  | { accepted: false; reason: "mismatch" };

export function checkGmailWebhookSecret({
  expected,
  provided,
}: {
  expected: string | undefined;
  provided: string | null;
}): GmailWebhookSecretDecision {
  const normalizedExpected = expected?.trim() ?? "";
  if (!normalizedExpected) {
    return { accepted: true, reason: "missing-secret-fallback" };
  }
  if (provided === normalizedExpected) {
    return { accepted: true, reason: "matched" };
  }
  return { accepted: false, reason: "mismatch" };
}
