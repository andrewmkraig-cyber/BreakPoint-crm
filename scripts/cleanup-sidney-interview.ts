// Clean up Sidney Long's orphan Interview row from the failed Schedule
// Interview test. Deletes the Google Calendar event on my primary
// calendar first, then deletes the Interview row so the next test
// starts from a clean state.

import { prisma } from "../src/lib/prisma";
import { deleteCalendarEvent } from "../src/lib/google-calendar";

async function main() {
  const candidateRfId = 867;
  const jobRfId = 10;

  const rows = await prisma.interview.findMany({
    where: { candidateRfId, jobRfId },
    select: { id: true, googleEventIdMine: true, createdById: true, scheduledAt: true, status: true },
  });
  console.log(`Found ${rows.length} interview(s) for candidate ${candidateRfId} / job ${jobRfId}:`, rows);

  if (rows.length === 0) {
    console.log("Nothing to clean up.");
    await prisma.$disconnect();
    return;
  }

  for (const row of rows) {
    if (row.googleEventIdMine) {
      try {
        console.log(`Deleting Google event ${row.googleEventIdMine} (as user ${row.createdById})…`);
        await deleteCalendarEvent({
          userId: row.createdById,
          eventId: row.googleEventIdMine,
          sendUpdates: false,
        });
        console.log("  Google event deleted.");
      } catch (e) {
        console.error("  Google event delete failed:", e);
      }
    }
    await prisma.interview.delete({ where: { id: row.id } });
    console.log(`Interview row ${row.id} deleted.`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
