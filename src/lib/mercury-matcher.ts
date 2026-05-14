// Expense category buckets surfaced in the Financial Performance
// expenses table. Adding a new tool? Pick the bucket that matches how
// the desk thinks about the spend, not what the vendor calls itself
// (e.g. Amazon hardware buys go in "Equipment", not "Software"). If
// none fit, fall back to "Other".
export type ExpenseCategory =
  | "Software"
  | "Hosting"
  | "Communications"
  | "Equipment"
  | "Banking"
  | "Other";

const KNOWN_TOOLS: {
  name: string;
  keywords: string[];
  category: ExpenseCategory;
}[] = [
  { name: "Apollo", keywords: ["apollo.io", "apollo"], category: "Software" },
  { name: "Pin", keywords: ["pin.com"], category: "Software" },
  { name: "Anthropic / Claude", keywords: ["anthropic", "claude.ai", "claude team"], category: "Software" },
  { name: "Ringover", keywords: ["ringover"], category: "Communications" },
  { name: "Vercel", keywords: ["vercel"], category: "Hosting" },
  { name: "Neon", keywords: ["neon database", "neon tech", "neon.tech", "neon"], category: "Hosting" },
  { name: "OpenAI / ChatGPT", keywords: ["openai", "chatgpt"], category: "Software" },
  { name: "Slack", keywords: ["slack"], category: "Communications" },
  { name: "QuickBooks", keywords: ["quickbooks", "intuit *quickbooks"], category: "Software" },
  { name: "GoDaddy", keywords: ["godaddy"], category: "Hosting" },
  { name: "Amazon", keywords: ["amazon mktplace", "amazon"], category: "Equipment" },
  { name: "Apple", keywords: ["apple.com"], category: "Equipment" },
  { name: "Krispcall", keywords: ["krispcall"], category: "Communications" },
  { name: "Mercury", keywords: ["mercury subscription"], category: "Banking" },
  { name: "Recruiterflow", keywords: ["recruiterflow"], category: "Software" },
  { name: "Zoho", keywords: ["zoho"], category: "Software" },
  { name: "OpenPhone / Quo", keywords: ["quo", "openphone"], category: "Communications" },
  { name: "TheirStack", keywords: ["theirstack"], category: "Software" },
];

export function matchTransaction(description: string): string | null {
  const haystack = description.toLowerCase();
  for (const tool of KNOWN_TOOLS) {
    for (const keyword of tool.keywords) {
      if (haystack.includes(keyword)) return tool.name;
    }
  }
  return null;
}

export function categoryForTool(name: string): ExpenseCategory {
  const lower = name.toLowerCase();
  const hit = KNOWN_TOOLS.find((t) => t.name.toLowerCase() === lower);
  return hit?.category ?? "Other";
}

// Filters out transactions that aren't tool/subscription spend and would
// otherwise pollute the Expenses card: owner payments to ourselves
// (AEJ VENTURES, BRANZINO), Mercury's own internal cashback/autopay
// movements, and account-verification micro-deposits.
export function shouldIgnoreTransaction(t: {
  bankDescription?: string | null;
  counterpartyName?: string | null;
}): boolean {
  const cp = (t.counterpartyName ?? "").toLowerCase();
  const bd = (t.bankDescription ?? "").trim();
  const bdLower = bd.toLowerCase();
  if (cp.includes("aej ventures")) return true;
  if (cp.includes("branzino")) return true;
  if (cp.includes("mercury io cashback")) return true;
  if (bd === "IO AUTOPAY") return true;
  if (bdLower.includes("acctverify")) return true;
  return false;
}
