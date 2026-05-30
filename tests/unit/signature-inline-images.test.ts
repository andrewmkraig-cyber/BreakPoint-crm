// Regression test for the iOS Mail "duplicate signature logo" fix.
//
// Symptom: a submittal email rendered the BreakPoint signature once inline
// AND again as a bottom attachment thumbnail in iOS / Apple Mail (Gmail
// showed it once). Root cause: the signature embedded its logo + icons as
// base64 `data:` URIs; Gmail rewrote those into cid: MIME parts it labeled
// with a filename, which Apple Mail rendered as an attachment.
//
// Fix: renderSignatureInline emits `cid:` image refs and returns the images
// to embed as proper multipart/related inline parts (Content-Disposition:
// inline) so every client renders the signature exactly once.
//
// Run via: npx tsx tests/unit/signature-inline-images.test.ts
// Exits non-zero on the first assertion failure.

import { renderSignatureInline, type UserProfileRecord } from "@/lib/signature";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failures++;
  } else {
    console.log(`ok: ${msg}`);
  }
}

const profile: UserProfileRecord = {
  userId: "u1",
  email: "andrew@breakpointtalent.com",
  fullName: "Andrew Kraig",
  jobTitle: "Managing Partner & Founder",
  phone: "216-340-9511",
  website: "www.breakpointtalent.com",
  logoDataBase64: "TE9HT0JBU0U2NA==", // "LOGOBASE64"
  logoMimeType: "image/png",
  hasCustomLogo: false,
};

const { html, images } = renderSignatureInline(profile, "bptsig-test");

// 1. No data: URIs survive — Gmail has nothing to rewrite into attachments.
assert(!/data:/i.test(html), "html contains no data: URIs");

// 2. Logo + 3 contact icons collected as inline images.
assert(images.length === 4, `4 inline images collected (got ${images.length})`);

// 3. Every collected image's cid is referenced exactly once in the html via
//    cid:, and nowhere is the same cid duplicated (no double-render source).
for (const img of images) {
  const refs = (html.match(new RegExp(`cid:${img.cid}\\b`, "g")) ?? []).length;
  assert(refs === 1, `cid ${img.cid} referenced exactly once (got ${refs})`);
}

// 4. The logo image carries a real mime + base64 so it embeds, and the html
//    references it.
const logo = images.find((i) => i.cid === "bptsig-test-logo");
assert(Boolean(logo), "logo image present");
assert(logo?.base64 === profile.logoDataBase64, "logo base64 matches profile");
assert(html.includes("cid:bptsig-test-logo"), "html references logo cid");

// 5. Exactly one signature marker / table — single signature, not two.
const tableCount = (html.match(/<table/g) ?? []).length;
assert(tableCount === 2, `signature has the outer + contacts table only (got ${tableCount})`);

// 6. Icons map 1:1 with present contact fields. Drop the website -> 3 images.
const noSite = renderSignatureInline({ ...profile, website: "" }, "p2");
assert(noSite.images.length === 3, `no website -> 3 images (got ${noSite.images.length})`);
assert(!noSite.html.includes("cid:p2-globe"), "no globe cid when website absent");

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nAll signature-inline-image assertions passed.");
