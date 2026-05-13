const KNOWN_TOOLS: { name: string; keywords: string[] }[] = [
  { name: "Apollo", keywords: ["apollo.io", "apollo inc", "apollo"] },
  { name: "Pin", keywords: ["pin.com", "pin inc"] },
  { name: "LinkedIn", keywords: ["linkedin"] },
  { name: "Indeed", keywords: ["indeed"] },
  { name: "Google", keywords: ["google"] },
  { name: "Vercel", keywords: ["vercel"] },
  { name: "Neon", keywords: ["neon tech", "neon database"] },
  { name: "Zoom", keywords: ["zoom"] },
  { name: "Loom", keywords: ["loom"] },
  { name: "ChatGPT", keywords: ["openai", "chatgpt"] },
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
