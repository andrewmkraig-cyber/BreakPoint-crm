"use client";

import { Music, Play } from "lucide-react";
import { TopBarSearch } from "@/components/top-bar-search";
import { ComposeFAB } from "@/components/mail/compose-fab";
import { TopBarPageAction, TopBarPageTitle } from "@/components/top-bar-page-title";
import { MobileNav } from "@/components/mobile-nav";
import { InConversation } from "@/components/icons/in-conversation";
import { useClaudePanel } from "@/lib/claude-panel-context";
import { useYouTubePanel } from "@/components/youtube-panel/YouTubePanelProvider";
import { useSpotifyPanel } from "@/components/spotify-panel/SpotifyPanelProvider";
import { WeatherWidget } from "@/components/weather-widget";
import { CalendarPopoverButton } from "@/components/calendar-popover-button";

export function TopBar() {
  const { open: claudeOpen, toggle: toggleClaude } = useClaudePanel();
  const { open: youtubeOpen, toggle: toggleYouTube } = useYouTubePanel();
  const { open: spotifyOpen, toggle: toggleSpotify } = useSpotifyPanel();

  // h-20 (80px) on the header — matches the sidebar's Ace/BreakPoint
  // header so the topbar's bottom edge aligns with the sidebar
  // header's bottom border on every page. Previously h-[72px] sat 8px
  // above that line, making page titles (e.g. "Settings") read as
  // floating higher than the sidebar wordmark.
  return (
    <header className="sticky top-0 z-30 flex h-20 items-center justify-between gap-4 bg-court-surface px-6">
      {/* MobileNav appears only below md (where the desktop sidebar is
          hidden). Click opens a left drawer with the same nav groups
          the sidebar shows so the recruiter never loses access to nav
          on a phone or shrunk window. */}
      <MobileNav />
      {/* Page title (breadcrumb "Group › Page") sits to the left, search
          bar tucks immediately to its right, and the page's +Add action
          (when present) sits just to the right of search — that whole
          cluster is the left half of the topbar. The flex-1 spacer
          pushes the right cluster (four buttons + weather + profile)
          out to the right edge. */}
      <div className="hidden min-w-0 items-center lg:flex">
        <TopBarPageTitle />
      </div>

      <div className="min-w-0 flex-1 md:flex-none md:w-56 lg:ml-8 lg:w-64 xl:ml-12 xl:w-80 2xl:w-96">
        <div className="rounded-full border border-court-border bg-court-surface transition focus-within:border-court-accent">
          <TopBarSearch />
        </div>
      </div>

      <div className="hidden shrink-0 lg:block">
        <TopBarPageAction />
      </div>

      <div className="hidden flex-1 lg:block" />

      <div className="flex items-center gap-3">
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
        {/* YouTube + Spotify share a slightly tighter (h-9 w-9)
            footprint than the Claude / Compose buttons so the topbar
            doesn't feel crowded with media affordances. */}
        <button
          type="button"
          onClick={toggleYouTube}
          aria-label="YouTube"
          aria-pressed={youtubeOpen}
          className={
            "group relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border shadow-sm transition-all duration-150 ease-out hover:-translate-y-0.5 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-court-brand/40 " +
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
          <Play className="h-4 w-4" fill="currentColor" />
        </button>
        <button
          type="button"
          onClick={toggleSpotify}
          aria-label="Spotify"
          aria-pressed={spotifyOpen}
          className={
            "group relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border shadow-sm transition-all duration-150 ease-out hover:-translate-y-0.5 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-court-brand/40 " +
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
          <Music className="h-4 w-4" />
        </button>
        <WeatherWidget />
        <CalendarPopoverButton />
      </div>
    </header>
  );
}
