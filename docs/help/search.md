# Search across Ace

The header global search and the `/candidates` page search bar both run a tokenized multi-word match. Type "andrew kraig" and you'll find candidates, contacts, and clients whose first + last names span those tokens.

## How it works

- **Tokenize** on whitespace: `"andrew kraig"` → `["andrew", "kraig"]`.
- **Each token** must hit somewhere in the searchable haystack of a record (case-insensitive substring).
- **Tokens AND together**: `"andrew kraig"` matches a candidate whose `firstName` is "Andrew" and `lastName` is "Kraig" because token "andrew" appears in firstName and token "kraig" appears in lastName.

Single-word queries still work the same way — one token, ORed across all the searchable columns of each record.

## What gets searched per record type

| Type | Searchable haystack |
|---|---|
| Candidates | `firstName`, `lastName`, `email`, `currentDesignation`, `currentOrganization`, `location` |
| Clients | `name` (company name) |
| Contacts | `firstName`, `lastName`, legacy `name`, every entry in `emails[]` |

## Header global search vs. /candidates page search

Both surfaces use the same tokenized-AND semantics. Differences:

- **Header global search** returns the top 8 results split round-robin across Candidates / Clients / Contacts. Click a row to navigate; contact rows go to the parent client's Contacts tab.
- **`/candidates` page search bar** returns every candidate match, paginated by the candidates list page. Filter the table in place as you type.

## Tenant isolation

All search queries are scoped by `organizationId`. You won't see another tenant's candidates / clients / contacts even if they happen to share a name token with someone in your org.

## Phase 5A.2-fix change

Before the fix: the search ran a single `contains: "<full query>"` clause against each searchable column. So `"andrew kraig"` looked for the literal substring `"andrew kraig"` in `firstName`, then in `lastName`, etc. Since neither column contains the full string, no match — the candidate Andrew Kraig was missing from results even though the query clearly described them.

After the fix: query tokenizes on whitespace, ANDs each token's contains-clause across all columns. `"andrew kraig"` becomes `(firstName ILIKE %andrew% OR lastName ILIKE %andrew% OR ...) AND (firstName ILIKE %kraig% OR lastName ILIKE %kraig% OR ...)`. Andrew Kraig matches because "andrew" hits firstName and "kraig" hits lastName.
