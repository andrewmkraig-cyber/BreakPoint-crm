import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import {
  FitnessHttpError,
  isoDateOnly,
  parseDateOnly,
  requireFitnessContext,
} from "@/lib/fitness-server";

export const dynamic = "force-dynamic";

const MANUAL_STEPS_SOURCE = "manual";

function toErrorResponse(error: unknown) {
  if (error instanceof FitnessHttpError) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: error.status },
    );
  }
  console.error("[fitness] save steps failed", error);
  return NextResponse.json(
    { ok: false, error: "Steps failed to save" },
    { status: 500 },
  );
}

function cleanSteps(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 200_000) {
    throw new FitnessHttpError("Steps must be a valid daily count", 400);
  }
  return Math.round(n);
}

export async function POST(req: Request) {
  try {
    const ctx = await requireFitnessContext();
    const body = (await req.json().catch(() => null)) as
      | { date?: unknown; steps?: unknown }
      | null;
    if (typeof body?.date !== "string" || !body.date.trim()) {
      throw new FitnessHttpError("Date is required", 400);
    }

    const date = parseDateOnly(body.date);
    const steps = cleanSteps(body.steps);
    const row = await prisma.dailySteps.upsert({
      where: {
        organizationId_userId_date: {
          organizationId: ctx.organizationId,
          userId: ctx.userId,
          date,
        },
      },
      update: {
        steps,
        source: MANUAL_STEPS_SOURCE,
      },
      create: {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        date,
        steps,
        source: MANUAL_STEPS_SOURCE,
      },
    });

    return NextResponse.json({
      ok: true,
      day: {
        date: isoDateOnly(row.date),
        steps: row.steps,
        source: row.source,
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
