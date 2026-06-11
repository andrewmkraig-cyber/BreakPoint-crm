import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { sendSms, FROM } from '@/lib/quo'
import { getCurrentOrg } from '@/lib/auth/getCurrentOrg'
import { authOptions } from '@/lib/auth'
import { normalizeToE164 } from '@/lib/rf-payload-shapes'
import { getQuoLineDigitsForUserEmail, phoneTail, smsLineWhere } from '@/lib/quo-line-owner'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  }

  const { candidateId, toNumber, body } = await req.json()
  console.log(
    `[api/sms POST] entry candidateIdRaw=${typeof candidateId === 'string' ? candidateId : '(none)'} toNumberRaw=${typeof toNumber === 'string' ? toNumber : '(none)'} bodyLen=${typeof body === 'string' ? body.length : 0}`,
  )

  // candidateId is optional — the dialer's new-conversation flow sends
  // to numbers that aren't in Ace yet. The row still saves with
  // candidateId=null so it surfaces in the Phone tab as an unknown-
  // number thread. The /phone detail pane passes detail.contact.id
  // which is the prefixed THREAD id ("cand:<cuid>" or "unk:<digits>")
  // — strip both prefixes so we never write a thread id into the
  // candidateId column (would corrupt the row + break the FK-shaped
  // join the candidate sidebar reads).
  let resolvedCandidateId: string | null = null
  if (typeof candidateId === 'string' && candidateId.length > 0) {
    if (candidateId.startsWith('unk:')) {
      resolvedCandidateId = null
    } else if (candidateId.startsWith('cand:')) {
      resolvedCandidateId = candidateId.slice('cand:'.length)
    } else {
      resolvedCandidateId = candidateId
    }
  }

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

  // Tenant scope. Every SmsMessage row must carry organizationId so the
  // /phone thread detail query (which filters by org) can see it. Prior
  // code created rows with organizationId=null, leaving the new outbound
  // row invisible to the thread pane even though it was in the DB.
  // Prefer the candidate's org when we have a resolved candidate (keeps
  // the row attached to the right tenant even if the user's session org
  // somehow drifts); fall back to the active session org otherwise.
  let organizationId: string | null = null
  if (resolvedCandidateId) {
    const cand = await prisma.candidate.findUnique({
      where: { id: resolvedCandidateId },
      select: { organizationId: true },
    })
    organizationId = cand?.organizationId ?? null
  }
  if (!organizationId) {
    try {
      const org = await getCurrentOrg()
      organizationId = org.id
    } catch (e) {
      console.error('[api/sms POST] getCurrentOrg failed', e)
    }
  }
  if (!organizationId) {
    return NextResponse.json(
      { ok: false, error: 'organization unavailable' },
      { status: 500 },
    )
  }
  const lineDigits = await getQuoLineDigitsForUserEmail(organizationId, email)
  const configuredFromDigits = phoneTail(FROM)
  if (
    lineDigits.length === 0 ||
    (configuredFromDigits && !lineDigits.includes(configuredFromDigits))
  ) {
    return NextResponse.json(
      { ok: false, error: 'No Quo phone line is configured for this Ace account.' },
      { status: 403 },
    )
  }

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

  const existing = krispcallId
    ? await prisma.smsMessage.findFirst({ where: { krispcallId } })
    : null
  const msgData = {
    candidateId: resolvedCandidateId,
    organizationId,
    direction: 'outbound',
    body,
    fromNumber: FROM,
    toNumber: normalizedTo,
    status,
    isRead: true,
    krispcallId: krispcallId ?? null,
  }
  const msg = existing
    ? await prisma.smsMessage.update({
        where: { id: existing.id },
        data: {
          ...msgData,
          candidateId: existing.candidateId ?? resolvedCandidateId,
          clientId: existing.clientId,
          organizationId: existing.organizationId ?? organizationId,
          fromNumber: FROM || existing.fromNumber,
        },
      })
    : await prisma.smsMessage.create({
        data: msgData,
      })
  console.log(
    `[api/sms POST] ${existing ? 'updated existing' : 'persisted'} id=${msg.id} candidateId=${resolvedCandidateId ?? '(null)'} organizationId=${organizationId ?? '(null)'} status=${status}`,
  )
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
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  // Accept either candidateId or clientId. Mirrors /api/calls — the
  // client profile's <TextingExchanges clientId={...}/> reads through
  // here; candidateId remains the primary scope for the candidate
  // profile. When both are supplied (defensive) candidateId wins.
  const candidateId = req.nextUrl.searchParams.get('candidateId')
  const clientId = req.nextUrl.searchParams.get('clientId')
  if (!candidateId && !clientId) return NextResponse.json([])
  // Tenant scope (NN #8): never return rows from another org even if a
  // caller passes a candidate/client id that isn't theirs.
  const org = await getCurrentOrg()
  const lineDigits = await getQuoLineDigitsForUserEmail(org.id, session.user.email)
  if (lineDigits.length === 0) return NextResponse.json([])
  const messages = await prisma.smsMessage.findMany({
    where: candidateId
      ? { candidateId, organizationId: org.id, AND: [smsLineWhere(lineDigits)] }
      : { clientId: clientId!, organizationId: org.id, AND: [smsLineWhere(lineDigits)] },
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
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  }
  const id = req.nextUrl.searchParams.get('id')
  if (!id) {
    return NextResponse.json({ ok: false, error: 'missing id' }, { status: 400 })
  }
  try {
    // Tenant-scoped delete: deleteMany (not delete) so we can apply the
    // org filter. A forged id from another tenant matches zero rows and
    // returns 404 instead of deleting a cross-tenant message.
    const org = await getCurrentOrg()
    const lineDigits = await getQuoLineDigitsForUserEmail(org.id, session.user.email)
    if (lineDigits.length === 0) {
      return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 })
    }
    const res = await prisma.smsMessage.deleteMany({
      where: { id, organizationId: org.id, AND: [smsLineWhere(lineDigits)] },
    })
    if (res.count === 0) {
      return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'delete failed'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
