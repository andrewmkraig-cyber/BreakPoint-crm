// Pure helpers for normalizing Quo (OpenPhone) webhook phone fields.
// Extracted from the webhook route so they can be unit-tested
// without importing the route module (which pulls in Prisma, web-push,
// and next/server). No side-effect imports here on purpose.

// Resolve a dot-path ("data.object.from") against a nested object,
// returning undefined if any segment is missing. Mirrors the route's
// own getPath so callers can pass the same path strings.
function resolvePath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (
      acc &&
      typeof acc === "object" &&
      key in (acc as Record<string, unknown>)
    ) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

// Keys Quo has been seen to wrap a phone number under when it delivers
// the from/to field as an object instead of a bare string.
const PHONE_OBJECT_KEYS = [
  "number",
  "phoneNumber",
  "phone_number",
  "e164",
  "value",
] as const;

// Like the route's pickStr, but tolerant of object-shaped phone values.
// Tries each path in order: a string/number resolves exactly as pickStr
// would, and an object is unwrapped by probing the common nested fields.
// This is what stops a `data.object.from: { number: "+1..." }` payload
// from silently falling through to the missing-fromNumber skip.
export function pickPhone(obj: unknown, paths: string[]): string | undefined {
  for (const p of paths) {
    const v = resolvePath(obj, p);
    if (typeof v === "string" && v.length > 0) return v;
    if (typeof v === "number") return String(v);
    if (Array.isArray(v)) {
      for (const item of v) {
        if (typeof item === "string" && item.length > 0) return item;
        if (typeof item === "number") return String(item);
        if (item && typeof item === "object") {
          const o = item as Record<string, unknown>;
          for (const k of PHONE_OBJECT_KEYS) {
            const nested = o[k];
            if (typeof nested === "string" && nested.length > 0) return nested;
            if (typeof nested === "number") return String(nested);
          }
        }
      }
    }
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      for (const k of PHONE_OBJECT_KEYS) {
        const nested = o[k];
        if (typeof nested === "string" && nested.length > 0) return nested;
        if (typeof nested === "number") return String(nested);
      }
    }
  }
  return undefined;
}

// Redact a phone number for logging: last 4 digits only, never the full
// value. Returns "(none)" when there are no digits to show. Used so the
// webhook can log which number a push was about without leaking PII.
export function redactPhone(v: string | undefined | null): string {
  if (!v) return "(none)";
  const digits = v.replace(/\D/g, "");
  return digits ? `...${digits.slice(-4)}` : "(none)";
}
