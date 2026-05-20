"use client";

// User-tunable in-app toast behavior: how long toasts stay before they
// auto-dismiss, and which way the stack grows. Both are stored in
// localStorage. Duration is read fresh at toast render time, so a new
// choice applies to the next toast with no reload. Stack direction is a
// Toaster prop, so the Toaster re-reads it on TOAST_PREFS_CHANGED_EVENT
// to take effect live. Also exposes a tiny active-toast counter so the
// Dismiss All control can appear only when two or more notification
// toasts are on screen at once.

export type ToastDurationId = "5s" | "10s" | "30s" | "infinite";
export type ToastStackDir = "standard" | "up";

export const TOAST_DURATION_KEY = "ace_toast_duration";
export const TOAST_STACK_DIR_KEY = "ace_toast_stack_dir";

export const DEFAULT_TOAST_DURATION: ToastDurationId = "5s";
export const DEFAULT_TOAST_STACK_DIR: ToastStackDir = "standard";

// Broadcast when either pref changes so the Toaster (stack direction)
// updates without a reload.
export const TOAST_PREFS_CHANGED_EVENT = "ace:toast-prefs-changed";

export const TOAST_DURATION_OPTIONS: {
  id: ToastDurationId;
  label: string;
  ms: number;
}[] = [
  { id: "5s", label: "5 seconds", ms: 5_000 },
  { id: "10s", label: "10 seconds", ms: 10_000 },
  { id: "30s", label: "30 seconds", ms: 30_000 },
  { id: "infinite", label: "Until dismissed", ms: Number.POSITIVE_INFINITY },
];

export const TOAST_STACK_DIR_OPTIONS: { id: ToastStackDir; label: string }[] = [
  { id: "standard", label: "Standard" },
  { id: "up", label: "Stack up" },
];

export function getStoredToastDurationId(): ToastDurationId {
  if (typeof window === "undefined") return DEFAULT_TOAST_DURATION;
  const raw = window.localStorage.getItem(TOAST_DURATION_KEY);
  if (raw && TOAST_DURATION_OPTIONS.some((o) => o.id === raw)) {
    return raw as ToastDurationId;
  }
  return DEFAULT_TOAST_DURATION;
}

// Milliseconds for sonner's `duration`. Infinity keeps the toast up
// until the user dismisses it by hand.
export function getStoredToastDurationMs(): number {
  const id = getStoredToastDurationId();
  return (
    TOAST_DURATION_OPTIONS.find((o) => o.id === id)?.ms ??
    Number.POSITIVE_INFINITY
  );
}

export function setStoredToastDurationId(id: ToastDurationId): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOAST_DURATION_KEY, id);
  window.dispatchEvent(new CustomEvent(TOAST_PREFS_CHANGED_EVENT));
}

export function getStoredToastStackDir(): ToastStackDir {
  if (typeof window === "undefined") return DEFAULT_TOAST_STACK_DIR;
  const raw = window.localStorage.getItem(TOAST_STACK_DIR_KEY);
  if (raw === "standard" || raw === "up") return raw;
  return DEFAULT_TOAST_STACK_DIR;
}

export function setStoredToastStackDir(dir: ToastStackDir): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOAST_STACK_DIR_KEY, dir);
  window.dispatchEvent(new CustomEvent(TOAST_PREFS_CHANGED_EVENT));
}

// --- Active toast counter (for the Dismiss All control) -------------
// Each of the three in-app notification toasts (SMS, email, reminder)
// registers on mount and releases on unmount; ToastStackControls
// subscribes and shows Dismiss All only when two or more are visible.
let activeCount = 0;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function registerToast(): () => void {
  activeCount += 1;
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeCount = Math.max(0, activeCount - 1);
    emit();
  };
}

export function getActiveToastCount(): number {
  return activeCount;
}

export function subscribeActiveToastCount(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
