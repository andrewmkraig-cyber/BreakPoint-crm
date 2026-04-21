import type { Metadata } from "next";
import { Cormorant_Garamond, DM_Sans } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/app-shell";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
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
            <AppShell>{children}</AppShell>
          </CourtModeProvider>
        </Providers>
      </body>
    </html>
  );
}
