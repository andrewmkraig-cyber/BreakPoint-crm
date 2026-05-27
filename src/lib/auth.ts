import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";

const ALLOWED_DOMAIN = "breakpointtalent.com";

// The OAuth scopes Ace requests from Google. Exported so diagnostic code
// (see /api/debug/oauth-status) can compare against what Google actually
// granted and what our stored Account row has.
export const GOOGLE_SCOPES: readonly string[] = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.send",
  // Phase-6 Mail Tab: read-only access to list + fetch Gmail threads for
  // the signed-in user's own inbox. No cross-user reads — every call
  // runs against the caller's refresh token. If a user signed in before
  // this scope existed they'll need to sign out + back in; Google will
  // re-prompt consent because the requested scope set changed.
  "https://www.googleapis.com/auth/gmail.readonly",
  // Phase-6.1 Archive button: lets us POST to threads.modify to remove
  // the INBOX label on a thread (Gmail's native "archive" action).
  // Scoped to the signed-in user's own mailbox — no cross-user writes.
  // Requires a re-auth the first time, same as the readonly scope.
  "https://www.googleapis.com/auth/gmail.modify",
  // Push-to-Gmail signature button (Settings → Branding): writes the
  // Ace-rendered signature into the user's Gmail SendAs settings so it
  // appears when they compose directly in gmail.com (not just on
  // mail Ace sends). Users granted before this scope was added must
  // sign out and back in once for Google to re-prompt consent — the
  // /settings/branding push action surfaces a clear toast and points
  // them at the re-auth path on 403.
  "https://www.googleapis.com/auth/gmail.settings.basic",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/meetings.space.settings",
];

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
          scope: GOOGLE_SCOPES.join(" "),
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
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role ?? "ADMIN";
        // PrismaAdapter sets token.picture automatically from
        // user.image on first sign-in; re-stamp it explicitly so the
        // post-upload refresh path below always has a stable home for
        // the latest URL.
        if (user.image !== undefined) {
          token.picture = user.image;
        }
      }
      // useSession().update({ image: '/api/avatar/<userId>?v=...' })
      // from the profile-picture uploader lands here as
      // `trigger === "update"`. Accepting an image override here is
      // how the topbar + sidebar avatar update instantly after upload,
      // instead of forcing the user to sign out + back in.
      if (
        trigger === "update" &&
        session &&
        typeof session === "object" &&
        "image" in session
      ) {
        const next = (session as { image?: string | null }).image;
        if (next === null || typeof next === "string") {
          token.picture = next;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token) {
        session.user.id = (token.id as string) ?? token.sub ?? "";
        session.user.role = (token.role as string) ?? "ADMIN";
        // NextAuth usually lifts token.picture → session.user.image
        // by default, but only when the picture also changed during
        // sign-in. Setting it explicitly makes the update() path
        // above reliable across all NextAuth versions/builds.
        if (token.picture !== undefined) {
          session.user.image = (token.picture as string | null) ?? null;
        }
      }
      return session;
    },
  },
  events: {
    // Force-update the user's Account row on EVERY sign-in with whatever
    // Google just returned. NextAuth's PrismaAdapter calls linkAccount
    // only on the first connection; on subsequent sign-ins the existing
    // Account row is left alone, so a stale (revoked) refresh_token will
    // stay in the DB even after the user revokes + re-consents at
    // myaccount.google.com/permissions. This upsert guarantees the latest
    // tokens + scope list overwrite the old ones.
    //
    // The log line is intentional: it's the only way to confirm which
    // scopes Google actually granted (they may silently drop unlisted
    // scopes like meetings.space.settings if the scope isn't registered
    // on the Cloud Console OAuth consent screen). Tail Vercel logs during
    // a sign-in to see what came back.
    async signIn({ account }) {
      if (!account || account.provider !== "google") return;
      const scope = typeof account.scope === "string" ? account.scope : "";
      const requested = GOOGLE_SCOPES;
      const granted = scope.split(/\s+/).filter(Boolean);
      const missing = requested.filter((s) => !granted.includes(s));
      console.log(
        `[NextAuth signIn] google providerAccountId=${account.providerAccountId} ` +
          `grantedScopes=[${granted.join(", ")}] missingScopes=[${missing.join(", ")}] ` +
          `hasRefreshToken=${Boolean(account.refresh_token)} expiresAt=${account.expires_at}`,
      );
      if (missing.length > 0) {
        console.warn(
          `[NextAuth signIn] Google dropped ${missing.length} requested scope(s). ` +
            `Most likely cause: the scope isn't registered on the OAuth consent screen in ` +
            `Google Cloud Console. Missing: ${missing.join(", ")}`,
        );
      }
      try {
        await prisma.account.updateMany({
          where: { provider: "google", providerAccountId: account.providerAccountId },
          data: {
            access_token: account.access_token ?? undefined,
            refresh_token: account.refresh_token ?? undefined,
            expires_at: account.expires_at ?? undefined,
            token_type: account.token_type ?? undefined,
            scope: account.scope ?? undefined,
            id_token: account.id_token ?? undefined,
          },
        });
      } catch (e) {
        console.error("[NextAuth signIn] Account upsert failed:", e);
      }
    },
  },
};
