// One-off: reconcile Sidney Long (RF 867) ↔ Tax Manager (RF job 10) and
// backfill the missing Placement row. The pre-fix Submit flow never wrote
// a Placement, so Sidney shows Jobs (0) despite a sent submittal email.

import { prisma } from "../src/lib/prisma";
import { recruiterflow, normalizeJob } from "../src/lib/recruiterflow";

async function main() {
  const candidateRfId = 867;

  const jobs = await recruiterflow.listAllJobs({ perPage: 100 });
  const raw = jobs.find((j) => (j.title ?? "").toLowerCase().includes("tax manager"));
  if (!raw) throw new Error("Tax Manager job not found in RF");
  const norm = normalizeJob(raw);
  console.log("Chosen job:", { id: norm.id, title: norm.title, companyId: norm.companyId });
  if (!norm.companyId) throw new Error("Tax Manager job has no companyId");

  const user = await prisma.user.findFirst({
    where: { email: "andrew@breakpointtalent.com" },
    select: { id: true },
  });
  if (!user) throw new Error("User andrew@breakpointtalent.com not found");

  const existing = await prisma.placement.findUnique({
    where: { candidateRfId_jobRfId: { candidateRfId, jobRfId: norm.id } },
    select: { id: true, stage: true, clientRfId: true },
  });

  if (existing) {
    console.log("Existing placement:", existing);
    const updates: { stage?: string; clientRfId?: number } = {};
    if (existing.stage !== "submitted") updates.stage = "submitted";
    if (existing.clientRfId !== norm.companyId) updates.clientRfId = norm.companyId;
    if (Object.keys(updates).length === 0) {
      console.log("No updates needed.");
    } else {
      const updated = await prisma.placement.update({
        where: { id: existing.id },
        data: { ...updates, syncedToRf: false },
        select: { id: true, stage: true, clientRfId: true, jobRfId: true },
      });
      console.log("Updated placement:", updated);
    }
  } else {
    const created = await prisma.placement.create({
      data: {
        candidateRfId,
        candidateId: null,
        jobRfId: norm.id,
        clientRfId: norm.companyId,
        stage: "submitted",
        createdById: user.id,
        syncedToRf: false,
      },
      select: { id: true, stage: true, clientRfId: true, jobRfId: true },
    });
    console.log("Created placement:", created);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
