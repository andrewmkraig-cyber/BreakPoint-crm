import { getServerSession } from "next-auth";
import { createHash, randomBytes } from "crypto";

import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_FITNESS_DAYS,
  FITNESS_BODY_PARTS,
  FITNESS_DAY_TYPES,
  slugifyFitnessName,
  type FitnessExercise,
  type FitnessStepsDay,
  type FitnessWorkoutDay,
} from "@/lib/fitness";

export class FitnessHttpError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export type FitnessContext = {
  organizationId: string;
  userId: string;
  userName: string;
};

type WorkoutDayWithDetails = Awaited<ReturnType<typeof fetchWorkoutDayByDate>>;

export const APPLE_HEALTH_SOURCE = "apple-health-shortcut";

export function isoDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseDateOnly(value: string | null | undefined): Date {
  if (!value) return todayInEastern();
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new FitnessHttpError("Date must be YYYY-MM-DD", 400);
  const [, y, m, d] = match;
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 12, 0, 0));
}

export function todayInEastern(): Date {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [y, m, d] = fmt.format(new Date()).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

export function shiftDate(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function createFitnessHealthToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashFitnessHealthToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function requireFitnessContext(): Promise<FitnessContext> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    throw new FitnessHttpError("Sign in required", 401);
  }

  const org = await getCurrentOrg();
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, name: true, email: true },
  });
  if (!user) throw new FitnessHttpError("User not found", 404);

  return {
    organizationId: org.id,
    userId: user.id,
    userName: user.name?.trim() || user.email || "You",
  };
}

export async function ensureFitnessDefaults(
  organizationId: string,
): Promise<void> {
  const rows = DEFAULT_FITNESS_DAYS.flatMap((day, dayIndex) =>
    day.exercises.map((exercise, exerciseIndex) => ({
      organizationId,
      ownerKey: "default",
      userId: null,
      name: exercise.name,
      slug: slugifyFitnessName(exercise.name),
      bodyPart: exercise.bodyPart,
      defaultDay: day.dayType,
      sortOrder: dayIndex * 100 + exerciseIndex,
      isDefault: true,
    })),
  );
  await prisma.exercise.createMany({ data: rows, skipDuplicates: true });
}

export async function fetchAccessibleExercises(
  organizationId: string,
  userId: string,
): Promise<FitnessExercise[]> {
  const exercises = await prisma.exercise.findMany({
    where: {
      organizationId,
      OR: [{ isDefault: true }, { userId }],
    },
    orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
  });

  const statsByExercise = await fetchExerciseStats(
    organizationId,
    userId,
    exercises.map((exercise) => exercise.id),
  );

  return exercises.map((exercise) => ({
    id: exercise.id,
    name: exercise.name,
    slug: exercise.slug,
    bodyPart: exercise.bodyPart,
    defaultDay: exercise.defaultDay,
    sortOrder: exercise.sortOrder,
    isDefault: exercise.isDefault,
    isCustom: !exercise.isDefault,
    last: statsByExercise.get(exercise.id)?.last ?? null,
    best: statsByExercise.get(exercise.id)?.best ?? null,
  }));
}

type ExerciseStats = Pick<FitnessExercise, "best" | "last">;

async function fetchExerciseStats(
  organizationId: string,
  userId: string,
  exerciseIds: string[],
): Promise<Map<string, ExerciseStats>> {
  if (exerciseIds.length === 0) return new Map();
  const workouts = await prisma.workout.findMany({
    where: {
      organizationId,
      userId,
      exerciseId: { in: exerciseIds },
    },
    include: {
      workoutDay: { select: { date: true } },
      sets: { orderBy: { setNumber: "asc" } },
    },
    orderBy: { performedAt: "desc" },
    take: 1000,
  });
  const stats = new Map<string, ExerciseStats>();
  for (const workout of workouts) {
    const existing = stats.get(workout.exerciseId) ?? {
      last: null,
      best: null,
    };
    const completeSets = workout.sets
      .filter((set) => set.weightLbs != null && set.reps != null)
      .map((set) => ({
        id: set.id,
        setNumber: set.setNumber,
        weightLbs: set.weightLbs,
        reps: set.reps,
        rpe: set.rpe,
        isPr: set.isPr,
      }));
    if (completeSets.length === 0) continue;

    if (!existing.last) {
      const bestSet = [...completeSets].sort(
        (a, b) =>
          setVolume(b.weightLbs, b.reps) - setVolume(a.weightLbs, a.reps),
      )[0];
      existing.last = {
        date: isoDateOnly(workout.workoutDay.date),
        weightLbs: bestSet.weightLbs,
        reps: bestSet.reps,
        rpe: bestSet.rpe ?? null,
        volume: setVolume(bestSet.weightLbs, bestSet.reps),
        sets: completeSets,
      };
    }

    for (const set of completeSets) {
      if (set.weightLbs == null) continue;
      if (
        existing.best?.weightLbs == null ||
        set.weightLbs > existing.best.weightLbs ||
        (set.weightLbs === existing.best.weightLbs &&
          (set.reps ?? 0) > (existing.best.reps ?? 0))
      ) {
        existing.best = {
          date: isoDateOnly(workout.workoutDay.date),
          weightLbs: set.weightLbs,
          reps: set.reps,
        };
      }
    }
    stats.set(workout.exerciseId, existing);
  }
  return stats;
}

