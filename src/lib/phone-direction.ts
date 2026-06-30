export type PhoneDirection = "inbound" | "outbound";

export function normalizePhoneDirection(
  raw: string | null | undefined,
  fallback: PhoneDirection = "inbound",
): PhoneDirection {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "outbound" || value === "outgoing") return "outbound";
  if (value === "inbound" || value === "incoming") return "inbound";
  return fallback;
}

export function isOutboundDirection(raw: string | null | undefined): boolean {
  return normalizePhoneDirection(raw) === "outbound";
}
