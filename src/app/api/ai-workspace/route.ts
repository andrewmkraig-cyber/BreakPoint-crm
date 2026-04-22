import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import Anthropic from '@anthropic-ai/sdk'
import { buildClientContext, buildCandidateContext } from '@/lib/ai-workspace-context'

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

  const systemPrompt = entityType === 'client'
    ? await buildClientContext(entityId)
    : await buildCandidateContext(entityId)

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
      // Project standard — src/lib/claude.ts. The original spec's
      // `claude-sonnet-4-20250514` 404s against this Anthropic account.
      model: 'claude-opus-4-7',
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    })
    assistantContent = response.content[0]?.type === 'text' ? response.content[0].text : ''
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
