/* Move existing future-installment AceReminders to 10 calendar days BEFORE
 * the installment's due date, on a weekday (idempotent, re-runnable).
 *
 * Why: before this fix, Confirm Start set each installment reminder to 9:00
 * AM ET on the installment's DUE date. The reminder is meant to be the cue
 * to SEND that invoice, so it should fire 10 days earlier, giving the client
 * the full window to pay. If the computed day is a Sat/Sun it slides back to
 * the prior Friday (reminders fire Mon-Fri only). Going-forward creation is
 * fixed in placement-actions.ts; this backfills rows created before the fix
 * (notably Ethan Larocca's installment 2: Aug 30 -> Aug 20, 2026).
 *
 * Idempotent: the target date is derived from the matching "Future"
 * installment invoice's dueDate (which never moves), NOT from the reminder's
 * current value, so re-running computes the same target every time.
 *
 * Dry run (default): node scripts/migrations/fix-installment-reminder-lead-time.cjs
 * Apply:             APPLY=1 node scripts/migrations/fix-installment-reminder-lead-time.cjs
 * (Reads DATABASE_URL from process.env, falling back to .env.local.)
 */
const fs = require("fs");
const { PrismaClient } = require("@prisma/client");

if (!process.env.DATABASE_URL && fs.existsSync(".env.local")) {
  const m = fs
    .readFileSync(".env.local", "utf8")
    .match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);
  if (m) process.env.DATABASE_URL = m[1];
}
const prisma = new PrismaClient();

const APPLY = process.env.APPLY === "1";
const LEAD_DAYS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

// --- Minimal ET wall-clock -> UTC helpers (mirror src/lib/timezone.ts) ---
function tzOffsetMs(utcMs, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const map = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = Number(p.value);
  const asUTC = Date.UTC(
    map.year,
    map.month - 1,
    map.day,
    map.hour % 24,
    map.minute,
    map.second,
  );
  return asUTC - utcMs;
}
function zonedWallTimeToUtc(year, month, day, hour, minute, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const offset1 = tzOffsetMs(guess, timeZone);
  let utc = guess - offset1;
  const offset2 = tzOffsetMs(utc, timeZone);
  if (offset2 !== offset1) utc = guess - offset2;
  return new Date(utc);
}
function priorFridayIfWeekendUtc(midnightUtc) {
  const dow = midnightUtc.getUTCDay();
  if (dow === 6) return new Date(midnightUtc.getTime() - DAY_MS);
  if (dow === 0) return new Date(midnightUtc.getTime() - 2 * DAY_MS);
  return midnightUtc;
}
const fmtET = (d) =>
  d
    ? d.toLocaleString("en-US", {
        timeZone: "America/New_York",
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "null";

async function main() {
  console.log(APPLY ? "=== APPLY MODE ===" : "=== DRY RUN (set APPLY=1 to write) ===");

  const reminders = await prisma.aceReminder.findMany({
    where: {
      title: { startsWith: "Invoice installment" },
      dismissed: false,
      calendarEventId: null,
      interviewId: null,
    },
    select: {
      id: true,
      organizationId: true,
      title: true,
      reminderAt: true,
    },
    orderBy: { reminderAt: "asc" },
  });
  console.log(`Found ${reminders.length} installment reminder(s).\n`);

  let updated = 0;
  let skipped = 0;

  for (const r of reminders) {
    const nMatch = /^Invoice installment\s+(\d+)/i.exec(r.title);
    const amtMatch = /\$([\d,]+(?:\.\d+)?)/.exec(r.title);
    if (!nMatch) {
      console.log(`SKIP (no installment number): ${r.title}`);
      skipped += 1;
      continue;
    }
    const n = Number(nMatch[1]);
    const amount = amtMatch ? Number(amtMatch[1].replace(/,/g, "")) : null;

    // Anchor the target on the stable Future-installment invoice dueDate.
    const candidateInvoices = await prisma.invoice.findMany({
      where: {
        organizationId: r.organizationId,
        status: { not: "VOID" },
        notes: { contains: `Future - Installment ${n} of` },
      },
      select: {
        id: true,
        invoiceNumber: true,
        feeAmount: true,
        dueDate: true,
        candidate: { select: { firstName: true, lastName: true } },
        client: { select: { name: true } },
      },
    });
    // Refine by the dollar amount when the title carries one, so two
    // placements that both have an "installment 2" don't collide.
    let matches = candidateInvoices.filter((inv) => inv.dueDate != null);
    if (amount != null) {
      const byAmt = matches.filter(
        (inv) => inv.feeAmount != null && Number(inv.feeAmount) === amount,
      );
      if (byAmt.length > 0) matches = byAmt;
    }

    if (matches.length !== 1) {
      console.log(
        `SKIP (${matches.length} invoice matches, need exactly 1): ${r.title}`,
      );
      skipped += 1;
      continue;
    }

    const inv = matches[0];
    const due = inv.dueDate; // midnight-UTC of the due calendar day
    const reminderCal = priorFridayIfWeekendUtc(
      new Date(
        Date.UTC(
          due.getUTCFullYear(),
          due.getUTCMonth(),
          due.getUTCDate() - LEAD_DAYS,
        ),
      ),
    );
    const target = zonedWallTimeToUtc(
      reminderCal.getUTCFullYear(),
      reminderCal.getUTCMonth() + 1,
      reminderCal.getUTCDate(),
      9,
      0,
      "America/New_York",
    );

    if (target.getTime() === r.reminderAt.getTime()) {
      console.log(`OK (already correct): ${r.title}\n   at ${fmtET(r.reminderAt)}`);
      skipped += 1;
      continue;
    }

    console.log(
      `MOVE: ${r.title}\n   invoice ${inv.invoiceNumber} due ${fmtET(due)}` +
        `\n   ${fmtET(r.reminderAt)}  ->  ${fmtET(target)}`,
    );
    if (APPLY) {
      await prisma.aceReminder.update({
        where: { id: r.id },
        data: { reminderAt: target, notifiedLeadsMin: [] },
      });
      console.log("   updated.");
    }
    updated += 1;
  }

  console.log(
    `\nDone. ${updated} ${APPLY ? "updated" : "would update"}, ${skipped} skipped.`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
