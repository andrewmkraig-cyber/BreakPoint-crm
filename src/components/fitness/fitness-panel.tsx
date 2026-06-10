"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Footprints,
  GripVertical,
  Loader2,
  Minus,
  Pencil,
  Play,
  Plus,
  RefreshCcw,
  Save,
  SkipForward,
  TimerReset,
  Trash2,
  Trophy,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { BarbellIcon } from "@/components/fitness/barbell-icon";
import { Button } from "@/components/ui/button";
import { TabStrip } from "@/components/ui/tab-strip";
import {
  FITNESS_BODY_PARTS,
  createAppleHealthConnection,
  createFitnessExercise,
  getFitnessSnapshot,
  saveFitnessStepsDay,
  saveFitnessWorkout,
  type FitnessExercise,
  type FitnessHealthConnectionSetup,
  type FitnessRange,
  type FitnessSavedExerciseSummary,
  type FitnessSnapshot,
  type FitnessStepsDay,
  type FitnessWorkoutDay,
} from "@/lib/fitness";
import {
  FITNESS_PANEL_MIN_H,
  FITNESS_PANEL_MIN_W,
  useFitnessPanel,
} from "@/lib/fitness-panel-context";
import { useFloatingZ } from "@/lib/floating-z";
import { cn } from "@/lib/utils";

type MainTab = "record" | "history";
type DraftSet = { weight: string; reps: string; rpe: string; isPr?: boolean };
type DraftWorkout = { sets: DraftSet[] };
type ActiveWorkoutSession = {
  date: string;
  startedAt: string;
  endedAt?: string | null;
  durationSeconds?: number | null;
  dayType: string | null;
  editingWorkoutDayId?: string | null;
  drafts: Record<string, DraftWorkout>;
};

const MAIN_TABS = [
  { id: "record", label: "Record" },
  { id: "history", label: "History" },
] satisfies Array<{ id: MainTab; label: string }>;

const RANGE_TABS = [
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "all", label: "All-time" },
] satisfies Array<{ id: FitnessRange; label: string }>;

const DEFAULT_REST_MS = 120_000;
const REST_INCREMENT_MS = 60_000;
const ACTIVE_WORKOUT_STORAGE_KEY = "ace:fitness-active-workout";
const BODYWEIGHT_VALUE = "BW";

function todayIsoEt(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

function niceNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "-";
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(1);
}

function isCoreBodyPart(bodyPart: string | null | undefined): boolean {
  return bodyPart === "Core";
}

function isBodyweightValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "bw" ||
    normalized === "bodyweight" ||
    normalized === "body weight"
  );
}

function setVolume(
  weightLbs: number | null | undefined,
  reps: number | null | undefined,
  bodyPart?: string | null,
): number {
  if (reps == null) return 0;
  if (weightLbs == null) return isCoreBodyPart(bodyPart) ? Math.max(0, reps) : 0;
  return Math.max(0, weightLbs) * Math.max(0, reps);
}

function recordScore(
  weightLbs: number | null | undefined,
  reps: number | null | undefined,
  bodyPart?: string | null,
): number | null {
  if (reps == null) return null;
  if (isCoreBodyPart(bodyPart)) return setVolume(weightLbs, reps, bodyPart);
  return weightLbs == null ? null : weightLbs;
}

function shortDate(iso: string): string {
  const date = new Date(`${iso}T12:00:00`);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function longDate(iso: string): string {
  const date = new Date(`${iso}T12:00:00`);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

function shortDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function shortTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || seconds < 0) return "--";
  const total = Math.max(0, Math.round(seconds));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function sessionDurationSeconds(day: FitnessWorkoutDay): number | null {
  if (day.durationSeconds != null) return day.durationSeconds;
  if (!day.startedAt || !day.endedAt) return null;
  return Math.max(
    0,
    Math.round(
      (new Date(day.endedAt).getTime() - new Date(day.startedAt).getTime()) /
        1000,
    ),
  );
}

function readStoredActiveSession(): ActiveWorkoutSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ACTIVE_WORKOUT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ActiveWorkoutSession>;
    if (
      typeof parsed.date !== "string" ||
      typeof parsed.startedAt !== "string" ||
      Number.isNaN(new Date(parsed.startedAt).getTime())
    ) {
      return null;
    }
    return {
      date: parsed.date,
      startedAt: parsed.startedAt,
      endedAt:
        typeof parsed.endedAt === "string" &&
        !Number.isNaN(new Date(parsed.endedAt).getTime())
          ? parsed.endedAt
          : null,
      durationSeconds:
        typeof parsed.durationSeconds === "number" &&
        Number.isFinite(parsed.durationSeconds)
          ? parsed.durationSeconds
          : null,
      dayType: typeof parsed.dayType === "string" ? parsed.dayType : null,
      editingWorkoutDayId:
        typeof parsed.editingWorkoutDayId === "string"
          ? parsed.editingWorkoutDayId
          : null,
      drafts:
        parsed.drafts && typeof parsed.drafts === "object"
          ? (parsed.drafts as Record<string, DraftWorkout>)
          : {},
    };
  } catch {
    return null;
  }
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function isoToUtcDate(iso: string): Date {
  return new Date(`${iso}T12:00:00.000Z`);
}

