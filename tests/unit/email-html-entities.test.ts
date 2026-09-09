import assert from "node:assert/strict";
import { wrapEmailHtml, normalizeEmailBodyHtml } from "../../src/lib/email-html";

// Regression: the outbound wrapper used to parse with `decodeEntities: false`
// and serialize with `encodeEntities: "utf8"`, which re-escaped the bare "&" of
// every entity. Recipients saw the literal text "&nbsp;" / "&lt;" / "&amp;".

const nbsp = normalizeEmailBodyHtml("<p>Good morning,&nbsp;</p>");
assert(!nbsp.includes("&amp;nbsp;"), `nbsp double-escaped: ${nbsp}`);

const angle = normalizeEmailBodyHtml(
  "<div>Andrew Kraig &lt;andrew@breakpointtalent.com&gt; wrote:</div>",
);
assert(!angle.includes("&amp;lt;"), `lt double-escaped: ${angle}`);
assert(!angle.includes("&amp;gt;"), `gt double-escaped: ${angle}`);

const amp = normalizeEmailBodyHtml("<p><strong>Founder &amp; Lead Recruiter</strong></p>");
assert(amp.includes("Founder &amp; Lead Recruiter"), `amp wrong: ${amp}`);
assert(!amp.includes("&amp;amp;"), `amp double-escaped: ${amp}`);

// Stale drafts or saved scheduled emails can re-enter this path already
// double-encoded from the old wrapper. Normalize them back to single-encoded
// source HTML so Gmail displays symbols, not entity text.
const rescued = normalizeEmailBodyHtml(
  "<p>Mowat Mackie &amp;amp; Anderson LLP &amp;lt;3</p>",
);
assert(rescued.includes("Mowat Mackie &amp; Anderson LLP &lt;3"), `rescue wrong: ${rescued}`);
assert(!rescued.includes("&amp;amp;"), `rescued amp double-escaped: ${rescued}`);
assert(!rescued.includes("&amp;lt;3"), `rescued lt double-escaped: ${rescued}`);

// Raw specials a recruiter literally types must still be escaped exactly once.
const raw = normalizeEmailBodyHtml("<p>Salary < 100k & rising > target</p>");
assert(raw.includes("&lt; 100k &amp; rising &gt;"), `raw specials wrong: ${raw}`);
assert(!raw.includes("&amp;amp;"), `raw amp double-escaped: ${raw}`);

// Escaped tag-looking text must remain text after normalization.
const escapedTag = normalizeEmailBodyHtml(
  "<p>Literal &lt;script&gt;alert(1)&lt;/script&gt;</p>",
);
assert(escapedTag.includes("Literal &lt;script&gt;alert(1)&lt;/script&gt;"));
assert(!escapedTag.includes("<script>"), `escaped tag became HTML: ${escapedTag}`);

// Query-string ampersands in links must survive as a single &amp;.
const link = normalizeEmailBodyHtml('<p><a href="https://x.com/?a=1&amp;b=2">link</a></p>');
assert(link.includes('href="https://x.com/?a=1&amp;b=2"'), `href mangled: ${link}`);

// Wrapping is idempotent: re-wrapping an already-wrapped body must not
// compound the escaping (drafts and scheduled sends re-enter this path).
const once = wrapEmailHtml("<p>Founder &amp; Lead Recruiter&nbsp;</p>");
const twice = wrapEmailHtml(once);
assert.equal(twice, once, `wrap not idempotent:\n${once}\n${twice}`);

console.log("email-html entity tests passed");
