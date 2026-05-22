"use client";

import Link from "next/link";
import { Moon, Sun } from "lucide-react";
import { TopBarSearch } from "@/components/top-bar-search";
import { ComposeFAB } from "@/components/mail/compose-fab";
import { TopBarPageAction, TopBarPageTitle } from "@/components/top-bar-page-title";
import { MobileNav } from "@/components/mobile-nav";
import { BrandMark } from "@/components/brand-mark";
import { InConversation } from "@/components/icons/in-conversation";
import { useClaudePanel } from "@/lib/claude-panel-context";
import { useYouTubePanel } from "@/components/youtube-panel/YouTubePanelProvider";
import { useSpotifyPanel } from "@/components/spotify-panel/SpotifyPanelProvider";
import { useCourtMode } from "@/lib/court-mode";
import { WeatherWidget } from "@/components/weather-widget";
import { CalendarPopoverButton } from "@/components/calendar-popover-button";

export function TopBar() {
  const { open: claudeOpen, toggle: toggleClaude } = useClaudePanel();
  const { open: youtubeOpen, toggle: toggleYouTube } = useYouTubePanel();
  const { open: spotifyOpen, toggle: toggleSpotify } = useSpotifyPanel();
  // Light/Dark toggle reuses the exact mechanism Auto Night Mode drives:
  // toggleTheme flips only the data-theme axis on <html> (never the
  // surface) and writes ace-court-theme. It does NOT touch the auto-night
  // window marker, so a manual flip stands until the next 7 AM / 7 PM ET
  // boundary - identical to the manual-override behavior in the Auto
  // Night Mode spec.
  const { theme, toggleTheme } = useCourtMode();
  const nextThemeLabel = theme === "light" ? "Dark theme" : "Light theme";

  // Desktop: h-20 (80px) icon row matches the sidebar header. PWA / mobile:
  // the header wraps onto two rows. Row 1 carries the Ace brand lockup
  // top-left and the icon cluster (toggle, FAB, chat, weather, calendar)
  // top-right. Row 2 (the `order-last w-full` wrapper) carries the
  // hamburger + the full-width search line. md:contents dissolves that
  // wrapper on desktop so its children (hamburger, search) drop back into
  // their original single-row desktop slots. Single TopBarSearch instance
  // throughout - duplicating it would mount two debounced inputs, two
  // dropdowns, two server actions in flight.
  return (
    <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 bg-court-surface px-4 pb-2 pt-3 md:h-20 md:flex-nowrap md:gap-4 md:px-6 md:pb-0 md:pt-0">
      {/* PWA-only top-left brand lockup. Reuses BrandMark - the same
          Serve-Arc disc + "Ace" wordmark the desktop sidebar shows - so
          the installed PWA gets the sidebar's logo treatment in the
          corner the desktop sidebar would otherwise own. Hidden at md+
          where the real sidebar carries the mark. */}
      <Link
        href="/dashboard"
        aria-label="Ace dashboard"
        className="flex h-14 shrink-0 items-center transition-opacity hover:opacity-80 md:hidden"
      >
        <BrandMark />
      </Link>

      {/* Page title (breadcrumb "Group > Page") sits to the left, search
          bar tucks immediately to its right, and the page's +Add action
          (when present) sits just to the right of search - that whole
          cluster is the left half of the desktop topbar. The flex-1
          spacer pushes the right cluster out to the right edge. */}
      <div className="hidden min-w-0 items-center lg:flex">
        <TopBarPageTitle />
      </div>

      {/* Row 2 on PWA: hamburger + search bar, hamburger to the LEFT of
          the search input. `order-last w-full` drops the whole group to
          its own line beneath row 1; `md:contents` dissolves the wrapper
          on desktop so the hamburger (hidden at md+) and the search box
          return to their single-row desktop positions unchanged. */}
      <div className="order-last flex w-full items-center gap-2 md:order-none md:contents">
        <div className="flex h-14 items-center md:hidden">
          <MobileNav />
        </div>
        <div className="min-w-0 flex-1 md:w-56 md:flex-none lg:ml-8 lg:w-64 xl:ml-12 xl:w-80 2xl:w-96">
          <div className="rounded-full border border-court-border bg-court-surface transition focus-within:border-court-accent">
            <TopBarSearch />
          </div>
        </div>
      </div>

      <div className="hidden shrink-0 lg:block">
        <TopBarPageAction />
      </div>

      <div className="hidden flex-1 lg:block" />

      {/* Right cluster. Every element here is a fixed h-10 (40px) so the
          tops and bottoms line up on one vertically-centered row: the
          Light/Dark toggle, the green + FAB, the chat icon, the
          weather chip, and the calendar chip. The profile avatar that
          used to close out this row is gone - the sidebar/drawer
          profile card is the single source for profile. */}
      <div className="flex h-14 items-center gap-3 md:h-auto">
        {/* Light/Dark toggle - DESKTOP ONLY (hidden below md). On the
            mobile PWA this control moves into the hamburger drawer (below
            Settings) so the topbar icon row stays on one line. Same h-10
            w-10 icon-button vocabulary as the FAB + chat buttons. Shows
            the Moon in Light mode (click -> Dark) and the Sun in Dark mode
            (click -> Light). Flips only the Light/Dark axis on the active
            court; the surface (Hard/Clay/Grass/Night) is untouched. */}
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={nextThemeLabel}
          title={nextThemeLabel}
          className="group relative hidden h-10 w-10 shrink-0 items-center justify-center rounded-full border border-court-brand bg-court-brand-tint text-court-brand-dark shadow-sm transition-all duration-150 ease-out hover:-translate-y-0.5 hover:bg-court-brand/30 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-court-brand/40 md:inline-flex"
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-full mr-2 whitespace-nowrap rounded-md bg-court-fg px-2 py-1 text-xs font-medium text-court-surface opacity-0 transition-opacity duration-150 group-hover:opacity-100"
          >
            {nextThemeLabel}
          </span>
          {theme === "light" ? (
            <Moon className="h-5 w-5" />
          ) : (
            <Sun className="h-5 w-5" />
          )}
        </button>
        <ComposeFAB />
        {/* Matches ComposeFAB's icon-button vocabulary: same h-10 w-10
            footprint, same rounded-full + brand border + brand-tint
            wash, same hover lift, same focus ring. The "open" state
            inverts to a filled brand pill so the recruiter can see at
            a glance whether the panel is mounted, but the closed state
            is visually identical to the + button so they read as a
            pair, not a sticker plus a native control. */}
        <button
          type="button"
          onClick={toggleClaude}
          aria-label="Ace Assistant"
          aria-pressed={claudeOpen}
          className={
            "group relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border shadow-sm transition-all duration-150 ease-out hover:-translate-y-0.5 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-court-brand/40 " +
            (claudeOpen
              ? "border-court-brand-dark bg-court-brand text-white hover:bg-court-brand-dark"
              : "border-court-brand bg-court-brand-tint text-court-brand-dark hover:bg-court-brand/30")
          }
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-full mr-2 whitespace-nowrap rounded-md bg-court-fg px-2 py-1 text-xs font-medium text-court-surface opacity-0 transition-opacity duration-150 group-hover:opacity-100"
          >
            Ace Assistant
          </span>
          <InConversation size={22} />
        </button>
        <button
          type="button"
          onClick={toggleYouTube}
          aria-label="YouTube"
          aria-pressed={youtubeOpen}
          className={
            "group relative hidden h-10 w-10 shrink-0 items-center justify-center rounded-full border shadow-sm transition-all duration-150 ease-out hover:-translate-y-0.5 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-court-brand/40 md:inline-flex " +
            (youtubeOpen
              ? "border-court-brand-dark bg-court-brand text-white hover:bg-court-brand-dark"
              : "border-court-brand bg-court-brand-tint text-court-brand-dark hover:bg-court-brand/30")
          }
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-full mr-2 whitespace-nowrap rounded-md bg-court-fg px-2 py-1 text-xs font-medium text-court-surface opacity-0 transition-opacity duration-150 group-hover:opacity-100"
          >
            YouTube
          </span>
          {/* Ringed play triangle to match the YouTube Music app icon
              - same colors and same 40px button, just a ring + filled
              triangle inside instead of the bare lucide Play glyph.
              Lucide's PlayCircle would fill the outer circle along with
              the triangle when `fill="currentColor"` is set, so the
              ring would disappear. Hand-rolled SVG keeps the circle
              stroke-only and fills just the triangle. */}
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            aria-hidden="true"
          >
            <circle
              cx="12"
              cy="12"
              r="10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            />
            <path
              d="M10 8.5 L16 12 L10 15.5 Z"
              fill="currentColor"
              stroke="currentColor"
              strokeWidth="1"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          onClick={toggleSpotify}
          aria-label="Spotify"
          aria-pressed={spotifyOpen}
          className={
            "group relative hidden h-10 w-10 shrink-0 items-center justify-center rounded-full border shadow-sm transition-all duration-150 ease-out hover:-translate-y-0.5 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-court-brand/40 md:inline-flex " +
            (spotifyOpen
              ? "border-court-brand-dark bg-court-brand text-white hover:bg-court-brand-dark"
              : "border-court-brand bg-court-brand-tint text-court-brand-dark hover:bg-court-brand/30")
          }
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-full mr-2 whitespace-nowrap rounded-md bg-court-fg px-2 py-1 text-xs font-medium text-court-surface opacity-0 transition-opacity duration-150 group-hover:opacity-100"
          >
            Spotify
          </span>
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
          </svg>
        </button>
        <span
          aria-hidden="true"
          className="mx-1 hidden h-7 w-px bg-court-border md:inline-block"
        />
        <WeatherWidget />
        <CalendarPopoverButton />
      </div>
    </header>
  );
}
