export const TSHIRT_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "3XL"] as const;
export type TshirtSize = (typeof TSHIRT_SIZES)[number];

// Address is split into street/city/state/zip in the form, but
// persisted as a single JSON-encoded string in UserProfile.address so
// we don't have to migrate the schema. Legacy free-text addresses
// (pre-split) degrade into the `street` field on first read.
export type AddressFields = {
  street: string;
  city: string;
  state: string;
  zip: string;
};

export type PersonalInfoRow = {
  birthday: string | null; // YYYY-MM-DD, calendar date, no timezone
  address: AddressFields;
  tshirtSize: string | null;
};

export const EMPTY_ADDRESS: AddressFields = {
  street: "",
  city: "",
  state: "",
  zip: "",
};

// Serialize/parse the AddressFields shape for the single-string column.
// Anything not matching the JSON shape is treated as legacy free-text
// and lands in `street`.
export function serializeAddress(addr: AddressFields): string | null {
  const street = addr.street.trim();
  const city = addr.city.trim();
  const state = addr.state.trim();
  const zip = addr.zip.trim();
  if (!street && !city && !state && !zip) return null;
  return JSON.stringify({ street, city, state, zip });
}

export function parseAddress(raw: string | null): AddressFields {
  if (!raw) return { ...EMPTY_ADDRESS };
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed) as Partial<AddressFields>;
      return {
        street: typeof obj.street === "string" ? obj.street : "",
        city: typeof obj.city === "string" ? obj.city : "",
        state: typeof obj.state === "string" ? obj.state : "",
        zip: typeof obj.zip === "string" ? obj.zip : "",
      };
    } catch {
      // fall through to legacy treatment
    }
  }
  return { street: trimmed, city: "", state: "", zip: "" };
}
