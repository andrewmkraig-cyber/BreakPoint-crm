# ACE_RULES.md
Last updated: 2026-06-08 · Ace 89.0

## Ace Fix Protocol (added 2026-05-23 · Ace 66.0 - standing convention, READ FIRST)
When a chat begins with "this is an Ace fix" (or similar wording), Claude must read all four canonical docs - ACE_RULES.md, ACE_STATE.md, ACE_ROADMAP.md, and ACE_DESIGN.md - in full BEFORE making any code or doc changes. The fix must follow the current rules, design system, and shipped state recorded in those docs. No edits until all four have been read.

## How to Start Every Session
Every Ace session opens with this exact sequence:
1. Read ACE_RULES.md, ACE_STATE.md, ACE_ROADMAP.md, and ACE_DESIGN.md from project files.
2. Apply the doc hygiene rule.
3. Recite all rules back to Andrew.
4. Confirm the next task from ACE_STATE.md.
5. Give the first prompt paste-ready.

Opening prompt format: "This is Ace X.0. Read ACE_RULES.md, ACE_STATE.md, ACE_ROADMAP.md, and ACE_DESIGN.md from the project files. Apply doc hygiene rule. Recite all rules. Confirm next task from ACE_STATE.md and give the first prompt paste-ready. First task is [task]."

## How to Launch Claude Code
Always launch with: claude --dangerously-skip-permissions
Never omit this flag. Never suggest launching any other way.

## Communication Rules (All Responses)
- Always format URLs as clickable markdown hyperlinks. Never plain text.
- Explain everything in plain English before giving a prompt. Andrew is not a developer.
- Step-by-step explanations for anything technical. No developer jargon.
- Paste-ready prompt blocks only. Plain English explanation first, then a clean paste box.
- Concise. No fluff. No hedging. No em dashes. Use hyphens.

## Doc Hygiene Rule (Every Session Start)
At the start of every session, before any other work:
- Pull ACE_STATE.md and identify stale rules, superseded plans, completed items still in active lists.
- Clean in one pass. When a plan changes, replace - do not append.
- Completed items move to log only.

## Doc Update Cadence (Added 2026-05-07 · Ace 34.0)
Doc updates happen once at end of session only. Do not update ACE docs on every commit. Each commit edits product code or schema, never the four canonical docs (ACE_RULES.md, ACE_STATE.md, ACE_ROADMAP.md, ACE_DESIGN.md). At session close, do one consolidated doc-update commit that reflects everything that shipped.
All time estimates calibrated against actual build pace: Game Plan Context Depth = 20-30 min, Ace Assistant Phase 4 = ~1 hr. Use these as baseline when estimating future prompts.

## Code Prompt Rules
- Max 3 items per prompt. No exceptions.
- Step 0 on every prompt touching candidate/job/client/placement/pipeline: grep for relevant files and report exact counts before writing any code.
  - **Baseline UNITS caveat (added Ace 73.0).** The CLAUDE.md Step 0 baselines (`recruiterflow ~0`, `RecruiterFlow ~18`, `RfId ~1076`) read as occurrence/line counts, but the documented grep commands use `-l | wc -l`, which returns **file counts**. Compare like-for-like: drop `-l` to count occurrences, or treat the baselines as file counts. A 73.0 audit reported file counts (`recruiterflow` 3, `RecruiterFlow` 10, `RfId` 84 files) that only looked "below baseline" because of this units mismatch — not an actual regression.
- Browser-verify before every commit. Code must report what it saw, not just "done."
- Dual-file awareness: always name BOTH files when a feature touches more than one.
- Single terminal only. Never suggest parallel Claude Code sessions or multiple terminals.
- Always end every prompt with: git push origin main
- Never commit untested code.
- After every feature ships: stop and give Andrew a plain English test plan before moving to the next prompt. No exceptions.
- Before writing any prompt requiring specific context: ask Andrew the needed questions first.
- /clear between every two feature ships.
- Never run background /loop tasks during active feature work.
- After any compaction event in Code: next prompt must explicitly restate the in-progress task and reference any uncommitted local files.

