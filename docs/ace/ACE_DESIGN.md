# Ace Design System
Last updated: 2026-09-01 · Ace 99.1

Visual + component design language for Ace. Sourced from ChatGPT design audit (2026-04-23).

This doc is the source of truth for what Ace looks and feels like. Apply continuously when building new components and pages — not just during a final "polish phase." Polishing at the end is a trap; design rules should be enforced during build so we don't ship 50 components that all need to be redone.

Design intent: Linear / Notion polish. Premium, minimal, sharp, intentional. Avoid boxy, muddy dark modes, generic SaaS look.

## Today's Batch redesign (shipped Ace 82.0-86.0) - as-built
The Today's Batch surface redesign shipped across Ace 82.0-86.0. It was the Ace 81.0 "moving things around" intent - a layout change, NOT an engine change. As built:
- **KPI tiles row across the top:** Discovered Today, Enrolled, Last Run.
- A **Rows / Cards view toggle**.
- A **cleaner company grid**.
- A **"Review all"** button on each run card, entering the company popup.
- A **panel-dismiss fix** so a drag that starts inside a number input and releases on the backdrop no longer closes the dialog (mousedown-on-backdrop, not click).
All controls follow the standing button standards - token colors, standard sizing, no hardcoded hex. The shipped surface is shared chrome, NOT the rejected prior mockup. (Detail: ACE_STATE.md ▸ What Shipped in Ace 82.0-86.0; ACE_ROADMAP.md ▸ DONE this session.)

## Ace 79.0 component + visual notes (2026-06-03)
- **Masked currency input (shared).** Money fields - candidate + job comp overview, the Offer modal, and the Make Placement modal - use ONE shared masked-currency input: blank at rest, a leading `$` with thousands commas as digits are typed, no "USD" suffix, digits-only (the old `120k` shorthand no longer works, per spec), emitting a clean number on save. The comp DISPLAY carries the `$` prefix ($60,000 USD). Fee % / flat-fee-override / invoice math are unaffected. (As-built Ace 90.0: the Make Placement free-text "Currency" field was removed - `currency` is a hardcoded `"USD"` const mirroring the Offer row, still written to `Placement.acceptedCurrency` on save; the Offer modal had already dropped its USD tag.)
- **Placement map markers are FILLED with their payment-state color.** Each dot is filled with its placement's payment-state color (from `STATUS_COLORS`) with a thin white outline for tile contrast - NOT the prior green fill with a colored ring. Cities outside the static `CITY_COORDS` table resolve through the shared `src/lib/geocode.ts` Nominatim helper (cached, the one-geocoder rule from the Distance Standards) so any placement city gets a dot; the marker popup lists client / candidate / fee / date per placement.

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

The "no hardcoded colors" rule has three scoped, intentional exceptions documented here so future audits don't try to rip them out:

- **Spotify panel** — `src/components/spotify-panel/` uses the Spotify product palette directly (`#121212` page bg, `#181818` card bg, `#282828` hover, `#B3B3B3` muted text, `#1DB954` Spotify green, `#1ED760` hover green). The whole point of the panel is to feel like Spotify's own product, so it does not route through Court Mode tokens. This exception is scoped to the `spotify-panel/` directory only — no other surface may import these hex values.
- **Dashboard premium surface** — the dashboard page-bg + KPI card mix uses `#F6FAF4`, `#EFF5EB`, `#1F6A3A`, and `#F3F8EF` directly to land the green-tinted "premium" tone the recruiter signed off on. This exception is scoped to the dashboard components only (`src/app/dashboard/*` and the KPI / Billing Tower / Upcoming Interviews tiles). Other pages must continue to use Court Mode tokens.
- **AI / Claude pill color family (Ace 64.0)** — the shared Button component bakes the Claude/AI pill palette directly: `#1F3A29` (pill bg), `#2A4D38` (border + hover border), `#284A36` (hover bg), plus the dark-mode lifts `#2D4435` (bg), `#3A5944` (border + hover border), and `#37533F` (hover bg). These are the `ai-primary` Button variant and the `CLAUDE_PILL_CLASS` constant; the two border hexes (`#2A4D38` / `#3A5944`) are also the hover-border tones on the `ai-secondary` variant. The pill is intentionally a graphite-leaning dark green that reads as a distinct "Claude" surface in every Court Mode, so it does not route through Court Mode tokens. This exception is scoped to `src/components/ui/button.tsx` and `src/components/edit-with-claude-menu.tsx` only — no other surface may import these hex values.

