// Company-wide deal announcement email.
//
// The story and the photo deliberately do NOT live in Ace. There is no
// dealStory column and no uploaded-image row: recording a placement stays
// silent, and the announcement is assembled as a DRAFT in the mail composer
// where the recruiter types how the deal went down and drops the picture
// straight into the body. Ace's job is to pre-fill the facts and the
// recipient list, then get out of the way.
//
// Sender is deals@breakpointtalent.com. That alias is filtered out of the
// composer's From dropdown (see /api/mail/send-as-aliases) so it is never
// pickable for ordinary mail — the announcement flow is the only thing that
// selects it, by passing it as the composer's locked sender.

export const DEALS_FROM_EMAIL = "deals@breakpointtalent.com";
export const DEALS_FROM_NAME = "BreakPoint Talent Deals";

// A cancelled deal notifies a fixed short list rather than the whole
// company: the announcement is a celebration, the cancellation is
// bookkeeping that AR needs for invoicing and that leadership needs to
// know about. Hard-coded on purpose — this is not an org-membership
// broadcast, it is these three mailboxes.
export const DEAL_CANCELLATION_RECIPIENTS = [
  "ar@breakpointtalent.com",
  "austin@breakpointtalent.com",
  "andrew@breakpointtalent.com",
] as const;

export type DealAnnouncementFacts = {
  recruiterName: string;
  positionTitle: string | null;
  clientName: string | null;
  candidateName: string | null;
  // Resolved placement fee in whole dollars. Null when the row carries no
  // usable fee, in which case the money phrasing is dropped rather than
  // rendered as "$0".
  feeTotal: number | null;
  // All dates pre-formatted for display by the caller, which owns the
  // timezone decision. Null renders as "TBD" in the facts block.
  placementDate: string | null;
  startDate: string | null;
  industry: string | null;
  leadSource: string | null;
};

function money(amount: number): string {
  return `$${Math.round(amount).toLocaleString("en-US")}`;
}

// "a Tax Manager" / "an Audit Senior". Only used in the subject, where the
// user's wording is "placement of a (position title)".
function withArticle(title: string): string {
  return `${/^[aeiou]/i.test(title.trim()) ? "an" : "a"} ${title.trim()}`;
}

