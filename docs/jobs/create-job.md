# Create a job

## What it does

Creates a new job (requisition) record in Ace. The job is saved directly to Ace's database — no RecruiterFlow sync happens at create time. Once saved, the job shows up on `/jobs`, has its own detail page at `/jobs/[id]`, and is immediately available as a target for Submit / Apply / Interview flows from any candidate profile.

## When to use it

- A client signed a fee agreement for a new role and you want the requisition on file before sourcing.
- You kicked off a search in a discovery call and need somewhere to park the JD while you line up candidates.
- You're importing an inbound referral and want to tie a candidate to a live req today.

Do **not** use it to edit an existing job — open that job's profile and edit inline. The create form assumes a fresh record and doesn't cross-check titles against existing open reqs.

## How to use it

1. From the Jobs page click **New Job in Ace** in the top right (or go to `/jobs/new` directly).
2. Fill in the **Job title** (required). Everything else is optional but recommended — more context means better submittal writeups.
3. Pick the **Client** from the dropdown. Every client in your tenant shows up, both RF-imported clients and any Ace-native clients created through `/clients/new`. The option list is alphabetical.
4. Fill in the **Location**, **Job type**, **Employment type**, **Salary low / high**, **Currency**, and **Openings** as the req spec allows. Salary low that's higher than salary high auto-swaps on tab-out.
5. Either drop a JD file (PDF/DOCX) into the Description block and click **Generate Job Description with Claude**, or paste/write the description by hand. Claude reformats raw JD text into the BreakPoint format (A Bit About Us / Why Join Us / Job Details). The generation is AUTO (structured reformat); edit the output before saving if you want different emphasis.
6. Click **Create job**. Ace writes the Job row (with your organization stamped) and redirects you to the job's detail page.

## Fields explained

| Field | What it's for | Required? |
|---|---|---|
| **Job title** | The role's display name. Used on the Jobs list, the detail header, every submittal subject line. | Yes. |
| **Client** | Who owns the requisition. Drives the client-fee resolution downstream and filters the Submit/Apply contact pickers to the right company. Both RF-imported and Ace-native clients surface here. | Recommended — a job without a client can't bill. |
| **Location** | City, state, "Remote", etc. Shown on the detail header and in submittal subject lines. Stored as an array (one entry per comma-separated value). | Optional. |
| **Job type** | Permanent / Contract / Contract to Hire / Temporary / Internship. Used for filtering on the Jobs list. | Optional (defaults to Permanent). |
| **Employment type** | Full time / Part time / Contract. Appears in the detail header alongside the job type. | Optional (defaults to Full time). |
| **Salary low / high** | Annual base range. Shown on detail and on candidate-facing submittals. 0 is a valid lower bound; negatives are rejected. | Optional. |
| **Currency** | Three-letter ISO code (USD, CAD, GBP…). Defaults to USD. | Optional. |
| **Openings** | Number of seats the client is hiring for. | Optional (defaults to 1). |
| **Description** | The JD body. Either Claude-generated from an uploaded JD or hand-written. This is what `[Job Description]` resolves to on submittal / interview-invite merge fields. | Optional — but leaving it blank means merge fields come back empty. |

## Common questions

**Does creating a job call RecruiterFlow?**
No. Ace writes to its own database only. Phase 2 moved job creation off RecruiterFlow.

**Can I create a job tied to an Ace-native client created in `/clients/new`?**
Yes — that's what Phase 2 unlocked. The dropdown surfaces every client in your tenant. After save, the job routes to `/jobs/<cuid>` if the client is Ace-native or `/jobs/<legacyRfId>` if RF-imported; both URL shapes resolve correctly.

**What does the generated JD look like?**
Three sections: "A Bit About Us", "Why Join Us", "Job Details". Claude reformats whatever source you gave it — a messy PDF, a link dump, or pasted text — into that shape. It's AUTO extraction; no hand-written marketing copy is invented.

**I got the "Claude unavailable — template loaded" toast. What do I do?**
Claude's API was unreachable at generation time (key missing, rate-limited, or transient). A skeleton JD template loads so you can still save. Fix the underlying API key issue (or retry later) and re-generate whenever you're ready.

**Can I edit the description after save?**
Yes. The detail page's Description section has an edit-in-place block. Saves go back to the job row (for Ace-native jobs) or to the JobOverride layer (for RF-imported jobs). Merge fields automatically pick up whichever is newer.

**What organization does the new job belong to?**
Your current organization — resolved from your session at save time. You can't accidentally create a job in a different org.

**Will the new job show up on existing candidates' Submit/Apply dropdowns?**
Yes. Any open job in your tenant surfaces in candidate-profile dropdowns across both the RF-imported and Ace-native candidate pages. Ace-native Jobs route Submit writes through the cuid FK on Placement; RF-imported Jobs keep their legacyRfId path.

## Troubleshooting

**"Job title is required."**
The only hard-required field. Fill it in and retry.

**"Salary low can't be greater than salary high."**
Either swap them yourself or tab out — Ace auto-swaps on blur when the range is inverted.

**"Selected client is not available."**
The client id the form submitted doesn't match any client in your tenant. Usually means the session was stale — refresh the page, pick the client again, and re-submit.

**"Not signed in."**
Session expired between opening the form and hitting Save. Reload, sign back in, and retry.

**The job didn't show up on `/jobs`.**
The list defaults to the **Active** tab. Fresh jobs are always open by default, so they should land in Active immediately. If you don't see it, check the search box isn't filtering it out and refresh — the list is fetch-on-render, not cached.

**Submitting a candidate to the new job rejects with "Candidate already linked…".**
A Placement already exists for this (candidate, job) pair at a different stage. Pull up the candidate profile; the existing row's stage is shown there. Move / reject / re-submit from that row instead.

## Related features

- **Job detail page** — Overview / Pipeline / Description blocks. Description is inline-editable from the detail page post-save.
- **Submit composer** — Open a candidate profile, click Submit to Job, pick the new req, generate a writeup with Claude, send. The Placement row lands in Ace with the right cuid FKs for Ace-native jobs or RF ids for RF-imported.
- **Apply button** — Faster path for recruiter-driven applications that don't need an email out the door. Stamps Placement.stage = "applied" and shows up on `/applicants`.
- **Interview scheduling** — From any submitted / interviewing candidate row, schedule an interview tied to this job. The invite pulls `[Job Description]` from the description authored at create time (or edited later).
