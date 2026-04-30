# Ace Roadmap

## In Progress / Needs Fix (top priority — Ace 28.0 candidate)

All six Ace 26.0 carry-overs closed in Ace 27.0. Phase 1 (web search across all 5 Claude API call sites) shipped 2026-04-30. Open issues for 28.0:

- (none open — Phase 1 shipped clean)

## Ace 28.0 — Next up (Game Plan phases — Week 2 active work)

Game Plan is the active workstream. Phase 1 shipped 2026-04-30; remaining sequence ships in order:

1. **Phase 1 [SHIPPED 2026-04-30]** - Web search tool added to all 5 Claude API call sites: ai-workspace, mail/ai-compose, email/edit-with-claude, calls/summary, clients/new. Claude auto-searches when the prompt requires it. Folded in the old standalone "Phase 3 - web search on Game Plan + internal blend" since web search now lives across the whole app, not just Game Plan.
2. **Phase 2** - Find Matches button on the job + client Game Plan surfaces. Queries Neon's candidate database; surfaces top fits by title, skills, location, comp.
3. **Phase 3** - Feed last 5 tagged emails from candidate / client into the Game Plan prompt as context.
4. **Phase 4** - "My Writing Style" setting. New field in /settings, injected into every Claude API call across Ace (submittals, JDs, email generation, Game Plan).
5. **Phase 5** - Sidebar Claude panel - persistent chat inside Ace with web search + full Ace data access.
6. **Game Plan context depth** - Send full resume text + full JD text into the ai-workspace prompt so Claude reasons against the actual content, not just metadata.

Phase 2 is the immediate next ship. Phases 4 + 5 fold in / replace the older standalone "Ace Assistant Tab" + "Game Plan — Full DB + Web Access" Week 2 entries below.

## Completed - Ace 28.0 day 1 (April 30, 2026)

All shipped 2026-04-30. See `docs/ace/ACE_STATE.md` for the full per-item log.

- **Game Plan Phase 1 - Web search rolled out to all 5 Claude API call sites**: ai-workspace/route.ts, mail/ai-compose/route.ts, email/edit-with-claude/route.ts, calls/summary/route.ts, clients/new/actions.ts. web_search_20250305 tool registered everywhere; multi-block response handling fixed in ai-workspace (was reading content[0] only, now walks the full block list); max_tokens lifted to 4096; markdown formatting instructions added to system prompt.
- react-markdown + remark-gfm installed; Game Plan chat bubbles render clickable hyperlinks. CopyButton flattens markdown links to bare URLs for SMS / iMessage paste.
- Model id normalized to claude-sonnet-4-6 codebase-wide.
- **Quo auto-transcription**: call.transcript.completed and call.summary.completed webhook branches added. Patched to real Quo v3 payload shape (callId at body.object.data.object.callId, transcript is dialogue array, summary is string array). Dialogue formatted as `M:SS [identifier]: [content]` per line; summary formatted as bullet lines + Next Steps section.
- **Call Log UI rebuild**: inline expand-on-click replaces Paste Transcript / Generate Summary buttons. TRANSCRIPT pill on collapsed row when data exists; truncates to 3 most recent + "Show all N calls". Client profile now shows CallLogs above the activity feed. Generate Summary button removed (Quo handles it).
- **Generate Resume button** on candidate profiles with no resume on file: pulls profile data, sends to Claude, renders a professional PDF via react-pdf/renderer, saves as a CandidateResume row with displayName "AI Generated".

## Completed - Ace 27.0 (April 28, 2026)

All shipped 2026-04-28. See `docs/ace/ACE_STATE.md` for the full per-item log.

