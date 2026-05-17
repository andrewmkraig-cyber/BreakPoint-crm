# Ace Design System
Last updated: 2026-05-17 · Ace 52.0

Visual + component design language for Ace. Sourced from ChatGPT design audit (2026-04-23).

This doc is the source of truth for what Ace looks and feels like. Apply continuously when building new components and pages — not just during a final "polish phase." Polishing at the end is a trap; design rules should be enforced during build so we don't ship 50 components that all need to be redone.

Design intent: Linear / Notion polish. Premium, minimal, sharp, intentional. Avoid boxy, muddy dark modes, generic SaaS look.

## Visual redesign pass — in progress (Ace 52.0 → Ace 53.0)

A seventeen-surface visual redesign pass is mid-flight. Prompts 1-10 shipped in Ace 52.0 (dashboard/clubhouse, pipeline, candidates search, candidate profile, jobs grid/detail, JD tab, clients, BD dashboard, BD settings, mail). Prompts 11-17 — phone, appearance, placements, all settings, scoreboard, applicants, finances — are queued at the top of the Ace 53 active sequence on `ACE_ROADMAP.md`.

Operating rules for this pass:

- **Court Mode tokens only — rule 12 strictly enforced.** Every spec hex is mapped to the nearest `court-*` token before write. The hex-to-token mapping is saved as a Code memory so the agent doesn't re-derive it on every prompt. Common mappings: `#5A9642` → `court-accent` / `bg-court-accent` / `border-court-accent`; `#3F7030` → `text-court-accent-dark`; `#EAF4E4` / `#F4F8F0` → `bg-court-accent-tint` (use `/40` or `/50` opacity modifier for the lighter hover/active variants); `#F0F2F0` → `border-court-border-soft`; `#E5E8ED` / `#E5E7EB` → `border-court-border`; `#5B6476` / `#6B7280` → `text-court-fg-muted`; `#111` → `text-court-fg`. If a spec hex genuinely doesn't map to any existing token, call it out — don't paste the literal hex and don't invent a new token without approval.
- **Playfair Display maps to `font-serif`.** Specs occasionally name Playfair for hero / subject typography. The project's `font-serif` token resolves to Bricolage Grotesque (the display family already used across hero headings). Treat the `font-serif` token as the canonical "display family" for spec compliance — do not introduce a Playfair font import.
- **Layout-stability constraint.** The visual pass is surfaces-only by default. Do not move elements or change copy unless the spec explicitly calls for it. If a spec describes an element that doesn't exist in the current code (e.g. a per-row unread dot or label chip on mail), flag it in the wrap-up rather than silently adding new chrome.

This section can be removed once Prompts 11-17 ship.

## Design Philosophy

Green is a scalpel, not a paint bucket.

Every page must have:

- One clear focal point
- Clean hierarchy
- Consistent spacing

Avoid:

- Boxy layouts
- Muddy dark modes
- Overuse of green
- Generic SaaS look

## Global Rules (Non-Negotiable)

### Color usage

BreakPoint green `#5A9642` is ONLY used for:

- Primary buttons
- Active nav item
- Active tabs / pipeline stages
- Positive status chips

Never:

- Full-page green tinting
- Heavy green backgrounds in dark mode

Everything else is neutral.

#### Approved hex exceptions (Ace 36.0)

The "no hardcoded colors" rule has two scoped, intentional exceptions documented here so future audits don't try to rip them out:

- **Spotify panel** — `src/components/spotify-panel/` uses the Spotify product palette directly (`#121212` page bg, `#181818` card bg, `#282828` hover, `#B3B3B3` muted text, `#1DB954` Spotify green, `#1ED760` hover green). The whole point of the panel is to feel like Spotify's own product, so it does not route through Court Mode tokens. This exception is scoped to the `spotify-panel/` directory only — no other surface may import these hex values.
- **Dashboard premium surface** — the dashboard page-bg + KPI card mix uses `#F6FAF4`, `#EFF5EB`, `#1F6A3A`, and `#F3F8EF` directly to land the green-tinted "premium" tone the recruiter signed off on. This exception is scoped to the dashboard components only (`src/app/dashboard/*` and the KPI / Billing Tower / Upcoming Interviews tiles). Other pages must continue to use Court Mode tokens.

### Dark themes (rebuild required)

Rebuild Clay and Grass:

- Base = neutral dark (charcoal / graphite), NOT green
- Green only as accent (focus, active, chips)
- Surfaces have clear contrast separation
- Text crisp, high contrast
- Remove muddy overlays completely

### Surface system

Replace "everything is a card" approach. Define:

- Page background
- Section background
- Card background
- Hover/active state

