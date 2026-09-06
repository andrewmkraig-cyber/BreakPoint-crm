import assert from "node:assert/strict";
import {
  decodeCommonHtmlEntities,
  markdownishTextToEmailHtml,
} from "../../src/lib/ai-output-formatting";

assert.equal(
  decodeCommonHtmlEntities("Mowat Mackie &amp;amp; Anderson LLP &amp;lt;3"),
  "Mowat Mackie & Anderson LLP <3",
);

const html = markdownishTextToEmailHtml(
  [
    "Placed Austin at Mowat Mackie &amp; Anderson LLP.",
    "",
    "Have a great week- From your favorite Admin Team &lt;3",
  ].join("\n"),
);

assert(html.includes("Mowat Mackie &amp; Anderson LLP"));
assert(!html.includes("&amp;amp;"));
assert(html.includes("Admin Team &lt;3"));
assert(!html.includes("&amp;lt;3"));

console.log("ai-output-formatting tests passed");
