// One-shot, idempotent backfill: the Miles Atchison test invoice (INV-1052)
// was created before clientId was wired into the test-invoice path, so it
// carries clientId=null and renders "client —" on the /finances invoices
// list. createTestInvoice find-or-creates a "tsaADVET inc." client; this
// links any org invoice whose candidate is the Miles Atchison test row and
// whose clientId is null to that existing client.
//
//   Run: set -a && . ./.env.local && set +a && node_modules/.bin/tsx scripts/migrations/link-test-invoice-client.ts
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const ORG = "cmobj8dxz00012gliequ53kvc"; // BreakPoint Talent (per CLAUDE.md)

async function main() {
  const client = await prisma.client.findFirst({
    where: { organizationId: ORG, name: { contains: "tsaADVET", mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (!client) {
    console.log("No tsaADVET client found — nothing to link. (Run a Test Invoice first.)");
    return;
  }
  const orphans = await prisma.invoice.findMany({
    where: {
      organizationId: ORG,
      clientId: null,
      candidate: { firstName: "Miles", lastName: "Atchison" },
    },
    select: { id: true, invoiceNumber: true },
  });
  if (orphans.length === 0) {
    console.log(`No unlinked Miles Atchison invoices. tsaADVET client = ${client.id} (${client.name}).`);
    return;
  }
  const res = await prisma.invoice.updateMany({
    where: { id: { in: orphans.map((o) => o.id) } },
    data: { clientId: client.id },
  });
  console.log(
    `Linked ${res.count} invoice(s) [${orphans.map((o) => o.invoiceNumber).join(", ")}] to client ${client.id} (${client.name}).`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
