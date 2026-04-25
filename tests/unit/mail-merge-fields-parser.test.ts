// Standalone parser test for src/lib/mail-merge-fields.ts. Covers the
// dual-format support added in Phase 5A.2: pure {{curly}}, pure [Bracket],
// mixed-syntax, [Job Location] composite expansion, and unknown fields.
//
// Run via: npx tsx tests/unit/mail-merge-fields-parser.test.ts
// Exits non-zero on the first assertion failure so CI / verify scripts
// catch regressions without bringing in a test framework.

import { applyMailMergeFields, normalizeBrackets } from "@/lib/mail-merge-fields";

const fullCtx = {
  candidate: {
    firstName: "Sidney",
    lastName: "Long",
    email: "sidney@example.com",
    currentTitle: "Tax Manager",
    currentCompany: "Big Four LLP",
  },
  job: {
    title: "Tax Senior",
    clientName: "Sheehan Brothers",
    city: "Dayton",
    state: "OH",
    description: "Reviews complex returns; mentors juniors.",
  },
  client: {
    name: "Sheehan Brothers",
    primaryContactFirstName: "Patrick",
  },
  user: {
    firstName: "Andrew",
    fullName: "Andrew Kraig",
  },
};

let failed = 0;

function eq(name: string, actual: string, expected: string) {
  if (actual === expected) {
    console.log(`PASS  ${name}`);
  } else {
    console.error(`FAIL  ${name}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

function unresolvedEq(name: string, actual: string[], expected: string[]) {
  const a = [...actual].sort().join(",");
  const e = [...expected].sort().join(",");
  if (a === e) {
    console.log(`PASS  ${name}`);
  } else {
    console.error(`FAIL  ${name}\n  expected unresolved: ${e}\n  actual unresolved:   ${a}`);
    failed++;
  }
}

// 1. Pure {{curly}} resolves
{
  const r = applyMailMergeFields("Hi {{candidate.first_name}}, the {{job.title}} role.", fullCtx);
  eq("pure curly resolves", r.output, "Hi Sidney, the Tax Senior role.");
  unresolvedEq("pure curly no unresolved", r.unresolved, []);
}

// 2. Pure [Bracket] resolves
{
  const r = applyMailMergeFields("Hi [Candidate First Name], applying for [Job Title] at [Client Name].", fullCtx);
  eq("pure bracket resolves", r.output, "Hi Sidney, applying for Tax Senior at Sheehan Brothers.");
  unresolvedEq("pure bracket no unresolved", r.unresolved, []);
}

// 3. Mixed syntax — both forms in one body
{
  const r = applyMailMergeFields("Hi [Candidate First Name], the {{job.title}} at [Client Name] is open.", fullCtx);
  eq("mixed syntax", r.output, "Hi Sidney, the Tax Senior at Sheehan Brothers is open.");
}

// 4. [Job Location] composite
{
  const r = applyMailMergeFields("Position is in [Job Location] - any concerns?", fullCtx);
  eq("[Job Location] composite", r.output, "Position is in Dayton, OH - any concerns?");
}

// 5. Unknown bracket token — left literal
{
  const r = applyMailMergeFields("Hi [Candidate First Name], your [Made Up Field] looks great.", fullCtx);
  // [Made Up Field] is not in the bracket map — it stays literal in the output
  eq("unknown bracket left literal", r.output, "Hi Sidney, your [Made Up Field] looks great.");
}

// 6. Unknown {{}} tag — left literal, reported as unresolved
{
  const r = applyMailMergeFields("Hi {{candidate.first_name}}, status: {{job.fake_field}}.", fullCtx);
  eq("unknown {{}} stays literal", r.output, "Hi Sidney, status: {{job.fake_field}}.");
  unresolvedEq("unknown {{}} reported", r.unresolved, ["{{job.fake_field}}"]);
}

// 7. Bracket aliases (RF compat)
{
  const r = applyMailMergeFields("[Client Company Name] / [Candidate Current Employer]", fullCtx);
  eq("RF aliases", r.output, "Sheehan Brothers / Big Four LLP");
}

// 8. Empty context branch — {{job.*}} unresolved when ctx.job missing
{
  const { job: _drop, ...rest } = fullCtx;
  void _drop;
  const noJob = rest;
  const r = applyMailMergeFields("[Job Title] at [Client Name]", noJob);
  // [Client Name] resolves; [Job Title] unresolved → stays as canonical {{job.title}}
  eq("missing job ctx — output", r.output, "{{job.title}} at Sheehan Brothers");
  unresolvedEq("missing job ctx — unresolved", r.unresolved, ["{{job.title}}"]);
}

// 9. normalizeBrackets is exported and idempotent
{
  const once = normalizeBrackets("[Candidate First Name]");
  const twice = normalizeBrackets(once);
  eq("normalizeBrackets idempotent (1)", once, "{{candidate.first_name}}");
  eq("normalizeBrackets idempotent (2)", twice, "{{candidate.first_name}}");
}

if (failed > 0) {
  console.error(`\n${failed} test(s) FAILED`);
  process.exit(1);
}
console.log("\nAll parser tests passed");
