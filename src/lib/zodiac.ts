// Date → tropical zodiac sign. Boundaries follow the standard ranges
// used by Western astrology (e.g. Aries: Mar 21 – Apr 19). Returns the
// lowercase API key matching ALLOWED_SIGNS in /api/horoscope, plus a
// display name and unicode glyph for the dashboard chip.

export type ZodiacSign =
  | "aries"
  | "taurus"
  | "gemini"
  | "cancer"
  | "leo"
  | "virgo"
  | "libra"
  | "scorpio"
  | "sagittarius"
  | "capricorn"
  | "aquarius"
  | "pisces";

export const ZODIAC_DISPLAY: Record<ZodiacSign, { name: string; glyph: string }> = {
  aries: { name: "Aries", glyph: "♈" },
  taurus: { name: "Taurus", glyph: "♉" },
  gemini: { name: "Gemini", glyph: "♊" },
  cancer: { name: "Cancer", glyph: "♋" },
  leo: { name: "Leo", glyph: "♌" },
  virgo: { name: "Virgo", glyph: "♍" },
  libra: { name: "Libra", glyph: "♎" },
  scorpio: { name: "Scorpio", glyph: "♏" },
  sagittarius: { name: "Sagittarius", glyph: "♐" },
  capricorn: { name: "Capricorn", glyph: "♑" },
  aquarius: { name: "Aquarius", glyph: "♒" },
  pisces: { name: "Pisces", glyph: "♓" },
};

export function zodiacFromDate(date: Date): ZodiacSign {
  // Use UTC components so a Date stored as a calendar day in Postgres
  // (`@db.Date`) — which Prisma hydrates as midnight UTC — can't drift
  // a day across the boundary in westward timezones.
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  if ((m === 3 && d >= 21) || (m === 4 && d <= 19)) return "aries";
  if ((m === 4 && d >= 20) || (m === 5 && d <= 20)) return "taurus";
  if ((m === 5 && d >= 21) || (m === 6 && d <= 20)) return "gemini";
  if ((m === 6 && d >= 21) || (m === 7 && d <= 22)) return "cancer";
  if ((m === 7 && d >= 23) || (m === 8 && d <= 22)) return "leo";
  if ((m === 8 && d >= 23) || (m === 9 && d <= 22)) return "virgo";
  if ((m === 9 && d >= 23) || (m === 10 && d <= 22)) return "libra";
  if ((m === 10 && d >= 23) || (m === 11 && d <= 21)) return "scorpio";
  if ((m === 11 && d >= 22) || (m === 12 && d <= 21)) return "sagittarius";
  if ((m === 12 && d >= 22) || (m === 1 && d <= 19)) return "capricorn";
  if ((m === 1 && d >= 20) || (m === 2 && d <= 18)) return "aquarius";
  return "pisces";
}
