// Smoke test: render DateTime15Picker to static HTML and assert that it
// IS a <select> with exactly 96 fifteen-minute options and no off-grid
// values can be selected. This proves the "15-min only" behavior at the
// DOM level — stepping is no longer an advisory, the user physically
// cannot choose 8:13 because there is no <option value="08:13">.

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DateTime15Picker } from "../src/components/datetime-15-picker";

let called = "";
const html = renderToStaticMarkup(
  React.createElement(DateTime15Picker, {
    value: "",
    onChange: (v: string) => {
      called = v;
    },
  }),
);
void called;

const optionCount = (html.match(/<option /g) ?? []).length;
// 96 fifteen-min slots per day + 1 placeholder "— time —" option.
if (optionCount !== 97) {
  console.error(`Expected 97 options (96 slots + placeholder), got ${optionCount}`);
  process.exit(1);
}

const validSamples = ["00:00", "00:15", "00:30", "00:45", "08:00", "12:15", "13:45", "23:45"];
for (const t of validSamples) {
  if (!html.includes(`value="${t}"`)) {
    console.error(`Missing valid 15-min slot: ${t}`);
    process.exit(1);
  }
}

const forbidden = ["08:13", "08:17", "09:01", "14:23", "23:47"];
for (const t of forbidden) {
  if (html.includes(`value="${t}"`)) {
    console.error(`Off-grid time selectable (should NOT be): ${t}`);
    process.exit(1);
  }
}

if (!html.includes('type="date"')) {
  console.error("Missing <input type=\"date\"> half of the picker");
  process.exit(1);
}

if (!html.includes("<select")) {
  console.error("Missing <select> — not bulletproof; fix before shipping");
  process.exit(1);
}

console.log("OK:", optionCount - 1, "fifteen-minute slots rendered as <select> options; off-grid values not selectable.");