- Toast fixes (MessageSquare → Phone, dropped "· Text" label, Reply button contrast lifted across themes), Compose FAB hidden on /settings, ALL CAPS subtitle leak fixed, Settings Appearance two-column layout — all six 26.0 carry-overs closed.
- Mail thread HTML rendering fix — sanitizer now preserves email-layout style attrs + table cell attrs; allowedStyles whitelists a layout-only subset; img.onerror handlers collapse failed remote images so broken CDN banners stop reserving empty rectangles.
- /mail full revamp — three-pane CSS-grid + drag handles + width persistence (ace-mail-column-widths); AppShell sidebar drag-resize + persistence (ace-sidebar-width); Inbox card slimmed; label list spacing + font weight bumped; synthetic parent labels match real labels' weight; "Communications" header renamed to "Inbox"; page-header "Compose new email" button matches /jobs / /candidates / /clients style; sidebar/content gap tightened across the app.
- Multi-message thread dropdown + per-message Reply / Reply All / Forward buttons. Composer state resets on detail.id change.
- Gmail label creation from Ace — standalone "+ New label" entry in labels sidebar AND "New label…" inside Move To dropdown. Both sync via /api/mail/labels (gmail.modify scope).
- CC + BCC fixes — removed the "+ Contact" picker that was overlaying CC + Subject rows and eating clicks; typeahead now folds in pickerOptions.
- /phone full revamp — dial pad replaces empty state (clickable + keyboard input, US-formatted display, Call + Text dispatch); FAB phone search offers an "ad-hoc number" row when ≥7 typed digits don't match a saved contact; notes person-search rebuilt (multi-token AND across firstName / lastName / email / phone); Quick Note placeholder reworded to "Search in Ace".
- TopBar avatar contact-card dropdown (email / work number / LinkedIn URL with copy buttons); standalone name + email block + sign-out button removed.
- Candidate page UX sweep, Job page additional polish, Client page FAB prefill fix, Experience auto-summary, DOCX resume preview.
- Design system rebuild + branding refresh.
- Stage tag on templates; merged bracket + double-curly merge field styles; city / state comma formatting fix; dead Anthropic model id replaced with claude-sonnet-4-6.
- **Night Court mode** — fourth Court Mode; charcoal surface, brand green as accent only; Settings picker rebuilt as card grid with two-tone swatches and accent dot on Night.
- **Favicon + brand mark revamp** — Serve Arc lockup; full favicon set; Playfair 22px wordmark with italic "by BreakPoint Talent" subline that recolors per surface (lifted on grass for legibility).
- Sidebar bottom-left "BreakPoint Talent / Solon, OH · Est. 2026" footer removed.
- Dashboard left padding fixed (dropped legacy -mx-2 / md:-mx-4 so it inherits the same gutter as every other page).

## Completed - Ace 26.0 (April 28, 2026)

All shipped 2026-04-28. See docs/ace/ACE_STATE.md for the full per-item log.

- canonicalStage root cause fix: client card counters for pending_start and cancelled now read Neon Placement.stage instead of leaking through RF stage_name.
- Stage chip label leak fixed: RF JobActionRow no longer renders RF payload's stage_name in the StageBadge label; label derives off Placement.stage.
- Clickable job counter pills on client detail — each per-stage pill is a Link to /pipeline filtered by client + stage.
- Email Threads raw ID section removed from client detail (matches the same removal on candidate profiles in 25.0).
- Reject button restored on candidate profile job rows (Submitted / Interviewing / Offer / Pending Start).
- Reject button added to /pipeline view rows for Submitted + Interviewing stages.
- Schedule Interview button on Submitted pipeline rows.
- Offer button on Interviewing pipeline rows.
- Clients page full redesign: ClientLogo, PipelinePill, grid-vs-list toggle, per-client stage counters, sort + filter row.
- Unnamed RF stub client deleted (legacyRfId 24).
- Phone Tab Phase 3:
  - Auto-tagging on every inbound + outbound SMS / call — matches against Candidate.phone (last 10 digits) AND Contact.phoneNumbers; SmsMessage.candidateId / CallLog.candidateId / clientId stamped on the write path.
  - Open Profile button on /phone thread header navigates to the matched candidate or client.
  - Read tracking via SmsMessage.isRead — sidebar Phone unread badge + thread-list "Needs reply" count both read this field.
  - Global header search expanded to email + phone in addition to name.
- Notification toast redesign: Subtle / Tint / Ink styles, court-token bound, shared ActionChip + DismissBtn components.
- Settings notifications section: NotifStylePicker with three style cards, Try-it buttons that emit a sample toast, Quiet hours toggle. localStorage-backed so the picker takes effect on the next toast.
- CLAUDE.md created at repo root — permanent project-brain rules file, auto-loaded every Code session.
- Calendar Tab added to Week 3 roadmap (see Week 3 section below).
- Jobs page: salary range column + condensed Apply-to-Job dropdown (shipped mid-session).

## Completed - Ace 25.0 (Candidate profile redesign + Quo SMS fixes)

All shipped 2026-04-27. See docs/ace/ACE_STATE.md for the full per-item log.

