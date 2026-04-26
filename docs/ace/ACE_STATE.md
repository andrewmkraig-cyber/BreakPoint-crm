# Ace State

## Current version: Ace 21.0 - shipped (2026-04-26)

## Next task: Ace 22.0 - Mail Tab batch

### Ace 21.0 Completed Ships (2026-04-26)

- RF-imported tags removed from all Candidate records. Root cause: chips were rendering from Candidate.raw.tags (the original RF JSON payload), not Candidate.tags (String[] column which was already empty). Script cleared Candidate.raw.tags and Candidate.raw.attributes on all rows. Verified on prod - tag chips gone from candidate profiles.

### Architecture state

- All 13 architecture non-negotiables holding
- Grep baseline: recruiterflow 2 / RecruiterFlow 10 / RfId 1082
- RF fully removed since Phase 5
- Neon Postgres sole source of truth
- Gmail OAuth scopes: gmail.readonly, gmail.modify, gmail.send
- Repo: PRIVATE as of 2026-04-26. Session opens via GitHub MCP, not public URL fetch.

### Mail Tab batch - next items (Ace 22.0)

In order of priority per roadmap:

1. Open thread in Ace marks read in Gmail via gmail.modify removeLabel UNREAD
2. Unread count badge on Mail sidebar item, real-time
3. Browser notifications top-of-screen Gmail-style with permission prompt
4. Move To label dropdown replacing Archive button - reads user Gmail labels, applies label + removes INBOX
5. Logo + signature contact icons render fix in /mail thread view (broken image boxes)
6. Auto-tagging emails to candidate/client profiles by sender/recipient address - VERY IMPORTANT
7. BCC autocomplete with Austin Barnard
8. BUG: click-to-add on To/CC/BCC suggestion dropdown - auto-dismiss on click, populate chip cleanly
9. Sent view in /mail tab alongside Inbox
10. Sent emails composed from Gmail appear in Ace Activity section + /mail Sent view
11. Full bidirectional sync - reply from anywhere yields same thread state in both Ace and Gmail

## Last successful Vercel deploy: post-21.0 tags cleanup commit
