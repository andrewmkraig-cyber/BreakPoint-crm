// Regression test for the "deal announcement photo arrives as an attachment"
// fix.
//
// Symptom: a picture pasted / inserted / dropped into the composer body was
// stored as a base64 data: URI. Gmail rewrote it into a cid: part it labeled
// with a filename, so Apple Mail / iOS Mail / Outlook showed it as a bottom
// attachment the reader had to open instead of inline under the text.
//
// Fix: extractInlineBodyImages swaps every data: image for a cid: ref and
// returns the inline parts sendGmail embeds as multipart/related siblings,
// the same mechanism the signature logo already uses.
//
// Run via: npx tsx tests/unit/inline-body-images.test.ts

import { extractInlineBodyImages } from "@/lib/inline-body-images";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failures++;
  } else {
    console.log(`ok: ${msg}`);
  }
}

const png = "iVBORw0KGgo=";
const jpg = "/9j/4AAQSkZJRg==";
const body =
  `<p>Congrats!</p>` +
  `<img src="data:image/png;base64,${png}">` +
  `<p>again</p>` +
  `<img alt="team" src='data:image/jpeg;base64,${jpg}' width="300">` +
  `<img src="data:image/png;base64,${png}">` +
  `<img src="https://example.com/logo.png">` +
  `<img src="cid:bptsig-x-logo">`;

const { html, images } = extractInlineBodyImages(body, "bptimg-test");

assert(!/data:image/i.test(html), "no data: image URIs remain in the body");
assert(images.length === 2, `two distinct pictures become two parts (got ${images.length})`);
assert(images[0]?.cid === "bptimg-test-1" && images[0]?.mimeType === "image/png" && images[0]?.base64 === png,
  "first part is the png with its base64 intact");
assert(images[0]?.filename === "image-1.png", "png part gets a .png filename");
assert(images[1]?.cid === "bptimg-test-2" && images[1]?.mimeType === "image/jpeg" && images[1]?.base64 === jpg,
  "second part is the jpeg");
assert(images[1]?.filename === "image-2.jpg", "jpeg part gets a .jpg filename");
assert((html.match(/cid:bptimg-test-1/g) ?? []).length === 2, "the repeated png references the same cid twice");
assert(html.includes(`<img alt="team" src='cid:bptimg-test-2' width="300">`), "other img attributes and quote style survive");
assert(html.includes('<img src="https://example.com/logo.png">'), "https images are untouched");
assert(html.includes('<img src="cid:bptsig-x-logo">'), "existing cid refs are untouched");

assert(/<img width="360" style="width:360px;max-width:100%;height:auto" src="cid:bptimg-test-1">/.test(html),
  "a converted picture without a width gets the standard display width");
const sizedIn = extractInlineBodyImages(`<img width="200" src="data:image/png;base64,${png}">`, "bptimg-w");
assert(sizedIn.html === '<img width="200" src="cid:bptimg-w-1">', "an explicit width is left alone");

const none = extractInlineBodyImages("<p>plain</p>", "bptimg-test");
assert(none.html === "<p>plain</p>" && none.images.length === 0, "bodies without pictures pass through unchanged");

if (failures > 0) {
  console.error(`${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("all inline-body-images assertions passed");