- Quo SMS: dead krispcall.ts deleted, webhook moved to /api/quo/webhook (provider URL must be updated), error message updated, SmsMessage candidateId fix + 2-row backfill
- Quo deep link: GET /api/quo/conversation route + "Quo" button on SMS composer and Phone tab thread header
- Candidate profile full redesign across both RF and Ace-native paths: avatar header with three actions (Add to List + Apply + Submit), two-column main (resume left + Contact/Activity/Employment sidebar), Profile + Game Plan underline tabs, Skills/Experience/Education/Notes accordions, sidebar Activity card with Email/Call/Text sub-tabs replacing the old Activity top-level tab
- Pipeline rows: compact divide-y list inside a single rounded card, briefcase + title + · company + StageBadge on the left, actions on the right, ~36px row height
- Stage chip colors unified across /pipeline + candidate profile + Ace local rows via stage-badge.tsx single source of truth (Submitted=emerald, Interviewing=blue, Applied=amber, Sourced=neutral, Offer/PendingStart=purple, Hired=darker emerald, Rejected/Cancelled=red, Kept=amber-100)
- Header Apply/Submit on Ace wired via ?openApply=1 / ?openSubmit=1 URL deep-links into LocalCandidateActions (new hideButtons prop suppresses the legacy standalone button row while modals stay mounted)
- TextingExchanges: 256px scroll cap with auto-scroll to latest
- Email Threads raw-id list removed (TODO until auto-tagging surfaces subject + preview)

## Ace 24.0 — Phone Tab build (Phase 1 + 2 SHIPPED)

### Phase 1 - Foundation [SHIPPED]
1. New /phone page in the main nav. Two-pane layout similar to /mail. — SHIPPED
2. Call log pulled from Quo (formerly Krispcall) - timestamp, direction, candidate/client match, duration, status. — SHIPPED
3. SMS threads from Quo - one thread per phone number, message history, ordered by most recent activity. — SHIPPED
4. Match every call + SMS thread to a Candidate or Contact by phone number lookup. Unmatched ones surface in an "Unknown" bucket. — SHIPPED in 26.0 (auto-tagging on the write path).
5. Read paths only in Phase 1 - no inbound notifications or reply UI yet. — SHIPPED

### Phase 2 - Inbound notifications + click-to-call [SHIPPED]
1. New Text + Call panels triggered from FAB; POST /api/sms wired through. — SHIPPED
2. Schema migration adding organizationId + clientId to SmsMessage / CallLog. — SHIPPED
3. Click-to-call entry points exist on candidate profile + Phone tab. Outbound call API wiring is Phase 3 (current placeCall toasts a "coming soon" placeholder).

### Phase 3 - Auto-tagging, read tracking, search, toasts [SHIPPED 26.0]

All four items shipped:
1. Auto-tagging — write-path stamps candidateId / clientId on every inbound + outbound SMS / call. Open Profile button on /phone thread header navigates to the match.
2. Read tracking via SmsMessage.isRead. Sidebar Phone unread badge + thread-list "Needs reply" count both read this field.
3. Incoming SMS toast (Subtle / Tint / Ink chrome). Incoming call toast still TBD — see "In Progress / Needs Fix" at top.
4. Global header search expanded to email + phone in addition to name (lighter-weight than the dedicated /phone search box originally specced; full-text search on body remains backlog).

## Future — Multi-recruiter permissions

Originally slotted as Ace 25.0 but deferred. Carry these items forward.

1. Schema additions: ownerId on Client and Job (nullable, FK to User). Existing rows backfilled to Andrew. Permission rules: a recruiter sees clients/jobs they own + any explicitly shared with them.
2. Shared candidates - many-to-many join (CandidateAccessGrant?) so candidates can be shared across recruiters without duplicating rows. Grant types: read, edit.
3. Invite flow in /settings - "Invite recruiter" form: email + name + role (admin / recruiter). Sends a magic-link sign-up email; new user lands in BreakPoint Talent org with role=member. Reuses existing OrganizationMembership table.
4. Settings → "Manage team" page - list of org members, role chips, "Resend invite" / "Revoke access" buttons.
5. Per-row permission checks on every server action that reads or writes Client / Job / Candidate when ownerId or share grant doesn't match the current user.

## Completed - Ace 23.0 (Mail Tab batch)

All five items from the original 23.0 plan shipped. See docs/ace/ACE_STATE.md for the full list with implementation notes.

1. Auto-tagging emails to candidate/client profiles - SHIPPED (GmailThreadTag table, tagThreadByAddresses on send + read, Email Threads card on Ace-native AND RF-imported candidate paths + Client overview).
2. BCC Austin auto-populate - SHIPPED (BCC autocomplete dropdown sourced from OrganizationMembership, Austin row inserted directly to Neon).
3. Click-to-add dropdown bug - SHIPPED (moved pick() from onClick to onMouseDown.preventDefault, single-click selection lands cleanly).
4. Mail tab sent view - SHIPPED (Sent + Drafts shortcuts in the new sidebar; both feed the same thread refetch with labelIds=SENT or =DRAFT).
5. Sent emails appearing in candidate/client activity - SHIPPED (auto-tag fires on send/reply too; Email Threads card surfaces them on the relevant profile).

