// Who may set a goal for whom.
//
// Server-side only. Nothing here touches UI, and nothing here participates
// in AUTH: `UserRole` still decides what the app lets a user do at all.
// These helpers answer one narrower question - given two people in the same
// org, may the first one set (or approve) a goal for the second.
//
// The org chart lives in two nullable columns on User, added alongside the
// Goal model and read ONLY from this file:
//   - goalLevel: seniority rank, LOWER is MORE senior, 0 is the owner.
//     Null means "most junior" (see `rankOf`), so an unseeded user is never
//     accidentally granted authority over anyone.
//   - managerId: self-relation, walked transitively so a manager reaches
//     their whole subtree, not just direct reports.
//
// TENANT RULE (architecture rule 8). Every exported function takes an
// explicit `organizationId` and cross-checks it against the org stamped on
// each person it was handed. That id must come from the server session
// (`getCurrentOrg`), never from a client payload. A mismatch is a bug or an
// attack, so it throws rather than returning false - a silent `false` would
// look like an ordinary permission denial and hide the real problem.
import { GoalScope, GoalStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";

// One person as the goals code needs them. `organizationId` is stamped by
// `loadGoalDirectory` from the caller's server-resolved org; it is not a
// column on User (tenancy lives in OrganizationMembership).
export type GoalActor = {
  readonly id: string;
  readonly organizationId: string;
  readonly goalLevel: number | null;
  readonly managerId: string | null;
};

// Every member of one org, keyed by user id. Needed because the manager
// walk is transitive: deciding whether B is under A means following B's
// managerId chain upward, which requires the other rows.
export type GoalDirectory = {
  readonly organizationId: string;
  readonly members: ReadonlyMap<string, GoalActor>;
};

export class GoalTenantMismatchError extends Error {
  constructor(expected: string, got: string) {
    super(`Goal permission check crossed tenants: expected org ${expected}, got ${got}`);
    this.name = "GoalTenantMismatchError";
  }
}

export class GoalPermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoalPermissionError";
  }
}

// A null goalLevel is the most junior rank possible. Using MAX_SAFE_INTEGER
// rather than a sentinel keeps the comparisons plain numeric ones.
const MOST_JUNIOR = Number.MAX_SAFE_INTEGER;

// Depth cap on the manager walk. Also guarded by a visited set - a cycle
// (A manages B manages A) is bad data, not a reason to hang a request.
const MAX_MANAGER_DEPTH = 32;

export function rankOf(person: Pick<GoalActor, "goalLevel">): number {
  return person.goalLevel ?? MOST_JUNIOR;
}

function assertOrg(organizationId: string, ...people: Array<Pick<GoalActor, "organizationId">>): void {
  if (!organizationId) {
    throw new GoalTenantMismatchError("<a server-resolved org id>", "<empty>");
  }
  for (const person of people) {
    if (person.organizationId !== organizationId) {
      throw new GoalTenantMismatchError(organizationId, person.organizationId);
    }
  }
}

// True when `target` sits anywhere beneath `actor` in the managerId chain -
// direct report, report's report, and so on.
function reportsTo(target: GoalActor, actor: GoalActor, directory: GoalDirectory): boolean {
  const seen = new Set<string>([target.id]);
  let cursor = target.managerId;
  for (let depth = 0; cursor && depth < MAX_MANAGER_DEPTH; depth += 1) {
    if (cursor === actor.id) return true;
    if (seen.has(cursor)) return false; // cycle in the data
    seen.add(cursor);
    const next = directory.members.get(cursor);
    if (!next) return false; // manager outside this org's directory
    cursor = next.managerId;
  }
  return false;
}