## Git Rules
- Always push at the end of every prompt with git push origin main. Do not wait for Andrew to ask.
- Every feature ship must end with git push origin main. Never leave commits sitting locally. If the session ends without pushing, the next session must push before starting any new work.
- Git author email: andrew@breakpointtalent.com OR andrewmkraig@gmail.com.
- GitHub source of truth: https://github.com/andrewmkraig-cyber/BreakPoint-crm/main/docs/ace/
- Four canonical files: ACE_RULES.md, ACE_STATE.md, ACE_ROADMAP.md, ACE_DESIGN.md.
- GitHub doc updates are additive-only. Never delete history.
- ACE_DESIGN.md is the 4th required fetch on every session open.
- If docs are not updated at session end, the handoff failed.
- After every task, commit and push immediately without waiting for confirmation. Use descriptive commit message. Never hold changes waiting for approval.

## Test Plan Rules
- Claude (chat, not Code) writes every post-ship test plan in plain English.
- Code verifies internally and reports results. User-facing test steps come from Claude only.
- When Code ships something, Claude translates what happened into plain English. Never pass through stack traces raw.
- Andrew must test and confirm before the next task ships.

## Architecture Non-Negotiables (14)
1. RecruiterFlow is removed. No new RF dependencies.
2. Ace-native parity is mandatory.
3. Primary key is Neon cuid, always.
4. Banned vocabulary: RF overlay, RF enrichment, optional RF sync, fall back to RF, RF as cache, hybrid lookup.
5. Mandatory Step 0 grep on every prompt touching candidate/job/client/placement/pipeline.
6. Ace-native verification is the PRIMARY check.
7. No partial migrations. Refactors are atomic.
8. Every server action, query, and route touching tenant data MUST scope by organizationId.
9. Every Code prompt includes a Regression Check step.
10. Help docs - RELAXED to nice-to-have.
11. Git author email: andrew@breakpointtalent.com OR andrewmkraig@gmail.com.
12. Court Mode theme tokens. No hardcoded colors.
13. Pipeline stage source of truth: Neon only.
14. **Ace-native modal path rule.** UPDATED Ace 69.0 — `placement-flows.tsx` was DELETED in C2 (`791c843`); the two-modal-file ambiguity is gone. `local-placement-rows.tsx` is now the only candidate placement modal file, and `LocalCandidateProfile` is the unconditional candidate-profile render (the legacy `rfId`-keyed path is deleted). Edit `local-placement-rows.tsx` for placement modal work. Shared placement/interview symbols extracted in Phase A live in `src/components/placements/placement-shared.tsx`. Step 0 grep still applies — confirm the live surface before editing. Memory entry: `feedback_ace_native_only_modal_path.md` (now stale on the dead-RF-file detail).

    **Synthetic-id shim — RETAINED (known remaining shim).** RF removal progressed materially in Ace 69.0 (legacy candidate-profile path + `placement-flows.tsx` + `PlacementActionsIsland` all deleted), but the synthetic-id shim is NOT gone: `syntheticIdFromCuid` + `_aceJobId`/`_aceClientId`/`_aceContactId` carry-fields are still read live across 7 files (`local-profile.tsx`, `candidates/bulk-actions.ts`, `placement-actions.ts`, `jobs/page.tsx`, `jobs/[id]/page.tsx`, `lib/candidates.ts`, `lib/rf-payload-shapes.ts`). Rule 1 ("RecruiterFlow is removed") holds for the RF data path and UI; this numeric-stand-in shim remains load-bearing and its removal is a separate future RF-removal phase. The djb2-hash-in-URL prohibition (Job + JD Rules below) still stands.

## BD Phase 4 Rule (added 2026-05-12 · Ace 41.0 — permanent, never skip)
Claude must ask Andrew a full set of scoping questions before writing any BD Phase 4 prompt. Do not skip this even if Andrew says "start BD Phase 4" or "let's go." Andrew's standing direction is that Discovery + Client Signals + approval queue matters more than fully automated send magic, and not every Phase 4 automation ships for launch. The required questions are listed in ACE_STATE.md under the BD Phase 4 Rules section of Next Task. Re-read that section every time the next session opens against BD Phase 4 — the questions are the gate, not a suggestion.

