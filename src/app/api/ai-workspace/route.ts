import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import Anthropic from '@anthropic-ai/sdk'
import { buildClientContext, buildCandidateContext, buildJobContext } from '@/lib/ai-workspace-context'
import { CLAUDE_MODEL } from '@/lib/claude'
import { extractUrls, verifyUrls } from '@/lib/url-verifier'

const anthropic = new Anthropic()

export async function GET(req: NextRequest) {
  const entityType = req.nextUrl.searchParams.get('entityType')
  const entityId = req.nextUrl.searchParams.get('entityId')
  if (!entityType || !entityId) return NextResponse.json([])
  const messages = await prisma.aiWorkspaceMessage.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json(messages)
}

// Max serverless function duration. Sonnet + web_search on a long
// thread (10+ turns of accumulated context, multiple search round-
// trips per turn) routinely blows past 60s — the recruiter's "what
// would the subject line for this be?" follow-ups were timing out
// because the model still re-ran web_search on the cached citations.
// 300s is the Vercel Pro ceiling for the default node runtime.
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const { entityType, entityId, userMessage } = await req.json()

  const baseSystemPrompt =
    entityType === 'client'
      ? await buildClientContext(entityId)
      : entityType === 'job'
        ? await buildJobContext(entityId)
        : await buildCandidateContext(entityId)

  // Formatting rules appended after the entity context so they apply
  // to every Game Plan response without rewriting the per-entity
  // builder prompts. Markdown link form keeps web_search citations
  // readable; bullet + bold conventions keep job / company lists
  // scannable in the chat bubble.
  //
  // Freshness mandate: Andrew sends Game Plan output directly to
  // candidates and clients, so any external fact (job listing, comp
  // range, hiring activity, link) must be current as of THIS turn.
  // The earlier prompt let Claude fall back on training-data
  // recollection — it once shipped six BA roles to Danny with two
  // missing links and a "data may be outdated" hedge in a follow-up.
  // The rules below force web_search per external claim and outright
  // forbid the hedge phrasing.
  const today = new Date().toISOString().slice(0, 10);
  const systemPrompt =
    baseSystemPrompt +
    "\n\n" +
    `TODAY: ${today}.\n\n` +
    "FRESHNESS RULES (mandatory):\n" +
    "- Every external fact you cite — job titles, employers, comp ranges, market salaries, hiring activity, contact info, news — MUST be verified via web_search performed during THIS turn. Do not rely on training-data recollection for anything time-sensitive.\n" +
    "- Every URL you include MUST be a link you just retrieved with web_search. If web_search cannot return a working, currently-live URL for a specific role, OMIT that role entirely. Do not guess, do not approximate, do not paste a careers-page URL as a substitute.\n" +
    "- Prefer canonical ATS URLs over Google-cached snippets or third-party scraper sites. PREFERRED ATS hosts (the server can verify these against the ATS's public posting API, so closed jobs are caught with certainty): boards.greenhouse.io / job-boards.greenhouse.io, jobs.lever.co, jobs.ashbyhq.com. Acceptable secondary ATS hosts (server falls back to fetching the page and pattern-matching closure copy): workable.com, smartrecruiters.com, jobvite.com, applytojob.com, careers.<company>.com. Aggregator search-results pages (LinkedIn, Indeed, ZipRecruiter, Glassdoor, Wellfound, Built In) are NEVER acceptable as a Section-1 specific-role link — they belong in Section 2 only.\n" +
    "- Never write hedges like \"data may be old\", \"could be outdated\", \"information might have changed\", or similar. If you cannot verify it now, leave it out of the response.\n" +
    "- When listing N jobs or N companies, every single one must have a verified live link. If you can only verify 4 of 6, return 4 — never pad with unverified items.\n" +
    "- The server runs an automated URL-verification pass after you respond. If it finds dead URLs in your output it will send them back to you with a revision request — your revision must remove them entirely (or replace with verified live alternatives), never re-include them under a different framing.\n\n" +
    "TWO-SECTION STRUCTURE (mandatory whenever the response contains job listings):\n" +
    "Specific role postings and broader job-board search pointers must NEVER be blended into a single numbered list. Split them into two clearly-labeled sections:\n\n" +
    "**Open Roles:** — numbered (`1.`, `2.`, …). One entry per specific posting. Each entry: bold `**Title at Company (location, comp if known)**`, then 1–2 sentences on why it fits the candidate, then a single `[Apply at Company via <ATS>](url)` link to the canonical ATS page. Only roles with a verified live URL belong here.\n\n" +
    "**Broader job-board searches to watch:** — bulleted (hyphens, NOT numbered). Frame the section header explicitly as \"pages to browse — these are search results, not pre-vetted roles.\" Each bullet: site name + the specific filter/keyword/location the candidate should browse, with a `[Browse on <Site>](url)` link. LinkedIn / Indeed / ZipRecruiter / Glassdoor / Wellfound / Built In keyword-search pages live HERE, never in Section 1.\n\n" +
    "Section headers (the bolded `**Open Roles:**` / `**Broader job-board searches to watch:**` lines) MUST end with a trailing colon. Always. The colon is a hard rule — every future header for these sections lands with one.\n\n" +
    "If a Section-1 posting closes, drop it — never demote it into Section 2. Section 2 is for aggregator pages, not stale specific roles.\n\n" +
    "FORMATTING RULES:\n" +
    "Always format URLs as markdown hyperlinks like [Link Text](url) - never paste raw URLs. " +
    "When returning lists of jobs, companies, or resources, use clean markdown: bold headers for categories, " +
    "hyphen bullets for items, and descriptive link text instead of full URLs. " +
    "Keep responses scannable and well-organized."

  // Persist the new user message first so the POST is recoverable if
  // something downstream blows up — the recruiter's question is never lost.
  await prisma.aiWorkspaceMessage.create({
    data: { entityType, entityId, role: 'user', content: userMessage },
  })

  // Pre-insert a placeholder assistant row BEFORE the Anthropic call, then
  // update it with the real content once Claude responds. This preserves
  // strict user/assistant alternation in the DB even if the function is
  // killed mid-await (serverless timeout, process crash, rate-limit drop).
  // Without this, a killed POST leaves an orphan user row — refreshing
  // shows a broken thread and the NEXT POST feeds Claude consecutive user
  // messages, which Anthropic 400s on, spiraling the thread.
  const placeholder = await prisma.aiWorkspaceMessage.create({
    data: {
      entityType,
      entityId,
      role: 'assistant',
      content: '(response still processing — refresh in a moment)',
    },
  })

  const history = await prisma.aiWorkspaceMessage.findMany({
    where: { entityType, entityId, id: { not: placeholder.id } },
    orderBy: { createdAt: 'asc' },
  })

  // Defensive alternation dedupe: Anthropic rejects consecutive same-role
  // messages. The DB can still contain orphan user rows from a pre-fix
  // session, so collapse runs of the same role into one (keeping the most
  // recent content) before handing the transcript to the API.
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = []
  for (const m of history) {
    const role = m.role as 'user' | 'assistant'
    const last = messages[messages.length - 1]
    if (last && last.role === role) {
      last.content = m.content
    } else {
      messages.push({ role, content: m.content })
    }
  }

  let assistantContent = ''
  let ok = true
  let errorMessage = ''
  try {
    const response = await anthropic.messages.create({
      // Route through the project's single model constant
      // (src/lib/claude.ts CLAUDE_MODEL). Every Claude caller in Ace —
      // submittal writeup, JD reformat, call summary, candidate parse,
      // client auto-fill — already reads from this constant. Swap
      // models in one place, not seven.
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
        },
      ],
      system: systemPrompt,
      messages,
    })
    // Server-side web_search returns a multi-block response:
    //   [ text(preface), server_tool_use, web_search_tool_result, text(answer) ]
    // The earlier single-block grab (response.content[0]) only kept the
    // preface, so the saved assistant row read "Let me search for X..."
    // and stopped — the cited final answer was discarded. Walk the
    // content array, keep every text block, join with a blank line so
    // the preface and final answer read as one message.
    assistantContent = response.content
      .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('\n\n')
    if (!assistantContent) {
      ok = false
      errorMessage = 'Claude returned no text content'
      assistantContent = '(no response from the model — empty reply)'
    } else {
      // URL verification pass. Extract every URL from the draft, fetch
      // the non-aggregator ones (LinkedIn / Indeed / etc. bot-block our
      // UA and are always Section-2 anyway), and look for known
      // closed-job patterns. Dead Section-1 listings are stripped
      // DETERMINISTICALLY — no second Claude call. The earlier design
      // looped Claude back through web_search to find replacements,
      // which routinely pushed total response time past Vercel's 300s
      // function ceiling and left the recruiter staring at the
      // "(response still processing — refresh in a moment)" placeholder
      // forever. Stripping is instant and good enough — if Andrew wants
      // replacements he can ask in chat.
      const urls = extractUrls(assistantContent)
      if (urls.length > 0) {
        const verifications = await verifyUrls(urls)
        const deadUrls = verifications.filter((v) => !v.alive).map((v) => v.url)
        if (deadUrls.length > 0) {
          // eslint-disable-next-line no-console
          console.log(
            '[ai-workspace] URL verification: %d dead of %d — deterministic strip',
            deadUrls.length,
            urls.length,
            deadUrls,
          )
          assistantContent = stripDeadListings(assistantContent, new Set(deadUrls))
        }
      }
    }
  } catch (err) {
    ok = false
    errorMessage = err instanceof Error ? err.message : String(err)
    assistantContent = `(no response from the model — ${errorMessage})`
  }

  await prisma.aiWorkspaceMessage.update({
    where: { id: placeholder.id },
    data: { content: assistantContent },
  })

  if (!ok) {
    return NextResponse.json({ content: assistantContent, error: errorMessage }, { status: 502 })
  }
  return NextResponse.json({ content: assistantContent })
}

