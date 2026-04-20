"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Local-only override layer for RF jobs. RF is the system of record but
// doesn't have a writeable description endpoint we can use, and the
// recruiter wants a place to author an Ace-friendly description that
// merge fields ([Job Description]) can read on interview invites and
// submittal emails. Override > RF when present.

type Result = { ok: true } | { ok: false; error: string };

export async function updateJobOverrideDescription(args: {
  jobRfId: number;
  description: string;
}): Promise<Result> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return { ok: false, error: "Not signed in." };
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  });
  if (!user) return { ok: false, error: "User not found." };
  if (!Number.isFinite(args.jobRfId)) return { ok: false, error: "Job id invalid." };

  const description = args.description.trim();
  try {
    await prisma.jobOverride.upsert({
      where: { jobRfId: args.jobRfId },
      update: {
        description: description || null,
        updatedById: user.id,
      },
      create: {
        jobRfId: args.jobRfId,
        description: description || null,
        updatedById: user.id,
      },
    });
    revalidatePath(`/jobs/${args.jobRfId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}
