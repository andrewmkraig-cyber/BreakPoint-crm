# Merge fields in the popup composer

The Mail Tab popup composer (and click-to-email popup on candidate / client / pipeline surfaces) supports merge fields — placeholder tokens that get replaced with real candidate / job / client / user data when you hit Send.

## Two syntaxes, one resolver (Phase 5A.2)

The composer accepts merge tokens in two forms. Both resolve to the same data, so you can mix them in the same body and everything still works.

| Form | Convention | Example |
|---|---|---|
| Canonical (preferred) | `{{double.curly}}` lowercase + dot path | `{{candidate.first_name}}` |
| Bracket (RF compat) | `[Title Case With Spaces]` | `[Candidate First Name]` |

The Insert Field dropdown only inserts the canonical `{{}}` form. Bracket form exists for backward compatibility with templates imported from RecruiterFlow — you don't need to rewrite old RF templates by hand. Paste them into a template, the composer handles both.

## Full bracket → curly mapping

| Bracket | Canonical |
|---|---|
| `[Candidate First Name]` | `{{candidate.first_name}}` |
| `[Candidate Last Name]` | `{{candidate.last_name}}` |
| `[Candidate Full Name]` | `{{candidate.full_name}}` |
| `[Candidate Email]` | `{{candidate.email}}` |
| `[Candidate Current Title]` | `{{candidate.current_title}}` |
| `[Candidate Current Company]` | `{{candidate.current_company}}` |
| `[Candidate Current Employer]` | `{{candidate.current_company}}` (alias) |
| `[Job Title]` | `{{job.title}}` |
| `[Job Description]` | `{{job.description}}` |
| `[Job Location]` | `{{job.city}}, {{job.state}}` (composite) |
| `[Client Name]` | `{{client.name}}` |
| `[Client Company Name]` | `{{client.name}}` (RF alias) |
| `[Client Primary Contact First Name]` | `{{client.primary_contact_first_name}}` |
| `[User First Name]` | `{{user.first_name}}` |
| `[User Full Name]` | `{{user.full_name}}` |

`[Job Location]` is a composite — it expands to two tags joined by a comma, so a template that says "in [Job Location] —" becomes "in Dayton, OH —" when sent.

## Behavior on send

- Recognized fields with data: replaced with the actual value (HTML-escaped where necessary).
- Recognized fields with no data in context: left as the literal `{{...}}` text in the sent email. This is intentional — the recruiter sees clearly which fields didn't resolve via the unresolved-fields banner above the Send button (described in `smart-context.md`).
- Unrecognized brackets (e.g. `[Made Up Field]`): left as literal text. Brackets that don't match the table above pass through unchanged.

## Unit-tested cases

`tests/unit/mail-merge-fields-parser.test.ts` covers:

- pure curly template
- pure bracket template
- mixed-syntax body
- `[Job Location]` composite expansion
- unknown bracket / unknown curly stays literal + unresolved tracking
- RF-compat aliases (`[Client Company Name]`, `[Candidate Current Employer]`)

Run the tests with `npx tsx tests/unit/mail-merge-fields-parser.test.ts`. Exit non-zero on first failure.
