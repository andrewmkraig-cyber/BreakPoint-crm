export const DEFAULT_FITNESS_DAYS = [
  {
    dayType: "Shoulders",
    exercises: [
      { name: "Dumbbell Shoulder Press", bodyPart: "Shoulders" },
      { name: "Machine Shoulder Press", bodyPart: "Shoulders" },
      { name: "EZ Behind Head Press", bodyPart: "Shoulders" },
      { name: "Strict Lateral Raise", bodyPart: "Shoulders" },
      { name: "DB Prone Trap Raise", bodyPart: "Shoulders" },
      { name: "Flat Shoulder Press", bodyPart: "Shoulders" },
    ],
  },
  {
    dayType: "Squats, Quads & Calves",
    exercises: [
      { name: "Squat", bodyPart: "Quads & Calves" },
      { name: "Leg Press", bodyPart: "Quads & Calves" },
      { name: "Bulgarian Split Squat", bodyPart: "Quads & Calves" },
      { name: "Machine Knee Extension", bodyPart: "Quads & Calves" },
      { name: "Banded Reverse Nordic", bodyPart: "Quads & Calves" },
      { name: "Smith Calf Raise Super Set", bodyPart: "Quads & Calves" },
    ],
  },
  {
    dayType: "Biceps & Triceps",
    exercises: [
      { name: "Close Grip Bench Press", bodyPart: "Arms" },
      { name: "Strict Curl", bodyPart: "Arms" },
      { name: "Preacher Hammer Curl", bodyPart: "Arms" },
      { name: "Bicep Opener Super Set", bodyPart: "Arms" },
      { name: "Partial DB Triceps Kickback", bodyPart: "Arms" },
      { name: "Rope Triceps Extension", bodyPart: "Arms" },
      { name: "EZ Bar French Press", bodyPart: "Arms" },
    ],
  },
  {
    dayType: "Abs, Hip Flexors, Obliques",
    exercises: [
      { name: "Hanging Knee/Leg Raise", bodyPart: "Core" },
      { name: "Back Extension Ab Crunch", bodyPart: "Core" },
      { name: "Back Extension Side Crunch", bodyPart: "Core" },
      { name: "Decline Oblique Twist", bodyPart: "Core" },
      { name: "Ab Roller", bodyPart: "Core" },
      { name: "Compression Leg Raise", bodyPart: "Core" },
    ],
  },
  {
    dayType: "Deadlifts, Glutes, Hamstrings",
    exercises: [
      { name: "Deadlift", bodyPart: "Posterior" },
      { name: "Hip Thruster", bodyPart: "Posterior" },
      { name: "Nordic Hamstring Curl", bodyPart: "Posterior" },
      { name: "Prone Hamstring Curl", bodyPart: "Posterior" },
      { name: "KB Sumo Pulse Deadlift", bodyPart: "Posterior" },
      { name: "Banded Adduction + Abduction", bodyPart: "Posterior" },
      { name: "KB Jefferson Curl", bodyPart: "Posterior" },
    ],
  },
  {
    dayType: "Bench Press & Chest",
    exercises: [
      { name: "Bench Press", bodyPart: "Chest" },
      { name: "Explosive Bench Press", bodyPart: "Chest" },
      { name: "Dips", bodyPart: "Chest" },
      { name: "Incline Dumbbell Press", bodyPart: "Chest" },
      { name: "Cable Chest Press", bodyPart: "Chest" },
      { name: "Cable Flies", bodyPart: "Chest" },
      { name: "Pec/Trap Complex", bodyPart: "Chest" },
    ],
  },
  {
    dayType: "Upper Back",
    exercises: [
      { name: "Wide Grip Pull Up", bodyPart: "Upper Back" },
      { name: "Scapular Pull Up", bodyPart: "Upper Back" },
      { name: "Single Arm T-Bar Row", bodyPart: "Upper Back" },
      { name: "DB Seal Row", bodyPart: "Upper Back" },
      { name: "2x Handle Lat Pulldown", bodyPart: "Upper Back" },
      { name: "Rotating Cable Cross Over", bodyPart: "Upper Back" },
      { name: "2x Dumbbell Lat Pull Over", bodyPart: "Upper Back" },
    ],
  },
] as const;

export const FITNESS_DAY_TYPES = DEFAULT_FITNESS_DAYS.map((day) => day.dayType);

export const FITNESS_BODY_PARTS = [
  "All",
  "Shoulders",
  "Quads & Calves",
  "Arms",
  "Core",
  "Posterior",
  "Chest",
  "Upper Back",
] as const;

