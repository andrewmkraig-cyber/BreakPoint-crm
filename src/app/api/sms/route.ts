import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendSms, FROM } from '@/lib/quo'

export async function POST(req: NextRequest) {
  const { candidateId, toNumber, body } = await req.json()
  // candidateId is optional now — the dialer's new-conversation flow
  // sends to numbers that aren't in Ace yet. The row still saves with
  // candidateId=null so the conversation surfaces in the Phone tab as
  // an unknown-number thread, and the recruiter can link it to a
  // candidate / contact later via the "Add to Ace" affordance.
  const resolvedCandidateId =
    typeof candidateId === 'string' && candidateId.length > 0
      ? candidateId
      : null

  let krispcallId: string | undefined
  let status = 'sent'
  try {
    const result = await sendSms(toNumber, body)
    krispcallId = result?.data?.id
  } catch (e) {
    console.error('[api/sms POST] Quo dispatch failed', e)
    status = 'failed'
  }
  const msg = await prisma.smsMessage.create({
    data: {
      candidateId: resolvedCandidateId,
      direction: 'outbound',
      body,
      fromNumber: FROM,
      toNumber,
      status,
      krispcallId,
    },
  })
  return NextResponse.json(msg)
}

export async function GET(req: NextRequest) {
  const candidateId = req.nextUrl.searchParams.get('candidateId')
  if (!candidateId) return NextResponse.json([])
  const messages = await prisma.smsMessage.findMany({
    where: { candidateId },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json(messages)
}

// Single-row delete. Removes the SmsMessage from Neon — purely a
// recruiter-side cleanup (the carrier already delivered the SMS, so
// this does NOT recall the message from the recipient's phone). Used
// to scrub typos, accidental sends, or test traffic out of a
// candidate's activity log without touching the rest of the thread.
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  if (!id) {
    return NextResponse.json({ ok: false, error: 'missing id' }, { status: 400 })
  }
  try {
    await prisma.smsMessage.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'delete failed'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
