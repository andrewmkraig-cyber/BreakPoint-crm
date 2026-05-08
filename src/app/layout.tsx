import type { Metadata } from "next";
import { Bricolage_Grotesque, Inter } from "next/font/google";
import { getServerSession } from "next-auth";
import "./globals.css";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/app-shell";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUnreadMailCount } from "@/lib/gmail";
import {
  COURT_MODE_PRE_HYDRATION_SCRIPT,
  CourtModeProvider,
} from "@/lib/court-mode";

// Bricolage Grotesque is a chunky modern grotesque — heavy weights
// land in the same "friendly premium display sans" register as
// Yahoo's wordmark, which the recruiter pointed at as the look they
// wanted for the Ace mark and page headers.
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
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
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/ace-mark.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
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
  if (session?.user?.email) {
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true },
    });
    if (user) unreadMailCount = await getUnreadMailCount(user.id);
  }

  return (
    <html lang="en" className={`${bricolage.variable} ${inter.variable}`}>
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
          <CourtModeProvider>
            <AppShell unreadMailCount={unreadMailCount}>{children}</AppShell>
          </CourtModeProvider>
        </Providers>
      </body>
    </html>
  );
}