// "Congrats to Austin Barnard for a $25,000 placement of a Tax Manager".
// Fee and title are independently optional; each just drops its clause
// rather than substituting filler, so a row missing both still reads as a
// sentence ("Congrats to Austin Barnard for a placement").
export function dealAnnouncementSubject(facts: DealAnnouncementFacts): string {
  const amount =
    facts.feeTotal != null && facts.feeTotal > 0
      ? `${money(facts.feeTotal)} placement`
      : "placement";
  const role = facts.positionTitle?.trim()
    ? ` of ${withArticle(facts.positionTitle)}`
    : "";
  return `Congrats to ${facts.recruiterName} for a ${amount}${role}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// The draft body the composer opens with. Two parts: the congratulations
// line plus a facts block Ace can fill in from the placement row, then an
// empty paragraph the recruiter writes the story into and drops the photo
// on. The composer already handles inline images (pasted or via the
// toolbar's image button), so the picture becomes part of this body rather
// than a separate attachment.
//
// No signature block: /api/mail/send appends the sender's Ace signature on
// the way out, so including one here would double it up.
export function dealAnnouncementBodyHtml(facts: DealAnnouncementFacts): string {
  const parts: string[] = [];

  const feePhrase =
    facts.feeTotal != null && facts.feeTotal > 0
      ? ` of ${money(facts.feeTotal)}`
      : "";
  const startPhrase = facts.startDate
    ? ` with a start date of ${escapeHtml(facts.startDate)}`
    : "";
  parts.push(
    `<p>Congratulations to <strong>${escapeHtml(facts.recruiterName)}</strong> for making a placement${feePhrase}${startPhrase}.</p>`,
  );

  const rows: Array<[string, string | null]> = [
    ["Placement date", facts.placementDate],
    ["Start date", facts.startDate],
    ["Industry", facts.industry],
    ["Lead source", facts.leadSource],
  ];
  parts.push("<ul>");
  for (const [label, value] of rows) {
    parts.push(
      `<li><strong>${label}:</strong> ${escapeHtml(value?.trim() || "TBD")}</li>`,
    );
  }
  parts.push("</ul>");

  // The writing prompt. Left as a visible instruction rather than a silent
  // blank so it is obvious the draft is unfinished, and phrased so that
  // deleting the line is the natural first keystroke.
  parts.push(
    "<p><em>How the deal went down: replace this line with the story, and paste or insert the photo below it.</em></p>",
  );

  return parts.join("");
}


// ---- Cancelled deal notice ----
//
// Unlike the announcement, this one SENDS immediately rather than opening a
// draft. The recruiter has already typed the explanation in the cancel
// dialog (it is required there), so there is nothing left to compose, and a
// cancellation that silently waited in someone's drafts folder would defeat
// the point of notifying AR.

export type DealCancellationFacts = {
  // Who booked the deal originally.
  recruiterName: string;
  // Who is cancelling it. Often the same person; rendered separately only
  // when it differs, so the common case reads cleanly.
  cancelledByName: string;
  positionTitle: string | null;
  clientName: string | null;
  candidateName: string | null;
  feeTotal: number | null;
  placementDate: string | null;
  startDate: string | null;
  // Human label for the structured reason (e.g. "Candidate resigned").
  reasonLabel: string;
  // The free-text explanation. Required by the cancel dialog.
  explanation: string;
};

// "Cancelled deal: Austin Barnard, $25,000, Tax Manager". Amount and
// position each drop out when unknown rather than rendering a placeholder,
// so the subject never carries a dangling comma.
export function dealCancellationSubject(facts: DealCancellationFacts): string {
  const parts = [facts.recruiterName];
  if (facts.feeTotal != null && facts.feeTotal > 0) parts.push(money(facts.feeTotal));
  if (facts.positionTitle?.trim()) parts.push(facts.positionTitle.trim());
  return `Cancelled deal: ${parts.join(", ")}`;
}

export function dealCancellationBodyHtml(facts: DealCancellationFacts): string {
  const parts: string[] = [];

  const who =
    facts.cancelledByName.trim() &&
    facts.cancelledByName.trim() !== facts.recruiterName.trim()
      ? `${escapeHtml(facts.cancelledByName)} cancelled a placement booked by ${escapeHtml(facts.recruiterName)}`
      : `${escapeHtml(facts.recruiterName)} cancelled a placement`;
  const feePhrase =
    facts.feeTotal != null && facts.feeTotal > 0
      ? ` worth ${money(facts.feeTotal)}`
      : "";
  parts.push(`<p>${who}${feePhrase}.</p>`);

  const rows: Array<[string, string | null]> = [
    ["Candidate", facts.candidateName],
    ["Position", facts.positionTitle],
    ["Client", facts.clientName],
    ["Placement date", facts.placementDate],
    ["Start date", facts.startDate],
    ["Reason", facts.reasonLabel],
  ];
  parts.push("<ul>");
  for (const [label, value] of rows) {
    parts.push(
      `<li><strong>${label}:</strong> ${escapeHtml(value?.trim() || "TBD")}</li>`,
    );
  }
  parts.push("</ul>");

  // The explanation is the entire point of this email, so it gets its own
  // labelled block rather than a bullet. Newlines the recruiter typed are
  // preserved as separate paragraphs.
  parts.push("<p><strong>What happened</strong></p>");
  for (const line of facts.explanation.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) parts.push(`<p>${escapeHtml(trimmed)}</p>`);
  }

  return parts.join("");
}

// Plain-text alternative. sendGmail wants both parts, and a text/plain body
// that just says "see HTML" is what trips spam filters.
export function dealCancellationBodyText(facts: DealCancellationFacts): string {
  const lines: string[] = [];
  const who =
    facts.cancelledByName.trim() &&
    facts.cancelledByName.trim() !== facts.recruiterName.trim()
      ? `${facts.cancelledByName} cancelled a placement booked by ${facts.recruiterName}`
      : `${facts.recruiterName} cancelled a placement`;
  const feePhrase =
    facts.feeTotal != null && facts.feeTotal > 0 ? ` worth ${money(facts.feeTotal)}` : "";
  lines.push(`${who}${feePhrase}.`, "");
  lines.push(`Candidate: ${facts.candidateName?.trim() || "TBD"}`);
  lines.push(`Position: ${facts.positionTitle?.trim() || "TBD"}`);
  lines.push(`Client: ${facts.clientName?.trim() || "TBD"}`);
  lines.push(`Placement date: ${facts.placementDate?.trim() || "TBD"}`);
  lines.push(`Start date: ${facts.startDate?.trim() || "TBD"}`);
  lines.push(`Reason: ${facts.reasonLabel}`, "");
  lines.push("What happened", facts.explanation.trim());
  return lines.join("\n");
}
