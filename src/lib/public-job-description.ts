const H2_HEADINGS = new Map<string, string>([
  ["a bit about us", "A Bit About Us"],
  ["why join us", "Why Join Us"],
  ["job details", "Job Details"],
]);

const H3_HEADINGS = new Map<string, string>([
  ["key responsibilities and duties", "Key Responsibilities and Duties"],
  ["you should have most of the following", "You Should Have Most of the Following"],
  ["nice to have", "Nice to Have"],
]);

function canonicalHeading(line: string): { level: "h2" | "h3"; text: string } | null {
  const normalized = line
    .replace(/^#{1,6}\s*/, "")
    .replace(/[:?]\s*$/, "")
    .trim()
    .toLowerCase();
  const h2 = H2_HEADINGS.get(normalized);
  if (h2) return { level: "h2", text: h2 };
  const h3 = H3_HEADINGS.get(normalized);
  if (h3) return { level: "h3", text: h3 };
  return null;
}

// Public website cards parse the "Why Join Us" section out of the
// published Markdown description. Older/manually pasted jobs sometimes
// saved plain section labels ("Why Join Us?") and tight bullets
// ("-Work..."), which read fine to humans but do not look like Markdown.
export function normalizePublicJobDescription(description: string): string {
  return description
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      const heading = canonicalHeading(trimmed);
      if (heading) {
        return `${heading.level === "h2" ? "##" : "###"} ${heading.text}`;
      }

      const bullet = line.match(/^(\s*)[-*\u2022]\s*(\S.*)$/);
      if (bullet) {
        return `${bullet[1]}- ${bullet[2].trim()}`;
      }

      return line.replace(/\s+$/, "");
    })
    .join("\n")
    .trim();
}
