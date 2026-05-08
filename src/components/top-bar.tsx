"use client";

import { Music, Play } from "lucide-react";
import { useSession } from "next-auth/react";
import { TopBarSearch } from "@/components/top-bar-search";
import { ComposeFAB } from "@/components/mail/compose-fab";
import { TopBarPageTitle } from "@/components/top-bar-page-title";
import { MobileNav } from "@/components/mobile-nav";
import { TopBarProfileCard } from "@/components/top-bar-profile-card";
import { InConversation } from "@/components/icons/in-conversation";
import { useClaudePanel } from "@/lib/claude-panel-context";
import { useYouTubePanel } from "@/components/youtube-panel/YouTubePanelProvider";
import { useSpotifyPanel } from "@/components/spotify-panel/SpotifyPanelProvider";
import { WeatherWidget } from "@/components/weather-widget";

export function TopBar() {
  const { data: session } = useSession();
  const user = session?.user;
  const { open: claudeOpen, toggle: toggleClaude } = useClaudePanel();
  const { open: youtubeOpen, toggle: toggleYouTube } = useYouTubePanel();
  const { open: spotifyOpen, toggle: toggleSpotify } = useSpotifyPanel();

  return (
    <header className="sticky top-0 z-30 flex h-[72px] items-center justify-between gap-4 bg-court-surface px-6">
      {/* MobileNav appears only below md (where the desktop sidebar is
          hidden). Click opens a left drawer with the same nav groups
          the sidebar shows so the recruiter never loses access to nav
          on a phone or shrunk window. */}
      <MobileNav />
      {/* Page title + inline action button — pathname-driven. Replaces
          the previous in-page PageHeader pattern; pages render their
          content flush with the topbar now. */}
      <div className="hidden min-w-0 items-center lg:flex">
        <TopBarPageTitle />
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-3 md:flex-none md:justify-start">
        {/* Search width scales with viewport so the title block on
            the left and the action-icon row on the right don't get
            squeezed into overlap on lg-but-not-xl viewports. Below
            md it stays full-width (mobile flow). */}
        <div className="min-w-0 flex-1 md:flex-none md:w-56 lg:w-64 xl:w-80 2xl:w-96">
          <div className="rounded-lg border border-court-border bg-court-surface-subtle/60 transition focus-within:border-court-accent focus-within:bg-court-surface">
            <TopBarSearch />
          </div>
        </div>
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
      </div>

      <div className="flex items-center gap-3">
        <WeatherWidget />
        <TopBarProfileCard name={user?.name ?? null} imageUrl={user?.image ?? null} />
      </div>
    </header>
  );
}
