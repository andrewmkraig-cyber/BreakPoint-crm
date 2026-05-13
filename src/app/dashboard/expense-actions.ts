"use server";

import { revalidatePath } from "next/cache";

import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

export type CreateToolExpenseInput = {
  name: string;
  cost: number;
  frequency: string;
  paidCount: number;
};

export type CreateToolExpenseResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function createToolExpense(
  input: CreateToolExpenseInput,
): Promise<CreateToolExpenseResult> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Name is required." };
  if (!Number.isFinite(input.cost) || input.cost < 0) {
    return { ok: false, error: "Cost must be a non-negative number." };
  }
  const frequency = input.frequency.trim();
  if (!frequency) return { ok: false, error: "Frequency is required." };
  const paidCount =
    Number.isFinite(input.paidCount) && input.paidCount > 0
      ? Math.floor(input.paidCount)
      : 1;

  const org = await getCurrentOrg();
  try {
    const row = await prisma.toolExpense.create({
      data: {
        organizationId: org.id,
        name,
        cost: input.cost,
        frequency,
        paidCount,
      },
      select: { id: true },
    });
    revalidatePath("/dashboard");
    return { ok: true, id: row.id };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to save expense.",
    };
  }
}
