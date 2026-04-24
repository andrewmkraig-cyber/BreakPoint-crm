# Cancel an interview

## What it does

Cancels a scheduled interview. Updates the Interview row's `status` to `cancelled`, deletes the associated Google Calendar events (both parties' invites, if applicable), and logs an ActionLog entry so the activity feed shows what happened and why. The Placement stage does **not** roll back — one cancelled interview is a cancelled slot, not a cancelled interview round.

## When to use it

- The client or candidate pulled out of a specific interview slot.
- The time no longer works and you're going to reschedule (for an immediate reschedule, use the Reschedule action instead — it preserves the Meet room).
- The interview was booked in error.

Do **not** use this to mark an interview as "completed" — completed interviews keep `status = "scheduled"` until their `scheduledAt` falls in the past (the dashboard counter reads the time, not the status). Cancel is specifically for "this interview will not happen."

## How to use it

1. From the candidate profile's activity panel, or the interview row on the candidate's placement, click **Cancel**.
2. Confirm the cancel prompt.
3. Ace updates the Interview row's status, deletes the Google Calendar event(s), and logs the cancellation.

## What gets touched

- **Interview.status** → `"cancelled"`.
- **Google Calendar events** — both `googleEventIdClient` and `googleEventIdCandidate` (if set) are deleted via the Calendar API with `sendUpdates: "all"` so both parties get a cancellation email.
- **Meet conference** — left alone. Google auto-reclaims unreferenced Meet rooms.
- **Placement.stage** — NOT changed. A candidate with stage `interviewing` stays in that bucket until the recruiter moves them (reject, offer, move to kept).
- **ActionLog** — a `cancel_interview` entry is written with metadata capturing `interviewId`, `reason` (when provided), and which calendar events were deleted.

## Fields explained

The cancel flow is a single click — no form fields to fill in. The one optional extension is:

| Field | What it's for | Required? |
|---|---|---|
| **Reason** | Free-text cancellation reason stored in the ActionLog metadata. Surfaces in the activity feed's cancelled interview badge. | Optional. |

## Common questions

**Will the candidate know their interview is cancelled?**
Yes — Google Calendar sends a cancellation email to every attendee. If you want to tell them before the Google email lands, send a direct email first; Cancel is irreversible.

**Can I uncancel an interview?**
No single-click undo. The Interview row can be manually flipped back to `status: "scheduled"` via DB fix, but the Google Calendar events are gone — you'd need to reschedule instead.

**Does cancelling an interview move the candidate back out of the interviewing stage?**
No. The stage reflects "the recruiter has started interviewing this candidate for this job" — one cancelled slot doesn't undo that. If the round is truly dead, use Reject or Move to Kept on the placement row.

**What if only one party's event exists (e.g. I cancelled before sending the candidate invite)?**
Ace deletes whichever event ids are present. The missing one is a no-op. Same cancel action covers both the half-sent and fully-sent states.

**The interview shows cancelled on the profile but the cancellation email never arrived.**
Google Calendar's `sendUpdates: all` fires asynchronously. Delivery depends on the attendee's mail provider — gmail accounts usually get it within 30s; corporate mail can be delayed. If it's been more than a few minutes, check the Google Calendar web UI for the event — if it still exists there, Ace's delete call failed and you'll need to delete it manually.

## Troubleshooting

**"Calendar delete failed" toast.**
The OAuth token expired or the event was already deleted in Google. Reload, reconnect Google from `/settings`, and retry. Ace will skip whichever event ids return 404 and mark the rest deleted.

**"Interview not found" on Cancel.**
The interview id isn't in your tenant. Either the row was already deleted or you're hitting a stale UI — refresh the candidate profile.

**Cancelled interview still showing on the dashboard "Upcoming interviews" panel.**
That panel filters on `status = "scheduled"` and future scheduledAt. If a cancelled row still shows, the status update failed silently — check the browser console + retry.

**Pipeline shows "Interviewing" but there are no upcoming interviews.**
Expected. The stage is a per-placement flag; "Upcoming interviews" is a separate state view. Cancel doesn't roll the stage back. If the candidate is dead in the pipeline, reject them explicitly.

## Related features

- **Schedule interview** (`docs/interviews/schedule-interview.md`) — the create side of the same lifecycle.
- **Reschedule** — preserves the Meet room; updates both calendar events to a new time. Use this instead of Cancel+Schedule when the candidate/client just needs a different time.
- **Placement lifecycle** (`docs/placements/offer-and-placement-lifecycle.md`) — Cancel doesn't touch the placement stage; Reject or Move to Kept does.
- **Activity panel** — cancelled interviews stay visible with a Cancelled badge so the audit trail is complete.
