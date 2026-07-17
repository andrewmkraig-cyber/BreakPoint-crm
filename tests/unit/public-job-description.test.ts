import { normalizePublicJobDescription } from "@/lib/public-job-description";

let passed = 0;
function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  passed++;
}

const malformed = [
  "A Bit About Us:",
  "Our client is a strong firm.",
  "",
  "Why Join Us?",
  "-Work alongside experienced Partners",
  "-Join a growing assurance practice",
  "",
  "Job Details:",
  "",
  "Key Responsibilities and Duties:",
  "-Lead and manage financial statement audits",
  "",
  "You Should Have Most of the Following:",
  "-Current and active CPA license",
].join("\n");

const normalized = normalizePublicJobDescription(malformed);

assert(normalized.includes("## A Bit About Us"), "normalizes plain A Bit About Us heading");
assert(normalized.includes("## Why Join Us"), "normalizes Why Join Us heading with question mark");
assert(normalized.includes("- Work alongside experienced Partners"), "adds missing bullet spacing");
assert(normalized.includes("### Key Responsibilities and Duties"), "normalizes nested responsibility heading");
assert(normalized.includes("### You Should Have Most of the Following"), "normalizes nested qualification heading");
assert(!normalized.includes("-Work"), "removes tight dash bullets");

const alreadyMarkdown = [
  "## Why Join Us",
  "",
  "- Hybrid schedule",
  "- Strong mentorship",
].join("\n");

assert(
  normalizePublicJobDescription(alreadyMarkdown) === alreadyMarkdown,
  "leaves already-normalized markdown unchanged",
);

console.log(`PASS: public job description normalization (${passed} assertions)`);