export async function DELETE(req: NextRequest) {
  const entityType = req.nextUrl.searchParams.get('entityType')
  const entityId = req.nextUrl.searchParams.get('entityId')
  if (!entityType || !entityId) return NextResponse.json({ ok: false })
  await prisma.aiWorkspaceMessage.deleteMany({ where: { entityType, entityId } })
  return NextResponse.json({ ok: true })
}

// Deterministic dead-listing strip. Walks the response line-by-line,
// groups consecutive lines under each `\d+. ` numbered marker (Section
// 1 specific roles in the Game Plan format), and drops any block whose
// body contains a verified-dead URL. Section-2 boundary detection
// stops the grouping at "Section 2", "## " headings, or `---`
// separators so we never accidentally strip a Section-2 bullet just
// because it shares a verified URL string with a Section-1 block.
// After dropping, remaining numbered items are renumbered 1..N.
function stripDeadListings(text: string, deadUrls: Set<string>): string {
  if (deadUrls.size === 0) return text

  const lines = text.split('\n')
  const out: string[] = []
  let block: string[] | null = null

  const deadList = Array.from(deadUrls)
  function blockHasDead(buf: string[]): boolean {
    const joined = buf.join('\n')
    for (const u of deadList) {
      if (joined.includes(u)) return true
    }
    return false
  }

  function flush() {
    if (!block) return
    if (!blockHasDead(block)) out.push(...block)
    block = null
  }

  for (const line of lines) {
    if (/^\s*\d+\.\s/.test(line)) {
      // New numbered item starts — flush previous, begin new block.
      flush()
      block = [line]
      continue
    }
    if (block !== null) {
      // Section boundary: end Section 1 here, flush block, drop the
      // boundary line into the output stream as-is.
      if (
        /^\s*(##\s+|\*\*)?Section\s+2/i.test(line) ||
        /^\s*##\s+/.test(line) ||
        /^---+\s*$/.test(line)
      ) {
        flush()
        out.push(line)
        continue
      }
      block.push(line)
      continue
    }
    out.push(line)
  }
  flush()

  // Renumber remaining `\d+. ` markers to 1..N so a strip in the middle
  // doesn't leave gaps like "1. ... 3. ... 4. ...".
  let n = 1
  return out.join('\n').replace(/^(\s*)\d+\.\s/gm, (_m, indent: string) => `${indent}${n++}. `)
}