## BD Engine Rules (added 2026-05-12 · Ace 40.0)
- **Data provider stack**: TheirStack is the Phase 4 job-discovery provider. The architecture is the `JobDiscoveryProvider` abstraction — every discovery feed (TheirStack now, possibly more later) implements the same interface so swaps don't ripple through caller code. Adzuna is a possible later addition as a coverage benchmark. JSearch is fallback only. Indeed Publisher API is gated and likely rejected — do not block the BD roadmap on it. ZipRecruiter Partner application was sent in parallel; if it's approved, it slots in as a secondary provider behind the same abstraction.
- **Vercel cron uses UTC, not ET**. 6 AM ET = 10:00 UTC currently, 11:00 UTC after DST. Vercel does not retry failed crons — Ace owns retries via the BDRun state machine (status fields and explicit re-queue actions).
- **BD approval queue**: discovery runs surface companies, the BDRun stops at status `AWAITING_APPROVAL`, Andrew reviews on Today's Launch, Approve & Enroll fires Apollo. No silent auto-enroll.
- **Shared warmed domain pool**: bulk email to candidates and BD outbound share the same 5 warmed domains. Combined daily volume must stay under per-domain warm capacity (~30-50/day per domain). The send scheduler accounts for both queues — they do not have independent budgets.
- **Apollo API key**: stored in Vercel as `APOLLO_API_KEY`. Apollo Professional plan does not allow scoped keys, so the master key is the only option — name it "Ace BD Engine" so revocation has a clean audit trail. **The key MUST be sent in the `X-Api-Key` request HEADER, never in the JSON body** (body placement 422s — this broke prod in Ace 80.0). Applies to every Apollo REST call (`apolloEnrollContact`, `apolloSearchPeople`, `apolloResolveEmailAccountId`). The prod key is marked **Sensitive** in Vercel, so `vercel env pull` returns it EMPTY — it cannot be pulled for local testing; paste it manually when a live call is needed.

## Apollo Enrollment Rules (added 2026-06-03 · Ace 80.0 — PERMANENT, full detail in ACE_STATE.md ▸ Ace 80.0)
The BD Approve & Enroll path (`src/lib/bd/apollo-enroll.ts`, called from `src/app/bd/launch/bd-run-actions.ts`). These are the load-bearing facts a future session must not re-discover.
- **Job-posting context is written as `typed_custom_fields` keyed by the REAL Apollo custom field IDs — record them here permanently:**
  - **Posting Job Title = `6a207e120239f0000c18decd`**
  - **Posting Job URL = `6a207e2290a45c00208eccbb`**
  - **Posting Job City = `6a207f8bc3715c0010ae118e`**
  - These are **CONTACT** custom fields. The email-template merge vars are `{{contact.Posting Job Title}}`, `{{contact.Posting Job URL}}`, `{{contact.Posting Job City}}`. **NEVER use Apollo's built-in `{{job_title}}`** — that is the contact's own title (the wrong field). That was the original Ace 80.0 bug.
- **Enrollment is TWO calls, in order:** (1) `POST /api/v1/contacts` with `typed_custom_fields` + `run_dedupe:true`, capture the returned contact id; (2) `POST /api/v1/emailer_campaigns/{sequence_id}/add_contact_ids` with params in the **QUERY STRING** (`emailer_campaign_id`, `send_email_from_email_account_id`, `contact_ids[]`). **Passing `sequence_id` on contact-create does NOT enroll** — Apollo ignores it; the second call is mandatory.
- **`run_dedupe:true`** on contact-create so returning prospects update instead of duplicating.
- **Posting Job City is trimmed city-only** via `cityOnly()` (everything before the first comma) — TheirStack returns "City, State", Apollo stores "Chicago".
- **Sequence + mailbox IDs:** default active mailbox `a.kraig@breakpoint-talent.com` = `69cac1772e443a000dfc7970` (overridable via `APOLLO_EMAIL_ACCOUNT_ID`); sequence fallback `6a06068f8142ee001d2b3dd2` = the real "Tax BD Sequence". The in-app "BD Outbound v1" label in `apollo-sequences.ts` is a cosmetic placeholder that does NOT match the real Apollo sequence name.
- **The Apollo sequence "Activate" toggle stays OFF** until a real approve-and-inspect pass is done. Never run the sequence live without that gate.
- **People search endpoint is `/api/v1/mixed_people/api_search`** (added Ace 88.0). The non-api `/api/v1/mixed_people/search` is DEPRECATED and 422s. Send `contact_email_status: ["verified"]` in the api_search body for email yield.
- **`people/match` MUST match by the Apollo PERSON ID for a real email reveal** (added Ace 88.0). Matching by name+domain returns a hollow 200 with a null email. Thread the real person id end to end through BOTH the search path AND the approved/curated path - dropping it on the curated path was the Ace 88.0 core break.
- **`reveal_personal_emails=true` goes in the QUERY STRING, not the body** (added Ace 88.0).
- **Mailbox rotation is set ONLY at `add_contact_ids` time** (added Ace 88.0) via the `send_email_from_email_account_id[]` array - all healthy mailboxes (`status = Connected` + not `sendingDisabled`), single-mailbox fallback when only one is healthy. There is NO sequence-settings rotation toggle; Apollo chooses rotation on enroll.
- **The Approve & Enroll modal MUST have `key={run.id}` AND re-sync its selection on payload change** (added Ace 89.0). `CompanySelectionModal`'s `selected` Set is derived state: without a `key` and a `useEffect` re-seeding it to all indexes on `run.id`/`companies.length` change, the Today's Batch auto-refresh poll swaps `run.discoveredPayload` behind the open modal and FREEZES selection to a stale, narrowed set (often `[0]` or empty). The server then enrolls only that set - this was the Ace 89.0 BD enroll-zero root cause. General rule: any poll that swaps a payload behind an open modal must remount or re-sync the modal's derived state.