Reduce borders by ~40%. Use spacing and hierarchy instead of boxes.

### Typography

- Page title: large, high contrast (serif allowed here only)
- Section headers: medium sans
- Labels: small, muted
- Metrics: large + bold
- Table primary text: medium
- Metadata: small + low contrast

### Spacing

- Page padding: 24-32px
- Section spacing: 24-32px
- Card padding: 20-24px
- Table row height: consistent
- Remove inconsistent padding across components

### Radius + elevation

- Cards: rounded-2xl
- Inputs/buttons: rounded-lg or xl
- Light mode shadows: subtle
- Dark mode shadows: minimal or none

### Button hierarchy

- Primary: green filled
- Secondary: neutral outline/subtle fill
- Tertiary: ghost
- Destructive: red

Never place multiple equal-weight buttons side-by-side.

## Core Component Rebuilds

### Stat cards

- Reduce height
- Increase number size significantly
- Label above, small
- Remove unnecessary text
- Consistent layout across all cards

### Segmented controls

Used for: pipeline stages, tabs (Profile/Game Plan, Client tabs).

- No default pill styling
- Clean segmented control
- Active state clearly filled or inset
- Counts integrated cleanly
- Minimal border noise

### Tables / lists

Unify across Candidates, Pipeline, Jobs, Clients into one system:

- Consistent row height
- Stronger header styling
- Subtle dividers only
- Hover = light tint (no heavy borders)
- Hierarchy: name primary, title/company secondary, location/date metadata
- Actions aligned right cleanly
- Tighter spacing for high-density usage

### Cards (Clients, Jobs, Panels)

- Reduce visual weight
- Fewer borders
- More reliance on spacing
- Consistent padding
- Consistent footer alignment

## Page-Level Implementation

### Dashboard

- Tighten KPI cards into a clean row
- Larger numbers, less text
- Upcoming interviews: stronger name hierarchy, right-aligned date/time stack, smaller cleaner action button
- Billing section: billed revenue = primary focal point, cash collected secondary, cleaner layout, less boxed

### Candidates List

- Rebuild table using unified table system
- Toolbar: smaller search input, left = title + count, right = New Candidate CTA
- Rows: name strongest, title medium, employer/location muted, updated smallest
- Subtle hover state
- Optional: initials/avatar indicator

### Pipeline

- Rebuild stage tabs as segmented control
- Active stage clearly visible
- Add summary row: active count, this week movement, stale
- Improve density, eliminate floating layout feel

### Settings

- Quieter and more premium
- Court Mode: remove heavy cards, replace with cleaner horizontal selector, subtle preview, clean active state (no glow outline)
- Preferences: row-based layout, label left + control right, tighter spacing, remove excess helper text

### Clients List

Redesign client cards as structured snapshots. Each card:

- Header: name + industry/location
- Small verified badge
- Center: submitted/interviewing/hired
- Footer: jobs + fee
- Equal height cards
- Tighter spacing
- Reduced border emphasis

### Candidate Profile

- Top bar action hierarchy: primary = Submit to Job, secondary = Apply to Job, tertiary = Request References
- Reduce button clutter
- Job cards: lighter visual weight, cleaner stage chips, disqualified visually subdued
- Tabs: rebuild as segmented control
- Resume: primary visual anchor, cleaner toolbar
- Contact panel: tighter layout, improved label/value styling

### Client Detail

- Replace top stat cards with clean stat strip (larger numbers, tighter spacing)
- Tabs: segmented control style
- Overview: improved spacing + typography
- Fee agreement: more compact, premium, clearer status presentation
- Jobs table: align with unified table system

## Implementation Priority

When the dedicated polish phase begins (or when touching these areas during build):

1. Dark themes (Grass + Clay)
2. Tables / lists system
3. Segmented controls
4. Spacing + border reduction
5. Dashboard cards
6. Candidate profile polish

## Visual References From Other Tools

Andrew has shared screenshots from his other ATS database showing patterns to draw from when designing these specific features (HEIC images in chat history 2026-04-23):

- Candidate search with Boolean operators + key field filters (apply when building Boolean Candidate Search, Week 3)
- Bulk candidate email sequencing UI (apply when building Candidate Sequencing in BD Tab, Week 2)

## Workflow Going Forward

When Claude Code builds any new component or page:

1. Reference this doc for the visual rules
2. New components must comply with the global rules from day one (color usage, button hierarchy, typography, spacing)
3. Don't introduce new "everything is a card" layouts
4. Don't hardcode green outside the approved use cases

After dedicated polish phase ships, Andrew sends updated screenshots for a second-pass tightening (micro-interactions, spacing tuning, alignment, "this still looks off" fixes).

