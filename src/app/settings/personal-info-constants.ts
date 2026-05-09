export const TSHIRT_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "3XL"] as const;
export type TshirtSize = (typeof TSHIRT_SIZES)[number];

export type PersonalInfoRow = {
  birthday: string | null; // YYYY-MM-DD, calendar date, no timezone
  address: string | null;
  tshirtSize: string | null;
};
