// Goals org-chart permissions. Pure - no database, no session.
//   npx tsx tests/unit/goal-permissions.test.ts
import assert from "node:assert/strict";

import {
  GoalPermissionError,
  GoalTenantMismatchError,
  canApproveCompanyGoal,
  canRequestCompanyGoal,
  canSetGoalFor,
  rankOf,
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

// The fixture org:
//
//   owner (L0)
//     |
//     +-- manager (L1)
//     |     |
//     |     +-- report (L2)          direct report of manager
//     |           |
//     |           +-- deepReport (L3)  report's report
//     |
//     +-- peer (L1)                  same rank as manager, different branch
//           |
//           +-- peersReport (L2)     lower rank, NOT in manager's branch
//
//   unseeded (null level, no manager)
const owner = person("owner", 0, null);
const manager = person("manager", 1, "owner");
const report = person("report", 2, "manager");
const deepReport = person("deepReport", 3, "report");
const peer = person("peer", 1, "owner");
const peersReport = person("peersReport", 2, "peer");
const unseeded = person("unseeded", null, null);

const directory: GoalDirectory = {
  organizationId: ORG,
  members: new Map(
    [owner, manager, report, deepReport, peer, peersReport, unseeded].map((p) => [p.id, p]),
  ),
};

// ---- canSetGoalFor ----

// Self.
assert.equal(canSetGoalFor(ORG, manager, manager, directory), true);
assert.equal(canSetGoalFor(ORG, unseeded, unseeded, directory), true);

// Same level (peer at the same rank, other branch).
assert.equal(canSetGoalFor(ORG, manager, peer, directory), true);
assert.equal(canSetGoalFor(ORG, peer, manager, directory), true);

// One level below, a direct report.
assert.equal(canSetGoalFor(ORG, manager, report, directory), true);

// Two levels below, reached transitively through managerId.
assert.equal(canSetGoalFor(ORG, manager, deepReport, directory), true);

// A peer's report the actor does not manage. Lower rank, but someone
// else's branch, so no.
assert.equal(canSetGoalFor(ORG, manager, peersReport, directory), false);

// Upward is not allowed either: a report cannot set their manager's goal.
assert.equal(canSetGoalFor(ORG, report, manager, directory), false);
assert.equal(canSetGoalFor(ORG, report, owner, directory), false);

// The owner reaches everyone, including branches they do not directly manage.
assert.equal(canSetGoalFor(ORG, owner, peersReport, directory), true);
assert.equal(canSetGoalFor(ORG, owner, unseeded, directory), true);

// A null goalLevel is the most junior rank, so an unseeded user has no
// authority over anyone ranked above them.
assert.equal(rankOf(unseeded) > rankOf(deepReport), true);
assert.equal(canSetGoalFor(ORG, unseeded, manager, directory), false);
assert.equal(canSetGoalFor(ORG, unseeded, deepReport, directory), false);

// A manager reaches an unseeded user only if they actually report to them.
assert.equal(canSetGoalFor(ORG, manager, unseeded, directory), false);
const attached: GoalDirectory = {
  organizationId: ORG,
  members: new Map(directory.members).set(
    "unseeded",
    person("unseeded", null, "manager"),
  ),
};
assert.equal(
  canSetGoalFor(ORG, manager, attached.members.get("unseeded")!, attached),
  true,
);

// A managerId cycle is bad data, not a hang.
const cyclic: GoalDirectory = {
  organizationId: ORG,
  members: new Map([
    ["a", person("a", 5, "b")],
    ["b", person("b", 5, "a")],
  ]),
};
assert.equal(
  canSetGoalFor(ORG, person("outsider", 1, null), cyclic.members.get("a")!, cyclic),
  false,
);

// ---- Tenant scoping (architecture rule 8) ----

// A target carrying another org's id throws instead of quietly denying.
assert.throws(
  () => canSetGoalFor(ORG, manager, person("intruder", 2, "manager", OTHER_ORG), directory),
  GoalTenantMismatchError,
);
// So does a directory loaded under a different org.
assert.throws(
  () => canSetGoalFor(ORG, manager, report, { ...directory, organizationId: OTHER_ORG }),
  GoalTenantMismatchError,
);
// And an empty org id, which is what a missing session would produce.
assert.throws(() => canRequestCompanyGoal("", manager), GoalTenantMismatchError);

// ---- Company goal request + approval ----

assert.equal(canRequestCompanyGoal(ORG, owner), true); // L0
assert.equal(canRequestCompanyGoal(ORG, manager), true); // L1
assert.equal(canRequestCompanyGoal(ORG, peer), true); // L1
assert.equal(canRequestCompanyGoal(ORG, report), false); // L2
assert.equal(canRequestCompanyGoal(ORG, unseeded), false); // null

assert.equal(canApproveCompanyGoal(ORG, owner), true); // L0 only
assert.equal(canApproveCompanyGoal(ORG, manager), false);
assert.equal(canApproveCompanyGoal(ORG, unseeded), false);

// ---- resolveGoalStatusOnCreate ----

// Company goal by an approver goes straight to ACTIVE.
assert.equal(
  resolveGoalStatusOnCreate({ organizationId: ORG, actor: owner, scope: "COMPANY" }),
  "ACTIVE",
);

// Company goal by a non-approver who may request one waits for sign-off.
assert.equal(
  resolveGoalStatusOnCreate({ organizationId: ORG, actor: manager, scope: "COMPANY" }),
  "PENDING_APPROVAL",
);

// Company goal by someone who may not even request one is refused, not
// downgraded to PENDING_APPROVAL.
assert.throws(
  () => resolveGoalStatusOnCreate({ organizationId: ORG, actor: report, scope: "COMPANY" }),
  GoalPermissionError,
);

// User-scoped goals the actor may set are ACTIVE immediately.
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
assert.equal(
  resolveGoalStatusOnCreate({
    organizationId: ORG,
    actor: report,
    scope: "USER",
    target: report,
    directory,
  }),
  "ACTIVE",
);

// A user-scoped goal for someone the actor may not set is refused.
assert.throws(
  () =>
    resolveGoalStatusOnCreate({
      organizationId: ORG,
      actor: manager,
      scope: "USER",
      target: peersReport,
      directory,
    }),
  GoalPermissionError,
);

// A user-scoped goal with no target cannot be silently treated as a
// self-goal.
assert.throws(
  () => resolveGoalStatusOnCreate({ organizationId: ORG, actor: manager, scope: "USER" }),
  GoalPermissionError,
);

console.log("goal-permissions.test.ts: all assertions passed");
