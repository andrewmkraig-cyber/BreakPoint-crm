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
          ].join(" "),
        },
      },
    }),
  ],
  session: { strategy: "database" },
  pages: {
    signIn: "/sign-in",
  },
  callbacks: {
    async signIn({ profile }) {
      const email = profile?.email ?? "";
      const hd = (profile as { hd?: string } | null | undefined)?.hd;
      return email.endsWith(`@${ALLOWED_DOMAIN}`) || hd === ALLOWED_DOMAIN;
    },
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
        session.user.role = (user as { role?: string }).role ?? "ADMIN";
      }
      return session;
    },
  },
};
