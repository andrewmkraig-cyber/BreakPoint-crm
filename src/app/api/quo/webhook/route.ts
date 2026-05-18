import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { matchClientByPhone } from '@/lib/quo-contact-match'
import { sendPushToOrg, sendPushToUser } from '@/lib/web-push'
import { getUnreadCountsForOrg } from '@/lib/unread-counts'

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

  // Diagnostic logger — surfaces every Quo event's type and the top-level
  // shape of body + body.data.object in Vercel logs so unhandled events
  // and unexpected payload paths become visible without a code change.
  // Read-only; no behavior impact on the branches below.
  const dataObj = (body as { data?: { object?: Record<string, unknown> } }).data?.object
  console.log(
    `[quo/webhook] event=${eventType ?? '(undefined)'}` +
      ` body_keys=${Object.keys(body).join(',')}` +
      ` data_object_keys=${dataObj ? Object.keys(dataObj).join(',') : '(none)'}`,
  )

  if (eventType === 'message.received' || eventType === 'new_sms_or_mms') {
    const fromNumber = pickStr(body, ['data.object.from', 'from_number', 'from'])
    const toNumber = pickStr(body, ['data.object.to', 'to_number', 'to'])
    const content = pickStr(body, ['data.object.body', 'content', 'message'])
    // MMS images. OpenPhone delivers attachments as either
    // `data.object.media: [{ url, type }, ...]` or a top-level
    // `data.object.mediaUrl` (varies across event versions). We grab
    // the first http(s) URL we find and persist it on SmsMessage.
    const mediaUrl = pickMediaUrl(body)
    if (fromNumber) {
      const candidate = await prisma.candidate.findFirst({
        where: { phone: { contains: fromNumber.replace(/\D/g, '').slice(-10) } },
      })
      // Fall through to a Contact-side lookup when no candidate matches —
      // the same number might belong to a client contact, in which case
      // we stamp SmsMessage.clientId so the row shows up under
      // <TextingExchanges clientId={...}/> on the client profile.
      const clientMatch = candidate ? null : await matchClientByPhone(fromNumber)
      // Always persist the row — even when the from-number doesn't match
      // any candidate. The Phone tab now surfaces unknown-number threads
      // with an "Add to Ace" action, so dropping them on the floor would
      // hide real activity (e.g. inbound texts from a client contact who
      // hasn't been added to the CRM yet).
      const orgId = candidate?.organizationId ?? clientMatch?.organizationId ?? (await defaultOrgId())
      await prisma.smsMessage.create({
        data: {
          candidateId: candidate?.id ?? null,
          clientId: clientMatch?.clientId ?? null,
          organizationId: orgId,
          direction: 'inbound',
          body: content ?? '',
          fromNumber,
          toNumber: toNumber ?? '',
          status: 'received',
          krispcallId: pickStr(body, ['data.object.id', 'id']),
          mediaUrl,
        },
      })
      // Push notification — best-effort. Tag scopes by candidate id (so
      // multiple texts in one thread collapse to one notification) or
      // by the bare digits of the from-number when the sender isn't
      // linked to a Candidate yet. Body trimmed to 100 chars to stay
      // inside the platform-default notification body cap.
      //
      // Per-user routing: there's no Quo Inbox model in Ace, so the
      // closest "ownership" signal is Candidate.createdById — the
      // recruiter who first added that candidate. When we have it we
      // push only to that user's devices. When no candidate matches
      // (unknown number) we fall back to fanning out across the org.
      if (orgId) {
        const senderName =
          (candidate
            ? [candidate.firstName, candidate.lastName]
                .filter(Boolean)
                .join(' ')
                .trim()
            : '') || fromNumber
        const tagKey =
          candidate?.id ??
          (fromNumber.replace(/\D/g, '').slice(-10) || fromNumber)
        const dest = candidate
          ? `/phone?candidateId=${candidate.id}`
          : `/phone?from=${encodeURIComponent(fromNumber)}`
        const counts = await getUnreadCountsForOrg(orgId)
        const payload = {
          title: `New text from ${senderName}`,
          body: (content ?? '').slice(0, 100),
          url: dest,
          tag: `sms-${tagKey}`,
          mailUnread: counts.mailUnread,
          phoneUnread: counts.phoneUnread,
          badgeCount: counts.badgeCount,
        }
        if (candidate?.createdById) {
          await sendPushToUser(candidate.createdById, orgId, payload)
        } else {
          // Shared line: no owner to route to, fan out across the org.
          await sendPushToOrg(orgId, payload)
        }
      }
    }
  }

  // Quo's transcription pipeline fires this once the recording has
  // been transcribed (typically 10-30s after call.completed). The CallLog
  // row should already exist from the earlier call.completed write — we
  // upsert into the 1:1 CallTranscript relation keyed on callLogId.
  // Summary stays untouched here; call.summary.completed handles it
  // separately because the two events can arrive in either order.
  //
  // Real payload shape (confirmed from a live event 2026-04-30):
  //   - top-level wrapper is body.object (NOT body.data)
  //   - callId at body.object.data.object.callId
  //   - dialogue is an array at body.object.data.object.dialogue:
  //       [{ start: 2.87, end, content, identifier, userId }, ...]
  // Older fallback paths kept so legacy / alt-nesting events don't drop
  // silently.
  if (eventType === 'call.transcript.completed') {
    const quoId = pickStr(body, [
      'object.data.object.callId',
      'data.object.callId',
      'data.object.id',
      'id',
      'call_id',
    ])
    const dialogue =
      (getPath(body, 'object.data.object.dialogue') as unknown) ??
      (getPath(body, 'data.object.dialogue') as unknown)
    let transcriptText: string | undefined
    if (Array.isArray(dialogue)) {
      transcriptText = dialogue
        .map((d) => {
          const item = d as { start?: number; content?: string; identifier?: string }
          const ts = formatMmss(typeof item.start === 'number' ? item.start : 0)
          const speaker = item.identifier ?? '(unknown)'
          const content = (item.content ?? '').trim()
          return `${ts} ${speaker}: ${content}`
        })
        .join('\n')
    }
    if (!quoId || !transcriptText) {
      console.warn('[quo/webhook] call.transcript.completed missing id or dialogue', {
        quoId,
        dialogueIsArray: Array.isArray(dialogue),
        dialogueLen: Array.isArray(dialogue) ? dialogue.length : 0,
      })
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
  //
  // Real payload shape (confirmed 2026-04-30):
  //   - body.object.data.object.summary  -> string[] of bullet sentences
  //   - body.object.data.object.nextSteps -> string[] of bullet sentences
  // Format saved to CallTranscript.summary:
  //   <summary lines joined by \n>
  //   <blank line>
  //   "Next Steps:"
  //   <nextSteps lines joined by \n>
  // (the Next Steps block is omitted when nextSteps is empty/absent).
  if (eventType === 'call.summary.completed') {
    const quoId = pickStr(body, [
      'object.data.object.callId',
      'data.object.callId',
      'data.object.id',
      'id',
      'call_id',
    ])
    const summary =
      (getPath(body, 'object.data.object.summary') as unknown) ??
      (getPath(body, 'data.object.summary') as unknown)
    const nextSteps =
      (getPath(body, 'object.data.object.nextSteps') as unknown) ??
      (getPath(body, 'data.object.nextSteps') as unknown)
    // Defensive item normalizer — if Quo sends array items as objects
    // (e.g. [{ content: "..." }]) instead of plain strings, fall back
    // to common string fields. Returns "" for items we can't decode,
    // which the .filter(Boolean) below drops.
    const itemToString = (it: unknown): string => {
      if (typeof it === 'string') return it.trim()
      if (it && typeof it === 'object') {
        const o = it as Record<string, unknown>
        for (const k of ['content', 'text', 'body', 'value', 'description']) {
          const v = o[k]
          if (typeof v === 'string' && v.trim().length > 0) return v.trim()
        }
      }
      return ''
    }
    let summaryText: string | undefined
    if (Array.isArray(summary) && summary.length > 0) {
      const summaryLines = summary.map(itemToString).filter(Boolean).join('\n')
      if (Array.isArray(nextSteps) && nextSteps.length > 0) {
        const nextStepLines = nextSteps.map(itemToString).filter(Boolean).join('\n')
        summaryText = nextStepLines
          ? `${summaryLines}\n\nNext Steps:\n${nextStepLines}`
          : summaryLines
      } else {
        summaryText = summaryLines
      }
      // Empty after extraction → treat as missing so the diagnostic
      // warn fires and we see what shape actually arrived.
      if (!summaryText.trim()) summaryText = undefined
    }
    if (!quoId || !summaryText) {
      // Log a sample of the raw values so we can see what Quo actually
      // sent when the upsert decides not to fire. Truncated to keep
      // log lines short — full payload still in the diagnostic logger
      // line near the top of the handler.
      const sample = (val: unknown): unknown => {
        if (Array.isArray(val)) return val.slice(0, 2)
        return val
      }
      console.warn('[quo/webhook] call.summary.completed missing id or summary', {
        quoId,
        summaryIsArray: Array.isArray(summary),
        summaryLen: Array.isArray(summary) ? summary.length : 0,
        summarySample: sample(summary),
        nextStepsSample: sample(nextSteps),
      })
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
      // Same fallthrough as the SMS branch: a non-candidate number might
      // belong to a client contact. Match against Contact.phoneNumbers
      // so CallLog.clientId lands on the row at write-time, surfacing
      // the call under <CallLogs clientId={...}/> on the client profile.
      const phoneRaw = (direction === 'inbound' ? fromNumber : toNumber) || ''
      const clientMatch = candidate ? null : await matchClientByPhone(phoneRaw)
      // Persist the call log even when the other-party number doesn't
      // match a known Candidate. The Phone tab surfaces those rows as
      // unknown-number threads with an "Add to Ace" action so the
      // recruiter can find calls they had with people not yet in the
      // CRM (e.g. a client contact, or a referral they haven't logged).
      const orgId = candidate?.organizationId ?? clientMatch?.organizationId ?? (await defaultOrgId())
      const existing = quoId
        ? await prisma.callLog.findFirst({ where: { krispcallId: quoId } })
        : null
      const callLogRow = existing
        ? await prisma.callLog.update({
            where: { id: existing.id },
            data: {
              duration,
              status: 'completed',
              recordingUrl,
              organizationId: orgId,
              // Only stamp clientId on update when we resolved a Contact
              // match — leaving it untouched preserves any earlier write
              // (e.g. the call.completed event already wrote clientId,
              // and this is a re-delivery / late update).
              ...(clientMatch?.clientId ? { clientId: clientMatch.clientId } : {}),
            },
          })
        : await prisma.callLog.create({
            data: {
              candidateId: candidate?.id ?? null,
              clientId: clientMatch?.clientId ?? null,
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
      // Push notification — inbound only. Outbound calls are user-
      // initiated so a "Call ended" toast there would just be noise.
      // Duration ≤ 3s (or missing) is treated as a missed call —
      // typical voicemail / no-answer cutoffs land well above that.
      //
      // Per-user routing: same logic as the SMS branch — push to the
      // owning recruiter (Candidate.createdById) when the caller is a
      // known candidate, fan out across the org otherwise.
      if (orgId && direction === 'inbound' && callLogRow?.id) {
        const callerName =
          (candidate
            ? [candidate.firstName, candidate.lastName]
                .filter(Boolean)
                .join(' ')
                .trim()
            : '') || fromNumber || 'Unknown'
        const isMissed = !duration || duration <= 3
        const counts = await getUnreadCountsForOrg(orgId)
        const payload = {
          title: isMissed ? 'Missed call' : 'Call ended',
          body: duration
            ? `${callerName} · ${formatMmss(duration)}`
            : callerName,
          url: `/phone?call=${callLogRow.id}`,
          tag: `call-${callLogRow.id}`,
          mailUnread: counts.mailUnread,
          phoneUnread: counts.phoneUnread,
          badgeCount: counts.badgeCount,
        }
        if (candidate?.createdById) {
          await sendPushToUser(candidate.createdById, orgId, payload)
        } else {
          // Shared line: no owner to route to, fan out across the org.
          await sendPushToOrg(orgId, payload)
        }
      }
    }
  }

  return NextResponse.json({ ok: true })
}

// Webhooks have no caller session, so we can't use getCurrentOrg().
// Pick the first Organization row as a fallback when an inbound row
// doesn't match any Candidate — Ace is single-tenant in practice
// (BreakPoint Talent), so this resolves to the right org without
// hardcoding a cuid in source. Cached after first hit so the webhook
// never makes more than one extra round-trip per cold container.
let cachedDefaultOrgId: string | null = null
async function defaultOrgId(): Promise<string | null> {
  if (cachedDefaultOrgId) return cachedDefaultOrgId
  const org = await prisma.organization.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  cachedDefaultOrgId = org?.id ?? null
  return cachedDefaultOrgId
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

function pickMediaUrl(body: unknown): string | null {
  // First, scan a `media` array under data.object.media or top-level media
  // (Quo sends one or the other depending on the event version). Each
  // entry is typically `{ url, type }`; treat bare strings as URLs too.
  const arr =
    (getPath(body, 'data.object.media') as unknown) ??
    (getPath(body, 'media') as unknown)
  if (Array.isArray(arr)) {
    for (const m of arr) {
      if (typeof m === 'string' && /^https?:\/\//i.test(m)) return m
      if (m && typeof m === 'object') {
        const u = (m as { url?: unknown }).url
        if (typeof u === 'string' && /^https?:\/\//i.test(u)) return u
      }
    }
  }
  // Fallback: flat string fields some webhook variants set instead of
  // a media array.
  const flat = pickStr(body, [
    'data.object.mediaUrl',
    'data.object.media_url',
    'mediaUrl',
    'media_url',
  ])
  return flat && /^https?:\/\//i.test(flat) ? flat : null
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

// Format a seconds float (e.g. 2.87 from a Quo dialogue.start field)
// as "M:SS" so transcript lines read like "0:02 +12168704655: Hello.".
// Floor to whole seconds — sub-second precision is noise for human
// reading. Negative or non-finite inputs collapse to "0:00".
function formatMmss(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
