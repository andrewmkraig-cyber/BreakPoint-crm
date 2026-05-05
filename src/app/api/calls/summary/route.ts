import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import Anthropic from '@anthropic-ai/sdk'
import { getCurrentOrg } from '@/lib/auth/getCurrentOrg'
import { buildPersonalTrainerBlock } from '@/lib/personal-trainer'

const anthropic = new Anthropic()

export async function POST(req: NextRequest) {
  const { callLogId } = await req.json()
  const record = await prisma.callTranscript.findUnique({ where: { callLogId } })
  if (!record) return NextResponse.json({ error: 'No transcript found' }, { status: 404 })

  const org = await getCurrentOrg()
  const trainerBlock = await buildPersonalTrainerBlock(org.id)
  const system =
    'You are a recruiting assistant. Summarize call transcripts in 3-5 bullet points. Focus on: candidate interest level, key skills mentioned, comp expectations, next steps. Be concise.' +
    trainerBlock

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    tools: [
      {
        type: "web_search_20250305",
        name: "web_search",
      },
    ],
    system,
    messages: [{
      role: 'user',
      content: `Transcript:\n${record.transcript}`,
    }],
  })
  const summary = message.content[0].type === 'text' ? message.content[0].text : ''
  await prisma.callTranscript.update({ where: { callLogId }, data: { summary } })
  return NextResponse.json({ summary })
}