## TheirStack Discovery Rule (added 2026-06-03 · Ace 80.0 — PERMANENT)
- **Every TheirStack `/v1/jobs/search` request MUST carry at least one mandatory filter** (`posted_at_max_age_days` / `posted_at_gte` / `posted_at_lte` / `job_id_or` / `company_name_or` / ...) or it 422s "Missing mandatory filter". `job_title_or` + `limit` do NOT count. `TheirStackProvider` now ALWAYS sends `posted_at_max_age_days` (integer days, derived from `postedSince` when a prior run exists, else default 7) so the cron AND Run Discovery Now both pass. Do not make the date filter conditional again.
- **The per-client-domain client-signal sweep (`syncClientSignals`) is CRON-ONLY and runs at most once per America/New_York calendar day** (added Ace 89.0). It fires one TheirStack `/v1/jobs/search` per client domain (`limit:25`, ~25 credits each), so it must NEVER run on manual "Run Discovery Now": `triggerManualDiscovery` sends `manual=1` and the route skips the sweep on that path. The once-per-ET-day guard is the `BdOrgConfig.lastClientMonitorAt` marker - gated on read, stamped on each real sweep. Running it on every manual run was burning ~1700 credits/month.

## Job + JD Rules (added 2026-05-12 · Ace 40.0)
- **Job slug is the cuid**. `createJob` returns `slug: job.id` (the cuid). `/jobs` row navigation routes via the cuid carried on `_aceJobId` (the RFJobWithAce shim's carry-along), never `legacyRfId` and never the synthetic negative djb2 hash of the cuid. The djb2 hash exists only as a numeric stand-in inside the `RFJob.id` field for shim compatibility — it must never appear in a URL.
- **JD generators both emit markdown**. Path A (`src/app/api/jobs/generate-jd/route.ts`) and Path B (`src/lib/claude.ts` `generateJobDescription`) both produce GitHub-flavored markdown with `##` / `###` headings and `-` bullets. Single renderer: `react-markdown` everywhere `Job.description` is displayed. The `PlainProse` renderer for `Job.description` is **deprecated** — do not introduce new callsites.

## Design Rules
- Green #5A9642 only for: primary buttons, active nav, active tabs/pipeline stages, positive status chips.
- Never full-page green tinting or heavy green dark mode backgrounds.
- Reduce borders by ~40%, use spacing instead.
- Dark themes (Clay + Grass): charcoal/graphite base, NOT green. Green as accent only.
- No hardcoded colors anywhere. Three documented hex exceptions (full detail in ACE_DESIGN.md): Spotify panel palette (`spotify-panel/` only), dashboard premium surface (`dashboard/*` only), and the AI / Claude pill color family (`#1F3A29 / #2A4D38 / #284A36 / #2D4435 / #3A5944 / #37533F`, scoped to `button.tsx` + `edit-with-claude-menu.tsx`).
- Documented shape exception (Ace 64.0): the circular `rounded-full` transport buttons in `src/components/spotify-panel/` are intentional Spotify-product mimicry, parallel to the Spotify hex exception. Full detail in ACE_DESIGN.md.
- **Icon semantic color system (added Ace 71.0 - PERMANENT, full detail in ACE_DESIGN.md).** Icon color is driven by action meaning, not by file: delete=red-600, reject=red+UserX, edit=muted, create/add=brand, send=brand, confirm=brand-green+CheckCircle2, schedule=blue, keep=cyan, apply=amber, offer=purple, warning=amber, neutral/nav=muted. Icons inside a semantic Button **inherit** the button's color (set no color class); standalone / icon-only actions take the token explicitly.

## Distance + Pipeline Row Standards (added 2026-05-29 · Ace 68.0 - PERMANENT)
Mirrored in ACE_DESIGN.md. Apply to any candidate→job distance and any pipeline row.
- **Canonical distance format is `"(X.X mi)"`** - one decimal + `mi`, produced ONLY by `formatMiles` / `formatDistanceSubLine` in `src/lib/distance.ts`. Job side geocodes through the shared `src/lib/geocode.ts` Nominatim helper; candidate side reads `Candidate.lat/lng`. Never add a second helper or geocoder. Blank cleanly (no dash, no "N/A") when either side is missing. Rendered as muted metadata (`text-court-fg-muted`), never bold.
- **One bold element per pipeline row: the candidate name.** Every other cell renders at the regular metadata weight/size. Two-line cells (Current Title/Employer, Job/Client) put the primary line in regular `text-court-fg` and the sub-line in smaller muted `text-xs text-court-fg-muted`. Date / location / salary cells share one metadata size - no mismatched sizes between Last Action and Start Date. (Documented exception: the Offer-stage Placement Fee percent keeps its own distinct font.)
- **Pipeline per-row action buttons are uniform colored outlines** (`rounded-md`, colored border + text, transparent fill) - same Action-row treatment as the Button Standard. No filled or pill-shaped per-row action chips.

## Button Standard (added Ace 54.0 - DO NOT CHANGE)
- Action row buttons (Submit, Apply, Keep, Reject, Add Note, Add to List): rounded-md, outlined, colored border + text, transparent background.
- Toolbar buttons (Use Template, Insert Field, Edit with Claude, Delete, Save Draft, Send): rounded-md, outlined, NOT pill shaped. **The mail composer footer button reads "Save Draft", a deliberate exception to the Ace 71.0 "Save everywhere" label standard (Ace 77.0) - it sits next to Send / Send Later, so the noun disambiguates that it stashes a Gmail draft. A code comment at the button marks it; do not revert it to "Save" in a future label sweep.**
- Generate with Claude / Generate Resume / Generate JD: rounded-md, solid-filled dark (the `ai-primary` variant / `CLAUDE_PILL_CLASS` - graphite-leaning dark green fill), NOT outlined. Code is canonical: the shipped pill is solid-filled, superseding the older "dark green outlined" wording from the Ace 54.0 spec.
- Primary CTA (New Candidate, New Job, + New X at page tops, Save, Create): rounded-md, tinted-green outline (`border border-court-brand bg-court-brand-tint text-court-brand-dark`, hover `bg-court-brand/25`). Code is canonical: the shipped primary is the tinted-green outline, NOT a solid `bg-court-brand text-white` fill - the older "filled green" wording from the Ace 54.0 spec is superseded.
- Upload Resume: rounded-md, blue outlined (`border-blue-500 text-blue-600`).
- Tab strip active: `rounded-md border-court-brand text-court-brand font-semibold` transparent background.
- NEVER use `rounded-full` on text buttons. The ban applies to text buttons only. `rounded-full` is reserved for badges, chips, status pills, and avatars, and IS permitted on icon-only circular buttons, toggle switches, and FABs.

This rule supersedes the older "All buttons are rounded-full" line in the Ace 24.0 Button System section of ACE_DESIGN.md. ACE_DESIGN.md carries the same Button Standard block — both docs hold the same source of truth.

## Button + Input + TabStrip Standards (added 2026-05-23 · Ace 66.0 - PERMANENT)
Mirrored in ACE_DESIGN.md. Permanent, apply to every surface.
- **No full-width buttons** unless the button is a full-width form-submit CTA. Action buttons are `w-auto`. A button only stretches edge-to-edge when it submits the form it sits at the bottom of.
- **TabStrip is mandatory for grouped controls.** Any in-page filter, tab, time-range selector, or nav group uses the `TabStrip` component (`src/components/ui/tab-strip.tsx`). No hand-rolled button rows. The Clubhouse "This Week / Last Week" strip is the reference.
- **Both-modes verification gates every button task.** Every button and interactive element must be visually verified in BOTH light and dark mode across the Court themes before a button task is considered done. Token compliance alone is NOT sufficient - look at it in both modes.
- **Input Field Treatment is source of truth for input shape.** Forms use the rectangular `court-input-rect` frame; the search bar, SMS composer, and Ace Assistant keep the pill `court-input-frame`. Buttons stay `rounded-md` (Button Standard); inputs do not follow the button shape rule.

## Composer Recipient Standard (added 2026-06-01 · Ace 75.0 - PERMANENT)
Mirrored in ACE_DESIGN.md. Apply to every email/invite composer.
- **Every composer's To accepts multiple recipients as pick-or-type chips.** Reuse the existing chip widgets - `ContactComboMulti` in `EmailComposer`, the chip-rendering `AddressRow` in `MailComposer` (which keeps its live Gmail/contact server-search typeahead). Never reintroduce a single-select To. Send paths already take `to: string[]`; the field value stays a comma-string for `parseList` / `splitAddresses`.
- **Cc = client contacts. Bcc = Austin only** (the team roster, `src/lib/team-contacts.ts` `TEAM_BCC_OPTIONS`). Client contacts must never leak into the Bcc pool. The calendar Guests field is a separate single-bucket field and is OUT of this standard - do not touch it.
- **Invoice email recipients auto-populate** from the placement billing contact (To) + hiring manager (Cc), with a recipient-count greeting (1 -> "Hi [First],", 2 -> "Hi [First] and [First],", 3+ -> "Hi Team,"). The email-body start date must use the SAME placement start-date source + formatter as the PDF - never a separate date path (the UTC off-by-one trap).

## Interview Scheduler Standard (added 2026-06-02 · Ace 76.0 - PERMANENT)
Mirrored in ACE_DESIGN.md. The interview restructure (D1/D2/E) shipped this version; these are now standing rules, not a plan.
- **ONE scheduler, one screen, one entry-point surface.** `ScheduleInterviewScreen` in `src/app/candidates/[id]/local-placement-rows.tsx` is the only interview scheduler. New + edit both run through it (`existingInterview` prop = edit mode). It is reached from the candidate profile Schedule Interview, the Clubhouse weekly-widget click, the calendar event Edit/Cancel, and the `?edit=interview` deep-link - all open this one screen. Do not reintroduce `ScheduleDialog`, `RescheduleDialog`, the two separate invite composers, or the `inviteFlow` state machine (all deleted).
- **Interviewers are multi-chip and client-event-only.** The Interviewer field is the multi-chip `InlineContactMultiInput` (same widget Cc/Bcc use), in new + edit modes. Every interviewer attaches as a guest on the **CLIENT** invite event only - never the candidate event - and is **never auto-Cc'd** (Cc stays the separate client-contacts pool). Picked chips drop out of the remaining options. This is the interview-scheduler application of the Composer Recipient Standard above.
- **Stored sent copy is the calendar source of truth.** Each sent invite's subject + body is stored per party (`Interview.sent{Client,Candidate}{Subject,Body,At}`); the calendar renders per-party events off what was actually emailed and the tile detail shows that stored copy. One Save drives the three-way notify choice (all / new-only / don't-send); "don't send updates" patches the Google event silently so Ace and Google never drift. Seed bodies into the editor / tile / Bcc copy through `htmlToReadableText` (the live calendar invite path is unchanged). Reuse the existing templates + send engine verbatim - do not fork the invite copy or send logic.

