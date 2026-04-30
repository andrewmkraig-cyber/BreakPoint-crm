import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { prisma } from '@/lib/prisma'

// Quo (formerly KrispCall / OpenPhone) inbound webhook.
//
// Signature scheme — the openphone-signature header carries
// `hmac;1;<unixMillis>;<base64Digest>` (semicolon-delimited).
// Digest = HMAC-SHA256 over `<timestamp>.<rawBody>`. Quo's signing
// key is base64-encoded but they apply it as decoded-binary bytes,
// not raw hex / utf-8 — we replicate that exactly. Replay window
// 5 minutes; off-by-default if QUO_SIGNING_SECRET isn't set so
// local dev / pre-prod surfaces still work without ceremony.

export async function POST(req: NextRequest) {
  // Read raw body once, then JSON.parse manually — req.json() would
  // consume the stream and we'd lose the bytes we need to sign over.
  const rawBody = await req.text()

  if (!verifySignature(req.headers.get('openphone-signature'), rawBody)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const eventType =
    (body as { type?: string; event_type?: string; action?: string }).type ||
    (body as { event_type?: string }).event_type ||
    (body as { action?: string }).action

  if (eventType === 'message.received' || eventType === 'new_sms_or_mms') {
    const fromNumber = pickStr(body, ['data.object.from', 'from_number', 'from'])
    const toNumber = pickStr(body, ['data.object.to', 'to_number', 'to'])
    const content = pickStr(body, ['data.object.body', 'content', 'message'])
    if (fromNumber) {
      const candidate = await prisma.candidate.findFirst({
        where: { phone: { contains: fromNumber.replace(/\D/g, '').slice(-10) } },
      })
      const orgId = candidate?.organizationId ?? null
      if (candidate) {
        await prisma.smsMessage.create({
          data: {
            candidateId: candidate.id,
            organizationId: orgId,
            direction: 'inbound',
            body: content ?? '',
            fromNumber,
            toNumber: toNumber ?? '',
            status: 'received',
            krispcallId: pickStr(body, ['data.object.id', 'id']),
          },
        })
      }
    }
  }

  // Quo's transcription pipeline fires this once the recording has
  // been transcribed (typically 10-30s after call.completed). The CallLog
  // row should already exist from the earlier call.completed write — we
  // upsert into the 1:1 CallTranscript relation keyed on callLogId.
  // Summary stays untouched here; call.summary.completed handles it
  // separately because the two events can arrive in either order.
  if (eventType === 'call.transcript.completed') {
    const quoId = pickStr(body, ['data.object.id', 'id', 'call_id'])
    const transcriptText = pickStr(body, [
      'data.object.transcript',
      'data.object.transcription',
      'transcript',
    ])
    if (!quoId || !transcriptText) {
      console.warn('[quo/webhook] call.transcript.completed missing id or transcript', { quoId, hasTranscript: !!transcriptText })
      return NextResponse.json({ ok: true })
    }
    const callLog = await prisma.callLog.findFirst({ where: { krispcallId: quoId } })
    if (!callLog) {
      console.warn('[quo/webhook] call.transcript.completed: no CallLog for quoId', { quoId })
      return NextResponse.json({ ok: true })
    }
    await prisma.callTranscript.upsert({
      where: { callLogId: callLog.id },
      // On create: summary is null until call.summary.completed fires.
      create: { callLogId: callLog.id, transcript: transcriptText },
      // On update: leave summary alone.
      update: { transcript: transcriptText },
    })
  }

  // Quo's AI summary fires after the transcript pipeline finishes its
  // own pass. Mirror of the transcript branch above — same call lookup,
  // same upsert table, but only writes the summary column. If the
  // summary event arrives before the transcript event (rare but
  // possible), we create the row with an empty transcript that the
  // later transcript event will overwrite.
  if (eventType === 'call.summary.completed') {
    const quoId = pickStr(body, ['data.object.id', 'id', 'call_id'])
    const summaryText = pickStr(body, [
      'data.object.summary',
      'data.object.ai_summary',
      'summary',
    ])
    if (!quoId || !summaryText) {
      console.warn('[quo/webhook] call.summary.completed missing id or summary', { quoId, hasSummary: !!summaryText })
      return NextResponse.json({ ok: true })
    }
    const callLog = await prisma.callLog.findFirst({ where: { krispcallId: quoId } })
    if (!callLog) {
      console.warn('[quo/webhook] call.summary.completed: no CallLog for quoId', { quoId })
      return NextResponse.json({ ok: true })
    }
    await prisma.callTranscript.upsert({
      where: { callLogId: callLog.id },
      // Out-of-order arrival: empty transcript placeholder until the
      // transcript event fills it in. Schema requires transcript to be
      // non-null, so we can't omit it on create.
      create: { callLogId: callLog.id, transcript: '', summary: summaryText },
      update: { summary: summaryText },
    })
  }

  if (eventType === 'call.completed' || eventType === 'new_call') {
    const fromNumber = pickStr(body, ['data.object.from', 'from_number', 'from'])
    const toNumber = pickStr(body, ['data.object.to', 'to_number', 'to'])
    const durationStr = pickStr(body, ['data.object.duration'])
    const duration = durationStr ? parseInt(durationStr) : null
    const recordingUrl = pickStr(body, ['data.object.recordingUrl', 'recording_url'])
    const quoId = pickStr(body, ['data.object.id', 'id', 'call_id'])
    const direction = pickStr(body, ['data.object.direction', 'direction']) || 'inbound'
    const phoneToMatch =
      ((direction === 'inbound' ? fromNumber : toNumber) || '').replace(/\D/g, '').slice(-10)
    if (phoneToMatch) {
      const candidate = await prisma.candidate.findFirst({
        where: { phone: { contains: phoneToMatch } },
      })
      const orgId = candidate?.organizationId ?? null
      if (candidate) {
        const existing = quoId
          ? await prisma.callLog.findFirst({ where: { krispcallId: quoId } })
          : null
        if (existing) {
          await prisma.callLog.update({
            where: { id: existing.id },
            data: { duration, status: 'completed', recordingUrl, organizationId: orgId },
          })
        } else {
          await prisma.callLog.create({
            data: {
              candidateId: candidate.id,
              organizationId: orgId,
              direction,
              fromNumber: fromNumber ?? '',
              toNumber: toNumber ?? '',
              duration,
              status: 'completed',
              recordingUrl,
              krispcallId: quoId,
            },
          })
        }
      }
    }
  }

  return NextResponse.json({ ok: true })
}

function verifySignature(header: string | null, rawBody: string): boolean {
  const secret = process.env.QUO_SIGNING_SECRET
  // Off-by-default — when no secret is configured we treat the
  // webhook as unauthenticated (existing behavior). Once the env
  // var is set, every request must carry a valid signature.
  if (!secret) return true
  if (!header) return false
  const parts = header.split(';')
  if (parts.length !== 4) return false
  const [, , timestamp, providedDigest] = parts
  if (!timestamp || !providedDigest) return false
  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) return false
  // Reject anything older than 5 minutes — replay protection.
  if (Math.abs(Date.now() - ts) > 5 * 60 * 1000) return false
  // Quo decodes the base64 secret as a binary string, NOT as raw
  // bytes — replicate exactly or HMAC won't match.
  const keyBinary = Buffer.from(secret, 'base64').toString('binary')
  const computed = crypto
    .createHmac('sha256', keyBinary)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('base64')
  const a = Buffer.from(providedDigest)
  const b = Buffer.from(computed)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

function pickStr(obj: unknown, paths: string[]): string | undefined {
  for (const p of paths) {
    const v = getPath(obj, p)
    if (typeof v === 'string' && v.length > 0) return v
    if (typeof v === 'number') return String(v)
  }
  return undefined
}

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key]
    }
    return undefined
  }, obj)
}
