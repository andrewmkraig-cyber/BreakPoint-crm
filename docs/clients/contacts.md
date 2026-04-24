# Client contacts

## What it does

Every client profile has a **Contacts** tab with the people at that company you talk to — hiring managers, HR partners, assistants, billing contacts. You can add new contacts inline and edit existing ones without leaving the tab.

## When to use it

- A new hiring manager joined the buying committee and you want them on the company's contact sheet.
- A contact's title changed (promoted, moved teams) and you want the record to reflect reality the next time a teammate pulls up the client.
- You had a conversation with a contact and want to stash a few notes for the next person who opens the profile.
- A contact's phone number or LinkedIn is stale — fix it inline instead of digging through RecruiterFlow or email history.

Do **not** use the contacts tab to manage candidates. Contacts represent *client-side* people (the buyer, not the talent); candidates have their own `/candidates` surface and profile.

## How to add a contact

1. Open the client profile at `/clients/[id]` and click the **Contacts** tab.
2. Click **Add contact** in the upper-right.
3. Fill in at least a first name (everything else is optional). First name, last name, title, email, phone, and LinkedIn URL are the fields the add form exposes.
4. Click **Save contact**. The contact is written to Ace's Postgres database, tenant-scoped to your organization, linked to this client via `Contact.clientId`. The table refreshes to show the new row.

## How to edit a contact

1. On the Contacts tab, **click any row** in the contacts table (avoid the inline email or phone links — those still open your mail client / dialer).
2. A slide-over panel opens on the right with the full contact card.
3. Edit any of the fields:
   - **First name** — required; the record won't save without one.
   - **Last name** — optional.
   - **Title** — the contact's job title at this client (e.g. "VP Engineering").
   - **Email** — one email, shown on the Contacts row and used by the email-link opener with merge-field values (contact name + company).
   - **Phone** — one phone number, stored alongside the contact.
   - **LinkedIn URL** — optional; surfaces a small LinkedIn link under their name in the contacts table.
   - **Notes** — free-form scratchpad for the next person to open the card. "Hired for Senior SRE 4/22, still looking to fill Staff SRE" — that kind of thing.
4. Click **Save** to commit. The panel closes; the contact row in the table updates in place, no full page reload.
5. Or click **Cancel** (or press Escape, or click the dimmed overlay) to close the panel without saving anything.

## How matching / scope works

- Contacts are scoped by your organization — editing a contact in one tenant never affects another tenant, even if the contact id is known.
- The server action refuses to write if the contact isn't found within your org, so a forged contact id from a malicious page payload can't escape the tenant.
- The Contacts tab query matches both `Contact.clientId = client.id` AND `Contact.client.legacyRfId = client.legacyRfId` so RF-imported contacts that still reference the legacy numeric id surface on the new cuid-linked client.

## Common questions

**Can I add more than one email or phone number?**
Not today. The card holds a single primary email + single primary phone. Extra emails / numbers in the underlying record (the `emails` array and `phoneNumbers` JSON) are preserved on save — the editor writes the one-up value as the first entry, but older imported contacts with multiple entries don't lose the others when you save through the UI (only the first slot is replaced).

**Why is Notes new?**
Added in Phase 5.5 so recruiters stop keeping contact context in Slack DMs or Apollo notes. The field is `Contact.notes` (text column) and is tenant-scoped like everything else.

**Does editing a contact sync back to RecruiterFlow?**
No. Ace is the source of truth for contacts now. RF is read-only / being decommissioned in Phase 5. The `legacyRfId` column stays around so historical RF-imported contacts keep their id, but no write ever goes back to RF.

**The slide-over closes when I hit Escape — intentional?**
Yes. Escape / click-overlay / the X button / Cancel all close the editor without saving. Only the Save button commits.

## Troubleshooting

**"First name is required."**
The editor refuses to save a contact with a blank first name. If the contact genuinely has only a company name (rare for RF-imported data), type a placeholder ("Assistant", "Receptionist") instead of leaving it blank.

**"Contact not found."**
The contact id isn't in your organization's tenant. This usually means the page is stale (contact was deleted) — refresh the client profile.

**The table didn't update after I hit Save.**
Check the browser console / Network panel for a failed server action. The optimistic update only fires when the server returns `ok: true`. If something went wrong, the panel shows a red error banner with the underlying message.

## Related features

- **Create client** (`docs/clients/create-client.md`) — creates a client plus an optional primary contact in one shot. If you used that flow, the first contact already exists; edit further details via this tab.
- **Global quick-search** (`docs/candidates/candidate-search.md`) — typing a contact's name in the header search shows them under the **Contacts** group and navigates to the parent client profile (where you can then click the row to edit).
- **Email link** — the email column uses the shared EmailLink component, which opens a compose window with merge values (contact full name, first name, company name) pre-populated.