function shiftIsoDate(iso: string, days: number): string {
  const date = isoToUtcDate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function clampIsoDate(iso: string, minIso: string, maxIso: string): string {
  if (iso < minIso) return minIso;
  if (iso > maxIso) return maxIso;
  return iso;
}

function startOfWeekIso(iso: string): string {
  const date = isoToUtcDate(iso);
  return shiftIsoDate(iso, -date.getUTCDay());
}

function startOfMonthIso(iso: string): string {
  return `${iso.slice(0, 8)}01`;
}

function startOfYearIso(iso: string): string {
  return `${iso.slice(0, 4)}-01-01`;
}

function averageStepsBetween(
  stepsByDate: Map<string, FitnessStepsDay>,
  startIso: string,
  endIso: string,
): number {
  if (startIso > endIso) return 0;
  let sum = 0;
  let count = 0;
  for (let date = startIso; date <= endIso; date = shiftIsoDate(date, 1)) {
    const row = stepsByDate.get(date);
    if (row == null) continue;
    sum += row.steps;
    count += 1;
  }
  return count === 0 ? 0 : Math.round(sum / count);
}

function upsertStepDay(
  series: FitnessStepsDay[],
  day: FitnessStepsDay,
): FitnessStepsDay[] {
  if (series.some((row) => row.date === day.date)) {
    return series.map((row) => (row.date === day.date ? day : row));
  }
  if (series.length === 0) return [day];
  if (day.date < series[0].date || day.date > series[series.length - 1].date) {
    return series;
  }
  return [...series, day].sort((a, b) => a.date.localeCompare(b.date));
}

function applyStepsDay(
  steps: FitnessSnapshot["steps"],
  day: FitnessStepsDay,
): FitnessSnapshot["steps"] {
  return {
    ...steps,
    today: steps.today.date === day.date ? day : steps.today,
    yesterday:
      steps.yesterday?.date === day.date ? day : (steps.yesterday ?? null),
    series30: upsertStepDay(steps.series30, day),
    series365: upsertStepDay(steps.series365, day),
  };
}

function setIsComplete(set: DraftSet): boolean {
  return set.weight.trim() !== "" && set.reps.trim() !== "";
}

function parseDraftNumber(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildEmptySet(): DraftSet {
  return { weight: "", reps: "", rpe: "" };
}

function buildDraftsFromWorkoutDay(
  day: FitnessWorkoutDay,
): Record<string, DraftWorkout> {
  return Object.fromEntries(
    day.workouts.map((workout) => [
      workout.exerciseId,
      {
        sets: workout.sets.map((set) => ({
          weight:
            set.weightLbs == null && isCoreBodyPart(workout.bodyPart)
              ? BODYWEIGHT_VALUE
              : set.weightLbs == null
                ? ""
                : String(set.weightLbs),
          reps: set.reps == null ? "" : String(set.reps),
          rpe: set.rpe == null ? "" : String(set.rpe),
          isPr: set.isPr,
        })),
      },
    ]),
  );
}

function buildDraftsForDay(
  snapshot: FitnessSnapshot,
  dayType: string,
): Record<string, DraftWorkout> {
  if (snapshot.selectedDay?.dayType === dayType) {
    return buildDraftsFromWorkoutDay(snapshot.selectedDay);
  }
  return {};
}

function defaultBodyPartForDay(
  snapshot: FitnessSnapshot,
  dayType: string,
): string {
  return (
    snapshot.exercises.find((exercise) => exercise.defaultDay === dayType)
      ?.bodyPart ??
    FITNESS_BODY_PARTS.find((part) => part !== "All") ??
    "Shoulders"
  );
}

function dateWithinRange(dateIso: string, range: FitnessRange): boolean {
  if (range === "all") return true;
  const today = new Date(`${todayIsoEt()}T12:00:00`);
  const date = new Date(`${dateIso}T12:00:00`);
  const diff = Math.floor((today.getTime() - date.getTime()) / 86_400_000);
  return diff >= 0 && diff < (range === "week" ? 7 : 30);
}

function workoutDayMatchesBodyPart(
  day: FitnessWorkoutDay,
  bodyPart: string,
): boolean {
  if (bodyPart === "All") return true;
  return day.workouts.some((workout) => workout.bodyPart === bodyPart);
}

function useRestTimer() {
  const [restEndsAt, setRestEndsAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!restEndsAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [restEndsAt]);

  const remaining = restEndsAt
    ? Math.max(0, Math.ceil((restEndsAt - now) / 1000))
    : 0;
  useEffect(() => {
    if (restEndsAt && remaining === 0) {
      const timeout = window.setTimeout(() => setRestEndsAt(null), 600);
      return () => window.clearTimeout(timeout);
    }
  }, [remaining, restEndsAt]);

  return {
    remaining,
    start: () => {
      const timestamp = Date.now();
      setNow(timestamp);
      setRestEndsAt(timestamp + DEFAULT_REST_MS);
    },
    addMinute: () => {
      const timestamp = Date.now();
      setNow(timestamp);
      setRestEndsAt(
        (current) => Math.max(current ?? 0, timestamp) + REST_INCREMENT_MS,
      );
    },
    reset: () => setRestEndsAt(null),
  };
}

function useElapsedSeconds(startedAt: string | null): number {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!startedAt) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  if (!startedAt) return 0;
  return Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
}

export function FitnessPanel() {
  const {
    open,
    minimized,
    position,
    size,
    close,
    minimize,
    restore,
    setPosition,
    setSize,
  } = useFitnessPanel();
  const { z, bringToFront } = useFloatingZ(open && !minimized);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
  } | null>(null);
  const resizeRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    baseW: number;
    baseH: number;
  } | null>(null);

  const [activeTab, setActiveTab] = useState<MainTab>("record");
  const [date, setDate] = useState(todayIsoEt());
  const [snapshot, setSnapshot] = useState<FitnessSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dayType, setDayType] = useState("");
  const [drafts, setDrafts] = useState<Record<string, DraftWorkout>>({});
  const [dirty, setDirty] = useState(false);
  const [saveSummary, setSaveSummary] = useState<
    FitnessSavedExerciseSummary[] | null
  >(null);
  const [dayLabels, setDayLabels] = useState<Record<string, string>>({});
  const [editingDay, setEditingDay] = useState<string | null>(null);
  const [customName, setCustomName] = useState("");
  const [customBodyPart, setCustomBodyPart] = useState("Shoulders");
  const [historyRange, setHistoryRange] = useState<FitnessRange>("week");
  const [historyBodyPart, setHistoryBodyPart] = useState("All");
  const [stepsExpanded, setStepsExpanded] = useState(false);
  const [healthSetup, setHealthSetup] =
    useState<FitnessHealthConnectionSetup | null>(null);
  const [healthConnecting, setHealthConnecting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeSession, setActiveSession] =
    useState<ActiveWorkoutSession | null>(() => readStoredActiveSession());
  const activeSessionRef = useRef<ActiveWorkoutSession | null>(activeSession);
  const sessionDraftKeyRef = useRef("");
  const rest = useRestTimer();
  const activeSessionForDate =
    activeSession?.date === date ? activeSession : null;
  const sessionElapsedSeconds = useElapsedSeconds(
    activeSessionForDate?.startedAt ?? null,
  );

  const hydrateFromSnapshot = useCallback((next: FitnessSnapshot) => {
    const storedSession =
      activeSessionRef.current?.date === next.date
        ? activeSessionRef.current
        : null;
    const nextDayType = storedSession
      ? (storedSession.dayType ?? "")
      : next.selectedDay?.dayType || next.dayTypes[0] || "Workout";
    setDayType(nextDayType);
    setDrafts(
      storedSession
        ? storedSession.drafts
        : buildDraftsForDay(next, nextDayType),
    );
    setDirty(!!storedSession);
    setSnapshot(next);
  }, []);

  useEffect(() => {
    activeSessionRef.current = activeSession;
    if (typeof window === "undefined") return;
    if (activeSession) {
      window.localStorage.setItem(
        ACTIVE_WORKOUT_STORAGE_KEY,
        JSON.stringify(activeSession),
      );
    } else {
      window.localStorage.removeItem(ACTIVE_WORKOUT_STORAGE_KEY);
      sessionDraftKeyRef.current = "";
    }
  }, [activeSession]);

  useEffect(() => {
    if (!activeSessionForDate) return;
    if (
      activeSessionForDate.dayType == null &&
      !dayType &&
      Object.keys(activeSessionForDate.drafts).length === 0 &&
      Object.keys(drafts).length === 0
    ) {
      return;
    }
    const key = JSON.stringify({ dayType, drafts });
    if (sessionDraftKeyRef.current === key) return;
    sessionDraftKeyRef.current = key;
    setActiveSession((current) =>
      current?.date === date
        ? {
            ...current,
            dayType,
            drafts,
          }
        : current,
    );
  }, [activeSessionForDate, date, dayType, drafts]);

  useEffect(() => {
    if (!open || minimized) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getFitnessSnapshot(date)
      .then((next) => {
        if (cancelled) return;
        hydrateFromSnapshot(next);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Fitness failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [date, hydrateFromSnapshot, minimized, open, refreshKey]);

  const hasCompleteSet = useMemo(
    () =>
      Object.values(drafts).some((draft) =>
        draft.sets.some((set) => setIsComplete(set)),
      ),
    [drafts],
  );

  const requestClose = useCallback(() => {
    if (dirty && hasCompleteSet) {
      const ok = window.confirm("Close workout? You'll lose this session");
      if (!ok) return;
    }
    close();
  }, [close, dirty, hasCompleteSet]);

  const selectedExercises = useMemo(() => {
    if (!snapshot) return [];
    const byId = new Map(
      snapshot.exercises.map((exercise) => [exercise.id, exercise]),
    );
    return Object.keys(drafts)
      .map((id) => byId.get(id))
      .filter((exercise): exercise is FitnessExercise => Boolean(exercise));
  }, [drafts, snapshot]);

  const availableExercises = useMemo(() => {
    if (!snapshot || !dayType) return [];
    const draftedIds = new Set(Object.keys(drafts));
    return snapshot.exercises
      .filter(
        (exercise) =>
          exercise.defaultDay === dayType && !draftedIds.has(exercise.id),
      )
      .sort(
        (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
      );
  }, [dayType, drafts, snapshot]);

  const filteredHistory = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.history.filter(
      (day) =>
        dateWithinRange(day.date, historyRange) &&
        workoutDayMatchesBodyPart(day, historyBodyPart),
    );
  }, [historyBodyPart, historyRange, snapshot]);

  const historyStats = useMemo(
    () => buildHistoryStats(filteredHistory, historyBodyPart),
    [filteredHistory, historyBodyPart],
  );

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button,input,select,[role='tab']"))
      return;
    if (!position) return;
    bringToFront();
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      baseX: position.x,
      baseY: position.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const moveDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    setPosition({
      x: clamp(
        drag.baseX + e.clientX - drag.startX,
        8,
        window.innerWidth - size.w - 8,
      ),
      y: clamp(
        drag.baseY + e.clientY - drag.startY,
        8,
        window.innerHeight - size.h - 8,
      ),
    });
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== e.pointerId) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Pointer may already be released.
    }
    dragRef.current = null;
  };

  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    bringToFront();
    resizeRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      baseW: size.w,
      baseH: size.h,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const moveResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== e.pointerId) return;
    setSize({
      w: clamp(
        resize.baseW + e.clientX - resize.startX,
        FITNESS_PANEL_MIN_W,
        window.innerWidth - 16,
      ),
      h: clamp(
        resize.baseH + e.clientY - resize.startY,
        FITNESS_PANEL_MIN_H,
        window.innerHeight - 16,
      ),
    });
  };

  const endResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (resizeRef.current?.pointerId !== e.pointerId) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Pointer may already be released.
    }
    resizeRef.current = null;
  };

  function updateDraftSet(
    exercise: FitnessExercise,
    setIndex: number,
    field: "weight" | "reps" | "rpe",
    value: string,
  ) {
    setDrafts((prev) => {
      const nextSets = [...(prev[exercise.id]?.sets ?? [buildEmptySet()])];
      nextSets[setIndex] = { ...nextSets[setIndex], [field]: value };
      return { ...prev, [exercise.id]: { sets: nextSets } };
    });
    setSaveSummary(null);
    setDirty(true);
    if (field !== "rpe") {
      const weight =
        field === "weight"
          ? isBodyweightValue(value)
            ? 0
            : parseDraftNumber(value)
          : isBodyweightValue(
                drafts[exercise.id]?.sets[setIndex]?.weight ?? "",
              )
            ? 0
            : parseDraftNumber(
                drafts[exercise.id]?.sets[setIndex]?.weight ?? "",
              );
      const reps =
        field === "reps"
          ? parseDraftNumber(value)
          : parseDraftNumber(drafts[exercise.id]?.sets[setIndex]?.reps ?? "");
      if (weight != null && reps != null) rest.start();
    }
  }

  function bumpDraft(
    exercise: FitnessExercise,
    setIndex: number,
    field: "weight" | "reps",
    amount: number,
  ) {
    const current = drafts[exercise.id]?.sets[setIndex]?.[field] ?? "";
    const base = parseDraftNumber(current) ?? 0;
    updateDraftSet(
      exercise,
      setIndex,
      field,
      String(Math.max(0, base + amount)),
    );
  }

  function addSet(exercise: FitnessExercise) {
    setDrafts((prev) => ({
      ...prev,
      [exercise.id]: {
        sets: [
          ...(prev[exercise.id]?.sets ?? [buildEmptySet()]),
          buildEmptySet(),
        ],
      },
    }));
    setSaveSummary(null);
    setDirty(true);
  }

  function duplicateLastSet(exercise: FitnessExercise) {
    setDrafts((prev) => {
      const currentSets = prev[exercise.id]?.sets ?? [buildEmptySet()];
      const lastSet = currentSets[currentSets.length - 1] ?? buildEmptySet();
      return {
        ...prev,
        [exercise.id]: {
          sets: [
            ...currentSets,
            {
              weight: lastSet.weight,
              reps: lastSet.reps,
              rpe: lastSet.rpe,
            },
          ],
        },
      };
    });
    setSaveSummary(null);
    setDirty(true);
    rest.start();
  }

  function removeSet(exercise: FitnessExercise, setIndex: number) {
    setDrafts((prev) => {
      const currentSets = prev[exercise.id]?.sets ?? [buildEmptySet()];
      const nextSets =
        currentSets.length <= 1
          ? [buildEmptySet()]
          : currentSets.filter((_, index) => index !== setIndex);
      return {
        ...prev,
        [exercise.id]: {
          sets: nextSets,
        },
      };
    });
    setSaveSummary(null);
    setDirty(true);
  }

  function repeatLast(exercise: FitnessExercise) {
    if (!exercise.last) return;
    setDrafts((prev) => {
      const currentSets = prev[exercise.id]?.sets ?? [];
      const nextSets = exercise.last?.sets.map((set) => ({
        weight:
          set.weightLbs == null && isCoreBodyPart(exercise.bodyPart)
            ? BODYWEIGHT_VALUE
            : set.weightLbs == null
              ? ""
              : String(set.weightLbs),
        reps: set.reps == null ? "" : String(set.reps),
        rpe: set.rpe == null ? "" : String(set.rpe),
      })) ?? [buildEmptySet()];
      return {
        ...prev,
        [exercise.id]: {
          sets:
            currentSets.length === 1 && !setIsComplete(currentSets[0])
              ? nextSets
              : [...currentSets, ...nextSets],
        },
      };
    });
    setSaveSummary(null);
    setDirty(true);
    rest.start();
  }

  function removeExercise(exerciseId: string) {
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[exerciseId];
      return next;
    });
    setSaveSummary(null);
    setDirty(true);
  }

  function addExerciseToDraft(exerciseId: string) {
    if (
      !snapshot ||
      !snapshot.exercises.some((exercise) => exercise.id === exerciseId)
    ) {
      return;
    }
    setDrafts((prev) =>
      prev[exerciseId]
        ? prev
        : {
            ...prev,
            [exerciseId]: { sets: [buildEmptySet()] },
          },
    );
    setSaveSummary(null);
    setDirty(true);
  }

  function startWorkoutSession() {
    const startedAt = new Date().toISOString();
    setActiveSession({
      date,
      startedAt,
      dayType: null,
      drafts: {},
    });
    setDayType("");
    setDrafts({});
    setSaveSummary(null);
    setDirty(false);
    rest.reset();
  }

  function editSavedWorkout(day: FitnessWorkoutDay) {
    const startedAt = day.startedAt ?? new Date().toISOString();
    const durationSeconds = sessionDurationSeconds(day);
    const nextDrafts = buildDraftsFromWorkoutDay(day);
    setDate(day.date);
    setDayType(day.dayType);
    setDrafts(nextDrafts);
    setActiveSession({
      date: day.date,
      startedAt,
      endedAt: day.endedAt ?? startedAt,
      durationSeconds,
      dayType: day.dayType,
      editingWorkoutDayId: day.id,
      drafts: nextDrafts,
    });
    setSaveSummary(null);
    setDirty(false);
    rest.reset();
  }

  function cancelWorkoutSession() {
    if (hasCompleteSet) {
      const ok = window.confirm("Discard this active workout?");
      if (!ok) return;
    }
    setActiveSession(null);
    setSaveSummary(null);
    setDirty(false);
    if (snapshot) {
      setDrafts(buildDraftsForDay(snapshot, dayType));
    }
    rest.reset();
  }

  async function onAddCustomExercise() {
    if (!snapshot) return;
    const name = customName.trim();
    if (!name) return;
    try {
      const { exercise } = await createFitnessExercise({
        name,
        bodyPart: customBodyPart,
        defaultDay: dayType,
      });
      setSnapshot({
        ...snapshot,
        exercises: [...snapshot.exercises, exercise],
      });
      setDrafts((prev) => ({
        ...prev,
        [exercise.id]: { sets: [buildEmptySet()] },
      }));
      setCustomName("");
      setCustomBodyPart(defaultBodyPartForDay(snapshot, dayType));
      setDirty(true);
      toast.success("Exercise added");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Exercise failed");
    }
  }

  async function onSaveWorkout() {
    if (!snapshot) return;
    if (!activeSessionForDate) {
      toast.error("Start a workout first");
      return;
    }
    const workouts = Object.entries(drafts)
      .map(([exerciseId, draft]) => ({
        exerciseId,
        sets: draft.sets
          .map((set) => ({
            weightLbs: isBodyweightValue(set.weight)
              ? null
              : parseDraftNumber(set.weight),
            weightMode: isBodyweightValue(set.weight)
              ? ("bodyweight" as const)
              : null,
            reps: parseDraftNumber(set.reps),
            rpe: parseDraftNumber(set.rpe),
          }))
          .filter(
            (set) =>
              set.reps != null &&
              (set.weightLbs != null || set.weightMode === "bodyweight"),
          ),
      }))
      .filter((workout) => workout.sets.length > 0);
    if (workouts.length === 0) {
      toast.error("Add at least one complete set");
      return;
    }
    const editingWorkoutDayId = activeSessionForDate.editingWorkoutDayId ?? null;
    const confirmed = window.confirm(
      editingWorkoutDayId
        ? "Save changes to this finished workout?"
        : "Are you sure this workout is finished?",
    );
    if (!confirmed) return;
    try {
      const preserveEndedAt =
        editingWorkoutDayId && activeSessionForDate.endedAt
          ? new Date(activeSessionForDate.endedAt)
          : null;
      const endedAt =
        preserveEndedAt && !Number.isNaN(preserveEndedAt.getTime())
          ? preserveEndedAt
          : new Date();
      const startedAt = new Date(activeSessionForDate.startedAt);
      const durationSeconds =
        editingWorkoutDayId && activeSessionForDate.durationSeconds != null
          ? activeSessionForDate.durationSeconds
          : Math.max(
              0,
              Math.round((endedAt.getTime() - startedAt.getTime()) / 1000),
            );
      const result = await saveFitnessWorkout({
        workoutDayId: editingWorkoutDayId,
        date,
        dayType,
        startedAt: activeSessionForDate.startedAt,
        endedAt: endedAt.toISOString(),
        durationSeconds,
        workouts,
      });
      setSaveSummary(result.summary.exercises);
      toast.success(
        editingWorkoutDayId
          ? `Workout updated · ${formatDuration(durationSeconds)}`
          : `Workout saved · ${formatDuration(durationSeconds)}`,
      );
      setActiveSession(null);
      setDirty(false);
      setRefreshKey((key) => key + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Workout failed");
    }
  }

  async function onCreateAppleHealthConnection() {
    setHealthConnecting(true);
    try {
      const result = await createAppleHealthConnection();
      setHealthSetup(result.setup ?? null);
      setSnapshot((current) =>
        current
          ? {
              ...current,
              steps: {
                ...current.steps,
                connected: result.connected,
                lastSyncAt: result.lastSyncAt,
              },
            }
          : current,
      );
      toast.success("Apple Health connector created");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Apple Health setup failed",
      );
    } finally {
      setHealthConnecting(false);
    }
  }

  async function onSaveStepsDay(date: string, customSteps: number) {
    const result = await saveFitnessStepsDay({ date, steps: customSteps });
    setSnapshot((current) =>
      current
        ? {
            ...current,
            steps: applyStepsDay(current.steps, result.day),
          }
        : current,
    );
  }

  if (!open || typeof document === "undefined") return null;

  if (minimized) {
    return createPortal(
      <button
        type="button"
        onClick={restore}
        className="fixed bottom-5 right-5 z-[1100] inline-flex items-center gap-2 rounded-md border border-court-brand bg-court-surface px-3 py-2 text-sm font-semibold text-court-brand-dark shadow-lg transition hover:bg-court-brand-tint"
      >
        <BarbellIcon className="h-4 w-4" />
        Fitness
      </button>,
      document.body,
    );
  }

  const panelStyle: CSSProperties = {
    left: position?.x ?? 20,
    top: position?.y ?? 84,
    width: Math.min(
      size.w,
      typeof window === "undefined" ? size.w : window.innerWidth - 16,
    ),
    height: Math.min(
      size.h,
      typeof window === "undefined" ? size.h : window.innerHeight - 16,
    ),
    zIndex: z,
  };

  return createPortal(
    <section
      ref={panelRef}
      role="dialog"
      aria-label="Fitness"
      onPointerDown={bringToFront}
      className="fixed flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-court-border bg-court-surface shadow-2xl"
      style={panelStyle}
    >
      <div
        className="flex cursor-move items-start gap-3 border-b border-court-border bg-court-surface px-4 py-3"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
      >
        <GripVertical className="mt-1 h-4 w-4 shrink-0 text-court-fg-muted" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <BarbellIcon className="h-4 w-4 text-court-brand" />
            <h2 className="font-serif text-lg font-semibold leading-none text-court-fg">
              Fitness
            </h2>
            {dirty && hasCompleteSet ? (
              <span className="rounded-md bg-court-brand-tint px-1.5 py-0.5 text-[10px] font-semibold uppercase text-court-brand-dark">
                Unsaved
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-court-fg-muted">
            {snapshot?.user.name ?? "Workout tracker"}
          </p>
        </div>
        <button
          type="button"
          onClick={minimize}
          className="rounded-md p-1 text-court-fg-muted hover:bg-court-surface-subtle hover:text-court-fg"
          aria-label="Minimize fitness"
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={requestClose}
          className="rounded-md p-1 text-court-fg-muted hover:bg-court-surface-subtle hover:text-court-fg"
          aria-label="Close fitness"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="border-b border-court-border px-4 py-2">
        <TabStrip
          items={MAIN_TABS}
          activeId={activeTab}
          onChange={setActiveTab}
          ariaLabel="Fitness tabs"
          fullWidth
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4 sm:py-4">
        {loading ? (
          <div className="grid h-full min-h-72 place-items-center text-court-fg-muted">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : error ? (
          <div className="rounded-md border border-court-border bg-court-surface-subtle p-4 text-sm text-court-fg">
            {error}
          </div>
        ) : snapshot ? (
          <>
            {activeTab === "record" ? (
              <RecordTab
                snapshot={snapshot}
                date={date}
                dayType={dayType}
                dayLabels={dayLabels}
                editingDay={editingDay}
                drafts={drafts}
                selectedExercises={selectedExercises}
                availableExercises={availableExercises}
                activeSession={activeSessionForDate}
                sessionElapsedSeconds={sessionElapsedSeconds}
                customName={customName}
                customBodyPart={customBodyPart}
                restRemaining={rest.remaining}
                saveSummary={saveSummary}
                canSave={hasCompleteSet}
                healthSetup={healthSetup}
                healthConnecting={healthConnecting}
                onDateChange={(next) => {
                  setDate(next);
                  setSaveSummary(null);
                }}
                onDayTypeChange={(next) => {
                  if (next === dayType && activeSessionForDate?.dayType === next) {
                    setSaveSummary(null);
                    return;
                  }
                  if (hasCompleteSet) {
                    const ok = window.confirm(
                      "Switch workout day and clear this session?",
                    );
                    if (!ok) return;
                  }
                  setDayType(next);
                  setDrafts({});
                  setCustomBodyPart(defaultBodyPartForDay(snapshot, next));
                  setDirty(false);
                  setSaveSummary(null);
                }}
                onDayLabelChange={(id, label) =>
                  setDayLabels((current) => ({ ...current, [id]: label }))
                }
                onEditingDayChange={setEditingDay}
                onSetChange={updateDraftSet}
                onBump={bumpDraft}
                onAddSet={addSet}
                onDuplicateLastSet={duplicateLastSet}
                onRemoveSet={removeSet}
                onRepeat={repeatLast}
                onRemoveExercise={removeExercise}
                onAddExercise={addExerciseToDraft}
                onCustomNameChange={setCustomName}
                onCustomBodyPartChange={setCustomBodyPart}
                onAddCustomExercise={onAddCustomExercise}
                onStartSession={startWorkoutSession}
                onEditSavedWorkout={editSavedWorkout}
                onCancelSession={cancelWorkoutSession}
                onSave={onSaveWorkout}
                onDone={close}
                onCreateAppleHealthConnection={onCreateAppleHealthConnection}
                onSaveStepsDay={onSaveStepsDay}
                onRestartRest={rest.start}
                onAddRestMinute={rest.addMinute}
                onSkipRest={rest.reset}
                stepsExpanded={stepsExpanded}
                onToggleStepsExpanded={() => setStepsExpanded((v) => !v)}
              />
            ) : null}
            {activeTab === "history" ? (
              <HistoryTab
                snapshot={snapshot}
                range={historyRange}
                bodyPart={historyBodyPart}
                days={filteredHistory}
                stats={historyStats}
                stepsExpanded={stepsExpanded}
                focusDate={date}
                healthSetup={healthSetup}
                healthConnecting={healthConnecting}
                onRangeChange={setHistoryRange}
                onBodyPartChange={setHistoryBodyPart}
                onCreateAppleHealthConnection={onCreateAppleHealthConnection}
                onSaveStepsDay={onSaveStepsDay}
                onToggleStepsExpanded={() => setStepsExpanded((v) => !v)}
              />
            ) : null}
          </>
        ) : null}
      </div>

      <div
        className="absolute bottom-0 right-0 hidden h-5 w-5 cursor-nwse-resize sm:block"
        aria-hidden="true"
        onPointerDown={startResize}
        onPointerMove={moveResize}
        onPointerUp={endResize}
        onPointerCancel={endResize}
        onLostPointerCapture={endResize}
      >
        <div className="absolute bottom-1 right-1 h-3 w-3 border-b-2 border-r-2 border-court-border" />
      </div>
    </section>,
    document.body,
  );
}

function StepsHeader({
  steps,
  expanded,
  focusDate,
  healthSetup,
  healthConnecting,
  onToggleExpanded,
  onCreateAppleHealthConnection,
  onSaveStepsDay,
}: {
  steps: FitnessSnapshot["steps"];
  expanded: boolean;
  focusDate: string;
  healthSetup: FitnessHealthConnectionSetup | null;
  healthConnecting: boolean;
  onToggleExpanded: () => void;
  onCreateAppleHealthConnection: () => void;
  onSaveStepsDay: (date: string, steps: number) => Promise<void>;
}) {
  const series = steps.series365.length > 0 ? steps.series365 : steps.series30;
  const minDate = series[0]?.date ?? steps.today.date;
  const maxDate = steps.today.date;
  const [selectedStepsDate, setSelectedStepsDate] = useState(() =>
    clampIsoDate(focusDate, minDate, maxDate),
  );
  const stepsByDate = useMemo(
    () => new Map(series.map((row) => [row.date, row])),
    [series],
  );
  const selectedDate = clampIsoDate(selectedStepsDate, minDate, maxDate);
  const selectedSteps = stepsByDate.get(selectedDate) ?? {
    date: selectedDate,
    steps: 0,
    source: "apple-health-shortcut",
  };
  const selectedDayBefore = stepsByDate.get(shiftIsoDate(selectedDate, -1));
  const selectedDelta =
    selectedDayBefore == null
      ? null
      : selectedSteps.steps - selectedDayBefore.steps;
  const weekAvg = averageStepsBetween(
    stepsByDate,
    clampIsoDate(startOfWeekIso(selectedDate), minDate, maxDate),
    selectedDate,
  );
  const monthAvg = averageStepsBetween(
    stepsByDate,
    clampIsoDate(startOfMonthIso(selectedDate), minDate, maxDate),
    selectedDate,
  );
  const yearAvg = averageStepsBetween(
    stepsByDate,
    clampIsoDate(startOfYearIso(selectedDate), minDate, maxDate),
    selectedDate,
  );
  const canGoBack = selectedDate > minDate;
  const canGoForward = selectedDate < maxDate;
  const selectedStepsAreManual = selectedSteps.source === "manual";
  const [editingStepsDate, setEditingStepsDate] = useState<string | null>(null);
  const [stepsDraft, setStepsDraft] = useState("");
  const [stepsSaving, setStepsSaving] = useState(false);
  const isEditingSteps = editingStepsDate === selectedDate;

  useEffect(() => {
    setSelectedStepsDate(clampIsoDate(focusDate, minDate, maxDate));
  }, [focusDate, minDate, maxDate]);

  useEffect(() => {
    if (!editingStepsDate || editingStepsDate === selectedDate) return;
    setEditingStepsDate(null);
    setStepsDraft("");
  }, [editingStepsDate, selectedDate]);

  function startStepsEdit() {
    setEditingStepsDate(selectedDate);
    setStepsDraft(String(selectedSteps.steps));
  }

  function cancelStepsEdit() {
    setEditingStepsDate(null);
    setStepsDraft("");
  }

  async function saveStepsEdit() {
    if (!stepsDraft.trim()) {
      toast.error("Enter a valid step count");
      return;
    }
    const nextSteps = Number(stepsDraft);
    if (!Number.isFinite(nextSteps) || nextSteps < 0 || nextSteps > 200_000) {
      toast.error("Enter a valid step count");
      return;
    }
    setStepsSaving(true);
    try {
      await onSaveStepsDay(selectedDate, Math.round(nextSteps));
      setEditingStepsDate(null);
      setStepsDraft("");
      toast.success("Steps updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Steps failed to save");
    } finally {
      setStepsSaving(false);
    }
  }

  const selectedStepsValue = isEditingSteps ? (
    <>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={200000}
        value={stepsDraft}
        onChange={(e) => setStepsDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void saveStepsEdit();
          if (e.key === "Escape") cancelStepsEdit();
        }}
        className="h-8 w-28 rounded-md border border-court-border bg-court-surface-subtle px-2 text-center text-sm font-bold tabular-nums text-court-fg focus:outline-none focus:ring-2 focus:ring-court-brand/30"
        aria-label={`Steps for ${longDate(selectedSteps.date)}`}
        disabled={stepsSaving}
      />
      <button
        type="button"
        onClick={() => void saveStepsEdit()}
        disabled={stepsSaving}
        className="grid h-8 w-8 place-items-center rounded-md border border-court-border text-court-brand-dark transition hover:bg-court-brand-tint disabled:cursor-wait disabled:opacity-60"
        aria-label="Save custom steps"
      >
        {stepsSaving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Check className="h-3.5 w-3.5" />
        )}
      </button>
      <button
        type="button"
        onClick={cancelStepsEdit}
        disabled={stepsSaving}
        className="grid h-8 w-8 place-items-center rounded-md border border-court-border text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg disabled:opacity-60"
        aria-label="Cancel custom steps edit"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </>
  ) : (
    <>
      <span className="text-lg font-bold tabular-nums text-court-fg">
        {selectedSteps.steps.toLocaleString()}
      </span>
      {selectedStepsAreManual ? (
        <span className="rounded-full border border-court-brand/40 px-1.5 py-0.5 text-[10px] font-bold uppercase text-court-brand-dark">
          Custom
        </span>
      ) : null}
      {selectedDelta != null ? (
        <span
          className={cn(
            "text-xs font-semibold tabular-nums",
            selectedDelta >= 0 ? "text-court-brand-dark" : "text-court-fg-muted",
          )}
        >
          {selectedDelta >= 0 ? "+" : ""}
          {selectedDelta.toLocaleString()}
        </span>
      ) : null}
      <button
        type="button"
        onClick={startStepsEdit}
        className="grid h-7 w-7 place-items-center rounded-md border border-transparent text-court-fg-muted transition hover:border-court-border hover:bg-court-surface-subtle hover:text-court-fg"
        aria-label="Edit steps for selected day"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    </>
  );

  if (!steps.connected) {
    return (
      <div className="space-y-3 rounded-md border border-court-border bg-court-surface-subtle p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-md bg-court-surface text-court-brand">
              <Footprints className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-court-fg">
                Apple Health not connected
              </p>
              <p className="text-xs text-court-fg-muted">
                Generate a private Shortcut token, then have your iPhone post
                daily step totals into Ace.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onCreateAppleHealthConnection}
            disabled={healthConnecting}
            className="shrink-0"
          >
            {healthConnecting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Activity className="h-3.5 w-3.5" />
            )}
            Setup
          </Button>
        </div>
        <div className="rounded-md bg-court-surface px-3 py-2 text-center">
          <p className="truncate text-xs font-semibold text-court-fg-muted">
            {longDate(selectedSteps.date)}
          </p>
          <div className="mt-1 flex min-w-0 items-center justify-center gap-1.5">
            {selectedStepsValue}
          </div>
        </div>
        {healthSetup ? <AppleHealthSetup setup={healthSetup} /> : null}
      </div>
    );
  }

  const delta =
    steps.yesterday == null ? null : steps.today.steps - steps.yesterday.steps;
  const deltaPct =
    steps.yesterday == null || steps.yesterday.steps <= 0
      ? null
      : Math.round((delta! / steps.yesterday.steps) * 1000) / 10;

  return (
    <div className="rounded-md border border-court-border bg-court-surface-subtle p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-md bg-court-surface text-court-brand">
            <Footprints className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-medium text-court-fg-muted">
              Steps today
            </p>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-bold tabular-nums text-court-fg">
                {steps.today.steps.toLocaleString()}
              </span>
              {delta != null ? (
                <span
                  className={cn(
                    "text-xs font-semibold tabular-nums",
                    delta >= 0
                      ? "text-court-brand-dark"
                      : "text-court-fg-muted",
                  )}
                >
                  {delta >= 0 ? "+" : ""}
                  {deltaPct == null ? delta.toLocaleString() : `${deltaPct}%`}
                </span>
              ) : null}
            </div>
            {steps.lastSyncAt ? (
              <p className="mt-0.5 text-[11px] text-court-fg-muted">
                Last synced {shortDateTime(steps.lastSyncAt)}
              </p>
            ) : null}
          </div>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled
          className="shrink-0"
        >
          <Activity className="h-3.5 w-3.5" />
          Connected
        </Button>
      </div>
      {healthSetup ? (
        <div className="mt-3">
          <AppleHealthSetup setup={healthSetup} />
        </div>
      ) : null}
      <div className="mt-3 flex justify-end">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
        >
          History
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 transition",
              expanded ? "rotate-180" : "",
            )}
          />
        </Button>
      </div>
      {expanded ? (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-[2rem_minmax(0,1fr)_2rem] items-center rounded-md border border-court-border bg-court-surface">
            <button
              type="button"
              onClick={() =>
                setSelectedStepsDate((current) =>
                  clampIsoDate(shiftIsoDate(current, -1), minDate, maxDate),
                )
              }
              disabled={!canGoBack}
              className="grid h-10 place-items-center border-r border-court-border text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Previous step day"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="min-w-0 px-3 py-2 text-center">
              <p className="truncate text-xs font-semibold text-court-fg-muted">
                {longDate(selectedSteps.date)}
              </p>
              <div className="mt-1 flex min-w-0 items-center justify-center gap-1.5">
                {selectedStepsValue}
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                setSelectedStepsDate((current) =>
                  clampIsoDate(shiftIsoDate(current, 1), minDate, maxDate),
                )
              }
              disabled={!canGoForward}
              className="grid h-10 place-items-center border-l border-court-border text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Next step day"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <StepAverageCard label="Week avg" value={weekAvg} />
            <StepAverageCard label="Month avg" value={monthAvg} />
            <StepAverageCard label="Year avg" value={yearAvg} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StepAverageCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-court-surface px-2 py-1">
      <p className="font-semibold uppercase text-court-fg-muted">{label}</p>
      <p className="font-bold tabular-nums text-court-fg">
        {value.toLocaleString()}
      </p>
    </div>
  );
}

