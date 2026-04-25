# Ace Roadmap

## Ace 18.0 - Composer UX + Templates + Mail Tab Polish + Interview Scheduling Overhaul

Picks up the 13 backlog items from Ace 17.0 plus the Interview Scheduling Overhaul. Estimated 8-10 atomic prompts.

### Order of Execution (prompts numbered)

#### Prompt 5A - Composer UX overhaul (resumes Ace 17.0 work)
1. Stop closing modal on backdrop click. Only X button closes.
2. Drag and resize popup composer (Gmail-style). User can drag the title bar to reposition, drag corners to resize.
3. Minimize button + bottom-of-screen tray. Minimized drafts show as small horizontal pills at the bottom of the Ace viewport. Click to restore. Multiple drafts can be minimized simultaneously.
4. Dual-format merge field parser. Both [Bracket Format] and {{double.curly}} syntaxes resolve to the same data. Existing field map covers both forms. Insert Field dropdown defaults to inserting {{}} but parser handles both for backward compatibility with RF-imported templates.
5. Smart context resolution. When popup opens from a candidate profile: if candidate has 1 active applied job, auto-load that job + its client as context. If 2+, show a small "Which job is this email about?" dropdown above the composer body. User picks, context loads, all merge fields resolve.

#### Prompt 5A.3 - Candidate page pagination + Clay Court dark mode polish
1. /candidates page paginates at 25 candidates per page. Add page controls (prev/next/jump-to-page) at the bottom. Default sort preserved. Search and filter still work across full dataset, paginate the results.
2. Fix Generate with Claude button visibility on Clay Court dark mode. Currently invisible / blends into background. Use Court Mode token that has correct contrast on dark theme.
3. (Reserved for one related UI polish item to be defined when 5A.3 ships.)