export async function fetchWorkoutDayByDate(
  organizationId: string,
  userId: string,
  date: Date,
) {
  return prisma.workoutDay.findFirst({
    where: {
      organizationId,
      userId,
      date,
    },
    include: workoutDayInclude,
    orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
  });
}

export async function fetchHistoryDays(
  organizationId: string,
  userId: string,
): Promise<FitnessWorkoutDay[]> {
  const days = await prisma.workoutDay.findMany({
    where: { organizationId, userId },
    include: workoutDayInclude,
    orderBy: [{ date: "desc" }, { startedAt: "desc" }, { createdAt: "desc" }],
    take: 180,
  });
  return days.map(serializeWorkoutDay);
}

export async function fetchStepSeries(
  organizationId: string,
  userId: string,
  anchor: Date,
): Promise<{
  today: FitnessStepsDay;
  yesterday: FitnessStepsDay | null;
  series30: FitnessStepsDay[];
  series365: FitnessStepsDay[];
}> {
  const start = shiftDate(anchor, -364);
  const rows = await prisma.dailySteps.findMany({
    where: {
      organizationId,
      userId,
      date: { gte: start, lte: anchor },
    },
    orderBy: { date: "asc" },
  });
  const byDate = new Map(rows.map((row) => [isoDateOnly(row.date), row]));
  const todayIso = isoDateOnly(anchor);
  const yesterdayIso = isoDateOnly(shiftDate(anchor, -1));
  const series365 = Array.from({ length: 365 }, (_, index) => {
    const date = shiftDate(anchor, index - 364);
    const iso = isoDateOnly(date);
    const row = byDate.get(iso);
    return {
      date: iso,
      steps: row?.steps ?? 0,
      source: row?.source ?? APPLE_HEALTH_SOURCE,
    };
  });
  const series30 = series365.slice(-30);
  return {
    today: series365.find((row) => row.date === todayIso) ?? {
      date: todayIso,
      steps: 0,
      source: APPLE_HEALTH_SOURCE,
    },
    yesterday: series365.find((row) => row.date === yesterdayIso) ?? null,
    series30,
    series365,
  };
}

export async function fetchAppleHealthConnection(
  organizationId: string,
  userId: string,
): Promise<{ connected: boolean; source: string; lastSyncAt: string | null }> {
  const connection = await prisma.fitnessHealthConnection.findUnique({
    where: {
      organizationId_userId_source: {
        organizationId,
        userId,
        source: APPLE_HEALTH_SOURCE,
      },
    },
    select: { enabled: true, lastSyncAt: true, source: true },
  });
  return {
    connected: !!connection?.enabled,
    source: APPLE_HEALTH_SOURCE,
    lastSyncAt: connection?.lastSyncAt?.toISOString() ?? null,
  };
}

export async function fetchTeammates(
  organizationId: string,
  currentUserId: string,
): Promise<Array<{ id: string; name: string }>> {
  const memberships = await prisma.organizationMembership.findMany({
    where: {
      organizationId,
      userId: { not: currentUserId },
    },
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
    orderBy: { joinedAt: "asc" },
  });
  return memberships.map((membership) => ({
    id: membership.user.id,
    name: membership.user.name?.trim() || membership.user.email || "Teammate",
  }));
}

export function serializeWorkoutDay(
  day: NonNullable<WorkoutDayWithDetails>,
): FitnessWorkoutDay {
  const workouts = day.workouts.map((workout) => {
    const sets = workout.sets.map((set) => ({
      id: set.id,
      setNumber: set.setNumber,
      weightLbs: set.weightLbs,
      reps: set.reps,
      rpe: set.rpe,
      isPr: set.isPr,
    }));
    const totalVolume = sets.reduce(
      (sum, set) => sum + setVolume(set.weightLbs, set.reps),
      0,
    );
    return {
      id: workout.id,
      exerciseId: workout.exerciseId,
      exerciseName: workout.exerciseName || workout.exercise.name,
      bodyPart: workout.exercise.bodyPart,
      isDefaultExercise: workout.exercise.isDefault,
      sets,
      totalVolume,
      performedAt: workout.performedAt.toISOString(),
    };
  });
  return {
    id: day.id,
    date: isoDateOnly(day.date),
    dayType: day.dayType,
    startedAt: day.startedAt?.toISOString() ?? null,
    endedAt: day.endedAt?.toISOString() ?? null,
    durationSeconds: day.durationSeconds ?? null,
    totalSets: workouts.reduce((sum, workout) => sum + workout.sets.length, 0),
    totalVolume: workouts.reduce(
      (sum, workout) => sum + workout.totalVolume,
      0,
    ),
    prCount: workouts.reduce(
      (sum, workout) => sum + workout.sets.filter((set) => set.isPr).length,
      0,
    ),
    workouts,
  };
}

export function setVolume(
  weightLbs: number | null | undefined,
  reps: number | null | undefined,
): number {
  if (weightLbs == null || reps == null) return 0;
  return Math.max(0, weightLbs) * Math.max(0, reps);
}

export function publicFitnessMetadata() {
  return {
    dayTypes: [...FITNESS_DAY_TYPES],
    bodyParts: [...FITNESS_BODY_PARTS],
  };
}

export const workoutDayInclude = {
  workouts: {
    include: {
      exercise: true,
      sets: { orderBy: { setNumber: "asc" as const } },
    },
    orderBy: { createdAt: "asc" as const },
  },
};
