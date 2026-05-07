// Pure constants + helpers shared between server code (`@/lib/job-boards`)
// and client components (`promote-tab.tsx`). Lives in its own module so
// the client bundle never reaches @/lib/prisma — importing the server
// module from a client component would pull PrismaClient into the
// browser and trip "PrismaClient is unable to run in this browser
// environment". Anything in this file must stay free of `prisma`,
// `next/server`, server actions, and any other server-only dependency.

// JobBoardStatusValue is a TypeScript-erased Prisma enum. We mirror
// the union here as a string literal so client code can use it without
// importing from `@prisma/client` (type-only imports are safe, but
// duplicating the enum keeps the dependency direction one-way: client
// → shared, never client → @prisma/client).
export type JobBoardStatusValueShared =
  | "NOT_CONFIGURED"
  | "READY"
  | "POSTED"
  | "SKIPPED";

export type MajorBoardName =
  | "LinkedIn"
  | "Indeed"
  | "ZipRecruiter"
  | "Glassdoor"
  | "SimplyHired"
  | "Monster";

export type MajorBoardDef = {
  name: MajorBoardName;
  // True when posting to this board requires the recruiter to set up
  // an account / billing relationship first. Surfaces as the "Account
  // Needed" indicator on the row.
  accountNeeded: boolean;
  // Linked from the row when a recruiter doesn't have an external URL
  // saved yet — points at the board's job-poster home.
  posterHomeUrl: string;
};

export const MAJOR_BOARDS: MajorBoardDef[] = [
  { name: "LinkedIn", accountNeeded: true, posterHomeUrl: "https://www.linkedin.com/talent/post-a-job" },
  { name: "Indeed", accountNeeded: true, posterHomeUrl: "https://employers.indeed.com/p/post-a-job" },
  { name: "ZipRecruiter", accountNeeded: true, posterHomeUrl: "https://www.ziprecruiter.com/employer" },
  { name: "Glassdoor", accountNeeded: true, posterHomeUrl: "https://employers.glassdoor.com/post-a-job/" },
  { name: "SimplyHired", accountNeeded: false, posterHomeUrl: "https://www.simplyhired.com/employer" },
  { name: "Monster", accountNeeded: true, posterHomeUrl: "https://hiring.monster.com/" },
];

export const MAJOR_BOARD_NAMES: readonly MajorBoardName[] = MAJOR_BOARDS.map((b) => b.name);

// Status cycle for the chip click. Ordered so the recruiter taps from
// "haven't touched it yet" through to a terminal state and wraps.
export const STATUS_ORDER: JobBoardStatusValueShared[] = [
  "NOT_CONFIGURED",
  "READY",
  "POSTED",
  "SKIPPED",
];

export function nextStatusValue(
  current: JobBoardStatusValueShared,
): JobBoardStatusValueShared {
  const idx = STATUS_ORDER.indexOf(current);
  return STATUS_ORDER[(idx + 1) % STATUS_ORDER.length];
}
