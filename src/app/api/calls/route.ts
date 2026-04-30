import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(req: NextRequest) {
  const { candidateId, direction, fromNumber, toNumber, status, duration, recordingUrl, krispcallId } = await req.json()
  const log = await prisma.callLog.create({
    data: { candidateId, direction, fromNumber, toNumber, status: status ?? 'initiated', duration, recordingUrl, krispcallId },
  })
  return NextResponse.json(log)
}

export async function GET(req: NextRequest) {
  // Accept either candidateId or clientId. Candidate scoping is the
  // primary use case; clientId scoping powers the call log on the
  // client profile activity tab. If both arrive somehow, candidateId
  // takes precedence.
  const candidateId = req.nextUrl.searchParams.get('candidateId')
  const clientId = req.nextUrl.searchParams.get('clientId')
  if (!candidateId && !clientId) return NextResponse.json([])
  const logs = await prisma.callLog.findMany({
    where: candidateId ? { candidateId } : { clientId: clientId! },
    include: { transcript: true },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(logs)
}