#### Prompt 5A.4 - Lists feature
1. New Neon tables: candidate_list (id, organizationId, name, createdAt, createdBy) and candidate_list_membership (id, listId, candidateId, addedAt). Both scoped by organizationId.
2. Add "Add to List" button on candidate profile. Click opens popup composer with two options: "Create new list" (text input + Save) or "Add to existing list" (dropdown of lists for current user's org). Multi-select allowed - candidate can be on multiple lists at once.
3. /candidates page top search bar gets a "Lists" filter dropdown alongside existing search. Pick a list, candidates filter to only members of that list. "All candidates" option clears the filter. Lists dropdown sorted alphabetically.
4. Lists management: small page at /candidates/lists for renaming, deleting lists. Deleting a list removes the membership rows but does NOT delete the candidates.
5. All queries scope by organizationId (Rule 8).

#### Prompt 5B - Rebuild 3 core templates in {{}} format
1. Submittal Confirmation to Candidate ("Great News - You've Been Submitted!")
2. Application Received (matches the screenshot Andrew sent: "Hi {{candidate.first_name}}, I received your application to the {{job.title}} position you applied for in {{job.city}}, {{job.state}}. This is with {{client.name}}. What salary are you targeting? How is the commute for you to {{job.city}}? Why are you open to new opportunities at this time and what are you looking for in your next role?")
3. Acceptance of Offer (subject "Acceptance of Offer - {{candidate.full_name}} - {{client.name}}")

Each template tagged with side (candidate-facing vs client-facing) and stage (which pipeline stage this fires from).

#### Prompt 6 - CC/BCC autocomplete + Sticky sidebar
1. CC dropdown autocompletes with other contacts at the same client org as the To recipient
2. BCC dropdown autocompletes with teammates from Andrew's org (Austin Barnard for now)
3. Sticky sidebar across all routes - sidebar position fixed, Settings tab always visible regardless of page scroll length

#### Prompt 7 - Mail Tab polish + bidirectional read sync
1. Fix logo + signature contact icons rendering inside Ace's /mail thread view (currently shows broken image boxes - works fine in real Gmail received messages)
2. Open thread in Ace → Gmail marks read on Google's side via gmail.modify removeLabel: UNREAD
3. Unread count badge on Mail sidebar item, updates in real-time
4. Browser notification when new email arrives (with permission prompt)
5. Replace Archive button with "Move To" label dropdown. Reads user's Gmail labels via API, presents as searchable dropdown. Click a label → applies label + removes INBOX. Same workflow Andrew uses manually in Gmail today.
6. Re-audit ENOENT for logo on serverless to confirm all signature render paths use base64 import.

#### Prompt 8 - Auto-tagging emails to candidate/client profiles
1. On email send and on email receive (poll Gmail every N minutes), match email addresses to candidates and clients in Neon
2. Surface matched threads on the candidate's profile (new tab or activity panel)
3. Surface matched threads on the client's profile and on each contact card
4. Bidirectional: emails sent FROM popup composer auto-tag to the profile they were sent from

### Interview Scheduling Overhaul (Prompts 9-13, larger work)

This is the biggest piece of 18.0. Andrew showed Jobot/Jax interface screenshots during 17.0 chat as the visual reference. Detailed spec below replaces the need for those screenshots.

#### Prompt 9 - Interview Scheduler Form UI

Replace current basic interview scheduling with a structured form. When user clicks "Schedule Interview" on a candidate-job pairing, open a modal with these fields, in this order:

1. Header: "{{candidate.full_name}} for {{job.title}} at {{client.name}}" - Drag handle and X close button on right
2. Interview Type (dropdown, required): Phone Interview, Video Interview, On-site Interview, Final Interview, Other
3. Date and Time row:
   - Date picker (required)
   - Start time dropdown (required, 15-min intervals)
   - End time dropdown (required, 15-min intervals)
   - Timezone selector (required, default to user's timezone, options: ET, CT, MT, PT)
4. Interviewers (required):
   - Multi-select Contact Name dropdown of contacts from the candidate-job's client organization
   - Plus button to add a new contact inline if not in list
   - Add CC and Add BCC toggles below the interviewers field for the eventual client email
5. Attachment row:
   - Dropdown lists candidate's resumes (most recent first, format: "{{candidate.full_name}} - {{source}}.pdf (X days ago; date)")
   - Defaults to most recent watermarked resume
   - Cloud download icon to upload a different file
   - "Will be attached as: {{candidate.full_name}}-{{source}}.pdf" preview text
   - Anonymize attachment checkbox - on check, runs the resume through the watermark/branding logic to remove candidate contact info before attaching
6. Calendar Location / Instructions (text field, required) - examples: "Call Christopher Boyle at (480) 735-9606" or "Zoom link will be sent"
7. Notes for Client (textarea, optional) - private notes that go in the client email only
8. Subject for Client (text, required, smart default: "{{interview.type}} - {{candidate.full_name}} - {{job.title}} - (Details Within)")
9. Email to Client (rich text editor with toolbar B/I/U/lists/link/undo/redo, pre-populated from "Interview Confirmation - Client" template, fully editable, shows word count in bottom right)
10. "Send the email separate from calendar invite (2 emails) to client" checkbox
11. Notes for Candidate (textarea, optional) - private notes that go in the candidate email only
12. Subject for Candidate (text, required, smart default: "{{interview.type}} - {{client.name}} - (Details Within)")
13. Email to Candidate (rich text editor, pre-populated from "Interview Confirmation - Candidate" template, fully editable, word count)
14. "Send the email separate from calendar invite (2 emails) to candidate" checkbox
15. Recruiter selector (dropdown, defaults to current user) - "Split Bot Point With Recruiter" - lets user assign a co-recruiter on this interview for credit splits
16. "Client will manage emailing candidates" checkbox with helper text: "If checked, Ace will not send emails to client and candidate." Suppresses candidate-side email and calendar invite when checked.
17. Footer: User signature preview, "Schedule Interview" button (primary, green)

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

Reorganize candidate profile to match the Jobot-style screen layout Andrew referenced:

- Top tabs row: Profile (default), Notes, History, Skills & Answers, Splits for Matching Jobs
- Header above tabs: "{{candidate.full_name}}" left, current title and "↔" symbol with applied job title right (e.g. "Christopher Boyle ↔ Tax Associate")
- Applied Jobs table directly under header, columns: checkbox, Client, Job (with location and miles distance from candidate), Compensation, Match % (color-coded: 90%+ green, 70-89% yellow, <70% red), Action buttons inline (Schedule Interview, Reject)
- Stage action buttons row directly under Applied Jobs: contextual based on current pipeline stage. Examples: Move to Offer Stage (with dropdown caret), Reject (with reason dropdown), Schedule Interview, Keep, Apply to Job, Add Note, Edit PDF Again
- Resume display row: dropdown showing all uploaded resumes with timestamps ("Christopher Boyle - Jobot.pdf (1 day ago; Apr 24th)"), cloud upload icon for new resume, three-dot menu (Brand, Anonymize, Delete, Download)
- Main center column (60% width): Resume PDF preview rendered inline
- Left sidebar (20% width): Candidate name, current title with home icon and city link, email, phone, contact icons row (LinkedIn, profile pic, phone), Text Message input box at bottom of contact section, Expected Compensation, Current Employer, Work Auth, Education with school link, Recruiter Notes section with stage indicator and "Skip Outreach" toggle
- Right sidebar (20% width): contextual data - current pipeline state, next suggested action, recent activity timeline, related jobs with match scores

#### Prompt 13 - Template Library Enhancements

- Templates table gets new columns: stage (string, nullable), side (enum: candidate, client, both), default_attachments (json array of attachment templates)
- Settings > Templates page: list view shows all templates with stage tag, side tag, last modified
- Template editor: stage dropdown, side dropdown, attachment defaults section, body editor with merge field picker (uses Insert Field UI from composer)
- Templates can reference {{interview.*}} merge fields when associated with interview-related stages: interview.type, interview.date, interview.start_time, interview.end_time, interview.timezone, interview.location, interview.interviewers, interview.meet_link

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
