import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import Anthropic from "@anthropic-ai/sdk";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { CLAUDE_MODEL } from "@/lib/claude";
import { buildPersonalTrainerBlock } from "@/lib/personal-trainer";
import {
  buildCandidateContext,
  buildClientContext,
  buildJobContext,
} from "@/lib/ai-workspace-context";
import { getClientByIdentifier } from "@/lib/clients";
import { getCandidateByIdentifier } from "@/lib/candidates";
import { getJobByIdentifier } from "@/lib/jobs";
import { claimsReminderSaved } from "@/lib/claude-panel/reminders";
import { MARKDOWN_OUTPUT_FORMAT_RULES } from "@/lib/ai-output-formatting";
import {
  ACTION_TOOL_NAMES,
  BULK_ACTION_TOOL_NAMES,
  DATA_TOOLS,
  MAX_DIRECT_CONTACTS,
  MAX_DIRECT_REMINDERS,
  MAX_TOOL_ROUNDS,
  describeAction,
  easternDateAndOffset,
  executeTool,
  log,
  runCreateContact,
  runCreateReminder,
  type IncomingMessage,
} from "@/lib/claude-panel/tools";

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
  "You are Wilson, an AI recruiting assistant inside BreakPoint Talent's CRM. " +
  "You help Andrew Kraig with recruiting tasks: candidate evaluation, submittals, BD messages, " +
  "interview prep, market research, and anything else recruiting-related. " +
  "Rules: be concise and direct, no filler, no hedging, no fake enthusiasm. " +
  "Use **bold** section headers when giving structured output. " +
  "Use plain hyphen bullets for list-like content. Do not collapse list items into paragraphs. " +
  "Write like a sharp recruiter, not an AI. " +
  "Never end a response with a signoff or signature. " +
  "For any external facts, job market data, salaries, companies, people, or URLs - verify with web_search during this turn. Never hedge with 'data may be outdated.' If you cannot verify something, omit it. " +
  MARKDOWN_OUTPUT_FORMAT_RULES +
  "\n" +
  "Tool routing for CRM data - call these tools, never invent records:\n" +
  "- 'who is interviewing at <client>' or 'upcoming interviews for <client>' → get_pipeline({ clientName: '<client>', stage: 'interviewing' }).\n" +
  "- 'who has interviewed at <client>' / 'history with <client>' / 'past placements at <client>' / any past-tense or all-time pipeline question → get_pipeline({ clientName: '<client>', historical: true }).\n" +
  "- 'who is in offer / pending start / hired (at <client>)' → get_pipeline with the matching stage and optional clientName.\n" +
  "- General pipeline questions without a stage → get_pipeline({ clientName? }).\n" +
  "- 'what jobs are open' / 'show open roles' / 'active jobs' → search_jobs with the literal phrase as the query (the tool detects this intent and lists every open job).\n" +
  "- Specific candidate / role / client lookups (skills, titles, locations, industries) → search_candidates / search_jobs / search_clients with the user's natural phrasing.\n" +
  "- ANY money question - 'what is my revenue', 'how much have I billed', 'what did we collect', 'what are my numbers', 'revenue this quarter', 'how much did I earn last month', 'how big was that deal', or a request to put revenue numbers into an email → get_revenue. Map the recruiter's period onto grain + offset: 'this month' = month/0, 'last month' = month/-1, 'this quarter' = quarter/0, 'last quarter' = quarter/-1, 'this year' / 'YTD' = year/0. Add includeDeals: true whenever they want the deals or invoices themselves rather than a single total.\n" +
  "- You DO have the revenue and billing numbers. Never say you lack access to revenue, billing, fees or Clubhouse, and never ask the recruiter to paste their own numbers - Clubhouse, Goals, Placements and Invoices are all screens inside Ace, and get_revenue reads the same goals engine those screens read. Placements DO carry fee amounts. Call get_revenue first; only report a shortfall if the tool itself comes back empty.\n" +
  "- Quote the tier the recruiter asked for and say which one it is. EARNED is fees on deals placed in the period and is what the desk is paced against; BILLED is invoices sent; COLLECTED is invoices paid. They are three different numbers and are not interchangeable - if the recruiter just says 'revenue' with no qualifier, lead with earned and name it.\n" +
  "- Questions about what was said on a call, call transcripts, AI call summaries, candidate motivation, compensation expectations from a call, or call next steps → first resolve the candidate with search_candidates if needed, then call get_candidate_call_context with the candidate id from the result.\n" +
  "- 'Recently added candidates' / 'candidates I just imported' / 'newest candidates' → call search_candidates with sortBy='createdAt' (and an empty query string when no keyword filter applies). Use limit to honor counts the recruiter mentions ('the 25 candidates I just imported' → limit 25).\n" +
  "Pass the user's wording through; the tools handle stop-word stripping, plural collapsing, and ranking on their side.\n" +
  "Tool results may include markdown links like [Name](/candidates/abc) and [Title](/jobs/xyz). Quote those links as-is in your answer so the recruiter can click straight to the record. Never strip the link, never paraphrase the URL.\n" +
  "Action tools (move_candidate_stage / add_note / draft_email / inactivate_job / privatize_job / reactivate_job / delete_job / delete_candidate / reset_activity_log / reset_placements / update_placement_field) are PROPOSALS, not executions. Calling one stops your turn and the recruiter gets a Confirm/Cancel card. Never call an action tool with invented ids; resolve real candidates / placements / clients / jobs via the search tools first. Job lifecycle routing: 'close out' / 'mark inactive' → inactivate_job; 'make private' / 'hide from active' → privatize_job; 'reopen' / 'reactivate' → reactivate_job. delete_job and delete_candidate are destructive and cascade. Only use them when the recruiter explicitly says 'delete' or 'permanently remove' the named record. " +
  "Data-reset tools (reset_activity_log / reset_placements / update_placement_field) are destructive and require explicit recruiter intent. reset_activity_log wipes ActionLog rows in a date range (omit dateFrom/dateTo to wipe everything). reset_placements deletes Placements matching dateFrom/dateTo/stage filters and cascades to dependent Interview rows. update_placement_field edits exactly one field on one placement; the only editable fields are placedAt, startConfirmedAt, stage, feeAmount, offerReceivedAt. Resolve the placementId via search_candidates → get_pipeline first; never invent it. Use ISO 8601 (YYYY-MM-DD or full ISO timestamp) for any date value. The current Eastern Time is {{NOW_ET}} (today's date is {{TODAY}}). Use the current time to resolve relative phrases like 'this week' / 'last month' / 'this afternoon' into ISO dates. " +
  "Creating reminders - create_reminder is a DIRECT action, NOT a Confirm-card proposal: calling it writes an Ace reminder immediately and the recruiter gets a single summary receipt. Use it for 'remind me…' / 'add a reminder…' requests and for a pasted list of timed items - emit ONE create_reminder call PER reminder in the same turn (six reminders = six calls). The CURRENT Eastern time is {{NOW_ET}} - resolve EVERY relative phrase against it: 'in 20 minutes' = {{NOW_ET}} + 20 min, 'in 2 hours' = {{NOW_ET}} + 2h, 'tonight' / 'tomorrow at 3pm' relative to that same clock. Do NOT guess the current time. reminderAtIso MUST carry an explicit Eastern Time offset: the current Eastern offset is {{ET_OFFSET}} (use -04:00 during EDT / -05:00 during EST to match the reminder's date). Example: at 2026-06-10T15:00:00-04:00, 'in 20 minutes' is 2026-06-10T15:20:00-04:00. A reminderAtIso WITHOUT an explicit offset is rejected, not created - never emit a bare/naive datetime. CRITICAL - NEVER claim a reminder was saved in your own text. Do NOT write any sentence like 'Added 1 reminder', 'Reminder set', 'I've added/created/scheduled that reminder', or 'Done' for a reminder. The ONLY valid confirmation a reminder was saved is the tool-execution receipt, which the app renders automatically when create_reminder actually runs. Writing a success sentence yourself is a LIE if the tool did not run - the user cannot tell your text apart from the real receipt. So: to save a reminder you MUST call create_reminder, and then write NOTHING. If you cannot call create_reminder for any reason (missing time, unclear request, etc.), say plainly that nothing was saved and ask the recruiter to retry - never imply it was saved. " +
  "Adding contacts - create_contact is a DIRECT action like create_reminder, NOT a Confirm-card proposal: it adds a person to a client and the recruiter gets a single receipt. Use it for 'add a contact…' / 'add <name> at <client>' / 'new contact for <client>'. Provide the client by name (exact or a clear prefix) or id and the contact's first name; lastName / email / phone / title are optional. Emit ONE create_contact call PER contact. Do NOT pre-resolve the client yourself with search_clients - the tool resolves it server-side and will ask the recruiter to clarify if the name is ambiguous or unknown, so just pass the name the recruiter used. NEVER claim a contact was added in your own text (no 'Added John', 'Done', 'Contact created') - the tool receipt is the only valid confirmation; if you cannot call create_contact, say plainly nothing was added. After calling create_contact, write NOTHING. " +
  "After calling an action tool do not write any more text. The card speaks for itself. " +
  "BULK actions - when the recruiter wants the SAME action on MORE THAN ONE record at once ('make all active jobs inactive', 'reactivate every private job', 'delete these 5 candidates'), use the BULK tools, NOT N single-id calls. The bulk tools are inactivate_jobs { jobIds: [...] }, reactivate_jobs { jobIds: [...] }, delete_jobs { jobIds: [...] }, and delete_candidates { candidateIds: [...] }. The flow is always: FIRST enumerate the real target ids via a read tool (search_jobs / get_pipeline / search_candidates) - never invent ids - THEN emit ONE bulk call carrying EVERY id in the array (eleven jobs = one inactivate_jobs call with eleven ids, NOT eleven inactivate_job calls). One bulk call produces ONE Confirm card listing all the records. Use the single-id tools (inactivate_job / reactivate_job / delete_job / delete_candidate) only for a genuine one-off - a single named record. delete_jobs and delete_candidates are destructive and cascade; they still require Confirm, just one batched card for the whole set. If a read tool reports more total matches than it returned in one batch, page for the rest before the bulk call so the id set is complete.";

