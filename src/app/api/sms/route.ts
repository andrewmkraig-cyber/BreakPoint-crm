import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendSms, FROM } from '@/lib/quo'
import { normalizeToE164 } from '@/lib/rf-payload-shapes'

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

  // E.164-normalize before we hand the number to OpenPhone. The
  // composer + recipient picker accept user-typed strings like
  // "216-340-9511" or "(216) 340-9511"; OpenPhone's 10DLC routes
  // reject those without surfacing the format error on the synchronous
  // response, which manifested as "UI says sent, phone never rings."
  const normalizedTo = normalizeToE164(typeof toNumber === 'string' ? toNumber : null)
  if (!normalizedTo) {
    console.error('[api/sms POST] missing or unparseable toNumber', { toNumber })
    return NextResponse.json(
      { ok: false, error: 'missing or invalid toNumber' },
      { status: 400 },
    )
  }
  if (typeof body !== 'string' || body.trim().length === 0) {
    return NextResponse.json(
      { ok: false, error: 'missing body' },
      { status: 400 },
    )
  }

  // Persist the row in the same format we hand to the provider so the
  // candidate's thread + the carrier's log share a canonical number
  // shape.
  let krispcallId: string | undefined
  let status = 'sent'
  let providerError: string | null = null
  let providerStatus: string | null = null
  try {
    const result = await sendSms(normalizedTo, body)
    krispcallId = result.messageId ?? undefined
    providerStatus = result.providerStatus
    if (!result.ok) {
      status = 'failed'
      providerError = result.errorMessage
      console.error(
        `[api/sms POST] Quo dispatch failed http=${result.httpStatus} providerStatus=${result.providerStatus} error=${result.errorMessage}`,
      )
    } else {
      console.log(
        `[api/sms POST] Quo accepted to=${normalizedTo} messageId=${result.messageId} providerStatus=${result.providerStatus}`,
      )
    }
  } catch (e) {
    console.error('[api/sms POST] Quo dispatch threw', e)
    status = 'failed'
    providerError = e instanceof Error ? e.message : 'send threw'
  }

  const msg = await prisma.smsMessage.create({
    data: {
      candidateId: resolvedCandidateId,
      direction: 'outbound',
      body,
      fromNumber: FROM,
      toNumber: normalizedTo,
      status,
      krispcallId,
    },
  })
  return NextResponse.json({
    ...msg,
    // Surface provider diagnostics to the composer so the error banner
    // can explain *why* a save-with-failed-send happened instead of
    // just "send failed."
    providerStatus,
    providerError,
  })
}

export async function GET(req: NextRequest) {
  // Accept either candidateId or clientId. Mirrors /api/calls — the
  // client profile's <TextingExchanges clientId={...}/> reads through
  // here; candidateId remains the primary scope for the candidate
  // profile. When both are supplied (defensive) candidateId wins.
  const candidateId = req.nextUrl.searchParams.get('candidateId')
  const clientId = req.nextUrl.searchParams.get('clientId')
  if (!candidateId && !clientId) return NextResponse.json([])
  const messages = await prisma.smsMessage.findMany({
    where: candidateId ? { candidateId } : { clientId: clientId! },
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
