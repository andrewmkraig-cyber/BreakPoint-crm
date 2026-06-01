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
    revalidatePath("/finances");
    revalidatePath("/expenses");
    return { ok: true, id: row.id };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to save expense.",
    };
  }
}

export type UpdateToolExpenseInput = {
  id: string;
  name?: string;
  cost?: number;
  startDate?: string | null;
  notes?: string | null;
};

export type ToolExpenseResult =
  | { ok: true }
  | { ok: false; error: string };

export async function updateToolExpense(
  input: UpdateToolExpenseInput,
): Promise<ToolExpenseResult> {
  const org = await getCurrentOrg();
  const existing = await prisma.toolExpense.findUnique({
    where: { id: input.id },
    select: { organizationId: true },
  });
  if (!existing || existing.organizationId !== org.id) {
    return { ok: false, error: "Expense not found." };
  }
  const data: Record<string, unknown> = {};
  if (typeof input.name === "string") {
    const trimmed = input.name.trim();
    if (!trimmed) return { ok: false, error: "Name is required." };
    data.name = trimmed;
  }
  if (input.cost != null) {
    if (!Number.isFinite(input.cost) || input.cost < 0) {
      return { ok: false, error: "Cost must be a non-negative number." };
    }
    data.cost = input.cost;
  }
  if (input.startDate !== undefined) {
    data.startDate = input.startDate ? new Date(input.startDate) : null;
  }
  if (input.notes !== undefined) {
    data.notes = input.notes ?? null;
  }
  if (Object.keys(data).length === 0) return { ok: true };
  try {
    await prisma.toolExpense.update({
      where: { id: input.id },
      data,
    });
    revalidatePath("/finances");
    revalidatePath("/expenses");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to update expense.",
    };
  }
}

export async function deleteToolExpense(
  id: string,
): Promise<ToolExpenseResult> {
  const org = await getCurrentOrg();
  const existing = await prisma.toolExpense.findUnique({
    where: { id },
    select: { organizationId: true },
  });
  if (!existing || existing.organizationId !== org.id) {
    return { ok: false, error: "Expense not found." };
  }
  try {
    await prisma.toolExpense.delete({ where: { id } });
    revalidatePath("/finances");
    revalidatePath("/expenses");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to delete expense.",
    };
  }
}
