# Ace - Roadmap

## Week 2 (Apr 28 - May 4)

### Mail Tab
- Gmail inbox inside Ace, scoped to current user
- Thread view, reply composer
- Candidate and client auto-tagging by email address

### Game Plan Gmail Context
- Read email threads tied to a candidate from inside the Game Plan tab
- Ask what did Linda say, give me a reply and Game Plan reads the thread and generates a response
- Pairs with Mail Tab - Gmail must be wired first

### Game Plan Full Database Access
- Game Plan currently only sees data linked to that specific candidate or client
- Extend context builder to include ALL open jobs and ALL clients regardless of affiliation
- Enable queries like do I have any open jobs Sidney would fit or which clients might have a role for her

### Game Plan Web Research
- Pull live job postings and market data for a client from the web alongside DB data
- Enables questions like what is Sheehan Brothers currently hiring for outside of what I have in Ace

### BD Tab and Prospects Database
- Prospect table in Neon: company, contact name, title, email, LinkedIn, source job posting, sequence status
- BD Settings screen: configure filtering keywords, target contact titles, daily prospect limit, active sequence
- BD Feed: morning view of prospects added overnight with sequence status (email 1 sent, opened, replied)

### BD Automation Engine
Daily cron job, zero manual work. Scans Indeed and other job boards every morning for public accounting firm postings in last 24 hours. Filters by company name signals (CPA, Associates, Partners, Accounting, Advisory, Group) and JD signals (public accounting, audit, tax experience). Discards corporate in-house roles and staffing agencies. Outputs 20 companies per day. For each company, queries Apollo API directly to find best contact (Managing Partner, Tax Partner, Controller, CFO, HR Director - one per company). Writes to Prospect table automatically. Enrolls each prospect in an email sequence sending from warmed burner domains. All tracking (sent, opened, replied) lives in Ace. Apollo is data source only, never the sender.

### Domain Rotating Email Infrastructure
- Vercel Cron job runs every 15 minutes to send scheduled sequence emails
- Rotates across warmed burner domains automatically so no single domain gets flagged
- Same infrastructure handles both BD sequences and candidate sequences
- Sequence builder UI: create multi-step sequences with delay intervals

### Pin CSV Importer
- Pin has no public API or webhooks - CSV export only
- Drag-and-drop CSV importer in Ace maps Pin export fields directly to Neon candidate table
- Deduplicate by LinkedIn URL or email
- Fields: first_name, last_name, email, phone, current_title, current_company, location_city, location_state, linkedin_url, experience, education

### Market Insights Tab
- Generate market briefs from inside a client record
- Pull comp data, pipeline statistics, regional context
- Output formatted brief ready to send

### Daily Industry Briefing
- 6am auto-summary of last 24 hours of news relevant to Andrew's verticals
- Delivered as a feed inside Ace or Slack DM

## Week 3 (May 5-11)

### Advanced Candidate Search
- Filter by job title, location, skills
- Each filter can be set as required, optional, or cannot have
- Boolean search and column sorting

### Find Similar Candidates
- Give me 10 candidates in my system closest matching to Sidney
- Scoring based on title, skills, location, experience level
- Results ranked with match percentage

### Candidate Scoring System
- Resume + JD + company info input scores candidate out of 10
- Same criteria Andrew uses for submittals: must-haves weighted first, then client appeal, location realism, comp alignment, tenure, red flags
- Instant evaluation from any candidate or job profile

### Live Placement Probability Score
- Every candidate in pipeline gets a 1-100 score updated in real time
- Based on response time, interview progression, comp alignment, stage duration
- Color coded green/yellow/red visible on pipeline view

### Counteroffer Risk Flag
- Auto-triggers at offer stage
- Analyzes tenure, comp jump percentage, and current employer size
- Flags high counteroffer risk candidates before the offer goes out

### Client Heat Map
- Visual showing which clients are active, going cold, or overdue for touchpoint
- Red/yellow/green based on last activity date
- One screen shows where to focus BD energy today

### Candidate Re-engagement Engine
- Flags candidates placed or gone cold at 12-18 months who are statistically likely to be open to a move
- Auto-drafts re-engagement email for Andrew's review before sending

### One-Click Interview Prep Packet
- Replaces manual interview prep email template
- One click generates a formatted email or PDF with company background, role summary, likely interview questions, and coaching notes
- Auto-sends to candidate when interview is scheduled

### Submittal Tracker with Read Receipts
- Tracks whether the client opened a submittal email and how many times
- Shows opened 3x no reply inside Ace so Andrew knows when to follow up
- Candidate never sees or gets notified - Andrew's intel only

### BD Trigger Alerts
- Monitors LinkedIn and Indeed for new job postings from existing clients
- Alerts Andrew inside Ace when a client posts a new role he has not filled yet

### JD Auto-Generate Button
- On any job profile, one click generates a full job description using job title, client info, and requirements on file

### Fee Tracker with Austin Auto-Notify
- Every placement automatically calculates gross fee, Andrew's 75% cut, and Austin's 25%
- Slacks Austin the breakdown the moment a start date is confirmed

### Google Drive Auto-Backup
- Nightly backup of Ace database to ACE Database shared drive with Austin

### MPC Features
- Most Placeable Candidates flag
- MPC email blast builder

## Week 4 (May 12-15)

### DocuSign Auto-Import
- Signed agreements auto-imported into client Agreements tab

### PWA Conversion
- Ace works like a native phone app
- Add to home screen, offline mode for read-only

### Activity-to-Revenue Analytics
- Track calls, emails, submittals, placements over time
- Revenue per client, per vertical, per month

### Night Court Theme
- Dark mode

### BP Branding
- Favicon, app icon, email signature block

### Full End-to-End Dogfood Test
- Andrew uses Ace exclusively for one full recruiting day
- Every workflow tested under real conditions
- Bug list generated and triaged

### UX Polish Batch
- Spacing, loading states, empty states, mobile responsiveness

## Completed Log

### Ace 16.0 and earlier (through 4/24/2026)
- Project scaffolding, Neon DB, NextAuth Google OAuth
- Candidate management: create, edit, resume upload, branding
- Resume parsing with Claude
- Email infrastructure: Gmail + templates + merge fields
- Submittal workflow: Generate with Claude
- Placement lifecycle: Offer, Pending Start, Hired, Cancel
- Client management: create, edit, contacts, agreements, benefits
- File storage: Neon Postgres base64
- Interview scheduling: dual Google Calendar invites with Meet links, Meet access OPEN
- Inline pipeline action buttons: stage-contextual
- Candidate profile restructured: resume primary, sidebar for contact/skills/employment
- Cancelled interviews hidden to Activity accordion
- RF fully removed (Phase 5): hard tenancy enforced across all 20 models
- Candidate page search bar with 300ms debounce, in-place filtering, empty state
- Global header quick search: candidates, clients, contacts in grouped dropdown with keyboard nav
- Contact search results navigate to client Contacts tab directly
- docx resume preview via mammoth server-side
- Game Plan context depth fix: full resume + full JD
- Game Plan model ID routed through CLAUDE_MODEL constant
- Editable contact card slide-over on client Contacts tab
