# Create a candidate

## What it does

Creates a new candidate record in Ace from a resume, pasted profile text, or a LinkedIn URL. The candidate is saved directly to Ace — no RecruiterFlow sync happens at create time. Once saved, the candidate shows up on `/candidates`, has their own profile page at `/candidates/[id]`, and is immediately eligible to be applied to or submitted to jobs.

## When to use it

- A new resume lands in your inbox and you want to add that person to the pool.
- You spotted a promising profile on LinkedIn and want to capture it before reaching out.
- A candidate replied to a job-board posting and you need a profile for them before submitting to a client.
- You're prospecting and want to stash a name with minimal info so you can come back later.

Do **not** use it to edit an existing candidate — open their profile instead. Creating a duplicate by re-uploading the same resume will fail at save time (the email-unique check catches it) or create a second row with the same email.

## How to use it

1. From anywhere in Ace, click **New candidate** in the top right of the Candidates page, or go to `/candidates/new` directly.
2. Choose one of the three input methods:
   - **Upload resume** — drop in a PDF, DOCX, or DOC. The file chunk-uploads in the background; once it finishes, Claude parses the fields and fills the form for you.
   - **Paste profile text** — copy a LinkedIn "About" section or free-form resume text into the box. Claude reads it the same way as a file.
   - **LinkedIn URL** — paste a public LinkedIn profile URL. Ace fetches the page and extracts what it can see (structured summary + experience).
3. Review the parsed fields. Anything Claude isn't sure about is left blank; anything it's confident about is pre-filled. Edit in place — every field is editable.
4. Click **Save candidate**. The form writes a new `Candidate` row to Neon and redirects you to the profile at `/candidates/[id]`.

## Fields explained

| Field | What it's for | Required? |
|---|---|---|
| **First name / Last name** | Primary identity. Shows on every list and email merge. | First name yes; last name optional. |
| **Email** | Primary contact email. Must be unique across your organization. Used as the merge field for submittal/interview emails. | Optional but highly recommended — without it you can't email them. |
| **Phone** | Click-to-call via Krispcall. Stored in whatever format you paste; Ace normalizes to `+1 XXX-XXX-XXXX` at display time. | Optional. |
| **Current title / Current employer** | Shown on the candidates list and merge fields. | Optional. |
| **Location** | Free-form text (e.g. "Cleveland, OH"). Shown on the list and on the profile header. | Optional. |
| **LinkedIn URL** | Hyperlinked on the profile sidebar. | Optional. |
| **Skills** | Tag list — comma-separated on paste, chips in the UI. Searchable on the candidates list. | Optional. |
| **Experience** | Array of roles. Each row is a designation + organization + date range + optional description. Parser fills this from the resume where available. | Optional. |
| **Education** | Array of degrees. School + degree + date range + optional description. | Optional. |
| **Notes** | Free-form. Good for "spoke to her on 4/22 — interested in remote roles under $150k." Visible to the team in the notes panel on the profile. | Optional. |
| **Resume** | The uploaded file, stored on the candidate row. Download and inline PDF preview are available from the profile. | Optional — you can create a candidate without a resume and add one later. |

## Common questions

**Does creating a candidate call RecruiterFlow?**
No. Ace writes to its own database only. RecruiterFlow is being phased out — new candidates don't go there. Historical candidates imported from RF are still visible and editable through the same profile UI.

**What if the parser mis-reads a field?**
Edit it before saving, or save and edit from the profile afterwards. Every field is editable in both places; nothing the parser writes is permanent until you hit Save.

**I uploaded the wrong resume — can I re-upload?**
Yes. Hit **Replace** from the upload widget (or from the profile's Resume section after save). The old bytes are wiped and the new file takes their place. There's no history of previous versions.

**Is the resume stored in Ace or a CDN?**
In Ace's Postgres (Neon) database, in the `CandidateResume` table. This is fine at current volume; if we outgrow it we'll move to Vercel Blob without a schema change.

**What organization does a new candidate belong to?**
Your current organization — resolved from your session at save time. You can't accidentally create a candidate in a different org. The list page and profile are scoped the same way, so you'll see what you saved.

**Can I re-run the parser on an existing candidate?**
Not from the UI. For now, delete and re-create if the parse was wrong at ingestion time. We'll revisit this if it becomes a pain.

## Troubleshooting

**"Resume upload not finished — try again."**
The chunked upload didn't reach the final chunk (usually a network drop). Just click Upload again. Ace replaces the staging row on re-upload, so you won't end up with half a file.

**"Email already in use."**
Another candidate in your organization has the same email. Either (a) find them on `/candidates` and edit the existing row, or (b) clear the email field on the new form if you genuinely need a separate record (rare — this is usually a sign of a duplicate).

**The parser filled in the wrong name.**
Hand-edit the First / Last fields before saving. If Claude consistently mis-parses a specific resume style, flag it in #engineering-ace so we can tune the prompt.

**LinkedIn URL fetch returned no data.**
Public LinkedIn pages sometimes hide behind a login wall. Either paste the profile text manually instead, or create the candidate with just the URL and fill in fields by hand.

**Save button is greyed out.**
First name is the only strictly required field. If it's blank, nothing saves. Clearing your browser's autofill on that field sometimes helps.

## Related features

- **Edit candidate profile** — once created, every field on the profile is inline-editable. Writes go back to the same `Candidate` row via the `updateCandidate` server action.
- **Apply / Submit to job** — from the profile, click **Apply** or **Submit** to link the candidate to a job and create a `Placement` row. The Applicants page and Job pipeline update accordingly.
- **Attach resume** — the Resume section on the profile supports upload and replace. Redaction (PII-blur) lives inline and saves a second blob alongside the original.
- **Game Plan** — the AI workspace tab on the profile pulls this candidate's resume, placements, and recent SMS/calls into context and lets you ask Claude questions about them.
- **Activity panel** — every candidate-touching action (create, edit, apply, submit, interview, offer, hire, reject) writes an `ActionLog` row scoped to your organization so the history stays auditable.
