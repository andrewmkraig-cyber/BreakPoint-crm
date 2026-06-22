import { buildJobsXml } from "@/lib/jobs-feed-xml";
import type { PublicWebsiteJob } from "@/lib/public-jobs";

let passed = 0;
function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  passed++;
}

function sampleJob(overrides: Partial<PublicWebsiteJob> = {}): PublicWebsiteJob {
  return {
    id: "cm-job-123",
    slug: "senior-tax-manager-cleveland-oh-job123",
    title: "Senior Tax Manager & Advisor",
    description: "## About the role\n\nLead **tax** work.\n\n<script>bad()</script>",
    company: "Smith & Jones, LLC",
    locations: ["Cleveland, OH 44114"],
    location: { city: "Cleveland", state: "OH", postalCode: "44114", country: "US" },
    employmentType: "Full time",
    workplaceType: "Hybrid",
    hybridSchedule: "3 days",
    salary: { minimum: 120000, maximum: 150000, currency: "usd", frequency: "yearly" },
    applyUrl: null,
    datePosted: "2026-06-22T13:00:00.000Z",
    updatedAt: "2026-06-22T13:00:00.000Z",
    priority: 1,
    eligibleForJobPosting: true,
    ...overrides,
  };
}

const xml = buildJobsXml([sampleJob()]);
assert(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<source>'), "has XML declaration and source root");
assert(xml.endsWith("</source>\n"), "closes the source root");
assert(xml.includes("<referencenumber>cm-job-123</referencenumber>"), "uses the job cuid as reference number");
assert(xml.includes("<title>Senior Tax Manager &amp; Advisor</title>"), "escapes XML text fields");
assert(xml.includes("<company>Smith &amp; Jones, LLC</company>"), "includes the hiring client name");
assert(xml.includes("<description><![CDATA[<h2>About the role</h2>"), "converts Markdown descriptions to HTML CDATA");
assert(!xml.includes("<script>"), "sanitizes description HTML");
assert(xml.includes("<postalcode>44114</postalcode>"), "includes postal code when stored");
assert(xml.includes("<url>https://breakpointtalent.com/jobs/senior-tax-manager-cleveland-oh-job123/</url>"), "links to the public job page");
assert(xml.includes("<jobtype>Full-Time</jobtype>"), "normalizes the job type");
assert(xml.includes("<compensation_currency>USD</compensation_currency>"), "normalizes compensation currency");
assert(xml.includes("<compensation_interval>Annually</compensation_interval>"), "normalizes compensation interval");

const minimalXml = buildJobsXml([sampleJob({
  employmentType: "Seasonal",
  location: { city: "Akron", state: "OH", postalCode: null, country: "US" },
  salary: { minimum: null, maximum: null, currency: null, frequency: null },
})]);
assert(!minimalXml.includes("<postalcode>"), "omits a missing postal code");
assert(!minimalXml.includes("<jobtype>"), "omits an unrecognized job type instead of emitting an invalid value");
assert(!minimalXml.includes("<compensation_"), "omits compensation metadata when no amount is stored");

console.log(`PASS: jobs XML feed (${passed} assertions)`);
