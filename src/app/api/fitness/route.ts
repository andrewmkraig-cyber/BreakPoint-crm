import { NextRequest, NextResponse } from "next/server";

import {
  FitnessHttpError,
  ensureFitnessDefaults,
  fetchAccessibleExercises,
  fetchAppleHealthConnection,
  fetchHistoryDays,
  fetchStepSeries,
  fetchWorkoutDayByDate,
  isoDateOnly,
  parseDateOnly,
  publicFitnessMetadata,
  requireFitnessContext,
  serializeWorkoutDay,
  todayInEastern,
} from "@/lib/fitness-server";

export const dynamic = "force-dynamic";

function toErrorResponse(error: unknown) {
  if (error instanceof FitnessHttpError) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: error.status },
    );
  }
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "P2021"
  ) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Fitness database tables are not installed yet. Run npm run db:push, then reopen Fitness.",
      },
      { status: 503 },
    );
  }
  console.error("[fitness] snapshot failed", error);
  return NextResponse.json(
    { ok: false, error: "Fitness failed to load" },
    { status: 500 },
  );
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireFitnessContext();
    const selectedDate = parseDateOnly(req.nextUrl.searchParams.get("date"));
    const today = todayInEastern();

    await ensureFitnessDefaults(ctx.organizationId);
    const [exercises, selectedDay, history, steps, healthConnection] =
      await Promise.all([
        fetchAccessibleExercises(ctx.organizationId, ctx.userId),
        fetchWorkoutDayByDate(ctx.organizationId, ctx.userId, selectedDate),
        fetchHistoryDays(ctx.organizationId, ctx.userId),
        fetchStepSeries(ctx.organizationId, ctx.userId, today),
        fetchAppleHealthConnection(ctx.organizationId, ctx.userId),
      ]);
    const metadata = publicFitnessMetadata();

    return NextResponse.json({
      ok: true,
      date: isoDateOnly(selectedDate),
      user: { id: ctx.userId, name: ctx.userName },
      dayTypes: metadata.dayTypes,
      bodyParts: metadata.bodyParts,
      exercises,
      selectedDay: selectedDay ? serializeWorkoutDay(selectedDay) : null,
      history,
      steps: { ...steps, ...healthConnection },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
