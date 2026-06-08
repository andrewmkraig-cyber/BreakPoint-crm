import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import Anthropic from "@anthropic-ai/sdk";
import type { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { CLAUDE_MODEL } from "@/lib/claude";
import { prisma } from "@/lib/prisma";
import { buildPersonalTrainerBlock } from "@/lib/personal-trainer";
import {
  buildCandidateContext,
  buildClientContext,
  buildJobContext,
} from "@/lib/ai-workspace-context";
import { getClientByIdentifier } from "@/lib/clients";
import { getCandidateByIdentifier } from "@/lib/candidates";
import { getJobByIdentifier } from "@/lib/jobs";
import { formatLocation } from "@/lib/utils";
import { createReminder } from "@/app/calendar/reminder-actions";
import { parseReminderToolInput, claimsReminderSaved } from "@/lib/claude-panel/reminders";

// Live Claude call for the global Claude Panel (Sparkles topbar
// toggle). Streams text deltas as NDJSON events back to the client so
// the assistant bubble fills in word-by-word, matching the Game Plan
// /api/game-plan/find-matches streaming pattern. The panel persists
// transcript rows separately via /api/claude-panel/messages — this
// route is computation only, no DB writes.
//
// Phase 4 (initial): exposed search_candidates / search_jobs /
// search_clients / get_pipeline as tool calls. The first version used
// strict tokenized AND-of-OR search which silently zeroed out natural-
// language queries — "tax managers in ohio" tokenizes to four pieces,
// "in" never matches anything, "managers" doesn't substring-match
// "Manager" cleanly, and the AND requires every token to land. The
// pipeline tool also assumed Placement.stage covered "interviewing",
// but interviews live in their own table and Placement.stage only
// stores offer / pending_start / hired.
//
// Phase 4 (this rev): split each tool's logic by intent. Queries are
// lowercased, stripped of stop words, simply singularized, then matched
// with OR semantics; results are scored in JS so true matches still
// rank ahead of incidental hits. search_jobs detects "all open jobs"
// intent and bypasses keyword scoring entirely. get_pipeline detects
// stage intent and routes interviewing reads to the Interview table
// instead of Placement. Every tool call logs its routing decision so
// we can prove the assistant is actually hitting the database.

export const maxDuration = 300;

const anthropic = new Anthropic();

const SYSTEM_PROMPT =
  "You are Ace, an AI recruiting assistant inside BreakPoint Talent's CRM. " +
  "You help Andrew Kraig with recruiting tasks: candidate evaluation, submittals, BD messages, " +
  "interview prep, market research, and anything else recruiting-related. " +
  "Rules: be concise and direct, no filler, no hedging, no fake enthusiasm. " +
  "Never use asterisks or markdown bold in your responses. " +
  "Use plain hyphens for bullet points. " +
  "Write like a sharp recruiter, not an AI. " +
  "Never end a response with a signoff or signature. " +
  "For any external facts, job market data, salaries, companies, people, or URLs - verify with web_search during this turn. Never hedge with 'data may be outdated.' If you cannot verify something, omit it. " +
  "Tool routing for CRM data - call these tools, never invent records:\n" +
  "- 'who is interviewing at <client>' or 'upcoming interviews for <client>' → get_pipeline({ clientName: '<client>', stage: 'interviewing' }).\n" +
  "- 'who has interviewed at <client>' / 'history with <client>' / 'past placements at <client>' / any past-tense or all-time pipeline question → get_pipeline({ clientName: '<client>', historical: true }).\n" +
  "- 'who is in offer / pending start / hired (at <client>)' → get_pipeline with the matching stage and optional clientName.\n" +
  "- General pipeline questions without a stage → get_pipeline({ clientName? }).\n" +
  "- 'what jobs are open' / 'show open roles' / 'active jobs' → search_jobs with the literal phrase as the query (the tool detects this intent and lists every open job).\n" +
  "- Specific candidate / role / client lookups (skills, titles, locations, industries) → search_candidates / search_jobs / search_clients with the user's natural phrasing.\n" +
  "- 'Recently added candidates' / 'candidates I just imported' / 'newest candidates' → call search_candidates with sortBy='createdAt' (and an empty query string when no keyword filter applies). Use limit to honor counts the recruiter mentions ('the 25 candidates I just imported' → limit 25).\n" +
  "Pass the user's wording through; the tools handle stop-word stripping, plural collapsing, and ranking on their side.\n" +
  "Tool results may include markdown links like [Name](/candidates/abc) and [Title](/jobs/xyz). Quote those links as-is in your answer so the recruiter can click straight to the record. Never strip the link, never paraphrase the URL.\n" +
  "Action tools (move_candidate_stage / add_note / draft_email / inactivate_job / privatize_job / reactivate_job / delete_job / delete_candidate / reset_activity_log / reset_placements / update_placement_field) are PROPOSALS, not executions. Calling one stops your turn and the recruiter gets a Confirm/Cancel card. Never call an action tool with invented ids; resolve real candidates / placements / clients / jobs via the search tools first. Job lifecycle routing: 'close out' / 'mark inactive' → inactivate_job; 'make private' / 'hide from active' → privatize_job; 'reopen' / 'reactivate' → reactivate_job. delete_job and delete_candidate are destructive and cascade. Only use them when the recruiter explicitly says 'delete' or 'permanently remove' the named record. " +
  "Data-reset tools (reset_activity_log / reset_placements / update_placement_field) are destructive and require explicit recruiter intent. reset_activity_log wipes ActionLog rows in a date range (omit dateFrom/dateTo to wipe everything). reset_placements deletes Placements matching dateFrom/dateTo/stage filters and cascades to dependent Interview rows. update_placement_field edits exactly one field on one placement; the only editable fields are placedAt, startConfirmedAt, stage, feeAmount, offerReceivedAt. Resolve the placementId via search_candidates → get_pipeline first; never invent it. Use ISO 8601 (YYYY-MM-DD or full ISO timestamp) for any date value. The current Eastern Time is {{NOW_ET}} (today's date is {{TODAY}}). Use the current time to resolve relative phrases like 'this week' / 'last month' / 'this afternoon' into ISO dates. " +
  "Creating reminders - create_reminder is a DIRECT action, NOT a Confirm-card proposal: calling it writes an Ace reminder immediately and the recruiter gets a single summary receipt. Use it for 'remind me…' / 'add a reminder…' requests and for a pasted list of timed items - emit ONE create_reminder call PER reminder in the same turn (six reminders = six calls). The CURRENT Eastern time is {{NOW_ET}} - resolve EVERY relative phrase against it: 'in 20 minutes' = {{NOW_ET}} + 20 min, 'in 2 hours' = {{NOW_ET}} + 2h, 'tonight' / 'tomorrow at 3pm' relative to that same clock. Do NOT guess the current time. reminderAtIso MUST carry an explicit Eastern Time offset: the current Eastern offset is {{ET_OFFSET}} (use -04:00 during EDT / -05:00 during EST to match the reminder's date). Example: at 2026-06-10T15:00:00-04:00, 'in 20 minutes' is 2026-06-10T15:20:00-04:00. A reminderAtIso WITHOUT an explicit offset is rejected, not created - never emit a bare/naive datetime. CRITICAL - NEVER claim a reminder was saved in your own text. Do NOT write any sentence like 'Added 1 reminder', 'Reminder set', 'I've added/created/scheduled that reminder', or 'Done' for a reminder. The ONLY valid confirmation a reminder was saved is the tool-execution receipt, which the app renders automatically when create_reminder actually runs. Writing a success sentence yourself is a LIE if the tool did not run - the user cannot tell your text apart from the real receipt. So: to save a reminder you MUST call create_reminder, and then write NOTHING. If you cannot call create_reminder for any reason (missing time, unclear request, etc.), say plainly that nothing was saved and ask the recruiter to retry - never imply it was saved. " +
  "After calling an action tool do not write any more text. The card speaks for itself. " +
  "BULK actions - when the recruiter wants the SAME action on MORE THAN ONE record at once ('make all active jobs inactive', 'reactivate every private job', 'delete these 5 candidates'), use the BULK tools, NOT N single-id calls. The bulk tools are inactivate_jobs { jobIds: [...] }, reactivate_jobs { jobIds: [...] }, delete_jobs { jobIds: [...] }, and delete_candidates { candidateIds: [...] }. The flow is always: FIRST enumerate the real target ids via a read tool (search_jobs / get_pipeline / search_candidates) - never invent ids - THEN emit ONE bulk call carrying EVERY id in the array (eleven jobs = one inactivate_jobs call with eleven ids, NOT eleven inactivate_job calls). One bulk call produces ONE Confirm card listing all the records. Use the single-id tools (inactivate_job / reactivate_job / delete_job / delete_candidate) only for a genuine one-off - a single named record. delete_jobs and delete_candidates are destructive and cascade; they still require Confirm, just one batched card for the whole set. If a read tool reports more total matches than it returned in one batch, page for the rest before the bulk call so the id set is complete.";

// Custom data tools — exposed to Claude so it can pull live records
// from Neon. Schemas mirror the parameters Andrew is most likely to ask
// in natural language ("who's interviewing at Sheehan", "find tax
// managers in Ohio"). Every tool is org-scoped at execution time.
const DATA_TOOLS: Anthropic.Tool[] = [
  {
    name: "search_candidates",
    description:
      "Search candidates in the recruiter's CRM. Pass the user's natural-language query; the tool lowercases, strips stop words, singularizes plurals, then OR-matches against name, current title, current employer, location, skills, tags, and email. Results are scored (title and employer hits weigh more than name hits) and the top ranked matches are returned. For 'recently added' / 'just imported' / 'newest' style requests, set sortBy='createdAt' and pass an empty string as `query` to skip keyword filtering.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Natural-language query, e.g. 'tax managers in Ohio' or 'Sara Johnson'. Pass an empty string when sortBy='createdAt' and no keyword filter is needed.",
        },
        sortBy: {
          type: "string",
          enum: ["relevance", "createdAt"],
          description:
            "Result ordering. Defaults to 'relevance' (scored keyword match). Use 'createdAt' for 'recently added' / 'just imported' / 'newest candidates' requests.",
        },
        order: {
          type: "string",
          enum: ["asc", "desc"],
          description:
            "Direction for sortBy='createdAt'. Defaults to 'desc' (newest first). Ignored when sortBy='relevance'.",
        },
        limit: {
          type: "number",
          description:
            "Max rows to return. Defaults to 25; clamped to 1..100.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "search_jobs",
    description:
      "Search jobs in the recruiter's CRM. If the query is a broad 'list my open / active jobs' intent, the tool ignores keyword scoring and returns every open job across every client (top 30, most recently updated first). Otherwise it OR-matches the query tokens against title, client name, location, employmentType, and department, scores them, and returns the top ~10.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural-language query, e.g. 'open jobs', 'senior accountant Cleveland'.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "search_clients",
    description:
      "Search clients (companies) in the recruiter's CRM. OR-matches against name, industry, domain, tags, and the formatted city/state location. Tokens are lowercased, stop-word stripped, and singularized. Returns the top ~10 ranked matches.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural-language query, e.g. 'Sheehan Brothers' or 'public accounting Ohio'.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_pipeline",
    description:
      "Pipeline lookup. `stage` is one of: interviewing, offer, pending_start, hired, submitted (any reasonable phrasing such as 'interview', 'offered', 'placed' is normalized server-side). 'interviewing' reads upcoming Interview rows; offer/pending_start/hired read the Placement table; 'submitted' is not tracked in Ace's Placement table and the tool will say so. `clientName` does a forgiving substring match against the client (so 'Sheehan' matches 'Sheehan Brothers Vending'). Pass `historical: true` for past-tense lookups like 'who has interviewed at Sheehan' or 'what placements have we made at Sheehan'; it merges Placement rows (every stage, every date) with Interview rows (every status, every date), labels each, and returns up to 30 sorted by most-recent activity. When `historical` is true the `stage` filter is ignored. Returns up to 20 rows in non-historical mode.",
    input_schema: {
      type: "object",
      properties: {
        clientName: {
          type: "string",
          description: "Substring of the client name. Optional.",
        },
        stage: {
          type: "string",
          description:
            "Pipeline stage. Accepts: interviewing, offer, pending_start, hired, submitted (and reasonable synonyms). Optional. Ignored when historical=true.",
        },
        historical: {
          type: "boolean",
          description:
            "True for past-tense / 'all-time' pipeline questions. Returns merged Placement + Interview history with no date filter. Optional, defaults to false.",
        },
      },
    },
  },
  // create_reminder — a DIRECT-execute action tool (it is NOT in
  // ACTION_TOOL_NAMES). The chat loop runs it server-side immediately,
  // batches the results, and returns ONE summary receipt instead of a
  // per-item Confirm card. Reminders are reversible Neon-only writes, so
  // Andrew's directive is to fire them straight through; the only brake
  // is a runaway-paste cap (>10 in one turn falls back to a single
  // Confirm). The timestamp MUST carry an explicit ET offset — a naive
  // datetime is rejected (the Vercel runtime would parse it as UTC and
  // skew the reminder 4-5 hours).
  {
    name: "create_reminder",
    description:
      "Create one Ace reminder — a personal, time-anchored nudge that shows on the recruiter's calendar grid and the dashboard This Week widget. Use this for 'remind me…' / 'add a reminder…' requests and for a pasted list of timed items; emit ONE create_reminder call PER reminder (six items = six calls in the same turn). reminderAtIso MUST be a full ISO-8601 timestamp WITH an explicit Eastern Time offset (-04:00 during EDT, -05:00 during EST, matching the reminder's date) — e.g. 2026-06-10T15:00:00-04:00. A bare/naive datetime with no offset is rejected, not created. Resolve relative phrasing ('in 20 minutes', 'in 2 hours', 'tonight', 'tomorrow', 'next Monday', '3pm') against the CURRENT Eastern time stated in the system instructions — never guess the current time. create_reminder executes immediately with no Confirm card; do not also write a confirmation sentence afterward.",
    input_schema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "What to be reminded about, e.g. 'Call Sara Johnson'.",
        },
        reminderAtIso: {
          type: "string",
          description:
            "ISO-8601 timestamp WITH an explicit Eastern offset (-04:00 EDT / -05:00 EST). Naive datetimes (no offset) are rejected.",
        },
        notifyLeadsMin: {
          type: "array",
          items: { type: "number" },
          description:
            "Optional minutes-before notification leads. Allowed values: 0, 15, 30, 60, 120, 1440. Defaults to 15 when omitted.",
        },
      },
      required: ["title", "reminderAtIso"],
    },
  },
  // Action tools — these never execute server-side. The chat route
  // intercepts the tool_use, emits an action_pending event back to the
  // panel, and stops streaming. The recruiter clicks Confirm/Cancel in
  // the panel; Confirm fires /api/claude-panel/action which performs
  // the Prisma write or hands the params back to the mail composer.
  // Cancel just dismisses the card. Andrew is the human-in-the-loop on
  // every write the assistant proposes, so a hallucinated stage move
  // never lands in Neon.
  {
    name: "move_candidate_stage",
    description:
      "Propose moving a candidate's placement to a new pipeline stage. The recruiter must Confirm before this lands. Pass the id you got back from search_candidates (the bracketed slug, cuid or numeric rfId, both work). placementId is OPTIONAL; if you skip it the server picks the candidate's most recent non-rejected placement automatically. newStage must be one of: sourced, applied, kept, submitted, interviewing, offer, pending_start, hired, rejected, cancelled.",
    input_schema: {
      type: "object",
      properties: {
        candidateId: {
          type: "string",
          description:
            "Candidate id from search_candidates (cuid OR numeric rfId, both resolve).",
        },
        placementId: {
          type: "string",
          description:
            "Placement cuid from get_pipeline. Optional; the server falls back to the candidate's most recent non-rejected placement.",
        },
        newStage: {
          type: "string",
          description:
            "Target stage. Allowed: sourced, applied, kept, submitted, interviewing, offer, pending_start, hired, rejected, cancelled.",
        },
      },
      required: ["candidateId", "newStage"],
    },
  },
  {
    name: "add_note",
    description:
      "Propose appending a note to a candidate, client, or job activity log. The recruiter must Confirm before this lands. Use this for 'leave a note that…' / 'log a follow-up…' / 'remember that…' style requests. Resolve the entity id via the search tools first; cuid OR legacy rfId both resolve.",
    input_schema: {
      type: "object",
      properties: {
        entityType: {
          type: "string",
          enum: ["candidate", "client", "job"],
          description: "Which record the note attaches to.",
        },
        entityId: {
          type: "string",
          description: "Identifier of the candidate / client / job (cuid OR numeric rfId).",
        },
        note: {
          type: "string",
          description: "The note text.",
        },
      },
      required: ["entityType", "entityId", "note"],
    },
  },
  {
    name: "draft_email",
    description:
      "Propose opening Ace's mail composer pre-filled with a draft. Never sends; the recruiter reviews and sends from the composer. Use this when the recruiter asks you to 'draft', 'write', 'compose', or 'send' an email; the recruiter still has to click Send themselves after Confirm.",
    input_schema: {
      type: "object",
      properties: {
        to: {
          type: "string",
          description: "Recipient email address.",
        },
        subject: {
          type: "string",
          description: "Email subject line.",
        },
        body: {
          type: "string",
          description: "Email body. Plain text or markdown; the composer cleans it up.",
        },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "inactivate_job",
    description:
      "Propose moving a job to the Inactive bucket (lifecycle=inactive, isOpen=false). Use this when the recruiter says 'inactivate', 'close out', 'shut down', or 'mark inactive' a job. Resolve the jobId from search_jobs first; cuid OR legacy rfId both resolve.",
    input_schema: {
      type: "object",
      properties: {
        jobId: {
          type: "string",
          description: "Job id from search_jobs (cuid OR numeric legacyRfId, both resolve).",
        },
      },
      required: ["jobId"],
    },
  },
  {
    name: "privatize_job",
    description:
      "Propose moving a job to the Private bucket (lifecycle=private, isOpen=true). Private jobs stay searchable / matchable but are hidden from the default Active tab on /jobs. Use when the recruiter says 'make private', 'hide from active', or 'move to private'.",
    input_schema: {
      type: "object",
      properties: {
        jobId: {
          type: "string",
          description: "Job id from search_jobs (cuid OR numeric legacyRfId, both resolve).",
        },
      },
      required: ["jobId"],
    },
  },
  {
    name: "reactivate_job",
    description:
      "Propose moving a job back to Active (lifecycle=active, isOpen=true) from Private or Inactive. Use when the recruiter says 'reactivate', 'reopen', or 'bring back to active'.",
    input_schema: {
      type: "object",
      properties: {
        jobId: {
          type: "string",
          description: "Job id from search_jobs (cuid OR numeric legacyRfId, both resolve).",
        },
      },
      required: ["jobId"],
    },
  },
  {
    name: "delete_job",
    description:
      "Propose permanently deleting a job. The recruiter must Confirm before this lands. Use when the recruiter explicitly says 'delete' / 'remove' / 'permanently delete' a job. Never use for routine 'inactivate' / 'close out' requests, which use inactivate_job instead. Cascades through Placement / Interview / CandidateMatch rows for the job.",
    input_schema: {
      type: "object",
      properties: {
        jobId: {
          type: "string",
          description: "Job id from search_jobs (cuid OR numeric legacyRfId, both resolve).",
        },
      },
      required: ["jobId"],
    },
  },
  {
    name: "delete_candidate",
    description:
      "Propose permanently deleting a candidate. The recruiter must Confirm before this lands. Use ONLY when the recruiter explicitly says 'delete' / 'remove' / 'permanently delete' a candidate by name. Cascades through Placement / Interview / CandidateResume / CandidateListMembership / CallLog / SmsMessage / GmailThreadTag rows for the candidate. Resolve the candidateId from search_candidates first; cuid OR numeric rfId both resolve.",
    input_schema: {
      type: "object",
      properties: {
        candidateId: {
          type: "string",
          description:
            "Candidate id from search_candidates (cuid OR numeric rfId, both resolve).",
        },
      },
      required: ["candidateId"],
    },
  },
  {
    name: "reset_activity_log",
    description:
      "Propose deleting ActionLog (activity log) rows in a date range. The recruiter must Confirm before anything lands. Use when the recruiter says 'clear / delete / reset' the activity log or audit trail. Pass dateFrom and/or dateTo as ISO 8601 (YYYY-MM-DD or full timestamp); omit both to wipe every activity log entry in the org. After the delete completes, a single audit row (actionType=data_reset_activity_log) lands so the reset itself is traceable.",
    input_schema: {
      type: "object",
      properties: {
        dateFrom: {
          type: "string",
          description:
            "Optional ISO 8601 lower bound (inclusive). Omit for no lower bound.",
        },
        dateTo: {
          type: "string",
          description:
            "Optional ISO 8601 upper bound (exclusive: pass the day AFTER the last day to include). Omit for no upper bound.",
        },
      },
    },
  },
  {
    name: "reset_placements",
    description:
      "Propose deleting Placement rows matching a filter, plus any dependent Interview rows for the same (candidate, job) pairs. The recruiter must Confirm before anything lands. Use when the recruiter says 'delete / wipe / reset' placements. Pass optional dateFrom / dateTo filters on placedAt, plus optional stage (one of: sourced, applied, kept, submitted, interviewing, offer, pending_start, hired, rejected, cancelled). Omit all three to match every placement in the org.",
    input_schema: {
      type: "object",
      properties: {
        dateFrom: {
          type: "string",
          description:
            "Optional ISO 8601 lower bound on Placement.placedAt (inclusive). Omit for no lower bound.",
        },
        dateTo: {
          type: "string",
          description:
            "Optional ISO 8601 upper bound on Placement.placedAt (exclusive). Omit for no upper bound.",
        },
        stage: {
          type: "string",
          description:
            "Optional stage filter. One of: sourced, applied, kept, submitted, interviewing, offer, pending_start, hired, rejected, cancelled.",
        },
      },
    },
  },
  {
    name: "update_placement_field",
    description:
      "Propose editing one field on a single Placement. The recruiter must Confirm before this lands. Only these fields may be edited: placedAt, startConfirmedAt, stage, feeAmount, offerReceivedAt. Date fields take an ISO 8601 string; stage takes one of the canonical stage strings; feeAmount takes a number in whole US dollars. Resolve the placementId via search_candidates → get_pipeline first; never invent it.",
    input_schema: {
      type: "object",
      properties: {
        placementId: {
          type: "string",
          description: "Placement cuid from get_pipeline.",
        },
        fieldName: {
          type: "string",
          description:
            "Which field to edit. One of: placedAt, startConfirmedAt, stage, feeAmount, offerReceivedAt.",
        },
        newValue: {
          type: "string",
          description:
            "The new value as a string. Dates: ISO 8601. Stage: a canonical stage label. feeAmount: a whole-dollar integer encoded as a numeric string.",
        },
      },
      required: ["placementId", "fieldName", "newValue"],
    },
  },
  {
    name: "inactivate_jobs",
    description:
      "BULK inactivate: propose moving MULTIPLE jobs to the Inactive bucket (lifecycle=inactive, isOpen=false) in ONE turn. Use THIS - not repeated inactivate_job calls - whenever the recruiter wants more than one job inactivated at once ('inactivate all active jobs', 'close out these roles'). FIRST enumerate the real job ids via search_jobs, then call this ONCE with every jobId in the array. Never invent ids. Each id may be a cuid OR a legacy rfId. One call produces ONE Confirm card listing all the jobs.",
    input_schema: {
      type: "object",
      properties: {
        jobIds: {
          type: "array",
          items: { type: "string" },
          description:
            "All job ids to inactivate, gathered from search_jobs (each a cuid OR numeric legacyRfId). Pass the FULL set in one call - do not split into multiple calls.",
        },
      },
      required: ["jobIds"],
    },
  },
  {
    name: "reactivate_jobs",
    description:
      "BULK reactivate: propose moving MULTIPLE jobs back to Active (lifecycle=active, isOpen=true) from Private or Inactive in ONE turn. Use THIS - not repeated reactivate_job calls - whenever the recruiter wants more than one job reactivated at once ('reactivate all private jobs', 'reopen these roles'). FIRST enumerate the real job ids via search_jobs, then call this ONCE with every jobId in the array. Never invent ids. Each id may be a cuid OR a legacy rfId. One call produces ONE Confirm card listing all the jobs.",
    input_schema: {
      type: "object",
      properties: {
        jobIds: {
          type: "array",
          items: { type: "string" },
          description:
            "All job ids to reactivate, gathered from search_jobs (each a cuid OR numeric legacyRfId). Pass the FULL set in one call - do not split into multiple calls.",
        },
      },
      required: ["jobIds"],
    },
  },
  {
    name: "delete_jobs",
    description:
      "BULK delete: propose permanently deleting MULTIPLE jobs in ONE turn. The recruiter must Confirm before anything lands. Use THIS - not repeated delete_job calls - whenever the recruiter explicitly says 'delete' / 'remove' / 'permanently delete' more than one job at once. Never use for routine 'inactivate' / 'close out' requests, which use inactivate_jobs instead. FIRST enumerate the real job ids via search_jobs, then call this ONCE with every jobId in the array. Never invent ids. Each id may be a cuid OR a legacy rfId. Cascades through Placement / Interview / CandidateMatch rows for each job. One call produces ONE Confirm card listing every job that will be deleted.",
    input_schema: {
      type: "object",
      properties: {
        jobIds: {
          type: "array",
          items: { type: "string" },
          description:
            "All job ids to permanently delete, gathered from search_jobs (each a cuid OR numeric legacyRfId). Pass the FULL set in one call - do not split into multiple calls.",
        },
      },
      required: ["jobIds"],
    },
  },
  {
    name: "delete_candidates",
    description:
      "BULK delete: propose permanently deleting MULTIPLE candidates in ONE turn. The recruiter must Confirm before anything lands. Use THIS - not repeated delete_candidate calls - ONLY when the recruiter explicitly says 'delete' / 'remove' / 'permanently delete' more than one candidate at once. FIRST enumerate the real candidate ids via search_candidates, then call this ONCE with every candidateId in the array. Never invent ids. Each id may be a cuid OR a numeric rfId. Cascades through Placement / Interview / CandidateResume / CandidateListMembership / CallLog / SmsMessage / GmailThreadTag rows for each candidate. One call produces ONE Confirm card listing every candidate that will be deleted.",
    input_schema: {
      type: "object",
      properties: {
        candidateIds: {
          type: "array",
          items: { type: "string" },
          description:
            "All candidate ids to permanently delete, gathered from search_candidates (each a cuid OR numeric rfId). Pass the FULL set in one call - do not split into multiple calls.",
        },
      },
      required: ["candidateIds"],
    },
  },
];

// Names of the client-managed action tools. The streaming loop matches
// against this set to decide between executeTool() and emitting an
// action_pending event.
const ACTION_TOOL_NAMES = new Set([
  "move_candidate_stage",
  "add_note",
  "draft_email",
  "inactivate_job",
  "privatize_job",
  "reactivate_job",
  "delete_job",
  "delete_candidate",
  "reset_activity_log",
  "reset_placements",
  "update_placement_field",
]);

// Bulk action tools — the same lifecycle / destructive operations as the
// single-id action tools above, but each carries an ARRAY of ids so the
// model can act on a whole enumerated set in ONE turn ("make all active
// jobs inactive", "delete these 5 candidates"). Kept OUT of
// ACTION_TOOL_NAMES on purpose: the streaming loop routes bulk calls
// through a dedicated branch that runs BEFORE the singular action branch
// and collapses the whole array to ONE batched Confirm card (deletes stay
// gated — the destructive-confirm rule), mirroring the reminder over-cap
// batch-confirm path. Separate set = the two filters never overlap.
const BULK_ACTION_TOOL_NAMES = new Set([
  "inactivate_jobs",
  "reactivate_jobs",
  "delete_jobs",
  "delete_candidates",
]);

const MAX_TOOL_ROUNDS = 4;

// Runaway-paste brake for create_reminder. At or under this many creates
// in a single assistant turn we fire them directly and return one
// receipt; ABOVE it we fall back to a single batch Confirm card so a
// huge accidental paste can't silently create dozens of reminders.
const MAX_DIRECT_REMINDERS = 10;

// Grammatical filler we strip before searching. Meaningful filter words
// (open, active, current, remote, hired, etc.) intentionally aren't in
// the list — those are signal, not noise.
const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "by", "did", "do",
  "does", "for", "from", "get", "got", "has", "have", "i", "if", "in",
  "into", "is", "it", "its", "me", "my", "of", "on", "or", "our", "out",
  "right", "show", "tell", "that", "the", "their", "them", "then",
  "there", "these", "this", "those", "to", "us", "was", "we", "were",
  "what", "when", "where", "which", "who", "whom", "with", "would", "you",
  "your", "find", "search", "list", "any", "all", "give", "want", "need",
  "looking", "look",
  // Temporal adverbs: stripping these is what lets "what jobs do I have
  // open right now" reduce to ["job", "open"] so isOpenJobsIntent fires
  // instead of falling through to keyword search where "now" matches
  // nothing meaningful.
  "now", "today", "currently", "recently", "lately", "presently",
]);

