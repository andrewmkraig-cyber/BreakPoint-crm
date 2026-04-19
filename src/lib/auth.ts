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
          // `consent` forces Google to show the consent screen every sign-in.
          // `include_granted_scopes=true` tells Google to add any NEW scopes
          // requested on top of whatever was previously granted, rather than
          // issuing a token scoped to only the current request. Together
          // these ensure that newly-added scopes (e.g. meetings.space.settings)
          // actually reach the stored refresh token when a user signs in
          // again. If a user is stuck with an old scope set, they also need
          // to revoke Ace at myaccount.google.com/permissions first — Google
          // caches consent per app and may skip the screen if the existing
          // grant still covers the request.
          prompt: "consent",
          access_type: "offline",
          response_type: "code",
          include_granted_scopes: "true",
          hd: ALLOWED_DOMAIN,
          scope: [
            "openid",
            "email",
            "profile",
            "https://www.googleapis.com/auth/gmail.send",
            "https://www.googleapis.com/auth/calendar.events",
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
