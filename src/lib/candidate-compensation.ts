export function formatExpectedCompensation(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const obj = raw as { number?: unknown; currency?: unknown };
  const value =
    typeof obj.number === "number" && Number.isFinite(obj.number)
      ? obj.number
      : typeof obj.number === "string" && obj.number.trim()
        ? Number(obj.number)
        : null;
  if (value == null || !Number.isFinite(value) || value <= 0) return "";

  const currency =
    typeof obj.currency === "string" && obj.currency.trim()
      ? obj.currency.trim().toUpperCase()
      : "USD";
  const prefix = currency === "USD" ? "$" : `${currency} `;
  if (value >= 1000) {
    const k = value / 1000;
    return `${prefix}${k.toFixed(value % 1000 === 0 ? 0 : 1)}k`;
  }
  return `${prefix}${Math.round(value).toLocaleString()}`;
}

export function extractCityFromLocation(location: string | null | undefined): string {
  const trimmed = (location ?? "").trim();
  if (!trimmed) return "";
  return trimmed.split(",")[0]?.trim() || trimmed;
}
