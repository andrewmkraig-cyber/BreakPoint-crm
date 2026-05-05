import { test } from "@playwright/test";
import path from "node:path";
import { signInAsOwner } from "./helpers";

// One-off screenshot capture: signs in, then for each Court Mode combo
// flips html[data-surface][data-theme] and snapshots /dashboard. Output
// lands in tests/screenshots/court-<mode>.png so the diff can be
// eyeballed against the v5 spec mocks.

const MODES: Array<{ surface: string; theme: string; name: string }> = [
  { surface: "hard",  theme: "light", name: "hard-light" },
  { surface: "hard",  theme: "dark",  name: "hard-dark"  },
  { surface: "clay",  theme: "light", name: "clay-light" },
  { surface: "clay",  theme: "dark",  name: "clay-dark"  },
  { surface: "grass", theme: "light", name: "grass-light"},
  { surface: "grass", theme: "dark",  name: "grass-dark" },
  { surface: "night", theme: "dark",  name: "night"      },
];

test("capture dashboard in all 7 court modes", async ({ page, context, baseURL }) => {
  test.setTimeout(180_000);
  if (!baseURL) throw new Error("baseURL not configured");
  await signInAsOwner(context, baseURL);

  for (const m of MODES) {
    await page.goto("/dashboard");
    // Wait for first paint
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await page.evaluate(({ surface, theme }) => {
      const html = document.documentElement;
      html.setAttribute("data-surface", surface);
      html.setAttribute("data-theme", theme);
    }, m);
    // Allow CSS variables to repaint
    await page.waitForTimeout(500);
    const out = path.resolve(__dirname, `../screenshots/court-${m.name}.png`);
    await page.screenshot({ path: out, fullPage: false });
    console.log(`[shot] ${m.name} → ${out}`);
  }
});
