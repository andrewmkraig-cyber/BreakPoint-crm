// Canonical Ace team identities offered as Bcc on outbound email.
//
// Austin (Austin Barnard, austin@breakpointtalent.com) is the only teammate
// today; the list grows as the team does. This is the SINGLE SOURCE OF TRUTH
// so the interview Schedule modal's CcBccPicker and the EmailComposer's Bcc
// pool can never drift — and, critically, so client contacts can never leak
// into a Bcc dropdown (Bcc is the private team copy; Cc is the client-facing
// list). Both surfaces import this list for their Bcc options.
export type TeamContactOption = { id: string; name: string; email: string };

export const TEAM_BCC_OPTIONS: TeamContactOption[] = [
  {
    id: "teammate-austin",
    name: "Austin Barnard",
    email: "austin@breakpointtalent.com",
  },
];
