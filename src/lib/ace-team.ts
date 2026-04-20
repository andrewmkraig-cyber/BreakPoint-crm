import { prisma } from "@/lib/prisma";

export type AceTeamMember = { id: string; name: string; email: string };

// All Ace team members eligible to appear in BCC dropdowns. Filters to
// users with both a name and an email so the picker doesn't render
// half-empty rows. Sorted alphabetically by name for predictable
// dropdown order.
export async function listAceTeam(): Promise<AceTeamMember[]> {
  const users = await prisma.user.findMany({
    where: {
      email: { not: null },
    },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
  return users
    .filter((u): u is { id: string; name: string | null; email: string } => Boolean(u.email))
    .map((u) => ({
      id: u.id,
      name: u.name?.trim() || u.email,
      email: u.email,
    }));
}
