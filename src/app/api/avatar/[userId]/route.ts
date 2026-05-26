import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Streams a recruiter's uploaded profile picture as a raw image. The
// URL `/api/avatar/<userId>?v=<timestamp>` is what the upload action
// stashes into User.image, so it flows through NextAuth straight to
// session.user.image and every avatar surface that reads it (topbar,
// sidebar profile card, calendar team list, event tile owner dots).
//
// Returns 404 when the user hasn't uploaded one — callers (and the
// <Image onError> fallback in the topbar) then degrade to initials.
//
// Auth: any signed-in user can read any teammate's avatar. Ace is a
// two-person internal CRM so cross-user reads inside the org are
// fine; we just gate against unauthenticated requests.

export async function GET(
  _req: Request,
  { params }: { params: { userId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = params.userId;
  if (!userId) {
    return NextResponse.json({ error: "Missing userId" }, { status: 400 });
  }

  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: { profileImageData: true, profileImageMimeType: true },
  });
  if (!profile?.profileImageData) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const bytes = profile.profileImageData;
  return new Response(bytes, {
    headers: {
      "Content-Type": profile.profileImageMimeType ?? "image/png",
      // 5-minute private cache: long enough that the topbar/sidebar
      // don't re-fetch on every page nav, short enough that a fresh
      // upload (which also bumps ?v=<timestamp>) is visible quickly.
      "Cache-Control": "private, max-age=300",
      "Content-Length": String(bytes.byteLength),
    },
  });
}
