import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { fetchApolloContacts } from "@/lib/bd/apollo-contacts";
import { findClientByDomain } from "@/lib/clients";
import {
  type BdReplyPromptState,
  dismissThreadPrompt,
  domainFromEmail,
  fetchApolloCompanyName,
  isThreadPromptDismissed,
} from "@/lib/bd/reply-prompt";

export const dynamic = "force-dynamic";

// GET state for the BD reply prompt on a given thread. The mail view
// only calls this after it has confirmed the thread carries the BD
// Gmail label — so the response is gated only on config + dismissal +
// enrichment lookup.
//
// Query params (passed by the client because the server doesn't refetch
// the thread here): senderEmail, senderName.
export async function GET(
  req: Request,
  { params }: { params: { threadId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const senderEmail = (url.searchParams.get("senderEmail") ?? "").trim();
  const senderName = (url.searchParams.get("senderName") ?? "").trim();

  const org = await getCurrentOrg();
  const config = await prisma.bdOrgConfig.findUnique({
    where: { organizationId: org.id },
    select: { replyPromptCreateClient: true },
  });

  if (!config?.replyPromptCreateClient) {
    const body: BdReplyPromptState = { shouldShow: false };
    return NextResponse.json(body);
  }

  if (await isThreadPromptDismissed(org.id, params.threadId)) {
    const body: BdReplyPromptState = { shouldShow: false };
    return NextResponse.json(body);
  }

  const domain = senderEmail ? domainFromEmail(senderEmail) : null;

  // If a Client already exists for this domain there's nothing to
  // prompt for — quietly mark the thread dismissed so re-opens stay
  // silent.
  if (domain) {
    const existing = await findClientByDomain(domain);
    if (existing) {
      await dismissThreadPrompt({
        organizationId: org.id,
        threadId: params.threadId,
        action: "SKIPPED",
      });
      const body: BdReplyPromptState = { shouldShow: false };
      return NextResponse.json(body);
    }
  }

  const [companyName, apolloContacts] = await Promise.all([
    domain ? fetchApolloCompanyName(domain) : Promise.resolve(null),
    domain ? fetchApolloContacts(domain, org.id) : Promise.resolve([]),
  ]);

  const body: BdReplyPromptState = {
    shouldShow: true,
    sender: { name: senderName, email: senderEmail, domain },
    suggestedCompanyName: companyName,
    suggestedContacts: apolloContacts.map((c) => ({
      firstName: c.firstName,
      lastName: c.lastName,
      title: c.title,
      linkedinUrl: c.linkedinUrl,
    })),
  };
  return NextResponse.json(body);
}

type PostBody =
  | { action: "skip" }
  | {
      action: "create";
      senderName: string;
      senderEmail: string;
      companyName: string;
      domain: string | null;
      contacts: Array<{
        firstName: string;
        lastName: string;
        title: string;
        linkedinUrl: string | null;
      }>;
    };

export async function POST(
  req: Request,
  { params }: { params: { threadId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getCurrentOrg();
  const body = (await req.json().catch(() => null)) as PostBody | null;
  if (!body) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  if (body.action === "skip") {
    await dismissThreadPrompt({
      organizationId: org.id,
      threadId: params.threadId,
      action: "SKIPPED",
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "create") {
    const name = body.companyName.trim();
    if (!name) return NextResponse.json({ error: "Company name required" }, { status: 400 });

    const normDomain = body.domain
      ? body.domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "") || null
      : null;

    // Server-side duplicate guard so two BD replies for the same domain
    // can't race-create twin clients.
    if (normDomain) {
      const dup = await findClientByDomain(normDomain);
      if (dup) {
        await dismissThreadPrompt({
          organizationId: org.id,
          threadId: params.threadId,
          action: "SKIPPED",
        });
        return NextResponse.json({
          ok: true,
          duplicate: { slug: dup.slug, name: dup.name },
        });
      }
    }

    const senderFirst = body.senderName.split(/\s+/)[0]?.trim() || "Contact";
    const senderLast = body.senderName.split(/\s+/).slice(1).join(" ").trim();

    const client = await prisma.client.create({
      data: {
        name,
        domain: normDomain,
        organizationId: org.id,
        leadSource: "Apollo BD",
        addedAt: new Date(),
      },
      select: { id: true, legacyRfId: true },
    });

    const contactsToCreate: Array<{
      firstName: string | null;
      lastName: string | null;
      name: string;
      emails: string[];
      currentDesignation: string | null;
      linkedinProfile: string | null;
    }> = [
      {
        firstName: senderFirst,
        lastName: senderLast || null,
        name: [senderFirst, senderLast].filter(Boolean).join(" ") || senderFirst,
        emails: body.senderEmail.trim() ? [body.senderEmail.trim()] : [],
        currentDesignation: null,
        linkedinProfile: null,
      },
    ];

    const senderEmailLower = body.senderEmail.trim().toLowerCase();
    for (const c of body.contacts) {
      const first = (c.firstName ?? "").trim();
      const last = (c.lastName ?? "").trim();
      if (!first && !last) continue;
      // Don't double-add the sender if Apollo also surfaced them.
      const display = [first, last].filter(Boolean).join(" ").toLowerCase();
      if (display === body.senderName.trim().toLowerCase() && senderEmailLower) continue;
      contactsToCreate.push({
        firstName: first || null,
        lastName: last || null,
        name: [first, last].filter(Boolean).join(" "),
        emails: [],
        currentDesignation: c.title.trim() || null,
        linkedinProfile: c.linkedinUrl,
      });
    }

    await prisma.contact.createMany({
      data: contactsToCreate.map((c) => ({
        firstName: c.firstName,
        lastName: c.lastName,
        name: c.name,
        emails: c.emails,
        currentDesignation: c.currentDesignation,
        linkedinProfile: c.linkedinProfile,
        clientId: client.id,
        organizationId: org.id,
        addedAt: new Date(),
      })),
    });

    // Stamp the GmailThreadTag so the mail UI's "Open client" affordance
    // wires up on the next thread fetch.
    await prisma.gmailThreadTag.upsert({
      where: {
        threadId_clientId: {
          threadId: params.threadId,
          clientId: client.id,
        },
      },
      create: {
        threadId: params.threadId,
        clientId: client.id,
        organizationId: org.id,
      },
      update: {},
    });

    await dismissThreadPrompt({
      organizationId: org.id,
      threadId: params.threadId,
      action: "CREATED",
    });

    const slug = client.legacyRfId != null ? String(client.legacyRfId) : client.id;
    revalidatePath("/clients");
    revalidatePath(`/clients/${slug}`);

    return NextResponse.json({
      ok: true,
      slug,
      clientId: client.id,
    });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