#### Approved shape exceptions (Ace 64.0)

The Button Standard's `rounded-full` ban applies to text buttons only (see Button Standard below). One scoped, intentional shape exception is documented here so future audits don't try to square it off:

- **Spotify panel** — the circular `rounded-full` buttons in `src/components/spotify-panel/` (the transport controls) are intentional Spotify-product mimicry, the shape parallel to the Spotify hex exception above. This exception is scoped to the `spotify-panel/` directory only.

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

- Cards: rounded-xl (ratified Ace 90.0 - this is the dominant pattern and is now the standard, superseding the original rounded-2xl spec). Buttons stay rounded-md (Button Standard) and inputs follow the Input Field Treatment - card radius does not apply to them.
  - **Exception - the Clubhouse two-tier card system.** The dashboard / placements / invoices surfaces keep their KPI tiles at rounded-2xl and their big panels at rounded-3xl per the Clubhouse card-sizing reference (ACE_RULES.md ▸ UI Consistency Rules). BD KPI tiles / big panels built to that same Clubhouse chrome (e.g. `bd/launch/launch-view.tsx`, the `approval-queue` big panel) keep rounded-2xl / rounded-3xl too. Modal / dialog panels (`max-w-* ... shadow-xl`) are not cards and are out of scope.
- Light mode shadows: subtle
- Dark mode shadows: minimal or none

### Button hierarchy

- Primary: tinted-green outline (`border-court-brand + bg-court-brand-tint + text-court-brand-dark`), NOT filled green. Code is canonical - see the Button Standard block below; the older "green filled" wording from the original audit is superseded.
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

## Button Standard (added Ace 54.0 - DO NOT CHANGE)
Source of truth for every button across the app. Mirrors the same block in ACE_RULES.md.
- **Action row buttons** (Submit, Apply, Keep, Reject, Add Note, Add to List): `rounded-md`, outlined, colored border + text, transparent background.
- **Toolbar buttons** (Use Template, Insert Field, Edit with Claude, Delete, Save Draft, Send): `rounded-md`, outlined, NOT pill shaped.
- **Generate with Claude / Generate Resume / Generate JD**: `rounded-md`, solid-filled dark (the `ai-primary` Button variant / `CLAUDE_PILL_CLASS` - graphite-leaning dark green fill), NOT outlined. Code is canonical: the shipped pill is solid-filled, superseding the older "dark green outlined" wording the Ace 54.0 spec carried.
- **Primary CTA** (New Candidate, New Job, + New X at page tops, Save, Create): `rounded-md`, tinted-green outline (`border border-court-brand bg-court-brand-tint text-court-brand-dark`, hover `bg-court-brand/25`). Code is canonical: the shipped primary is the tinted-green outline, NOT a solid `bg-court-brand text-white` fill - the older "filled green" wording the Ace 54.0 spec carried is superseded.
- **Upload Resume**: `rounded-md`, blue outlined (`border-blue-500 text-blue-600`).
- **Tab strip active**: `rounded-md border-court-brand text-court-brand font-semibold` transparent background.
- **NEVER use `rounded-full` on text buttons.** The ban applies to text buttons only. `rounded-full` is reserved for badges, chips, status pills, and avatars, and IS permitted on icon-only circular buttons, toggle switches, and FABs.

Supersedes the older "All buttons are rounded-full" rule from the Ace 24.0 Button System section below.