// May `actor` set a goal for `target`?
//
// Yes when any of these hold:
//   1. It is their own goal.
//   2. The actor is the owner (goalLevel 0), who has authority over the
//      whole org whether or not managerId is seeded.
//   3. They are at the same rank as each other.
//   4. The target is somewhere in the actor's reporting subtree.
//
// NOTE ON "SAME LEVEL OR BELOW". Being merely lower-ranked is deliberately
// NOT sufficient on its own. A manager reaches people below them through
// case 4 (their own subtree); a peer's report - lower-ranked, but in
// someone else's branch - is NOT theirs to set numbers for, which is the
// behaviour the spec's own test list calls for. Widening case 3 from
// `===` to `>=` is the one-character change that adopts the looser
// "anyone at or below my rank, anywhere in the company" reading.
export function canSetGoalFor(
  organizationId: string,
  actor: GoalActor,
  target: GoalActor,
  directory: GoalDirectory,
): boolean {
  assertOrg(organizationId, actor, target);
  if (directory.organizationId !== organizationId) {
    throw new GoalTenantMismatchError(organizationId, directory.organizationId);
  }

  if (target.id === actor.id) return true;
  if (canApproveCompanyGoal(organizationId, actor)) return true;
  if (rankOf(target) === rankOf(actor)) return true;
  return reportsTo(target, actor, directory);
}

// May `actor` ask for a company-wide goal? Leadership only (rank 0 or 1).
// A null goalLevel is most junior, so unseeded users cannot.
export function canRequestCompanyGoal(organizationId: string, actor: GoalActor): boolean {
  assertOrg(organizationId, actor);
  const rank = rankOf(actor);
  return rank === 0 || rank === 1;
}

// May `actor` approve a company-wide goal? The owner only.
export function canApproveCompanyGoal(organizationId: string, actor: GoalActor): boolean {
  assertOrg(organizationId, actor);
  return rankOf(actor) === 0;
}

// The status a brand new goal should be created with.
//
// COMPANY scope: ACTIVE when the actor can approve their own request,
// PENDING_APPROVAL when they may only request one.
// USER scope: ACTIVE, because a goal the actor is allowed to set needs
// nobody else's sign-off.
//
// Throws GoalPermissionError when the actor may not create the goal at all.
// Deliberately NOT a downgraded status: a forbidden create must fail, and
// returning PENDING_APPROVAL here would quietly turn "you may not do this"
// into "someone will approve this later".
export function resolveGoalStatusOnCreate(input: {
  organizationId: string;
  actor: GoalActor;
  scope: GoalScope;
  // Required when scope is USER - the person the goal is for.
  target?: GoalActor | null;
  // Required when scope is USER, for the transitive manager walk.
  directory?: GoalDirectory | null;
}): GoalStatus {
  const { organizationId, actor, scope, target, directory } = input;
  assertOrg(organizationId, actor);

  if (scope === GoalScope.COMPANY) {
    if (canApproveCompanyGoal(organizationId, actor)) return GoalStatus.ACTIVE;
    if (canRequestCompanyGoal(organizationId, actor)) return GoalStatus.PENDING_APPROVAL;
    throw new GoalPermissionError("This user cannot request a company goal.");
  }

  if (!target || !directory) {
    throw new GoalPermissionError("A user-scoped goal needs a target user and the org directory.");
  }
  if (!canSetGoalFor(organizationId, actor, target, directory)) {
    throw new GoalPermissionError("This user cannot set goals for that person.");
  }
  return GoalStatus.ACTIVE;
}

// Loads every member of one org as a GoalDirectory.
//
// `organizationId` must already be server-resolved (getCurrentOrg). The
// membership join is what scopes this to the tenant, and it is also what
// stamps organizationId onto each GoalActor so the checks above can
// cross-verify it.
export async function loadGoalDirectory(organizationId: string): Promise<GoalDirectory> {
  const memberships = await prisma.organizationMembership.findMany({
    where: { organizationId },
    select: { user: { select: { id: true, goalLevel: true, managerId: true } } },
  });

  const members = new Map<string, GoalActor>();
  for (const { user } of memberships) {
    members.set(user.id, {
      id: user.id,
      organizationId,
      goalLevel: user.goalLevel,
      managerId: user.managerId,
    });
  }
  return { organizationId, members };
}

// Convenience wrapper: the directory plus one member pulled out of it.
// Returns null when the user is not a member of that org - callers must
// treat that as "no authority", never as "look them up some other way".
export async function loadGoalActor(
  organizationId: string,
  userId: string,
): Promise<{ actor: GoalActor; directory: GoalDirectory } | null> {
  const directory = await loadGoalDirectory(organizationId);
  const actor = directory.members.get(userId);
  return actor ? { actor, directory } : null;
}