export type FitnessRange = "week" | "month" | "all";

export type FitnessExercise = {
  id: string;
  name: string;
  slug: string;
  bodyPart: string;
  defaultDay: string | null;
  sortOrder: number;
  isDefault: boolean;
  isCustom: boolean;
  last: {
    date: string;
    weightLbs: number | null;
    reps: number | null;
    rpe: number | null;
    volume: number;
    sets: FitnessSet[];
  } | null;
  best: {
    date: string;
    weightLbs: number | null;
    reps: number | null;
  } | null;
};

export type FitnessSet = {
  id?: string;
  setNumber: number;
  weightLbs: number | null;
  reps: number | null;
  rpe?: number | null;
  isPr?: boolean;
};

export type FitnessWorkout = {
  id: string;
  exerciseId: string;
  exerciseName: string;
  bodyPart: string;
  isDefaultExercise: boolean;
  sets: FitnessSet[];
  totalVolume: number;
  performedAt: string;
};

export type FitnessWorkoutDay = {
  id: string;
  date: string;
  dayType: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  totalSets: number;
  totalVolume: number;
  prCount: number;
  workouts: FitnessWorkout[];
};

export type FitnessStepsDay = {
  date: string;
  steps: number;
  source: string;
};

export type FitnessSnapshot = {
  ok: true;
  date: string;
  user: { id: string; name: string };
  dayTypes: string[];
  bodyParts: string[];
  exercises: FitnessExercise[];
  selectedDay: FitnessWorkoutDay | null;
  history: FitnessWorkoutDay[];
  steps: {
    today: FitnessStepsDay;
    yesterday: FitnessStepsDay | null;
    series30: FitnessStepsDay[];
    series365: FitnessStepsDay[];
    connected: boolean;
    lastSyncAt: string | null;
  };
};

export type FitnessSavePayload = {
  workoutDayId?: string | null;
  date: string;
  dayType: string;
  startedAt?: string | null;
  endedAt?: string | null;
  durationSeconds?: number | null;
  notes?: string;
  workouts: Array<{
    exerciseId: string;
    sets: Array<{
      weightLbs: number | null;
      weightMode?: "bodyweight" | null;
      reps: number | null;
      rpe?: number | null;
    }>;
  }>;
};

export type FitnessSaveResponse = {
  ok: true;
  day: FitnessWorkoutDay;
  summary: {
    totalVolume: number;
    previousVolume: number;
    growthPct: number | null;
    prCount: number;
    exercises: FitnessSavedExerciseSummary[];
  };
};

export type FitnessSavedExerciseSummary = {
  exerciseId: string;
  exerciseName: string;
  bodyPart: string;
  topScore: number | null;
  topWeightLbs: number | null;
  previousTopWeightLbs: number | null;
  topWeightChangePct: number | null;
  setCount: number;
  volume: number;
  previousVolume: number;
  volumeChangePct: number | null;
  prCount: number;
};

export type FitnessCreateExercisePayload = {
  name: string;
  bodyPart: string;
  defaultDay?: string | null;
};

export type FitnessHealthConnectionSetup = {
  token: string;
  ingestUrl: string;
  source: string;
};

export type FitnessHealthConnectionResponse = {
  ok: true;
  connected: boolean;
  source: string;
  lastSyncAt: string | null;
  setup?: FitnessHealthConnectionSetup;
};

export function slugifyFitnessName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

async function readJson<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!res.ok) {
    throw new Error(body?.error || `Fitness request failed (${res.status})`);
  }
  return body as T;
}

export async function getFitnessSnapshot(
  date?: string,
): Promise<FitnessSnapshot> {
  const qs = date ? `?date=${encodeURIComponent(date)}` : "";
  const res = await fetch(`/api/fitness${qs}`, { cache: "no-store" });
  return readJson<FitnessSnapshot>(res);
}

export async function saveFitnessWorkout(
  payload: FitnessSavePayload,
): Promise<FitnessSaveResponse> {
  const res = await fetch("/api/fitness/workouts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return readJson<FitnessSaveResponse>(res);
}

export async function createFitnessExercise(
  payload: FitnessCreateExercisePayload,
): Promise<{ ok: true; exercise: FitnessExercise }> {
  const res = await fetch("/api/fitness/exercises", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return readJson<{ ok: true; exercise: FitnessExercise }>(res);
}

export async function createAppleHealthConnection(): Promise<FitnessHealthConnectionResponse> {
  const res = await fetch("/api/fitness/steps/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  return readJson<FitnessHealthConnectionResponse>(res);
}