## Ace Assistant Write-Tool Pattern (added 2026-06-02 · Ace 78.0 - PERMANENT)
Shipped with `create_reminder` (the first assistant write capability). These are the standing rules for any future Assistant write tool (calendar events next).
- **Direct-execute (no per-item Confirm/Cancel card) is allowed ONLY for reversible, explicitly-user-requested creates.** Reminders execute directly server-side and render a single `batch_receipt` summary line ("Added 6 reminders") instead of a per-item card. This is a **documented, intentional carve-out** from the Confirm/Cancel-card pattern - NOT a violation of the killed "AI agent / auto-execute / next-best-action" line, because the creates are (a) reversible and (b) initiated by an explicit user instruction, never volunteered by the model. **Destructive actions (delete) ALWAYS keep a confirm.** A bulk destructive action may collapse to ONE batched confirm ("delete all N?") but must never become per-item-cardless. Calendar events, when built, follow the same reversible-create carve-out.
- **Over-N batch cap.** A single turn that fires more than 10 creates falls back to one confirm card rather than silently executing an unbounded batch.
- **Server-side tenant resolution (Rule 8).** The write path resolves `organizationId` + `userId` from the server session itself; no client-supplied tenant id passes through the tool input.
- **Timezone rule for server-side Assistant time writes (standing pattern, applies to calendar events too).** Inject the live `{{NOW_ET}}` (Eastern wall-clock now) + `{{ET_OFFSET}}` (DST-correct) into the model prompt so relative phrases ("in 20 minutes", "tomorrow at 3") anchor to the real current time - the original reminder skew was a MISSING current-time injection, not a UTC conversion bug. Require an explicit ET-offset ISO timestamp; **reject naive datetimes** (no offset). Re-anchor any emitted timestamp onto the correct Eastern offset (`reanchorToEastern`) as defense-in-depth. For calendar events apply the same guard to BOTH start and end.

