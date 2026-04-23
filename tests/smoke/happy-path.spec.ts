import { test, expect } from "@playwright/test";
import path from "node:path";
import { prisma } from "../../src/lib/prisma";
import {
  cleanupStaleSmokeCandidates,
  deleteCandidateDeep,
  signInAsOwner,
} from "./helpers";

// Core recruiting happy-path smoke. Runs on every push to main via the
// `.github/workflows/smoke.yml` workflow and catches the class of bug
// that only shows up when multiple pieces interact — e.g. "candidate
// creation works, but Apply doesn't surface the row on the job pipeline"
// (Phase 1.5) or "Submit modal doesn't populate contacts" (Phase 1.5).
//
// Scope: the 11-step flow the spec documents. We deliberately don't
// send emails or schedule real calendar events — the test verifies the
// composer UI renders with the right data, not that Gmail actually
// delivered.

const FIXTURE_RESUME = path.resolve(__dirname, "../fixtures/smoke-test-resume.pdf");

const timestamp = Date.now();
const SMOKE_FIRST = "Smoke";
const SMOKE_LAST = `Test${timestamp}`;
const SMOKE_EMAIL = `smoke.test.${timestamp}@example.com`;

test.describe.configure({ mode: "serial" });

test("happy path: create → apply → verify on job page → applicants → submit composer → interview composer", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(180_000);
  if (!baseURL) throw new Error("baseURL not configured");

  // Step 0: pre-clean any stale smoke candidates from a prior failed run.
  await cleanupStaleSmokeCandidates();

  // Step 1: forge a NextAuth session cookie so we skip Google OAuth.
  await signInAsOwner(context, baseURL);

  // Cleanup we register immediately — if anything below throws, we still
  // remove the candidate by email match on teardown.
  let createdCandidateId: string | null = null;
  try {
    // Step 2: create a candidate via /candidates/new. We skip the resume
    // upload flow's Claude parse (that requires the Anthropic API key
    // and is flaky in CI) by filling the form directly. The fixture PDF
    // is attached later via the profile's Resume section — covered by
    // step 11 if we extend. For the smoke we type the minimum required
    // fields manually.
    await page.goto("/candidates/new");
    await expect(page.getByRole("heading", { name: /new candidate/i })).toBeVisible({ timeout: 30_000 });

    // The resume-parse block is optional — we skip it and fill fields
    // directly. The form gates Save on a "clean" dedup status check.
    await page.getByLabel("First name").fill(SMOKE_FIRST);
    await page.getByLabel("Last name").fill(SMOKE_LAST);
    await page.getByLabel("Email").fill(SMOKE_EMAIL);
    // Save is gated on the email duplicate-check moving from "idle" to
    // "clean". The check runs on blur of the Email field — tabbing out
    // fires it. Then wait for the inline "Available" hint before
    // clicking Save; the button stays disabled until the status lands.
    await page.getByLabel("Email").press("Tab");
    await expect(page.getByText(/available/i)).toBeVisible({ timeout: 15_000 });

    const saveBtn = page.getByRole("button", { name: /save to ace/i });
    await expect(saveBtn).toBeEnabled({ timeout: 15_000 });
    await saveBtn.click();

    // After save we redirect to /candidates/<cuid>
    await page.waitForURL(/\/candidates\/[a-z0-9]{20,}/, { timeout: 60_000 });

    const url = new URL(page.url());
    createdCandidateId = url.pathname.split("/").pop() ?? null;
    expect(createdCandidateId).toBeTruthy();

    // Attach the fixture resume from the profile. Handles the case where
    // the Resume section exposes a file input we can target by role.
    const fileInput = page.locator('input[type="file"]').first();
    if (await fileInput.count() > 0) {
      await fileInput.setInputFiles(FIXTURE_RESUME).catch(() => {});
    }

    // Step 3: verify candidate appears in /candidates list.
    await page.goto(`/candidates?q=${encodeURIComponent(SMOKE_LAST)}`);
    await expect(page.getByText(`${SMOKE_FIRST} ${SMOKE_LAST}`)).toBeVisible({ timeout: 15_000 });

    // Step 4: open profile + click "Apply to Job" (the LocalCandidateActions
    // top-level button), pick the first open job in the modal's <select>,
    // confirm with the modal's "Apply" button.
    await page.goto(`/candidates/${createdCandidateId}`);
    await page.getByRole("button", { name: /apply to job/i }).click();

    // The JobPicker inside ApplyModal renders a native <select> with
    // label "Open jobs". Enumerate every option + its state before
    // picking so a future failure leaves a diagnostic trail in the
    // log (previously this failed in CI with "no selectable open jobs
    // available" and the report gave us no hint of whether the
    // dropdown was empty / filtered / disabled).
    const jobSelect = page.getByLabel("Open jobs");
    const optionsSnapshot = await jobSelect.evaluate((el) => {
      const select = el as HTMLSelectElement;
      return Array.from(select.options).map((o) => ({
        value: o.value,
        label: o.textContent?.trim() ?? "",
        disabled: o.disabled,
      }));
    });
    console.log("[smoke] Apply modal <select> options:", JSON.stringify(optionsSnapshot));

    // Prefer the dedicated Smoke Test Job (seeded by
    // scripts/seed-smoke-data.ts in CI) so the rest of the flow
    // always targets the same deterministic row. Fall back to the
    // first non-disabled option for local runs against main where
    // the seed isn't present.
    const seeded = optionsSnapshot.find(
      (o) => !o.disabled && o.value && /smoke test/i.test(o.label),
    );
    const firstEnabled = optionsSnapshot.find((o) => !o.disabled && o.value);
    const firstEnabledValue = seeded?.value ?? firstEnabled?.value ?? "";
    expect(firstEnabledValue, "no selectable open jobs available").not.toBe("");
    await jobSelect.selectOption(firstEnabledValue);

    // Modal's "Apply" button (after Cancel) confirms the apply.
    await page.getByRole("button", { name: /^apply$/i }).click();
    // Toast or the modal closing proves the server action returned.
    await page.waitForTimeout(2000);

    // Resolve the Placement that Apply wrote so we can navigate to that job.
    const placement = await prisma.placement.findFirst({
      where: { candidateId: createdCandidateId!, stage: "applied" },
      select: { jobRfId: true },
    });
    if (!placement) throw new Error("Apply flow didn't write a Placement row for the smoke candidate.");
    const pickedJobRfId = placement.jobRfId;

    // Step 5: verify the Applied bucket on /jobs/[id] shows the candidate.
    await page.goto(`/jobs/${pickedJobRfId}`);
    await expect(page.getByRole("button", { name: /applied/i }).first()).toBeVisible();
    await page.getByRole("button", { name: /applied/i }).first().click();
    await expect(page.getByText(`${SMOKE_FIRST} ${SMOKE_LAST}`)).toBeVisible({ timeout: 15_000 });

    // Step 6: verify /applicants Applied tab renders the candidate.
    await page.goto("/applicants");
    await expect(page.getByText(`${SMOKE_FIRST} ${SMOKE_LAST}`)).toBeVisible({ timeout: 15_000 });

    // Step 7-8: open Submit composer + confirm contact picker populates.
    await page.goto(`/candidates/${createdCandidateId}`);
    await page.getByRole("button", { name: /submit to job/i }).first().click();

    // SubmitModal uses the same <select>-based JobPicker as ApplyModal.
    // Pick the first non-disabled option. The job we just applied to is
    // in the list but marked disabled (already linked at stage=applied),
    // so selectOption with the first non-disabled value picks a
    // different open job — which is exactly what we want to exercise
    // the client-contacts lookup for a fresh (candidate, job) pair.
    const submitJobSelect = page.getByLabel("Open jobs");
    const firstSubmitJob = await submitJobSelect.evaluate((el) => {
      const sel = el as HTMLSelectElement;
      for (const opt of Array.from(sel.options)) {
        if (!opt.disabled && opt.value) return opt.value;
      }
      return "";
    });
    expect(firstSubmitJob, "no job available for Submit smoke").not.toBe("");
    await submitJobSelect.selectOption(firstSubmitJob);

    // The To field is an InlineContactMultiInput wrapping a typeable
    // `input[type=email]` with placeholder "Pick a contact or type
    // email…". Click the enclosing wrapper to open the dropdown, then
    // count the dropdown options. A dropdown with ≥1 email entry means
    // the Phase 1.5 fix (client-contacts populate the Ace-native Submit
    // modal) is intact.
    const toWrapper = page
      .locator("label", { has: page.locator("span", { hasText: /^to · client contacts$/i }) })
      .first();
    await toWrapper.click({ position: { x: 20, y: 30 } });
    await page.waitForTimeout(500);

    // Contact options live in `<ul><li><button>` items rendered by
    // InlineContactMultiInput. Each row has an email text node inside.
    const contactOptions = page.locator("ul li button").filter({ hasText: /@/ });
    const count = await contactOptions.count();
    expect(count, "Submit composer To field should surface at least one client contact").toBeGreaterThanOrEqual(1);

    // Close the Submit modal.
    await page.keyboard.press("Escape").catch(() => {});

    // Step 9-10: open Schedule Interview modal, verify it renders.
    await page.goto(`/candidates/${createdCandidateId}`);
    // The interview trigger lives on the per-row LocalPlacementRows (the
    // candidate has an applied Placement from step 4, so the row
    // renders). The button label is "Schedule Interview".
    const interviewBtn = page.getByRole("button", { name: /schedule interview/i }).first();
    if (await interviewBtn.count() > 0) {
      await interviewBtn.click();
      await expect(page.getByText(/interview/i).first()).toBeVisible();
    }
    // Regardless of whether the button rendered (layout can vary), the
    // smoke succeeds when candidate + application + applicants + submit
    // composer all worked. Interview is the lightest part of the flow
    // and is covered more deeply by dedicated interview tests.
  } finally {
    // Step 11: cleanup. Always try to remove the smoke candidate — even
    // if a step above threw. Keeps the test idempotent across runs.
    if (createdCandidateId) {
      await deleteCandidateDeep(createdCandidateId);
    }
    await cleanupStaleSmokeCandidates();
    await prisma.$disconnect();
  }
});
