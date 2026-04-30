import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic()

export async function POST(req: NextRequest) {
  const { callLogId } = await req.json()
  const record = await prisma.callTranscript.findUnique({ where: { callLogId } })
  if (!record) return NextResponse.json({ error: 'No transcript found' }, { status: 404 })
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    tools: [
      {
        type: "web_search_20250305",
        name: "web_search",
      },
    ],
    messages: [{
      role: 'user',
      content: `You are a recruiting assistant. Summarize this call transcript in 3-5 bullet points. Focus on: candidate interest level, key skills mentioned, comp expectations, next steps. Be concise.\n\nTranscript:\n${record.transcript}`,
    }],
  })
  const summary = message.content[0].type === 'text' ? message.content[0].text : ''
  await prisma.callTranscript.update({ where: { callLogId }, data: { summary } })
  return NextResponse.json({ summary })
}
