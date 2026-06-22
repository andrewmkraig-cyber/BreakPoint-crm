import "server-only";

import { prisma } from "@/lib/prisma";

export async function normalizeOwnerJobPriorities(
  organizationId: string,
  ownerId: string,
): Promise<void> {
  const jobs = await prisma.job.findMany({
    where: {
      organizationId,
      lifecycle: "active",
      isOpen: true,
      client: { is: { ownerId } },
    },
    select: { id: true, websitePriority: true, updatedAt: true },
  });
  jobs.sort((a, b) => {
    const ap = a.websitePriority ?? Number.MAX_SAFE_INTEGER;
    const bp = b.websitePriority ?? Number.MAX_SAFE_INTEGER;
    if (ap !== bp) return ap - bp;
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });
  if (jobs.length === 0) return;
  await prisma.$transaction(
    jobs.map((job, index) =>
      prisma.job.update({ where: { id: job.id }, data: { websitePriority: index + 1 } }),
    ),
  );
}

export async function nextOwnerJobPriority(
  organizationId: string,
  ownerId: string | null | undefined,
): Promise<number | null> {
  if (!ownerId) return null;
  const count = await prisma.job.count({
    where: {
      organizationId,
      lifecycle: "active",
      isOpen: true,
      client: { is: { ownerId } },
    },
  });
  return count + 1;
}