function AppleHealthSetup({ setup }: { setup: FitnessHealthConnectionSetup }) {
  return (
    <div className="space-y-2 rounded-md border border-court-border bg-court-surface p-3">
      <p className="text-xs font-semibold uppercase text-court-fg-muted">
        iPhone Shortcut setup
      </p>
      <CopyRow label="URL" value={setup.ingestUrl} />
      <CopyRow label="Token" value={setup.token} secret />
      <div className="space-y-1 text-xs text-court-fg-muted">
        <p>1. Shortcuts: Get Health Samples for Steps, grouped by day.</p>
        <p>2. Sum the samples and POST JSON to the URL above.</p>
        <p>3. Body: token, date as YYYY-MM-DD, and steps.</p>
      </div>
    </div>
  );
}

function CopyRow({
  label,
  value,
  secret = false,
}: {
  label: string;
  value: string;
  secret?: boolean;
}) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error(`${label} failed to copy`);
    }
  }

  return (
    <div className="grid grid-cols-[3rem_minmax(0,1fr)_2rem] items-center gap-2">
      <span className="text-xs font-semibold text-court-fg-muted">{label}</span>
      <code className="truncate rounded-md bg-court-surface-subtle px-2 py-1 text-[11px] text-court-fg">
        {secret ? `${value.slice(0, 8)}...${value.slice(-6)}` : value}
      </code>
      <button
        type="button"
        onClick={copy}
        className="grid h-8 w-8 place-items-center rounded-md border border-court-border text-court-fg-muted hover:bg-court-surface-subtle hover:text-court-fg"
        aria-label={`Copy ${label}`}
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function RecordTab(props: {
  snapshot: FitnessSnapshot;
  date: string;
  dayType: string;
  dayLabels: Record<string, string>;
  editingDay: string | null;
  drafts: Record<string, DraftWorkout>;
  selectedExercises: FitnessExercise[];
  availableExercises: FitnessExercise[];
  activeSession: ActiveWorkoutSession | null;
  sessionElapsedSeconds: number;
  customName: string;
  customBodyPart: string;
  restRemaining: number;
  saveSummary: FitnessSavedExerciseSummary[] | null;
  canSave: boolean;
  healthSetup: FitnessHealthConnectionSetup | null;
  healthConnecting: boolean;
  stepsExpanded: boolean;
  onDateChange: (date: string) => void;
  onDayTypeChange: (dayType: string) => void;
  onDayLabelChange: (dayType: string, label: string) => void;
  onEditingDayChange: (dayType: string | null) => void;
  onSetChange: (
    exercise: FitnessExercise,
    setIndex: number,
    field: "weight" | "reps" | "rpe",
    value: string,
  ) => void;
  onBump: (
    exercise: FitnessExercise,
    setIndex: number,
    field: "weight" | "reps",
    amount: number,
  ) => void;
  onAddSet: (exercise: FitnessExercise) => void;
  onDuplicateLastSet: (exercise: FitnessExercise) => void;
  onRemoveSet: (exercise: FitnessExercise, setIndex: number) => void;
  onRepeat: (exercise: FitnessExercise) => void;
  onRemoveExercise: (exerciseId: string) => void;
  onAddExercise: (exerciseId: string) => void;
  onCustomNameChange: (name: string) => void;
  onCustomBodyPartChange: (bodyPart: string) => void;
  onAddCustomExercise: () => void | Promise<void>;
  onStartSession: () => void;
  onEditSavedWorkout: (day: FitnessWorkoutDay) => void;
  onCancelSession: () => void;
  onSave: () => void;
  onDone: () => void;
  onCreateAppleHealthConnection: () => void;
  onSaveStepsDay: (date: string, steps: number) => Promise<void>;
  onRestartRest: () => void;
  onAddRestMinute: () => void;
  onSkipRest: () => void;
  onToggleStepsExpanded: () => void;
}) {
  const [recordMode, setRecordMode] = useState<"start" | "days" | "workout">(
    "start",
  );
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [exerciseToAdd, setExerciseToAdd] = useState("");
  const activeSessionStartedAt = props.activeSession?.startedAt ?? null;
  const activeSessionDayType = props.activeSession?.dayType ?? null;

  useEffect(() => {
    setRecordMode(
      activeSessionStartedAt
        ? activeSessionDayType
          ? "workout"
          : "days"
        : "start",
    );
    setShowCustomForm(false);
    setExerciseToAdd("");
  }, [activeSessionDayType, activeSessionStartedAt, props.date]);

  const dayLabel = props.dayLabels[props.dayType] ?? props.dayType;

  useEffect(() => {
    if (
      exerciseToAdd &&
      !props.availableExercises.some((exercise) => exercise.id === exerciseToAdd)
    ) {
      setExerciseToAdd("");
    }
  }, [exerciseToAdd, props.availableExercises]);

  function handleDaySelect(next: string) {
    props.onDayTypeChange(next);
    setRecordMode("workout");
  }

  function handleAddExercise() {
    if (!exerciseToAdd) return;
    props.onAddExercise(exerciseToAdd);
    setExerciseToAdd("");
  }

  if (recordMode === "start") {
    return (
      <div className="space-y-4">
        <StepsHeader
          steps={props.snapshot.steps}
          expanded={props.stepsExpanded}
          focusDate={props.date}
          healthSetup={props.healthSetup}
          healthConnecting={props.healthConnecting}
          onToggleExpanded={props.onToggleStepsExpanded}
          onCreateAppleHealthConnection={props.onCreateAppleHealthConnection}
          onSaveStepsDay={props.onSaveStepsDay}
        />

        <label className="min-w-0 text-xs font-semibold text-court-fg-muted">
          Date
          <input
            type="date"
            value={props.date}
            onChange={(e) => props.onDateChange(e.target.value)}
            className="mt-1 h-9 w-full rounded-md border border-court-border bg-court-surface px-3 text-base text-court-fg focus:outline-none focus:ring-2 focus:ring-court-brand/30 sm:text-sm"
          />
        </label>

        {props.snapshot.selectedDay ? (
          <SavedWorkoutPreview
            day={props.snapshot.selectedDay}
            onEdit={props.onEditSavedWorkout}
          />
        ) : null}

        {props.saveSummary ? (
          <SaveSummaryCards
            summaries={props.saveSummary}
            onDone={props.onDone}
          />
        ) : null}

        <button
          type="button"
          onClick={props.onStartSession}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-court-brand bg-transparent px-4 text-sm font-bold text-court-brand-dark shadow-sm transition hover:bg-court-brand-tint focus:outline-none focus-visible:ring-2 focus-visible:ring-court-brand/50"
        >
          <Play className="h-4 w-4 fill-current" />
          Start new workout
        </button>
      </div>
    );
  }

  if (recordMode === "days") {
    return (
      <div className="space-y-4">
        <WorkoutSessionBar
          startedAt={props.activeSession?.startedAt ?? null}
          elapsedSeconds={props.sessionElapsedSeconds}
          onCancel={props.onCancelSession}
        />

        <div className="rounded-md border border-court-border bg-court-surface-subtle px-3 py-2">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-court-fg-muted">
            Choose Workout
          </p>
          <p className="mt-1 text-sm font-semibold text-court-fg">
            {shortDate(props.date)}
          </p>
        </div>

        <DayPickerRows
          dayTypes={props.snapshot.dayTypes}
          activeDayType={props.dayType}
          dayLabels={props.dayLabels}
          editingDay={props.editingDay}
          onSelect={handleDaySelect}
          onLabelChange={props.onDayLabelChange}
          onEditingDayChange={props.onEditingDayChange}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setRecordMode("days")}
          className="inline-flex h-10 items-center gap-2 rounded-md border border-court-border bg-court-surface px-3 text-sm font-semibold text-court-fg transition hover:bg-court-surface-subtle"
        >
          <ArrowLeft className="h-4 w-4" />
          Days
        </button>
        <div className="min-w-0 text-right">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-court-fg-muted">
            Recording
          </p>
          <p className="truncate text-lg font-semibold text-court-fg">
            {dayLabel}
          </p>
        </div>
      </div>

      <WorkoutSessionBar
        startedAt={props.activeSession?.startedAt ?? null}
        elapsedSeconds={props.sessionElapsedSeconds}
        compact
      />

      <ExercisePicker
        dayLabel={dayLabel}
        exercises={props.availableExercises}
        value={exerciseToAdd}
        customOpen={showCustomForm}
        onChange={setExerciseToAdd}
        onAdd={handleAddExercise}
        onToggleCustom={() => setShowCustomForm((current) => !current)}
      />

      {showCustomForm ? (
        <div className="rounded-md border border-court-border p-3">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_auto]">
            <input
              value={props.customName}
              onChange={(e) => props.onCustomNameChange(e.target.value)}
              placeholder="Custom exercise"
              className="h-9 min-w-0 rounded-md border border-court-border bg-court-surface px-3 text-base text-court-fg placeholder:text-court-fg-muted focus:outline-none focus:ring-2 focus:ring-court-brand/30 sm:text-sm"
            />
            <select
              value={props.customBodyPart}
              onChange={(e) => props.onCustomBodyPartChange(e.target.value)}
              className="h-9 rounded-md border border-court-border bg-court-surface px-2 text-base text-court-fg focus:outline-none focus:ring-2 focus:ring-court-brand/30 sm:text-sm"
            >
              {FITNESS_BODY_PARTS.filter((part) => part !== "All").map(
                (part) => (
                  <option key={part}>{part}</option>
                ),
              )}
            </select>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={async () => {
                if (!props.customName.trim()) return;
                await props.onAddCustomExercise();
                setShowCustomForm(false);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </Button>
          </div>
        </div>
      ) : null}

      <div className="space-y-3">
        {props.selectedExercises.length > 0 ? (
          props.selectedExercises.map((exercise) => (
            <ExerciseCard
              key={exercise.id}
              exercise={exercise}
              draft={props.drafts[exercise.id] ?? { sets: [buildEmptySet()] }}
              onSetChange={props.onSetChange}
              onBump={props.onBump}
              onAddSet={props.onAddSet}
              onDuplicateLastSet={props.onDuplicateLastSet}
              onRemoveSet={props.onRemoveSet}
              onRepeat={props.onRepeat}
              onRemove={props.onRemoveExercise}
            />
          ))
        ) : (
          <div className="rounded-md border border-dashed border-court-border bg-court-surface-subtle px-3 py-4 text-center text-sm font-semibold text-court-fg-muted">
            No lifts added
          </div>
        )}
      </div>

      {props.saveSummary ? (
        <SaveSummaryCards summaries={props.saveSummary} onDone={props.onDone} />
      ) : null}

      <div className="space-y-2 border-t border-court-border pt-3">
        {props.restRemaining > 0 ? (
          <RestTimerBar
            seconds={props.restRemaining}
            onRestart={props.onRestartRest}
            onAddMinute={props.onAddRestMinute}
            onSkip={props.onSkipRest}
          />
        ) : null}
        <button
          type="button"
          onClick={props.onSave}
          disabled={!props.canSave}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-court-brand bg-transparent px-3 text-sm font-semibold text-court-brand-dark shadow-sm transition hover:bg-court-brand-tint focus:outline-none focus-visible:ring-2 focus-visible:ring-court-brand/50 disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Save className="h-4 w-4" />
          Save workout session
        </button>
      </div>
    </div>
  );
}

function ExercisePicker({
  dayLabel,
  exercises,
  value,
  customOpen,
  onChange,
  onAdd,
  onToggleCustom,
}: {
  dayLabel: string;
  exercises: FitnessExercise[];
  value: string;
  customOpen: boolean;
  onChange: (exerciseId: string) => void;
  onAdd: () => void;
  onToggleCustom: () => void;
}) {
  const hasExercises = exercises.length > 0;
  return (
    <div className="rounded-md border border-court-border bg-court-surface-subtle p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-court-fg-muted">
            Add Lift
          </p>
          <p className="truncate text-sm font-semibold text-court-fg">
            {dayLabel}
          </p>
        </div>
        <button
          type="button"
          onClick={onToggleCustom}
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-court-border bg-court-surface px-3 text-sm font-semibold text-court-fg transition hover:bg-court-surface-subtle"
          aria-label={customOpen ? "Close custom exercise" : "Add custom exercise"}
        >
          {customOpen ? (
            <X className="h-3.5 w-3.5" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          New
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={!hasExercises}
          className="h-10 min-w-0 rounded-md border border-court-border bg-court-surface px-3 text-base text-court-fg focus:outline-none focus:ring-2 focus:ring-court-brand/30 disabled:opacity-60 sm:text-sm"
        >
          <option value="">
            {hasExercises ? "Choose lift" : "All lifts added"}
          </option>
          {exercises.map((exercise) => (
            <option key={exercise.id} value={exercise.id}>
              {exercise.name}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onAdd}
          disabled={!value}
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </Button>
      </div>
    </div>
  );
}

function DayPickerRows({
  dayTypes,
  activeDayType,
  dayLabels,
  editingDay,
  onSelect,
  onLabelChange,
  onEditingDayChange,
}: {
  dayTypes: string[];
  activeDayType: string;
  dayLabels: Record<string, string>;
  editingDay: string | null;
  onSelect: (dayType: string) => void;
  onLabelChange: (dayType: string, label: string) => void;
  onEditingDayChange: (dayType: string | null) => void;
}) {
  return (
    <div className="space-y-2">
      {dayTypes.map((dayType, index) => {
        const active = dayType === activeDayType;
        const label = dayLabels[dayType] ?? dayType;
        const editing = editingDay === dayType;
        return (
          <div
            key={dayType}
            className={cn(
              "grid grid-cols-[2rem_minmax(0,1fr)_2rem] items-center gap-2 rounded-md border px-2 py-2 transition",
              active
                ? "border-court-brand bg-court-brand-tint text-court-brand-dark"
                : "border-court-border bg-court-surface text-court-fg hover:bg-court-surface-subtle",
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(dayType)}
              className="grid h-8 w-8 place-items-center rounded-md text-xs font-bold tabular-nums"
              aria-label={`Select ${label}`}
            >
              {index + 1}
            </button>
            {editing ? (
              <input
                value={label}
                autoFocus
                onChange={(e) => onLabelChange(dayType, e.target.value)}
                onBlur={() => onEditingDayChange(null)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "Escape") {
                    onEditingDayChange(null);
                  }
                }}
                className="h-8 min-w-0 rounded-md border border-court-border bg-court-surface px-2 text-base font-semibold text-court-fg focus:outline-none focus:ring-2 focus:ring-court-brand/30 sm:text-sm"
              />
            ) : (
              <button
                type="button"
                onClick={() => onSelect(dayType)}
                className="min-w-0 truncate text-left text-sm font-semibold"
              >
                {label}
              </button>
            )}
            <button
              type="button"
              onClick={() => onEditingDayChange(editing ? null : dayType)}
              className="grid h-8 w-8 place-items-center rounded-md text-court-fg-muted hover:bg-court-surface hover:text-court-brand-dark"
              aria-label={`Rename ${label}`}
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function WorkoutSessionBar({
  startedAt,
  elapsedSeconds,
  compact = false,
  onCancel,
}: {
  startedAt: string | null;
  elapsedSeconds: number;
  compact?: boolean;
  onCancel?: () => void;
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-court-brand bg-court-brand-tint text-court-brand-dark",
        compact ? "px-3 py-2" : "p-3",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-court-surface">
            <Clock className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em]">
              Active Workout
            </p>
            <p className="text-xl font-bold tabular-nums">
              {formatDuration(elapsedSeconds)}
            </p>
          </div>
        </div>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-court-brand/50 bg-court-surface/70 transition hover:bg-court-surface"
            aria-label="Discard active workout"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      {startedAt && !compact ? (
        <p className="mt-2 text-xs font-medium text-court-brand-dark/80">
          Started {shortTime(startedAt)}
        </p>
      ) : null}
    </div>
  );
}

function SavedWorkoutPreview({
  day,
  onEdit,
}: {
  day: FitnessWorkoutDay;
  onEdit: (day: FitnessWorkoutDay) => void;
}) {
  const duration = sessionDurationSeconds(day);
  return (
    <div className="rounded-md border border-court-border bg-court-surface-subtle p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-court-fg-muted">
            Latest Saved Workout
          </p>
          <p className="mt-1 truncate text-sm font-semibold text-court-fg">
            {day.dayType}
          </p>
        </div>
        <span className="shrink-0 rounded-md border border-court-border bg-court-surface px-2 py-1 text-xs font-bold tabular-nums text-court-fg">
          {duration == null ? "--" : formatDuration(duration)}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <SummaryMetric label="Sets" value={day.totalSets} />
        <SummaryMetric label="Volume" value={niceNumber(day.totalVolume)} />
        <SummaryMetric label="PRs" value={day.prCount} />
      </div>
      <button
        type="button"
        onClick={() => onEdit(day)}
        className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-court-border bg-court-surface px-3 text-sm font-semibold text-court-fg transition hover:bg-court-surface-subtle"
      >
        <Pencil className="h-3.5 w-3.5" />
        Edit workout
      </button>
    </div>
  );
}

function RestTimerBar({
  seconds,
  onRestart,
  onAddMinute,
  onSkip,
}: {
  seconds: number;
  onRestart: () => void;
  onAddMinute: () => void;
  onSkip: () => void;
}) {
  const mins = Math.floor(seconds / 60);
  const secs = String(seconds % 60).padStart(2, "0");
  return (
    <div className="flex items-center gap-2 rounded-md border border-court-brand bg-court-brand-tint px-3 py-2 text-court-brand-dark">
      <TimerReset className="h-4 w-4 shrink-0" />
      <span className="flex-1 text-sm font-bold tabular-nums">
        {mins}:{secs}
      </span>
      <button
        type="button"
        onClick={onRestart}
        className="grid h-8 w-8 place-items-center rounded-md border border-court-brand/50 bg-court-surface/70 hover:bg-court-surface"
        aria-label="Restart rest timer"
      >
        <RefreshCcw className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onAddMinute}
        className="inline-flex h-8 items-center justify-center rounded-md border border-court-brand/50 bg-court-surface/70 px-2 text-xs font-bold hover:bg-court-surface"
        aria-label="Add one minute to rest timer"
      >
        +1 min
      </button>
      <button
        type="button"
        onClick={onSkip}
        className="grid h-8 w-8 place-items-center rounded-md border border-court-brand/50 bg-court-surface/70 hover:bg-court-surface"
        aria-label="Skip rest timer"
      >
        <SkipForward className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function SaveSummaryCards({
  summaries,
  onDone,
}: {
  summaries: FitnessSavedExerciseSummary[];
  onDone: () => void;
}) {
  return (
    <div className="space-y-2 rounded-md border border-court-brand bg-court-brand-tint p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-bold text-court-brand-dark">Workout saved</p>
        <button
          type="button"
          onClick={onDone}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-court-brand bg-court-surface px-2 text-xs font-semibold text-court-brand-dark hover:bg-court-brand-tint"
        >
          <Check className="h-3.5 w-3.5" />
          Done
        </button>
      </div>
      {summaries.map((summary) => (
        <div
          key={summary.exerciseId}
          className="rounded-md border border-court-border bg-court-surface px-3 py-2"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 truncate text-sm font-semibold text-court-fg">
              {summary.exerciseName}
            </p>
            {summary.prCount > 0 ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-court-brand px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                <Trophy className="h-3 w-3" />
                PR
              </span>
            ) : null}
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
            <SummaryMetric
              label="Top"
              value={
                isCoreBodyPart(summary.bodyPart)
                  ? niceNumber(summary.topScore)
                  : `${niceNumber(summary.topWeightLbs)} lb`
              }
            />
            <SummaryMetric label="Sets" value={summary.setCount} />
            <SummaryMetric label="Volume" value={niceNumber(summary.volume)} />
          </div>
          <p className="mt-2 text-xs font-medium text-court-fg-muted">
            Top {formatPct(summary.topWeightChangePct)} · Volume{" "}
            {formatPct(summary.volumeChangePct)}
          </p>
        </div>
      ))}
    </div>
  );
}

function SummaryMetric({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-md bg-court-surface-subtle px-2 py-1">
      <p className="text-[10px] font-semibold uppercase text-court-fg-muted">
        {label}
      </p>
      <p className="font-bold tabular-nums text-court-fg">{value}</p>
    </div>
  );
}

function formatPct(value: number | null): string {
  if (value == null) return "first";
  return `${value >= 0 ? "+" : ""}${value}%`;
}

function ExerciseCard({
  exercise,
  draft,
  onSetChange,
  onBump,
  onAddSet,
  onDuplicateLastSet,
  onRemoveSet,
  onRepeat,
  onRemove,
}: {
  exercise: FitnessExercise;
  draft: DraftWorkout;
  onSetChange: (
    exercise: FitnessExercise,
    setIndex: number,
    field: "weight" | "reps" | "rpe",
    value: string,
  ) => void;
  onBump: (
    exercise: FitnessExercise,
    setIndex: number,
    field: "weight" | "reps",
    amount: number,
  ) => void;
  onAddSet: (exercise: FitnessExercise) => void;
  onDuplicateLastSet: (exercise: FitnessExercise) => void;
  onRemoveSet: (exercise: FitnessExercise, setIndex: number) => void;
  onRepeat: (exercise: FitnessExercise) => void;
  onRemove: (exerciseId: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const coreExercise = isCoreBodyPart(exercise.bodyPart);
  const bestScore = recordScore(
    exercise.best?.weightLbs,
    exercise.best?.reps,
    exercise.bodyPart,
  );
  const bestLabel = !exercise.best
    ? "No best"
    : coreExercise
      ? exercise.best.weightLbs == null
        ? `${niceNumber(exercise.best.reps)} rep best`
        : `${niceNumber(bestScore)} volume best`
      : `${niceNumber(exercise.best.weightLbs)} lb best`;
  const lastLabel = exercise.last
    ? `${formatSetList(exercise.last.sets, exercise.bodyPart)} · ${shortDate(
        exercise.last.date,
      )}`
    : "No previous session";

  return (
    <div className="rounded-md border border-court-border bg-court-surface">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-start justify-between gap-3 px-3 py-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            {expanded ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-court-fg-muted" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-court-fg-muted" />
            )}
            <h3 className="truncate text-sm font-semibold text-court-fg">
              {exercise.name}
            </h3>
            {exercise.isCustom ? (
              <span className="rounded-md bg-court-surface-subtle px-1.5 py-0.5 text-[10px] font-semibold uppercase text-court-fg-muted">
                Custom
              </span>
            ) : null}
          </div>
          <p className="mt-1 truncate pl-6 text-xs text-court-fg-muted">
            {lastLabel}
          </p>
        </div>
        <span className="shrink-0 rounded-md border border-court-border bg-court-surface-subtle px-2 py-1 text-[11px] font-bold text-court-fg">
          {bestLabel}
        </span>
      </button>

      {expanded ? (
        <div className="border-t border-court-border px-3 pb-3 pt-3">
          <div className="mb-3 flex items-center justify-between gap-3 rounded-md bg-court-surface-subtle px-2 py-2">
            <p className="min-w-0 truncate text-xs font-medium text-court-fg-muted">
              Last time - {lastLabel}
            </p>
            <button
              type="button"
              onClick={() => onRepeat(exercise)}
              disabled={!exercise.last}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-court-border text-court-fg-muted transition hover:bg-court-surface disabled:opacity-40"
              aria-label={`Repeat ${exercise.name}`}
            >
              <RefreshCcw className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="space-y-3">
            {draft.sets.map((set, index) => {
              const bodyweight = isBodyweightValue(set.weight);
              const weight = bodyweight ? null : parseDraftNumber(set.weight);
              const reps = parseDraftNumber(set.reps);
              const draftScore = recordScore(weight, reps, exercise.bodyPart);
              const draftPr =
                draftScore != null &&
                bestScore != null &&
                draftScore > bestScore;
              const volume = niceNumber(
                setVolume(weight, reps, exercise.bodyPart),
              );
              return (
                <div
                  key={index}
                  className="rounded-md border border-court-border bg-court-surface-subtle p-2"
                >
                  <div className="grid grid-cols-[1.5rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2">
                    <span className="text-center text-xs font-bold text-court-fg-muted">
                      {index + 1}
                    </span>
                    <div className="space-y-1">
                      <StepperInput
                        label="lb"
                        value={set.weight}
                        step={5}
                        onChange={(value) =>
                          onSetChange(exercise, index, "weight", value)
                        }
                        onStep={(amount) =>
                          onBump(exercise, index, "weight", amount)
                        }
                      />
                      {coreExercise ? (
                        <button
                          type="button"
                          onClick={() =>
                            onSetChange(
                              exercise,
                              index,
                              "weight",
                              bodyweight ? "" : BODYWEIGHT_VALUE,
                            )
                          }
                          className={cn(
                            "h-7 w-full rounded-md border text-[11px] font-bold transition",
                            bodyweight
                              ? "border-court-brand bg-court-brand-tint text-court-brand-dark"
                              : "border-court-border bg-court-surface text-court-fg-muted hover:bg-court-surface-subtle",
                          )}
                        >
                          BW
                        </button>
                      ) : null}
                    </div>
                    <StepperInput
                      label="reps"
                      value={set.reps}
                      step={1}
                      onChange={(value) =>
                        onSetChange(exercise, index, "reps", value)
                      }
                      onStep={(amount) =>
                        onBump(exercise, index, "reps", amount)
                      }
                    />
                  </div>
                  <div className="mt-2 grid grid-cols-[1.5rem_minmax(0,6rem)_auto_2rem] items-center gap-2">
                    <span />
                    <input
                      inputMode="decimal"
                      value={set.rpe}
                      onChange={(e) =>
                        onSetChange(exercise, index, "rpe", e.target.value)
                      }
                      placeholder="RPE"
                      className="h-8 min-w-0 rounded-md border border-court-border bg-court-surface px-2 text-center text-base font-semibold tabular-nums text-court-fg placeholder:text-court-fg-muted focus:outline-none focus:ring-2 focus:ring-court-brand/30 sm:text-xs"
                    />
                    <span
                      className={cn(
                        "inline-flex h-8 min-w-12 items-center justify-center rounded-md border px-2 text-[11px] font-semibold",
                        set.isPr || draftPr
                          ? "border-court-brand bg-court-brand-tint text-court-brand-dark"
                          : "border-court-border bg-court-surface text-court-fg-muted",
                      )}
                    >
                      {set.isPr || draftPr ? "PR" : volume}
                    </span>
                    <button
                      type="button"
                      onClick={() => onRemoveSet(exercise, index)}
                      className="grid h-8 w-8 place-items-center rounded-md border border-court-border bg-court-surface text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
                      aria-label={`Remove set ${index + 1}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => onAddSet(exercise)}
              className="flex-1"
            >
              <Plus className="h-3.5 w-3.5" />
              Blank
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => onDuplicateLastSet(exercise)}
              className="flex-1"
            >
              <Copy className="h-3.5 w-3.5" />
              Duplicate
            </Button>
            <button
              type="button"
              onClick={() => onRemove(exercise.id)}
              className="grid h-9 w-9 place-items-center rounded-md border border-court-border text-court-fg-muted transition hover:bg-court-surface-subtle"
              aria-label={`Remove ${exercise.name}`}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatSetList(
  sets: Array<{ weightLbs: number | null; reps: number | null }>,
  bodyPart?: string | null,
): string {
  if (sets.length === 0) return "No sets";
  return sets
    .map((set) =>
      set.weightLbs == null && isCoreBodyPart(bodyPart)
        ? `${BODYWEIGHT_VALUE} x ${niceNumber(set.reps)}`
        : `${niceNumber(set.weightLbs)} x ${niceNumber(set.reps)}`,
    )
    .join(", ");
}

function StepperInput({
  label,
  value,
  step,
  onChange,
  onStep,
}: {
  label: string;
  value: string;
  step: number;
  onChange: (value: string) => void;
  onStep: (amount: number) => void;
}) {
  return (
    <div className="grid min-w-0 grid-cols-[2rem_minmax(0,1fr)_2rem] overflow-hidden rounded-md border border-court-border bg-court-surface">
      <button
        type="button"
        onClick={() => onStep(-step)}
        className="grid h-9 place-items-center border-r border-court-border text-court-brand-dark hover:bg-court-brand-tint"
        aria-label={`Subtract ${label}`}
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={label}
        className="h-9 min-w-0 bg-transparent px-1 text-center text-base font-semibold tabular-nums text-court-fg placeholder:text-court-fg-muted focus:outline-none sm:text-sm"
      />
      <button
        type="button"
        onClick={() => onStep(step)}
        className="grid h-9 place-items-center border-l border-court-border text-court-brand-dark hover:bg-court-brand-tint"
        aria-label={`Add ${label}`}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function HistoryTab({
  snapshot,
  range,
  bodyPart,
  days,
  stats,
  stepsExpanded,
  focusDate,
  healthSetup,
  healthConnecting,
  onRangeChange,
  onBodyPartChange,
  onCreateAppleHealthConnection,
  onSaveStepsDay,
  onToggleStepsExpanded,
}: {
  snapshot: FitnessSnapshot;
  range: FitnessRange;
  bodyPart: string;
  days: FitnessWorkoutDay[];
  stats: ReturnType<typeof buildHistoryStats>;
  stepsExpanded: boolean;
  focusDate: string;
  healthSetup: FitnessHealthConnectionSetup | null;
  healthConnecting: boolean;
  onRangeChange: (range: FitnessRange) => void;
  onBodyPartChange: (bodyPart: string) => void;
  onCreateAppleHealthConnection: () => void;
  onSaveStepsDay: (date: string, steps: number) => Promise<void>;
  onToggleStepsExpanded: () => void;
}) {
  const [expandedDayId, setExpandedDayId] = useState<string | null>(null);
  const coreView = isCoreBodyPart(bodyPart);
  const volumeLabel = coreView
    ? niceNumber(stats.volume)
    : `${niceNumber(stats.volume)} lb`;

  return (
    <div className="space-y-4">
      <StepsHeader
        steps={snapshot.steps}
        expanded={stepsExpanded}
        focusDate={focusDate}
        healthSetup={healthSetup}
        healthConnecting={healthConnecting}
        onToggleExpanded={onToggleStepsExpanded}
        onCreateAppleHealthConnection={onCreateAppleHealthConnection}
        onSaveStepsDay={onSaveStepsDay}
      />
      <TabStrip
        items={RANGE_TABS}
        activeId={range}
        onChange={onRangeChange}
        ariaLabel="History range"
      />
      <TabStrip
        items={snapshot.bodyParts.map((part) => ({ id: part, label: part }))}
        activeId={bodyPart}
        onChange={onBodyPartChange}
        ariaLabel="Body part filter"
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi label="Top set" value={stats.topSetLabel} />
        <Kpi label="PRs" value={stats.pr} />
        <Kpi label="Volume" value={volumeLabel} />
        <Kpi label="Streak" value={`${stats.streak} day`} />
      </div>

      <TrendChart
        title="Lift Progression"
        series={[{ label: "Top", points: stats.topWeightTrend, tone: "brand" }]}
      />

      <div className="space-y-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-court-fg-muted">
          Lift Metrics
        </p>
        {stats.exerciseBreakdown.length > 0 ? (
          stats.exerciseBreakdown.map((row) => (
            <div
              key={row.name}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-court-border px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate font-semibold text-court-fg">
                  {row.name}
                </p>
                <p className="truncate text-xs text-court-fg-muted">
                  {row.sessions} sessions · {niceNumber(row.volume)}{" "}
                  {coreView ? "volume" : "lb volume"}
                </p>
              </div>
              <div className="text-right">
                <p className="font-semibold tabular-nums text-court-fg">
                  {coreView
                    ? niceNumber(row.topScore)
                    : `${niceNumber(row.topWeightLbs)} lb`}
                </p>
                <p className="text-xs font-medium tabular-nums text-court-fg-muted">
                  {formatPct(row.topWeightChangePct)}
                </p>
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-md border border-court-border p-4 text-sm text-court-fg-muted">
            No workouts in this view.
          </div>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-court-fg-muted">
          Workout History
        </p>
        {days.slice(0, 20).map((day) => (
          <HistoryWorkoutCard
            key={day.id}
            day={day}
            expanded={expandedDayId === day.id}
            onToggle={() =>
              setExpandedDayId((current) =>
                current === day.id ? null : day.id,
              )
            }
          />
        ))}
      </div>
    </div>
  );
}

function HistoryWorkoutCard({
  day,
  expanded,
  onToggle,
}: {
  day: FitnessWorkoutDay;
  expanded: boolean;
  onToggle: () => void;
}) {
  const duration = sessionDurationSeconds(day);
  return (
    <div className="rounded-md border border-court-border bg-court-surface">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start justify-between gap-3 px-3 py-3 text-left"
      >
        <div className="flex min-w-0 items-start gap-2">
          {expanded ? (
            <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-court-fg-muted" />
          ) : (
            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-court-fg-muted" />
          )}
          <div className="min-w-0">
            <p className="font-semibold text-court-fg">
              {shortDate(day.date)} · {day.dayType}
            </p>
            <p className="mt-1 truncate text-xs text-court-fg-muted">
              {day.workouts.length} lifts · {day.totalSets} sets ·{" "}
              {niceNumber(day.totalVolume)} lb
            </p>
          </div>
        </div>
        <div className="shrink-0 text-right text-xs text-court-fg-muted">
          <p className="font-bold tabular-nums text-court-fg">
            {duration == null ? "--" : formatDuration(duration)}
          </p>
          {day.prCount > 0 ? (
            <p className="mt-1 font-semibold text-court-brand-dark">
              {day.prCount} PR
            </p>
          ) : null}
        </div>
      </button>

      {expanded ? (
        <div className="space-y-2 border-t border-court-border px-3 py-3">
          {day.startedAt ? (
            <div className="grid grid-cols-2 gap-2 text-xs">
              <SummaryMetric label="Started" value={shortTime(day.startedAt)} />
              <SummaryMetric
                label="Ended"
                value={day.endedAt ? shortTime(day.endedAt) : "--"}
              />
            </div>
          ) : null}
          {day.workouts.map((workout) => {
            const topWeight = workout.sets.reduce<number | null>((top, set) => {
              if (set.weightLbs == null) return top;
              return top == null || set.weightLbs > top ? set.weightLbs : top;
            }, null);
            const coreWorkout = isCoreBodyPart(workout.bodyPart);
            return (
              <div
                key={workout.id}
                className="rounded-md border border-court-border bg-court-surface-subtle px-3 py-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-court-fg">
                      {workout.exerciseName}
                    </p>
                    <p className="mt-1 text-xs text-court-fg-muted">
                      {workout.sets.length} sets ·{" "}
                      {niceNumber(workout.totalVolume)}{" "}
                      {coreWorkout ? "volume" : "lb volume"}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-bold text-court-fg">
                    {topWeight == null
                      ? coreWorkout
                        ? "Bodyweight"
                        : "No weight"
                      : `${niceNumber(topWeight)} lb`}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {workout.sets.map((set) => (
                    <span
                      key={set.id ?? set.setNumber}
                      className={cn(
                        "rounded-md border px-2 py-1 text-[11px] font-semibold tabular-nums",
                        set.isPr
                          ? "border-court-brand bg-court-brand-tint text-court-brand-dark"
                          : "border-court-border bg-court-surface text-court-fg-muted",
                      )}
                    >
                      {set.weightLbs == null && coreWorkout
                        ? BODYWEIGHT_VALUE
                        : niceNumber(set.weightLbs)}{" "}
                      x {niceNumber(set.reps)}
                      {set.isPr ? " PR" : ""}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-court-border bg-court-surface-subtle px-3 py-2">
      <p className="text-[11px] font-semibold uppercase text-court-fg-muted">
        {label}
      </p>
      <p className="mt-1 text-lg font-bold tabular-nums text-court-fg">
        {value}
      </p>
    </div>
  );
}

function buildHistoryStats(days: FitnessWorkoutDay[], bodyPart: string) {
  const coreView = isCoreBodyPart(bodyPart);
  const exerciseMap = new Map<
    string,
    {
      name: string;
      sessions: number;
      volume: number;
      topWeightLbs: number | null;
      topScore: number | null;
      firstTopWeightLbs: number | null;
      lastTopWeightLbs: number | null;
    }
  >();
  const topWeightTrend: Array<{ date: string; value: number }> = [];
  let volume = 0;
  let pr = 0;
  let topSetWeight: number | null = null;
  let topSetReps: number | null = null;
  let topSetScore: number | null = null;
  const dateSet = new Set<string>();

  for (const day of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    dateSet.add(day.date);
    let top = 0;
    for (const workout of day.workouts) {
      if (bodyPart !== "All" && workout.bodyPart !== bodyPart) continue;
      pr += workout.sets.filter((set) => set.isPr).length;
      volume += workout.totalVolume;
      const row = exerciseMap.get(workout.exerciseName) ?? {
        name: workout.exerciseName,
        sessions: 0,
        volume: 0,
        topWeightLbs: null,
        topScore: null,
        firstTopWeightLbs: null,
        lastTopWeightLbs: null,
      };
      row.sessions += 1;
      row.volume += workout.totalVolume;
      let workoutTop: number | null = null;
      for (const set of workout.sets) {
        const score = coreView
          ? recordScore(set.weightLbs, set.reps, workout.bodyPart)
          : set.weightLbs == null
            ? null
            : set.weightLbs;
        if (score == null) continue;
        top = Math.max(top, score);
        row.topScore =
          row.topScore == null || score > row.topScore ? score : row.topScore;
        if (set.weightLbs != null) {
          workoutTop =
            workoutTop == null || set.weightLbs > workoutTop
              ? set.weightLbs
              : workoutTop;
        }
        if (
          topSetScore == null ||
          score > topSetScore ||
          (score === topSetScore &&
            (set.reps ?? 0) > (topSetReps ?? 0))
        ) {
          topSetScore = score;
          topSetWeight = set.weightLbs;
          topSetReps = set.reps;
        }
      }
      if (workoutTop != null) {
        row.firstTopWeightLbs ??= workoutTop;
        row.lastTopWeightLbs = workoutTop;
        row.topWeightLbs =
          row.topWeightLbs == null || workoutTop > row.topWeightLbs
            ? workoutTop
            : row.topWeightLbs;
      }
      exerciseMap.set(workout.exerciseName, row);
    }
    if (top > 0) topWeightTrend.push({ date: day.date, value: top });
  }

  return {
    topSetLabel:
      topSetScore == null
        ? "No sets"
        : coreView
          ? topSetWeight == null
            ? `${BODYWEIGHT_VALUE} x ${niceNumber(topSetReps)}`
            : `${niceNumber(topSetScore)} volume`
          : `${niceNumber(topSetWeight)} x ${niceNumber(topSetReps)}`,
    volume,
    pr,
    streak: calculateStreak(dateSet),
    topWeightTrend,
    exerciseBreakdown: Array.from(exerciseMap.values())
      .map((row) => ({
        ...row,
        topWeightChangePct:
          row.lastTopWeightLbs == null ||
          row.firstTopWeightLbs == null ||
          row.firstTopWeightLbs <= 0
            ? null
            : Math.round(
                ((row.lastTopWeightLbs - row.firstTopWeightLbs) /
                  row.firstTopWeightLbs) *
                  1000,
              ) / 10,
      }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 8),
  };
}

function calculateStreak(dates: Set<string>): number {
  const sorted = Array.from(dates).sort((a, b) => b.localeCompare(a));
  if (sorted.length === 0) return 0;
  let streak = 0;
  const cursor = new Date(`${sorted[0]}T12:00:00`);
  for (;;) {
    const iso = cursor.toISOString().slice(0, 10);
    if (!dates.has(iso)) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function TrendChart({
  title,
  series,
}: {
  title: string;
  series: Array<{
    label: string;
    points: Array<{ date: string; value: number }>;
    tone: "brand" | "muted";
  }>;
}) {
  const allPoints = series.flatMap((s) => s.points);
  const max = Math.max(1, ...allPoints.map((point) => point.value));
  const min = Math.min(0, ...allPoints.map((point) => point.value));
  const width = 320;
  const height = 120;
  const pad = 14;

  function pathFor(points: Array<{ date: string; value: number }>): string {
    if (points.length === 0) return "";
    return points
      .map((point, index) => {
        const x =
          pad +
          (points.length === 1
            ? (width - pad * 2) / 2
            : (index / (points.length - 1)) * (width - pad * 2));
        const y =
          height -
          pad -
          ((point.value - min) / Math.max(1, max - min)) * (height - pad * 2);
        return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");
  }

  return (
    <div className="rounded-md border border-court-border bg-court-surface p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="truncate text-sm font-semibold text-court-fg">{title}</p>
        <div className="flex shrink-0 items-center gap-2 text-[11px] text-court-fg-muted">
          {series.map((s) => (
            <span key={s.label} className="inline-flex items-center gap-1">
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  s.tone === "brand" ? "bg-court-brand" : "bg-court-fg-muted",
                )}
              />
              {s.label}
            </span>
          ))}
        </div>
      </div>
      {allPoints.length === 0 ? (
        <div className="mt-3 grid h-28 place-items-center text-sm text-court-fg-muted">
          No trend yet.
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="mt-3 h-32 w-full overflow-visible"
          role="img"
          aria-label={title}
        >
          <line
            x1={pad}
            x2={width - pad}
            y1={height - pad}
            y2={height - pad}
            className="stroke-court-border"
            strokeWidth="1"
          />
          {series.map((s) => (
            <path
              key={s.label}
              d={pathFor(s.points)}
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={
                s.tone === "brand" ? "text-court-brand" : "text-court-fg-muted"
              }
            />
          ))}
        </svg>
      )}
    </div>
  );
}
