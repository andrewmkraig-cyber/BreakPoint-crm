import type { Metadata } from "next";
import { Cormorant_Garamond, DM_Sans } from "next/font/google";
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

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-cormorant",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-dm-sans",
});

export const metadata: Metadata = {
  title: "Ace · BreakPoint Talent",
  description: "Ace — BreakPoint Talent's internal recruiting CRM",
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
    <html lang="en" className={`${cormorant.variable} ${dmSans.variable}`}>
      <body className="font-sans">
        {/* Runs before React hydrates and stamps `.dark` or `.grass` onto
            <html> based on the persisted courtMode. Without this, the first
            paint is always Hard Court and flashes to the stored mode when
            the provider's useEffect fires a tick later. */}
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