## Input Field Treatment (Ace 66.0 - separate from Button Standard)
- Inputs use `court-input-frame` / `court-input-control` CSS classes (`globals.css`). Pill shape (`rounded-full`), solid `court-surface-subtle` fill, thin court-brand-tinted border, spring-eased focus-within glow (`color-mix` brand green ring + 4px lift on desktop, no lift on touch devices).
- `INPUT_FRAME_CLASS` and `INPUT_CONTROL_CLASS` exported from `src/components/ui/input.tsx`.
- Inputs do NOT follow the button `rounded-md` rule. Inputs are pill-shaped. Buttons are `rounded-md`. These are separate standards.
- Liquid Glass floating surfaces (Ace 66.0): targeted translucency on topbar, modals, dropdowns, panels only. Not a full-app conversion.

See the fuller Input Field Treatment block lower in this doc for the rectangular `court-input-rect` form variant — the search bar / SMS composer / Ace Assistant keep the pill `court-input-frame`, and forms use the rectangular variant. Both share the same focus-within glow and lift behavior.

## Button System (added Ace 24.0 — superseded by Button Standard above as of Ace 54.0; kept for historical context)
Shared component: src/components/ui/button.tsx
Variants:
- primary: bg-brand text-white hover:bg-brand-dark (green - Submit, Save, Create)
- secondary: bg-court-surface-subtle border border-court-border (neutral)
- danger: bg-red-50 text-red-600 border border-red-200 (Reject)
- apply: bg-amber-50 text-amber-700 border border-amber-200 (Apply)
- schedule: bg-blue-50 text-blue-700 border border-blue-200 (Schedule Interview)
- ghost: transparent hover:bg-court-surface-subtle
~~All buttons are rounded-full. No rounded-lg on brand buttons anywhere.~~ (Superseded — see Button Standard above.)

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
- Page titles: 22px (corrected Ace 90.0). The shared title chrome renders at 22px serif extrabold (`TopBarPageTitle`) / 20px (`PageHeader`); code is canonical and the earlier "30px" spec was stale. Stops the previous slow drift where every page had its own title size.
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

## Sign-in Surface (added Ace 61.0)
- **Dark luxury login.** `/sign-in` is a dark recruiter-network screen, distinct from the in-app Court Mode surfaces: near-black canvas, a stippled world map with the Solon, OH HQ marker and connection arcs reaching out to the markets, a glassy auth card floating over a soft green glow, and a single pulsing brand-green status dot top-left.
- **What it does NOT carry.** No top-bar stats strip (no "14 Markets / 1,247 Candidates / clock") and no "BreakPoint - Global Desk" eyebrow. Keep it to the map, the card, the bottom bar, the pulsing dot, and the HQ label. Colors here come from Court Mode tokens; the only fixed hexes are the Google "G" brand asset.

