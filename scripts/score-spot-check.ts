// Inline regression check: confirm the brief's headline case.
// Senior Tax Accountant (5 yrs tenured, mentoring + client ownership)
// vs Tax Manager role should score high, not penalty-low.

import { computeMatchScore } from "../src/lib/match-scoring";

const candidate = {
  id: "test-senior-tax",
  currentDesignation: "Senior Tax Accountant",
  currentOrganization: "Mid-size CPA Firm",
  skills: ["tax", "audit", "CPA", "tax planning", "client management"],
  experience: [
    {
      title: "Senior Tax Accountant",
      organization: "Mid-size CPA Firm",
      startDate: "2021-01-01",
      endDate: "",
      description: "Managed a team of 3 tax associates, mentored junior staff, owned client relationships across a 40-client book.",
    },
    {
      title: "Tax Accountant",
      organization: "Regional CPA",
      startDate: "2019-06-01",
      endDate: "2020-12-31",
      description: "Prepared individual and corporate returns.",
    },
  ],
  expectedSalary: { number: 95000, currency: "USD" },
  location: "Cleveland, OH",
  lat: null,
  lng: null,
  resumeText: "Managed a team of 3 tax associates and mentored junior staff. Owned client relationships across a 40-client book. CPA. Tax planning and tax compliance.",
};

const job = {
  id: "test-job-tax-mgr",
  title: "Tax Manager",
  description: "Looking for a Tax Manager to lead our tax practice. Responsibilities include managing a team, owning client relationships, and overseeing tax compliance and tax planning. CPA required.",
  searchKeywords: "tax, CPA, tax planning, client management, team management",
  salaryRangeStart: 90000,
  salaryRangeEnd: 130000,
  locations: ["Cleveland, OH"],
  locationCity: "Cleveland",
  locationState: "OH",
  locationZip: null,
};

const result = computeMatchScore(candidate, job);
console.log("FINAL SCORE:", result.score);
console.log("---");
console.log("rationale:", result.rationale);
console.log("---");
console.log(JSON.stringify(result.subScores, null, 2));

// Regression check: exact-title penalty case. The OLD Claude scorer
// dropped this candidate to 66 because title wasn't exact. The new
// deterministic scorer should give >= 80.
if (result.score < 80) {
  console.error("FAIL: senior-to-manager promotion candidate scored", result.score, "expected >= 80");
  process.exit(1);
}
console.log("\nPASS: senior-to-manager promotion fit scored", result.score);

// Negative control: different function (Engineer for Tax Manager)
// should score low.
const wrongFn = computeMatchScore(
  {
    ...candidate,
    currentDesignation: "Senior Software Engineer",
    skills: ["javascript", "typescript", "react", "node"],
    experience: [
      { title: "Senior Software Engineer", organization: "Acme Inc", startDate: "2021-01-01", endDate: "" },
    ],
  },
  job,
);
console.log("\nNegative control (Engineer vs Tax Manager):", wrongFn.score);
if (wrongFn.score >= 60) {
  console.error("FAIL: cross-function candidate scored too high");
  process.exit(1);
}
console.log("PASS: cross-function candidate scored low as expected");

// Same-function same-level baseline.
const sameLevel = computeMatchScore(
  { ...candidate, currentDesignation: "Tax Manager" },
  job,
);
console.log("\nSame-level baseline (Tax Manager vs Tax Manager):", sameLevel.score);
if (sameLevel.score < 85) {
  console.error("FAIL: same-level same-function candidate scored", sameLevel.score, "expected >= 85");
  process.exit(1);
}
console.log("PASS: same-level same-function scored", sameLevel.score);

// One level above (overqualified) — should be moderate, NOT promotion-fit.
const overqualified = computeMatchScore(
  { ...candidate, currentDesignation: "Senior Tax Manager" },
  job,
);
console.log("\nOverqualified (Senior Tax Manager vs Tax Manager):", overqualified.score);

console.log("\nAll spot checks PASS.");
