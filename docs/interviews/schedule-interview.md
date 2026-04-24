# Schedule an interview

## What it does

Books an interview for a candidate on a specific job. Writes an `Interview` row to Ace's Postgres, creates the Google Calendar event(s), and (for the Ace-scheduled flow) attaches a shared Meet link to both the client's and the candidate's invites so everyone lands in the same room.

## Two source modes

Ace supports two scheduling origins. The source affects how many calendar events get created and who receives invites:

| Source | Who owns the calendar slot | How many events | Who gets invited |
|---|---|---|---|
| **ace_scheduled** | Ace (BreakPoint Talent) | Two — one "client invite", one "candidate invite" | Client separately, candidate separately, both sharing one Meet URL |
| **client_scheduled** | The client sent the invite themselves | One master event on the recruiter's calendar | Already delivered by the client; Ace just records the interview and adds the candidate as an attendee |

The dual-event / shared-Meet pattern was shipped in commit a09162b (see the commit body for the full rationale). In short: separate events give each party their own description + independently editable body, and the recruiter's calendar shows one row per party. One Meet is Google's supported "two events, same room" pattern.

## When to use it

- A candidate finished a submittal review and the client is ready to interview.
- Second round / panel round — keep using Schedule each time.
- First introductory call with the candidate — use the phone-screen type.

Don't schedule through this flow for internal prep calls — those don't belong on the Interview table (which drives pipeline stage moves). Use your own calendar for internal prep.

## How to use it

1. Open the candidate profile and click **Schedule** on the row for the target job. Or from `/jobs/[id]` pipeline, click Schedule on the candidate's row.
2. Pick the **type**: phone screen / video / in-person. Video creates a Meet link; in-person requires a Location field.
3. Set **scheduledAt** and **durationMin**. Defaults to 30 minutes.
4. **Attendees**: pick from the client's contact dropdown (auto-populated from the job's client) or type free-text email. Multiple allowed.
5. Fill in **Location** (in-person), **Candidate phone** (phone screen), **Notes** (visible in the calendar event body for both parties).
6. Click **Schedule Interview**. Ace writes the Interview row, creates the calendar event(s), attaches Meet, sends invites.
7. The placement stage moves to `interviewing` automatically if it wasn't already there.

## Fields explained

| Field | What it's for | Required? |
|---|---|---|
| **Type** | phone_screen / video / in_person. Drives the invite template and Meet creation. | Yes. |
| **Scheduled at** | Start datetime (ET). Drives the calendar event + pipeline "next interview" indicator. | Yes. |
| **Duration (min)** | Event length. 30 default. | Yes. |
| **Client attendees** | Array of `{id?, name, email}`. Each gets invited on the client-side event. | Recommended — empty attendees means no client invite sent. |
| **Candidate phone** | Copied into the calendar event body for phone screens so the recruiter can tap-to-call at event start. | Phone screens only. |
| **Location** | Physical address (in-person) — passes through to Calendar's `location` field so the invite shows a Map link. | In-person only. |
| **Notes** | Free text that lands in both calendar event bodies. Merge fields like `[Job Description]` resolve server-side at send time. | Optional. |
| **Source** | `ace_scheduled` (default) or `client_scheduled`. Set by the dialog variant, not a user-facing field. | Auto. |

## Dual-calendar-invite + shared-Meet mechanics

*(Implementation context — not something you have to think about as a user, but it's useful to know what's happening.)*

For `ace_scheduled` interviews, the sequence is:

1. Recruiter schedules → Ace creates one "master" event on the recruiter's calendar **without** attendees (just the recruiter) that holds the Meet conference.
2. When the recruiter opens the interview row and clicks **Send invite → Client** (or **→ Candidate**), Ace creates a second calendar event with that party as an attendee, re-using the same Meet conference via Google's `conferenceData.createRequest` → existing-conference pattern.
3. The Meet conference id (`meetConferenceId`) is persisted on the Interview row so the second invite can attach the same room without a new Meet request.
4. Both `googleEventIdClient` and `googleEventIdCandidate` are stamped on the Interview row once each invite has been sent; these act as "invite delivered" flags for audit.

If Google returns an error on the second invite, the error surfaces in the UI and the first invite + Meet stay intact — no silent loss.

## Common questions

**Why two calendar events instead of one?**
So the recruiter's calendar shows one row per party (client row, candidate row) and each invitee gets their own description + their own editable event. One combined event with two attendees means both parties see the same body — we don't want to leak candidate-only notes to the client.

**What if I need to reschedule?**
Use the Reschedule action on the interview row. Ace updates both calendar events to the new time (and the Meet room stays put), bumps the Interview row's `scheduledAt`, and logs `schedule_interview_reschedule` to the action log.

**What if I need to cancel just one party's invite (not the whole interview)?**
Not supported today — the cancel button cancels the interview entirely. If you only need to remove one attendee, edit the event on Google Calendar directly and it'll stay in sync the next time Ace reads the interview row.

**My invite didn't include a Meet link.**
Check the interview type. `in_person` doesn't create Meet. `phone_screen` doesn't create Meet either — it's a phone call. Only `video` does.

## Troubleshooting

**"Calendar create failed" on Schedule.**
Your Google OAuth token probably expired. Hit `/settings` → Google reconnect, then retry. The Interview row and any pre-created Ace state is rolled back on the Calendar failure so no orphan rows land in Postgres.

**"Meet attach failed" on the second invite.**
Google's conference data gets strict about ownership signatures. If the first event was created by a different calendar owner (rare — happens if the recruiter changed their primary calendar), the second invite can't reuse the Meet. Cancel the interview and re-schedule.

**Attendees dropdown is empty.**
The job's client may not have any Contact rows in Ace. Add contacts from the client detail page's Contacts tab, then reschedule.

**The invite I sent never hit the candidate's inbox.**
Google Calendar `sendUpdates: all` is set on the candidate invite. If they still don't see it, check spam + the email address in the Interview row. The UI shows the address that was used so you can verify.

## Related features

- **Cancel Interview** (`docs/interviews/cancel-interview.md`) — standalone flow with specific Google Calendar cleanup.
- **Placement lifecycle** (`docs/placements/offer-and-placement-lifecycle.md`) — Schedule auto-moves the Placement stage to `interviewing`.
- **Activity panel** — every scheduled interview shows up on the candidate profile's activity feed.
- **Dashboard "Upcoming interviews"** — state-based view of all non-cancelled interviews in the next 7 days.
