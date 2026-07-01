import assert from "node:assert/strict";
import { normalizeCandidateNameForMatching } from "../../src/lib/resume-filename";

assert.equal(
  normalizeCandidateNameForMatching("Brian-Wallace-resume.pdf"),
  "Brian Wallace",
);

assert.equal(
  normalizeCandidateNameForMatching("HUNTER-PATTERSON-resume.pdf"),
  "Hunter Patterson",
);

assert.equal(
  normalizeCandidateNameForMatching("Scott Jumawan-Spahr Resume.docx"),
  "Scott Jumawan-Spahr",
);

assert.equal(
  normalizeCandidateNameForMatching("Jennifer_Smith_CPA_2026_resume.doc"),
  "Jennifer Smith",
);

assert.equal(
  normalizeCandidateNameForMatching("Jennifer Smith CPA.docx"),
  "Jennifer Smith",
);

console.log("resume-filename tests passed");
