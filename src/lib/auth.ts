import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";

const ALLOWED_DOMAIN = "breakpointtalent.com";

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      authorization: {
        params: {
          prompt: "consent",
          access_type: "offline",
          response_type: "code",
          hd: ALLOWED_DOMAIN,
          scope: [
            "openid",
            "email",
            "profile",
            "https://www.googleapis.com/auth/gmail.send",
            "https://www.googleapis.com/auth/calendar.events",
            // Meet space settings — used to set accessType=OPEN on the
            // Meet that Calendar auto-creates for video interviews. Users
            // who signed in before this scope was added need to sign out
            // and back in; the Meet setup call degrades gracefully if the
            // scope is missing so the event still works.
            "https://www.googleapis.com/auth/meetings.space.settings",
          ].join(" "),
        },
      },
    }),
  ],
  // JWT strategy is required for `next-auth/middleware` to recognize the session.
  // The PrismaAdapter still persists User + Account rows (so we can look up the
  // stored Google access/refresh tokens later for Gmail + Calendar calls).
  session: { strategy: "jwt" },
  pages: {
    signIn: "/sign-in",
  },
  callbacks: {
    async signIn({ profile }) {
      const email = profile?.email ?? "";
      const hd = (profile as { hd?: string } | null | undefined)?.hd;
      return email.endsWith(`@${ALLOWED_DOMAIN}`) || hd === ALLOWED_DOMAIN;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role ?? "ADMIN";
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token) {
        session.user.id = (token.id as string) ?? token.sub ?? "";
        session.user.role = (token.role as string) ?? "ADMIN";
      }
      return session;
    },
  },
};