Bonus 23.0 ships not on the original list:
- Mail sidebar redesign (premium Inbox card, nested labels, search, refresh, drag-and-drop)
- Pop-out floating thread window (drag, resize, full reply/archive/move support)
- Tennis ball "Ace" favicon + brand mark
- Global Compose FAB with non-blocking mode
- Mail toast auto-dismisses when the user opens the thread
- Compact uniform notifications with Phone icon for SMS/call

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

#### Prompt 7 - Mail Tab polish + bidirectional read sync [SHIPPED 22.0 + 23.0]

SHIPPED 22.0:
- Open thread marks read in Gmail (removeLabel UNREAD)
- Unread count badge on Mail sidebar
- Browser tab title with unread count (live via MailContext)
- Move To label dropdown (Archive kept, Move To additive)
- Logo + signature contact icons CID render fix
- Favicon (pulled forward from Week 4)

SHIPPED 23.0:
- BCC autocomplete with org members (Austin Barnard surfaces on focus)
- Click-to-add dropdown bug fix (single-click selection now lands cleanly)
- Mail toast auto-dismisses when the matching thread is opened

REMAINING (low priority):
- Re-audit ENOENT logo on serverless

#### Prompt 8 - Auto-tagging emails to candidate/client profiles [SHIPPED 23.0]

All four items shipped:
1. Auto-tag fires on every thread open AND every send/reply via tagThreadByAddresses (src/lib/gmail.ts). Address match is case-insensitive substring against Candidate.email and Contact.emails (orgId-scoped).
2. Email Threads card on candidate profiles (BOTH Ace-native LocalCandidateProfile AND RF-imported page.tsx).
3. Email Threads card on client overview tab (separate gmailTags fetch in the page-level Promise.all, scoped by clientId + organizationId).
4. Bidirectional confirmed - sends from the FAB / Reply / candidate-popup composers all run through the same auto-tag write path.

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

#### Prompt 11 - Stage-Triggered Template Actions System [KILLED]

Killed. See "Explicitly Killed - Do Not Build" at the bottom of this file. Do not build.

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
- **Calendar page** — dedicated /calendar surface (month / week / day views, Google Calendar read-write sync, create-meeting modal). Promoted out of Week 3 into a standalone backlog entry per Ace 27.0 close.
- **Job page full revamp** — deeper redesign beyond the salary-range column + condensed Apply-to-Job dropdown shipped 26.0 / 27.0. Scope TBD.
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

## Recovered Backlog (audit 2026-04-25, refreshed end of Ace 27.0)

### Week 2 (remaining order — confirmed end of Ace 27.0)

**Active workstream: Game Plan phases (Phase 2 is the immediate next ship).** Supersedes the older standalone "Ace Assistant Tab" + "Game Plan — Full DB + Web Access" entries below.

1. **Game Plan Phase 1 [SHIPPED 2026-04-30]** - Web search rolled out to all 5 Claude API call sites: ai-workspace, mail/ai-compose, email/edit-with-claude, calls/summary, clients/new. Folded in the old "Phase 3 - web search + internal blend" since web search now lives across the whole app.
2. **Game Plan Phase 2** - Find Matches button on the job + client Game Plan. Queries the Neon candidate database; surfaces top fits by title, skills, location, comp.
3. **Game Plan Phase 3** - Feed last 5 tagged emails from the candidate / client into the Game Plan prompt as context.
4. **Game Plan Phase 4** - "My Writing Style" setting. New field in /settings, injected into every Claude API call across Ace (submittals, JDs, email generation, Game Plan).
5. **Game Plan Phase 5** - Sidebar Claude panel: persistent chat inside Ace with web search + full Ace data access. Replaces / fulfills the older "Ace Assistant Tab" entry.
6. **Game Plan context depth** - Send full resume text + full JD text into the ai-workspace prompt so Claude reasons against the actual content, not just metadata.

**Other Week 2 items (carry forward after Game Plan phases):**

