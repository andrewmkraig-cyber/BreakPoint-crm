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
