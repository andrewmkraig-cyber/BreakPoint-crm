import type { Metadata, Viewport } from "next";
import { Outfit, Inter } from "next/font/google";
import { getServerSession } from "next-auth";
import "./globals.css";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/app-shell";
import { ReminderToastProvider } from "@/components/reminder-toast-provider";
import { SwRegister } from "@/components/sw-register";
import { PwaInstallPrompt } from "@/components/pwa-install-prompt";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUnreadMailCount } from "@/lib/gmail";
import {
  COURT_MODE_PRE_HYDRATION_SCRIPT,
  CourtModeProvider,
} from "@/lib/court-mode";

// Outfit is a geometric sans with single-story `a`, perfectly round
// `o`, and a heavy 900 weight — the closest free analog to Yahoo's
// wordmark, which is the look Andrew wanted for the Ace mark and
// every page header. Loaded weights cover every font-serif callsite
// (medium 500 / semibold 600 / bold 700 / extrabold 800) plus the
// 900 reserve for display lockups.
const outfit = Outfit({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  variable: "--font-display",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Ace · BreakPoint Talent",
  description: "Ace — BreakPoint Talent's internal recruiting CRM",
  // ?v=2 busts the manifest cache so installed PWAs pick up the real
  // Ace logo from P3 / refreshed metadata without users having to
  // uninstall + reinstall by hand. Bump this when the manifest
  // (icons, theme, name) changes again.
  manifest: "/manifest.json?v=3",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Ace",
  },
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/ace-mark.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png" },
      { url: "/icons/icon-192.png?v=2", sizes: "192x192" },
    ],
  },
};

// Next 14 moved themeColor from `metadata` to the `viewport` export.
export const viewport: Viewport = {
  themeColor: "#5A9642",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Ace 22.0 — sidebar Mail badge. Gmail's threads.list with
  // q="in:inbox is:unread" returns resultSizeEstimate even at
  // maxResults=1, so this is a single cheap API call per render. Errors
  // collapse to 0 inside getUnreadMailCount — the badge is decorative
  // and must never block layout rendering. Skipped entirely when the
  // user isn't signed in (sign-in surface doesn't show the sidebar).
  const session = await getServerSession(authOptions);
  let unreadMailCount = 0;
  let autoNightMode = false;
  if (session?.user?.email) {
    // Wrapped so a profile/mail lookup hiccup never 500s the app shell -
    // this runs on every page render. Both values are decorative defaults
    // (0 badge, light theme) if the read fails.
    try {
      const user = await prisma.user.findUnique({
        where: { email: session.user.email },
        select: { id: true, profile: { select: { autoNightMode: true } } },
      });
      if (user) {
        unreadMailCount = await getUnreadMailCount(user.id);
        autoNightMode = user.profile?.autoNightMode ?? false;
      }
    } catch {
      // Keep the defaults.
    }
  }

  return (
    <html lang="en" className={`${outfit.variable} ${inter.variable}`}>
      <body className="font-sans">
        {/* Runs before React hydrates and stamps data-surface +
            data-theme onto <html> based on the persisted court mode.
            Also one-shot migrates the legacy single-key "courtMode"
            value to the new two-key scheme. Without this, the first
            paint is always default Hard/Light and flashes to the
            stored palette when the provider's useEffect fires later. */}
        <script
          dangerouslySetInnerHTML={{ __html: COURT_MODE_PRE_HYDRATION_SCRIPT }}
        />
        <Providers>
          <CourtModeProvider initialAutoNightMode={autoNightMode}>
            <AppShell unreadMailCount={unreadMailCount}>{children}</AppShell>
            <ReminderToastProvider />
          </CourtModeProvider>
        </Providers>
        <SwRegister />
        <PwaInstallPrompt />
      </body>
    </html>
  );
}
