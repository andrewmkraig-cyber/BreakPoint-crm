import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import Anthropic from '@anthropic-ai/sdk'
import { buildClientContext, buildCandidateContext } from '@/lib/ai-workspace-context'
import { CLAUDE_MODEL } from '@/lib/claude'

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

// Max serverless function duration — Claude Opus on a thick context can take
// 15–25s. Keeping this generous so Vercel doesn't kill the function mid-call.
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const { entityType, entityId, userMessage } = await req.json()

  const baseSystemPrompt = entityType === 'client'
    ? await buildClientContext(entityId)
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
    "- Never write hedges like \"data may be old\", \"could be outdated\", \"information might have changed\", or similar. If you cannot verify it now, leave it out of the response.\n" +
    "- When listing N jobs or N companies, every single one must have a verified live link. If you can only verify 4 of 6, return 4 — never pad with unverified items.\n\n" +
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
