# Ace Design System

Visual + component design language for Ace. Sourced from ChatGPT design audit (2026-04-23).

This doc is the source of truth for what Ace looks and feels like. Apply continuously when building new components and pages — not just during a final "polish phase." Polishing at the end is a trap; design rules should be enforced during build so we don't ship 50 components that all need to be redone.

Design intent: Linear / Notion polish. Premium, minimal, sharp, intentional. Avoid boxy, muddy dark modes, generic SaaS look.

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
