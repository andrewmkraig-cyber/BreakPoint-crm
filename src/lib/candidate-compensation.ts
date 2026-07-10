import {
  formatPlacementCompensation,
  type PlacementCompensationType,
} from "@/lib/placement-compensation";

export type ExpectedCompensationType = PlacementCompensationType;

export function getExpectedCompensationType(raw: unknown): ExpectedCompensationType {
  const value =
    typeof raw === "string"
      ? raw
      : raw && typeof raw === "object"
        ? pickTypeValue(raw as Record<string, unknown>)
        : null;
  if (typeof value !== "string") return "salary";
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "hourly" ||
    normalized === "hour" ||
    normalized === "hr" ||
    normalized === "/hr" ||
    normalized === "per hour" ||
    normalized === "per_hour" ||
    normalized.includes("hour")
  ) {
    return "hourly";
  }
  return "salary";
}

export function formatExpectedCompensation(raw: unknown): string {
  const parsed = readExpectedCompensation(raw);
  if (!parsed) return "";
  const { value, currency, type } = parsed;
  if (type === "hourly") {
    const formatted = formatPlacementCompensation(value, currency, "hourly");
    return formatted === "-" ? "" : formatted;
  }
  const prefix = currency === "USD" ? "$" : `${currency} `;
  if (value >= 1000) {
    const k = value / 1000;
    return `${prefix}${k.toFixed(value % 1000 === 0 ? 0 : 1)}k`;
  }
  return `${prefix}${Math.round(value).toLocaleString()}`;
}

export function formatExpectedCompensationFull(raw: unknown): string {
  const parsed = readExpectedCompensation(raw);
  if (!parsed) return "";
  const { value, currency, type } = parsed;
  if (type === "hourly") {
    const formatted = formatPlacementCompensation(value, currency, "hourly");
    return formatted === "-" ? "" : formatted;
  }
  const prefix = currency === "USD" ? "$" : `${currency} `;
  return `${prefix}${Math.round(value).toLocaleString("en-US")}`;
}

export function extractCityFromLocation(location: string | null | undefined): string {
  const trimmed = (location ?? "").trim();
  if (!trimmed) return "";
  return trimmed.split(",")[0]?.trim() || trimmed;
}

function readExpectedCompensation(raw: unknown): {
  value: number;
  currency: string;
  type: ExpectedCompensationType;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as { number?: unknown; currency?: unknown };
  const value =
    typeof obj.number === "number" && Number.isFinite(obj.number)
      ? obj.number
      : typeof obj.number === "string" && obj.number.trim()
        ? Number(obj.number)
        : null;
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  const currency =
    typeof obj.currency === "string" && obj.currency.trim()
      ? obj.currency.trim().toUpperCase()
      : "USD";
  return { value, currency, type: getExpectedCompensationType(raw) };
}

function pickTypeValue(obj: Record<string, unknown>): unknown {
  return (
    obj.type ??
    obj.compensationType ??
    obj.compensation_type ??
    obj.frequency ??
    obj.interval ??
    obj.payType ??
    obj.pay_type
  );
}
