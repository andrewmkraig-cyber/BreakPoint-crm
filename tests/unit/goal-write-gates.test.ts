// Permission gates behind every goal write action. Pure - no database, no
// session. These are the exact functions src/app/dashboard/goal-actions.ts
// calls, so a rule proven here is the rule the action enforces.
//   npx tsx tests/unit/goal-write-gates.test.ts
import assert from "node:assert/strict";

import {
  GoalPermissionError,
  GoalTenantMismatchError,
  assertCanApprove,
  assertCanMutateGoal,
  assertImmutableFieldsUnchanged,
  goalOwnerFrom,
  resolveGoalStatusOnCreate,
  type GoalActor,
  type GoalDirectory,
} from "../../src/lib/goals/permissions";

const ORG = "org_breakpoint";
const OTHER_ORG = "org_somebody_else";

function person(
  id: string,
  goalLevel: number | null,
  managerId: string | null,
  organizationId = ORG,
): GoalActor {
  return { id, organizationId, goalLevel, managerId };
}

const owner = person("owner", 0, null); // can approve
const manager = person("manager", 1, "owner"); // can request, cannot approve
const report = person("report", 2, "manager"); // neither
const unseeded = person("unseeded", null, null); // most junior

const directory: GoalDirectory = {
  organizationId: ORG,
  members: new Map([owner, manager, report, unseeded].map((p) => [p.id, p])),
};

const companyGoal = { scope: "COMPANY" as const, ownerUserId: null };
const reportGoal = { scope: "USER" as const, ownerUserId: "report" };
const ownerGoal = { scope: "USER" as const, ownerUserId: "owner" };

// ---- createGoal ----
// A forbidden create THROWS. It must never come back as a status the caller
// could mistake for "saved, pending someone's review".

// Company goal by the approver -> ACTIVE immediately.
assert.equal(
  resolveGoalStatusOnCreate({ organizationId: ORG, actor: owner, scope: "COMPANY" }),
  "ACTIVE",
);
// Company goal by leadership who cannot approve -> queued.
assert.equal(
  resolveGoalStatusOnCreate({ organizationId: ORG, actor: manager, scope: "COMPANY" }),
  "PENDING_APPROVAL",
);
// Company goal by someone who may not even request one -> THROWS.
assert.throws(
  () => resolveGoalStatusOnCreate({ organizationId: ORG, actor: report, scope: "COMPANY" }),
  GoalPermissionError,
);
assert.throws(
  () => resolveGoalStatusOnCreate({ organizationId: ORG, actor: unseeded, scope: "COMPANY" }),
  GoalPermissionError,
);
// User goal the actor may set -> ACTIVE, no approval needed.
assert.equal(
  resolveGoalStatusOnCreate({
    organizationId: ORG,
    actor: manager,
    scope: "USER",
    target: report,
    directory,
  }),
  "ACTIVE",
);
// Upward is the one direction still denied -> THROWS.
assert.throws(
  () =>
    resolveGoalStatusOnCreate({
      organizationId: ORG,
      actor: report,
      scope: "USER",
      target: manager,
      directory,
    }),
  GoalPermissionError,
);

// ---- updateGoal / archiveGoal (assertCanMutateGoal) ----

// Company goals: leadership only.
assert.doesNotThrow(() => assertCanMutateGoal(ORG, owner, companyGoal, directory));
assert.doesNotThrow(() => assertCanMutateGoal(ORG, manager, companyGoal, directory));
assert.throws(
  () => assertCanMutateGoal(ORG, report, companyGoal, directory),
  GoalPermissionError,
);
assert.throws(
  () => assertCanMutateGoal(ORG, unseeded, companyGoal, directory),
  GoalPermissionError,
);

// User goals follow canSetGoalFor against the goal's owner.
assert.doesNotThrow(() => assertCanMutateGoal(ORG, manager, reportGoal, directory));
assert.doesNotThrow(() => assertCanMutateGoal(ORG, report, reportGoal, directory)); // own goal
assert.doesNotThrow(() => assertCanMutateGoal(ORG, owner, reportGoal, directory)); // owner reaches all
// A report cannot edit their manager's goal.
assert.throws(
  () => assertCanMutateGoal(ORG, report, ownerGoal, directory),
  GoalPermissionError,
);

// A user goal whose owner is not in this org is refused, not silently
// treated as a company goal.
assert.throws(
  () =>
    assertCanMutateGoal(
      ORG,
      owner,
      { scope: "USER", ownerUserId: "ghost" },
      directory,
    ),
  GoalPermissionError,
);
assert.equal(goalOwnerFrom(companyGoal, directory), null);
assert.equal(goalOwnerFrom(reportGoal, directory)?.id, "report");

// Tenant scoping still throws its own distinct error (rule 8).
assert.throws(
  () => assertCanMutateGoal(OTHER_ORG, manager, companyGoal, directory),
  GoalTenantMismatchError,
);

// ---- approveCompanyGoal / declineCompanyGoal ----
// Strictly stricter than editing: goalLevel 0 only.
assert.doesNotThrow(() => assertCanApprove(ORG, owner));
assert.throws(() => assertCanApprove(ORG, manager), GoalPermissionError);
assert.throws(() => assertCanApprove(ORG, report), GoalPermissionError);
assert.throws(() => assertCanApprove(ORG, unseeded), GoalPermissionError);
// A manager may REQUEST a company goal but may not approve one - the two
// gates must not collapse into each other.
assert.equal(
  resolveGoalStatusOnCreate({ organizationId: ORG, actor: manager, scope: "COMPANY" }),
  "PENDING_APPROVAL",
);
assert.throws(() => assertCanApprove(ORG, manager), GoalPermissionError);

// ---- metric / period are frozen ----
// Changing either would silently rewrite what every past reading meant.
const existing = { metric: "REVENUE" as const, period: "QUARTERLY" as const };
assert.doesNotThrow(() => assertImmutableFieldsUnchanged(existing, {}));
assert.doesNotThrow(() =>
  assertImmutableFieldsUnchanged(existing, { metric: null, period: null }),
);
// Sending the SAME values back is fine - an edit form round-tripping them
// must not be rejected.
assert.doesNotThrow(() =>
  assertImmutableFieldsUnchanged(existing, { metric: "REVENUE", period: "QUARTERLY" }),
);
assert.throws(
  () => assertImmutableFieldsUnchanged(existing, { metric: "PLACEMENTS" }),
  GoalPermissionError,
);
assert.throws(
  () => assertImmutableFieldsUnchanged(existing, { period: "ANNUAL" }),
  GoalPermissionError,
);
assert.throws(
  () => assertImmutableFieldsUnchanged(existing, { period: "MILESTONE" }),
  GoalPermissionError,
);

// ---- addManualActual ----
// Gated by the same owner rule as an edit: whoever may set the goal may log
// against it, and nobody else.
assert.doesNotThrow(() => assertCanMutateGoal(ORG, report, reportGoal, directory));
assert.throws(
  () => assertCanMutateGoal(ORG, report, ownerGoal, directory),
  GoalPermissionError,
);

console.log("goal-write-gates.test.ts: all assertions passed");