// Lightweight singularizer. Doesn't try to handle every English edge
// case — just the recruiting-vocab plurals (managers, engineers,
// accountants, candidates, jobs, roles…) and the obvious -ies / -sses
// patterns. Names will sometimes get over-stripped ("james" → "jame");
// that's fine because OR-search just over-matches a hair, and scoring
// keeps the actually-relevant rows on top.
function singularize(word: string): string {
  if (word.length < 4) return word;
  if (word.endsWith("ies") && word.length > 4) return word.slice(0, -3) + "y";
  if (/(sses|shes|ches|xes|oes|zes)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("ss")) return word;
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
}

// Lowercase, drop punctuation, split, strip stop words, singularize.
// Returns deduped tokens preserving first-seen order.
function normalizeQuery(query: string): string[] {
  if (!query) return [];
  const raw = query
    .toLowerCase()
    .replace(/[^\w\s\-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !STOP_WORDS.has(t))
    .map(singularize);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

// Tokens that, when normalized, indicate a "show me my open jobs"
// intent rather than a keyword search. If every normalized token in
// the user's query is in this set, search_jobs bypasses keyword
// scoring and just lists isOpen=true jobs.
const OPEN_JOB_INTENT_TOKENS = new Set([
  "job", "role", "open", "opening", "active", "current", "available",
]);

function isOpenJobsIntent(tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  return tokens.every((t) => OPEN_JOB_INTENT_TOKENS.has(t));
}

// Map any reasonable phrasing of a pipeline stage to the canonical
// values the data layer understands. Returns null if we can't make
// sense of it; the tool falls back to "no stage filter" in that case.
type StageId = "interviewing" | "offer" | "pending_start" | "hired" | "submitted";
function normalizeStage(input: string | undefined): StageId | null {
  if (!input) return null;
  const t = input.toLowerCase().replace(/[\s_]+/g, " ").trim();
  if (/^(interview|interviewing|interviews|interviewed)$/.test(t)) return "interviewing";
  if (/^(offer|offers|offered|offering)$/.test(t)) return "offer";
  if (/^(pending start|pending|start|to start|starting)$/.test(t)) return "pending_start";
  if (/^(hired|placed|placement|placements|start confirmed)$/.test(t)) return "hired";
  if (/^(submit|submitted|submission|submissions|applied|application)$/.test(t)) return "submitted";
  return null;
}

type IncomingMessage = { role: unknown; content: unknown };

function joinName(first: string | null | undefined, last: string | null | undefined): string {
  const parts = [first, last].map((p) => (p ?? "").trim()).filter(Boolean);
  return parts.length ? parts.join(" ") : "(unnamed)";
}

// Slug helpers — match the rest of the app: prefer the legacy RF
// numeric id when present, fall back to the cuid. The /candidates/[id]
// and /jobs/[id] routes accept either form via getXByIdentifier, so
// the deep links resolve no matter which the row was created under.
function candidateSlug(c: { id: string; rfId: number | null }): string {
  return c.rfId != null ? String(c.rfId) : c.id;
}
function jobSlug(j: { id: string; legacyRfId: number | null }): string {
  return j.legacyRfId != null ? String(j.legacyRfId) : j.id;
}
function candidateLink(
  c: { id: string; rfId: number | null; firstName: string | null; lastName: string | null },
): string {
  return `[${joinName(c.firstName, c.lastName)}](/candidates/${candidateSlug(c)})`;
}
function jobLink(j: { id: string; legacyRfId: number | null; title: string }): string {
  return `[${j.title}](/jobs/${jobSlug(j)})`;
}

// Per-token, per-field substring score — case-insensitive. Returns 0
// when the haystack doesn't contain the token; 1 (token-only line) up
// to a small bonus when the haystack equals the token (exact match).
function scoreToken(haystack: string | null | undefined, token: string): number {
  if (!haystack) return 0;
  const h = haystack.toLowerCase();
  if (!h.includes(token)) return 0;
  // Exact match (whole field equals token, or token is a stand-alone
  // word in the field) ranks higher than a noisy substring hit.
  const wordRe = new RegExp(`\\b${token.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`);
  if (h === token) return 2;
  if (wordRe.test(h)) return 1.5;
  return 1;
}

function scoreArrayToken(haystack: string[] | null | undefined, token: string): number {
  if (!haystack || haystack.length === 0) return 0;
  let best = 0;
  for (const item of haystack) {
    const s = scoreToken(item, token);
    if (s > best) best = s;
  }
  return best;
}

type SearchCandidatesOpts = {
  query: string;
  sortBy: "relevance" | "createdAt";
  order: "asc" | "desc";
  limit: number;
};

// Tool: search_candidates — two modes.
//  - sortBy='createdAt': straight createdAt-ordered list, optional
//    token OR-filter, no JS scoring. Used for "recently imported" /
//    "newest candidates" prompts.
//  - sortBy='relevance' (default): broad OR pull, JS scoring, top N.
//    Field weights: title and employer matter more than a name
//    fragment; location helps; tags and skills are lower-weight signal.
async function runSearchCandidates(
  opts: SearchCandidatesOpts,
  orgId: string,
): Promise<string> {
  const { query, sortBy, order, limit } = opts;

  if (sortBy === "createdAt") {
    return runSearchCandidatesByCreatedAt(query, order, limit, orgId);
  }

  const tokens = normalizeQuery(query);
  if (tokens.length === 0) {
    log("search_candidates", { query }, 0, "no-meaningful-tokens");
    return `No meaningful search terms in "${query}" after stripping stop words.`;
  }

  // OR across (token × field). Any single token-field hit qualifies the
  // row; ranking happens in JS so we don't lose true positives to the
  // strict AND we shipped in the first cut.
  const or: Prisma.CandidateWhereInput[] = [];
  for (const t of tokens) {
    or.push(
      { firstName: { contains: t, mode: "insensitive" } },
      { lastName: { contains: t, mode: "insensitive" } },
      { currentDesignation: { contains: t, mode: "insensitive" } },
      { currentOrganization: { contains: t, mode: "insensitive" } },
      { location: { contains: t, mode: "insensitive" } },
      { email: { contains: t, mode: "insensitive" } },
      { skills: { has: t } },
      { tags: { has: t } },
    );
  }

  // Pull broad set + total count in parallel so we can show "Showing
  // N of X — ask me to show more…" when the DB has more matches than
  // we surfaced. The count uses the same WHERE so it stays honest.
  const broadWhere: Prisma.CandidateWhereInput = { organizationId: orgId, OR: or };
  const [broad, totalMatching] = await Promise.all([
    prisma.candidate.findMany({
      where: broadWhere,
      select: {
        id: true,
        rfId: true,
        firstName: true,
        lastName: true,
        currentDesignation: true,
        currentOrganization: true,
        location: true,
        tags: true,
        skills: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 75,
    }),
    prisma.candidate.count({ where: broadWhere }),
  ]);

  type Row = (typeof broad)[number];
  const W = { title: 3, employer: 2.5, location: 2, name: 1, skills: 1.5, tags: 1 };
  const ranked = broad
    .map((c: Row) => {
      let score = 0;
      let hits = 0;
      const name = joinName(c.firstName, c.lastName).toLowerCase();
      for (const t of tokens) {
        let perToken = 0;
        perToken += W.title * scoreToken(c.currentDesignation, t);
        perToken += W.employer * scoreToken(c.currentOrganization, t);
        perToken += W.location * scoreToken(c.location, t);
        perToken += W.name * scoreToken(name, t);
        perToken += W.skills * scoreArrayToken(c.skills, t);
        perToken += W.tags * scoreArrayToken(c.tags, t);
        if (perToken > 0) hits++;
        score += perToken;
      }
      // Multi-token rows beat single-token rows of the same per-token
      // score: doubling up on signal beats one isolated keyword hit.
      score += hits * 1.5;
      return { c, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.c.updatedAt.getTime() - a.c.updatedAt.getTime();
    })
    .slice(0, limit);

  log("search_candidates", { query, tokens, totalMatching }, ranked.length);

  if (ranked.length === 0) return `No candidates matched "${query}".`;
  const lines = ranked.map(({ c }, i) => {
    const title = c.currentDesignation || "—";
    const employer = c.currentOrganization || "—";
    const loc = c.location || "—";
    const tags = c.tags?.length ? `, tags: ${c.tags.slice(0, 4).join(", ")}` : "";
    return `${i + 1}. ${candidateLink(c)}, ${title} at ${employer}, ${loc}${tags}`;
  });
  // Overflow banner triggers when more rows match the broad WHERE than
  // we ranked. Uses the user's literal "show more" phrasing so Claude
  // can quote it back if Andrew asks for the next batch.
  const overflow =
    totalMatching > ranked.length
      ? `\n\nShowing ${ranked.length} of ${totalMatching}. Ask me to show more and I'll load the next batch.`
      : "";
  return `Top ${ranked.length} candidate match${ranked.length === 1 ? "" : "es"} for "${query}":\n${lines.join("\n")}${overflow}`;
}

// Createdat-ordered branch — used for "recently imported" / "newest"
// requests. Skips the relevance scorer entirely; an optional token
// OR-filter narrows the result set when the recruiter pairs the
// temporal phrasing with a keyword ("the 25 sales reps I just
// imported"), but an empty query just lists newest org-wide.
async function runSearchCandidatesByCreatedAt(
  query: string,
  order: "asc" | "desc",
  limit: number,
  orgId: string,
): Promise<string> {
  const tokens = normalizeQuery(query);
  const where: Prisma.CandidateWhereInput = { organizationId: orgId };
  if (tokens.length > 0) {
    const or: Prisma.CandidateWhereInput[] = [];
    for (const t of tokens) {
      or.push(
        { firstName: { contains: t, mode: "insensitive" } },
        { lastName: { contains: t, mode: "insensitive" } },
        { currentDesignation: { contains: t, mode: "insensitive" } },
        { currentOrganization: { contains: t, mode: "insensitive" } },
        { location: { contains: t, mode: "insensitive" } },
        { email: { contains: t, mode: "insensitive" } },
        { skills: { has: t } },
        { tags: { has: t } },
      );
    }
    where.OR = or;
  }

  const rows = await prisma.candidate.findMany({
    where,
    select: {
      id: true,
      rfId: true,
      firstName: true,
      lastName: true,
      currentDesignation: true,
      currentOrganization: true,
      location: true,
      tags: true,
      createdAt: true,
    },
    orderBy: { createdAt: order },
    take: limit,
  });

  log(
    "search_candidates",
    { query, sortBy: "createdAt", order, limit, tokens },
    rows.length,
  );

  if (rows.length === 0) {
    return tokens.length > 0
      ? `No candidates matched "${query}".`
      : "No candidates yet.";
  }

  const lines = rows.map((c, i) => {
    const title = c.currentDesignation || "—";
    const employer = c.currentOrganization || "—";
    const loc = c.location || "—";
    const when = c.createdAt.toISOString().slice(0, 10);
    return `${i + 1}. ${candidateLink(c)}, ${title} at ${employer}, ${loc}, added ${when}`;
  });
  const direction = order === "desc" ? "newest" : "oldest";
  const filterNote = tokens.length > 0 ? ` matching "${query}"` : "";
  return `${rows.length} ${direction} candidate${rows.length === 1 ? "" : "s"}${filterNote}:\n${lines.join("\n")}`;
}

// Tool: search_jobs — intent-aware. "what jobs do I have open" / "show
// active roles" / "any current openings" all dispatch to the open-jobs
// branch which lists every isOpen=true row regardless of keyword
// matching. Anything more specific falls through to the scored search.
async function runSearchJobs(query: string, orgId: string): Promise<string> {
  const tokens = normalizeQuery(query);

  if (isOpenJobsIntent(tokens)) {
    // Defensive OR: there's no `status` text column on Job (canonical
    // open signal is `isOpen`), but RF-imported rows also carry a
    // jobStatus JSON blob shaped like { id, name, color }. Surface
    // anything where isOpen=true OR jobStatus.name='Active' in case
    // the two ever drift on a legacy import. No client filter — the
    // whole point of this branch is "all open jobs across all clients."
    const where: Prisma.JobWhereInput = {
      organizationId: orgId,
      OR: [
        { isOpen: true },
        { jobStatus: { path: ["name"], equals: "Active" } },
      ],
    };
    const [totalOpen, rows] = await Promise.all([
      prisma.job.count({ where }),
      prisma.job.findMany({
        where,
        select: {
          id: true,
          legacyRfId: true,
          title: true,
          locations: true,
          client: { select: { name: true } },
          updatedAt: true,
        },
        orderBy: { updatedAt: "desc" },
        take: 30,
      }),
    ]);
    // Explicit pre-return log so Vercel function logs prove the query
    // ran and how many rows came back — separate from the structured
    // log() below so it's grep-friendly when triaging from the dashboard.
    // eslint-disable-next-line no-console
    console.log(
      "[claude-panel.tool] search_jobs open-jobs branch: totalOpen=" + totalOpen,
      "returned=" + rows.length,
      "orgId=" + orgId,
    );
    log("search_jobs", { query, intent: "open_jobs", totalOpen }, rows.length);
    if (rows.length === 0) return "No open jobs in the CRM right now.";
    const lines = rows.map((j, i) => {
      const loc = j.locations?.length ? j.locations.join("; ") : "—";
      const clientName = j.client?.name ?? "—";
      return `${i + 1}. ${jobLink(j)}, ${clientName}, ${loc}`;
    });
    const overflow =
      totalOpen > rows.length
        ? `\n\nShowing ${rows.length} of ${totalOpen}. Ask me to show more and I'll load the next batch.`
        : "";
    return `Open jobs (${rows.length}):\n${lines.join("\n")}${overflow}`;
  }

  if (tokens.length === 0) {
    log("search_jobs", { query }, 0, "no-meaningful-tokens");
    return `No meaningful search terms in "${query}" after stripping stop words.`;
  }

  const or: Prisma.JobWhereInput[] = [];
  for (const t of tokens) {
    or.push(
      { title: { contains: t, mode: "insensitive" } },
      { employmentType: { contains: t, mode: "insensitive" } },
      { department: { contains: t, mode: "insensitive" } },
      { locations: { has: t } },
      { client: { is: { name: { contains: t, mode: "insensitive" } } } },
    );
  }

  const broadWhere: Prisma.JobWhereInput = { organizationId: orgId, OR: or };
  const [broad, totalMatching] = await Promise.all([
    prisma.job.findMany({
      where: broadWhere,
      select: {
        id: true,
        legacyRfId: true,
        title: true,
        isOpen: true,
        employmentType: true,
        department: true,
        locations: true,
        client: { select: { name: true } },
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 75,
    }),
    prisma.job.count({ where: broadWhere }),
  ]);

  type Row = (typeof broad)[number];
  const W = { title: 3, client: 3, location: 2, dept: 1.5, type: 1 };
  const ranked = broad
    .map((j: Row) => {
      let score = 0;
      let hits = 0;
      for (const t of tokens) {
        let per = 0;
        per += W.title * scoreToken(j.title, t);
        per += W.client * scoreToken(j.client?.name, t);
        per += W.location * scoreArrayToken(j.locations, t);
        per += W.dept * scoreToken(j.department, t);
        per += W.type * scoreToken(j.employmentType, t);
        if (per > 0) hits++;
        score += per;
      }
      score += hits * 1.5;
      // Open jobs rank slightly above closed ones at equal score so a
      // fresh "Senior Tax Manager" search doesn't bury the live req
      // under last quarter's identical title.
      if (j.isOpen) score += 0.5;
      return { j, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.j.updatedAt.getTime() - a.j.updatedAt.getTime();
    })
    .slice(0, 10);

  log("search_jobs", { query, tokens, totalMatching }, ranked.length);

  if (ranked.length === 0) return `No jobs matched "${query}".`;
  const lines = ranked.map(({ j }, i) => {
    const status = j.isOpen ? "open" : "closed";
    const loc = j.locations?.length ? j.locations.join("; ") : "—";
    const clientName = j.client?.name ?? "—";
    return `${i + 1}. ${jobLink(j)}, ${clientName}, ${loc}, ${status}`;
  });
  const overflow =
    totalMatching > ranked.length
      ? `\n\nShowing ${ranked.length} of ${totalMatching}. Ask me to show more and I'll load the next batch.`
      : "";
  return `Top ${ranked.length} job match${ranked.length === 1 ? "" : "es"} for "${query}":\n${lines.join("\n")}${overflow}`;
}

// Tool: search_clients — broad pull + JS scoring. Client.location is
// a Json blob so we read it post-fetch via formatLocation rather than
// filter-time JSON path matching (which Prisma would force into raw
// SQL). Tokens AND-rank against name, industry, domain, tags, and the
// flattened location string.
async function runSearchClients(query: string, orgId: string): Promise<string> {
  const tokens = normalizeQuery(query);
  if (tokens.length === 0) {
    log("search_clients", { query }, 0, "no-meaningful-tokens");
    return `No meaningful search terms in "${query}" after stripping stop words.`;
  }

  // Two-source fetch: text-column matches (Prisma-side OR) plus a
  // recent slice (so location-only matches still get reached). The
  // recent slice is bounded to 200 — large enough to cover Andrew's
  // current client list but small enough not to scan the whole table.
  const or: Prisma.ClientWhereInput[] = [];
  for (const t of tokens) {
    or.push(
      { name: { contains: t, mode: "insensitive" } },
      { industry: { contains: t, mode: "insensitive" } },
      { domain: { contains: t, mode: "insensitive" } },
      { tags: { has: t } },
    );
  }
  const [textHits, recent] = await Promise.all([
    prisma.client.findMany({
      where: { organizationId: orgId, OR: or },
      select: {
        id: true,
        name: true,
        industry: true,
        location: true,
        domain: true,
        tags: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 75,
    }),
    prisma.client.findMany({
      where: { organizationId: orgId },
      select: {
        id: true,
        name: true,
        industry: true,
        location: true,
        domain: true,
        tags: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
  ]);
  const seen = new Set<string>();
  const candidates: typeof textHits = [];
  for (const r of [...textHits, ...recent]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    candidates.push(r);
  }

  type Row = (typeof candidates)[number];
  const W = { name: 3, industry: 2, location: 2, domain: 1.5, tags: 1 };
  const ranked = candidates
    .map((c: Row) => {
      const locStr = formatLocation(c.location as Parameters<typeof formatLocation>[0]) || "";
      let score = 0;
      let hits = 0;
      for (const t of tokens) {
        let per = 0;
        per += W.name * scoreToken(c.name, t);
        per += W.industry * scoreToken(c.industry, t);
        per += W.location * scoreToken(locStr, t);
        per += W.domain * scoreToken(c.domain, t);
        per += W.tags * scoreArrayToken(c.tags, t);
        if (per > 0) hits++;
        score += per;
      }
      score += hits * 1.5;
      return { c, locStr, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.c.updatedAt.getTime() - a.c.updatedAt.getTime();
    })
    .slice(0, 10);

  log("search_clients", { query, tokens }, ranked.length);

  if (ranked.length === 0) return `No clients matched "${query}".`;
  const lines = ranked.map(({ c, locStr }, i) => {
    const industry = c.industry || "—";
    const loc = locStr || "—";
    return `${i + 1}. ${c.name}, ${industry}, ${loc}, id: ${c.id}`;
  });
  return `Top ${ranked.length} client match${ranked.length === 1 ? "" : "es"} for "${query}":\n${lines.join("\n")}`;
}

// Tool: get_pipeline — stage-aware routing. "interviewing" reads
// upcoming Interview rows; offer / pending_start / hired hit Placement
// (rule 13: placement.stage is canonical); "submitted" doesn't have an
// authoritative source in Neon (it's RF flat-pipeline data) so we say
// so plainly instead of inventing rows. clientName is a forgiving
// substring match — "Sheehan" matches "Sheehan Brothers Vending".
async function runGetPipeline(
  args: { clientName?: string; stage?: string; historical?: boolean },
  orgId: string,
): Promise<string> {
  const clientName = args.clientName?.trim() || "";
  const stage = normalizeStage(args.stage);

  // Historical mode: merge Placement (every stage, every date) and
  // Interview (every status, every date) for the optional client and
  // sort by activity desc. Stage filter is intentionally ignored —
  // the question being answered is "what's the full history with X",
  // not "what's at offer right now". Cap at 30 merged rows.
  if (args.historical === true) {
    const placementWhere: Prisma.PlacementWhereInput = { organizationId: orgId };
    const interviewWhere: Prisma.InterviewWhereInput = { organizationId: orgId };
    if (clientName) {
      const clientFilter = { is: { name: { contains: clientName, mode: "insensitive" as const } } };
      placementWhere.client = clientFilter;
      interviewWhere.client = clientFilter;
    }
    const [placements, interviews] = await Promise.all([
      prisma.placement.findMany({
        where: placementWhere,
        select: {
          id: true,
          stage: true,
          updatedAt: true,
          createdAt: true,
          candidate: { select: { firstName: true, lastName: true } },
          job: { select: { title: true } },
          client: { select: { name: true } },
        },
        orderBy: { updatedAt: "desc" },
        take: 60,
      }),
      prisma.interview.findMany({
        where: interviewWhere,
        select: {
          id: true,
          status: true,
          type: true,
          scheduledAt: true,
          candidate: { select: { firstName: true, lastName: true } },
          job: { select: { title: true } },
          client: { select: { name: true } },
        },
        orderBy: { scheduledAt: "desc" },
        take: 60,
      }),
    ]);

    type Merged = {
      kind: "placement" | "interview";
      sortDate: Date;
      candidateName: string;
      jobTitle: string;
      clientName: string;
      detail: string;
    };
    const rows: Merged[] = [];
    for (const p of placements) {
      rows.push({
        kind: "placement",
        sortDate: p.updatedAt,
        candidateName: p.candidate ? joinName(p.candidate.firstName, p.candidate.lastName) : "(unknown candidate)",
        jobTitle: p.job?.title ?? "(unknown job)",
        clientName: p.client?.name ?? "(unknown client)",
        detail: `stage=${p.stage} updated=${p.updatedAt.toISOString().slice(0, 10)}`,
      });
    }
    for (const iv of interviews) {
      rows.push({
        kind: "interview",
        sortDate: iv.scheduledAt,
        candidateName: iv.candidate ? joinName(iv.candidate.firstName, iv.candidate.lastName) : "(unknown candidate)",
        jobTitle: iv.job?.title ?? "(unknown job)",
        clientName: iv.client?.name ?? "(unknown client)",
        detail: `${iv.type} ${iv.status} ${iv.scheduledAt.toISOString().slice(0, 10)}`,
      });
    }
    rows.sort((a, b) => b.sortDate.getTime() - a.sortDate.getTime());
    const top = rows.slice(0, 30);

    log(
      "get_pipeline",
      { clientName, historical: true },
      top.length,
      `placements=${placements.length} interviews=${interviews.length}`,
    );

    if (top.length === 0) {
      return clientName
        ? `No pipeline history found for "${clientName}" (no placements or interviews on file).`
        : "No pipeline history found.";
    }
    const lines = top.map((r, i) => {
      return `${i + 1}. [${r.kind}] ${r.candidateName}, ${r.jobTitle}, ${r.clientName}, ${r.detail}`;
    });
    const overflow =
      rows.length > top.length
        ? `\n\nShowing ${top.length} of ${rows.length}. Ask me to narrow by stage or date if you want a tighter slice.`
        : "";
    return `Pipeline history${clientName ? ` for "${clientName}"` : ""} (${top.length} rows, placements + interviews merged, most recent first):\n${lines.join("\n")}${overflow}`;
  }

  if (stage === "submitted") {
    log("get_pipeline", { clientName, stage: args.stage }, 0, "submitted-not-tracked");
    return (
      "Submitted-stage candidates aren't tracked directly in Ace's Placement table; that stage lives in the candidate's RF pipeline data. " +
      "Use search_candidates with the relevant client/job context, or ask about a stage that Ace tracks (interviewing, offer, pending_start, hired)."
    );
  }

  if (stage === "interviewing") {
    const where: Prisma.InterviewWhereInput = {
      organizationId: orgId,
      status: "scheduled",
      scheduledAt: { gte: new Date() },
    };
    if (clientName) {
      where.client = { is: { name: { contains: clientName, mode: "insensitive" } } };
    }
    const rows = await prisma.interview.findMany({
      where,
      select: {
        id: true,
        scheduledAt: true,
        type: true,
        candidate: { select: { firstName: true, lastName: true } },
        job: { select: { title: true } },
        client: { select: { name: true } },
      },
      orderBy: { scheduledAt: "asc" },
      take: 20,
    });
    log("get_pipeline", { clientName, stage: "interviewing" }, rows.length);
    if (rows.length === 0) {
      return clientName
        ? `No upcoming interviews scheduled for "${clientName}".`
        : "No upcoming interviews scheduled.";
    }
    const lines = rows.map((iv, i) => {
      const cand = iv.candidate ? joinName(iv.candidate.firstName, iv.candidate.lastName) : "(unknown candidate)";
      const job = iv.job?.title ?? "(unknown job)";
      const cl = iv.client?.name ?? "(unknown client)";
      const when = iv.scheduledAt.toISOString().replace("T", " ").slice(0, 16);
      return `${i + 1}. ${cand}, ${job}, ${cl}, ${iv.type}, ${when} UTC, id: ${iv.id}`;
    });
    return `Upcoming interviews${clientName ? ` for "${clientName}"` : ""} (${rows.length}):\n${lines.join("\n")}`;
  }

  // offer / pending_start / hired / no-stage-filter — Placement model.
  const where: Prisma.PlacementWhereInput = { organizationId: orgId };
  if (stage) where.stage = stage;
  if (clientName) {
    where.client = { is: { name: { contains: clientName, mode: "insensitive" } } };
  }

  const rows = await prisma.placement.findMany({
    where,
    select: {
      id: true,
      stage: true,
      updatedAt: true,
      candidate: { select: { firstName: true, lastName: true } },
      job: { select: { title: true } },
      client: { select: { name: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });

  log("get_pipeline", { clientName, stage: stage ?? null }, rows.length);

  if (rows.length === 0) {
    const filterDesc = [
      clientName ? `client="${clientName}"` : null,
      stage ? `stage="${stage}"` : null,
    ]
      .filter(Boolean)
      .join(", ");
    return `No pipeline rows found${filterDesc ? ` (${filterDesc})` : ""}.`;
  }

  const lines = rows.map((p, i) => {
    const cand = p.candidate ? joinName(p.candidate.firstName, p.candidate.lastName) : "(unknown candidate)";
    const job = p.job?.title ?? "(unknown job)";
    const cl = p.client?.name ?? "(unknown client)";
    const updated = p.updatedAt.toISOString().slice(0, 10);
    return `${i + 1}. ${cand}, ${job}, ${cl}, stage: ${p.stage}, updated: ${updated}`;
  });
  return `Pipeline${clientName ? ` for "${clientName}"` : ""}${stage ? ` (stage=${stage})` : ""}: ${rows.length} row${rows.length === 1 ? "" : "s"}:\n${lines.join("\n")}`;
}

// Single point of tool-call telemetry. One line per call so the Vercel
// function logs read like a routing decision audit trail. We log the
// tool name, sanitized inputs, normalized tokens (when relevant), and
// the row count returned to Claude — never email bodies, resumes, or
// other PII payloads.
function log(
  tool: string,
  input: Record<string, unknown>,
  rowCount: number,
  note?: string,
): void {
  const safeInput: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === "string") {
      safeInput[k] = v.length > 120 ? v.slice(0, 117) + "…" : v;
    } else if (Array.isArray(v)) {
      safeInput[k] = v.slice(0, 12);
    } else {
      safeInput[k] = v;
    }
  }
  // eslint-disable-next-line no-console
  console.log("[claude-panel.tool]", tool, safeInput, "rows=" + rowCount, note ?? "");
}

// Resolve a candidate by cuid OR legacy numeric rfId, scoped to the
// caller's tenant. search_candidates surfaces results via markdown
// links shaped /candidates/{rfId-or-cuid}, so Claude often passes the
// numeric form back here — accepting both keeps the action card from
// reading "(unknown candidate)" just because Claude picked the wrong
// identifier shape.
async function resolveCandidate(idOrRfId: string, orgId: string) {
  if (!idOrRfId) return null;
  if (/^\d+$/.test(idOrRfId)) {
    const rfId = Number(idOrRfId);
    if (!Number.isFinite(rfId)) return null;
    return prisma.candidate.findFirst({
      where: { rfId, organizationId: orgId },
      select: { id: true, rfId: true, firstName: true, lastName: true },
    });
  }
  return prisma.candidate.findFirst({
    where: { id: idOrRfId, organizationId: orgId },
    select: { id: true, rfId: true, firstName: true, lastName: true },
  });
}

async function resolveClient(idOrRfId: string, orgId: string) {
  if (!idOrRfId) return null;
  if (/^\d+$/.test(idOrRfId)) {
    const legacyRfId = Number(idOrRfId);
    if (!Number.isFinite(legacyRfId)) return null;
    return prisma.client.findFirst({
      where: { legacyRfId, organizationId: orgId },
      select: { id: true, name: true },
    });
  }
  return prisma.client.findFirst({
    where: { id: idOrRfId, organizationId: orgId },
    select: { id: true, name: true },
  });
}

async function resolveJob(idOrRfId: string, orgId: string) {
  if (!idOrRfId) return null;
  if (/^\d+$/.test(idOrRfId)) {
    const legacyRfId = Number(idOrRfId);
    if (!Number.isFinite(legacyRfId)) return null;
    return prisma.job.findFirst({
      where: { legacyRfId, organizationId: orgId },
      select: { id: true, title: true },
    });
  }
  return prisma.job.findFirst({
    where: { id: idOrRfId, organizationId: orgId },
    select: { id: true, title: true },
  });
}

// Same lookup as resolveJob, but carries the client name, the
// canonical lifecycle (Active / Private / Inactive), and the legacy
// isOpen flag so lifecycle / delete action cards can render
// "Inactivate Senior Engineer at Acme — already inactive" without a
// second round-trip.
async function resolveJobWithClient(idOrRfId: string, orgId: string) {
  if (!idOrRfId) return null;
  if (/^\d+$/.test(idOrRfId)) {
    const legacyRfId = Number(idOrRfId);
    if (!Number.isFinite(legacyRfId)) return null;
    return prisma.job.findFirst({
      where: { legacyRfId, organizationId: orgId },
      select: {
        id: true,
        title: true,
        isOpen: true,
        lifecycle: true,
        client: { select: { name: true } },
      },
    });
  }
  return prisma.job.findFirst({
    where: { id: idOrRfId, organizationId: orgId },
    select: {
      id: true,
      title: true,
      isOpen: true,
      lifecycle: true,
      client: { select: { name: true } },
    },
  });
}

function deriveLifecycle(
  lifecycle: string | null | undefined,
  isOpen: boolean | null | undefined,
): "active" | "private" | "inactive" {
  if (lifecycle === "private" || lifecycle === "inactive" || lifecycle === "active") {
    return lifecycle;
  }
  return isOpen ? "active" : "inactive";
}

// Pick the placement we'd move when Claude doesn't pass one. Most
// recent updatedAt wins, rejected/cancelled rows are excluded so the
// recruiter doesn't accidentally re-stage a closed placement when
// asking "move Sara to interviewing". Tied to the candidate cuid
// (already resolved) AND organizationId so cross-tenant ids 404
// instead of mutating the wrong row.
async function pickActivePlacement(candidateCuid: string, orgId: string) {
  return prisma.placement.findFirst({
    where: {
      candidateId: candidateCuid,
      organizationId: orgId,
      stage: { notIn: ["rejected", "cancelled"] },
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      stage: true,
      job: { select: { title: true } },
    },
  });
}

// Structured payload the panel renders verbatim into the confirmation
// card. The previous shape was a single description string, which the
// card had no way to break apart — names ended up "(unknown)" any
// time the lookup couldn't reconcile a numeric rfId vs a cuid. Now we
// resolve everything server-side and ship the parts the card needs.
type ActionResolution =
  | {
      kind: "move_candidate_stage";
      description: string;
      candidateName: string;
      fromStage: string;
      toStage: string;
      jobTitle: string;
      candidateId: string | null;     // resolved cuid for the action POST
      placementId: string | null;     // resolved cuid for the action POST
    }
  | {
      kind: "add_note";
      description: string;
      entityType: "candidate" | "client" | "job";
      entityId: string | null;        // resolved cuid for the action POST
      entityName: string;
      note: string;
    }
  | {
      kind: "draft_email";
      description: string;
      to: string;
      subject: string;
      body: string;
    }
  | {
      kind: "inactivate_job" | "privatize_job" | "reactivate_job";
      description: string;
      jobId: string | null;
      jobTitle: string;
      clientName: string;
      currentLifecycle: "active" | "private" | "inactive" | null;
      targetLifecycle: "active" | "private" | "inactive";
      noOp: boolean;            // job is already in the target state
    }
  | {
      kind: "delete_job";
      description: string;
      jobId: string | null;
      jobTitle: string;
      clientName: string;
    }
  | {
      kind: "delete_candidate";
      description: string;
      candidateId: string | null;
      candidateName: string;
    }
  | {
      kind: "bulk_action";
      description: string;
      action:
        | "inactivate_jobs"
        | "reactivate_jobs"
        | "delete_jobs"
        | "delete_candidates";
      verb: "Inactivate" | "Reactivate" | "Delete";
      noun: "jobs" | "candidates";
      destructive: boolean;     // delete_* — the card must keep its Confirm
      count: number;            // resolved targets (cross-tenant/unknown dropped)
      requestedCount: number;   // ids the model passed in
      unresolvedCount: number;  // dropped ids → reported as per-item failures at execute time
      cascadeNote: string | null; // deletes: the cascade scope warning for the card
      // Full resolved cuid + display label list. Deletes show every NAME
      // (not just a count) so the recruiter sees exactly what cascades.
      // The executor (later prompt) acts on these canonical cuids.
      items: Array<{ id: string; label: string }>;
    }
  | {
      kind: "reset_activity_log";
      description: string;
      count: number;
      // ISO strings so the action route can re-run the same filter at
      // confirm time. Labels are pre-formatted for display.
      dateFromIso: string | null;
      dateToIso: string | null;
      dateFromLabel: string;
      dateToLabel: string;
    }
  | {
      kind: "reset_placements";
      description: string;
      count: number;
      // Carry the cuid list at describe time so confirm executes on
      // exactly the rows the recruiter saw — not "whatever matches the
      // filter now" (which could drift if new placements land between
      // preview and confirm).
      placementIds: string[];
      previewRows: Array<{
        id: string;
        candidateName: string;
        jobTitle: string;
        stage: string;
        placedAtLabel: string;
      }>;
      dateFromIso: string | null;
      dateToIso: string | null;
      stage: string | null;
    }
  | {
      kind: "update_placement_field";
      description: string;
      placementId: string | null;
      candidateName: string;
      jobTitle: string;
      fieldName: PlacementEditableField;
      oldValueLabel: string;
      newValueLabel: string;
      // Raw parsed value the action route writes. Stage is a string;
      // dates serialize as ISO; feeAmount serializes as a number.
      newValueRaw: string | number | null;
      validationError: string | null;
    }
  | {
      kind: "unknown";
      description: string;
    };

// Fields the assistant is allowed to edit on a Placement via
// update_placement_field. We restrict to this short list because every
// other Placement column either: (a) is computed from another column,
// (b) is a backfill artifact that shouldn't be edited from the panel,
// or (c) carries multi-field invariants the panel can't enforce.
const PLACEMENT_EDITABLE_FIELDS = [
  "placedAt",
  "startConfirmedAt",
  "stage",
  "feeAmount", // public name; maps to Placement.feeTotal in Prisma
  "offerReceivedAt",
] as const;
type PlacementEditableField = (typeof PLACEMENT_EDITABLE_FIELDS)[number];

function isEditablePlacementField(s: string): s is PlacementEditableField {
  return (PLACEMENT_EDITABLE_FIELDS as ReadonlyArray<string>).includes(s);
}

const PLACEMENT_STAGES = [
  "sourced",
  "applied",
  "kept",
  "submitted",
  "interviewing",
  "offer",
  "pending_start",
  "hired",
  "rejected",
  "cancelled",
] as const;

function isAllowedStageValue(s: string): boolean {
  return (PLACEMENT_STAGES as ReadonlyArray<string>).includes(s);
}

function formatDateLabel(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toISOString().slice(0, 10);
}

function formatMoneyLabel(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${n.toLocaleString("en-US")}`;
}

// Parse a user-supplied date input. Accepts YYYY-MM-DD (treated as UTC
// midnight) or any full ISO timestamp. Returns null on garbage.
function parseIsoDate(raw: string): Date | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Bare date → anchor to UTC midnight so the same day boundary holds
  // regardless of server tz.
  const bare = /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T00:00:00.000Z` : trimmed;
  const d = new Date(bare);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

async function describeAction(
  name: string,
  rawInput: unknown,
  orgId: string,
): Promise<ActionResolution> {
  const input = (rawInput && typeof rawInput === "object" ? rawInput : {}) as Record<
    string,
    unknown
  >;
  try {
    if (name === "move_candidate_stage") {
      const candidateRef = typeof input.candidateId === "string" ? input.candidateId : "";
      const placementId = typeof input.placementId === "string" ? input.placementId : "";
      const newStage = typeof input.newStage === "string" ? input.newStage : "";
      const candidate = await resolveCandidate(candidateRef, orgId);
      const candidateName = candidate
        ? joinName(candidate.firstName, candidate.lastName)
        : "(unknown candidate)";

      // Prefer the placement Claude pointed us at, but fall back to
      // the candidate's most recent active placement when Claude
      // skipped placementId or named one in a different tenant.
      let placement: { id: string; stage: string; job: { title: string } | null } | null = null;
      if (placementId) {
        placement = await prisma.placement.findFirst({
          where: { id: placementId, organizationId: orgId },
          select: { id: true, stage: true, job: { select: { title: true } } },
        });
      }
      if (!placement && candidate?.id) {
        placement = await pickActivePlacement(candidate.id, orgId);
      }

      const fromStage = placement?.stage ?? "(no active placement)";
      const jobTitle = placement?.job?.title ?? "(unknown job)";
      const description = `Move ${candidateName} from ${fromStage} → ${newStage || "(unknown stage)"} on ${jobTitle}.`;

      return {
        kind: "move_candidate_stage",
        description,
        candidateName,
        fromStage,
        toStage: newStage,
        jobTitle,
        candidateId: candidate?.id ?? null,
        placementId: placement?.id ?? null,
      };
    }

    if (name === "add_note") {
      const entityTypeRaw = typeof input.entityType === "string" ? input.entityType : "";
      const entityType =
        entityTypeRaw === "candidate" || entityTypeRaw === "client" || entityTypeRaw === "job"
          ? entityTypeRaw
          : "candidate";
      const entityRef = typeof input.entityId === "string" ? input.entityId : "";
      const note = typeof input.note === "string" ? input.note : "";
      const preview = note.length > 80 ? note.slice(0, 77) + "…" : note;

      let entityName = "(unknown)";
      let resolvedId: string | null = null;
      if (entityType === "candidate") {
        const c = await resolveCandidate(entityRef, orgId);
        if (c) {
          entityName = joinName(c.firstName, c.lastName);
          resolvedId = c.id;
        }
      } else if (entityType === "client") {
        const cl = await resolveClient(entityRef, orgId);
        if (cl) {
          entityName = cl.name;
          resolvedId = cl.id;
        }
      } else {
        const j = await resolveJob(entityRef, orgId);
        if (j) {
          entityName = j.title;
          resolvedId = j.id;
        }
      }

      return {
        kind: "add_note",
        description: `Add note to ${entityType} ${entityName}: "${preview}"`,
        entityType,
        entityId: resolvedId,
        entityName,
        note,
      };
    }

    if (name === "draft_email") {
      const to = typeof input.to === "string" ? input.to : "";
      const subject = typeof input.subject === "string" ? input.subject : "";
      const body = typeof input.body === "string" ? input.body : "";
      return {
        kind: "draft_email",
        description: `Open mail composer to ${to || "(no recipient)"}, subject: "${subject || "(no subject)"}"`,
        to,
        subject,
        body,
      };
    }

    if (name === "inactivate_job" || name === "privatize_job" || name === "reactivate_job") {
      const jobRef = typeof input.jobId === "string" ? input.jobId : "";
      const job = await resolveJobWithClient(jobRef, orgId);
      const jobTitle = job?.title ?? "(unknown job)";
      const clientName = job?.client?.name ?? "(unknown client)";
      const currentLifecycle = job ? deriveLifecycle(job.lifecycle, job.isOpen) : null;
      const targetLifecycle: "active" | "private" | "inactive" =
        name === "inactivate_job"
          ? "inactive"
          : name === "privatize_job"
            ? "private"
            : "active";
      const noOp = currentLifecycle === targetLifecycle;
      const verb =
        name === "inactivate_job"
          ? "Inactivate"
          : name === "privatize_job"
            ? "Move to Private"
            : "Reactivate";
      const explainer =
        name === "inactivate_job"
          ? "mark inactive and remove from the active pipeline"
          : name === "privatize_job"
            ? "hide from the Active tab, still searchable from the Private tab"
            : "move back to the Active tab";
      return {
        kind: name,
        description: `${verb} ${jobTitle}: ${explainer}.`,
        jobId: job?.id ?? null,
        jobTitle,
        clientName,
        currentLifecycle,
        targetLifecycle,
        noOp,
      };
    }

    if (name === "delete_job") {
      const jobRef = typeof input.jobId === "string" ? input.jobId : "";
      const job = await resolveJobWithClient(jobRef, orgId);
      const jobTitle = job?.title ?? "(unknown job)";
      const clientName = job?.client?.name ?? "(unknown client)";
      return {
        kind: "delete_job",
        description: `Permanently delete ${jobTitle} at ${clientName}. This cannot be undone.`,
        jobId: job?.id ?? null,
        jobTitle,
        clientName,
      };
    }

    if (name === "delete_candidate") {
      const candidateRef =
        typeof input.candidateId === "string" ? input.candidateId : "";
      const candidate = await resolveCandidate(candidateRef, orgId);
      const candidateName = candidate
        ? joinName(candidate.firstName, candidate.lastName)
        : "(unknown candidate)";
      return {
        kind: "delete_candidate",
        description: `Permanently delete ${candidateName}. This cannot be undone.`,
        candidateId: candidate?.id ?? null,
        candidateName,
      };
    }

    if (
      name === "inactivate_jobs" ||
      name === "reactivate_jobs" ||
      name === "delete_jobs" ||
      name === "delete_candidates"
    ) {
      const isCandidate = name === "delete_candidates";
      const destructive =
        name === "delete_jobs" || name === "delete_candidates";
      const noun: "jobs" | "candidates" = isCandidate ? "candidates" : "jobs";
      const verb: "Inactivate" | "Reactivate" | "Delete" =
        name === "inactivate_jobs"
          ? "Inactivate"
          : name === "reactivate_jobs"
            ? "Reactivate"
            : "Delete";

      const rawIds = isCandidate ? input.candidateIds : input.jobIds;
      const ids = Array.isArray(rawIds)
        ? rawIds.filter(
            (x): x is string => typeof x === "string" && x.trim().length > 0,
          )
        : [];
      const requestedCount = ids.length;

      // Resolve every id to its real org-scoped display name. Tenant
      // scoping lives in the resolvers (Rule 8): a cross-tenant or
      // unknown id resolves to null and is silently DROPPED here — never
      // acted on cross-tenant — and surfaces as an unresolvedCount the
      // executor will report as a per-item failure in a later prompt.
      // De-dupe by resolved cuid so a doubled id can't double-act.
      const items: Array<{ id: string; label: string }> = [];
      const seen = new Set<string>();
      for (const ref of ids) {
        if (isCandidate) {
          const c = await resolveCandidate(ref, orgId);
          if (!c || seen.has(c.id)) continue;
          seen.add(c.id);
          items.push({ id: c.id, label: joinName(c.firstName, c.lastName) });
        } else {
          const j = await resolveJobWithClient(ref, orgId);
          if (!j || seen.has(j.id)) continue;
          seen.add(j.id);
          const clientName = j.client?.name ?? "(unknown client)";
          items.push({ id: j.id, label: `${j.title} at ${clientName}` });
        }
      }

      const count = items.length;
      const unresolvedCount = requestedCount - count;
      const singular = noun.slice(0, -1); // "jobs" → "job", "candidates" → "candidate"
      const nounLabel = count === 1 ? singular : noun;
      const cascadeNote = destructive
        ? isCandidate
          ? "Cascades through Placement / Interview / CandidateResume / CandidateListMembership / CallLog / SmsMessage / GmailThreadTag rows for each candidate."
          : "Cascades through Placement / Interview / CandidateMatch rows for each job."
        : null;
      const description = destructive
        ? `Permanently delete ${count} ${nounLabel}. This cannot be undone.`
        : `${verb} ${count} ${nounLabel}.`;

      return {
        kind: "bulk_action",
        description,
        action: name,
        verb,
        noun,
        destructive,
        count,
        requestedCount,
        unresolvedCount,
        cascadeNote,
        items,
      };
    }

    if (name === "reset_activity_log") {
      const dateFromIn = typeof input.dateFrom === "string" ? input.dateFrom : "";
      const dateToIn = typeof input.dateTo === "string" ? input.dateTo : "";
      const dateFrom = dateFromIn ? parseIsoDate(dateFromIn) : null;
      const dateTo = dateToIn ? parseIsoDate(dateToIn) : null;
      const where: Prisma.ActionLogWhereInput = { organizationId: orgId };
      if (dateFrom || dateTo) {
        where.createdAt = {};
        if (dateFrom) where.createdAt.gte = dateFrom;
        if (dateTo) where.createdAt.lt = dateTo;
      }
      const count = await prisma.actionLog.count({ where });
      const fromLabel = dateFrom ? formatDateLabel(dateFrom) : "(beginning)";
      const toLabel = dateTo ? formatDateLabel(dateTo) : "(now)";
      return {
        kind: "reset_activity_log",
        description: `Delete ${count} activity log ${
          count === 1 ? "entry" : "entries"
        } from ${fromLabel} to ${toLabel}.`,
        count,
        dateFromIso: dateFrom?.toISOString() ?? null,
        dateToIso: dateTo?.toISOString() ?? null,
        dateFromLabel: fromLabel,
        dateToLabel: toLabel,
      };
    }

    if (name === "reset_placements") {
      const dateFromIn = typeof input.dateFrom === "string" ? input.dateFrom : "";
      const dateToIn = typeof input.dateTo === "string" ? input.dateTo : "";
      const stageIn = typeof input.stage === "string" ? input.stage.trim() : "";
      const dateFrom = dateFromIn ? parseIsoDate(dateFromIn) : null;
      const dateTo = dateToIn ? parseIsoDate(dateToIn) : null;
      const stage = stageIn && isAllowedStageValue(stageIn) ? stageIn : null;

      const where: Prisma.PlacementWhereInput = { organizationId: orgId };
      if (dateFrom || dateTo) {
        where.placedAt = {};
        if (dateFrom) where.placedAt.gte = dateFrom;
        if (dateTo) where.placedAt.lt = dateTo;
      }
      if (stage) where.stage = stage;

      // Cap the preview list — the card has to stay readable even when
      // the filter matches hundreds of rows. count() is still the true
      // total so the recruiter sees "Delete 142 placements" with the
      // first 10 listed below.
      const PREVIEW_CAP = 10;
      const [allMatching, totalCount] = await Promise.all([
        prisma.placement.findMany({
          where,
          select: {
            id: true,
            stage: true,
            placedAt: true,
            candidate: { select: { firstName: true, lastName: true } },
            job: { select: { title: true } },
          },
          orderBy: [{ placedAt: "desc" }, { updatedAt: "desc" }],
        }),
        prisma.placement.count({ where }),
      ]);

      const previewRows = allMatching.slice(0, PREVIEW_CAP).map((p) => ({
        id: p.id,
        candidateName: p.candidate
          ? joinName(p.candidate.firstName, p.candidate.lastName)
          : "(unnamed candidate)",
        jobTitle: p.job?.title ?? "(no job)",
        stage: p.stage,
        placedAtLabel: p.placedAt ? formatDateLabel(p.placedAt) : "—",
      }));

      const fromLabel = dateFrom ? formatDateLabel(dateFrom) : null;
      const toLabel = dateTo ? formatDateLabel(dateTo) : null;
      const filterBits = [
        fromLabel || toLabel
          ? `placedAt ${fromLabel ?? "(beginning)"} → ${toLabel ?? "(now)"}`
          : null,
        stage ? `stage=${stage}` : null,
      ].filter(Boolean);
      const filterTail = filterBits.length > 0 ? ` (${filterBits.join(", ")})` : "";

      return {
        kind: "reset_placements",
        description: `Delete ${totalCount} placement${totalCount === 1 ? "" : "s"}${filterTail}. Dependent Interview rows for the same candidate / job pairs are removed too.`,
        count: totalCount,
        placementIds: allMatching.map((p) => p.id),
        previewRows,
        dateFromIso: dateFrom?.toISOString() ?? null,
        dateToIso: dateTo?.toISOString() ?? null,
        stage,
      };
    }

    if (name === "update_placement_field") {
      const placementId = typeof input.placementId === "string" ? input.placementId : "";
      const fieldNameRaw = typeof input.fieldName === "string" ? input.fieldName : "";
      const newValueRawIn =
        typeof input.newValue === "string"
          ? input.newValue
          : typeof input.newValue === "number"
            ? String(input.newValue)
            : "";

      const placement = placementId
        ? await prisma.placement.findFirst({
            where: { id: placementId, organizationId: orgId },
            select: {
              id: true,
              stage: true,
              placedAt: true,
              startConfirmedAt: true,
              offerReceivedAt: true,
              feeTotal: true,
              candidate: { select: { firstName: true, lastName: true } },
              job: { select: { title: true } },
            },
          })
        : null;
      const candidateName = placement?.candidate
        ? joinName(placement.candidate.firstName, placement.candidate.lastName)
        : "(unknown candidate)";
      const jobTitle = placement?.job?.title ?? "(unknown job)";

      // Field whitelist check first so a bogus fieldName surfaces in
      // the card preview instead of silently being treated as "unknown".
      if (!isEditablePlacementField(fieldNameRaw)) {
        return {
          kind: "update_placement_field",
          description: `update_placement_field: invalid fieldName "${fieldNameRaw}".`,
          placementId: placement?.id ?? null,
          candidateName,
          jobTitle,
          fieldName: "stage",
          oldValueLabel: "(n/a)",
          newValueLabel: "(n/a)",
          newValueRaw: null,
          validationError: `fieldName must be one of: ${PLACEMENT_EDITABLE_FIELDS.join(", ")}.`,
        };
      }
      const fieldName: PlacementEditableField = fieldNameRaw;

      let oldValueLabel = "—";
      let newValueLabel = newValueRawIn;
      let newValueRaw: string | number | null = newValueRawIn;
      let validationError: string | null = null;

      if (!placement) {
        validationError = "Placement not found in this org.";
      } else if (fieldName === "stage") {
        oldValueLabel = placement.stage;
        const stageStr = newValueRawIn.trim();
        if (!isAllowedStageValue(stageStr)) {
          validationError = `Stage must be one of: ${PLACEMENT_STAGES.join(", ")}.`;
        } else {
          newValueRaw = stageStr;
          newValueLabel = stageStr;
        }
      } else if (fieldName === "feeAmount") {
        oldValueLabel = formatMoneyLabel(placement.feeTotal);
        const parsed = Number(newValueRawIn);
        if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
          validationError = "feeAmount must be a non-negative whole-dollar integer.";
        } else {
          newValueRaw = parsed;
          newValueLabel = formatMoneyLabel(parsed);
        }
      } else {
        // Date fields: placedAt | startConfirmedAt | offerReceivedAt.
        const currentVal =
          fieldName === "placedAt"
            ? placement.placedAt
            : fieldName === "startConfirmedAt"
              ? placement.startConfirmedAt
              : placement.offerReceivedAt;
        oldValueLabel = formatDateLabel(currentVal);
        const parsed = parseIsoDate(newValueRawIn);
        if (!parsed) {
          validationError = "Date must be ISO 8601 (e.g. 2026-05-11).";
        } else {
          newValueRaw = parsed.toISOString();
          newValueLabel = formatDateLabel(parsed);
        }
      }

      const description = validationError
        ? `Cannot update ${fieldName} on ${candidateName} · ${jobTitle}: ${validationError}`
        : `Update ${fieldName} on ${candidateName} · ${jobTitle}: ${oldValueLabel} → ${newValueLabel}.`;

      return {
        kind: "update_placement_field",
        description,
        placementId: placement?.id ?? null,
        candidateName,
        jobTitle,
        fieldName,
        oldValueLabel,
        newValueLabel,
        newValueRaw,
        validationError,
      };
    }
  } catch {
    // fall through
  }
  return {
    kind: "unknown",
    description: `Confirm action: ${name}`,
  };
}

async function executeTool(
  name: string,
  rawInput: unknown,
  orgId: string,
): Promise<string> {
  const input = (rawInput && typeof rawInput === "object" ? rawInput : {}) as Record<
    string,
    unknown
  >;
  try {
    if (name === "search_candidates") {
      const query = typeof input.query === "string" ? input.query : "";
      const sortBy: "relevance" | "createdAt" =
        input.sortBy === "createdAt" ? "createdAt" : "relevance";
      const order: "asc" | "desc" = input.order === "asc" ? "asc" : "desc";
      const rawLimit =
        typeof input.limit === "number" && Number.isFinite(input.limit)
          ? Math.floor(input.limit)
          : 25;
      const limit = Math.min(100, Math.max(1, rawLimit));
      return await runSearchCandidates(
        { query, sortBy, order, limit },
        orgId,
      );
    }
    if (name === "search_jobs") {
      const query = typeof input.query === "string" ? input.query : "";
      return await runSearchJobs(query, orgId);
    }
    if (name === "search_clients") {
      const query = typeof input.query === "string" ? input.query : "";
      return await runSearchClients(query, orgId);
    }
    if (name === "get_pipeline") {
      const clientName = typeof input.clientName === "string" ? input.clientName : undefined;
      const stage = typeof input.stage === "string" ? input.stage : undefined;
      const historical = input.historical === true;
      return await runGetPipeline({ clientName, stage, historical }, orgId);
    }
    return "No results found";
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[claude-panel.tool] error", name, err);
    return "No results found";
  }
}

// create_reminder execution. Unlike the action tools, this writes
// directly (no Confirm card) — reminders are reversible and Andrew asked
// for batch creation with a single summary receipt, not a per-item gate.
// We validate the timestamp carries an explicit offset BEFORE writing so
// a naive datetime is reported as a failure rather than landing 4-5 hours
// skewed. createReminder() resolves org + user from the server session
// itself (Rule 8 — no client-supplied tenant id passes through here).
async function runCreateReminder(
  rawInput: unknown,
): Promise<{ ok: true; title: string } | { ok: false; title: string; reason: string }> {
  const parsed = parseReminderToolInput(rawInput);
  if (!parsed.ok) {
    log("create_reminder", { title: parsed.title }, 0, `rejected: ${parsed.reason}`);
    return parsed;
  }
  try {
    await createReminder(parsed.title, parsed.reminderAtIso, parsed.notifyLeadsMin);
    log("create_reminder", { title: parsed.title, reminderAtIso: parsed.reminderAtIso }, 1);
    return { ok: true, title: parsed.title };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "create failed";
    log("create_reminder", { title: parsed.title }, 0, `error: ${reason}`);
    return { ok: false, title: parsed.title, reason };
  }
}

// Today's date + the CURRENT wall-clock time in Eastern, plus the live
// Eastern UTC offset, all injected into the system prompt. ET (not UTC)
// so "remind me tomorrow" resolves against the recruiter's actual day
// even late at night; the live offset (DST-correct via Intl) so the
// model emits -04:00 in summer and -05:00 in winter.
//
// `nowIso` is the keystone: WITHOUT a current time in the prompt the
// model has no anchor for relative phrases like "in 20 minutes" / "in 2
// hours" and silently GUESSES a base time — the live 2-hour skew we saw
// (a wrong wall-clock base, not a timezone conversion error). Handing it
// the real Eastern now closes that gap.
//
// `longOffset` yields e.g. "GMT-04:00"; we normalize to "-04:00".
// `sv-SE` reliably yields 24-hour "YYYY-MM-DD HH:MM:SS". Vercel ships
// full ICU; if it ever isn't, we fall back to a safe EST default.
function easternDateAndOffset(now: Date): {
  today: string;
  offset: string;
  nowIso: string;
} {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const rawOffset =
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      timeZoneName: "longOffset",
    })
      .formatToParts(now)
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT-05:00";
  const offset = rawOffset.replace(/^GMT/, "").trim() || "-05:00";
  const wall = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now); // "2026-06-02 17:57:00"
  const nowIso = `${wall.replace(" ", "T")}${offset}`;
  return { today, offset, nowIso };
}

export async function POST(req: NextRequest) {
  // Auth gate — Claude Panel is org-scoped and there's no anonymous
  // path. getCurrentOrg() can fall back to DEFAULT_ORG_ID env, but
  // for this surface we want a hard 401 when there's no signed-in
  // recruiter so a leaked URL can't burn tokens.
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json(
      { ok: false, error: "Sign in required" },
      { status: 401 },
    );
  }

  let body: {
    messages?: unknown;
    entityType?: unknown;
    entityId?: unknown;
    attachments?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (!Array.isArray(body.messages)) {
    return NextResponse.json(
      { ok: false, error: "messages must be an array" },
      { status: 400 },
    );
  }

  // Phase 3 page-aware context. The panel reports the active record
  // (candidate / client / job) it's looking at and we prepend the
  // relevant build*Context block to the system prompt so Claude can
  // answer "summarize this candidate" without the recruiter pasting
  // anything. Unknown types fall through to the unscoped prompt.
  const entityType =
    body.entityType === "candidate" ||
    body.entityType === "client" ||
    body.entityType === "job"
      ? body.entityType
      : null;
  const entityId =
    typeof body.entityId === "string" && body.entityId.trim().length > 0
      ? body.entityId.trim()
      : null;

  // Sanitize + collapse same-role runs. Anthropic rejects consecutive
  // user/user or assistant/assistant turns; same defense ai-workspace
  // applies before posting history. Drops any row missing a valid role
  // or content rather than failing the whole request.
  const cleaned: Anthropic.MessageParam[] = [];
  for (const raw of body.messages as IncomingMessage[]) {
    const role = raw?.role === "user" || raw?.role === "assistant" ? raw.role : null;
    const content =
      typeof raw?.content === "string" ? raw.content.trim() : "";
    if (!role || !content) continue;
    const last = cleaned[cleaned.length - 1];
    if (last && last.role === role && typeof last.content === "string") {
      last.content = content;
    } else {
      cleaned.push({ role, content });
    }
  }

  if (cleaned.length === 0 || cleaned[cleaned.length - 1].role !== "user") {
    return NextResponse.json(
      { ok: false, error: "history must end with a user message" },
      { status: 400 },
    );
  }

  // Composer attachments — only ever applied to the last user message.
  // Prior turns stay as plain strings (history doesn't re-upload images
  // on every turn; matches Claude.ai / ChatGPT behavior). Anthropic
  // expects images BEFORE text in a multi-block content array, so we
  // splice image/document blocks first and let the user's typed text
  // come last.
  const rawAttachments = Array.isArray(body.attachments) ? body.attachments : [];
  if (rawAttachments.length > 0) {
    const last = cleaned[cleaned.length - 1];
    const userText = typeof last.content === "string" ? last.content : "";
    const blocks: Anthropic.ContentBlockParam[] = [];
    for (const raw of rawAttachments) {
      if (!raw || typeof raw !== "object") continue;
      const a = raw as {
        kind?: unknown;
        name?: unknown;
        mediaType?: unknown;
        data?: unknown;
      };
      const kind = a.kind;
      const name = typeof a.name === "string" ? a.name : "attachment";
      const mediaType = typeof a.mediaType === "string" ? a.mediaType : "";
      const data = typeof a.data === "string" ? a.data : "";
      if (!data) continue;
      if (
        kind === "image" &&
        (mediaType === "image/png" ||
          mediaType === "image/jpeg" ||
          mediaType === "image/gif" ||
          mediaType === "image/webp")
      ) {
        blocks.push({
          type: "image",
          source: { type: "base64", media_type: mediaType, data },
        });
      } else if (kind === "pdf") {
        blocks.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data },
          // Filename gives the model a stable label to cite. Without
          // it the model often refers to attachments as "the document"
          // which reads worse when the user attached several.
          title: name,
        });
      } else if (kind === "text") {
        // Wrap text-file contents with explicit fences so the model
        // doesn't blur file content into the user's prompt — same
        // pattern as Claude.ai for txt/md drops.
        blocks.push({
          type: "text",
          text: `<file name="${name}">\n${data}\n</file>`,
        });
      }
    }
    if (blocks.length > 0) {
      blocks.push({ type: "text", text: userText });
      last.content = blocks;
    }
  }

  // Resolve org so we can append the org-scoped Personal Trainer
  // rules block to the system prompt. getCurrentOrg() throws if the
  // signed-in user has no membership AND no DEFAULT_ORG_ID — the right
  // failure: don't pretend to be tenant-scoped when we can't resolve
  // a tenant.
  const org = await getCurrentOrg();

  // Page-aware entity block. Built first so it sits at the top of
  // the system prompt and Claude reads the record before the global
  // rules. build*Context already includes its own header sentence
  // identifying the record, so we just bracket it with a "currently
  // viewing" framing line that tells Claude to answer about this
  // record without asking the recruiter to clarify.
  //
  // Pre-resolution note: live URLs may use the legacy numeric slug
  // (slugFor still emits legacyRfId when set) but the build*Context
  // builders are cuid-only. The per-entity getXByIdentifier helpers
  // accept either form, so we resolve here and hand the builders a
  // canonical cuid.
  let entityBlock = "";
  if (entityType && entityId) {
    try {
      let resolvedCuid: string | null = null;
      if (entityType === "candidate") {
        resolvedCuid = (await getCandidateByIdentifier(entityId))?.id ?? null;
      } else if (entityType === "client") {
        resolvedCuid = (await getClientByIdentifier(entityId))?.id ?? null;
      } else {
        resolvedCuid = (await getJobByIdentifier(entityId))?.id ?? null;
      }
      if (resolvedCuid) {
        const built =
          entityType === "candidate"
            ? await buildCandidateContext(resolvedCuid)
            : entityType === "client"
              ? await buildClientContext(resolvedCuid)
              : await buildJobContext(resolvedCuid);
        entityBlock =
          built +
          "\n\nThe recruiter is currently viewing this record. Answer questions about it directly without asking for clarification.\n\n";
      }
    } catch {
      // Don't fail the chat just because the page context lookup hit
      // a snag - fall back to the unscoped prompt and let Claude
      // answer generically.
      entityBlock = "";
    }
  }

  // Personal Trainer rules — Andrew-curated standing instructions
  // (no em dashes, no emojis, no signoff, voice rules, etc.) sourced
  // from Settings > Personal Trainer. Appended last so they sit
  // closest to the model's response and override any earlier prompt
  // that drifts. Same pattern as /api/ai-workspace/route.ts.
  const { today, offset: etOffset, nowIso: etNowIso } = easternDateAndOffset(new Date());
  const fullSystemPrompt =
    entityBlock +
    SYSTEM_PROMPT.replace(/\{\{TODAY\}\}/g, today)
      .replace(/\{\{ET_OFFSET\}\}/g, etOffset)
      .replace(/\{\{NOW_ET\}\}/g, etNowIso) +
    (await buildPersonalTrainerBlock(org.id));

  // Mixed tool list: the existing server-managed web_search plus the
  // four Phase 4 client-managed data tools. Claude picks per turn.
  const tools: Anthropic.ToolUnion[] = [
    { type: "web_search_20250305", name: "web_search" },
    ...DATA_TOOLS,
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      };

      // textBlockSeen is hoisted across rounds so the "\n\n" boundary
      // applies between a round-1 preface ("Looking that up...") and
      // the round-2 cited answer, not just within a single response.
      let textBlockSeen = false;
      const conversation: Anthropic.MessageParam[] = [...cleaned];

      // Phantom-claim guard state. assistantText accumulates every streamed
      // text delta across all rounds; reminderHandledThisRequest flips true
      // when a real create_reminder branch (direct-execute OR over-cap
      // confirm) fires. If the turn ends with the assistant CLAIMING a
      // reminder was saved but neither branch ran, we suppress the false
      // success with an honest receipt before send({ t: "end" }).
      let assistantText = "";
      let reminderHandledThisRequest = false;

      try {
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          const claudeStream = anthropic.messages.stream({
            model: CLAUDE_MODEL,
            max_tokens: 4096,
            // Server-side web_search returns a multi-block sequence
            // (text preface, server_tool_use, web_search_tool_result,
            // text answer). Streaming naturally emits text_deltas for
            // every text block in order; we insert "\n\n" between
            // consecutive text blocks so the assembled transcript
            // matches the .join('\n\n') shape ai-workspace produces
            // from the non-streaming path. Reading just content[0]
            // would drop the cited answer and keep only the preface.
            tools,
            system: fullSystemPrompt,
            messages: conversation,
          });

          for await (const event of claudeStream) {
            if (
              event.type === "content_block_start" &&
              event.content_block.type === "text"
            ) {
              if (textBlockSeen) {
                send({ t: "delta", text: "\n\n" });
              }
              textBlockSeen = true;
            } else if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              assistantText += event.delta.text;
              send({ t: "delta", text: event.delta.text });
            }
          }

          const finalMsg = await claudeStream.finalMessage();

          // Server tools (web_search) finish in-stream and stop_reason
          // settles to "end_turn" — only client tool calls leave us
          // with stop_reason === "tool_use" and force another round.
          if (finalMsg.stop_reason !== "tool_use") break;

          const toolUses = finalMsg.content.filter(
            (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use",
          );
          if (toolUses.length === 0) break;

          // create_reminder is a DIRECT action: execute server-side and
          // return a single summary receipt, no per-item Confirm card.
          // (Andrew's directive — reminders are reversible, so a batch of
          // them shouldn't gate behind N confirmations.) The only brake
          // is the runaway-paste cap: MORE than MAX_DIRECT_REMINDERS in
          // one turn falls back to a single batch Confirm card so a huge
          // accidental paste can't fire blind. Handled before the action
          // tools, mirroring the "first special category wins + break"
          // shape the action path already uses.
          const reminderUses = toolUses.filter((tu) => tu.name === "create_reminder");
          if (reminderUses.length > 0) {
            conversation.push({ role: "assistant", content: finalMsg.content });

            if (reminderUses.length > MAX_DIRECT_REMINDERS) {
              // Over the cap — do NOT auto-fire. Emit ONE batch Confirm
              // card carrying every reminder; the recruiter confirms and
              // /api/claude-panel/action creates them (re-validated there).
              const reminders = reminderUses.map((tu) => {
                const inp = (tu.input && typeof tu.input === "object"
                  ? tu.input
                  : {}) as Record<string, unknown>;
                return {
                  title: typeof inp.title === "string" ? inp.title : "",
                  reminderAtIso:
                    typeof inp.reminderAtIso === "string" ? inp.reminderAtIso : "",
                  notifyLeadsMin: Array.isArray(inp.notifyLeadsMin)
                    ? inp.notifyLeadsMin.filter(
                        (n): n is number => typeof n === "number",
                      )
                    : undefined,
                };
              });
              send({
                t: "action_pending",
                id: reminderUses[0].id,
                name: "create_reminders_batch",
                input: { count: reminders.length },
                resolved: {
                  kind: "create_reminders_batch",
                  description: `Create ${reminders.length} reminders?`,
                  count: reminders.length,
                  reminders,
                },
              });
              log(
                "action_pending",
                { name: "create_reminders_batch", count: reminders.length },
                0,
              );
              reminderHandledThisRequest = true;
              break;
            }

            // At or under the cap — fire them all, accumulate per-item
            // results, and send a single receipt. No tool_result is fed
            // back to Claude (the receipt is the turn's outcome), matching
            // the action path's "card speaks for itself" rule.
            const results = await Promise.all(
              reminderUses.map((tu) => runCreateReminder(tu.input)),
            );
            const created = results.filter((r) => r.ok).length;
            const failures = results
              .filter(
                (r): r is { ok: false; title: string; reason: string } => !r.ok,
              )
              .map((r) => ({ title: r.title, reason: r.reason }));
            send({
              t: "batch_receipt",
              kind: "reminder",
              created,
              failed: failures.length,
              failures,
            });
            log("create_reminder_batch", { requested: reminderUses.length }, created);
            reminderHandledThisRequest = true;
            break;
          }

          // Bulk action tools (inactivate_jobs / reactivate_jobs /
          // delete_jobs / delete_candidates) carry an ARRAY of ids and
          // collapse the whole set to ONE batched Confirm card per call —
          // mirroring the reminder over-cap batch-confirm branch above —
          // instead of N per-item cards. Routed BEFORE the singular action
          // branch so a bulk call wins-and-breaks; the singular filter
          // below never sees these names (they're not in
          // ACTION_TOOL_NAMES). Deletes stay gated behind this confirm
          // (destructive-confirm rule — the card just batches the set).
          // NOTHING executes here: we only emit the action_pending confirm
          // PAYLOAD (one per bulk call, normally one). The executor that
          // fires on Confirm is wired in a later prompt, so confirming the
          // card does not yet act — that is expected at this step.
          const bulkUses = toolUses.filter((tu) =>
            BULK_ACTION_TOOL_NAMES.has(tu.name),
          );
          if (bulkUses.length > 0) {
            conversation.push({ role: "assistant", content: finalMsg.content });
            for (const tu of bulkUses) {
              const resolved = await describeAction(tu.name, tu.input, org.id);
              send({
                t: "action_pending",
                id: tu.id,
                name: tu.name,
                input: tu.input,
                resolved,
              });
              log(
                "action_pending",
                {
                  name: tu.name,
                  count: resolved.kind === "bulk_action" ? resolved.count : 0,
                  unresolved:
                    resolved.kind === "bulk_action"
                      ? resolved.unresolvedCount
                      : 0,
                },
                0,
              );
            }
            break;
          }

          // Action tools end the turn — Claude is proposing a write the
          // recruiter must Confirm before it lands. We emit an
          // action_pending event per call (with a plain-English label
          // so the panel doesn't have to re-resolve names) and stop
          // the loop. Search tools called in the same turn are still
          // run, but we don't continue the conversation back to Claude
          // because the next assistant turn shouldn't speak until the
          // human has decided yes/no on the proposal.
          const actionUses = toolUses.filter((tu) => ACTION_TOOL_NAMES.has(tu.name));
          if (actionUses.length > 0) {
            conversation.push({ role: "assistant", content: finalMsg.content });
            for (const tu of actionUses) {
              const resolved = await describeAction(tu.name, tu.input, org.id);
              // We ship the original tool input AND the server-resolved
              // fields. The card renders from `resolved` so display
              // names are accurate; the action POST uses `resolved`'s
              // canonical cuids so the eventual Prisma write doesn't
              // re-do the rfId↔cuid dance from raw tool input.
              send({
                t: "action_pending",
                id: tu.id,
                name: tu.name,
                input: tu.input,
                resolved,
              });
              log(
                "action_pending",
                { name: tu.name, ...(tu.input as Record<string, unknown>) },
                0,
              );
            }
            break;
          }

          // Record the assistant's tool-call turn verbatim, then run
          // every tool in parallel and feed the results back as a
          // single user turn of tool_result blocks. Anthropic requires
          // the next user turn to carry one tool_result per tool_use
          // emitted in the prior assistant turn.
          conversation.push({ role: "assistant", content: finalMsg.content });
          const results = await Promise.all(
            toolUses.map(async (tu) => {
              const text = await executeTool(tu.name, tu.input, org.id);
              return {
                type: "tool_result" as const,
                tool_use_id: tu.id,
                content: text,
              };
            }),
          );
          conversation.push({ role: "user", content: results });
        }

        // Phantom-claim safety net. If the assistant TYPED a "saved that
        // reminder" success line but no create_reminder branch actually ran
        // this request, the streamed text is a false confirmation (the user
        // can't tell it from the real receipt). Append an honest failure
        // receipt — the existing amber "0 of 1 · failed" pill — so the
        // truthful signal lands under the fabricated sentence. The system
        // prompt forbids the claim outright; this catches the model when it
        // ignores that. Logged so we can measure how often it skips the tool.
        if (!reminderHandledThisRequest && claimsReminderSaved(assistantText)) {
          send({
            t: "batch_receipt",
            kind: "reminder",
            created: 0,
            failed: 1,
            failures: [
              {
                title: "reminder",
                reason:
                  "not saved - the assistant did not run the save. Please send it again.",
              },
            ],
          });
          log("create_reminder_phantom_claim", { textLen: assistantText.length }, 0);
        }

        send({ t: "end" });
      } catch (e) {
        send({
          t: "error",
          error: e instanceof Error ? e.message : "Stream failed",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
