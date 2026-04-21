import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendSms, FROM } from '@/lib/quo'

export async function POST(req: NextRequest) {
  const { candidateId, toNumber, body } = await req.json()
  let krispcallId: string | undefined
  let status = 'sent'
  try {
    const result = await sendSms(toNumber, body)
    krispcallId = result?.data?.id
  } catch {
    status = 'failed'
  }
  const msg = await prisma.smsMessage.create({
    data: { candidateId, direction: 'outbound', body, fromNumber: FROM, toNumber, status, krispcallId },
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
