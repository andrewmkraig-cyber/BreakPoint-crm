import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import sanitizeHtml from "sanitize-html";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import {
  extractEmailsFromHeader,
  getGmailThread,
  tagThreadByAddresses,
  type MailThreadDetail,
} from "@/lib/gmail";

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

    // Auto-tag the thread to candidate/client profiles whose address
    // appears in any sender/recipient header. Idempotent upserts; failure
    // here must not break the read path.
    const senderClientByEmail = new Map<string, { slug: string; name: string }>();
    try {
      const org = await getCurrentOrg();
      const addresses = detail.messages.flatMap((m) => [
        m.fromEmail,
        ...extractEmailsFromHeader(m.to),
        ...extractEmailsFromHeader(m.cc),
      ]);
      await tagThreadByAddresses({
        threadId: detail.id,
        addresses,
        organizationId: org.id,
      });

      // Resolve each unique sender address to a Contact's Client so the
      // MessageBlock can render an "Open client" link. We only look at
      // fromEmail here — recipient-side matches (the recruiter being
      // To/Cc'd) aren't useful for that affordance. Tenant-scoped via
      // the same org boundary as the auto-tag step above.
      const fromEmails = Array.from(
        new Set(
          detail.messages
            .map((m) => (m.fromEmail || "").trim().toLowerCase())
            .filter(Boolean),
        ),
      );
      if (fromEmails.length > 0) {
        const contacts = await prisma.contact.findMany({
          where: {
            organizationId: org.id,
            emails: { hasSome: fromEmails },
            client: { isNot: null },
          },
          select: {
            emails: true,
            client: { select: { id: true, legacyRfId: true, name: true } },
          },
        });
        for (const c of contacts) {
          if (!c.client) continue;
          const slug =
            c.client.legacyRfId != null ? String(c.client.legacyRfId) : c.client.id;
          for (const e of c.emails) {
            const key = e.trim().toLowerCase();
            if (!key || senderClientByEmail.has(key)) continue;
            senderClientByEmail.set(key, {
              slug,
              name: c.client.name || "client",
            });
          }
        }
      }
    } catch (tagErr) {
      console.warn("[mail/threads GET] auto-tag failed", tagErr);
    }

    const safe: MailThreadDetail = {
      ...detail,
      // detail already carries draftId from getGmailThread when one of
      // the thread's messages has the DRAFT label. We spread `...detail`
      // so it flows through verbatim — no transformation needed; the
      // draft id is an opaque Gmail handle.
      messages: detail.messages.map((m) => ({
        ...m,
        senderClient:
          senderClientByEmail.get((m.fromEmail || "").trim().toLowerCase()) ?? null,
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
            // Marketing/newsletter HTML (Quo, MailerLite, Mailchimp, etc.)
            // ships a full document with a head-level <style> block that
            // drives the dark-theme background, centered content column,
            // CTA button geometry, etc. Without these tags whitelisted
            // sanitize-html flattens the design to body-fragment text and
            // the layout collapses. Safe to render because the client
            // viewer drops the result inside a sandboxed iframe (no
            // allow-scripts) so any inline scripts/event handlers are
            // inert. <center> is the legacy email-safe centering element
            // newsletters still use; <u>/<s> for inline emphasis.
            "html",
            "head",
            "body",
            "style",
            "meta",
            "title",
            "center",
            "u",
            "s",
          ],
          // Required when <style> is in allowedTags — sanitize-html flags
          // it as vulnerable (CSS expressions in legacy IE), but modern
          // browsers don't execute CSS expressions, and the iframe sandbox
          // forbids scripts anyway. Trade is needed to render newsletters.
          allowVulnerableTags: true,
          allowedAttributes: {
            a: ["href", "name", "target", "rel", "style"],
            img: ["src", "alt", "width", "height", "style", "align", "border"],
            // Email signatures lean heavily on table layout with legacy
            // HTML attrs (cellpadding/cellspacing/align/valign/width).
            // Stripping them collapsed Gmail-shaped signatures into the
            // wrong column structure — the BreakPoint logo split off
            // from the contact rows. Whitelist them so multi-cell
            // signatures + Quo-style avatar+body messages render with
            // the same geometry the sender designed. bgcolor/background
            // are the email-safe way to paint section backgrounds (Quo
            // newsletter dark cards).
            table: ["cellpadding", "cellspacing", "border", "align", "width", "height", "bgcolor", "background", "style", "class"],
            tr: ["align", "valign", "bgcolor", "style", "class"],
            td: ["align", "valign", "width", "height", "colspan", "rowspan", "bgcolor", "background", "style", "class"],
            th: ["align", "valign", "width", "height", "colspan", "rowspan", "bgcolor", "background", "style", "class"],
            div: ["style", "class", "align", "bgcolor"],
            p: ["style", "class", "align"],
            span: ["class", "style"],
            pre: ["class", "style"],
            font: ["color", "size", "face"],
            h1: ["style", "class"],
            h2: ["style", "class"],
            h3: ["style", "class"],
            blockquote: ["style", "class"],
            ul: ["style", "class"],
            ol: ["style", "class"],
            li: ["style", "class"],
            // Document chrome — newsletters ship a real <html><head><body>
            // tree and we want to keep their head-level <style> + body
            // bgcolor intact for the iframe to render natively.
            body: ["bgcolor", "style", "class"],
            html: ["style", "class", "lang"],
            head: [],
            style: ["type"],
            meta: ["charset", "name", "content", "http-equiv"],
            center: ["style", "class"],
            "*": ["class"],
          },
          // Whitelist the layout/typography props that Gmail-style
          // signatures and forwarded messages depend on. Anything not
          // listed (position, expression, behavior, etc.) is stripped
          // — keeps obvious vectors out without nuking signature
          // geometry. Each property allows non-malicious value shapes
          // only (px / %, rgb / hex, common keywords).
          allowedStyles: {
            "*": {
              "color": [/^.+$/],
              "background-color": [/^.+$/],
              "font-family": [/^.+$/],
              "font-size": [/^[\d.]+\s*(px|pt|em|rem|%)$/],
              "font-weight": [/^(normal|bold|\d{3})$/],
              "font-style": [/^(normal|italic|oblique)$/],
              "text-align": [/^(left|right|center|justify)$/],
              "text-decoration": [/^.+$/],
              "vertical-align": [/^(baseline|top|middle|bottom|sub|super|text-top|text-bottom)$/],
              "line-height": [/^[\d.]+\s*(px|pt|em|rem|%|)$/],
              "letter-spacing": [/^[\d.]+\s*(px|pt|em|rem)$/],
              "padding": [/^[\d.\s]+(px|pt|em|rem|%)$/],
              "padding-top": [/^[\d.]+\s*(px|pt|em|rem|%)$/],
              "padding-right": [/^[\d.]+\s*(px|pt|em|rem|%)$/],
              "padding-bottom": [/^[\d.]+\s*(px|pt|em|rem|%)$/],
              "padding-left": [/^[\d.]+\s*(px|pt|em|rem|%)$/],
              "margin": [/^[\d.\s]+(px|pt|em|rem|%|auto)$/],
              "margin-top": [/^[\d.]+\s*(px|pt|em|rem|%|auto)$/],
              "margin-right": [/^[\d.]+\s*(px|pt|em|rem|%|auto)$/],
              "margin-bottom": [/^[\d.]+\s*(px|pt|em|rem|%|auto)$/],
              "margin-left": [/^[\d.]+\s*(px|pt|em|rem|%|auto)$/],
              "width": [/^[\d.]+\s*(px|pt|em|rem|%)$/],
              "max-width": [/^[\d.]+\s*(px|pt|em|rem|%)$/],
              "min-width": [/^[\d.]+\s*(px|pt|em|rem|%)$/],
              "height": [/^[\d.]+\s*(px|pt|em|rem|%|auto)$/],
              "max-height": [/^[\d.]+\s*(px|pt|em|rem|%)$/],
              "min-height": [/^[\d.]+\s*(px|pt|em|rem|%)$/],
              "border": [/^[\d.]+\s*(px|pt|em|rem)\s+(solid|dashed|dotted|none)\s+.+$/],
              "border-top": [/^[\d.]+\s*(px|pt|em|rem)\s+(solid|dashed|dotted|none)\s+.+$/],
              "border-right": [/^[\d.]+\s*(px|pt|em|rem)\s+(solid|dashed|dotted|none)\s+.+$/],
              "border-bottom": [/^[\d.]+\s*(px|pt|em|rem)\s+(solid|dashed|dotted|none)\s+.+$/],
              "border-left": [/^[\d.]+\s*(px|pt|em|rem)\s+(solid|dashed|dotted|none)\s+.+$/],
              "border-color": [/^.+$/],
              "border-style": [/^(solid|dashed|dotted|none|hidden)$/],
              "border-width": [/^[\d.]+\s*(px|pt|em|rem)$/],
              "border-radius": [/^[\d.]+\s*(px|pt|em|rem|%)$/],
              "border-collapse": [/^(collapse|separate)$/],
              "border-spacing": [/^[\d.\s]+(px|pt|em|rem)$/],
              "display": [/^(block|inline|inline-block|table|table-cell|table-row|none|flex|inline-flex)$/],
              "float": [/^(left|right|none)$/],
              "clear": [/^(left|right|both|none)$/],
              // Newsletter-friendly extras: backgrounds (dark Quo theme),
              // overflow handling, position for sticky CTAs, opacity for
              // CTA hover states. url(...) values flow through — the
              // iframe sandbox handles the security boundary.
              "background": [/^.+$/],
              "background-image": [/^.+$/],
              "background-repeat": [/^(no-repeat|repeat|repeat-x|repeat-y|space|round)$/],
              "background-position": [/^.+$/],
              "background-size": [/^.+$/],
              "opacity": [/^[\d.]+$/],
              "overflow": [/^(visible|hidden|scroll|auto)$/],
              "overflow-x": [/^(visible|hidden|scroll|auto)$/],
              "overflow-y": [/^(visible|hidden|scroll|auto)$/],
              "box-sizing": [/^(content-box|border-box)$/],
              "white-space": [/^(normal|nowrap|pre|pre-wrap|pre-line)$/],
              "word-break": [/^(normal|break-all|keep-all|break-word)$/],
              "word-wrap": [/^(normal|break-word)$/],
              "list-style": [/^.+$/],
              "list-style-type": [/^.+$/],
              "list-style-position": [/^(inside|outside)$/],
              "table-layout": [/^(auto|fixed)$/],
              "mso-line-height-rule": [/^.+$/],
              "-webkit-text-size-adjust": [/^.+$/],
              "-ms-text-size-adjust": [/^.+$/],
            },
          },
          allowedSchemes: ["http", "https", "mailto", "tel", "cid", "data"],
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