## Court Mode Persistence (added Ace 70.0)
- **Surface + theme are DB-backed as of Ace 70.0.** `UserProfile.courtSurface` / `UserProfile.courtTheme` are the durable source of truth for the chosen palette. They are still mirrored into localStorage (`ace-court-surface` / `ace-court-theme`) for instant, flash-free first paint, but the DB copy is what survives a hard close and follows the user across devices.
- **Why:** installed PWAs (iOS especially) evict script-writable storage (localStorage) after inactivity / storage pressure. Before 70.0, dark mode + the chosen surface lived in localStorage only, so a hard-close eviction reset everyone to Hard/Light and rewrote those defaults back into storage - the "settings get forgotten over time" bug. Auto Night Mode survived only because it was the lone DB-backed appearance value.
- **Boot order:** the pre-hydration inline script (`buildCourtModePreHydrationScript`, seeded with the user's DB values from `layout.tsx`) stamps `data-surface` / `data-theme` on `<html>` from localStorage; when a key is missing it falls back to the DB value AND re-seeds localStorage from it. `CourtModeProvider` takes `initialSurface` / `initialTheme` props (same DB values) so SSR + first client render agree, then reconciles against localStorage. `setSurface` / `setTheme` / `toggleTheme` persist fire-and-forget via the `setCourtMode` server action, each writing only its own column. Legacy single-key `courtMode` migration + Hard/Light defaults unchanged.

## Auto Night Mode (added Ace 61.0)
- **Day/night auto-flip for Court Mode.** A Settings > Appearance toggle that, when on, flips the active surface to its dark variant at 7:00 PM ET and back to light at 7:00 AM ET on a 1-minute client interval (no cron). It only drives the Light / Dark axis; the chosen surface (Hard / Clay / Grass / Night) is untouched.
- **Persistence.** The toggle saves to `UserProfile.autoNightMode` so the preference follows the user across devices. As of Ace 70.0 the surface + theme are also DB-backed (see Court Mode Persistence above); the per-window auto-night marker (`ace-auto-night-window`) stays localStorage-only device bookkeeping. A manual Light / Dark switch made inside a window wins until the next 7am / 7pm boundary.
- **ET via Intl.** Eastern time is computed with `Intl.DateTimeFormat` keyed to `America/New_York`, so DST is automatic. This mirrors the calendar reminder-mode decision below: ET is hard-coded for now, to be replaced by a per-user timezone preference when MULTI-USER ships.

## Calendar Reminder-Mode Drawer (added Ace 61.0)
- **Reminder mode hides event-only fields.** When `CalendarEventDrawer` is in reminder mode it hides Guests, Location, Meeting type, All day, and Timezone - a reminder is a personal time-anchored nudge, not a meeting. Time is hard-coded to ET with a code comment to pull the per-user timezone once MULTI-USER ships.

## Sidebar Profile Card Token (added Ace 65.0)
- **`--court-sidebar-card` is a dedicated token for the sidebar profile card surface.** Added across all 8 Court Mode palettes (Hard / Clay / Grass / Night Court, light + dark each). The profile card previously borrowed a generic surface token that washed out against the deep-green sidebars on Grass and Night Court; the new token gives the card its own per-theme value so it reads with proper contrast on every palette. Use `--court-sidebar-card` for the sidebar profile card only - it is not a general surface token.
- **Clay-light fix (Ace 77.0).** On the "flat" palettes (Hard light/dark, Clay light/dark) the card token must equal that palette's `--court-sidebar-bg` (no raised panel); only Grass + Night Court intentionally raise the card above the sidebar. Clay light had drifted - its `--court-sidebar-card` was set to the content `--court-surface` value (`#FFFAF3`) instead of the tan sidebar surface (`#E8D2BD`), so the card read near-white over the sidebar. It now points at `var(--court-sidebar-bg)` so the two can never diverge again. If you ever change a flat palette's sidebar-bg, the card follows automatically; do not reintroduce a separate hardcoded triple on a flat palette.

## Input Field Treatment (shipped Ace 66.0 - SOURCE OF TRUTH for input shape)
- **Input fields have their own visual standard, separate from the Button Standard.** Buttons stay `rounded-md` per the Button Standard above; inputs do NOT follow the button shape rule.
- **Two variants, one system.** Shared tokens live in `globals.css`: `court-input-frame` (the pill wrapper - surface fill, border, focus-within glow + 1px lift) and `court-input-control` (the transparent inner field), paired via the `INPUT_FRAME_CLASS` / `INPUT_CONTROL_CLASS` constants. `court-input-rect` squares the pill to a `0.75rem` radius for the rectangular variant.
  - **Pill (`court-input-frame`)**: the search bar, the SMS composer, and the Ace Assistant bar.
  - **Rectangular (`court-input-rect`)**: forms - New Candidate / New Job / New Client, settings inputs, and inline editable fields.
- Do not square inputs to match buttons, and do not pill-shape form inputs.

## Ace 66.0 Standards (added 2026-05-23 - PERMANENT)
Mirrored in ACE_RULES.md. Permanent, apply to every surface.
- **No full-width buttons** unless the button is a full-width form-submit CTA. Action buttons are `w-auto`.
- **TabStrip is mandatory for grouped controls.** Any in-page filter, tab, time-range selector, or nav group uses `TabStrip` (`src/components/ui/tab-strip.tsx`). No hand-rolled button rows. The Clubhouse "This Week / Last Week" strip is the reference.
- **Both-modes verification gates every button task.** Every button and interactive element is visually verified in BOTH light and dark mode across the Court themes before the task is done. Token compliance alone is not sufficient.
- **Input Field Treatment (above) is the source of truth for input shape.** Forms use rectangular `court-input-rect`; the search bar, SMS composer, and Ace Assistant keep the pill `court-input-frame`.

## Owner-Filter Standard (added 2026-06-11 · Ace 91.0 - PERMANENT)
Resolves the audit F6 filter-select question. Two distinct filter-select styles, by purpose:
- **Owner-scope filters use the branded green chip.** The "whose book" filter (My Jobs / My Clients / My Pipeline) is a soft-green native dropdown: `appearance-none rounded-md border-court-brand/40 bg-court-brand/5 text-court-brand` + a custom brand-tinted `ChevronDown`, sized to the TabStrip pill height. This is the shipped `OwnerScopeSelect` on `jobs-view.tsx`, `clients-view.tsx`, `pipeline-view.tsx` (and `jobs/page.tsx`). It is the standard for ANY future owner-scope / "mine vs theirs vs all" filter. The green tint signals "this is filtering by ownership," distinct from a generic value filter.
- **All other (generic) filter selects use the neutral shared `Select`** (`src/components/ui/input.tsx`) - the `court-input-rect` frame + its built-in chevron, no brand tint. This covers the candidate sourcing-rail filters (`candidates/page.tsx` `SelectField`), the job match-rail filters (`jobs/[id]/matches-tab.tsx` `SelectField`), the candidates "Filter by list" select, and every value/range/date filter dropdown.
- **Candidates have no owner-scope filter** (candidates are not per-user owned - only clients/jobs/pipeline carry ownership), so there is no branded owner chip on the Candidates list; its filters are all generic and use the neutral shared Select.
- **Both-modes verification** (Ace 66.0) applies: confirm the green chip reads correctly on all Court themes in light + dark.

## Distance + Pipeline Row Standards (added 2026-05-29 · Ace 68.0 - PERMANENT)
Mirrored in ACE_RULES.md. Apply to any candidate→job distance and any pipeline row.
- **Canonical distance format is `"(X.X mi)"`** — one decimal + `mi`, produced ONLY by `formatMiles` / `formatDistanceSubLine` in `src/lib/distance.ts`. Job side geocodes through the shared `src/lib/geocode.ts` Nominatim helper (module-level cache); candidate side reads `Candidate.lat/lng`. One helper, one geocoder — never add a second. Blank cleanly (no dash, no "N/A") when either side is missing. Rendered as muted metadata (`text-court-fg-muted`), never bold. Used by both the pipeline Location cell and the Ace-native candidate profile job pill.
- **One bold element per pipeline row: the candidate name.** Every other cell renders at the regular metadata weight/size. Two-line cells (Current Title/Employer, Job/Client) put the primary line in regular `text-court-fg` and the sub-line in smaller muted `text-xs text-court-fg-muted`. Date / location / salary cells share one metadata size — no mismatched sizes between Last Action and Start Date. Documented exception: the Offer-stage Placement Fee percent keeps its own distinct font.
- **Pipeline per-row action buttons are uniform colored outlines** (`rounded-md`, colored border + text, transparent fill) — the Action-row treatment from the Button Standard. No filled or pill-shaped per-row action chips.

## Icon Semantic Color System (added 2026-05-31 · Ace 71.0 - PERMANENT)
Mirrored as a one-line pointer in ACE_RULES.md (Design Rules). Apply to every icon across the app.

**Core principle: icon color is driven by action MEANING, not by which file the icon lives in.** Two rendering rules:
- **Icons inside a semantic `Button` INHERIT the button's color** - set no color class on the icon. The shared `Button` variants (`reject`/`danger`=red, `apply`=amber, `keep`=cyan, `schedule`=blue, `offer`=purple, `primary`=brand) already carry the right color, and the icon should pick it up via `currentColor`. Adding an explicit icon color here is a bug - it desyncs the icon from its button.
- **Standalone / icon-only actions take the token EXPLICITLY** (the icon is the whole control - there's no button color to inherit).

**The semantic map** (token per meaning):
- **Delete / destructive** = `red-600`. Icon-only or text delete triggers use `text-red-600` at rest; deletes inside a `reject`/`danger` Button inherit the variant red; the "quiet" row-action pattern (delete sitting beside a muted Edit pencil) may rest at `text-court-fg-muted` and go `hover:text-red-600`. **No delete is ever fully neutral, and all delete reds are red-600** (never red-700).
- **Reject (person)** = red, icon = `UserX` (not `XCircle` / `CircleSlash`).
- **Edit** = `text-court-fg-muted` (hover `text-court-fg`).
- **Create / add** = brand (inherit `primary` for primary adds; muted for secondary adds).
- **Send / submit** = brand (inherit `primary`). No bespoke per-button colors - no orange.
- **Confirm / positive / saved** = brand green (`text-court-brand-dark`), icon = `CheckCircle2`.
- **Schedule** = blue (`schedule` variant family). **Keep** = cyan. **Apply** = amber. **Offer** = purple. **Reapply** = violet.
- **Warning** = amber (`text-amber-600` / `-500`).
- **Neutral / nav / decorative / field-label / status-label** = `text-court-fg-muted` (or `-dim` for de-emphasis).
- **Active nav / brand** = `text-court-brand` / the sidebar active token. The desktop sidebar's per-nav-item rainbow `iconColor` is intentional wayfinding and is being kept; as of Ace 72.0 mobile-nav consumes the SAME per-item colors from the shared `src/components/nav-items.ts` source (`NAV_GROUPS` + `FOOTER_NAV`), so desktop and mobile match and can never drift.

**First fixes shipped Ace 71.0:** unified the 5-way-split delete trashcan to red-600 (mail-composer "Delete draft" went from the lone neutral `secondary` to `danger`/red); retired the lone orange Email button on the job Matches tab (bespoke `border-orange-500`/`bg-white`/`text-orange-600` -> shared `Button variant="secondary"`, which reskins across Court themes); fixed the Ace Assistant glyph dark-mode bug (`src/components/icons/in-conversation.tsx` hardcoded `#5A9642` accent + `#FAF8F3` bubble -> `rgb(var(--court-brand))` accent + `rgb(var(--court-surface))` bubble, and the ink "you" figure -> `rgb(var(--court-fg))` so it stays legible on the surface bubble in the active green-button state where `currentColor` is white). The standalone-icon token sweep across the rest of the app was completed in Ace 72.0: the audit enumerated every standalone / icon-only action across candidate/job/client/placement/pipeline (86 files, 392 icon usages) and found them already compliant (icons inherit the right color from their wrapping Button; quiet row deletes already `hover:text-red-600`), so no unambiguous icon-token fixes remained. The rainbow sidebar `iconColor` was ported to mobile-nav via the shared `src/components/nav-items.ts` source the same version.

## Finances Surface (updated 2026-06-01 · Ace 74.0)
The old combined `/finances` page (three `?tab=` tabs: Revenue & Profitability / Invoices / Expenses) was split and trimmed:
- **Two standalone Ops pages.** `/invoices` and `/expenses` are now separate sidebar entries + routes (`src/components/nav-items.ts`: Invoices = Receipt/lime, Expenses = Wallet/amber). `/finances` is a redirect only (`?tab=expenses` -> `/expenses`, else -> `/invoices`); do not add new UI there.
- **Revenue cards live on Placements.** The three Revenue cards (By client / By source / Trend) are `RevenueCards` in `src/components/finances/revenue-cards.tsx` and render above the Placements map. The KPI strip + Revenue & Profitability (Margins + P&L) surface was deleted; do not rebuild it. `src/app/dashboard/financial-performance-tab.tsx` is the Expenses-only surface (subscriptions, money in, tools, ROI, totals).
- **Money In = bank truth only.** The Expenses "Money In" list shows real Mercury (and QuickBooks once wired) transactions only. Never fold Ace placement fees into Money In — those are projected/earned revenue, surfaced on Placements + the Revenue cards, and mixing them in double-counts against Net Profit / Loss and lets cancelled/test placements leak in.

## Composer Recipient Fields (added 2026-06-01 · Ace 75.0)
Mirrored as a permanent rule in ACE_RULES.md (Composer Recipient Standard).
- **To is a multi-recipient pick-or-type chip field on every composer**, matching Cc/Bcc. `EmailComposer` uses `ContactComboMulti`; `MailComposer` uses the chip-rendering `AddressRow` (chips + a typed buffer, retaining the live Gmail/contact server-search typeahead). Committed addresses render as `rounded-full bg-court-surface-subtle` chips with an X; type + Enter / comma / semicolon / Tab / blur commits; Backspace on an empty input removes the last chip; prefilled recipients render as chips at rest.
- **Cc = client contacts; Bcc = Austin only** (`src/lib/team-contacts.ts` `TEAM_BCC_OPTIONS`). The calendar Guests field stays a single bucket and is untouched.

## Interview Scheduler (shipped 2026-06-02 · Ace 76.0 - PERMANENT; was the Ace 75.0 "to build" direction)
Mirrored as a standing rule in ACE_RULES.md ▸ Interview Scheduler Standard. The D1/D2/E restructure shipped this version; this is now the as-built standard, not a plan.
- **One Jobot-style single screen, one entry point.** `ScheduleInterviewScreen` (`src/app/candidates/[id]/local-placement-rows.tsx`) is the only scheduler - one scrolling screen: interview type, date/start/end/timezone, location, interviewer(s), Cc = client contacts, Bcc = Austin, a Send-Candidate-Email toggle + its own subject/body editor, a Send-Client-Email toggle + its own subject/body editor, and ONE Send button that fires whichever toggles are on. New + edit both run through it (`existingInterview` = edit mode); reached from candidate profile Schedule Interview, the Clubhouse weekly widget, the calendar event Edit/Cancel, and the `?edit=interview` deep-link. The multi-window flow (`ScheduleDialog`, `RescheduleDialog`, two invite composers, the `inviteFlow` state machine) is deleted - do not reintroduce. No attachment field (the interview send path has no attachment channel).
- **Interviewers are multi-chip, client-event-only.** The Interviewer field is the multi-chip `InlineContactMultiInput` (the same chip widget Cc/Bcc use), in new + edit modes. Every interviewer attaches as a guest on the CLIENT invite event only - never the candidate event - and is never auto-Cc'd; picked chips drop out of the remaining options. This is the Composer Recipient Standard applied to the scheduler.
- **Calendar reflects what the recipient saw.** Each sent invite's subject + body is stored at send time (candidate + client separately, in the `Interview.sent*` columns); per-party calendar events render off what was actually emailed, and clicking a tile shows that stored copy with Edit/Cancel. The Clubhouse weekly widget stays ONE entry per interview. One Save drives an update-all / update-new-only / don't-send choice that actually drives who is emailed ("don't send updates" patches the Google event silently so Ace and Google never drift); Cancel cancels the whole interview with its own notify choice. Seed bodies through `htmlToReadableText` for the editor / tile / Bcc copy; the live calendar invite path is unchanged. The existing per-recipient invite bodies/subjects + send engine are reused verbatim - do not fork them.

---

## Goals Surface (added 2026-09-01 · Ace 99.0 - PERMANENT)

The Goals tab (`/dashboard?tab=goals`). Big-panel chrome throughout (`rounded-3xl bg-court-surface p-5` + the canonical long shadow), KPI strip on the canonical `KpiTile`, Clubhouse card-sizing reference as everywhere else.

### The three-tier revenue meter
The focal element of the page. One horizontal bar carrying earned, billed and collected against the quarter's target.
- **The headline figure is EARNED** (Ace 99.1). The big number reads "$X earned of $Y", the bar's pace marker is measured against earned, and billed and collected sit alongside it as their own labelled figures. All three tiers stay visible - the decision changed which one is in charge, not which ones are shown.
- **The three fills are NESTED, not stacked end to end.** They are the same money at three stages of one pipe (earned >= billed >= collected), so drawing them as segments that add up would triple-count it. Each fill is drawn from the left edge at its own absolute percentage of target, widest behind narrowest.
- Fills are brand-green alpha steps - `bg-court-brand/25` (earned), `/60` (billed), solid `bg-court-brand` (collected). Tokens only, no hex, so they re-skin across all seven Court palettes.
- **Colour is never the only cue.** Three steps of one green are exactly what fails for anyone who cannot separate them, so every tier is ALSO named in a legend and printed as its own labelled dollar figure underneath. The same rule applies to any future multi-series fill.
- A thin `bg-court-fg` marker rule sits at the expected-to-date position, ABOVE the fills so it stays visible once the bar runs past it. Ahead or behind reads visually without arithmetic.
- The bar scales to `max(target, earned, billed, collected)` so an overshoot is visible rather than clipped.

### RATIO goals get no progress bar and no projection
An `AVG_DEAL_SIZE` goal is an average, and an average CONVERGES rather than accumulating - on day two of a quarter one $20k placement makes the average $20k, so "percent of target so far" and a linear projection are both meaningless. A ratio row shows current vs target, percent difference, and a trend arrow against the prior equivalent period. Never give one a progress bar. This is a design rule, not just an implementation detail: the bar is what tells a reader "this accumulates".

### Milestone tracker
A milestone has no period, so it has nothing to be on pace against. It gets progress, percent complete, dollars remaining, a trailing 90-day run rate, and a projected landing date. **A null projected date is stated in WORDS** ("Not at this rate", with "nothing collected in the last 90 days" beneath), never an empty cell or a dash - a dash reads as missing data rather than as a stall. In the goal list a milestone row shows "no pace window" instead of an Unknown chip, because Unknown reads as a failed measurement rather than a category that does not apply.

### Pace status chips
Reuse the existing chip vocabulary; do not invent a new one. Same typography as the placements-ledger `STATUS_PILL` (`px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide`), with:
- **Ahead** - the brand-outline positive tone (`rounded-md border border-court-brand bg-transparent text-court-brand`), the same treatment COLLECTED uses.
- **On pace** - the neutral slate family.
- **Behind** - the negative red family.
- **Unknown** - the one addition, and a TONE not a new style: same shape and type in `border-court-border` / `text-court-fg-dim`, the muted treatment the app already uses for empty values. It has to be visually distinct from On pace, which owns neutral slate. "We could not measure this" must never read as a status.

### Approval queue
Rendered above the goal list, only for a `goalLevel` 0 viewer, and **only when it has rows - never as an empty panel.** An always-present empty panel trains the eye to skip the one place a real request has to be noticed. Rows follow the Ace 68.0 row standard (one bold element - the metric label - everything else at one metadata size). Approve uses the brand-green confirm treatment with `CheckCircle2`; Decline uses the reject treatment with `XCircle`. Declining opens an inline required reason field rather than firing straight from the button, because the reason is mandatory.

### Charts on this surface
No charting library and no SVG, matching the Scoreboard Deal Funnel and the Finances TrendCard: a rounded `bg-court-surface-subtle` track with `overflow-hidden` and an absolutely positioned `bg-court-brand-tint` fill grown by width % (horizontal) or height % (vertical). That idiom cannot express a two-series line, so the pace chart draws cumulative billed as a per-bucket fill with the required pace as a thin rule across each column at its own height - reading the rules left to right gives the pace line. Both series are named in a legend and repeated as numbers.

### The pace chart tracks the headline tier
The cumulative curve must be drawn from the SAME tier the headline uses, or it will not land on the headline's number. When earned became the pacing figure the chart moved from billed invoices to earned placements with it. If the headline tier ever changes again, the chart moves too - this is a correctness constraint, not a labelling one.

### Null is never zero
Any metric that cannot be measured renders a muted dash plus "not tracked yet". A zero is a measured result and must look different from an absence - this is why `AVG_DEAL_SIZE` with no placements shows a dash, not $0.
