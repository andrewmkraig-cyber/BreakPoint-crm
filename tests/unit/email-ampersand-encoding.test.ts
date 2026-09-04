// The ampersand bug: a client named "Mowat Mackie & Anderson" reached a sent
// email as "Mowat Mackie &amp; Anderson" - the literal entity, visible to the
// recipient. Two causes, both covered here:
//   1. Text that already carried an encoded entity got escaped a SECOND time
//      ("&amp;" -> "&amp;amp;"), which a mail client renders as "&amp;".
//      Claude emits encoded entities routinely when asked for HTML, and
//      imported company names carry them too.
//   2. Merge values resolved into a PLAIN-TEXT target (subject lines) were
//      HTML-escaped, so "&" became "&amp;" in a field nothing ever decodes.
//
// Run via: npx tsx tests/unit/email-ampersand-encoding.test.ts

import {
  decodeHtmlEntities,
  escapeHtml,
  escapeHtmlAttribute,
  markdownishTextToEmailHtml,
} from "@/lib/ai-output-formatting";
import { applyMailMergeFields } from "@/lib/mail-merge-fields";

let failed = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) console.log(`   expected: ${JSON.stringify(expected)}\n   actual:   ${JSON.stringify(actual)}`);
}

const CLIENT = "Mowat Mackie & Anderson";
const CLIENT_ENCODED = "Mowat Mackie &amp; Anderson";

// 1. A bare ampersand still gets escaped.
{
  eq("bare & escapes", escapeHtml(CLIENT), CLIENT_ENCODED);
  eq("angle brackets escape", escapeHtml("a < b > c"), "a &lt; b &gt; c");
}

// 2. An already-encoded entity is left alone - the double-escape that
//    produced the bug.
{
  eq("named entity untouched", escapeHtml(CLIENT_ENCODED), CLIENT_ENCODED);
  eq("escapeHtml is idempotent", escapeHtml(escapeHtml(CLIENT)), CLIENT_ENCODED);
  eq("decimal entity untouched", escapeHtml("Tom &#39;s"), "Tom &#39;s");
  eq("hex entity untouched", escapeHtml("&#x27;quoted&#x27;"), "&#x27;quoted&#x27;");
  eq("nbsp untouched", escapeHtml("a&nbsp;b"), "a&nbsp;b");
}

// 3. A "&" that only LOOKS like an entity opener is still escaped.
{
  eq("& with no semicolon", escapeHtml("R&D team"), "R&amp;D team");
  eq("& before space", escapeHtml("Smith & Co"), "Smith &amp; Co");
  eq("trailing &", escapeHtml("ends with &"), "ends with &amp;");
  eq("query-string style", escapeHtml("?a=1&b=2"), "?a=1&amp;b=2");
}

// 4. Attribute escaping keeps the same ampersand rule.
{
  eq("attribute bare &", escapeHtmlAttribute(CLIENT), CLIENT_ENCODED);
  eq("attribute encoded &", escapeHtmlAttribute(CLIENT_ENCODED), CLIENT_ENCODED);
  eq("attribute quotes", escapeHtmlAttribute('say "hi"'), "say &quot;hi&quot;");
}

// 5. Claude's plain-text-with-entities output through the email renderer.
//    This is the exact shape the offer email arrived in: prose plus a
//    hyphen list, ampersand already encoded by the model.
{
  const body = [
    `Great news. ${CLIENT_ENCODED} would like to make you an offer.`,
    "",
    "- Title: Senior Tax Accountant",
    `- Firm: ${CLIENT_ENCODED}`,
  ].join("\n");
  const html = markdownishTextToEmailHtml(body);
  eq("renderer does not double-escape", html.includes("&amp;amp;"), false);
  eq(
    "renderer keeps one entity in prose",
    html.includes(`<p>Great news. ${CLIENT_ENCODED} would like to make you an offer.</p>`),
    true,
  );
  eq("renderer keeps one entity in a list item", html.includes(`<li>Firm: ${CLIENT_ENCODED}</li>`), true);
}

// 6. A raw ampersand from Claude renders as exactly one entity.
{
  const html = markdownishTextToEmailHtml(`Offer from ${CLIENT}.`);
  eq("raw & renders once", html, `<p>Offer from ${CLIENT_ENCODED}.</p>`);
}

const ctx = {
  candidate: { firstName: "Austin" },
  job: { title: "Senior Tax Accountant", clientName: CLIENT },
  client: { name: CLIENT },
  user: { firstName: "Andrew" },
};

// 7. Merge fields into an HTML body: one entity, never two.
{
  const r = applyMailMergeFields("<p>Hi {{candidate.first_name}}, {{client.name}} is hiring.</p>", ctx);
  eq("html body merge", r.output, `<p>Hi Austin, ${CLIENT_ENCODED} is hiring.</p>`);
}

// 8. Merge fields into a plain-text subject: a real ampersand, no entity.
//    The subject goes into an <input> and onto the wire as a header;
//    nothing downstream decodes it.
{
  const r = applyMailMergeFields("Offer: {{job.title}} at {{job.client_name}}", ctx);
  eq("subject merge", r.output, `Offer: Senior Tax Accountant at ${CLIENT}`);
}

// 9. A client name stored already-encoded still resolves to a readable
//    subject and a single-encoded body.
{
  const encodedCtx = { ...ctx, client: { name: CLIENT_ENCODED }, job: { ...ctx.job, clientName: CLIENT_ENCODED } };
  eq(
    "stored entity, subject",
    applyMailMergeFields("Offer at {{job.client_name}}", encodedCtx).output,
    `Offer at ${CLIENT}`,
  );
  eq(
    "stored entity, html body",
    applyMailMergeFields("<p>Offer at {{client.name}}</p>", encodedCtx).output,
    `<p>Offer at ${CLIENT_ENCODED}</p>`,
  );
}

// 10. decodeHtmlEntities unwinds what the renderer wrote.
{
  eq("decode round trip", decodeHtmlEntities(escapeHtml(CLIENT)), CLIENT);
  eq("decode quotes and apostrophes", decodeHtmlEntities("&quot;a&#39;b&quot;"), '"a\'b"');
  eq("decode angle brackets", decodeHtmlEntities("&lt;b&gt;"), "<b>");
}

if (failed > 0) {
  console.error(`\n${failed} test(s) FAILED`);
  process.exit(1);
}
console.log("\nAll ampersand encoding tests passed");
