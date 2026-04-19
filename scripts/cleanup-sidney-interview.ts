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
    select: {
      id: true,
      googleEventIdMine: true,
      googleEventIdClient: true,
      googleEventIdCandidate: true,
      createdById: true,
      scheduledAt: true,
      status: true,
    },
  });
  console.log(`Found ${rows.length} interview(s) for candidate ${candidateRfId} / job ${jobRfId}:`, rows);

  if (rows.length === 0) {
    console.log("Nothing to clean up.");
    await prisma.$disconnect();
    return;
  }

  for (const row of rows) {
    const ids = [
      { key: "googleEventIdMine", id: row.googleEventIdMine, notify: false },
      { key: "googleEventIdClient", id: row.googleEventIdClient, notify: true },
      { key: "googleEventIdCandidate", id: row.googleEventIdCandidate, notify: true },
    ];
    for (const ev of ids) {
      if (!ev.id) continue;
      try {
        console.log(`Deleting Google event ${ev.id} (${ev.key}, notify=${ev.notify})…`);
        await deleteCalendarEvent({
          userId: row.createdById,
          eventId: ev.id,
          sendUpdates: ev.notify,
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
