# Create a client

## What it does

Creates a new client (company) record in Ace. The client is saved directly to Ace's database — no RecruiterFlow sync happens at create time. Once saved, the client shows up on `/clients`, has its own detail page at `/clients/[id]`, and is immediately available as a target for new contacts and (once the Jobs cutover lands) new requisitions.

## When to use it

- A prospect agreed to work with you and you need to spin up a company record.
- A recruiter on the team just booked a discovery call with a new logo and wants the company on file before the kickoff.
- You're prospecting and want to stash a name + primary contact so you can come back later.

Do **not** use it to edit an existing client — open that client's profile instead. The form pre-flights the domain against your existing clients and will refuse to save if it finds a match.

## How to use it

1. From the Clients page click **New Client** in the top right (or go to `/clients/new` directly).
2. Paste the company's URL into the **Company URL** field on the left. Ace reads the homepage and fills in the fields on the right — name, industry, city/state, phone, LinkedIn, overview — via Claude. The auto-fill kicks in ~0.6s after you stop typing.
3. Before the auto-fill runs, Ace checks the domain against your tenant's existing clients. If a match is found, the red **Client not available** banner appears, the Save button is disabled, and the auto-fill is suppressed.
4. Review the right-hand fields. Every field is editable; nothing is committed until you hit Save.
5. Optionally fill in the **Primary Contact** block at the bottom. First name, last name, title, email, and phone. Leave it blank if you don't have a contact yet — you can add contacts later from the client's Contacts tab.
6. Click **Save to Ace**. The form writes a new `Client` row (and optional `Contact` row) to Ace's database and redirects you to the client's detail page.

## Fields explained

| Field | What it's for | Required? |
|---|---|---|
| **Company name** | The client's display name. Shown on the list, detail page, and every client-scoped downstream report. | Yes. |
| **Website** | Stored as the bare domain (e.g. `acme.com`). The domain is the tenant-scoped uniqueness key — two clients in your org can't share one. | Recommended (no domain means no dup-check). |
| **Industry** | One short phrase from the dropdown. Used for filtering on the Clients list. | Optional. |
| **Phone** | Main company switchboard or reception. Click-to-call via Krispcall from the detail page; formatted to `+1 XXX-XXX-XXXX` at display time. | Optional. |
| **City / State** | HQ city + US state abbreviation. Shown on the Clients list and detail header. | Optional. |
| **LinkedIn** | Full LinkedIn company URL. Hyperlinked on the detail sidebar. | Optional. |
| **Overview** | 1–2 sentence recruiter-facing summary of what the company does. Claude auto-fills this from the homepage; edit before saving if the tone's off. | Optional. |
| **Primary contact → First / Last / Title / Email / Phone** | A starter contact for the account. Written as a `Contact` row linked to the new client. You can add more contacts after save from the Contacts tab. | Optional (any non-blank field triggers the contact create; if all five are blank no contact is written). |

## Common questions

**Does creating a client call RecruiterFlow?**
No. Ace writes to its own database only. RecruiterFlow is being phased out — new clients don't go there.

**The auto-fill got a field wrong. Can I retry?**
Edit the field before saving, or save and edit from the detail page afterwards. Everything on the form is editable in both places. If you want to re-run Claude, change the URL (or blank it and retype) — auto-fill only fires once per URL per session.

**What if the homepage is behind a login wall or returns a 403?**
The toast surfaces the fetch error. Fill in the fields manually; the form still saves.

**Can I create a client without a website?**
Yes. The domain field is optional. The dup-check simply has nothing to compare against, so be careful not to duplicate an existing account manually.

**What organization does the new client belong to?**
Your current organization — resolved from your session at save time. You can't accidentally create a client in a different org.

**Can I link jobs to an Ace-native client right away?**
Not yet. The Jobs-create form currently writes to RecruiterFlow, which doesn't know about Ace-native clients. Once the Jobs cutover lands (the next phase), you'll be able to create a job tied to any client in Ace.

## Troubleshooting

**"A client with this domain already exists (Acme Corp)."**
Exactly what it says — your tenant already has a client on that domain. Open the existing record from the Clients list; don't create a second one.

**Save button stays greyed out.**
Company name is the only strictly required field. If it's blank, nothing saves. If the domain check is in "duplicate" state the button is also disabled — clear the URL or pick a non-colliding one.

**Auto-fill says "Couldn't fetch (403)."**
The homepage blocked our bot. Paste the fields in manually; save still works.

**"Not signed in."**
Your session expired between opening the form and hitting Save. Reload, sign back in, and retry.

**The new client didn't show up on `/clients`.**
The list defaults to the **Active** tab (clients with an open job or a placement in the last 6 months). A fresh Ace-native client has neither — switch to the **Inactive** tab to find it. Once a job gets tied to it (post-Jobs-cutover), it'll flip to Active automatically.

## Related features

- **Client detail page** — Overview / Contacts / Agreements / Benefits / Game Plan tabs. Company fields are inline-editable from the Overview tab.
- **Contacts tab** — add more contacts to the client after create, or edit the primary contact saved from this form.
- **Agreements / Benefits tabs** — upload signed fee agreements and benefits PDFs. These still key off the legacy RF id and are disabled for Ace-native clients until the underlying tables are migrated in a later phase.
- **Jobs list** — once Jobs are cut over, the New Job form will let you pick any Ace-native client from the dropdown.
