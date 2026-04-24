import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import sanitizeHtml from "sanitize-html";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getGmailThread, type MailThreadDetail } from "@/lib/gmail";

export const dynamic = "force-dynamic";

// Mail Tab detail endpoint. Scoped implicitly to the signed-in user's own
// Gmail account — the underlying Google access token is derived from
// that user's Account row, so there is no way for caller A to read
// caller B's inbox through this route. No tenant write happens, so
// organizationId scoping isn't relevant to the query itself (the user
// is the tenant boundary for Gmail reads).
//
// Sanitization runs server-side: we never hand raw Gmail HTML to the
// client. `allowedTags`/`allowedAttributes` match the set that renders
// typical business email faithfully (links, formatting, inline images
// as cid:... refs that the browser ignores) while dropping every
// script/event-handler/style vector.
export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  });
  if (!user) return NextResponse.json({ error: "Unknown user" }, { status: 401 });

  try {
    const detail = await getGmailThread(user.id, params.id);
    const safe: MailThreadDetail = {
      ...detail,
      messages: detail.messages.map((m) => ({
        ...m,
        bodyHtml: sanitizeHtml(m.bodyHtml, {
          allowedTags: [
            ...sanitizeHtml.defaults.allowedTags,
            "img",
            "pre",
            "h1",
            "h2",
            "h3",
            "span",
            "font",
          ],
          allowedAttributes: {
            a: ["href", "name", "target", "rel"],
            img: ["src", "alt", "width", "height"],
            span: ["class"],
            pre: ["class"],
            font: ["color"],
            "*": ["class"],
          },
          allowedSchemes: ["http", "https", "mailto", "tel", "cid", "data"],
          // Strip the dangerous-by-default style attribute entirely —
          // Gmail HTML is full of inline CSS but we prefer a consistent
          // look inside Ace over the sender's original palette.
          disallowedTagsMode: "discard",
          transformTags: {
            a: (tagName, attribs) => ({
              tagName,
              attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer" },
            }),
          },
        }),
      })),
    };
    return NextResponse.json(safe);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load thread";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
