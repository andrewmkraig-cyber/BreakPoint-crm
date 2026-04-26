# Ace Roadmap

## Ace 23.0 - Mail Tab remaining items + activity logging

### Order of execution

1. Auto-tagging emails to candidate/client profiles - on send and on receive, match email addresses to Neon candidate/client/contact records, surface matched threads on candidate profile, client profile, and contact cards. VERY IMPORTANT.
2. BCC Austin auto-populate - Settings toggle: "Always BCC Austin Barnard." When on, austin@breakpointtalent.com auto-populates in BCC on every new compose and reply. User can remove manually per email.
3. Click-to-add dropdown bug - suggestions dropdown on To/CC/BCC stays visible after clicking a suggestion instead of auto-dismissing. Fix dismiss behavior.
4. Mail tab sent view - Sent tab/filter in /mail showing sent messages from Gmail sent folder, same thread UI as inbox.
5. Sent emails composed from Ace appearing in candidate/client activity - when email sent from popup composer, log it as activity event on the candidate or client profile it was sent from.

## Ace 18.0 - Composer UX + Templates + Mail Tab Polish + Interview Scheduling Overhaul

Picks up the 13 backlog items from Ace 17.0 plus the Interview Scheduling Overhaul. Estimated 8-10 atomic prompts.

### Order of Execution (prompts numbered)

#### Prompt 5A - Composer UX overhaul (resumes Ace 17.0 work) [SHIPPED in 5A.1, 5A.1-fix, 5A.2, 5A.2-fix]
1. Stop closing modal on backdrop click. Only X button closes. [SHIPPED 5A.1]
2. Drag and resize popup composer (Gmail-style). User can drag the title bar to reposition, drag corners to resize. [SHIPPED 5A.1]
3. Minimize button + bottom-of-screen tray. Minimized drafts show as small horizontal pills at the bottom of the Ace viewport. Click to restore. Multiple drafts can be minimized simultaneously. [SHIPPED 5A.1]
4. Dual-format merge field parser. Both [Bracket Format] and {{double.curly}} syntaxes resolve to the same data. Existing field map covers both forms. Insert Field dropdown defaults to inserting {{}} but parser handles both for backward compatibility with RF-imported templates. [SHIPPED 5A.2]
5. Smart context resolution. When popup opens from a candidate profile: if candidate has 1 active applied job, auto-load that job + its client as context. If 2+, show a small "Which job is this email about?" dropdown above the composer body. User picks, context loads, all merge fields resolve. [SHIPPED 5A.2 + 5A.2-fix — broadened to ANY non-terminal job association, body now visibly re-resolves on dropdown pick]
- Bonus shipped 5A.1-fix: Send button always visible at minimum composer size; sticky sidebar across long pages with Settings always reachable.
- Bonus shipped 5A.2-fix: multi-word full-name search ("andrew kraig" now finds candidate AND contact across header + /candidates page).

#### Prompt 5A.3 - Candidate page pagination [SHIPPED]
1. /candidates page paginates at 25 candidates per page. Add page controls (prev/next/jump-to-page) at the bottom of the candidate table. Default sort preserved. Search and filter operate across the full dataset; pagination applies to the result set. [SHIPPED]

#### Prompt 5A.4.a - Lists feature: schema migration [SHIPPED]
1. New Neon tables: CandidateList (id, organizationId, name, createdById, createdAt, updatedAt) and CandidateListMembership (id, listId, candidateId, addedAt). Both scoped by organizationId. Composite uniques on (organizationId, name) and (listId, candidateId). Cascade delete from list/candidate sides; RESTRICT on createdById to preserve attribution. [SHIPPED via npx prisma db push — see docs/help/lists-schema.md]