## UI Consistency Rules (added 2026-05-12 · Ace 43.0)
- **TabStrip is the single source of truth.** All tab strips and filter pill groups across the app route through `src/components/ui/tab-strip.tsx`. No one-off pill groups anywhere — if a new surface needs filter pills or a tabbed selector, use TabStrip (link mode for navigation, controlled mode for in-page state).
- **Clubhouse is the card-sizing reference.** Every dashboard / list-page card matches the Clubhouse tab's two-tier pattern: small KpiTile chrome (`rounded-2xl bg-court-surface px-3 py-2.5 shadow-[0_1px_2px..0_8px_20px..]`, 10px extrabold label, 26px serif value) for inline KPI rows; big-panel chrome (`rounded-3xl bg-court-surface p-5 shadow-[0_1px_2px..0_12px_32px..]`) for everything else. No bordered `shadow-sm` panels on dashboard / placements / invoices surfaces.
- **No em dashes (—) in user-facing copy.** Hyphens (-) only. The em-dash placeholder for null values inside table cells stays (it's a typographic empty-state cue, not copy). This rule extends the Communication Rules ban into all rendered product copy — headers, subtitles, hints, tooltips, toasts, empty-state strings.

## Visual Work Rules (added 2026-05-17 · Ace 53.0)
- **Read actual file contents before writing any prompt.** The Ace 53 redesign attempt failed because prompts were written against assumed file shapes; the real files diverged and changes drifted. Every visual-pass prompt must start by reading the target file in full so the diff lands on the actual code, not the imagined code.
- **Build shared chrome components before any per-page visual work.** `PageWrapper` and `SectionCard` first. The Ace 53 redesign sweep broke because each page held its own chrome - a per-page edit looked right in isolation but drifted from siblings instantly. New rule: when a visual change touches more than one page, the shared primitive lands first and the per-page conversion is a separate prompt.

## Decisions Delegated to Claude
- Andrew delegates now/later build decisions to Claude.
- Regressions and workflow-blocking bugs fix immediately. Cosmetic items go to backlog.
- Tech decisions delegated to Claude. Claude decides, explains in plain English, documents in ACE_DESIGN.md.

## Killed Features (Do Not Build)
- Top tabs on candidate profile, header showing candidate/job notation
- Anonymize attachment checkbox, Notes for Client/Candidate on interview scheduler
- Send email separate from calendar invite checkboxes
- Recruiter Selector / Split with Recruiter
- Side tag on templates, co-recruiter splits
- Stage-Triggered Template Actions System
- MCP Connection, AI Agent features, candidate mood tracker
- All SaaS/productization: BYOC, Stripe, public REST API, MCP server, SOC 2, external SSO, demo mode, ZDR

## Audit Methodology Rule (Added 2026-04-26)
Cross-chat audits must read every Ace chat in full via conversation_search before pulling items into the roadmap. Audit output must separate items Andrew explicitly requested from items Claude proposed. Never bury Claude proposals as if they were Andrew requests.

## Product Context
- Ace is internal only. No productization.
- Live at: https://ace.breakpointtalent.com
- Launch target: 2026-05-15
- Build canvas: F0ATXA0ME9Z | BD vision: F0AUYBTPK4K | Recovery audit: F0AVDPEQQTW

## Project Brain - canonical (migrated from root CLAUDE.md, Ace 89.0)
Root `CLAUDE.md` is now a thin session-start pointer to the four docs in `docs/ace`; the full operational brain it used to carry lives HERE so nothing is lost. These are standing facts and rules, not a plan.

### What This Project Is
Ace is a custom internal recruiting CRM for BreakPoint Talent (Andrew Kraig + Austin Barnard). Internal use only. Not a SaaS product. Never add multi-tenancy, Stripe, public APIs, or external-facing features. Build only what makes Andrew faster at recruiting.
- Live: ace.breakpointtalent.com
- GitHub: github.com/andrewmkraig-cyber/BreakPoint-crm
- Stack: Next.js, Neon (Postgres), Prisma, Vercel, Gmail API, Quo (phone/SMS)

### Architecture Non-Negotiables (13 rules - enforced on every prompt)
1. RecruiterFlow is removed. No new RF dependencies. Ever.
2. Ace-native parity is mandatory. Every feature reads/writes Neon, not RF.
3. Primary key is Neon cuid everywhere. Never use numeric IDs as primary keys.
4. Banned vocabulary: "RF overlay", "RF enrichment", "optional RF sync", "fall back to RF", "RF as cache", "hybrid lookup". If you are about to write any of these, stop.
5. Step 0 grep is mandatory on every prompt touching candidate/job/client/placement/pipeline. Run grep before writing any code. Report counts. Do not proceed if counts look wrong.
6. Ace-native verification is the PRIMARY check. Never assume RF data is correct.
7. No partial migrations. Every refactor is atomic - ships complete or not at all.
8. Every server action, query, and route touching tenant data MUST scope by organizationId.
9. Every prompt includes a Regression Check step. Never skip it.
10. Help docs are nice-to-have, not blockers.
11. Git author email must be andrew@breakpointtalent.com or andrewmkraig@gmail.com.
12. Court Mode theme tokens only. No hardcoded hex colors anywhere in components.
13. Pipeline stage source of truth is Neon only. placement.stage is canonical.

### Step 0 Grep - Run Before Every Code Change
```
grep -r "recruiterflow" src/ --include="*.ts" --include="*.tsx" -l | wc -l
grep -r "RecruiterFlow" src/ --include="*.ts" --include="*.tsx" -l | wc -l
grep -r "RfId" src/ --include="*.ts" --include="*.tsx" -l | wc -l
```
Baseline: recruiterflow ~0, RecruiterFlow ~18, RfId ~1076. Report counts before writing any code. If counts increased from baseline, flag it. (See the Baseline UNITS caveat above: the documented `-l | wc -l` returns FILE counts, while the baselines read as occurrence counts - compare like-for-like.)

### Code Prompt Rules
- Max 3 items per prompt. Never queue more.
- Read every file before editing it. Always.
- Always commit and push immediately after build succeeds (`npm run build` exits 0).
- Never hold changes waiting for browser verification.
- Browser verification is Andrew's responsibility after deploy, not a gate before push.
- Single terminal only. No parallel Claude Code sessions.
- Always end with: `git push origin main`
- Every feature ship must end with `git push origin main`. Never leave commits sitting locally. If the session ends without pushing, the next session must push before starting any new work.
- Dual-file awareness: when a feature spans two files, name both explicitly before editing.

### After Compaction
If "Compacting conversation" appears, the next prompt must: (1) restate the in-progress task explicitly, (2) reference any uncommitted local files by name, (3) run `git status` before continuing. Never assume prior context survived compaction.

### Tenant Scoping
Every Prisma query touching these tables requires a WHERE organizationId clause: Candidate, Client, Job, Placement, Interview, Contact, ActivityLog, CandidateList, GmailThreadTag, CallLog, SmsMessage, CallTranscript.
- Default org: `cmobj8dxz00012gliequ53kvc` (BreakPoint Talent)
- Austin user: `cmo1ufmmn0000ib05eqk6hh32`

### Design System
- Primary green: `#5A9642` - hover: `#3F7030`
- Green used only for: primary buttons, active nav, active tabs, positive status chips
- Never: full-page green tinting, hardcoded hex in components
- Court Mode: `data-surface` (hard/clay/grass) + `data-theme` (light/dark) on the html element
- All buttons use shared `src/components/ui/button.tsx` - no one-off button styling

### Key File Locations
- Phone webhook: `/api/quo/webhook`
- Mail AI compose: `src/app/api/mail/ai-compose/route.ts`
- Activity logging: `src/lib/activity.ts`
- Org helper: `src/lib/auth/getCurrentOrg`
- Placements: `src/lib/placements.ts`
- Interviews: `src/lib/interviews.ts`
- Contacts: `src/lib/contacts.ts`

### What NOT to Build (permanent)
- No Stripe, no billing, no pricing tiers
- No public REST API or MCP server
- No external SSO, SOC 2, or multi-tenant onboarding
- No AI agent features (auto-suggestions, approve/dismiss, next-best-action)
- No co-recruiter splits
- No candidate mood tracker
- No demo mode or sandbox toggle

### End of Session (Mandatory - No Exceptions)
Before closing every session: (1) update `docs/ace/ACE_STATE.md` (current version, what shipped, next task); (2) update `docs/ace/ACE_ROADMAP.md` (mark completed items, reflect changes); (3) update `docs/ace/ACE_RULES.md` (header date + version, any new permanent rule); (4) commit and push in ONE consolidated docs commit. If docs are not updated and pushed at session end, the handoff failed.
