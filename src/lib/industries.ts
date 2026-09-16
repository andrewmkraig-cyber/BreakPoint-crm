// The one client industry list. Both client forms (new-client-form.tsx and
// editable-company.tsx) pick from it, and the Placements dashboard folds
// every stored value through canonicalIndustry() before grouping.
//
// Why: the two forms used to carry different lists. The edit form offered
// "Accounting" and "Financial Services" as separate choices and older rows
// held "Accounting & Finance" / "Software Development", so the By Industry
// panel split one book of CPA firms across two rows. Finance and accounting
// are one category here.

export const INDUSTRY_OPTIONS = [
  "Financial Services",
  "Software / Technology",
  "Healthcare",
  "Manufacturing",
  "Food / Beverage",
  "Professional Services",
  "Legal",
  "Engineering",
  "Retail / E-commerce",
  "Real Estate",
  "Energy",
  "Media / Marketing",
  "Non-profit",
  "Education",
  "Telecommunications",
  "Transportation / Logistics",
  "Hospitality",
  "Other",
] as const;

export type IndustryOption = (typeof INDUSTRY_OPTIONS)[number];

// Legacy / synonym spellings that have shown up in Client.industry, mapped
// to the option they mean. Keys are lowercase and trimmed.
const LEGACY_INDUSTRY: Record<string, IndustryOption> = {
  accounting: "Financial Services",
  "accounting & finance": "Financial Services",
  "accounting and finance": "Financial Services",
  finance: "Financial Services",
  "finance & accounting": "Financial Services",
  banking: "Financial Services",
  "investment management": "Financial Services",
  "wealth management": "Financial Services",
  technology: "Software / Technology",
  software: "Software / Technology",
  "software development": "Software / Technology",
  "information technology": "Software / Technology",
  "food/beverage": "Food / Beverage",
  "food & beverage": "Food / Beverage",
  "food and beverage": "Food / Beverage",
  "food and beverage services": "Food / Beverage",
  "non profit": "Non-profit",
  nonprofit: "Non-profit",
  "retail": "Retail / E-commerce",
  "e-commerce": "Retail / E-commerce",
  "media": "Media / Marketing",
  "marketing": "Media / Marketing",
  "logistics": "Transportation / Logistics",
  "transportation": "Transportation / Logistics",
};

// Returns the canonical option for a stored industry value. An exact
// (case-insensitive) option wins, then the legacy map; anything else passes
// through trimmed so an unexpected value is still shown rather than hidden.
export function canonicalIndustry(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  const exact = INDUSTRY_OPTIONS.find((opt) => opt.toLowerCase() === lower);
  if (exact) return exact;
  return LEGACY_INDUSTRY[lower] ?? trimmed;
}

// Best-effort match for free text from a website parse ("fintech startup",
// "CPA firm"). Finance keywords are checked before the professional-services
// ones so accounting firms land in Financial Services.
export function matchIndustry(raw: string): IndustryOption | null {
  const lower = raw.toLowerCase().trim();
  if (!lower) return null;
  const canonical = canonicalIndustry(lower);
  if ((INDUSTRY_OPTIONS as readonly string[]).includes(canonical)) {
    return canonical as IndustryOption;
  }
  for (const opt of INDUSTRY_OPTIONS) {
    if (opt.toLowerCase().includes(lower) || lower.includes(opt.toLowerCase())) return opt;
  }
  if (/\b(bank|financ|fintech|capital|invest|account|cpa|tax|audit|wealth)/.test(lower)) return "Financial Services";
  if (/\b(software|saas|tech|ai|platform)\b/.test(lower)) return "Software / Technology";
  if (/\b(health|medic|pharma|biotech|hospital)/.test(lower)) return "Healthcare";
  if (/\b(manufactur|industrial|factory)/.test(lower)) return "Manufacturing";
  if (/\b(food|beverage|restaurant|brew|vending)/.test(lower)) return "Food / Beverage";
  if (/\b(consult|professional service|legal|law)\b/.test(lower)) return "Professional Services";
  if (/\b(engineer)/.test(lower)) return "Engineering";
  if (/\b(retail|e-?commerce|shop)\b/.test(lower)) return "Retail / E-commerce";
  if (/\b(real estate|property|realty)\b/.test(lower)) return "Real Estate";
  if (/\b(energy|oil|gas|utility|solar)\b/.test(lower)) return "Energy";
  if (/\b(media|market|advertis|agency|pr)\b/.test(lower)) return "Media / Marketing";
  if (/\b(educat|school|university)/.test(lower)) return "Education";
  if (/\b(telecom|wireless|isp)\b/.test(lower)) return "Telecommunications";
  if (/\b(transport|logistic|freight|shipping)/.test(lower)) return "Transportation / Logistics";
  if (/\b(hotel|hospitality|restaur)/.test(lower)) return "Hospitality";
  return null;
}
