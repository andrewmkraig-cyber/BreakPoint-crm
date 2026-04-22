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

export async function POST(req: NextRequest) {
  const { entityType, entityId, userMessage } = await req.json()

  const systemPrompt = entityType === 'client'
    ? await buildClientContext(entityId)
    : await buildCandidateContext(entityId)

  await prisma.aiWorkspaceMessage.create({
    data: { entityType, entityId, role: 'user', content: userMessage },
  })

  const history = await prisma.aiWorkspaceMessage.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: 'asc' },
  })

  const messages = history.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  })

  const assistantContent = response.content[0].type === 'text' ? response.content[0].text : ''

  await prisma.aiWorkspaceMessage.create({
    data: { entityType, entityId, role: 'assistant', content: assistantContent },
  })

  return NextResponse.json({ content: assistantContent })
}

export async function DELETE(req: NextRequest) {
  const entityType = req.nextUrl.searchParams.get('entityType')
  const entityId = req.nextUrl.searchParams.get('entityId')
  if (!entityType || !entityId) return NextResponse.json({ ok: false })
  await prisma.aiWorkspaceMessage.deleteMany({ where: { entityType, entityId } })
  return NextResponse.json({ ok: true })
}
