# Smart context — "Which job is this email about?"

When you click an email link on a candidate profile, the popup composer now figures out which active applied jobs that candidate has and either auto-loads context (1 active job) or asks you to pick (2+).

## How it decides

On open, the composer hits `/api/mail/candidate-context/[idOrRfId]` for the launching candidate. The API returns every Placement whose `stage` is NOT in the terminal set:

- **Excluded (terminal):** `hired`, `rejected`, `cancelled`
- **Included (any non-terminal stage):** `sourced`, `applied`, `kept`, `submitted`, `interviewing`, `offer`, `pending_start` — and any future non-terminal stage we add (the filter is a blacklist of terminal stages, not a whitelist of active ones, so new stages count automatically without a code change).

Sorted by Placement.updatedAt descending so the most recently active job sits at the top of the dropdown when there are multiple.

The composer branches on the number of active jobs:

| Count | What you see |
|---|---|
| **1** | The job + its client are auto-loaded into context. `{{job.*}}` and `{{client.*}}` merge fields resolve normally. No dropdown. |
| **2 or more** | A "Which job is this email about?" dropdown appears just above the rich-text toolbar. Pick a job; context loads; merge fields resolve. |
| **0** | No dropdown. `{{job.*}}` / `{{client.*}}` fields stay literal in the sent body. The unresolved-fields banner near the Send button shows "[No active job] — These fields will send literally:" plus the list of tags. |

## Unresolved-fields banner

The "Send anyway?" confirmation dialog is **gone** as of Phase 5A.2. It got annoying — every send with a `{{job.description}}` in the body popped a confirm prompt.

Replaced by an inline banner that sits above the Send button when there's at least one merge field in the draft body or subject that the composer can't resolve:

> [Pick job above] — These fields will send literally: `{{job.title}}` `{{client.name}}`

The note prefix tells you why:

- **`[Pick job above]`** — you have 2+ active jobs and haven't picked one. Pick one to resolve.
- **`[No active job]`** — no active applied jobs on the candidate's record. Pick a template that doesn't need job context, or fill the values into the body manually.
- **(no prefix)** — the candidate has no smart context (e.g. composer was opened from a client contact or pipeline row, not a candidate profile). Self-evident which fields are unresolved.

The banner is just informational. Send still goes through. The literal `{{...}}` text appears in the sent email — same behavior as before, just without the modal interrupt.

## Body re-resolves on pick

Phase 5A.2-fix: when you pick a job from the dropdown, the composer body actually changes — `{{job.title}}`, `{{job.description}}`, `{{client.name}}`, etc. swap to the picked job's real values right in the editor. Switch the dropdown to a different job and the body re-resolves to the new job's data.

Mechanic: the composer holds the un-substituted source body in memory the moment a template is applied (or Claude generates a draft). Each context change re-runs the resolver against that source. Manual typing in the editor invalidates the saved source — at that point a context change won't overwrite your edits, but the dropdown still resolves merge fields at send time and clears them from the unresolved-fields banner.

## Surfaces that trigger smart context

Smart context fires only when the composer is opened from a **candidate** profile:

- Candidate profile sidebar / contact card (`/candidates/[id]`)
- (RF-imported and Ace-native both pass `candidateRef` through)

Other surfaces (Mail Tab Reply, client contact email, pipeline placement row billing-contact) don't fire smart context. They show the unresolved banner only if you intentionally inserted job/client tags.

## When the data doesn't load

If the API call fails (auth, network, etc.) or returns 0 active jobs:

- The dropdown doesn't render.
- Tags pass through literal.
- Banner explains via `[No active job]`.

You can still send. The composer never blocks on context — it's a quality-of-life loader, not a hard requirement.
