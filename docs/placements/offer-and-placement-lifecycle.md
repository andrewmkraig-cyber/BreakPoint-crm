# Offer & placement lifecycle

## What it does

Tracks a candidate-on-job deal from offer through start confirmation. A Placement row owns the local state for every engaged (candidate, job) pair — one row per pair, advanced through stages as the deal progresses. RecruiterFlow is effectively a historical mirror; every live stage change lands in Ace's Postgres first.

## Stage progression

```
sourced → applied → kept → submitted → interviewing → offer → pending_start → hired
                                                            ↘ rejected
                                                            ↘ cancelled
```

- **sourced / applied / kept** — early engagement; no offer yet.
- **submitted** — the submittal email went out (recorded when the composer's Send fires).
- **interviewing** — first interview landed; stamped by `scheduleInterview`.
- **offer** — `recordOffer` stamped `offerReceivedAt` + offer details.
- **pending_start** — `recordPlacement` stamped `placedAt` + accepted comp + fee + billing contacts + expected start date.
- **hired** — `confirmStart` stamped `startConfirmedAt` and accepted the signed offer letter screenshot.
- **rejected / cancelled** — terminal branches; `rejectCandidateJob` or `cancelPlacement`.

Stage moves back and forth are allowed where the UI permits — `unrejectCandidateJob`, `moveToKept`, `moveToApplied`, `reapplyCancelledPlacement`. Each logs an ActionLog so the activity feed shows the history.

## When to use each action

| Action | When to trigger | Server action |
|---|---|---|
| Submit | Submittal email sent to client | `sendSubmittalEmail` (Submit modal) |
| Schedule | Client confirmed interview time | `scheduleInterview` (dialog) |
| Offer Received | Client sent an offer to the candidate | `recordOffer` (offer dialog) |
| Placement | Candidate accepted the offer; fee + billing locked | `recordPlacement` (placement dialog) |
| Confirm Start | Candidate's first day confirmed with a screenshot proof | `confirmStart` (confirm dialog) |
| Cancel | Post-offer the deal fell through | `cancelPlacement` (cancel dialog with reason) |
| Reject | Client or recruiter killed the candidate on this job | `rejectCandidateJob` (reject dialog with reason) |

## Fields explained

Every Placement row carries:

- **stage** — the canonical string above.
- **offerSalary / offerCurrency / offerTitle / offerStartDate / offerNotes** — snapshotted at offer time; not overwritten by later edits.
- **acceptedSalary / acceptedCurrency** — the final accepted comp. May differ from offerSalary if the candidate negotiated.
- **feePercentage / feeTotal / minFee / guaranteePeriodDays** — fee economics locked at placement time. The Pipeline table + Q2 billing tower read from here.
- **billingContacts** — JSON array of `{name, email}`. First entry is mirrored to `billingContactName/Email` for single-contact legacy readers.
- **hiringManagerName / hiringManagerEmail** — the person signing off; used by post-placement comms.
- **expectedStartDate** — planned first day.
- **startConfirmedAt / startConfirmationFile / startConfirmationMime** — Confirm Start uploads a screenshot of the candidate's signed offer letter / "confirming Monday" email; stored inline.
- **invoicingFlagged / invoicedAt** — invoicing workflow touchpoints.
- **syncedToRf** — currently always false (RF /external has no stage-change endpoint). UI shows "(Ace only)" when false.
- **source** — how the candidate first landed on the job (`recruiter_applied`, `job_board`, `careers_form`, `rf_import`).
- **organizationId** — tenant scope. Every Placement row is scoped to one org; every read in the app filters by this column via `getCurrentOrg()`.

## Common questions

**What happens when I submit a candidate twice to the same job?**
The `(candidateId|candidateRfId, jobRfId|jobId)` unique constraint blocks a second Placement row for the same pair. The Submit modal surfaces "Candidate already linked to this job (stage: X)" and bails. Move the existing row's stage forward (or reject it) before re-engaging.

**Does recording an offer push anything to RecruiterFlow?**
No. RF /external has no stage-change endpoint we can call. The "(Ace only)" badge on the pipeline row is the honest indicator — every live stage change is Ace-local.

**Where do I see the list of cancelled deals?**
The pipeline view filters them out by default. `/jobs/[id]` pipeline columns include a Cancelled column that only appears when at least one row sits there. The cancellation reason is pulled from the `cancel_placement` ActionLog metadata so the badge can show why.

**Can I edit a placement after it's been recorded?**
Yes, from the candidate profile's placement row. Most fields re-render with their current values and the save path upserts against the Placement's cuid. `placedAt` is sticky once stamped (editing a placed row doesn't reset the timestamp) — the dashboard "Placements Made" counter depends on that.

**I uploaded a Confirm Start screenshot but it won't render.**
The file is stored as inline bytes and streamed via `/api/placement-screenshot/[id]`. If it 404s, the Placement belongs to a different tenant (the route is tenant-scoped) or the file wasn't saved (upload may have failed silently — re-run Confirm Start).

## Troubleshooting

**"Placement not found" on a stage-move action.**
The action is scoped to the Placement id + your tenant. If you switched orgs mid-session, reload and retry. Otherwise the row may have been deleted — check the candidate profile.

**"(Ace only)" badge staying forever.**
Expected. RF /external doesn't accept stage changes, so every Ace-driven stage move stays `syncedToRf: false` until we either get a working RF endpoint or retire that column in Phase 5.

**Dashboard "Offers Extended" counter not updating.**
The counter reads `Placement.offerReceivedAt` inside the ET week bounds. Recording an offer stamps this; moving straight from submitted → pending_start would skip it. Fix by opening the placement dialog and re-saving offer details.

**Cancelled placement reappearing in the pipeline.**
The pipeline view excludes `stage === "cancelled"`. If a cancelled row shows up, the cancel action probably errored out before updating the stage — re-run Cancel Placement and check the action log for errors.

## Related features

- **Schedule Interview** (`docs/interviews/schedule-interview.md`) — auto-upserts Placement.stage = "interviewing" on first interview scheduling.
- **Cancel Interview** (`docs/interviews/cancel-interview.md`) — doesn't roll the Placement stage back (one cancelled interview ≠ interview round gone).
- **Pipeline view** — reads Placement directly; every column is a stage bucket.
- **Dashboard activity counters** — count stage transitions within the ET week; read from Placement timestamp columns + ActionLog.
