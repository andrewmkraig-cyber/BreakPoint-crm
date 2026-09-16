"use server";

import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import {
  DEALS_FROM_EMAIL,
  DEAL_ANNOUNCEMENT_CC,
  dealAnnouncementBodyHtml,
  dealAnnouncementSubject,
  type DealAnnouncementFacts,
} from "@/lib/deal-announcement";
import { canSendAsDeals } from "@/lib/deals-alias";
import { DEAL_TYPE_LABEL, normalizeDealType } from "@/lib/deal-type";
import {
  normalizePlacementCompensationType,
  resolvePlacementFee,
} from "@/lib/placement-compensation";
import { prisma } from "@/lib/prisma";

// Assembles the company-wide deal announcement draft for one placement.
// Returns the composer payload; it does NOT send. The recruiter writes the
// story and drops the photo in the composer, then sends from there.
//
// Org-scoped: the placement lookup filters by organizationId so a stray id
// from another tenant resolves to nothing.

export type DealAnnouncementDraft = {
  to: string;
  cc: string;
  subject: string;
  bodyHtml: string;
  fromEmail: string;
  // Recipient count, surfaced in the confirm copy so the sender knows how
  // many people are about to get this before the composer opens.
  recipientCount: number;
};

export type DealAnnouncementResult =
  | { ok: true; draft: DealAnnouncementDraft }
  | { ok: false; error: string };

// Two kinds of Date live on a placement. placedAt is a real instant (the
// click on Record Placement), so it reads in Eastern time. expectedStartDate
// is a calendar day stored as midnight UTC ("2026-10-05" -> 05T00:00Z);
// rendering that in Eastern time slides it to 8pm the night before, which
// is how an October 5 start was announced as October 4. Date-only values
// are formatted in UTC so they keep their own calendar day.
function isUtcMidnight(d: Date): boolean {
  return (
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0
  );
}

function formatDate(value: Date | null): string | null {
  if (!value) return null;
  return value.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: isUtcMidnight(value) ? "UTC" : "America/New_York",
  });
}

export async function buildDealAnnouncement(
  placementId: string,
): Promise<DealAnnouncementResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return { ok: false, error: "Not signed in." };
  const org = await getCurrentOrg();

  const sender = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  });
  if (!sender) return { ok: false, error: "Unknown user." };

  const placement = await prisma.placement.findFirst({
    where: { id: placementId, organizationId: org.id },
    select: {
      offerTitle: true,
      acceptedSalary: true,
      acceptedCompensationType: true,
      feePercentage: true,
      feeTotal: true,
      minFee: true,
      placedAt: true,
      createdAt: true,
      expectedStartDate: true,
      candidateSource: true,
      dealType: true,
      createdBy: { select: { name: true, email: true } },
      candidate: { select: { firstName: true, lastName: true } },
      client: { select: { name: true, industry: true, leadSource: true } },
      job: { select: { title: true } },
    },
  });
  if (!placement) return { ok: false, error: "Placement not found." };

  if (!(await canSendAsDeals(sender.id))) {
    return {
      ok: false,
      error: `${DEALS_FROM_EMAIL} is not a verified "Send mail as" address on your Gmail account. Add it under Gmail Settings, Accounts, "Send mail as", then try again.`,
    };
  }

  // Everyone in the org gets it. The closer goes in Cc instead of To so
  // Reply All reaches them directly and the congratulations land in their
  // inbox rather than a thread they are only bcc-adjacent to.
  const members = await prisma.organizationMembership.findMany({
    where: { organizationId: org.id },
    select: { user: { select: { email: true } } },
  });

  const closerEmail = placement.createdBy?.email?.trim().toLowerCase() ?? null;
  // Standing Cc list plus the closer. Built first so the To list can
  // subtract it: an address must never land in both fields, or the
  // recipient gets the mail twice and the count double-reports.
  const ccList = Array.from(
    new Set([...(closerEmail ? [closerEmail] : []), ...DEAL_ANNOUNCEMENT_CC]),
  );
  const ccSet = new Set(ccList);
  const recipients = Array.from(
    new Set(
      members
        .map((m) => m.user?.email?.trim().toLowerCase())
        .filter((e): e is string => Boolean(e)),
    ),
  ).filter((e) => !ccSet.has(e));

  if (recipients.length === 0 && ccList.length === 0) {
    return { ok: false, error: "No teammates found to announce to." };
  }

  const feeResolution = resolvePlacementFee({
    amount: placement.acceptedSalary,
    compensationType: normalizePlacementCompensationType(
      placement.acceptedCompensationType,
    ),
    feePercentage: placement.feePercentage,
    minFee: placement.minFee,
    overrideAmount: placement.feeTotal,
  });

  const candidateName = [
    placement.candidate?.firstName,
    placement.candidate?.lastName,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  const facts: DealAnnouncementFacts = {
    recruiterName:
      placement.createdBy?.name?.trim() ||
      placement.createdBy?.email?.trim() ||
      "the team",
    positionTitle: placement.job?.title ?? placement.offerTitle ?? null,
    clientName: placement.client?.name ?? null,
    candidateName: candidateName || null,
    feeTotal: feeResolution.feeTotal || null,
    // placedAt is the canonical "deal date"; fall back to when the row was
    // created so an older placement that predates the column still reads
    // sensibly instead of showing TBD.
    placementDate: formatDate(placement.placedAt ?? placement.createdAt),
    // The start date is the agreed calendar day. startConfirmedAt is the
    // moment Confirm Start was clicked, not when the candidate starts, so
    // it is never the right thing to print here.
    startDate: formatDate(placement.expectedStartDate),
    // Lead source is per-placement (how the candidate reached this job) and
    // falls back to the client's own acquisition channel.
    industry: placement.client?.industry ?? null,
    leadSource: placement.candidateSource ?? placement.client?.leadSource ?? null,
    dealTypeLabel: DEAL_TYPE_LABEL[normalizeDealType(placement.dealType)],
  };

  return {
    ok: true,
    draft: {
      to: recipients.join(", "),
      cc: ccList.join(", "),
      subject: dealAnnouncementSubject(facts),
      bodyHtml: dealAnnouncementBodyHtml(facts),
      fromEmail: DEALS_FROM_EMAIL,
      // Every address that will receive this, To and Cc together. The
      // count exists so the sender knows how many people are about to get
      // it, so a standing Cc has to be inside it - the list is no longer
      // all teammates, which is why the confirm copy says "people".
      recipientCount: recipients.length + ccList.length,
    },
  };
}
