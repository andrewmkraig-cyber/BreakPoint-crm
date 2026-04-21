import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const eventType = body.type || body.event_type || body.action

  if (eventType === 'message.received' || eventType === 'new_sms_or_mms') {
    const fromNumber = body.data?.object?.from || body.from_number || body.from
    const toNumber = body.data?.object?.to || body.to_number || body.to
    const content = body.data?.object?.body || body.content || body.message
    const candidate = await prisma.candidate.findFirst({
      where: { phone: { contains: fromNumber.replace(/\D/g, '').slice(-10) } },
    })
    if (candidate) {
      await prisma.smsMessage.create({
        data: {
          candidateId: candidate.id,
          direction: 'inbound',
          body: content,
          fromNumber,
          toNumber,
          status: 'received',
          krispcallId: body.data?.object?.id || body.id,
        },
      })
    }
  }

  if (eventType === 'call.completed' || eventType === 'new_call') {
    const fromNumber = body.data?.object?.from || body.from_number || body.from
    const toNumber = body.data?.object?.to || body.to_number || body.to
    const duration = body.data?.object?.duration ? parseInt(body.data.object.duration) : null
    const recordingUrl = body.data?.object?.recordingUrl || body.recording_url || null
    const quoId = body.data?.object?.id || body.id || body.call_id
    const direction = body.data?.object?.direction || body.direction || 'inbound'
    const phoneToMatch = (direction === 'inbound' ? fromNumber : toNumber).replace(/\D/g, '').slice(-10)
    const candidate = await prisma.candidate.findFirst({
      where: { phone: { contains: phoneToMatch } },
    })
    if (candidate) {
      const existing = await prisma.callLog.findFirst({ where: { krispcallId: quoId } })
      if (existing) {
        await prisma.callLog.update({
          where: { id: existing.id },
          data: { duration, status: 'completed', recordingUrl },
        })
      } else {
        await prisma.callLog.create({
          data: {
            candidateId: candidate.id,
            direction,
            fromNumber,
            toNumber,
            duration,
            status: 'completed',
            recordingUrl,
            krispcallId: quoId,
          },
        })
      }
    }
  }

  return NextResponse.json({ ok: true })
}
