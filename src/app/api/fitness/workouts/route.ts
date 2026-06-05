import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import type { FitnessSavePayload } from "@/lib/fitness";
import {
  FitnessHttpError,
  ensureFitnessDefaults,
  parseDateOnly,
  requireFitnessContext,
  serializeWorkoutDay,
} from "@/lib/fitness-server";

export const dynamic = "force-dynamic";

type SanitizedWorkout = {
  exerciseId: string;
  sets: Array<{
    weightLbs: number | null;
    reps: number | null;
    rpe: number | null;
  }>;
};

function toErrorResponse(error: unknown) {
  if (error instanceof FitnessHttpError) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: error.status },
    );
  }
  console.error("[fitness] save workout failed", error);
  return NextResponse.json(
    { ok: false, error: "Workout failed to save" },
    { status: 500 },
  );
}

function cleanNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 10) / 10;
}

function cleanReps(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

function cleanRpe(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 10) return null;
  return Math.round(n * 10) / 10;
}

function cleanDateTime(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function cleanDurationSeconds(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(86_400, Math.round(n));
}

function pctChange(
  current: number | null,
  previous: number | null,
): number | null {
  if (current == null || previous == null || previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function setVolume(
  weightLbs: number | null | undefined,
  reps: number | null | undefined,
): number {
  if (weightLbs == null || reps == null) return 0;
  return Math.max(0, weightLbs) * Math.max(0, reps);
}

function sanitizePayload(body: FitnessSavePayload): {
  date: Date;
  dayType: string;
  startedAt: Date;
  endedAt: Date;
  durationSeconds: number;
  notes: string | null;
  workouts: SanitizedWorkout[];
} {
  const date = parseDateOnly(body.date);
  const dayType = body.dayType?.trim() || "Workout";
  const endedAt = cleanDateTime(body.endedAt) ?? new Date();
  const startedAt = cleanDateTime(body.startedAt) ?? endedAt;
  const derivedDurationSeconds = Math.max(
    0,
    Math.round((endedAt.getTime() - startedAt.getTime()) / 1000),
  );
  const durationSeconds =
    cleanDurationSeconds(body.durationSeconds) ?? derivedDurationSeconds;
  const workouts = (Array.isArray(body.workouts) ? body.workouts : [])
    .map((workout) => ({
      exerciseId: String(workout.exerciseId || ""),
      sets: (Array.isArray(workout.sets) ? workout.sets : [])
        .map((set) => ({
          weightLbs: cleanNumber(set.weightLbs),
          reps: cleanReps(set.reps),
          rpe: cleanRpe(set.rpe),
        }))
        .filter((set) => set.weightLbs != null && set.reps != null),
    }))
    .filter((workout) => workout.exerciseId && workout.sets.length > 0);

  if (workouts.length === 0) {
    throw new FitnessHttpError(
      "Add at least one completed set before saving",
      400,
    );
  }

  return {
    date,
    dayType,
    startedAt,
    endedAt,
    durationSeconds,
    notes: body.notes?.trim() || null,
    workouts,
  };
}

export async function POST(req: Request) {
  try {
    const ctx = await requireFitnessContext();
    await ensureFitnessDefaults(ctx.organizationId);

    let body: FitnessSavePayload;
    try {
      body = (await req.json()) as FitnessSavePayload;
    } catch {
      throw new FitnessHttpError("Invalid JSON body", 400);
    }
    const payload = sanitizePayload(body);
    const exerciseIds = Array.from(
      new Set(payload.workouts.map((w) => w.exerciseId)),
    );

    const accessibleExercises = await prisma.exercise.findMany({
      where: {
        organizationId: ctx.organizationId,
        id: { in: exerciseIds },
        OR: [{ isDefault: true }, { userId: ctx.userId }],
      },
      select: { id: true, name: true },
    });
    if (accessibleExercises.length !== exerciseIds.length) {
      throw new FitnessHttpError("One or more exercises are unavailable", 400);
    }
    const exerciseNameById = new Map(
      accessibleExercises.map((exercise) => [exercise.id, exercise.name]),
    );

    const previousDay = await prisma.workoutDay.findFirst({
      where: {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        OR: [
          { date: { lt: payload.date } },
          {
            date: payload.date,
            OR: [
              { startedAt: { lt: payload.startedAt } },
              { startedAt: null, createdAt: { lt: payload.startedAt } },
            ],
          },
        ],
      },
      include: {
        workouts: {
          include: {
            exercise: true,
            sets: { orderBy: { setNumber: "asc" } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: [{ date: "desc" }, { startedAt: "desc" }, { createdAt: "desc" }],
    });
    const previousVolume = previousDay
      ? serializeWorkoutDay(previousDay).totalVolume
      : 0;

    const previousSets = await prisma.workoutSet.findMany({
      where: {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        workout: {
          exerciseId: { in: exerciseIds },
          workoutDay: {
            OR: [
              { date: { lt: payload.date } },
              {
                date: payload.date,
                OR: [
                  { startedAt: { lt: payload.startedAt } },
                  { startedAt: null, createdAt: { lt: payload.startedAt } },
                ],
              },
            ],
          },
        },
      },
      select: {
        weightLbs: true,
        workout: { select: { exerciseId: true } },
      },
    });
    const maxWeightByExercise = new Map<string, number>();
    for (const set of previousSets) {
      if (set.weightLbs == null) continue;
      const current = maxWeightByExercise.get(set.workout.exerciseId);
      if (current == null || set.weightLbs > current) {
        maxWeightByExercise.set(set.workout.exerciseId, set.weightLbs);
      }
    }

    const previousExerciseWorkouts = await prisma.workout.findMany({
      where: {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        exerciseId: { in: exerciseIds },
        workoutDay: {
          OR: [
            { date: { lt: payload.date } },
            {
              date: payload.date,
              OR: [
                { startedAt: { lt: payload.startedAt } },
                { startedAt: null, createdAt: { lt: payload.startedAt } },
              ],
            },
          ],
        },
      },
      include: {
        sets: { orderBy: { setNumber: "asc" } },
      },
      orderBy: { performedAt: "desc" },
      take: 300,
    });
    const previousByExercise = new Map<
      string,
      { volume: number; topWeightLbs: number | null }
    >();
    for (const workout of previousExerciseWorkouts) {
      if (previousByExercise.has(workout.exerciseId)) continue;
      let volume = 0;
      let topWeightLbs: number | null = null;
      for (const set of workout.sets) {
        volume += setVolume(set.weightLbs, set.reps);
        if (
          set.weightLbs != null &&
          (topWeightLbs == null || set.weightLbs > topWeightLbs)
        ) {
          topWeightLbs = set.weightLbs;
        }
      }
      previousByExercise.set(workout.exerciseId, { volume, topWeightLbs });
    }

    const savedDayId = await prisma.$transaction(async (tx) => {
      const day = await tx.workoutDay.create({
        data: {
          organizationId: ctx.organizationId,
          userId: ctx.userId,
          date: payload.date,
          dayType: payload.dayType,
          startedAt: payload.startedAt,
          endedAt: payload.endedAt,
          durationSeconds: payload.durationSeconds,
          notes: payload.notes,
        },
      });

      for (const workout of payload.workouts) {
        await tx.workout.create({
          data: {
            organizationId: ctx.organizationId,
            userId: ctx.userId,
            workoutDayId: day.id,
            exerciseId: workout.exerciseId,
            exerciseName:
              exerciseNameById.get(workout.exerciseId) ?? "Exercise",
            sets: {
              create: workout.sets.map((set, index) => {
                const previousMax = maxWeightByExercise.get(workout.exerciseId);
                return {
                  organizationId: ctx.organizationId,
                  userId: ctx.userId,
                  setNumber: index + 1,
                  weightLbs: set.weightLbs,
                  reps: set.reps,
                  rpe: set.rpe,
                  isPr:
                    set.weightLbs != null &&
                    (previousMax == null || set.weightLbs > previousMax),
                };
              }),
            },
          },
        });
      }

      return day.id;
    });

    const saved = await prisma.workoutDay.findUnique({
      where: { id: savedDayId },
      include: {
        workouts: {
          include: {
            exercise: true,
            sets: { orderBy: { setNumber: "asc" } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!saved)
      throw new FitnessHttpError(
        "Workout saved but could not be reloaded",
        500,
      );
    const day = serializeWorkoutDay(saved);
    const totalVolume = day.totalVolume;
    const exerciseSummaries = day.workouts.map((workout) => {
      const topWeightLbs = workout.sets.reduce<number | null>((top, set) => {
        if (set.weightLbs == null) return top;
        return top == null || set.weightLbs > top ? set.weightLbs : top;
      }, null);
      const previous = previousByExercise.get(workout.exerciseId) ?? {
        volume: 0,
        topWeightLbs: null,
      };
      return {
        exerciseId: workout.exerciseId,
        exerciseName: workout.exerciseName,
        topWeightLbs,
        previousTopWeightLbs: previous.topWeightLbs,
        topWeightChangePct: pctChange(topWeightLbs, previous.topWeightLbs),
        setCount: workout.sets.length,
        volume: workout.totalVolume,
        previousVolume: previous.volume,
        volumeChangePct: pctChange(workout.totalVolume, previous.volume),
        prCount: workout.sets.filter((set) => set.isPr).length,
      };
    });
    return NextResponse.json({
      ok: true,
      day,
      summary: {
        totalVolume,
        previousVolume,
        growthPct:
          previousVolume > 0
            ? Math.round(
                ((totalVolume - previousVolume) / previousVolume) * 1000,
              ) / 10
            : null,
        prCount: day.prCount,
        exercises: exerciseSummaries,
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
