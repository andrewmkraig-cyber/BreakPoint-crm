const KNOWN_TOOLS: { name: string; keywords: string[] }[] = [
  { name: "Apollo", keywords: ["apollo.io", "apollo"] },
  { name: "Pin", keywords: ["pin.com"] },
  { name: "Anthropic / Claude", keywords: ["anthropic", "claude.ai", "claude team"] },
  { name: "Ringover", keywords: ["ringover"] },
  { name: "Vercel", keywords: ["vercel"] },
  { name: "OpenAI / ChatGPT", keywords: ["openai", "chatgpt"] },
  { name: "Slack", keywords: ["slack"] },
  { name: "QuickBooks", keywords: ["quickbooks", "intuit *quickbooks"] },
  { name: "GoDaddy", keywords: ["godaddy"] },
  { name: "Amazon", keywords: ["amazon mktplace", "amazon"] },
  { name: "Apple", keywords: ["apple.com"] },
  { name: "Krispcall", keywords: ["krispcall"] },
  { name: "Mercury", keywords: ["mercury subscription"] },
  { name: "Recruiterflow", keywords: ["recruiterflow"] },
  { name: "Zoho", keywords: ["zoho"] },
  { name: "OpenPhone / Quo", keywords: ["quo", "openphone"] },
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
