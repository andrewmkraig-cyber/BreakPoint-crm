// Shared input styling tokens. Mirrors the CLAUDE_PILL_CLASS pattern in
// button.tsx: a single exported className string so every "iOS-style"
// text field across the app reads identically and a restyle happens in
// one place. Pairs with the `.ace-input-pill` utility in globals.css,
// which carries the spring transition + focus glow that can't be
// expressed in Tailwind utilities alone.
//
// Usage:
//   import { INPUT_PILL_CLASS } from "@/components/ui/input";
//   <input className={INPUT_PILL_CLASS} />
//   <input className={`${INPUT_PILL_CLASS} w-full`} />  // append layout
export const INPUT_PILL_CLASS =
  "ace-input-pill rounded-full bg-court-surface-subtle border border-court-border/40 px-4 py-2 text-court-fg placeholder:text-court-fg-muted focus:border-transparent focus:ring-0 focus:outline-none";
