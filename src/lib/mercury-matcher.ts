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
  domain?: string;
}[] = [
  { name: "Apollo", keywords: ["apollo.io", "apollo"], category: "Software", domain: "apollo.io" },
  { name: "Pin", keywords: ["pin.com", "pin com", "pin,com", "pin .com", "pin, com"], category: "Software", domain: "pin.com" },
  { name: "Anthropic / Claude", keywords: ["anthropic", "claude.ai", "claude team"], category: "Software", domain: "anthropic.com" },
  { name: "Ringover", keywords: ["ringover"], category: "Communications", domain: "ringover.com" },
  { name: "Vercel", keywords: ["vercel"], category: "Hosting", domain: "vercel.com" },
  { name: "Neon", keywords: ["neon database", "neon tech", "neon.tech", "neon"], category: "Hosting", domain: "neon.tech" },
  { name: "OpenAI / ChatGPT", keywords: ["openai", "chatgpt"], category: "Software", domain: "openai.com" },
  { name: "Slack", keywords: ["slack"], category: "Communications", domain: "slack.com" },
  { name: "QuickBooks", keywords: ["quickbooks", "intuit *quickbooks"], category: "Software", domain: "quickbooks.intuit.com" },
  { name: "GoDaddy", keywords: ["godaddy"], category: "Hosting", domain: "godaddy.com" },
  { name: "Amazon", keywords: ["amazon mktplace", "amazon"], category: "Equipment", domain: "amazon.com" },
  { name: "Apple", keywords: ["apple.com"], category: "Equipment", domain: "apple.com" },
  { name: "Krispcall", keywords: ["krispcall"], category: "Communications", domain: "krispcall.com" },
  { name: "Mercury", keywords: ["mercury subscription"], category: "Banking", domain: "mercury.com" },
  { name: "Recruiterflow", keywords: ["recruiterflow"], category: "Software", domain: "recruiterflow.com" },
  { name: "Zoho", keywords: ["zoho"], category: "Software", domain: "zoho.com" },
  { name: "OpenPhone / Quo", keywords: ["quo", "openphone"], category: "Communications", domain: "quo.com" },
  { name: "TheirStack", keywords: ["theirstack"], category: "Software", domain: "theirstack.com" },
];

export function matchTransaction(description: string): string | null {
  const haystack = description.toLowerCase();
  // Diagnostic log to confirm the exact bankDescription Mercury sends
  // for Pin.com charges — we've seen variants like "Pin.com", "Pin,com",
  // and " PIN .COM" land in production. Surfaces in Vercel logs.
  if (haystack.includes("pin")) {
    console.log(`[mercury-matcher] pin-substring txn description=${JSON.stringify(description)}`);
  }
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

export function domainForTool(name: string): string | null {
  const lower = name.toLowerCase();
  const hit = KNOWN_TOOLS.find((t) => t.name.toLowerCase() === lower);
  return hit?.domain ?? null;
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