## Button System (added Ace 24.0)
Shared component: src/components/ui/button.tsx
Variants:
- primary: bg-brand text-white hover:bg-brand-dark (green - Submit, Save, Create)
- secondary: bg-court-surface-subtle border border-court-border (neutral)
- danger: bg-red-50 text-red-600 border border-red-200 (Reject)
- apply: bg-amber-50 text-amber-700 border border-amber-200 (Apply)
- schedule: bg-blue-50 text-blue-700 border border-blue-200 (Schedule Interview)
- ghost: transparent hover:bg-court-surface-subtle
All buttons are rounded-full. No rounded-lg on brand buttons anywhere.

## Stage Badge Colors (added Ace 24.0)
- SOURCED: slate
- APPLIED: amber (matches Apply button)
- SUBMITTED: brand green tint
- KEPT: slate
- INTERVIEWING: blue (matches Schedule button)
- OFFER: purple
- HIRED: green
- REJECTED: red (matches Reject button)

## Court Mode System (added Ace 24.0)
6 palettes: 3 surfaces (hard/clay/grass) x 2 themes (light/dark)
Controlled via data-surface and data-theme attributes on html element
Storage: localStorage keys ace-court-surface and ace-court-theme
Selector UI: sun/moon toggle + 3 surface buttons in Settings
Wimbledon (grass light): sidebar bg-[#1F3A1F] deep forest green
Grass purple badge: bg-grass-purple (#6B3FA0) on unread counts in grass mode

## Night Court Themes (added Ace 40.0)
4th and 5th Court Mode options alongside Hard / Clay / Grass:
- **Night Court Light** — warm cream surface (`#FAF8F5`) as the page background, forest-green sidebar, brand-green accents. Reads as a premium daytime palette without the green-tinting trap from earlier Wimbledon iterations.
- **Night Court Dark** — same forest-green sidebar paired with a neutral-dark surface (no green tinting on the canvas), brand-green accents.

Full token coverage on every page — no holdouts. Token names follow the same `court-*` family already used by Hard / Clay / Grass; surface selection flips via `data-surface="night-court"` + the existing `data-theme="light" | "dark"` toggle.

## Unified TabStrip Component (added Ace 40.0)
- **Source of truth**: `src/components/ui/tab-strip.tsx`. Every tab strip in the app routes through this component — Dashboard tabs, BD tabs, candidate profile tabs, /jobs tabs, client tabs, settings tabs.
- **Visual style** (matches the Today's Briefing pattern): `rounded-md` tabs, thin brand-green border + bold brand-green text on the active pill, neutral inactive, count chips themed to state (positive / negative / neutral).
- One-off tab strips are not allowed. Any new tab strip uses TabStrip or extends TabStrip — never a hand-rolled flex row of buttons.

## Page Header Sizing (added Ace 40.0)
- Page titles: 30px. Stops the previous slow drift where every page had its own title size.
- New-item buttons (New Candidate / New Job / New Client) shrunk to a smaller height so they don't visually compete with the page title.

## Color Discipline (added Ace 40.0)
- **Amber `#F59E0B`** is reserved exclusively for the **Launch BD Run** CTA on `/bd/launch`. No other surface may use this exact amber. (Tailwind `amber-50/100/700` ramps remain in use as button-variant accents per the existing Stage Badge / Button System rules — that's the Apply / Schedule family, separate from the BD CTA.)
- **Button color sweep** (formalizes the Ace 39.0 sweep): amber = Apply to Job, light blue = Keep, red = Reject, green = Submit, soft violet = Reapply. Every surface that surfaces these actions uses these colors and only these.

## BD Engine Surface Direction (added Ace 40.0)
- **Hero card on `/bd/launch`** — the Launch BD Run CTA is the focal element of the page; everything else is supporting context.
- **5-domain health pills** — domain status renders as a row of 5 colored dots (one per warmed domain in the rotation pool), each tinted by current SendingDomain.status (HEALTHY / WARMING / COOLED).
- **Day X of 7 progress copy** — campaign rows show "Day X of 7" in the eyebrow, saturating at 7. The exact phrasing is part of the visual language, not a per-page free-form.
- **Colored event glyphs** on `/bd/activity`: sends = brand green, replies = blue, bounces = red, domain events = neutral.

## Candidate Profile Unified Layout (added Ace 40.0)
- **Resume always on the left**. The PDF anchor is fixed-position; pipeline tabs / overview / activity feed scroll independently on the right.
- **Action row above the resume on the left**. Submit / Apply / Keep / Reject / Reapply sit above the resume, not above the tabs.
- **Contextual content on the right**. Overview, applied jobs, activity, notes — everything that's not the resume or the action row.