7. **CSV Import/Export** — bulk candidate / contact ingest path.
8. **Candidates Page UX** — multi-select, prev/next, keyboard nav (left/right arrow keys when not focused on an input). Prev/Next respects current list/search filter and sort order. Also applies when navigating from global header search results. (Partial sweep landed in Ace 27.0; remaining items: full keyboard nav + prev/next from header search.)
9. **Settings Fix Generator** — small utility surface inside Settings to repair common data issues without touching the DB by hand.
10. **Daily Industry Briefing + Word of the Day** — Vercel Cron 6 AM EST. Daily public-accounting industry brief + a vocabulary card delivered in-app.
11. **Market Insights Tab** — Tab 6 on client detail. Generate market briefs inline. Save brief history per client. Pick recipients from contacts. Compose / auto-generate email, attach PDF, send from Ace.
12. **BD Tab + Prospects Database** — dedicated /bd surface and a Prospect table. Stores company / contact / title / email / LinkedIn / triggering job posting per prospect, sequence status, last touch.
13. **BD Automation Engine** — Daily 6 AM cron. Step 1 (Indeed API): scan last-24hr jobs, filter for public accounting firms by company name (CPA / Associates / Partners / Accounting / Advisory / Group) OR JD signals (audit / tax / public accounting). Discard staffing agencies and corporate in-house. Output 20 companies/day. Step 2 (Apollo API): one best contact per company — Managing Partner, Tax Partner, Controller, CFO, or HR Director. Step 3: Write each prospect to the Prospect table. Step 4: Auto-enroll in email sequence using warmed burner domains. All sending and tracking in Ace, not Apollo. BD Settings screen for keywords / titles / limit / sequence. BD feed showing overnight additions and sequence status. Apollo is data source only. Replaces Andrew's manual BD flow.

**Replaced / folded into the Game Plan phases above:**
- ~~Ace Assistant Tab~~ → Game Plan Phase 6 (sidebar Claude panel with web search + full Ace data access).
- ~~Game Plan — Full DB + Web Access~~ → Game Plan Phases 1-3 + 4 (web search + Find Matches + tagged-email context).

#### Already shipped from earlier Week 2 plan:
- Phone Tab Phase 1 + 2 (Ace 24.0).
- Phone Tab Phase 3 (Ace 26.0).
- Full brand system + court mode 6-palette overhaul (Ace 24.0).
- Dashboard premium redesign (Ace 24.0).
- Button system unified across app (Ace 24.0).
- Activity tab on candidate + client profiles (Ace 24.0).
- Visual markup change — addressed via the candidate profile redesign + clients page redesign (25.0 / 26.0).

#### Earlier Week 2 items rolled into the 1–10 ordering above:
- Daily Industry Briefing + Word of the Day → item 5.
- Market Insights Tab → item 8.
- Game Plan Web Search "Find Matches" button → item 7.
- Claude-powered web search assistant panel (internal use only) → item 6 (Ace Assistant Tab).
- Mail composer Generate-from-prompt input box → ships shipped under Generate with Claude in the composer; if there's a regression, surface in toast-fix sweep.
- Cosmetic polish pass (billing tower, h1 contrast, counter subtext, "Welcome back, Andrew" → "Activity Dashboard", remove INTERNAL OPS header, fix footer location) → mostly shipped 24.0; remaining items roll into the next polish batch.
- Next/Previous navigation between candidate profiles → item 3.

### Week 3

- JD auto-generate Claude button on job page.
- Resume parser improvements (5-10 test resumes to tune).
- Quo auto-transcription webhook (call.transcript.completed, save transcript + Claude summary). [SHIPPED Ace 28.0 day 1 - 2026-04-30]
- Boolean candidate search - skills/location/title/employer/education with AND/OR/NOT.
- MPC (Most Placeable Candidates) feature.
- Sentry N+1 fixes: ACE-CRM-5 (37 events), ACE-CRM-6 (28 events), ACE-CRM-7 (2 events), ACE-CRM-9 (1 event), ACE-CRM-A (1 event). Plus one Hydration Error. Fix via Prisma include eager-loading.
- **Calendar Tab** (added end of Ace 26.0)
  - Dedicated /calendar page in the sidebar (between Pipeline and Applicants, or after Phone — Andrew to confirm position).
  - Month / week / day view of all scheduled interviews and meetings.
  - Google Calendar read/write sync with Andrew's calendar (Google account already connected). Existing scheduled interviews appear automatically (already on Google Calendar via the interview scheduler).
  - Create-meeting modal opened from the page header. Fields: title, date/time, duration, attendees (pull from Neon contacts — candidate + client picker), location / video link, notes.
  - One-click meeting creation for BD calls + intro calls + internal meetings without going through the full interview scheduler flow.

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

- **Edit interview** — modify date, time, interviewers, and location on an existing scheduled interview. Updates the Neon row, refreshes the Google Calendar event, and re-sends notifications to the client and candidate so they pick up the change.
- **Cancel / reschedule flow** — Cancel exposes an optional reason field; reschedule opens the scheduler pre-populated with the existing interview's data so Andrew only edits what changed. Both actions push updated notifications to the client and candidate.

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
