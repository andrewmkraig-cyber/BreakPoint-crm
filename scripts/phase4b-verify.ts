// One-shot Phase 4b browser+DB verification. Run with:
//   npx tsx scripts/phase4b-verify.ts
// Assumes dev server is up at http://localhost:3500 and NEXTAUTH_SECRET
// + DATABASE_URL are exported in the shell env.
import { encode } from "next-auth/jwt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const OWNER_EMAIL = "andrew@breakpointtalent.com";
const BASE = "http://localhost:3500";

async function main() {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET missing");

  const user = await prisma.user.findUnique({
    where: { email: OWNER_EMAIL },
    select: { id: true, email: true, name: true },
  });
  if (!user) throw new Error("owner not found");

  const token = await encode({
    token: { sub: user.id, id: user.id, email: user.email, name: user.name, role: "ADMIN" },
    secret,
    maxAge: 60 * 5,
  });
  const cookie = `next-auth.session-token=${token}`;

  // Pick an RF-imported candidate URL (first candidate with rfId set).
  const rfCandidate = await prisma.candidate.findFirst({
    where: { rfId: { not: null } },
    select: { rfId: true },
  });
  const urls = [
    rfCandidate ? `/candidates/${rfCandidate.rfId}` : "/candidates",
    "/pipeline",
    "/applicants",
  ];
  console.log("URL checks (authenticated):");
  for (const url of urls) {
    const res = await fetch(`${BASE}${url}`, { headers: { cookie }, redirect: "manual" });
    console.log(`  ${url}: HTTP ${res.status}`);
  }

  const recent = await prisma.placement.findMany({
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: { id: true, jobRfId: true, jobId: true, clientRfId: true, clientId: true, stage: true, updatedAt: true, createdAt: true },
  });
  const withBoth = recent.filter((r) => r.jobRfId != null && r.jobId != null).length;
  const withJobIdOnly = recent.filter((r) => r.jobRfId == null && r.jobId != null).length;
  const withRfIdOnly = recent.filter((r) => r.jobRfId != null && r.jobId == null).length;
  const neither = recent.filter((r) => r.jobRfId == null && r.jobId == null).length;
  console.log(`\nPlacement jobId/jobRfId shape (last 50):`);
  console.log(`  both populated (RF-imported, post-backfill): ${withBoth}`);
  console.log(`  jobId only (Ace-native Job): ${withJobIdOnly}`);
  console.log(`  jobRfId only (pre-Phase-4b or backfill miss): ${withRfIdOnly}`);
  console.log(`  neither (data corruption): ${neither}`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