// Custom data tools — exposed to Claude so it can pull live records
// from Neon. Schemas mirror the parameters Andrew is most likely to ask
// in natural language ("who's interviewing at Sheehan", "find tax
// managers in Ohio"). Every tool is org-scoped at execution time.
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
            max_tokens: 8192,
            thinking: { type: "between_tools" },
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
          if (finalMsg.stop_reason === "max_tokens") {
            // Say so in the stream rather than ending on a half sentence.
            send({ t: "delta", text: "\n\n(Claude ran out of room here. Ask it to continue.)" });
          }

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

          // create_contact — direct-execute reversible create, same carve-out
          // as reminders. Resolve client + tenant server-side, dedupe, add via
          // the shared createContact, and return ONE contact receipt. Over the
          // cap we do NOT fire: a single non-executing receipt asks the
          // recruiter to split, so a runaway paste can't add an unbounded set.
          const contactUses = toolUses.filter((tu) => tu.name === "create_contact");
          if (contactUses.length > 0) {
            conversation.push({ role: "assistant", content: finalMsg.content });

            if (contactUses.length > MAX_DIRECT_CONTACTS) {
              send({
                t: "batch_receipt",
                kind: "contact",
                created: 0,
                failed: contactUses.length,
                lines: [
                  `That's ${contactUses.length} contacts in one turn - over the ${MAX_DIRECT_CONTACTS}-at-once limit. Nothing was added; re-send them in batches of ${MAX_DIRECT_CONTACTS} or fewer.`,
                ],
                failures: [],
              });
              log("create_contact_over_cap", { requested: contactUses.length }, 0);
              break;
            }

            const results = await Promise.all(
              contactUses.map((tu) =>
                runCreateContact(tu.input, org.id, session.user.id),
              ),
            );
            const created = results.filter((r) => r.ok).length;
            const failed = results.length - created;
            send({
              t: "batch_receipt",
              kind: "contact",
              created,
              failed,
              lines: results.map((r) => r.line),
              failures: [],
            });
            log("create_contact_batch", { requested: contactUses.length }, created);
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
              const text = await executeTool(tu.name, tu.input, org.id, session.user.email);
              return {
                type: "tool_result" as const,
                tool_use_id: tu.id,
                content: text,
              };
            }),
          );
          conversation.push({ role: "user", content: results });
        }

        // Phantom-claim recovery. The model sometimes TYPES a "saved that
        // reminder" success line WITHOUT calling create_reminder, so the
        // streamed text is a false confirmation (the recruiter can't tell
        // it from the real receipt) and nothing saves. Rather than just
        // warn, we RECOVER: re-run the turn ONCE with an explicit "call
        // create_reminder now" instruction so the model actually emits
        // the call, then execute it and send the real receipt. Sonnet 5.5
        // rejects forced tool_choice ({type:"tool"} / {type:"any"}) with a
        // 400, so this retry uses tool_choice auto + the instruction, and
        // the tool is declared strict so the input stays schema-valid. The
        // claim itself is proof the model understood this as a reminder
        // request. Only the honest failure receipt is shown if the retry
        // ALSO produces nothing.
        if (!reminderHandledThisRequest && claimsReminderSaved(assistantText)) {
          log("create_reminder_phantom_claim", { textLen: assistantText.length }, 0);
          let recovered = 0;
          const recoverFailures: { title: string; reason: string }[] = [];
          try {
            const forced = await anthropic.messages.create({
              model: CLAUDE_MODEL,
              max_tokens: 2048,
              thinking: { type: "between_tools" },
              tools,
              tool_choice: { type: "auto" },
              system:
                fullSystemPrompt +
                "\n\n# RETRY INSTRUCTION\n" +
                "Your previous reply to this request claimed a reminder was saved, but create_reminder was never called, so nothing was saved. " +
                "Call the create_reminder tool NOW, once per reminder in the request, with the exact title and reminderAtIso each needs. " +
                "Emit ONLY tool calls in this turn - no prose, no confirmation sentence.",
              messages: conversation,
            });
            const forcedUses = forced.content.filter(
              (b): b is Extract<typeof b, { type: "tool_use" }> =>
                b.type === "tool_use" && b.name === "create_reminder",
            );
            // Honor the same runaway-paste cap as the direct path; a forced
            // retry should never fan out beyond it.
            const capped = forcedUses.slice(0, MAX_DIRECT_REMINDERS);
            const forcedResults = await Promise.all(
              capped.map((tu) => runCreateReminder(tu.input)),
            );
            recovered = forcedResults.filter((r) => r.ok).length;
            for (const r of forcedResults) {
              if (!r.ok) recoverFailures.push({ title: r.title, reason: r.reason });
            }
            log("create_reminder_forced_retry", { requested: capped.length }, recovered);
          } catch (e) {
            log(
              "create_reminder_forced_retry",
              { error: e instanceof Error ? e.message : "retry failed" },
              0,
            );
          }
          if (recovered > 0) {
            // The forced retry actually saved it — show the real receipt.
            send({
              t: "batch_receipt",
              kind: "reminder",
              created: recovered,
              failed: recoverFailures.length,
              failures: recoverFailures,
            });
          } else {
            // Recovery produced nothing — fall back to the honest failure
            // receipt so the recruiter knows to resend, never a silent lie.
            send({
              t: "batch_receipt",
              kind: "reminder",
              created: 0,
              failed: 1,
              failures: [
                {
                  title: "reminder",
                  reason:
                    recoverFailures[0]?.reason ??
                    "not saved - the assistant did not run the save. Please send it again.",
                },
              ],
            });
          }
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
