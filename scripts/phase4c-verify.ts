// Phase 4c verification:
// 1. URL checks on dev :3500 with forged JWT (candidate profile, pipeline,
//    applicants).
// 2. ActivityLog row shape check — count rows by actionType and print
//    the three most recent for each of the wired types.
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
  const urls = ["/candidates", "/pipeline", "/applicants"];
  console.log("URL checks (authenticated):");
  for (const url of urls) {
    try {
      const res = await fetch(`${BASE}${url}`, { headers: { cookie }, redirect: "manual" });
      console.log(`  ${url}: HTTP ${res.status}`);
    } catch (e) {
      console.log(`  ${url}: ERROR ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log("\nActivityLog rollup (grouped by actionType):");
  const grouped = await prisma.activityLog.groupBy({
    by: ["actionType"],
    _count: { _all: true },
    orderBy: { _count: { actionType: "desc" } },
  });
  for (const g of grouped) {
    console.log(`  ${g.actionType}: ${g._count._all}`);
  }

  console.log("\nRecent ActivityLog rows (last 10):");
  const recent = await prisma.activityLog.findMany({
    orderBy: { timestamp: "desc" },
    take: 10,
    select: {
      id: true,
      organizationId: true,
      userId: true,
      actionType: true,
      targetType: true,
      targetId: true,
      metadata: true,
      timestamp: true,
    },
  });
  for (const r of recent) {
    console.log(
      `  ${r.timestamp.toISOString()} · ${r.actionType} · ${r.targetType}/${r.targetId} · org=${r.organizationId.slice(0, 8)}… user=${r.userId.slice(0, 8)}…`,
    );
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