#### Prompt 5A.4.b - Lists feature: UI [NEXT]
1. Add "Add to List" button on candidate profile. Click opens popup composer with two options: "Create new list" (text input + Save) or "Add to existing list" (dropdown of lists for current user's org). Multi-select allowed - candidate can be on multiple lists at once.
2. /candidates page top search bar gets a "Lists" filter dropdown alongside existing search. Pick a list, candidates filter to only members of that list. "All candidates" option clears the filter. Lists dropdown sorted alphabetically.
3. Lists management: small page at /candidates/lists for renaming, deleting lists. Deleting a list removes the membership rows but does NOT delete the candidates.
4. All queries scope by organizationId (Rule 8).

#### Prompt 5B - Rebuild 3 core templates in {{}} format
1. Submittal Confirmation to Candidate ("Great News - You've Been Submitted!")
2. Application Received (matches the screenshot Andrew sent: "Hi {{candidate.first_name}}, I received your application to the {{job.title}} position you applied for in {{job.city}}, {{job.state}}. This is with {{client.name}}. What salary are you targeting? How is the commute for you to {{job.city}}? Why are you open to new opportunities at this time and what are you looking for in your next role?")
3. Acceptance of Offer (subject "Acceptance of Offer - {{candidate.full_name}} - {{client.name}}")

Each template tagged with side (candidate-facing vs client-facing) and stage (which pipeline stage this fires from).

#### Prompt 6 - CC/BCC autocomplete
1. CC dropdown autocompletes with other contacts at the same client org as the To recipient
2. BCC dropdown autocompletes with teammates from Andrew's org (Austin Barnard for now)
- (Sticky sidebar previously bundled with this prompt has already shipped via 5A.1-fix.)

#### Prompt 7 - Mail Tab polish + bidirectional read sync

SHIPPED 22.0:
- Open thread marks read in Gmail (removeLabel UNREAD)
- Unread count badge on Mail sidebar
- Browser tab title with unread count (live via MailContext)
- Move To label dropdown (Archive kept, Move To additive)
- Logo + signature contact icons CID render fix
- Favicon (pulled forward from Week 4)

REMAINING for 23.0:
- BCC Austin auto-populate
- Click-to-add dropdown bug fix
- Re-audit ENOENT logo on serverless (low priority)

#### Prompt 8 - Auto-tagging emails to candidate/client profiles
1. On email send and on email receive (poll Gmail every N minutes), match email addresses to candidates and clients in Neon
2. Surface matched threads on the candidate's profile (new tab or activity panel)
3. Surface matched threads on the client's profile and on each contact card
4. Bidirectional: emails sent FROM popup composer auto-tag to the profile they were sent from

### Interview Scheduling Overhaul (Prompts 9-13, larger work)

Replaced spec (2026-04-26):

#### Prompt 9 - Interview Scheduler Form UI (revised)

- Interview Type: Phone, Video, In-Person only
- Timezone selector — MANDATORY, currently missing entirely
- Interviewers multi-select with inline add-new-contact button
- Calendar Location / Instructions field (required)
- Smart subject line generation with Settings toggle. Uses template subject if template exists, otherwise generates from context.
- Rich text editor for client and candidate emails, pre-populated from Interview Confirmation templates, fully editable
- REWORK existing "Client Sending Invite Directly" button: when clicked opens a form to pick interviewer, date, time. Adds to Andrew's calendar only. No emails sent. For pipeline tracking only.

KILLED items (do not build):
- Anonymize attachment checkbox
- Notes for Client / Notes for Candidate fields
- Send email separate from calendar invite checkboxes
- Recruiter Selector / Split with Recruiter

#### Prompt 10 - Schedule Interview submission flow

On Schedule Interview button click:
1. Validate all required fields. If any missing, highlight field in red and scroll to it.
2. Create interview record in Neon: candidate_id, job_id, client_id, interview_type, start_time, end_time, timezone, interviewers (array), location_instructions, notes_client, notes_candidate, subject_client, subject_candidate, body_client, body_candidate, attachment_id, anonymize_attachment, recruiter_id, split_recruiter_id, client_will_manage_candidate_email, status="scheduled"
3. Send dual Google Calendar invites with Meet link (existing flow, already working in 17.0 - reuse)
4. Send candidate email (unless "Client will manage" checked) with attached resume
5. Send client email with attached resume + Notes for Client included in body
6. Move candidate-job pairing to "Interview Scheduled" stage in pipeline
7. Trigger any "On Interview Scheduled" stage actions registered in stage_action_templates table
8. Toast confirmation: "Interview scheduled. Calendar invites sent to {{interviewers}} and {{candidate.full_name}}."

#### Prompt 11 - Stage-Triggered Template Actions System

Each pipeline stage gets a set of pre-built action buttons that fire templated emails. User can click these from the candidate profile or pipeline view.

Stage → Action Button → Template mapping:
- Submitted → "Send Submission Confirmation" → Submittal Confirmation template (5B output)
- Submitted → "Follow Up" → Follow Up Submission template (build new)
- Interview Scheduled → "Send Interview Prep" → Interview Prep template (build new, includes interview tips, company links, prep checklist)
- Interview Scheduled → "Send Reminder" → Day-Before Reminder template (build new)
- Interview Scheduled → "Reschedule" → Reschedule Request template (build new)
- Interviewed → "Send Thank You Note" → Post-Interview Thank You (candidate-side, build new)
- Interviewed → "Request Feedback from Client" → Feedback Request (client-side, build new)
- Offer Extended → "Send Offer Details" → Offer Details template (build new)
- Offer Extended → "Resignation Letter Template" → Resignation Helper (build new)
- Offer Accepted → "Send Acceptance Confirmation to Client" → Acceptance Confirmation (5B output)
- Offer Accepted → "Send Onboarding Prep to Candidate" → Onboarding Prep (build new)
- Hired → "Send Welcome Note" → Welcome (build new)
- Hired → "Send 30-Day Check-In" → 30-Day Check-In (build new)
- Hired → "Send 90-Day Check-In" → 90-Day Check-In (build new)

Each action button:
- Pulls template from user's template library by name
- Auto-loads candidate + job + client + interview context (if relevant)
- Opens popup composer with To/Subject/Body pre-populated
- User reviews, edits, sends with one click

Mapping stored in stage_action_templates Neon table so user can change which template fires on which action without code changes.

Action buttons render on candidate profile in a horizontal row below the tabs, contextual to current stage.

#### Prompt 12 - Candidate Profile Layout Reorganization

Revised scope (2026-04-26):

- Match % column on Applied Jobs table, color-coded (90%+ green, 70-89% yellow, <70% red).
- Three-column layout:
  - Left sidebar: contact, comp, employer, work auth, education, recruiter notes with stage indicator and skip-outreach toggle.
  - Center 60% resume preview.
  - Right sidebar: pipeline state, contextual data.

KILLED:
- Top tabs (Profile / Notes / History / Skills & Answers / Splits) — keep current layout.
- Header candidate-job notation ("Christopher Boyle ↔ Tax Associate").
- Co-recruiter splits.

#### Prompt 13 - Template Library Enhancements

Revised scope (2026-04-26):

- Stage tag on each template
- Default attachments per template as optional setting
- Templates can reference {{interview.*}} merge fields when associated with interview-related stages: interview.type, interview.date, interview.start_time, interview.end_time, interview.timezone, interview.location, interview.interviewers, interview.meet_link

KILLED:
- Side tag (candidate-facing vs client-facing)

### Reference visual context
Andrew uploaded screenshots from a Jobot/Jax recruiting database during Ace 17.0 chat as visual reference. Key patterns to replicate:
- Modal forms with drag handles and structured field rows
- "Editing Not Ready: Choose one or more Contacts" placeholder pattern when prerequisites aren't met
- Two-column email body editors (one for client, one for candidate) with toolbar above each
- Word counts in bottom-right of rich text editors
- Pipeline action buttons rendered as a horizontal row of pill buttons
- Match percentage badges color-coded
- Resume preview in center column with dropdown selector for multiple resumes
- Compact left sidebar with candidate metadata
- Skip Outreach toggle on candidates with stage indicators

### Future (post-18.0) backlog
- MPC candidate features
- Daily industry briefing
- Closing sheet templates with call transcription auto-fill (Krispcall, Google Meet, Teams)
- Activity-to-revenue analytics
- Slack integration
- LinkedIn Chrome extension
- Job board aggregator integration
- QuickBooks integration
- DocuSign auto-import
- Google Drive backup to "ACE Database" shared drive with Austin
- Dark mode
- PWA conversion (mobile)
- Remote shipping from mobile (voice/text → background Claude Code agent)
- Market Insights tab
- Client Strategy tab (Claude chat workspace per client)
- Cosmetic polish batch: Generate with Claude button visibility on Clay Court dark mode (currently invisible), plus any other visual polish surfaced during 18.0 testing. Bundle with Week 4 UX Polish Batch.

## Recovered Backlog (audit 2026-04-25)

### Week 2

- BD Automation Engine (full vision): Daily 6 AM cron. Step 1 (Indeed API): scan last-24hr jobs, filter for public accounting firms by company name (CPA/Associates/Partners/Accounting/Advisory/Group) OR JD signals (audit/tax/public accounting). Discard staffing agencies and corporate in-house. Output 20 companies/day. Step 2 (Apollo API): one best contact per company - Managing Partner, Tax Partner, Controller, CFO, or HR Director. Step 3: Write each prospect to Ace's Prospect table with company, contact, title, email, LinkedIn, triggering job posting. Step 4: Auto-enroll in email sequence using warmed burner domains. All sending and tracking in Ace, not Apollo. BD Settings screen for keywords/titles/limit/sequence. BD feed showing overnight additions and sequence status. Apollo is data source only. Replaces Andrew's manual BD flow.
- Word of the Day - Vercel Cron 6 AM EST same as Daily Industry Briefing.
- Market Insights Tab - Tab 6 on client detail. Generate market briefs inline. Save brief history per client. Pick recipients from contacts. Compose/auto-generate email, attach PDF, send from Ace. Same design as the market-brief skill.
- Game Plan Web Search "Find Matches" button - candidate page queries Indeed/ZipRecruiter/SimplyHired/career pages, client/job page queries Neon candidates.
- Cosmetic polish pass: billing tower, h1 contrast Clay/Grass, counter subtext removal, replace "Welcome back, Andrew" with "Activity Dashboard", remove INTERNAL OPS header, fix footer location.
- Mail composer Generate-from-prompt input box: small input at top of composer. User types a prompt like "email Linda a summary of highlights regarding this company". Click Generate. Claude writes the email body. Context Claude gets: candidate/client name from open profile, recent thread history if reply, signature stays intact. Originally bundled in Prompt 2C with templates+merge-fields - templates and merge fields shipped, this Generate input was either skipped or never surfaced. Verify or rebuild as ~10 min task.

### Week 3

- JD auto-generate Claude button on job page.
- Resume parser improvements (5-10 test resumes to tune).
- Quo auto-transcription webhook (call.transcript.completed, save transcript + Claude summary).
- Boolean candidate search - skills/location/title/employer/education with AND/OR/NOT.
- MPC (Most Placeable Candidates) feature.
- Sentry N+1 fixes: ACE-CRM-5 (37 events), ACE-CRM-6 (28 events), ACE-CRM-7 (2 events), ACE-CRM-9 (1 event), ACE-CRM-A (1 event). Plus one Hydration Error. Fix via Prisma include eager-loading.

### Week 4

- Night Court mode (4th theme).
- BP circle icon + Ace logo + favicon + footer cleanup. **(favicon SHIPPED 22.0; Ace logo + footer cleanup remain.)**
- YouTube floating player.
- DocuSign auto-import.
- Invoicing workflow with Slack-to-Austin trigger on confirmed start.
- Slack integration sidebar panel.
- PWA conversion - manifest, service worker, push notifications.
- Activity-to-Revenue Analytics.
- Job Order + ARPO templates with call transcription auto-fill.
- Demo mode (sandbox toggle).
- UX polish batch (15 items per audit canvas).

### Candidate Profile Redesign (Jobot-style)

- Tabs at top: Profile, Notes, History, Skills & Answers, Splits.
- Applied Jobs table near top (Client / Job / Compensation / Match% / Action buttons).
- Stage action buttons row directly below tabs.
- Resume display dropdown showing all uploaded resumes with timestamps.
- Cloud upload icon, three-dot menu (Brand, Anonymize, Delete, Download).
- Left sidebar: Contact, expected comp, current employer, work auth, education, Recruiter Notes with stage indicator + skip-outreach toggle.
- Resume preview center 60%.
- Right sidebar: contextual data.
- Stage-Triggered Action Buttons: Move to Offer Stage, Reject (with reason dropdown), Schedule Interview, Keep, Apply to Job, Add Note, Edit PDF Again.

### Interview Scheduler Redesign

17 fields from Ace 17 chat.

### Template Library Enhancements

Stage tag, side tag (candidate-facing vs client-facing), bracket+merge syntax, attachment defaults.

### Infrastructure

- CandidateResume audit + migrate file bytes from Postgres to Vercel Blob.
- Background job queue (Job table + Vercel Cron) for any operation over 60 seconds.
- Postgres tsvector + GIN indexes for fast Boolean search as DB grows.
- ZDR (Anthropic Zero Data Retention) request on Andrew's API key.

### BD Sequencing

- Scheduled email send - Gmail API supports send-at timestamp. Build as prerequisite to BD sequence engine. User picks date/time in composer, Gmail holds and sends at that time.

### Communications / Webhooks

- Ringover/Quo in-app notifications - webhook on incoming call and SMS. Same sonner toast style as email notifications. Caller name/number for calls, message preview for texts. Build alongside call transcription webhook work already on roadmap.

### Phase 5 Carry List

- Copy sweep (17 RecruiterFlow user-visible strings).
- Compound-unique widening (3 Placement compound uniques don't include organizationId).
- SmsMessage / CallLog / CallTranscript / AiWorkspaceMessage tenant-scoping.
- Manual Andrew actions: delete RECRUITERFLOW_API_KEY from .env.local and GitHub Actions secrets, delete src/lib/recruiterflow/ entirely.

### Removed From Roadmap (productization deferred indefinitely)

- Help Docs Corpus (Architecture Non-Negotiable #10 relaxed).
- Per-org color theming.
- Ask Claude in-app support panel.
- BYOC, CustomerRequest table, Stripe billing, marketing site, trademark, legal review, code escrow, public REST API, MCP server v1, custom fields UI, hierarchical RBAC, demo accounts, external SSO, SOC 2.

## Proprietary Differentiators (approved Ace 16.0)

- **Live placement probability score**: 1-100 score per pipeline candidate, updated real-time based on response time, interview progression, comp alignment, time-in-stage. Color-coded red/yellow/green. Visible on pipeline view and candidate profile.
- **Counteroffer risk flag**: at offer stage, pulls tenure, comp jump %, employer size, flags high counteroffer risk automatically. Visible on candidate profile and offer-stage pipeline.
- **Client heat map**: visual showing clients active / going cold / overdue for touchpoint based on last activity. Red/yellow/green. Lives on dashboard or `/clients/heat-map`.
- **Candidate re-engagement engine**: flags candidates placed or went cold 12-18 months ago who are statistically likely open to a move. Auto-drafts re-engagement email for Andrew's review before send.
- **Fee tracker with Austin auto-notify**: confirmed-start placement calculates gross fee, Andrew 75% cut, Austin 25%, Slacks Austin (`U0AJB4AM631`) the breakdown when start date confirmed. Triggers off `placement_confirmed` ActivityLog event.

## Practical Differentiators (approved Ace 16.0)

- **One-click interview prep packet**: PDF for candidate with company background, role summary, likely interview questions, Andrew's coaching notes. Separate button after interview scheduled. COEXISTS with standard rich text editor on scheduler.
- **Submittal tracker with read receipts**: tracks whether client opened submittal email and how many times. Shows "opened 3x, no reply" on candidate profile or pipeline. CRITICAL: read tracking must be invisible to client. If implementation would notify recipient, kill the feature.
- **BD trigger alerts**: monitors LinkedIn and Indeed for job postings from existing clients. Alerts Andrew when existing client posts a new role he hasn't been engaged on. Catches BD opportunities before competing recruiters.

## Explicitly Killed - Do Not Build

- Stage-Triggered Template Actions System (Claude proposed, Andrew did not request).
- AI Agent features (auto-suggestions, approve/dismiss, next-best-action).
- Candidate mood tracker.
- Help Docs Corpus.
- Per-org color theming.
- Demo mode / sandbox toggle.
- ZDR (Zero Data Retention).
- MCP Connection (Claude reads/writes Ace database).
- Co-recruiter splits feature.
